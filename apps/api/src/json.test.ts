import { describe, expect, it } from "vitest";
import { canonicalJson } from "./json";

describe("canonicalJson", () => {
  it("sorts every object by Unicode code point rather than locale or UTF-16 order", () => {
    expect(canonicalJson({ "\u{10000}": 3, z: { b: 2, a: 1 }, "\ue000": 2, a: 1 }))
      .toBe('{"a":1,"z":{"a":1,"b":2},"":2,"𐀀":3}');
  });

  it("uses JSON escaping for controls, quotes, and backslashes while preserving Unicode", () => {
    expect(canonicalJson({ value: "line\n\"quoted\"\\ café" }))
      .toBe('{"value":"line\\n\\"quoted\\"\\\\ café"}');
  });
});
