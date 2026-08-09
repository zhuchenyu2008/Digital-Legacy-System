import { describe, expect, test } from "vitest";
import { writeCiphertextChunk } from "./opfs-ciphertext-store";

describe("bounded ciphertext writes", () => {
  test("awaits each sink write and clears both owned and source buffers", async () => {
    let release: (() => void) | undefined;
    const written: Uint8Array[] = [];
    const source = new Uint8Array([1, 2, 3, 4]);
    let finished = false;
    const pending = writeCiphertextChunk(
      {
        write: async (chunk) => {
          written.push(chunk);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      },
      source,
    ).then(() => {
      finished = true;
    });

    await Promise.resolve();
    expect(finished).toBe(false);
    const [firstWrite] = written;
    expect(firstWrite).toBeDefined();
    if (firstWrite === undefined) throw new Error("ciphertext sink did not receive a chunk");
    expect([...firstWrite]).toEqual([1, 2, 3, 4]);
    release?.();
    await pending;
    expect([...source]).toEqual([0, 0, 0, 0]);
    expect([...firstWrite]).toEqual([0, 0, 0, 0]);
  });
});
