import { describe, expect, test, vi } from "vitest";
import { removeContactWithReauth } from "./contact-rotation";

describe("removeContactWithReauth", () => {
  test("requires the owner password and sends it only in the protected request body", async () => {
    const request = vi.fn().mockResolvedValue({ data: { status: "CONFIGURING" } });

    await expect(
      removeContactWithReauth("contact-1", "owner-password-1234", {
        request,
        idFactory: () => "rotation-request-1",
      }),
    ).resolves.toEqual({ data: { status: "CONFIGURING" } });

    expect(request).toHaveBeenCalledWith("/owner/contacts/contact-1/remove", {
      method: "POST",
      headers: { "idempotency-key": "rotation-request-1" },
      body: JSON.stringify({ password: "owner-password-1234" }),
    });
    expect(request.mock.calls[0]?.[0]).not.toContain("owner-password-1234");
  });

  test("rejects an empty reauthentication secret before making a request", async () => {
    const request = vi.fn();

    await expect(removeContactWithReauth("contact-1", "", { request })).rejects.toThrow(
      "请输入当前主密码",
    );
    expect(request).not.toHaveBeenCalled();
  });
});
