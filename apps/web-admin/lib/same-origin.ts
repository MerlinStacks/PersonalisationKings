import { ok } from "./api";

export function isSameOrigin(requestUrl: string, origin: string | null) {
  if (!origin) return false;

  try {
    const configuredOrigin = process.env.PK_WEBAPP_URL
      ? new URL(process.env.PK_WEBAPP_URL).origin
      : new URL(requestUrl).origin;
    return new URL(origin).origin === configuredOrigin;
  } catch {
    return false;
  }
}

export function requireSameOrigin(request: Request) {
  return isSameOrigin(request.url, request.headers.get("origin"))
    ? null
    : ok({ error: "forbidden", message: "Cross-origin request rejected" }, { status: 403 });
}
