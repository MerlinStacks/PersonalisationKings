import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readBoundedText } from "./api";

describe("readBoundedText", () => {
  it("counts UTF-8 bytes and accepts the exact limit", async () => {
    await expect(readBoundedText(new Request("https://admin.example", { method: "POST", body: "éé" }), 4)).resolves.toBe("éé");
  });

  it("rejects an oversized stream", async () => {
    const request = new Request("https://admin.example", { method: "POST", body: "12345" });
    await expect(readBoundedText(request, 4)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
