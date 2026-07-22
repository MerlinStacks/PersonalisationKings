export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    const { validateServiceEnvironment } = await import("@personalise-kings/config/server");
    validateServiceEnvironment("web-admin");
  }
  const { initializeTelemetry } = await import("@personalise-kings/observability/telemetry");
  await initializeTelemetry("personalise-kings-web-admin");
}
