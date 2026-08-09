import { SimulationError, type SimulationScenario } from "@dls/application";
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { SimulationController } from "./simulation.controller.js";
import type { SimulationRuntime } from "./simulation.runtime.js";

const ownerId = "00000000-0000-4000-8000-000000000301";
const simulationId = "00000000-0000-4000-8000-000000000302";
const scenario = {
  id: simulationId,
  ownerId,
  namespace: `simulation:${simulationId}`,
  createdAt: "2026-08-10T00:00:00.000Z",
  startAt: "2026-08-10T00:00:00.000Z",
  currentAt: "2026-08-10T00:00:00.000Z",
  state: "READY",
  revision: 0,
  synthetic: {
    ownerEmail: "owner+simulation@example.test",
    contactEmails: ["contact-1@example.test"],
    packageObjectKey: `simulations/${simulationId}/private/test.zip`,
    publicObjectKey: `simulations/${simulationId}/public/legacy.zip`,
  },
  pendingMail: [],
} satisfies SimulationScenario;

function request(actorId = ownerId) {
  return { id: "request-1", user: { actorId } } as never;
}

describe("simulation HTTP controller", () => {
  it("takes owner identity from the authenticated request and forwards a dedicated command", async () => {
    let captured: unknown;
    const runtime: SimulationRuntime = {
      create: async (command) => {
        captured = command;
        return scenario;
      },
      get: async () => scenario,
      advance: async () => ({
        simulationId,
        currentAt: scenario.currentAt,
        state: "CHECKIN_DUE",
        events: [],
      }),
      reset: async () => undefined,
    };
    const controller = new SimulationController(runtime);

    const response = await controller.create(
      {
        simulationId,
        ownerEmail: "owner+simulation@example.test",
        contactEmails: ["contact-1@example.test"],
        startAt: scenario.startAt,
      },
      request(),
    );

    expect(captured).toEqual({
      simulationId,
      ownerId,
      ownerEmail: "owner+simulation@example.test",
      contactEmails: ["contact-1@example.test"],
      startAt: scenario.startAt,
    });
    expect(response).toEqual({ data: scenario, requestId: "request-1" });
  });

  it("requires a sufficiently long idempotency key for advancement", async () => {
    const controller = new SimulationController({
      create: async () => scenario,
      get: async () => scenario,
      advance: async () => {
        throw new Error("runtime must not be reached");
      },
      reset: async () => undefined,
    });

    await expect(
      controller.advance(simulationId, { target: "PUBLICATION" }, "short", request()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("maps disabled simulation mode to a non-enumerating not-found response", async () => {
    const runtime: SimulationRuntime = {
      create: async () => {
        throw new SimulationError("SIMULATION_DISABLED", "simulation mode is disabled");
      },
      get: async () => {
        throw new SimulationError("SIMULATION_DISABLED", "simulation mode is disabled");
      },
      advance: async () => {
        throw new SimulationError("SIMULATION_DISABLED", "simulation mode is disabled");
      },
      reset: async () => {
        throw new SimulationError("SIMULATION_DISABLED", "simulation mode is disabled");
      },
    };
    const controller = new SimulationController(runtime);

    await expect(controller.get(simulationId, request())).rejects.toBeInstanceOf(NotFoundException);
  });
});
