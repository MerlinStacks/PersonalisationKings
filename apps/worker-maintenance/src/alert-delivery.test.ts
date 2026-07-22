import { describe, expect, it } from "vitest";
import { isPermanentWebhookStatus, isPublicIpAddress, operationalWebhookConfig, signOperationalAlert } from "./alert-delivery";

describe("operational alert webhook configuration", () => {
  it("is disabled only when both values are absent", () => {
    expect(operationalWebhookConfig({}, true)).toBeNull();
    expect(() => operationalWebhookConfig({ PK_OPERATIONS_ALERT_WEBHOOK_URL: "https://alerts.example.com" }, true)).toThrow();
  });

  it("rejects private and reserved resolved addresses", () => {
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("203.0.113.1")).toBe(false);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIpAddress("fc00::1")).toBe(false);
  });

  it("retries temporary responses and terminates permanent client errors", () => {
    expect(isPermanentWebhookStatus(400)).toBe(true);
    expect(isPermanentWebhookStatus(401)).toBe(true);
    expect(isPermanentWebhookStatus(408)).toBe(false);
    expect(isPermanentWebhookStatus(429)).toBe(false);
    expect(isPermanentWebhookStatus(503)).toBe(false);
  });

  it("requires a public default-port HTTPS URL in production", () => {
    const secret = "s".repeat(32);
    expect(operationalWebhookConfig({ PK_OPERATIONS_ALERT_WEBHOOK_URL: "https://alerts.example.com/hook", PK_OPERATIONS_ALERT_WEBHOOK_SECRET: secret }, true)?.url.hostname).toBe("alerts.example.com");
    expect(() => operationalWebhookConfig({ PK_OPERATIONS_ALERT_WEBHOOK_URL: "http://alerts.example.com", PK_OPERATIONS_ALERT_WEBHOOK_SECRET: secret }, true)).toThrow();
    expect(() => operationalWebhookConfig({ PK_OPERATIONS_ALERT_WEBHOOK_URL: "https://127.0.0.1/hook", PK_OPERATIONS_ALERT_WEBHOOK_SECRET: secret }, true)).toThrow();
    expect(() => operationalWebhookConfig({ PK_OPERATIONS_ALERT_WEBHOOK_URL: "https://alerts.example.com:8443/hook", PK_OPERATIONS_ALERT_WEBHOOK_SECRET: secret }, true)).toThrow();
  });

  it("creates deterministic body-bound signatures", () => {
    const secret = "s".repeat(32);
    const context = { timestamp: 1_721_563_200, idempotencyKey: "alert:1:webhook", deliveryId: "delivery-1" };
    expect(signOperationalAlert('{"status":"open"}', secret, context)).toBe(signOperationalAlert('{"status":"open"}', secret, context));
    expect(signOperationalAlert('{"status":"open"}', secret, context)).not.toBe(signOperationalAlert('{"status":"resolved"}', secret, context));
    expect(signOperationalAlert("body", secret, context)).not.toBe(signOperationalAlert("body", secret, { ...context, deliveryId: "delivery-2" }));
    expect(signOperationalAlert("body", secret, context)).toMatch(/^sha256=[A-Za-z0-9_-]{43}$/);
  });
});
