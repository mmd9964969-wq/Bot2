export type RichBlock = Record<string, any>;
export type RichDocument = {
  version: 1;
  is_rtl?: boolean;
  blocks: RichBlock[];
};

export const RICH_DOCUMENT_PREFIX = "PERSIANBOT_RICH_V1:";

export function encodeRichDocument(doc: RichDocument): string {
  return RICH_DOCUMENT_PREFIX + JSON.stringify(doc);
}

export function decodeRichDocument(value: unknown): RichDocument | null {
  const raw = String(value ?? "");
  if (!raw.startsWith(RICH_DOCUMENT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw.slice(RICH_DOCUMENT_PREFIX.length));
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || !Array.isArray(parsed.blocks)) {
      return null;
    }
    return parsed as RichDocument;
  } catch {
    return null;
  }
}

function textFromRich(value: any): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(textFromRich).join("");
  if (typeof value === "object") {
    if (value.type === "text") return String(value.text ?? "");
    if (value.text !== undefined) return textFromRich(value.text);
    if (value.label !== undefined) return textFromRich(value.label);
  }
  return "";
}

function blockPlain(block: any, depth = 0): string[] {
  if (!block || depth > 16) return [];
  const type = String(block.type ?? "");
  switch (type) {
    case "paragraph":
    case "heading":
    case "pre":
    case "preformatted":
    case "footer":
    case "blockquote":
    case "expandable_blockquote":
    case "pullquote":
      return [textFromRich(block.text ?? block.caption ?? "")];
    case "divider":
      return [""];
    case "math":
    case "mathematical_expression":
      return [String(block.expression ?? "")];
    case "anchor":
      return [];
    case "list":
      return (Array.isArray(block.items) ? block.items : []).flatMap((item: any, i: number) => {
        const marker = block.ordered ? String(i + 1) + ". " : block.checklist ? (item?.is_checked ? "☑ " : "☐ ") : "• ";
        const body = Array.isArray(item?.blocks) ? item.blocks.flatMap((x: any) => blockPlain(x, depth + 1)) : [textFromRich(item?.text ?? "")];
        return [marker + body.filter(Boolean).join(" ")];
      });
    case "details":
      return [textFromRich(block.summary), ...(Array.isArray(block.blocks) ? block.blocks.flatMap((x: any) => blockPlain(x, depth + 1)) : [])];
    case "table":
      return [
        ...(block.caption ? [textFromRich(block.caption)] : []),
        ...(Array.isArray(block.cells) ? block.cells.map((row: any[]) => row.map(textFromRich).join(" | ")) : []),
      ];
    case "buttons":
      return [(Array.isArray(block.buttons) ? block.buttons : []).map((b: any) => "[" + textFromRich(b?.text) + "]").join("  ")];
    case "map":
      return [block.caption ? textFromRich(block.caption) : "موقعیت نقشه"];
    case "photo":
    case "video":
    case "audio":
    case "document":
    case "animation":
    case "voice_note":
      return [block.caption ? textFromRich(block.caption) : ""];
    case "collage":
    case "slideshow":
      return Array.isArray(block.blocks) ? block.blocks.flatMap((x: any) => blockPlain(x, depth + 1)) : [];
    default:
      return [textFromRich(block.text ?? block.caption ?? "")];
  }
}

export function richDocumentToPlainText(doc: RichDocument): string {
  return doc.blocks.flatMap((block) => blockPlain(block)).join("\n").replace(/\n{3,}/g, "\n\n").trim() || "بدون محتوا";
}

function mapStrings(value: any, resolver: (key: string) => string): any {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) => resolver(String(key)) ?? "—");
  }
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, resolver));
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) out[key] = mapStrings(item, resolver);
    return out;
  }
  return value;
}

export function replaceRichVariables(doc: RichDocument, resolver: (key: string) => string): RichDocument {
  return mapStrings(doc, resolver) as RichDocument;
}

export function renderStudioTemplate(template: string, values: Record<string, string>): string {
  const rich = decodeRichDocument(template);
  if (rich) {
    const rendered = replaceRichVariables(rich, (key) => values[key] ?? "—");
    return encodeRichDocument(rendered);
  }
  return String(template ?? "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) => values[String(key)] ?? "—");
}

type RichStats = { blocks: number; chars: number; media: number; maxColumns: number; maxDepth: number };

function inspectValue(value: any, depth: number, stats: RichStats) {
  if (depth > stats.maxDepth) stats.maxDepth = depth;
  if (typeof value === "string") {
    stats.chars += Array.from(value).length;
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) inspectValue(item, depth, stats);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (value.type && String(value.type).toLowerCase().includes("photo")) stats.media += 1;
  for (const item of Object.values(value)) inspectValue(item, depth + 1, stats);
}

function countBlocks(blocks: any[], depth: number, stats: RichStats) {
  for (const block of blocks) {
    stats.blocks += 1;
    if (block?.type === "table" && Array.isArray(block.cells)) {
      stats.maxColumns = Math.max(stats.maxColumns, ...block.cells.map((r: any[]) => r.length));
      stats.blocks += block.cells.length;
    }
    if (block?.type === "list" && Array.isArray(block.items)) stats.blocks += block.items.length;
    if (Array.isArray(block?.blocks)) countBlocks(block.blocks, depth + 1, stats);
  }
}

export function getRichDocumentStats(doc: RichDocument) {
  const stats: RichStats = { blocks: 0, chars: 0, media: 0, maxColumns: 0, maxDepth: 0 };
  countBlocks(doc.blocks, 1, stats);
  inspectValue(doc.blocks, 1, stats);
  return stats;
}

export function validateRichDocument(doc: RichDocument) {
  const errors: string[] = [];
  if (!doc || doc.version !== 1 || !Array.isArray(doc.blocks)) errors.push("ساختار Rich Document نامعتبر است.");
  const stats = doc ? getRichDocumentStats(doc) : { blocks: 0, chars: 0, media: 0, maxColumns: 0, maxDepth: 0 };
  if (stats.chars > 32768) errors.push("متن غنی بیش از ۳۲۷۶۸ نویسه دارد.");
  if (stats.blocks > 500) errors.push("تعداد بلوک‌ها و آیتم‌های تو‌در‌تو بیش از ۵۰۰ است.");
  if (stats.maxDepth > 16) errors.push("عمق تو‌در‌تو بیش از ۱۶ سطح است.");
  if (stats.media > 50) errors.push("تعداد رسانه‌ها بیش از ۵۰ مورد است.");
  for (const block of doc?.blocks ?? []) {
    if (block?.type === "table" && Array.isArray(block.cells) && block.cells.some((row: any[]) => row.length > 20)) {
      errors.push("هر جدول حداکثر ۲۰ ستون می‌تواند داشته باشد.");
    }
    if (block?.type === "buttons" && (!Array.isArray(block.buttons) || block.buttons.length < 1 || block.buttons.length > 8)) {
      errors.push("هر ردیف دکمه باید ۱ تا ۸ دکمه داشته باشد.");
    }
    if (block?.type === "media") errors.push("بلوک media عمومی پشتیبانی نمی‌شود؛ از photo/video/document/audio استفاده کنید.");
  }
  return { ok: errors.length === 0, errors, stats };
}
