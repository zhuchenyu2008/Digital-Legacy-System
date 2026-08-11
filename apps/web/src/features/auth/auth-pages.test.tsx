import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { ContactLoginForm } from "./contact-login-form";
import {
  consumeFragmentToken,
  consumeFragmentValues,
  navigateAfterLogin,
  observeFragmentValues,
  validateNewPassword,
} from "./form-security";
import { OwnerLoginForm } from "./owner-login-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("secure identity pages", () => {
  test("normalizes passwords for byte limits while allowing password-manager paste", () => {
    expect(validateNewPassword("e\u0301-very-long-password")).toEqual({
      normalized: "é-very-long-password",
    });
    expect(validateNewPassword("短密码")).toEqual({ error: "密码至少需要 12 个字符" });
    expect(validateNewPassword("密".repeat(200))).toEqual({
      error: "密码不得超过 512 个 UTF-8 字节",
    });

    const html = renderToStaticMarkup(<OwnerLoginForm />);
    expect(html.toLowerCase()).toContain('autocomplete="current-password"');
    expect(html).not.toContain("onpaste");
  });

  test("consumes a secret from the URL fragment and immediately removes it from history", () => {
    const replaceState = vi.fn();
    const token = consumeFragmentToken("invite", {
      hash: "#invite=fragment-secret",
      pathname: "/contact-invitations",
      search: "",
      replaceState,
    });
    expect(token).toBe("fragment-secret");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/contact-invitations");
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain("fragment-secret");
  });

  test("uses in-app navigation after login so the memory-only CSRF token survives", () => {
    const push = vi.fn();
    navigateAfterLogin(push, "/contact/workflows/current");
    expect(push).toHaveBeenCalledWith("/contact/workflows/current");
  });

  test("consumes recovery token and email code together before removing the fragment", () => {
    const replaceState = vi.fn();
    expect(
      consumeFragmentValues(["recovery", "code"], {
        hash: "#recovery=reset-secret&code=12345678",
        pathname: "/password-recovery",
        search: "",
        replaceState,
      }),
    ).toEqual({ recovery: "reset-secret", code: "12345678" });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/password-recovery");
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain("reset-secret");
    expect(JSON.stringify(replaceState.mock.calls)).not.toContain("12345678");
  });

  test("observes a recovery fragment added while the page is already mounted", () => {
    let hash = "";
    let onHashChange: (() => void) | undefined;
    const stop = vi.fn();
    const replaceState = vi.fn();
    const received: Readonly<Record<string, string | undefined>>[] = [];

    const unsubscribe = observeFragmentValues(
      ["recovery", "code"],
      () => ({
        hash,
        pathname: "/password-recovery",
        search: "",
        replaceState,
      }),
      (listener) => {
        onHashChange = listener;
        return stop;
      },
      (values) => received.push(values),
    );

    expect(received).toEqual([{ recovery: undefined, code: undefined }]);
    hash = "#recovery=start-secret";
    onHashChange?.();
    expect(received.at(-1)).toEqual({ recovery: "start-secret", code: undefined });
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/password-recovery");
    unsubscribe();
    expect(stop).toHaveBeenCalledOnce();
  });

  test("renders role-specific login forms with generic recovery messaging", () => {
    const owner = renderToStaticMarkup(<OwnerLoginForm />);
    const contact = renderToStaticMarkup(<ContactLoginForm />);
    expect(owner).toContain("管理员登录");
    expect(owner).toContain("如已配置恢复邮箱，我们将发送后续说明");
    expect(contact).toContain("联系人登录");
    expect(contact).toContain("姓名");
    expect(contact).not.toContain("管理员登录");
  });
});
