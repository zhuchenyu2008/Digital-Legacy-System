import { describe, expect, test } from "vitest";
import {
  findUncoveredBoundaryComparisons,
  type BoundaryMutation,
} from "../../scripts/boundary-mutations.js";

describe("boundary mutation inventory", () => {
  test("reports every numeric comparison that has no mutation definition", () => {
    const sources = {
      "fixture.ts": [
        "if (count < 1) throw new Error();",
        "const reached = approved.length >= required;",
        "if (limit > total) throw new Error();",
        'throw new Error("expected limit <= total");',
      ].join("\n"),
    };
    const mutations: readonly BoundaryMutation[] = [
      { id: "minimum-count", file: "fixture.ts", from: "count < 1", to: "count <= 1" },
      {
        id: "inclusive-threshold",
        file: "fixture.ts",
        from: "approved.length >= required",
        to: "approved.length > required",
      },
    ];

    expect(findUncoveredBoundaryComparisons(sources, mutations)).toEqual([
      "fixture.ts:3: limit > total",
    ]);
    expect(
      findUncoveredBoundaryComparisons(sources, [
        ...mutations,
        {
          id: "maximum-limit",
          file: "fixture.ts",
          from: "limit > total",
          to: "limit >= total",
        },
      ]),
    ).toEqual([]);
  });
});
