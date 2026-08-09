import { describe, expect, it } from "vitest";
import {
  assertSimulationJobName,
  registerSimulationJobs,
  SIMULATION_JOB_NAMES,
} from "./simulation-jobs.js";

describe("simulation worker jobs", () => {
  it("uses a namespace disjoint from every formal job", () => {
    expect(Object.values(SIMULATION_JOB_NAMES)).toEqual([
      "simulation.advance",
      "simulation.notification.deliver",
      "simulation.publication.finalize",
    ]);
    for (const name of Object.values(SIMULATION_JOB_NAMES)) {
      expect(assertSimulationJobName(name)).toBe(name);
    }
    expect(() => assertSimulationJobName("workflow.advance")).toThrow(/simulation namespace/u);
  });

  it("registers only explicit simulation handlers", async () => {
    const registered: string[] = [];
    await registerSimulationJobs(
      {
        work: async (name) => {
          registered.push(name);
        },
      },
      {
        [SIMULATION_JOB_NAMES.ADVANCE]: async () => undefined,
        [SIMULATION_JOB_NAMES.PUBLICATION_FINALIZE]: async () => undefined,
      },
    );

    expect(registered).toEqual([
      SIMULATION_JOB_NAMES.ADVANCE,
      SIMULATION_JOB_NAMES.PUBLICATION_FINALIZE,
    ]);
  });
});
