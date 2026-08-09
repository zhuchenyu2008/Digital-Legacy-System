import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parseSingleByteRange } from "./public.controller.js";

describe("public legacy download range", () => {
  it("accepts only one bounded or open-ended explicit byte range", () => {
    expect(parseSingleByteRange(undefined)).toBeUndefined();
    expect(parseSingleByteRange("bytes=0-99")).toEqual({ start: 0, endInclusive: 99 });
    expect(parseSingleByteRange("bytes=100-")).toEqual({ start: 100 });
  });

  it.each(["bytes=-20", "bytes=2-1", "bytes=0-1,4-5", "items=0-1"])(
    "rejects unsupported range %s",
    (value) => {
      expect(() => parseSingleByteRange(value)).toThrow(HttpException);
    },
  );
});
