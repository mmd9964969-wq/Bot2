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



export function markdownToRichText(input: string): any {
  const source = String(input ?? "");
  const token = new RegExp("(\\*\\*([^*]+)\\*\\*|~~([^~]+)~~|\\|\\|([^|]+)\\|\\||==([^=]+)==|`([^`]+)`|\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\))", "g");
  const out: any[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    if (match.index > last) out.push(source.slice(last, match.index));
    if (match[2] !== undefined) out.push({ type: "bold", text: markdownToRichText(match[2]) });
    else if (match[3] !== undefined) out.push({ type: "strikethrough", text: markdownToRichText(match[3]) });
    else if (match[4] !== undefined) out.push({ type: "spoiler", text: markdownToRichText(match[4]) });
    else if (match[5] !== undefined) out.push({ type: "marked", text: markdownToRichText(match[5]) });
    else if (match[6] !== undefined) out.push({ type: "code", text: match[6] });
    else if (match[7] !== undefined) out.push({ type: "url", text: markdownToRichText(match[7]), url: match[8] });
    last = token.lastIndex;
  }
  if (last < source.length) out.push(source.slice(last));
  return out.length === 1 ? out[0] : out;
}

const MEDIA_TYPES = new Set(["photo", "video", "audio", "document", "animation", "voice_note"]);

function normalizeBlock(block: RichBlock): RichBlock {
  const next: RichBlock = { ...block };
  if (next.type === "blockquote" && Array.isArray(next.blocks) === false && next.text !== undefined) {
    next.blocks = [{ type: "paragraph", text: next.text }];
    delete next.text;
  }
  if (next.type === "list" && Array.isArray(next.items)) {
    const style = String(next.style || "bullet");
    next.items = next.items.map((item: any, index: number) => {
      const row = { ...item };
      if (style === "checklist") {
        row.has_checkbox = true;
        row.is_checked = row.is_checked === true;
      } else if (style === "ordered") {
        row.type = "1";
        row.value = index + 1;
      }
      delete row.style;
      return row;
    });
    delete next.style;
    delete next.ordered;
    delete next.checklist;
  }
  if (next.type === "buttons" && Array.isArray(next.buttons)) {
    next.buttons = next.buttons.slice(0, 8).map((button: any) => {
      const b = { ...button };
      if (b.url && b.style === "link") b.style = "primary";
      return b;
    });
  }
  if (Array.isArray(next.blocks)) next.blocks = next.blocks.map(normalizeBlock);
  if (Array.isArray(next.items)) {
    next.items = next.items.map((item: any) => ({
      ...item,
      ...(Array.isArray(item.blocks) ? { blocks: item.blocks.map(normalizeBlock) } : {}),
    }));
  }
  if (Array.isArray(next.cells)) {
    next.cells = next.cells.map((row: any[]) => row.map((cell: any) => {
      if (!cell || typeof cell !== "object") return { text: String(cell ?? "") };
      return { ...cell };
    }));
  }
  return next;
}

function compileBlock(block: RichBlock): RichBlock {
  const next = normalizeBlock(block);
  const richTextFields = ["text", "caption", "summary", "credit"];
  for (const key of richTextFields) {
    if (typeof next[key] === "string" && key !== "text" && next.type === "buttons") continue;
    if (typeof next[key] === "string") next[key] = markdownToRichText(next[key]);
  }
  if (next.type === "buttons" && Array.isArray(next.buttons)) {
    next.buttons = next.buttons.map((button: any) => ({ ...button, text: typeof button.text === "string" ? button.text : button.text }));
  }
  if (next.type === "table" && Array.isArray(next.cells)) {
    next.cells = next.cells.map((row: any[]) => row.map((cell: any) => {
      const item = { ...cell };
      if (typeof item.text === "string") item.text = markdownToRichText(item.text);
      return item;
    }));
  }
  if (Array.isArray(next.blocks)) next.blocks = next.blocks.map(compileBlock);
  if (Array.isArray(next.items)) next.items = next.items.map((item: any) => ({
    ...item,
    ...(Array.isArray(item.blocks) ? { blocks: item.blocks.map(compileBlock) } : {}),
  }));
  return next;
}

export function prepareRichDocument(doc: RichDocument): RichDocument {
  return {
    version: 1,
    is_rtl: doc.is_rtl,
    blocks: (doc.blocks || []).map(compileBlock),
  };
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
  if (value.type && MEDIA_TYPES.has(String(value.type).toLowerCase())) stats.media += 1;
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
    if (block?.type === "buttons" && Array.isArray(block.buttons)) {
      for (const button of block.buttons) {
        if (button?.callback_data && new TextEncoder().encode(String(button.callback_data)).length > 64) errors.push("callback_data هر دکمه نباید بیش از ۶۴ بایت باشد.");
        if (button?.url && button?.style === "link") errors.push("سبک link فقط برای دکمه‌های callback مجاز است.");
      }
    }
    if (block?.type === "media") errors.push("بلوک media عمومی پشتیبانی نمی‌شود؛ از photo/video/document/audio استفاده کنید.");
  }
  return { ok: errors.length === 0, errors, stats };
}
