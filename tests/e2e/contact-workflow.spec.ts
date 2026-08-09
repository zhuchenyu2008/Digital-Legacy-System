import { expect, test } from "@playwright/test";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("contact decision supports keyboard, IME, focus restoration, paste policy, and a double-submit lock", async ({
  page,
}) => {
  await page.goto("/contact/workflows/current");

  const aliveTrigger = page.getByRole("button", { name: "选择：仍然健在" });
  await aliveTrigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "确认：仍然健在" });
  await expect(dialog).toBeVisible();

  const confirmation = dialog.getByRole("textbox", { name: "确认文字", exact: true });
  await expect(confirmation).toBeFocused();
  await confirmation.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "陈" }));
  });
  await expect(dialog.getByRole("status")).toContainText("正在使用输入法输入");
  await confirmation.evaluate((element) => {
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "陈" }));
  });

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(aliveTrigger).toBeFocused();

  await page.keyboard.press("Enter");
  const target = "我确认陈明仍然健在，并终止本次确认流程";
  await page.evaluate(async (value) => navigator.clipboard.writeText(value), target);
  await confirmation.focus();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(confirmation).toHaveValue("");

  await confirmation.fill(`${target} `);
  const submit = dialog.getByRole("button", { name: "确认提交：仍然健在" });
  await expect(submit).toBeDisabled();
  await confirmation.fill(target);

  const password = dialog.getByLabel(/联系人密码/u);
  await page.evaluate(
    async (value) => navigator.clipboard.writeText(value),
    "contact-password-123",
  );
  await password.focus();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(password).toHaveValue("contact-password-123");
  await expect(submit).toBeEnabled();

  await submit.focus();
  await page.keyboard.press("Tab");
  await expect(confirmation).toBeFocused();

  await submit.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByRole("heading", { name: "此操作已关闭" })).toBeVisible();
  const counts = await page.evaluate(async () =>
    fetch("/api/__test/counts").then((response) => response.json()),
  );
  expect(counts).toEqual({ confirmAlive: 1 });
});
