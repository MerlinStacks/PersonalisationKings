import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { ZodError, type ZodSchema } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function created<T>(data: T) {
  return ok(data, { status: 201 });
}

export function badRequest(message: string, details?: unknown) {
  return ok({ error: "bad_request", message, details }, { status: 400 });
}

export function notFound(message = "Resource not found") {
  return ok({ error: "not_found", message }, { status: 404 });
}

export async function parseJson<T>(request: Request, schema: ZodSchema<T>) {
  try {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") return { data: null, error: ok({ error: "unsupported_media_type", message: "Content-Type must be application/json" }, { status: 415 }) } as const;
    const body = JSON.parse(await readBoundedText(request, 1024 * 1024)) as unknown;
    return { data: schema.parse(body), error: null } as const;
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return { data: null, error: ok({ error: "body_too_large", message: "Request body is too large" }, { status: 413 }) } as const;
    }
    if (error instanceof ZodError) {
      return { data: null, error: badRequest("Invalid request body", error.flatten()) } as const;
    }

    return { data: null, error: badRequest("Invalid JSON") } as const;
  }
}

export class BodyTooLargeError extends Error {}

export async function readBoundedText(request: Request, maximumBytes: number) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
    throw new BodyTooLargeError("Request body is too large");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("Request body is too large");
        throw new BodyTooLargeError("Request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
