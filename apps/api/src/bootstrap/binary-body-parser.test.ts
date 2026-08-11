import { describe, expect, it } from "vitest";
import { registerBinaryBodyParser } from "./binary-body-parser.js";

describe("binary request body parser", () => {
  it("registers application/octet-stream as a streamed body", () => {
    const calls: unknown[] = [];
    const server = {
      addContentTypeParser: (...args: unknown[]) => {
        calls.push(args);
        return server;
      },
    };

    registerBinaryBodyParser(server as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("application/octet-stream");
    expect(typeof calls[0]?.[1]).toBe("function");
  });
});
