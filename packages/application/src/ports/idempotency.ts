export type IdempotencyReservation = Readonly<{
  id: string;
  actorScope: string;
  commandName: string;
  keyDigest: Uint8Array;
  requestHash: Uint8Array;
  status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
  responseStatus?: number;
  responseBody?: unknown;
  responseHash?: Uint8Array;
}>;

export type IdempotencyKey = Readonly<{
  actorScope: string;
  commandName: string;
  keyDigest: Uint8Array;
  requestHash: Uint8Array;
}>;

export interface IdempotencyRepository {
  reserve(key: IdempotencyKey): Promise<IdempotencyReservation>;
  complete(
    id: string,
    responseStatus: number,
    responseBody: unknown,
  ): Promise<IdempotencyReservation>;
}
