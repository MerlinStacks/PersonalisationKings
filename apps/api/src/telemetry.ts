export function apiRouteName(pathname: string) {
  if (pathname === "/health") return "/health";
  if (pathname.startsWith("/objects/")) return "/objects/:key";
  if (/^\/v1\/customiser\/uploads\/[^/]+\/promote$/.test(pathname)) return "/v1/customiser/uploads/:id/promote";
  if ([
    "/v1/customiser/config",
    "/v1/customiser/commit",
    "/v1/customiser/uploads",
    "/v1/customiser/embed-token",
    "/v1/customiser/mapping-lookup",
    "/v1/connector/events"
  ].includes(pathname)) return pathname;
  return "unmatched";
}

export function normalizedHttpMethod(method: string) {
  const normalized = method.toUpperCase();
  return ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH", "CONNECT", "TRACE"].includes(normalized) ? normalized : "_OTHER";
}
