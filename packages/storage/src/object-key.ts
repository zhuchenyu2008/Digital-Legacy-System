const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const OBJECT_KEY_PATTERN = /^([0-9a-f]{2})\/([0-9a-f]{2})\/(.*)$/u;

export function buildObjectKey(uuid: string): string {
  assertServerUuid(uuid);
  return `${uuid.slice(0, 2)}/${uuid.slice(2, 4)}/${uuid}`;
}

export function assertObjectKey(key: string): string {
  if (typeof key !== "string" || key.length === 0 || key.includes("\\")) {
    throw new Error("Object key must be a non-empty forward-slash path");
  }
  const match = OBJECT_KEY_PATTERN.exec(key);
  if (match === null) throw new Error("Object key is not a segmented UUID path");
  const [, first, second, uuid] = match;
  if (
    first === undefined ||
    second === undefined ||
    uuid === undefined ||
    !UUID_PATTERN.test(uuid) ||
    uuid.slice(0, 2) !== first ||
    uuid.slice(2, 4) !== second
  ) {
    throw new Error("Object key is not a server-generated UUID path");
  }
  return key;
}

function assertServerUuid(uuid: string): void {
  if (typeof uuid !== "string" || !UUID_PATTERN.test(uuid)) {
    throw new Error("Object identifiers must be canonical lowercase UUIDs");
  }
}
