export type CiphertextWriter = Readonly<{
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<File>;
  abort(): Promise<void>;
  cleanup(): Promise<void>;
}>;

type OpfsDirectory = Readonly<{
  getFileHandle(
    name: string,
    options: { create: true },
  ): Promise<{
    createWritable(): Promise<{
      write(data: Uint8Array): Promise<void>;
      close(): Promise<void>;
      abort(): Promise<void>;
    }>;
    getFile(): Promise<File>;
  }>;
  removeEntry(name: string): Promise<void>;
}>;

export async function writeCiphertextChunk(
  writable: Readonly<{ write(data: Uint8Array): Promise<void> }>,
  chunk: Uint8Array,
): Promise<void> {
  const owned = new Uint8Array(chunk);
  try {
    await writable.write(owned);
  } finally {
    owned.fill(0);
    chunk.fill(0);
  }
}

export async function createOpfsCiphertextStore(name: string): Promise<CiphertextWriter> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<OpfsDirectory>;
  };
  if (typeof storage.getDirectory !== "function") {
    throw new Error("当前浏览器不支持有界加密缓存，请使用最新版 Chromium 浏览器");
  }
  const directory = (await storage.getDirectory()) as unknown as OpfsDirectory;
  const handle = await directory.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  let closed = false;
  let removed = false;
  const cleanup = async () => {
    if (removed) return;
    removed = true;
    await directory.removeEntry(name).catch(() => undefined);
  };
  return {
    write: (chunk) => writeCiphertextChunk(writable, chunk),
    async close() {
      if (!closed) {
        await writable.close();
        closed = true;
      }
      return handle.getFile();
    },
    async abort() {
      if (!closed) {
        await writable.abort();
        closed = true;
      }
      await cleanup();
    },
    cleanup,
  };
}
