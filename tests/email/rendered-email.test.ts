import { describe, expect, test } from "vitest";
import {
  renderTemplate,
  SYNTHETIC_TEMPLATE_CONTEXTS,
  TEMPLATE_CODES,
} from "../../packages/email-templates/src/index.js";

function normalizedStructure(html: string) {
  const nativeHeadings = [...html.matchAll(/<h[1-2][^>]*>(.*?)<\/h[1-2]>/giu)];
  const semanticHeadings = [...html.matchAll(/<[^>]+role="heading"[^>]*>(.*?)<\/[^>]+>/giu)];
  return {
    headings: [...nativeHeadings, ...semanticHeadings].map((match) =>
      match[1]?.replace(/<[^>]+>/gu, "").trim(),
    ),
    buttons: [...html.matchAll(/<a[^>]*class="[^"]*button[^"]*"[^>]*>(.*?)<\/a>/giu)].map((match) =>
      match[1]?.replace(/<[^>]+>/gu, "").trim(),
    ),
    hasPlainUrl: /class="[^"]*plain-url/iu.test(html),
    hasResponsiveRule: /@media[^}]*max-width:\s*480px/iu.test(html),
  };
}

describe("rendered email clients", () => {
  test.each(TEMPLATE_CODES)(
    "keeps %s readable at 600px and 320px without remote content",
    async (code) => {
      const rendered = await renderTemplate(code, SYNTHETIC_TEMPLATE_CONTEXTS[code]);
      expect(rendered.html).toContain("max-width: 600px");
      expect(rendered.html).not.toMatch(/<script|<form|<img|<iframe|tracking|javascript:/iu);
      expect(rendered.text.length).toBeGreaterThan(40);
      const structure = normalizedStructure(rendered.html);
      expect(structure.headings.length).toBeGreaterThan(0);
      expect(structure.buttons.length).toBeLessThanOrEqual(1);
      expect(structure.hasResponsiveRule).toBe(true);
      if (rendered.html.includes("href=")) expect(structure.hasPlainUrl).toBe(true);
    },
  );

  test("preserves long Chinese names, long URLs, and HTML/text link parity", async () => {
    const longUrl = `https://example.test/contact/invitation#token=${"a".repeat(512)}`;
    const rendered = await renderTemplate("CONTACT_INVITATION", {
      ...SYNTHETIC_TEMPLATE_CONTEXTS.CONTACT_INVITATION,
      owner_name: "张".repeat(100),
      contact_name: "李".repeat(100),
      action_url: longUrl,
    });
    expect(rendered.text).toContain(longUrl);
    expect(rendered.html.replaceAll("&amp;", "&").replaceAll("&#x3D;", "=")).toContain(longUrl);
    expect(normalizedStructure(rendered.html)).toMatchSnapshot();
  });

  test("preserves the supplied urgent visual hierarchy for the two referenced emails", async () => {
    const release = await renderTemplate(
      "DEATH_STAGE2_REMINDER",
      SYNTHETIC_TEMPLATE_CONTEXTS.DEATH_STAGE2_REMINDER,
    );
    expect(release.html).toContain("email-urgent-header");
    expect(release.html).toContain("email-countdown");
    expect(release.html).toContain("URGENT");

    const confirmation = await renderTemplate(
      "DEATH_CONFIRMATION_REQUEST",
      SYNTHETIC_TEMPLATE_CONTEXTS.DEATH_CONFIRMATION_REQUEST,
    );
    expect(confirmation.html).toContain("email-alert-strip");
    expect(confirmation.html).toContain("email-confidential");
    expect(confirmation.html).toContain("STRICTLY CONFIDENTIAL / URGENT");
  });
});
