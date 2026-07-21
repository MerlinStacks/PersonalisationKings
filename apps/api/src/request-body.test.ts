import { describe, expect, it } from "vitest";
import { InvalidRequestEncodingError, readRequestText, RequestBodyTooLargeError } from "./request-body";

describe("readRequestText", () => {
  it("accepts a body exactly at the byte limit", async () => {
    await expect(readRequestText(new Request("https://api.example", { method: "POST", body: "éé" }), 4)).resolves.toBe("éé");
  });

  it("rejects declared and streamed oversized bodies", async () => {
    const declared = new Request("https://api.example", { method: "POST", body: "small", headers: { "content-length": "100" } });
    await expect(readRequestText(declared, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    const streamed = new Request("https://api.example", { method: "POST", body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(11)); controller.close(); } }), duplex: "half" } as RequestInit);
    await expect(readRequestText(streamed, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("rejects malformed UTF-8", async () => {
    const request = new Request("https://api.example", { method: "POST", body: new Uint8Array([0xc3, 0x28]) });
    await expect(readRequestText(request, 10)).rejects.toBeInstanceOf(InvalidRequestEncodingError);
  });
});
