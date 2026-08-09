import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { designTokens, minimumContrastRatio } from "../../styles/design-tokens";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Field } from "./field";
import { Progress } from "./progress";

describe("visual contract and UI primitives", () => {
  test("keeps documented text pairings at WCAG AA contrast", () => {
    expect(minimumContrastRatio(designTokens.onSurface, designTokens.surface)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(minimumContrastRatio(designTokens.onPrimary, designTokens.primary)).toBeGreaterThanOrEqual(
      4.5,
    );
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
});
