import { createHash } from "node:crypto";

import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
] as const;

export type RenderedWill = Readonly<{
  html: string;
  sourceBytes: number;
  sourceSha256: string;
  renderedSha256: string;
}>;

export function renderWill(source: string): RenderedWill {
  const sourceBytes = Buffer.byteLength(source, "utf8");
  const sourceSha256 = createHash("sha256").update(source, "utf8").digest("hex");
  const markdown = marked.parse(source, { async: false, gfm: true, breaks: false }) as string;
  const html = sanitizeHtml(markdown, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { a: ["http", "https", "mailto"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => {
        const href = attributes.href ?? "";
        if (/^https?:\/\//iu.test(href)) {
          return {
            tagName: "a",
            attribs: {
              ...attributes,
              target: "_blank",
              rel: "noopener noreferrer",
            },
          };
        }
        return { tagName: "a", attribs: attributes };
      },
    },
  });
  return {
    html,
    sourceBytes,
    sourceSha256,
    renderedSha256: createHash("sha256").update(html, "utf8").digest("hex"),
  };
}
