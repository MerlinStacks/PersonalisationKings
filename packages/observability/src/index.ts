import { randomUUID } from "node:crypto";

export const CORRELATION_ID_HEADER = "x-correlation-id";

export function getOrCreateCorrelationId(headers?: Headers) {
  const supplied = headers?.get(CORRELATION_ID_HEADER);
  return supplied && /^[\x21-\x7e]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

export function withCorrelationHeaders(correlationId: string) {
  return { [CORRELATION_ID_HEADER]: correlationId };
}

export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown> = {}
) {
  const entry = JSON.stringify({
    ...sanitizeFields(fields),
    timestamp: new Date().toISOString(),
    level,
    event: printable(event, 100)
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { name: "Error", message: printable(String(error), 1000) };
  return {
    name: printable(error.name, 100),
    message: printable(error.message, 1000),
    stack: error.stack ? printable(error.stack, 4000) : undefined
  };
}

function sanitizeFields(fields: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(fields).slice(0, 50).map(([key, value]) => [printable(key, 100), sanitizeValue(value)]));
}

function sanitizeValue(value: unknown): unknown {
  if (value instanceof Error) return serializeError(value);
  if (typeof value === "string") return printable(value, 2000);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue);
  if (value && typeof value === "object") return sanitizeFields(value as Record<string, unknown>);
  return undefined;
}

function printable(value: string, maximumLength: number) {
  return value.replace(/[^\x20-\x7e]/g, "?").slice(0, maximumLength);
}
