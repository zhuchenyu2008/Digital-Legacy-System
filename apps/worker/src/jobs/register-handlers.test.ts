import { describe, expect, test, vi } from "vitest";
import { createWorkerDrain } from "./register-handlers.js";

describe("worker drain", () => {
  test("waits for in-flight work after intake is stopped", async () => {
    const drain = createWorkerDrain();
    let release!: () => void;
    const running = drain.run(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    drain.stopAccepting();
    const idle = drain.waitForIdle(1000);
    expect(drain.activeCount()).toBe(1);
    release();
    await running;
    await idle;
    expect(drain.activeCount()).toBe(0);
    await expect(drain.run(async () => undefined)).rejects.toThrow("draining");
  });

  test("returns after the timeout if a task cannot drain", async () => {
    vi.useFakeTimers();
    const drain = createWorkerDrain();
    const running = drain.run(() => new Promise<void>(() => undefined));
    const idle = drain.waitForIdle(50);
    await vi.advanceTimersByTimeAsync(50);
    await idle;
    expect(drain.activeCount()).toBe(1);
    void running;
    vi.useRealTimers();
  });
});
