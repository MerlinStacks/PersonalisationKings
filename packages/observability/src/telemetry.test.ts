import { describe, expect, it } from "vitest";
import { telemetryConfig } from "./telemetry";

describe("OpenTelemetry configuration", () => {
  it("is disabled without an OTLP endpoint", () => {
    expect(telemetryConfig({})).toBeNull();
  });

  it("normalizes valid configuration and bounds metric intervals", () => {
    expect(telemetryConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.com/",
      OTEL_METRIC_EXPORT_INTERVAL_MS: "10000",
      OTEL_SERVICE_VERSION: "1.2.3"
    })).toEqual({ endpoint: "https://collector.example.com", metricExportIntervalMs: 10_000, serviceVersion: "1.2.3" });
    expect(telemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318", OTEL_METRIC_EXPORT_INTERVAL_MS: "1" })?.metricExportIntervalMs).toBe(60_000);
  });

  it("rejects credential-bearing or non-HTTP endpoints", () => {
    expect(() => telemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "file:///tmp/traces" })).toThrow();
    expect(() => telemetryConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: "https://user:pass@collector.example.com" })).toThrow();
  });
});
