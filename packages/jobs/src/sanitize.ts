import sanitizeHtml from "sanitize-html";

/**
 * Job descriptions come from third-party job boards, so they are untrusted. They are sanitized
 * once at ingestion with a strict allow-list (no scripts, styles, images, iframes or event
 * handlers) and the result is what the web app renders.
 */
const JOB_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "ul",
    "ol",
    "li",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "h2",
    "h3",
    "h4",
    "h5",
    "blockquote",
    "code",
    "pre",
    "a",
    "hr",
  ],
  // rel/target are always overwritten by the transform below.
  allowedAttributes: { a: ["href", "rel", "target"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    h1: "h2",
    h6: "h5",
    div: "p",
    a: sanitizeHtml.simpleTransform("a", {
      rel: "noopener noreferrer nofollow",
      target: "_blank",
    }),
  },
  exclusiveFilter: (frame) => ["p", "li"].includes(frame.tag) && !frame.text.trim(),
};

export function sanitizeJobHtml(html: string): string {
  return sanitizeHtml(html, JOB_HTML_OPTIONS).trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  hellip: "…",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
};

/** Decodes HTML entities (Greenhouse returns job content entity-escaped). */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Readable plain text (paragraphs and bullets preserved) for search, matching and AI prompts. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n• ")
    .replace(/<\/\s*(p|div|ul|ol|h\d|blockquote|pre|tr)\s*>/gi, "\n");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return decodeEntities(stripped)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n+(?=• )/g, "\n")
    .trim();
}
