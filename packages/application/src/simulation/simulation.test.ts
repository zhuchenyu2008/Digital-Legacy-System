import { describe, expect, it } from "vitest";
import {
  advanceSimulation,
  cancelSimulationOwner,
  createSimulation,
  finalizeSimulationPublication,
  lockSimulationPublication,
  recordSimulationContactDecision,
  resetSimulation,
  type SimulationAuditEvent,
  SimulationClock,
  SimulationError,
  type SimulationScenario,
  type SimulationStore,
} from "./index.js";

class MemorySimulationStore implements SimulationStore {
  readonly scenarios = new Map<string, SimulationScenario>();
  readonly audits: SimulationAuditEvent[] = [];
  readonly results = new Map<string, unknown>();

  public async create(scenario: SimulationScenario): Promise<void> {
    if (this.scenarios.has(scenario.id)) throw new Error("duplicate simulation");
    this.scenarios.set(scenario.id, scenario);
  }

  public async get(simulationId: string): Promise<SimulationScenario | null> {
    return this.scenarios.get(simulationId) ?? null;
  }

  public async save(scenario: SimulationScenario): Promise<void> {
    this.scenarios.set(scenario.id, scenario);
  }

  public async remove(simulationId: string): Promise<void> {
    this.scenarios.delete(simulationId);
  }

  public async appendAudit(event: SimulationAuditEvent): Promise<void> {
    this.audits.push(event);
  }

  public async readIdempotentResult<T>(
    simulationId: string,
    idempotencyKey: string,
  ): Promise<T | null> {
    return (this.results.get(`${simulationId}:${idempotencyKey}`) as T | undefined) ?? null;
  }

  public async writeIdempotentResult<T>(
    simulationId: string,
    idempotencyKey: string,
    result: T,
  ): Promise<void> {
    this.results.set(`${simulationId}:${idempotencyKey}`, result);
  }
}

const actor = "00000000-0000-4000-8000-000000000001";
const simulationId = "00000000-0000-4000-8000-000000000010";
const startAt = "2026-08-10T00:00:00.000Z";
const contactIds = [
  "00000000-0000-0000-0000-000000000011",
  "00000000-0000-0000-0000-000000000012",
  "00000000-0000-0000-0000-000000000013",
] as const;

type PasswordProtectedCancel = (
  command: Readonly<{ simulationId: string; ownerId: string; password: string }>,
  dependencies: Readonly<{
    store: SimulationStore;
    passwordVerifier(password: string): Promise<boolean>;
  }>,
) => Promise<SimulationScenario>;

const cancelWithPassword = cancelSimulationOwner as unknown as PasswordProtectedCancel;

async function scenario(store: MemorySimulationStore) {
  return createSimulation(
    {
      simulationId,
      ownerId: actor,
      ownerEmail: "owner+simulation@example.test",
      contactEmails: ["contact-1@example.test", "contact-2@example.test", "contact-3@example.test"],
      contactIds,
      startAt,
    },
    {
      store,
      allowedRecipients: ["*@example.test"],
      testMode: true,
    },
  );
}

describe("isolated workflow simulation", () => {
  it("creates only synthetic namespaced data and test-labelled allowlisted mail", async () => {
    const store = new MemorySimulationStore();

    const created = await scenario(store);

    expect(created).toMatchObject({
      id: simulationId,
      ownerId: actor,
      namespace: `simulation:${simulationId}`,
      currentAt: startAt,
      state: "READY",
      synthetic: {
        ownerEmail: "owner+simulation@example.test",
        contactEmails: [
          "contact-1@example.test",
          "contact-2@example.test",
          "contact-3@example.test",
        ],
        packageObjectKey: `simulations/${simulationId}/private/test.zip`,
        publicObjectKey: `simulations/${simulationId}/public/legacy.zip`,
      },
    });
    expect(created.pendingMail).toEqual([
      {
        recipient: "owner+simulation@example.test",
        subject: "【测试】仿真场景已创建",
        template: "simulation-created",
      },
    ]);
    expect(created.synthetic.publicObjectKey).not.toMatch(/^public\//u);
    expect(store.audits).toEqual([
      expect.objectContaining({ eventType: "simulation.created", ownerId: actor }),
    ]);
  });

  it("fails closed outside test mode and rejects recipients outside the allowlist", async () => {
    const store = new MemorySimulationStore();
    await expect(
      createSimulation(
        {
          simulationId,
          ownerId: actor,
          ownerEmail: "owner@example.com",
          contactEmails: ["contact-1@example.test"],
          startAt,
        },
        { store, allowedRecipients: ["*@example.test"], testMode: false },
      ),
    ).rejects.toMatchObject({ code: "SIMULATION_DISABLED" });

    await expect(
      createSimulation(
        {
          simulationId,
          ownerId: actor,
          ownerEmail: "owner@example.com",
          contactEmails: ["contact-1@example.test"],
          startAt,
        },
        { store, allowedRecipients: ["*@example.test"], testMode: true },
      ),
    ).rejects.toMatchObject({ code: "RECIPIENT_NOT_ALLOWED" });
  });

  it("reads persisted virtual time and never permits it to move backward", async () => {
    const store = new MemorySimulationStore();
    await scenario(store);
    const clock = new SimulationClock(store, simulationId);

    expect(await clock.now()).toBe(startAt);
    await expect(clock.set("2026-08-09T23:59:59.999Z")).rejects.toBeInstanceOf(SimulationError);
    expect(await clock.now()).toBe(startAt);
  });

  it("authorizes and deduplicates deterministic milestone advancement with an audit", async () => {
    const store = new MemorySimulationStore();
    await scenario(store);

    await expect(
      advanceSimulation(
        {
          simulationId,
          ownerId: "00000000-0000-4000-8000-000000000099",
          idempotencyKey: "advance-unauthorized",
          target: "PUBLICATION",
        },
        { store },
      ),
    ).rejects.toMatchObject({ code: "SIMULATION_FORBIDDEN" });

    const first = await advanceSimulation(
      {
        simulationId,
        ownerId: actor,
        idempotencyKey: "advance-publication",
        target: "PUBLICATION",
      },
      { store },
    );
    const replay = await advanceSimulation(
      {
        simulationId,
        ownerId: actor,
        idempotencyKey: "advance-publication",
        target: "PUBLICATION",
      },
      { store },
    );

    expect(first).toEqual(replay);
    expect(first.currentAt).toBe("2026-08-17T00:00:00.000Z");
    expect(first.events.map((event) => event.type)).toEqual([
      "CHECKIN_DUE",
      "CONTACT_DECISION",
      "RECOVERY_THRESHOLD",
      "RELEASE_COUNTDOWN",
      "SMTP_RETRY",
      "PUBLICATION",
    ]);
    expect(store.audits.filter((event) => event.eventType === "simulation.advanced")).toHaveLength(
      1,
    );
  });

  it("only the owning actor can reset a scenario and records the removal", async () => {
    const store = new MemorySimulationStore();
    await scenario(store);

    await expect(
      resetSimulation({ simulationId, ownerId: "00000000-0000-4000-8000-000000000099" }, { store }),
    ).rejects.toMatchObject({ code: "SIMULATION_FORBIDDEN" });

    await resetSimulation({ simulationId, ownerId: actor }, { store });

    expect(await store.get(simulationId)).toBeNull();
    expect(store.audits.at(-1)).toMatchObject({
      eventType: "simulation.reset",
      simulationId,
      ownerId: actor,
    });
  });

  it("runs the isolated alive cancellation path and reschedules the synthetic check-in", async () => {
    const store = new MemorySimulationStore();
    await scenario(store);

    await advanceSimulation(
      {
        simulationId,
        ownerId: actor,
        idempotencyKey: "checkin-due-action",
        target: "CHECKIN_DUE",
      },
      { store },
    );
    const cancelled = await recordSimulationContactDecision(
      {
        simulationId,
        contactId: contactIds[0],
        decision: "ALIVE",
      },
      { store },
    );

    expect(cancelled.synthetic.workflow).toMatchObject({
      state: "CANCELLED_ALIVE",
      contactDecisions: [{ contactId: contactIds[0], decision: "ALIVE" }],
      disclosureMailSent: true,
    });
    expect(cancelled.synthetic.workflow.rescheduledCheckinAt).toBe("2026-08-16T00:00:00.000Z");
  });

  it("enforces the release lock and publishes only after the owner cancellation window closes", async () => {
    const store = new MemorySimulationStore();
    await scenario(store);

    await advanceSimulation(
      {
        simulationId,
        ownerId: actor,
        idempotencyKey: "checkin-due-death",
        target: "CHECKIN_DUE",
      },
      { store },
    );
    await recordSimulationContactDecision(
      { simulationId, contactId: contactIds[0], decision: "DEATH_LIKELY" },
      { store },
    );
    const pending = await recordSimulationContactDecision(
      { simulationId, contactId: contactIds[1], decision: "DEATH_LIKELY" },
      { store },
    );
    expect(pending.synthetic.workflow.state).toBe("RELEASE_PENDING");

    const passwordVerifier = async (password: string) => password === "owner-password-2026";
    await expect(
      cancelWithPassword(
        { simulationId, ownerId: actor, password: "wrong-owner-password" },
        { store, passwordVerifier },
      ),
    ).rejects.toMatchObject({ code: "SIMULATION_OWNER_REAUTH_REQUIRED" });
    const ownerCancelled = await cancelWithPassword(
      { simulationId, ownerId: actor, password: "owner-password-2026" },
      { store, passwordVerifier },
    );
    expect(ownerCancelled.synthetic.workflow.state).toBe("CANCELLED_OWNER");

    await resetSimulation({ simulationId, ownerId: actor }, { store });
    await scenario(store);
    await advanceSimulation(
      {
        simulationId,
        ownerId: actor,
        idempotencyKey: "checkin-due-publish",
        target: "CHECKIN_DUE",
      },
      { store },
    );
    await recordSimulationContactDecision(
      { simulationId, contactId: contactIds[0], decision: "DEATH_LIKELY" },
      { store },
    );
    await recordSimulationContactDecision(
      { simulationId, contactId: contactIds[1], decision: "DEATH_LIKELY" },
      { store },
    );
    await advanceSimulation(
      {
        simulationId,
        ownerId: actor,
        idempotencyKey: "publish-lock-time",
        target: "RELEASE_COUNTDOWN",
      },
      { store },
    );
    await expect(
      cancelWithPassword(
        { simulationId, ownerId: actor, password: "owner-password-2026" },
        { store, passwordVerifier },
      ),
    ).rejects.toMatchObject({ code: "SIMULATION_PUBLISH_LOCKED" });
    const locked = await lockSimulationPublication({ simulationId, ownerId: actor }, { store });
    expect(locked.synthetic.workflow.state).toBe("PUBLISH_LOCKED");
    const published = await finalizeSimulationPublication(
      { simulationId, ownerId: actor },
      {
        store,
        renderWill: (source) => {
          expect(source).toContain("<script>");
          return "<h1>测试遗嘱</h1><p>sanitized</p>";
        },
      },
    );
    expect(published.synthetic.workflow.state).toBe("PUBLISHED");
    expect(published.synthetic.workflow.publication?.willHtml).toBe(
      "<h1>测试遗嘱</h1><p>sanitized</p>",
    );
    expect(published.synthetic.workflow.publication?.objectKey).toContain(
      `simulations/${simulationId}/public/legacy.zip`,
    );
  });
});
