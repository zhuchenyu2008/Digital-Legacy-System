import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { designTokens, minimumContrastRatio } from "../../styles/design-tokens";
import { activateMaterialSymbols } from "../fonts/material-symbols";
import { Icon } from "../icons/icon";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Field } from "./field";
import { Progress } from "./progress";

describe("visual contract and UI primitives", () => {
  test("keeps documented text pairings at WCAG AA contrast", () => {
    expect(
      minimumContrastRatio(designTokens.onSurface, designTokens.surface),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      minimumContrastRatio(designTokens.onPrimary, designTokens.primary),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      minimumContrastRatio(designTokens.textSecondary, designTokens.surfaceContainerLowest),
    ).toBeGreaterThanOrEqual(4.5);
  });

  test("renders named buttons, related field errors, dialog semantics, and progress labels", () => {
    const html = renderToStaticMarkup(
      <>
        <Button>保存配置</Button>
        <Field
          error="主密码不能为空"
          id="master-password"
          label="主密码"
          name="password"
          type="password"
        />
        <Dialog description="此操作将终止释放流程" open title="确认终止">
          <p>请输入主密码继续。</p>
        </Dialog>
        <Progress label="确认进度" max={3} value={2} />
      </>,
    );

    expect(html).toContain("<button");
    expect(html).toContain(">保存配置</span>");
    expect(html).toContain('for="master-password"');
    expect(html).toContain('aria-describedby="master-password-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="确认进度"');
    expect(html).toContain('aria-valuenow="2"');
  });

  test("activates supplied Material Symbols only after the font loads and preserves icon sizing", async () => {
    const classes: string[] = [];
    const load = vi.fn().mockResolvedValue([{}]);
    const check = vi.fn().mockReturnValue(true);

    await activateMaterialSymbols(
      { classList: { add: (value: string) => classes.push(value) } },
      { check, load },
    );

    expect(load).toHaveBeenCalledWith('400 24px "Material Symbols Outlined"');
    expect(classes).toContain("dls-material-symbols-ready");
    expect(renderToStaticMarkup(<Icon name="fingerprint" size={48} />)).toContain(
      "--dls-icon-size:48px",
    );
    expect(renderToStaticMarkup(<Icon name="user" />)).toContain(">account_circle</span>");
    expect(renderToStaticMarkup(<Icon name="file" />)).toContain(">description</span>");
    expect(renderToStaticMarkup(<Icon name="notification" />)).toContain(">notifications</span>");
  });
});
