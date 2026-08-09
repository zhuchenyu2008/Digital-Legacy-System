export type PasswordValidation = Readonly<{ normalized: string }> | Readonly<{ error: string }>;

export function validateNewPassword(value: string): PasswordValidation {
  const normalized = value.normalize("NFC");
  if ([...normalized].length < 12) return { error: "密码至少需要 12 个字符" };
  if (new TextEncoder().encode(normalized).length > 512) {
    return { error: "密码不得超过 512 个 UTF-8 字节" };
  }
  return { normalized };
}

export function consumeFragmentToken(
  key: string,
  source: Readonly<{
    hash: string;
    pathname: string;
    search: string;
    replaceState: (data: unknown, unused: string, url?: string | URL | null) => void;
  }>,
): string | undefined {
  const values = new URLSearchParams(source.hash.replace(/^#/u, ""));
  const token = values.get(key) ?? values.get("token") ?? undefined;
  source.replaceState(null, "", `${source.pathname}${source.search}`);
  return token;
}

export function requestIdFrom(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "requestId" in error
    ? String((error as { requestId?: unknown }).requestId ?? "") || undefined
    : undefined;
}
