import type { Page } from "@playwright/test";
import {
  renderTemplate,
  SYNTHETIC_TEMPLATE_CONTEXTS,
} from "../../packages/email-templates/src/index.js";
import type { DesignSource } from "./design-sources.js";

export async function selectScenario(page: Page, scenario: DesignSource["scenario"]) {
  await page.request.post("/api/__test/scenario", { data: { scenario } });
}

export async function stabilizePage(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
}

export async function captureDesign(page: Page, source: DesignSource): Promise<Buffer> {
  await page.setViewportSize({ width: source.width, height: source.height });
  await selectScenario(page, source.scenario);
  if (source.kind === "email") {
    const code = source.templateCode;
    if (code === undefined) throw new Error("email design is missing templateCode");
    const rendered = await renderTemplate(code, SYNTHETIC_TEMPLATE_CONTEXTS[code]);
    await page.setContent(rendered.html, { waitUntil: "load" });
    await page.addStyleTag({
      content:
        "html,body{height:100%}body{zoom:1.25}.email-frame{height:100%}.email-frame>tbody>tr>td{vertical-align:middle}",
    });
  } else {
    await page.goto(source.route ?? "/", { waitUntil: "networkidle" });
  }
  await stabilizePage(page);
  return page.screenshot({
    animations: "disabled",
    fullPage: false,
    omitBackground: source.id === "04",
  });
}
