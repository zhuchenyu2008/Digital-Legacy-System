import { describe, expect, test } from "vitest";
import {
  type ContactLifecycle,
  transitionContactLifecycle,
} from "../contacts/contact-lifecycle.js";
import { parseInstant } from "../shared/instant.js";
import { parseAggregateVersion } from "../shared/version.js";
import { type PackageLifecycle, transitionPackageLifecycle } from "../vault/package-lifecycle.js";
import {
  type ShareGenerationLifecycle,
  transitionShareGenerationLifecycle,
} from "../vault/share-generation-lifecycle.js";

const at = parseInstant("2026-08-06T12:00:00Z");
const expiry = parseInstant("2026-08-07T12:00:00Z");
const versionZero = parseAggregateVersion(0);
const versionOne = parseAggregateVersion(1);

describe("versioned lifecycle transitions", () => {
  test("contact consent increments the version and rejects a stale command", () => {
    const invited: ContactLifecycle = {
      status: "INVITED",
      version: versionZero,
      invitationExpiresAt: expiry,
    };
    const consent = transitionContactLifecycle(
      invited,
      { type: "CONSENT", expectedVersion: versionZero },
      at,
    );

    expect(consent.state.version).toBe(versionOne);
    expect(consent.events[0]?.aggregateVersion).toBe(versionOne);
    expect(() =>
      transitionContactLifecycle(invited, { type: "CONSENT", expectedVersion: versionOne }, at),
    ).toThrow("version");
  });

  test("share distribution increments the version and rejects a stale command", () => {
    const draft: ShareGenerationLifecycle = { status: "DRAFT", version: versionZero };
    const distributing = transitionShareGenerationLifecycle(
      draft,
      { type: "START_DISTRIBUTION", expectedVersion: versionZero },
      at,
    );

    expect(distributing.state.version).toBe(versionOne);
    expect(distributing.events[0]?.aggregateVersion).toBe(versionOne);
    expect(() =>
      transitionShareGenerationLifecycle(
        draft,
        { type: "START_DISTRIBUTION", expectedVersion: versionOne },
        at,
      ),
    ).toThrow("version");
  });

  test("package validation increments the version and rejects a stale command", () => {
    const uploading: PackageLifecycle = { status: "UPLOADING", version: versionZero };
    const validating = transitionPackageLifecycle(
      uploading,
      { type: "START_VALIDATION", expectedVersion: versionZero },
      at,
    );

    expect(validating.state.version).toBe(versionOne);
    expect(validating.events[0]?.aggregateVersion).toBe(versionOne);
    expect(() =>
      transitionPackageLifecycle(
        uploading,
        { type: "START_VALIDATION", expectedVersion: versionOne },
        at,
      ),
    ).toThrow("version");
  });
});
