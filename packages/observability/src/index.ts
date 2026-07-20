import { randomUUID } from "node:crypto";

export const CORRELATION_ID_HEADER = "x-correlation-id";

export function getOrCreateCorrelationId(headers?: Headers) {
  return headers?.get(CORRELATION_ID_HEADER) ?? randomUUID();
}

export function withCorrelationHeaders(correlationId: string) {
  return { [CORRELATION_ID_HEADER]: correlationId };
}
