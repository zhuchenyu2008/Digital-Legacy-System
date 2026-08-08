import type { Instant } from "@dls/domain";

export interface DatabaseClock {
  now(): Promise<Instant>;
}
