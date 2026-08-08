export type PersistenceErrorCode =
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "UNIQUE_VIOLATION"
  | "FOREIGN_KEY_VIOLATION"
  | "CHECK_VIOLATION"
  | "NESTED_TRANSACTION"
  | "IDEMPOTENCY_CONFLICT"
  | "DATABASE_ERROR";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(code: PersistenceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PersistenceError";
    this.code = code;
  }
}

export function mapDatabaseError(error: unknown): PersistenceError {
  if (error instanceof PersistenceError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "23505") return new PersistenceError("UNIQUE_VIOLATION", "Unique constraint violated", { cause: error });
  if (code === "23503") return new PersistenceError("FOREIGN_KEY_VIOLATION", "Foreign key constraint violated", { cause: error });
  if (code === "23514") return new PersistenceError("CHECK_VIOLATION", "Check constraint violated", { cause: error });
  return new PersistenceError("DATABASE_ERROR", "Database operation failed", { cause: error });
}
