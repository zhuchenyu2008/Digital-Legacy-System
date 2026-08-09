import { describe, expect, test } from "vitest";
import { apiDataFromBody } from "./server-client";

describe("server API response decoding", () => {
  test("accepts both envelope-style and direct controller responses", () => {
    expect(apiDataFromBody<{ value: number }>({ data: { value: 1 }, requestId: "r1" })).toEqual({
      value: 1,
    });
    expect(apiDataFromBody<{ value: number }>({ value: 2 })).toEqual({ value: 2 });
    expect(apiDataFromBody<null>(null)).toBeNull();
  });
});
