import { validate as validateUuid } from "uuid";

export type AggregateId = string & { readonly __brand: "AggregateId" };

export function parseAggregateId(value: string): AggregateId {
  if (!validateUuid(value)) {
    throw new TypeError("Invalid aggregate ID: expected a UUID");
  }

  return value.toLowerCase() as AggregateId;
}
