import { describe, expect, it } from "vitest";
import { parseSingleByteRange } from "../../apps/api/src/public/public.controller.js";

describe("publication authorization and download boundaries", () => {
  it("accepts one explicit range and rejects multi-range or suffix requests", () => {
    expect(parseSingleByteRange("bytes=0-99")).toEqual({ start: 0, endInclusive: 99 });
    expect(parseSingleByteRange("bytes=100-")).toEqual({ start: 100 });
    for (const value of ["bytes=-20", "bytes=2-1", "bytes=0-1,4-5", "items=0-1"]) {
      expect(() => parseSingleByteRange(value)).toThrow();
    }
  });
});
