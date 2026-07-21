import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const apiOrigin = configuredApiOrigin();
  const parentOrigin = allowedParentOrigin(request.nextUrl.searchParams.get("parent_origin"));
  const developmentEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    `frame-ancestors ${parentOrigin ?? "'none'"}`,
    "form-action 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentEval}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${apiOrigin}`,
    `font-src 'self' data: ${apiOrigin}`,
    `connect-src 'self' ${apiOrigin}`,
    "manifest-src 'self'",
    "sandbox allow-scripts allow-same-origin"
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("permissions-policy", permissionsPolicy());
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export function allowedParentOrigin(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password) return null;
    if (url.protocol === "https:") return url.origin;
    if (process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

function configuredApiOrigin() {
  const configured = process.env.PK_API_URL ?? (process.env.NODE_ENV === "production" ? null : "http://localhost:3002");
  if (!configured) return "'none'";
  try { return new URL(configured).origin; } catch { return "'none'"; }
}

function permissionsPolicy() {
  return "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), browsing-topics=()";
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
