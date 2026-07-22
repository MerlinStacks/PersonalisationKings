import { createHash } from "node:crypto";
import { connectorEventEnvelopeSchema } from "@personalise-kings/connector-contracts";
import { validateServiceEnvironment } from "@personalise-kings/config/server";
import { getOrCreateCorrelationId } from "@personalise-kings/observability";
import { addCounter, initializeTelemetry, recordHistogram, shutdownTelemetry, SpanStatusCode, withServerSpan } from "@personalise-kings/observability/telemetry";
import { authenticateStoreRequest } from "./connector-auth";
import { ingestConnectorEvent, InvalidCustomisationReferenceError } from "./connector-events";
import {
  customiserOrigin,
  handleCreateCustomiserUpload,
  handleCreateEmbedToken,
  handleCustomiserCommit,
  handleCustomiserConfig,
  handleMappingLookup,
  handlePromoteCustomiserUpload
} from "./embed";
import { canonicalJson } from "./json";
import { handleObjectRequest } from "./objects";
import { InvalidRequestEncodingError, readRequestText, RequestBodyTooLargeError, UnsupportedMediaTypeError } from "./request-body";
import { consumeRateLimit } from "./rate-limit";
import { apiRouteName, normalizedHttpMethod } from "./telemetry";

const port = Number(process.env.PORT ?? 3002);
const replayWindowSeconds = Number(process.env.PK_CONNECTOR_REPLAY_WINDOW_SECONDS ?? 300);

validateServiceEnvironment("api");
await initializeTelemetry("personalise-kings-api");

export async function handleApiRequest(request: Request, peerAddress = "unknown") {
    const url = new URL(request.url);
    const correlationId = getOrCreateCorrelationId(request.headers);
    try {
      const limited = applyRateLimit(request, url, peerAddress, correlationId);
      if (limited) return limited;
      if (url.pathname === "/health") return Response.json({ ok: true, service: "personalise-kings-api", correlationId });
      if (url.pathname.startsWith("/objects/") && request.method === "OPTIONS") {
        const origin = request.headers.get("origin") ?? "";
        if (!browserOrigins().has(origin)) return new Response(null, { status: 403 });
        return objectCors(preflightResponse(), origin);
      }
      if (url.pathname.startsWith("/objects/")) {
        return objectCors(await handleObjectRequest(request, url, correlationId), request.headers.get("origin") ?? "");
      }

      if (url.pathname.startsWith("/v1/customiser/") && request.method === "OPTIONS") {
        const origin = request.headers.get("origin");
        if (!origin || origin !== customiserOrigin()) return new Response(null, { status: 403 });
        return customiserCors(preflightResponse(), origin);
      }
      if (url.pathname === "/v1/customiser/config" && request.method === "GET") {
        const origin = request.headers.get("origin") ?? "";
        return customiserCors(await handleCustomiserConfig(request, correlationId), origin);
      }
      if (url.pathname === "/v1/customiser/commit" && request.method === "POST") {
        const origin = request.headers.get("origin") ?? "";
        const rawBody = await readJsonBody(request, 1024 * 1024);
        return customiserCors(await handleCustomiserCommit(request, rawBody, correlationId), origin);
      }
      if (url.pathname === "/v1/customiser/uploads" && request.method === "POST") {
        const origin = request.headers.get("origin") ?? "";
        const rawBody = await readJsonBody(request, 8 * 1024);
        return customiserCors(await handleCreateCustomiserUpload(request, rawBody, correlationId), origin);
      }
      const uploadPromotion = /^\/v1\/customiser\/uploads\/([^/]+)\/promote$/.exec(url.pathname);
      if (uploadPromotion && request.method === "POST") {
        const origin = request.headers.get("origin") ?? "";
        const rawBody = await readJsonBody(request, 4 * 1024);
        return customiserCors(await handlePromoteCustomiserUpload(request, uploadPromotion[1], rawBody, correlationId), origin);
      }
      if (url.pathname === "/v1/customiser/embed-token" && request.method === "POST") {
        const rawBody = await readJsonBody(request, 16 * 1024);
        return handleCreateEmbedToken(request, rawBody, correlationId);
      }
      if (url.pathname === "/v1/customiser/mapping-lookup" && request.method === "POST") {
        const rawBody = await readJsonBody(request, 8 * 1024);
        return handleMappingLookup(request, rawBody, correlationId);
      }
      if (url.pathname === "/v1/connector/events" && request.method === "POST") {
        const rawBody = await readJsonBody(request, 1024 * 1024);
        const value = parseJson(rawBody);
        const parsed = connectorEventEnvelopeSchema.safeParse(value);
        if (!parsed.success) return Response.json({ error: "invalid_event", correlationId }, { status: 400 });

        const authentication = await authenticateStoreRequest(
          parsed.data.store_id,
          parsed.data.key_id,
          request.headers.get("x-pk-signature") ?? "",
          rawBody
        );
        if (authentication.status === "not_configured") {
          return Response.json({ error: "connector_secret_not_configured", correlationId }, { status: 503 });
        }
        if (authentication.status !== "authenticated") {
          return Response.json({ error: authentication.status, correlationId }, { status: 401 });
        }

        const expectedDigest = `sha256=${createHash("sha256").update(canonicalJson(parsed.data.payload)).digest("base64")}`;
        if (parsed.data.content_digest !== expectedDigest) {
          return Response.json({ error: "invalid_digest", correlationId }, { status: 400 });
        }
        if (!isWithinReplayWindow(parsed.data.sent_at)) {
          return Response.json({ error: "stale_event", correlationId }, { status: 400 });
        }

        const result = await ingestConnectorEvent(parsed.data, correlationId);
        const status = result.status === "unknown_store" ? 404 : result.status === "replayed_nonce" ? 409 : 200;
        return Response.json({ ...result, eventId: parsed.data.event_id, correlationId }, { status });
      }
      return Response.json({ error: "not_found", correlationId }, { status: 404 });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return Response.json({ error: "body_too_large", correlationId }, { status: 413, headers: { "cache-control": "no-store" } });
      }
      if (error instanceof InvalidRequestEncodingError) {
        return Response.json({ error: "invalid_body_encoding", correlationId }, { status: 400, headers: { "cache-control": "no-store" } });
      }
      if (error instanceof UnsupportedMediaTypeError) {
        return Response.json({ error: "unsupported_media_type", correlationId }, { status: 415, headers: { "cache-control": "no-store" } });
      }
      if (error instanceof InvalidCustomisationReferenceError) {
        return Response.json({ error: "invalid_customisation_reference", lineItemId: error.lineItemId, correlationId }, { status: 422 });
      }
      console.error("API request failed", { correlationId, error });
      return Response.json({ error: "internal_error", correlationId }, { status: 500 });
    }
}

const server = Bun.serve({
  port,
  async fetch(request, server) {
    const startedAt = performance.now();
    const route = apiRouteName(new URL(request.url).pathname);
    const method = normalizedHttpMethod(request.method);
    return withServerSpan("http.server.request", request.headers, {
      "http.request.method": method,
      "http.route": route
    }, async (span) => {
      const response = apiSecurityHeaders(await handleApiRequest(request, server.requestIP(request)?.address ?? "unknown"));
      span.setAttribute("http.response.status_code", response.status);
      if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
      const attributes = { route, method, status_class: `${Math.floor(response.status / 100)}xx` };
      addCounter("pk.api.requests", 1, attributes);
      recordHistogram("pk.api.request.duration", (performance.now() - startedAt) / 1000, attributes);
      return response;
    });
  }
});

async function shutdown() {
  await server.stop(false);
  await shutdownTelemetry().catch(() => undefined);
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

async function readJsonBody(request: Request, maximumBytes: number) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new UnsupportedMediaTypeError("Content-Type must be application/json");
  return readRequestText(request, maximumBytes);
}

function applyRateLimit(request: Request, url: URL, peerAddress: string, correlationId: string) {
  if (request.method === "OPTIONS" || url.pathname === "/health") return null;
  const objectRequest = url.pathname.startsWith("/objects/");
  const limit = objectRequest ? (request.method === "PUT" ? 30 : 600)
    : url.pathname === "/v1/connector/events" ? 300
      : url.pathname.includes("/uploads") ? 30
        : 120;
  const credential = request.headers.get("authorization")
    ?? request.headers.get("x-pk-key-id")
    ?? url.searchParams.get("signature")
    ?? "anonymous";
  const key = createHash("sha256").update(`${peerAddress}\n${url.pathname}\n${credential}`).digest("base64url");
  const result = consumeRateLimit(key, limit, 60_000);
  if (result.allowed) return null;
  return Response.json({ error: "rate_limited", correlationId }, {
    status: 429,
    headers: { "retry-after": String(result.retryAfterSeconds), "cache-control": "no-store" }
  });
}

function apiSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), accelerometer=(), gyroscope=(), magnetometer=()");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function parseJson(rawBody: string) {
  try { return JSON.parse(rawBody) as unknown; } catch { return null; }
}

function isWithinReplayWindow(sentAt: string) {
  const sentAtMs = Date.parse(sentAt);
  return Number.isFinite(sentAtMs) && Math.abs(Date.now() - sentAtMs) / 1000 <= replayWindowSeconds;
}

function preflightResponse() {
  return new Response(null, { status: 204 });
}

function customiserCors(response: Response, origin: string) {
  if (!origin || origin !== customiserOrigin()) return response;
  return cors(response, origin);
}

function objectCors(response: Response, origin: string) {
  if (!origin || !browserOrigins().has(origin)) return response;
  return cors(response, origin);
}

function browserOrigins() {
  const origins = new Set<string>();
  const customiser = customiserOrigin();
  if (customiser) origins.add(customiser);
  const webapp = process.env.PK_WEBAPP_URL
    ?? (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test" ? "http://localhost:3000" : null);
  if (webapp) {
    try { origins.add(new URL(webapp).origin); } catch { /* Invalid configuration is not trusted. */ }
  }
  return origins;
}

function cors(response: Response, origin: string) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Correlation-ID, X-PK-Customisation-Reference");
  headers.set("Access-Control-Max-Age", "600");
  const vary = headers.get("Vary");
  headers.set("Vary", vary ? `${vary}, Origin` : "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

console.log(`PersonaliseKings API listening on http://localhost:${port}`);
