export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { validateServiceEnvironment } = await import("@personalise-kings/config/server");
  validateServiceEnvironment("customiser");
}
