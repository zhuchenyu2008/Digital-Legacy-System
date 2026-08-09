import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SimulationConsole } from "./simulation-console.js";

describe("simulation console", () => {
  it("labels the surface as test mode and exposes every deterministic milestone", () => {
    const html = renderToStaticMarkup(
      <SimulationConsole defaultOwnerEmail="owner+simulation@example.test" />,
    );

    expect(html).toContain("测试模式");
    expect(html).toContain("创建仿真场景");
    expect(html).toContain("签到到期");
    expect(html).toContain("联系人决策");
    expect(html).toContain("恢复阈值");
    expect(html).toContain("释放倒计时");
    expect(html).toContain("SMTP 失败重试");
    expect(html).toContain("最终发布");
    expect(html).toContain("重置仿真");
  });
});
