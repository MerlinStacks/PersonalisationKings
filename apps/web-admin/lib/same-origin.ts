import { ok } from "./api";

export function isSameOrigin(requestUrl: string, origin: string | null) {
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

export function requireSameOrigin(request: Request) {
  return isSameOrigin(request.url, request.headers.get("origin"))
    ? null
    : ok({ error: "forbidden", message: "Cross-origin request rejected" }, { status: 403 });
}
