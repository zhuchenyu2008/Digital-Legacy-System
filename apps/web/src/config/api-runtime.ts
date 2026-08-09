export function apiInternalBaseUrl(): string {
  return process.env.DLS_API_INTERNAL_URL ?? "http://api:3001";
}
