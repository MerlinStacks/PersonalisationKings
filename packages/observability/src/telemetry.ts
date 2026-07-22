import { context, metrics, propagation, SpanKind, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

interface TelemetryState {
  serviceName: string;
  initialization: Promise<NodeSDK>;
}

const globalTelemetry = globalThis as typeof globalThis & { __pkTelemetry?: TelemetryState };
const counters = new Map<string, ReturnType<ReturnType<typeof metrics.getMeter>["createCounter"]>>();
const histograms = new Map<string, ReturnType<ReturnType<typeof metrics.getMeter>["createHistogram"]>>();

export interface TelemetryConfig {
  endpoint: string;
  metricExportIntervalMs: number;
  serviceVersion: string;
}

export function telemetryConfig(env: Record<string, string | undefined> = process.env): TelemetryConfig | null {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return null;
  const url = new URL(endpoint);
  if (!url.hostname || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("OTEL_EXPORTER_OTLP_ENDPOINT must be an HTTP(S) base URL without credentials, query, or fragment");
  }
  const configuredInterval = Number(env.OTEL_METRIC_EXPORT_INTERVAL_MS ?? 60_000);
  const metricExportIntervalMs = Number.isSafeInteger(configuredInterval) && configuredInterval >= 5_000 && configuredInterval <= 300_000
    ? configuredInterval
    : 60_000;
  return {
    endpoint: url.toString().replace(/\/$/, ""),
    metricExportIntervalMs,
    serviceVersion: env.OTEL_SERVICE_VERSION?.trim().slice(0, 100) || (env.NODE_ENV === "production" ? "unversioned" : "development")
  };
}

export async function initializeTelemetry(serviceName: string, env: Record<string, string | undefined> = process.env) {
  const config = telemetryConfig(env);
  if (!config) return false;
  if (globalTelemetry.__pkTelemetry) {
    if (globalTelemetry.__pkTelemetry.serviceName !== serviceName) throw new Error("OpenTelemetry was initialized with a different service name");
    await globalTelemetry.__pkTelemetry.initialization;
    return true;
  }
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
      "deployment.environment.name": env.NODE_ENV ?? "development"
    }),
    traceExporter: new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${config.endpoint}/v1/metrics` }),
      exportIntervalMillis: config.metricExportIntervalMs
    })
  });
  const initialization = Promise.resolve(sdk.start()).then(() => sdk);
  globalTelemetry.__pkTelemetry = { initialization, serviceName };
  try {
    await initialization;
    return true;
  } catch (error) {
    if (globalTelemetry.__pkTelemetry?.initialization === initialization) delete globalTelemetry.__pkTelemetry;
    throw error;
  }
}

export async function shutdownTelemetry() {
  const state = globalTelemetry.__pkTelemetry;
  if (!state) return;
  delete globalTelemetry.__pkTelemetry;
  const sdk = await state.initialization;
  await sdk.shutdown();
}

export async function withServerSpan<T>(
  name: string,
  headers: Headers,
  attributes: Attributes,
  operation: (span: Span) => Promise<T>
) {
  const parent = propagation.extract(context.active(), headers, {
    keys(carrier) { return [...carrier.keys()]; },
    get(carrier, key) { return carrier.get(key) ?? undefined; }
  });
  return context.with(parent, () => trace.getTracer("@personalise-kings/observability").startActiveSpan(
    name,
    { kind: SpanKind.SERVER, attributes },
    async (span) => {
      try {
        return await operation(span);
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    }
  ));
}

export { SpanStatusCode };

export async function withSpan<T>(name: string, attributes: Attributes, operation: (span: Span) => Promise<T>): Promise<T> {
  return trace.getTracer("@personalise-kings/observability").startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await operation(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function addCounter(name: string, value = 1, attributes: Attributes = {}) {
  let counter = counters.get(name);
  if (!counter) {
    counter = metrics.getMeter("@personalise-kings/observability").createCounter(name);
    counters.set(name, counter);
  }
  counter.add(value, attributes);
}

export function recordHistogram(name: string, value: number, attributes: Attributes = {}) {
  let histogram = histograms.get(name);
  if (!histogram) {
    histogram = metrics.getMeter("@personalise-kings/observability").createHistogram(name);
    histograms.set(name, histogram);
  }
  histogram.record(value, attributes);
}
