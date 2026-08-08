import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";

import type { ObjectStoragePort } from "@dls/application";

export function chunks(values: readonly Uint8Array[]): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const value of values) yield new Uint8Array(value);
  })();
}

export async function readAll(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const values: Uint8Array[] = [];
  for await (const value of body) values.push(new Uint8Array(value));
  const size = values.reduce((total, value) => total + value.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function assertStorageContract(
  createStorage: () => Promise<ObjectStoragePort> | ObjectStoragePort,
): Promise<void> {
  const storage = await createStorage();
  const key = "55/0e/550e8400-e29b-41d4-a716-446655440000";
  const body = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const digest = sha256(body);
  const metadata = await storage.put({
    namespace: "staging",
    key,
    body: chunks([body.slice(0, 2), body.slice(2, 5), body.slice(5)]),
    expectedBytes: body.length,
    expectedSha256: digest,
  });
  assert.equal(metadata.bytes, body.length);
  assert.equal(metadata.sha256, digest);
  assert.equal(metadata.etag, digest);
  assert.deepEqual(await storage.head("staging", key), metadata);

  const emptyKey = "55/0e/550e8400-e29b-41d4-a716-446655440004";
  const empty = await storage.put({
    namespace: "private",
    key: emptyKey,
    body: chunks([]),
    expectedBytes: 0,
  });
  assert.equal(empty.bytes, 0);
  assert.deepEqual(
    await readAll((await storage.read("private", emptyKey)).body),
    new Uint8Array(0),
  );
  assert.equal(await storage.head("staging", emptyKey), null);

  const full = await storage.read("staging", key);
  assert.equal(full.bytes, body.length);
  assert.equal(full.totalBytes, body.length);
  assert.deepEqual(await readAll(full.body), body);
  const range = await storage.read("staging", key, { start: 2, endInclusive: 5 });
  assert.equal(range.bytes, 4);
  assert.deepEqual(await readAll(range.body), body.slice(2, 6));
  assert.deepEqual(
    await readAll((await storage.read("staging", key, { start: 0, endInclusive: 0 })).body),
    body.slice(0, 1),
  );
  assert.deepEqual(
    await readAll((await storage.read("staging", key, { start: body.length - 1 })).body),
    body.slice(-1),
  );
  await assert.rejects(storage.read("staging", key, { start: body.length }));

  await assert.rejects(
    storage.put({
      namespace: "staging",
      key: "55/0e/550e8400-e29b-41d4-a716-446655440001",
      body: chunks([body]),
      expectedBytes: 1,
    }),
  );
  await assert.rejects(
    storage.put({
      namespace: "staging",
      key: "55/0e/550e8400-e29b-41d4-a716-446655440002",
      body: chunks([body]),
      expectedSha256: "00".repeat(32),
    }),
  );

  const privateKey = "aa/aa/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await storage.promote({
    from: "staging",
    to: "private",
    sourceKey: key,
    destinationKey: privateKey,
    expectedSha256: digest,
  });
  assert.deepEqual(await storage.head("private", privateKey), metadata);
  assert.equal(await storage.head("staging", key), null);
  const sameHashSource = "55/0e/550e8400-e29b-41d4-a716-446655440001";
  await storage.put({ namespace: "staging", key: sameHashSource, body: chunks([body]) });
  await storage.promote({
    from: "staging",
    to: "private",
    sourceKey: sameHashSource,
    destinationKey: privateKey,
    expectedSha256: digest,
  });
  assert.equal(await storage.head("staging", sameHashSource), null);
  const conflictingSource = "55/0e/550e8400-e29b-41d4-a716-446655440002";
  const conflictingBody = Uint8Array.from([9, 9, 9]);
  await storage.put({
    namespace: "staging",
    key: conflictingSource,
    body: chunks([conflictingBody]),
  });
  await assert.rejects(
    storage.promote({
      from: "staging",
      to: "private",
      sourceKey: conflictingSource,
      destinationKey: privateKey,
      expectedSha256: sha256(conflictingBody),
    }),
  );
  assert.notEqual(await storage.head("staging", conflictingSource), null);
  await storage
    .promote({
      from: "staging",
      to: "private",
      sourceKey: key,
      destinationKey: privateKey,
      expectedSha256: digest,
    })
    .catch((error: unknown) => {
      assert.match(String(error), /source|missing|not found/i);
    });

  await storage.delete("private", privateKey);
  assert.equal(await storage.head("private", privateKey), null);
}
