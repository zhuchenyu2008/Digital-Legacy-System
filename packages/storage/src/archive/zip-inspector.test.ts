import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";

import { readAll } from "../testing/storage-contract.js";
import { renderWill } from "./render-will.js";
import { bytes, createZip } from "./test-zip.js";
import { inspectZip, ZipPolicyError } from "./zip-inspector.js";

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function findSignature(value: Uint8Array, signature: readonly number[], from = 0): number {
  for (let index = from; index <= value.length - signature.length; index += 1) {
    if (signature.every((byte, offset) => value[index + offset] === byte)) return index;
  }
  return -1;
}

function setU32(value: Uint8Array, offset: number, number: number): void {
  new DataView(value.buffer, value.byteOffset, value.byteLength).setUint32(offset, number, true);
}

describe("hostile ZIP inspection", () => {
  it("returns metadata and streams only the root will.md", async () => {
    const will = bytes("# My will\n\nKeep this safe.\n");
    const archive = createZip([
      { name: "will.md", body: will, method: 8 },
      { name: "attachments/", body: new Uint8Array(0) },
      { name: "attachments/opaque.zip", body: bytes("PK\x03\x04") },
    ]);

    const inspected = await inspectZip(archive);

    assert.equal(inspected.archiveBytes, archive.length);
    assert.deepEqual(
      inspected.entries.map((entry) => entry.path),
      ["will.md", "attachments/", "attachments/opaque.zip"],
    );
    const streamedWill = await readAll(inspected.will.body);
    assert.deepEqual(streamedWill, will);
    assert.equal(inspected.will.bytes, will.length);
    assert.equal(inspected.will.sha256, sha256(will));
  });

  it("rejects missing, duplicate, case-mismatched, and non-root will files", async () => {
    await assert.rejects(inspectZip(createZip([{ name: "README.md", body: bytes("x") }])), /will/i);
    await assert.rejects(
      inspectZip(
        createZip([
          { name: "will.md", body: bytes("a") },
          { name: "will.md", body: bytes("b") },
        ]),
      ),
      /duplicate|collision/i,
    );
    await assert.rejects(inspectZip(createZip([{ name: "Will.md", body: bytes("x") }])), /will/i);
    await assert.rejects(
      inspectZip(createZip([{ name: "nested/will.md", body: bytes("x") }])),
      /will|root/i,
    );
  });

  it("rejects traversal, aliases, device names, symlinks, encryption, and unsafe ratios", async () => {
    const cases = [
      { name: "../will.md" },
      { name: "/will.md" },
      { name: "\\\\server\\share\\will.md" },
      { name: "CON/will.md" },
      { name: "will.md", flags: 1 },
      { name: "will.md", versionMadeBy: 0x0314, externalFileAttributes: 0xa0000000 },
    ];
    for (const entry of cases) {
      await assert.rejects(inspectZip(createZip([{ ...entry, body: bytes("x") }])), ZipPolicyError);
    }
    await assert.rejects(
      inspectZip(createZip([{ name: "will.md", body: bytes("a".repeat(1_024)), method: 8 }]), {
        maxCompressionRatio: 0.5,
      }),
      /ratio/i,
    );
  });

  it("enforces entry, archive, total, will, and UTF-8 limits", async () => {
    await assert.rejects(
      inspectZip(createZip([{ name: "will.md", body: bytes("ok") }]), { maxEntries: 0 }),
      /entr/i,
    );
    await assert.rejects(
      inspectZip(createZip([{ name: "will.md", body: bytes("ok") }]), { maxArchiveBytes: 1 }),
      /archive/i,
    );
    await assert.rejects(
      inspectZip(createZip([{ name: "will.md", body: bytes("ok") }]), { maxUncompressedBytes: 1 }),
      /budget|uncompressed/i,
    );
    await assert.rejects(
      inspectZip(createZip([{ name: "will.md", body: bytes("ok") }]), { maxWillBytes: 1 }),
      /will/i,
    );
    await assert.rejects(
      inspectZip(
        createZip([
          {
            name: "will.md",
            rawName: Uint8Array.from([0xff, 0xfe]),
            flags: 0x800,
            body: bytes("x"),
          },
        ]),
      ),
      /UTF|filename/i,
    );
  });

  it("rejects normalization/case collisions, local-header mismatches, overlaps, and ZIP64 anomalies", async () => {
    const decomposed = `${String.fromCharCode(0x65, 0x301)}.txt`;
    const composed = `${String.fromCharCode(0xe9)}.txt`;
    await assert.rejects(
      inspectZip(
        createZip([
          { name: "will.md", body: bytes("x") },
          { name: decomposed, flags: 0x800, body: bytes("a") },
          { name: composed, flags: 0x800, body: bytes("b") },
        ]),
      ),
      /duplicate|collision/i,
    );
    await assert.doesNotReject(
      inspectZip(
        createZip([
          { name: "will.md", body: bytes("x") },
          { name: "e\u0301.txt", body: bytes("a") },
          { name: "é.txt", body: bytes("b") },
        ]),
      ),
      /collision/i,
    );
    await assert.rejects(
      inspectZip(
        createZip([
          { name: "will.md", body: bytes("x") },
          { name: "Will.md", body: bytes("y") },
        ]),
      ),
      /case-colliding|collision/i,
    );

    const mismatched = createZip([{ name: "will.md", body: bytes("x") }]);
    const central = findSignature(mismatched, [0x50, 0x4b, 0x01, 0x02]);
    assert.notEqual(central, -1);
    setU32(mismatched, central + 20, 2);
    await assert.rejects(inspectZip(mismatched), /header|ZIP/i);

    const overlap = createZip([
      { name: "payload.bin", body: bytes("x") },
      { name: "will.md", body: bytes("ok") },
    ]);
    const firstCentral = findSignature(overlap, [0x50, 0x4b, 0x01, 0x02]);
    assert.notEqual(firstCentral, -1);
    const firstLocal = findSignature(overlap, [0x50, 0x4b, 0x03, 0x04]);
    assert.notEqual(firstLocal, -1);
    setU32(overlap, firstCentral + 20, 64);
    setU32(overlap, firstLocal + 18, 64);
    await assert.rejects(inspectZip(overlap), /overlap|range|ZIP/i);

    const zip64 = createZip([{ name: "will.md", body: bytes("x") }]);
    const zip64Central = findSignature(zip64, [0x50, 0x4b, 0x01, 0x02]);
    assert.notEqual(zip64Central, -1);
    setU32(zip64, zip64Central + 24, 0xffffffff);
    await assert.rejects(inspectZip(zip64), ZipPolicyError);
  });

  it("stops before processing the 10,001st entry", async () => {
    const entries = Array.from({ length: 10_001 }, (_, index) => ({
      name: index === 0 ? "will.md" : `files/${index}.txt`,
      body: new Uint8Array(0),
    }));
    await assert.rejects(inspectZip(createZip(entries)), /entries/i);
  });

  it("renders a narrow safe Markdown subset with safe links", async () => {
    const rendered = renderWill(
      "# Title\n\n<script>alert(1)</script>\n\n[good](https://example.com) [bad](javascript:alert(1))",
    );
    assert.match(rendered.html, /<h1[^>]*>Title<\/h1>/);
    assert.match(rendered.html, /href="https:\/\/example\.com"/);
    assert.match(rendered.html, /rel="noopener noreferrer"/);
    assert.doesNotMatch(rendered.html, /<script|javascript:/i);
    assert.equal(
      rendered.sourceBytes,
      Buffer.byteLength(
        "# Title\n\n<script>alert(1)</script>\n\n[good](https://example.com) [bad](javascript:alert(1))",
      ),
    );
  });
});
