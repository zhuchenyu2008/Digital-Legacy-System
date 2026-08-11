import { SimulationError, type SimulationScenario } from "@dls/application";
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ContactSimulationController, SimulationController } from "./simulation.controller.js";
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
    contactIds: ["00000000-0000-4000-8000-000000000399"],
    packageObjectKey: `simulations/${simulationId}/private/test.zip`,
    publicObjectKey: `simulations/${simulationId}/public/legacy.zip`,
    workflow: {
      id: `simulation:${simulationId}:workflow:death`,
      state: "SCHEDULED",
      requiredCount: 1,
      contactIds: ["00000000-0000-4000-8000-000000000399"],
      contactDecisions: [],
      disclosureMailSent: false,
    },
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
      contactDecision: async () => scenario,
      ownerCancel: async () => scenario,
      lockPublication: async () => scenario,
      finalizePublication: async () => scenario,
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
      contactDecision: async () => scenario,
      ownerCancel: async () => scenario,
      lockPublication: async () => scenario,
      finalizePublication: async () => scenario,
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
      contactDecision: async () => {
        throw new SimulationError("SIMULATION_DISABLED", "simulation mode is disabled");
      },
      ownerCancel: async () => {
        throw new SimulationError("SIMULATION_DISABLED", "simulation mode is disabled");
      },
      lockPublication: async () => {
        throw new SimulationError("SIMULATION_DISABLED", "simulation mode is disabled");
      },
      finalizePublication: async () => {
        throw new SimulationError("SIMULATION_DISABLED", "simulation mode is disabled");
      },
    };
    const controller = new SimulationController(runtime);

    await expect(controller.get(simulationId, request())).rejects.toBeInstanceOf(NotFoundException);
  });

  it("takes the contact identity from the authenticated request for isolated decisions", async () => {
    let captured: unknown;
    const runtime: SimulationRuntime = {
      create: async () => scenario,
      get: async () => scenario,
      advance: async () => ({
        simulationId,
        currentAt: scenario.currentAt,
        state: "CHECKIN_DUE",
        events: [],
      }),
      reset: async () => undefined,
      contactDecision: async (command) => {
        captured = command;
        return scenario;
      },
      ownerCancel: async () => scenario,
      lockPublication: async () => scenario,
      finalizePublication: async () => scenario,
    };
    const controller = new ContactSimulationController(runtime);

    const response = await controller.decide(
      simulationId,
      { decision: "ALIVE" },
      request("00000000-0000-4000-8000-000000000399"),
    );

    expect(captured).toEqual({
      simulationId,
      contactId: "00000000-0000-4000-8000-000000000399",
      decision: "ALIVE",
    });
    expect(response).toEqual({ data: scenario, requestId: "request-1" });
  });

  it("forwards owner-only cancel and publication actions with the session owner", async () => {
    const commands: unknown[] = [];
    const runtime: SimulationRuntime = {
      create: async () => scenario,
      get: async () => scenario,
      advance: async () => ({
        simulationId,
        currentAt: scenario.currentAt,
        state: "CHECKIN_DUE",
        events: [],
      }),
      reset: async () => undefined,
      contactDecision: async () => scenario,
      ownerCancel: async (command) => {
        commands.push(command);
        return scenario;
      },
      lockPublication: async (command) => {
        commands.push(command);
        return scenario;
      },
      finalizePublication: async (command) => {
        commands.push(command);
        return scenario;
      },
    };
    const controller = new SimulationController(runtime);

    await (
      controller.cancel as unknown as (
        id: string,
        body: Readonly<{ password: string }>,
        request: never,
      ) => Promise<unknown>
    )(simulationId, { password: "owner-password-2026" }, request());
    await controller.lock(simulationId, request());
    await controller.publish(simulationId, request());

    expect(commands).toEqual([
      { simulationId, ownerId, password: "owner-password-2026" },
      { simulationId, ownerId },
      { simulationId, ownerId },
    ]);
  });
});
