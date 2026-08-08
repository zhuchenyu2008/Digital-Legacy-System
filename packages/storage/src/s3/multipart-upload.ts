import { createHash } from "node:crypto";
import type { PassThrough } from "node:stream";

export type MultipartUploadPart = Readonly<{
  partNumber: number;
  etag: string;
}>;

export type BodyDigest = Readonly<{
  bytes: number;
  sha256: string;
}>;

export async function digestAsyncIterable(
  body: AsyncIterable<Uint8Array>,
  expectedBytes?: number,
): Promise<BodyDigest> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array))
      throw new TypeError("object body chunks must be Uint8Array");
    bytes += chunk.length;
    if (expectedBytes !== undefined && bytes > expectedBytes) {
      throw new Error("object body exceeds expectedBytes");
    }
    hash.update(chunk);
  }
  if (expectedBytes !== undefined && bytes !== expectedBytes) {
    throw new Error("object body does not match expectedBytes");
  }
  return { bytes, sha256: hash.digest("hex") };
}

export async function pipeBodyToStream(
  body: AsyncIterable<Uint8Array>,
  output: PassThrough,
  expectedBytes?: number,
): Promise<BodyDigest> {
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const chunk of body) {
      if (!(chunk instanceof Uint8Array))
        throw new TypeError("object body chunks must be Uint8Array");
      bytes += chunk.length;
      if (expectedBytes !== undefined && bytes > expectedBytes) {
        throw new Error("object body exceeds expectedBytes");
      }
      hash.update(chunk);
      if (!output.write(chunk)) {
        await new Promise<void>((resolve, reject) => {
          output.once("drain", resolve);
          output.once("error", reject);
        });
      }
    }
    if (expectedBytes !== undefined && bytes !== expectedBytes) {
      throw new Error("object body does not match expectedBytes");
    }
    output.end();
    return { bytes, sha256: hash.digest("hex") };
  } catch (error) {
    output.destroy(error as Error);
    throw error;
  }
}
