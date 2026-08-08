export type ObjectNamespace = "private" | "staging" | "public";

export type ByteRange = Readonly<{
  start: number;
  endInclusive?: number;
}>;

export type ObjectMetadata = Readonly<{
  bytes: number;
  sha256: string;
  etag: string;
}>;

export interface ObjectStoragePort {
  put(input: {
    namespace: ObjectNamespace;
    key: string;
    body: AsyncIterable<Uint8Array>;
    expectedBytes?: number;
    expectedSha256?: string;
  }): Promise<ObjectMetadata>;
  head(namespace: ObjectNamespace, key: string): Promise<ObjectMetadata | null>;
  read(
    namespace: ObjectNamespace,
    key: string,
    range?: ByteRange,
  ): Promise<{
    body: AsyncIterable<Uint8Array>;
    bytes: number;
    totalBytes: number;
    etag: string;
  }>;
  promote(input: {
    from: "staging";
    to: "private" | "public";
    sourceKey: string;
    destinationKey: string;
    expectedSha256: string;
  }): Promise<void>;
  delete(namespace: "private" | "staging", key: string): Promise<void>;
}
