type ContactRotationDependencies = Readonly<{
  request<T>(path: string, init?: RequestInit): Promise<T>;
  idFactory?: () => string;
}>;

export async function removeContactWithReauth<T>(
  contactId: string,
  password: string,
  dependencies: ContactRotationDependencies,
): Promise<T> {
  if (contactId.length === 0) throw new Error("联系人标识不能为空");
  if (password.length === 0) throw new Error("请输入当前主密码");
  return dependencies.request<T>(`/owner/contacts/${encodeURIComponent(contactId)}/remove`, {
    method: "POST",
    headers: {
      "idempotency-key": (dependencies.idFactory ?? (() => crypto.randomUUID()))(),
    },
    body: JSON.stringify({ password: password.normalize("NFC") }),
  });
}
