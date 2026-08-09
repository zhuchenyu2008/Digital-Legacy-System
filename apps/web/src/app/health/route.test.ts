import { describe, expect, test } from "vitest";
import { GET } from "./route";

describe("GET /health", () => {
  test("reports only the Next.js process health", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "web",
    });
  });
});
