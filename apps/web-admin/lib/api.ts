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
    const body = await request.json();
    return { data: schema.parse(body), error: null } as const;
  } catch (error) {
    if (error instanceof ZodError) {
      return { data: null, error: badRequest("Invalid request body", error.flatten()) } as const;
    }

    return { data: null, error: badRequest("Invalid JSON") } as const;
  }
}

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
