import { readFile } from "node:fs/promises";
import Handlebars from "handlebars";
import juice from "juice";
import type { TemplateCode } from "./template-codes.js";
import { TEMPLATE_CONTRACTS } from "./template-contracts.js";

export type RenderedEmailTemplate = Readonly<{
  subject: string;
  html: string;
  text: string;
  templateCode: TemplateCode;
  templateVersion: number;
}>;

const templateCache = new Map<string, Promise<string>>();

function asset(path: string): Promise<string> {
  const existing = templateCache.get(path);
  if (existing !== undefined) return existing;
  const loaded = readFile(new URL(path, import.meta.url), "utf8");
  templateCache.set(path, loaded);
  return loaded;
}

function formatBeijing(value: string, field: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be an ISO instant`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}（北京时间）`;
}

function sanitizeContext(
  code: TemplateCode,
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  const contract = TEMPLATE_CONTRACTS[code];
  const actual = Object.keys(input);
  const unknown = actual.filter((field) => !contract.required.includes(field));
  if (unknown.length > 0) throw new Error(`unknown template fields: ${unknown.join(", ")}`);
  const missing = contract.required.filter((field) => !actual.includes(field));
  if (missing.length > 0) throw new Error(`missing template fields: ${missing.join(", ")}`);
  const context: Record<string, string> = {};
  for (const field of contract.required) {
    const value = input[field];
    if (typeof value !== "string" || value.length === 0 || value.length > 2_000) {
      throw new Error(`${field} must be a non-empty string`);
    }
    if (
      Array.from(value).some((character) => {
        const code = character.codePointAt(0) ?? 0;
        return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
      })
    ) {
      throw new Error(`${field} contains control characters`);
    }
    if (contract.urlFields.includes(field)) {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username !== "" ||
        url.password !== ""
      ) {
        throw new Error(`${field} must be an HTTP(S) URL without credentials`);
      }
    }
    if (field === "sha256" && !/^[0-9a-f]{64}$/u.test(value)) {
      throw new Error("sha256 must be lowercase hexadecimal");
    }
    context[field] = contract.timeFields.includes(field) ? formatBeijing(value, field) : value;
  }
  return Object.freeze(context);
}

function compile(source: string, noEscape = false) {
  return Handlebars.compile(source, {
    strict: true,
    noEscape,
    knownHelpersOnly: true,
    knownHelpers: {},
    assumeObjects: false,
  });
}

function assertSafeOutput(html: string): void {
  if (/<(?:script|form|img|iframe|object|embed|link)\b|javascript:|data:/iu.test(html)) {
    throw new Error("email template emitted forbidden active or remote content");
  }
}

export async function renderTemplate(
  code: TemplateCode,
  input: Readonly<Record<string, unknown>>,
): Promise<RenderedEmailTemplate> {
  const contract = TEMPLATE_CONTRACTS[code];
  const context = sanitizeContext(code, input);
  const [bodySource, textSource, layoutSource, css] = await Promise.all([
    asset(`./templates/${contract.file}.hbs`),
    asset(`./text/${contract.file}.txt.hbs`),
    asset("./layouts/base.hbs"),
    asset("./styles/email.css"),
  ]);
  const body = compile(bodySource)(context);
  const html = juice(compile(layoutSource)({ body, css }), {
    applyStyleTags: true,
    removeStyleTags: true,
    preserveMediaQueries: true,
  });
  assertSafeOutput(html);
  const subject = compile(contract.subject)(context)
    .replace(/[\r\n]+/gu, " ")
    .trim();
  const text = compile(textSource, true)(context).replace(/\r\n/gu, "\n").trim();
  return Object.freeze({
    subject,
    html,
    text,
    templateCode: code,
    templateVersion: contract.version,
  });
}
