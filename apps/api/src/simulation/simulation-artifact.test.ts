import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { openSimulationArchive, SIMULATION_ARCHIVE_SHA256 } from "./simulation-artifact";

describe("simulation publication archive", () => {
  test("serves deterministic full and resumable ZIP bytes with one digest", () => {
    const complete = openSimulationArchive();
    const first = openSimulationArchive({ start: 0, endInclusive: 31 });
    const rest = openSimulationArchive({ start: 32 });

    expect(complete.sha256).toBe(SIMULATION_ARCHIVE_SHA256);
    expect(createHash("sha256").update(complete.body).digest("hex")).toBe(
      SIMULATION_ARCHIVE_SHA256,
    );
    expect(complete.body.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(Buffer.concat([first.body, rest.body])).toEqual(complete.body);
    expect(first.totalBytes).toBe(complete.body.length);
    expect(rest.totalBytes).toBe(complete.body.length);
  });

  test("rejects ranges outside the immutable archive", () => {
    const size = openSimulationArchive().totalBytes;
    expect(() => openSimulationArchive({ start: size })).toThrow(RangeError);
    expect(() => openSimulationArchive({ start: 4, endInclusive: 3 })).toThrow(RangeError);
  });
});
