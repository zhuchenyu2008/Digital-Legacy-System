import { describe, expect, it } from "vitest";
import { activateMaterialSymbols } from "./material-symbols";

describe("activateMaterialSymbols", () => {
  it("keeps the SVG fallback active when no matching font face loads", async () => {
    const activated: string[] = [];

    await activateMaterialSymbols(
      { classList: { add: (value) => activated.push(value) } },
      {
        check: () => true,
        load: async () => [],
      },
    );

    expect(activated).toEqual([]);
  });

  it("activates material symbols after a matching font face loads and checks successfully", async () => {
    const activated: string[] = [];

    await activateMaterialSymbols(
      { classList: { add: (value) => activated.push(value) } },
      {
        check: () => true,
        load: async () => [{}],
      },
    );

    expect(activated).toEqual(["dls-material-symbols-ready"]);
  });
});
