import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  type IssuedSession,
  type SessionActorType,
  SessionError,
  type SessionPrincipal,
  type SessionRecord,
} from "./session.js";

export type SessionClock = Readonly<{ now(): string }>;

export interface SessionStore {
  create(record: SessionRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  listActive(
    actorType: SessionActorType,
    actorId: string,
    now: string,
  ): Promise<readonly SessionRecord[]>;
  revoke(sessionId: string, revokedAt: string): Promise<void>;
  touch(sessionId: string, lastSeenAt: string, idleExpiresAt: string): Promise<void>;
}

export type SessionServiceOptions = Readonly<{
  pepper: Uint8Array;
  clock?: SessionClock;
  ownerIdleMs?: number;
  contactIdleMs?: number;
  absoluteMs?: number;
  maxOwnerSessions?: number;
  maxContactSessions?: number;
}>;

export type CreateSessionInput = Readonly<{
  actorType: SessionActorType;
  actorId: string;
  credentialVersion: number;
  ip?: string;
  userAgent?: string;
}>;

export type AuthenticateOptions = Readonly<{
  actorType: SessionActorType;
  actorId?: string;
  credentialVersion?: number;
}>;

const defaultClock: SessionClock = { now: () => new Date().toISOString() };

function assertDuration(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}

function digest(value: string, pepper: Uint8Array): string {
  return createHmac("sha256", pepper).update(value, "utf8").digest("base64url");
}

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function addMilliseconds(instant: string, milliseconds: number): string {
  const timestamp = Date.parse(instant);
  if (!Number.isFinite(timestamp))
    throw new RangeError("Session clock returned an invalid instant");
  return new Date(timestamp + milliseconds).toISOString();
}

function minInstant(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function principal(record: SessionRecord): SessionPrincipal {
  const { tokenHash: _tokenHash, csrfTokenHash: _csrfTokenHash, ...value } = record;
  return value;
}

function matchesDigest(secret: string, expectedDigest: string, pepper: Uint8Array): boolean {
  const actual = Buffer.from(digest(secret, pepper));
  const expected = Buffer.from(expectedDigest);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class SessionService {
  readonly #store: SessionStore;
  readonly #pepper: Uint8Array;
  readonly #clock: SessionClock;
  readonly #ownerIdleMs: number;
  readonly #contactIdleMs: number;
  readonly #absoluteMs: number;
  readonly #maxOwnerSessions: number;
  readonly #maxContactSessions: number;

  public constructor(store: SessionStore, options: SessionServiceOptions) {
    if (options.pepper.length < 16)
      throw new RangeError("Session pepper must contain at least 16 bytes");
    this.#store = store;
    this.#pepper = Uint8Array.from(options.pepper);
    this.#clock = options.clock ?? defaultClock;
    this.#ownerIdleMs = options.ownerIdleMs ?? 30 * 60 * 1000;
    this.#contactIdleMs = options.contactIdleMs ?? 60 * 60 * 1000;
    this.#absoluteMs = options.absoluteMs ?? 24 * 60 * 60 * 1000;
    this.#maxOwnerSessions = options.maxOwnerSessions ?? 5;
    this.#maxContactSessions = options.maxContactSessions ?? 3;
    assertDuration(this.#ownerIdleMs, "ownerIdleMs");
    assertDuration(this.#contactIdleMs, "contactIdleMs");
    assertDuration(this.#absoluteMs, "absoluteMs");
    if (!Number.isSafeInteger(this.#maxOwnerSessions) || this.#maxOwnerSessions < 1)
      throw new RangeError("maxOwnerSessions must be positive");
    if (!Number.isSafeInteger(this.#maxContactSessions) || this.#maxContactSessions < 1)
      throw new RangeError("maxContactSessions must be positive");
  }

  public async create(input: CreateSessionInput): Promise<IssuedSession> {
    const now = this.#clock.now();
    const absoluteExpiresAt = addMilliseconds(now, this.#absoluteMs);
    const idleExpiresAt = minInstant(
      addMilliseconds(now, input.actorType === "OWNER" ? this.#ownerIdleMs : this.#contactIdleMs),
      absoluteExpiresAt,
    );
    const token = opaqueToken();
    const csrfToken = opaqueToken();
    const record: SessionRecord = Object.freeze({
      sessionId: randomUUID(),
      actorType: input.actorType,
      actorId: input.actorId,
      credentialVersion: input.credentialVersion,
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      tokenHash: digest(token, this.#pepper),
      csrfTokenHash: digest(csrfToken, this.#pepper),
      ...(input.ip === undefined ? {} : { ipDigest: digest(input.ip, this.#pepper) }),
      ...(input.userAgent === undefined
        ? {}
        : { userAgentDigest: digest(input.userAgent, this.#pepper) }),
    });
    await this.#store.create(record);
    await this.#enforceLimit(input.actorType, input.actorId, now);
    return { token, csrfToken, principal: principal(record) };
  }

  public async rotate(token: string, input: CreateSessionInput): Promise<IssuedSession> {
    const current = await this.#findValid(token, {
      actorType: input.actorType,
      actorId: input.actorId,
    });
    await this.#store.revoke(current.sessionId, this.#clock.now());
    return this.create(input);
  }

  public async authenticate(
    token: string,
    options: AuthenticateOptions,
  ): Promise<SessionPrincipal> {
    const record = await this.#findValid(token, options);
    const now = this.#clock.now();
    const idleExpiresAt = minInstant(
      addMilliseconds(now, record.actorType === "OWNER" ? this.#ownerIdleMs : this.#contactIdleMs),
      record.absoluteExpiresAt,
    );
    await this.#store.touch(record.sessionId, now, idleExpiresAt);
    return { ...principal(record), lastSeenAt: now, idleExpiresAt };
  }

  public async verifyCsrf(token: string, csrfToken: string): Promise<void> {
    const record = await this.#findValid(token);
    if (!matchesDigest(csrfToken, record.csrfTokenHash, this.#pepper)) {
      throw new SessionError("CSRF_INVALID", "CSRF token is invalid", 403);
    }
  }

  public async revoke(token: string): Promise<void> {
    const record = await this.#findValid(token);
    await this.#store.revoke(record.sessionId, this.#clock.now());
  }

  async #findValid(token: string, options?: Partial<AuthenticateOptions>): Promise<SessionRecord> {
    if (typeof token !== "string" || token.length < 40) {
      throw new SessionError("SESSION_INVALID", "Session is invalid");
    }
    const record = await this.#store.findByTokenHash(digest(token, this.#pepper));
    const now = this.#clock.now();
    if (
      record === null ||
      record.revokedAt !== undefined ||
      Date.parse(now) >= Date.parse(record.idleExpiresAt) ||
      Date.parse(now) >= Date.parse(record.absoluteExpiresAt) ||
      (options?.actorType !== undefined && record.actorType !== options.actorType) ||
      (options?.actorId !== undefined && record.actorId !== options.actorId) ||
      (options?.credentialVersion !== undefined &&
        record.credentialVersion !== options.credentialVersion)
    ) {
      throw new SessionError("SESSION_INVALID", "Session is invalid");
    }
    return record;
  }

  async #enforceLimit(actorType: SessionActorType, actorId: string, now: string): Promise<void> {
    const active = [...(await this.#store.listActive(actorType, actorId, now))].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt),
    );
    const limit = actorType === "OWNER" ? this.#maxOwnerSessions : this.#maxContactSessions;
    for (const record of active.slice(0, Math.max(0, active.length - limit))) {
      await this.#store.revoke(record.sessionId, now);
    }
  }
}

export class InMemorySessionStore implements SessionStore {
  readonly #records = new Map<string, SessionRecord>();

  public async create(record: SessionRecord): Promise<void> {
    this.#records.set(record.sessionId, record);
  }

  public async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return [...this.#records.values()].find((record) => record.tokenHash === tokenHash) ?? null;
  }

  public async listActive(
    actorType: SessionActorType,
    actorId: string,
    now: string,
  ): Promise<readonly SessionRecord[]> {
    return [...this.#records.values()].filter(
      (record) =>
        record.actorType === actorType &&
        record.actorId === actorId &&
        record.revokedAt === undefined &&
        Date.parse(now) < Date.parse(record.idleExpiresAt) &&
        Date.parse(now) < Date.parse(record.absoluteExpiresAt),
    );
  }

  public async revoke(sessionId: string, revokedAt: string): Promise<void> {
    const record = this.#records.get(sessionId);
    if (record !== undefined) this.#records.set(sessionId, Object.freeze({ ...record, revokedAt }));
  }

  public async touch(sessionId: string, lastSeenAt: string, idleExpiresAt: string): Promise<void> {
    const record = this.#records.get(sessionId);
    if (record !== undefined)
      this.#records.set(sessionId, Object.freeze({ ...record, lastSeenAt, idleExpiresAt }));
  }
}

export function hashSessionToken(token: string, pepper: Uint8Array): string {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(pepper), Buffer.from(token)]))
    .digest("base64url");
}
