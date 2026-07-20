import { createHash } from "node:crypto";
import { connectorEventEnvelopeSchema } from "@personalise-kings/connector-contracts";
import { getOrCreateCorrelationId } from "@personalise-kings/observability";
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

const port = Number(process.env.PORT ?? 3002);
const replayWindowSeconds = Number(process.env.PK_CONNECTOR_REPLAY_WINDOW_SECONDS ?? 300);

Bun.serve({
  port,
  async fetch(request: Request) {
    const url = new URL(request.url);
    const correlationId = getOrCreateCorrelationId(request.headers);
    try {
      if (url.pathname === "/health") return Response.json({ ok: true, service: "personalise-kings-api", correlationId });
      if (url.pathname.startsWith("/objects/") && request.method === "OPTIONS") {
        return objectCors(preflightResponse(), request.headers.get("origin") ?? "");
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
        return customiserCors(await handleCustomiserCommit(request, correlationId), origin);
      }
      if (url.pathname === "/v1/customiser/uploads" && request.method === "POST") {
        const origin = request.headers.get("origin") ?? "";
        return customiserCors(await handleCreateCustomiserUpload(request, correlationId), origin);
      }
      const uploadPromotion = /^\/v1\/customiser\/uploads\/([^/]+)\/promote$/.exec(url.pathname);
      if (uploadPromotion && request.method === "POST") {
        const origin = request.headers.get("origin") ?? "";
        return customiserCors(await handlePromoteCustomiserUpload(request, uploadPromotion[1], correlationId), origin);
      }
      if (url.pathname === "/v1/customiser/embed-token" && request.method === "POST") {
        const rawBody = await request.text();
        return handleCreateEmbedToken(request, rawBody, correlationId);
      }
      if (url.pathname === "/v1/customiser/mapping-lookup" && request.method === "POST") {
        const rawBody = await request.text();
        return handleMappingLookup(request, rawBody, correlationId);
      }
      if (url.pathname === "/v1/connector/events" && request.method === "POST") {
        const rawBody = await request.text();
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
      if (error instanceof InvalidCustomisationReferenceError) {
        return Response.json({ error: "invalid_customisation_reference", lineItemId: error.lineItemId, correlationId }, { status: 422 });
      }
      console.error("API request failed", { correlationId, error });
      return Response.json({ error: "internal_error", correlationId }, { status: 500 });
    }
  }
});

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
  const webapp = process.env.PK_WEBAPP_URL ?? (process.env.NODE_ENV === "production" ? null : "http://localhost:3000");
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
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

console.log(`PersonaliseKings API listening on http://localhost:${port}`);
