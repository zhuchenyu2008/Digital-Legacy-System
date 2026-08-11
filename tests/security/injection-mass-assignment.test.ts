import { describe, expect, it } from "vitest";
import { parseCreateContactInvitation } from "../../apps/api/src/contacts/contact.dto.js";
import { parseOwnerArm } from "../../apps/api/src/owner/owner.dto.js";
import {
  normalizeContactName,
  normalizeEmail,
} from "../../packages/application/src/contacts/contact-common.js";
import { createRepositories } from "../../packages/persistence/src/postgres/pg-repositories.js";
import { renderWill } from "../../packages/storage/src/archive/render-will.js";

describe("injection and mass-assignment boundaries", () => {
  it("does not copy unknown or prototype-pollution fields into commands", () => {
    const body = JSON.parse(
      '{"password":"owner-password","confirmationText":"ARMED","isAdmin":true,"__proto__":{"polluted":true}}',
    ) as unknown;
    const parsed = parseOwnerArm(body);
    expect(parsed).toEqual({ password: "owner-password", confirmationText: "ARMED" });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("rejects null, arrays, and empty required fields instead of coercing them", () => {
    expect(() => parseCreateContactInvitation(null)).toThrow(/object/i);
    expect(() => parseCreateContactInvitation([])).toThrow(/object/i);
    expect(() =>
      parseCreateContactInvitation({ displayName: "", email: "x@example.test" }),
    ).toThrow(/displayName/i);
    expect(() => parseCreateContactInvitation({ displayName: "x", email: "" })).toThrow(/email/i);
  });

  it("keeps SQL control text in parameter values and rejects injected identifiers", async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = [];
    const repositories = createRepositories({
      query: async (text: string, values: readonly unknown[] = []) => {
        queries.push({ text, values });
        return { rows: [] };
      },
    } as never);
    const attack = "victim@example.test' OR 1=1 --";

    await expect(repositories.contacts.findOneBy("email", attack)).resolves.toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).not.toContain(attack);
    expect(queries[0]?.values).toEqual([attack]);
    await expect(repositories.contacts.findOneBy('email" OR TRUE --', attack)).rejects.toThrow(
      /identifier/i,
    );
  });

  it("removes active content and unsafe links from stored Markdown", () => {
    const rendered = renderWill(
      [
        "# Safe heading",
        '<img src=x onerror="alert(1)">',
        "<script>alert(2)</script>",
        "[javascript](javascript:alert(3))",
        "[data](data:text/html,boom)",
        "[protocol-relative](//evil.example/collect)",
        "[external](https://example.test/path)",
      ].join("\n\n"),
    );

    expect(rendered.html).not.toMatch(/<script|<img|onerror|javascript:|data:text|evil\.example/iu);
    expect(rendered.html).toContain('href="https://example.test/path"');
    expect(rendered.html).toContain('rel="noopener noreferrer"');
  });

  it("normalizes names canonically and rejects ambiguous email/name controls", () => {
    expect(normalizeContactName("  Jose\u0301  ")).toBe("Jos\u00e9");
    expect(normalizeEmail("  USER@EXAMPLE.TEST  ")).toBe("user@example.test");

    for (const name of [
      "Alice\r\nBcc: victim@example.test",
      "Alice\u200bAdmin",
      "Alice\u202eAdmin",
    ]) {
      expect(() => normalizeContactName(name)).toThrow(/invalid/i);
    }
    for (const email of [
      "user\r\n@example.test",
      "user\u200b@example.test",
      "us\u0435r@example.test",
      "user@ex\u0430mple.test",
    ]) {
      expect(() => normalizeEmail(email)).toThrow(/invalid/i);
    }
  });
});
