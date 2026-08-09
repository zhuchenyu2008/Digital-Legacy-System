import { describe, expect, it } from "vitest";
import { assertObjectKey, buildObjectKey } from "./object-key.js";

describe("object key policy", () => {
  it("accepts segmented server UUIDs and immutable public digest keys", () => {
    const uuid = "12345678-1234-4234-8234-123456789abc";
    expect(assertObjectKey(buildObjectKey(uuid))).toBe(`12/34/${uuid}`);
    const digest = "ab".repeat(32);
    expect(assertObjectKey(`legacy/ab/${digest}.zip`)).toBe(`legacy/ab/${digest}.zip`);
  });

  it.each([
    `legacy/cd/${"ab".repeat(32)}.zip`,
    "legacy/ab/../../secret.zip",
    "legacy\\ab\\file.zip",
  ])("rejects unsafe or inconsistent content key %s", (key) => {
    expect(() => assertObjectKey(key)).toThrow();
  });
});
