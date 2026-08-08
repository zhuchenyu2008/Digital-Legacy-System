import { createHash, randomUUID } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";

import type {
  ByteRange,
  ObjectMetadata,
  ObjectNamespace,
  ObjectStoragePort,
} from "@dls/application";

import { assertObjectKey } from "../object-key.js";
import { type BodyDigest, digestAsyncIterable } from "./multipart-upload.js";

export type S3StorageConfig = Readonly<{
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
  credentials: Readonly<{
    accessKeyId: string;
    secretAccessKey: string;
  }>;
  privateBucket: string;
  publicBucket: string;
  stagingBucket?: string;
}>;

type S3Location = Readonly<{ bucket: string; key: string }>;
type InspectedObject = Readonly<{
  metadata: ObjectMetadata;
  s3Etag?: string;
}>;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MULTIPART_PART_BYTES = 8 * 1024 * 1024;

function assertConfig(config: S3StorageConfig): void {
  if (config.endpoint.length === 0 || !/^https?:\/\//u.test(config.endpoint)) {
    throw new Error("S3 endpoint must be an http(s) URL");
  }
  if (config.region.length === 0) throw new Error("S3 region is required");
  if (
    config.credentials.accessKeyId.length === 0 ||
    config.credentials.secretAccessKey.length === 0
  ) {
    throw new Error("S3 credentials are required");
  }
  if (config.privateBucket.length === 0 || config.publicBucket.length === 0) {
    throw new Error("S3 private and public buckets are required");
  }
}

function assertDigest(value: string): void {
  if (!SHA256_PATTERN.test(value))
    throw new Error("expectedSha256 must be a lowercase SHA-256 hex digest");
}

function isMissing(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function objectBody(value: unknown): AsyncIterable<Uint8Array> {
  if (value === null || typeof value !== "object" || !(Symbol.asyncIterator in value)) {
    throw new Error("S3 response did not contain a readable body");
  }
  return value as AsyncIterable<Uint8Array>;
}

export class S3Storage implements ObjectStoragePort {
  private readonly config: S3StorageConfig;
  private readonly client: S3Client;

  constructor(config: S3StorageConfig, client?: S3Client) {
    assertConfig(config);
    this.config = Object.freeze({
      ...config,
      credentials: Object.freeze({ ...config.credentials }),
    });
    this.client =
      client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: config.credentials,
      });
  }

  private location(namespace: ObjectNamespace, key: string): S3Location {
    assertObjectKey(key);
    if (namespace === "public") return { bucket: this.config.publicBucket, key };
    return {
      bucket: this.config.stagingBucket ?? this.config.privateBucket,
      key: namespace === "staging" ? `__staging__/${key}` : key,
    };
  }

  private async inspectLocation(location: S3Location): Promise<InspectedObject | null> {
    try {
      const output = await this.client.send(
        new HeadObjectCommand({ Bucket: location.bucket, Key: location.key }),
      );
      const sha256 = output.Metadata?.sha256;
      const bytes = output.ContentLength;
      if (sha256 === undefined || !SHA256_PATTERN.test(sha256) || bytes === undefined) {
        throw new Error("S3 object is missing verified sha256 metadata");
      }
      // S3 ETag is provider-specific (and is commonly an MD5 for single-part uploads),
      // so the port exposes the verified SHA-256 as its stable content identifier.
      return {
        metadata: { bytes, sha256, etag: sha256 },
        ...(output.ETag === undefined ? {} : { s3Etag: output.ETag }),
      };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async headLocation(location: S3Location): Promise<ObjectMetadata | null> {
    return (await this.inspectLocation(location))?.metadata ?? null;
  }

  private async uploadToTemporaryObject(
    location: S3Location,
    body: AsyncIterable<Uint8Array>,
    expectedBytes?: number,
  ): Promise<{ location: S3Location; digest: BodyDigest }> {
    const temporary = {
      bucket: location.bucket,
      key: `__multipart__/${randomUUID()}`,
    } satisfies S3Location;
    let uploadId: string | undefined;
    try {
      const started = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: temporary.bucket,
          Key: temporary.key,
        }),
      );
      if (started.UploadId === undefined)
        throw new Error("S3 did not return a multipart upload id");
      uploadId = started.UploadId;

      const hash = createHash("sha256");
      let bytes = 0;
      let partNumber = 1;
      let buffered = 0;
      const buffers: Uint8Array[] = [];
      const parts: { PartNumber: number; ETag: string }[] = [];

      const flush = async (): Promise<void> => {
        if (buffered === 0) return;
        const part = Buffer.concat(buffers, buffered);
        const uploaded = await this.client.send(
          new UploadPartCommand({
            Bucket: temporary.bucket,
            Key: temporary.key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: part,
            ContentLength: part.length,
          }),
        );
        if (uploaded.ETag === undefined) throw new Error("S3 did not return a multipart part ETag");
        parts.push({ PartNumber: partNumber, ETag: uploaded.ETag });
        partNumber += 1;
        buffers.length = 0;
        buffered = 0;
      };

      for await (const chunk of body) {
        if (!(chunk instanceof Uint8Array))
          throw new TypeError("object body chunks must be Uint8Array");
        let offset = 0;
        while (offset < chunk.length) {
          const take = Math.min(MULTIPART_PART_BYTES - buffered, chunk.length - offset);
          const segment = chunk.subarray(offset, offset + take);
          hash.update(segment);
          bytes += segment.length;
          if (expectedBytes !== undefined && bytes > expectedBytes) {
            throw new Error("object body exceeds expectedBytes");
          }
          buffers.push(segment);
          buffered += segment.length;
          offset += take;
          if (buffered === MULTIPART_PART_BYTES) await flush();
        }
      }
      if (expectedBytes !== undefined && bytes !== expectedBytes) {
        throw new Error("object body does not match expectedBytes");
      }
      const digest = { bytes, sha256: hash.digest("hex") } satisfies BodyDigest;

      if (bytes === 0) {
        await this.client.send(
          new AbortMultipartUploadCommand({
            Bucket: temporary.bucket,
            Key: temporary.key,
            UploadId: uploadId,
          }),
        );
        uploadId = undefined;
        await this.client.send(
          new PutObjectCommand({
            Bucket: temporary.bucket,
            Key: temporary.key,
            Body: new Uint8Array(0),
            ContentLength: 0,
          }),
        );
        return { location: temporary, digest };
      }

      await flush();
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: temporary.bucket,
          Key: temporary.key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
      uploadId = undefined;
      return { location: temporary, digest };
    } catch (error) {
      if (uploadId !== undefined) {
        await this.client
          .send(
            new AbortMultipartUploadCommand({
              Bucket: temporary.bucket,
              Key: temporary.key,
              UploadId: uploadId,
            }),
          )
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async put(input: {
    namespace: ObjectNamespace;
    key: string;
    body: AsyncIterable<Uint8Array>;
    expectedBytes?: number;
    expectedSha256?: string;
  }): Promise<ObjectMetadata> {
    if (
      input.expectedBytes !== undefined &&
      (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes < 0)
    ) {
      throw new Error("expectedBytes must be a non-negative safe integer");
    }
    if (input.expectedSha256 !== undefined) assertDigest(input.expectedSha256);
    const location = this.location(input.namespace, input.key);
    const existing = await this.headLocation(location);
    if (existing !== null) {
      const incoming = await digestAsyncIterable(input.body, input.expectedBytes);
      if (
        existing.bytes === incoming.bytes &&
        existing.sha256 === incoming.sha256 &&
        (input.expectedSha256 === undefined || input.expectedSha256 === incoming.sha256)
      ) {
        return existing;
      }
      throw new Error("destination object already exists with a different digest");
    }

    const uploaded = await this.uploadToTemporaryObject(location, input.body, input.expectedBytes);
    try {
      if (input.expectedSha256 !== undefined && input.expectedSha256 !== uploaded.digest.sha256) {
        throw new Error("object body does not match expectedSha256");
      }
      await this.client.send(
        new CopyObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
          CopySource: encodeURIComponent(`${uploaded.location.bucket}/${uploaded.location.key}`),
          IfNoneMatch: "*",
          MetadataDirective: "REPLACE",
          Metadata: { sha256: uploaded.digest.sha256 },
        }),
      );
      const result = await this.headLocation(location);
      if (
        result === null ||
        result.bytes !== uploaded.digest.bytes ||
        result.sha256 !== uploaded.digest.sha256
      ) {
        throw new Error("S3 object failed post-upload verification");
      }
      return result;
    } catch (error) {
      const existing = await this.headLocation(location).catch(() => null);
      if (
        existing !== null &&
        existing.bytes === uploaded.digest.bytes &&
        existing.sha256 === uploaded.digest.sha256
      ) {
        return existing;
      }
      throw error;
    } finally {
      await this.client
        .send(
          new DeleteObjectCommand({
            Bucket: uploaded.location.bucket,
            Key: uploaded.location.key,
          }),
        )
        .catch(() => undefined);
    }
  }

  async head(namespace: ObjectNamespace, key: string): Promise<ObjectMetadata | null> {
    return this.headLocation(this.location(namespace, key));
  }

  async read(
    namespace: ObjectNamespace,
    key: string,
    range?: ByteRange,
  ): Promise<{
    body: AsyncIterable<Uint8Array>;
    bytes: number;
    totalBytes: number;
    etag: string;
  }> {
    const location = this.location(namespace, key);
    const metadata = await this.headLocation(location);
    if (metadata === null) throw new Error("object not found");
    if (
      range !== undefined &&
      (!Number.isSafeInteger(range.start) ||
        range.start < 0 ||
        range.start >= metadata.bytes ||
        (range.endInclusive !== undefined &&
          (!Number.isSafeInteger(range.endInclusive) ||
            range.endInclusive < range.start ||
            range.endInclusive >= metadata.bytes)))
    ) {
      throw new Error("invalid object byte range");
    }
    const end = range?.endInclusive ?? (range === undefined ? undefined : metadata.bytes - 1);
    const rangeHeader = range === undefined ? undefined : `bytes=${range.start}-${end}`;
    const output = await this.client.send(
      new GetObjectCommand({ Bucket: location.bucket, Key: location.key, Range: rangeHeader }),
    );
    const body = objectBody(output.Body);
    return {
      body,
      bytes: range === undefined ? metadata.bytes : (end ?? 0) - range.start + 1,
      totalBytes: metadata.bytes,
      etag: metadata.etag,
    };
  }

  async promote(input: {
    from: "staging";
    to: "private" | "public";
    sourceKey: string;
    destinationKey: string;
    expectedSha256: string;
  }): Promise<void> {
    assertDigest(input.expectedSha256);
    const source = this.location("staging", input.sourceKey);
    const destination = this.location(input.to, input.destinationKey);
    const sourceObject = await this.inspectLocation(source);
    if (sourceObject === null) throw new Error("staging source object not found");
    const sourceMetadata = sourceObject.metadata;
    if (sourceMetadata.sha256 !== input.expectedSha256)
      throw new Error("staging source digest mismatch");
    const existing = await this.headLocation(destination);
    if (existing !== null) {
      if (existing.sha256 !== input.expectedSha256 || existing.bytes !== sourceMetadata.bytes) {
        throw new Error("destination object already exists with a different digest");
      }
      await this.delete("staging", input.sourceKey);
      return;
    }
    await this.client.send(
      new CopyObjectCommand({
        Bucket: destination.bucket,
        Key: destination.key,
        CopySource: encodeURIComponent(`${source.bucket}/${source.key}`),
        CopySourceIfMatch: sourceObject.s3Etag,
        IfNoneMatch: "*",
        MetadataDirective: "REPLACE",
        Metadata: { sha256: input.expectedSha256 },
      }),
    );
    const copied = await this.headLocation(destination);
    if (
      copied === null ||
      copied.bytes !== sourceMetadata.bytes ||
      copied.sha256 !== input.expectedSha256
    ) {
      throw new Error("promoted S3 object failed verification");
    }
    await this.delete("staging", input.sourceKey);
  }

  async delete(namespace: "private" | "staging", key: string): Promise<void> {
    const location = this.location(namespace, key);
    await this.client.send(new DeleteObjectCommand({ Bucket: location.bucket, Key: location.key }));
  }
}
