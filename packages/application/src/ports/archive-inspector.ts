export type ArchivePolicy = Readonly<{
  maxArchiveBytes: number;
  maxEntries: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
  maxWillBytes: number;
}>;

export type ArchiveEntryMetadata = Readonly<{
  path: string;
  bytes: number;
  compressedBytes: number;
  directory: boolean;
  encrypted: boolean;
  symlink: boolean;
}>;

export type ArchiveInspection = Readonly<{
  archiveBytes: number;
  entries: readonly ArchiveEntryMetadata[];
  will: Readonly<{
    path: "will.md";
    bytes: number;
    sha256: string;
    body: AsyncIterable<Uint8Array>;
  }>;
}>;

export interface ArchiveInspectorPort {
  inspect(
    archive: Uint8Array | AsyncIterable<Uint8Array>,
    policy?: Partial<ArchivePolicy>,
  ): Promise<ArchiveInspection>;
}
