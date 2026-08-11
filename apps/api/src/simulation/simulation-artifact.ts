const SIMULATION_ARCHIVE_BASE64 =
  "UEsDBBQAAAAIAAAAAADI2VOwLQAAADYAAAAHAAAAd2lsbC5tZFNWCK7MK8lILclMVihJLS5JzE3NK+HiCijKLEssSUUIKaRlVpSUFoFEKkq4AFBLAwQUAAAAAAAAAAAAf93QgwYAAAAGAAAAFQAAAGF0dGFjaG1lbnRzL3Byb29mLmJpbgABAgP+/1BLAQIUABQAAAAIAAAAAADI2VOwLQAAADYAAAAHAAAAAAAAAAAAAAAAAAAAAAB3aWxsLm1kUEsBAhQAFAAAAAAAAAAAAH/d0IMGAAAABgAAABUAAAAAAAAAAAAAAAAAUgAAAGF0dGFjaG1lbnRzL3Byb29mLmJpblBLBQYAAAAAAgACAHgAAACLAAAAAAA=";

export const SIMULATION_ARCHIVE_SHA256 =
  "d9b4652a34d5ef647e9ae5c0196faddd6117c91daf27ea1548bdd7dbcb6fbc4c";

const archive = Buffer.from(SIMULATION_ARCHIVE_BASE64, "base64");

export function openSimulationArchive(
  range?: Readonly<{ start: number; endInclusive?: number }>,
): Readonly<{ body: Buffer; bytes: number; totalBytes: number; sha256: string }> {
  const start = range?.start ?? 0;
  const endInclusive = range?.endInclusive ?? archive.length - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(endInclusive) ||
    start < 0 ||
    endInclusive < start ||
    start >= archive.length
  ) {
    throw new RangeError("simulation archive byte range is unsatisfiable");
  }
  const end = Math.min(endInclusive, archive.length - 1);
  const body = Buffer.from(archive.subarray(start, end + 1));
  return {
    body,
    bytes: body.length,
    totalBytes: archive.length,
    sha256: SIMULATION_ARCHIVE_SHA256,
  };
}
