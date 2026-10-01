import { useEffect, useMemo, useRef, useState } from "react";
import { Bold, ChevronDown, ChevronUp, Code2, Copy, Eye, FilePlus2, Highlighter, Image, Italic, Link2, List, Plus, Quote, Rows3, Strikethrough, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel } from "./panel";
import {
  decodeRichDocument,
  encodeRichDocument,
  markdownToRichText,
  getRichDocumentStats,
  type RichBlock,
  type RichDocument,
} from "@/lib/bot/rich-message";

function block(type: string): RichBlock {
  if (type === "heading") return { type: "heading", text: "عنوان جدید", size: 2 };
  if (type === "paragraph") return { type: "paragraph", text: "متن جدید" };
  if (type === "divider") return { type: "divider" };
  if (type === "pre") return { type: "pre", text: "کد", language: "text" };
  if (type === "blockquote") return { type: "blockquote", text: "نقل‌قول" };
  if (type === "expandable_blockquote") return { type: "expandable_blockquote", text: "نقل‌قول قابل بازشدن" };
  if (type === "pullquote") return { type: "pullquote", text: "نقل‌قول برجسته", credit: "" };
  if (type === "list") return { type: "list", style: "bullet", items: [{ blocks: [{ type: "paragraph", text: "آیتم جدید" }] }] };
  if (type === "details") return { type: "details", summary: "جزئیات", blocks: [{ type: "paragraph", text: "محتوای جزئیات" }] };
  if (type === "table") return { type: "table", is_bordered: true, is_compact: true, cells: [[{ text: "عنوان", is_header: true }], [{ text: "مقدار" }]] };
  if (type === "photo") return { type: "photo", photo: { type: "photo", media: "" }, caption: "" };
  if (type === "video") return { type: "video", video: { type: "video", media: "" }, caption: "" };
  if (type === "document") return { type: "document", document: { type: "document", media: "" }, caption: "" };
  if (type === "audio") return { type: "audio", audio: { type: "audio", media: "" }, caption: "" };
  if (type === "buttons") return { type: "buttons", align: "center", buttons: [{ text: "بازگشت", callback_data: "c:home", style: "primary" }] };
  if (type === "math") return { type: "mathematical_expression", expression: "x^2 + y^2 = r^2" };
  if (type === "anchor") return { type: "anchor", name: "section" };
  if (type === "map") return { type: "map", location: { latitude: 35.6892, longitude: 51.3890 }, zoom: 10, caption: "موقعیت" };
  return { type: "paragraph", text: "متن جدید" };
}

function fromValue(value: string, rtl: boolean): RichDocument {
  const existing = decodeRichDocument(value);
  if (existing) return existing;
  const lines = String(value || "").replace(/\r/g, "").split("\n");
  const result: RichBlock[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^◈\s*/u.test(line)) result.push({ type: "heading", text: line.replace(/^◈\s*/u, ""), size: 1 });
    else if (/^★\s*-\s*/u.test(line)) result.push({ type: "heading", text: line.replace(/^★\s*-\s*/u, ""), size: 3 });
    else result.push({ type: "paragraph", text: line.replace(/^[⛂●○■]\s*-\s*/u, "").trim() });
  }
  return { version: 1, is_rtl: rtl, blocks: result.length ? result : [block("paragraph")] };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function RichEditor({
  value,
  onChange,
  rtl = true,
}: {
  value: string;
  onChange: (value: string) => void;
  rtl?: boolean;
}) {
  const [doc, setDoc] = useState<RichDocument>(() => fromValue(value, rtl));
  const [preview, setPreview] = useState(true);
  const [source, setSource] = useState(false);

  useEffect(() => {
    const decoded = decodeRichDocument(value);
    if (decoded) setDoc(decoded);
  }, [value]);

  const stats = useMemo(() => getRichDocumentStats(doc), [doc]);

  function emit(next: RichDocument) {
    const normalized: RichDocument = { ...next, version: 1, is_rtl: rtl };
    setDoc(normalized);
    onChange(encodeRichDocument(normalized));
  }

  function update(index: number, patch: RichBlock) {
    const next = clone(doc);
    next.blocks[index] = { ...next.blocks[index], ...patch };
    emit(next);
  }

  function remove(index: number) {
    const next = clone(doc);
    next.blocks.splice(index, 1);
    if (!next.blocks.length) next.blocks.push(block("paragraph"));
    emit(next);
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= doc.blocks.length) return;
    const next = clone(doc);
    [next.blocks[index], next.blocks[target]] = [next.blocks[target], next.blocks[index]];
    emit(next);
  }

  function add(type: string) {
    const next = clone(doc);
    next.blocks.push(block(type));
    emit(next);
  }

  function addListItem(index: number) {
    const next = clone(doc);
    next.blocks[index].items = [...(next.blocks[index].items || []), { blocks: [{ type: "paragraph", text: "آیتم جدید" }] }];
    emit(next);
  }

  function updateListItem(index: number, itemIndex: number, text: string, checked?: boolean) {
    const next = clone(doc);
    const items = [...(next.blocks[index].items || [])];
    items[itemIndex] = { ...items[itemIndex], blocks: [{ type: "paragraph", text }], ...(checked === undefined ? {} : { is_checked: checked }) };
    next.blocks[index].items = items;
    emit(next);
  }

  function removeListItem(index: number, itemIndex: number) {
    const next = clone(doc);
    next.blocks[index].items = (next.blocks[index].items || []).filter((_: any, i: number) => i !== itemIndex);
    emit(next);
  }

  function addTableRow(index: number) {
    const next = clone(doc);
    const cells = next.blocks[index].cells || [];
    const cols = Math.max(1, cells[0]?.length || 1);
    next.blocks[index].cells = [...cells, Array.from({ length: cols }, () => ({ text: "مقدار" }))];
    emit(next);
  }

  function addTableColumn(index: number) {
    const next = clone(doc);
    next.blocks[index].cells = (next.blocks[index].cells || []).map((row: any[], r: number) => [...row, { text: r === 0 ? "عنوان" : "مقدار", ...(r === 0 ? { is_header: true } : {}) }]);
    emit(next);
  }

  function updateCell(index: number, r: number, c: number, text: string) {
    const next = clone(doc);
    const cells = [...(next.blocks[index].cells || [])];
    cells[r] = [...cells[r]];
    cells[r][c] = { ...cells[r][c], text };
    next.blocks[index].cells = cells;
    emit(next);
  }

  function updateButton(index: number, b: number, patch: Record<string, any>) {
    const next = clone(doc);
    const buttons = [...(next.blocks[index].buttons || [])];
    buttons[b] = { ...buttons[b], ...patch };
    next.blocks[index].buttons = buttons;
    emit(next);
  }

  function addButton(index: number) {
    const next = clone(doc);
    const buttons = [...(next.blocks[index].buttons || [])];
    if (buttons.length >= 8) return;
    buttons.push({ text: "دکمه جدید", callback_data: "c:home", style: "link" });
    next.blocks[index].buttons = buttons;
    emit(next);
  }

  function removeButton(index: number, b: number) {
    const next = clone(doc);
    next.blocks[index].buttons = (next.blocks[index].buttons || []).filter((_: any, i: number) => i !== b);
    emit(next);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{stats.blocks} بلوک</Badge>
          <Badge tone={stats.chars > 30000 ? "warn" : "ok"}>{stats.chars.toLocaleString("fa-IR")} / ۳۲۷۶۸ نویسه</Badge>
          <Badge>{stats.media} رسانه</Badge>
          <Badge>{stats.maxColumns} ستون</Badge>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant={preview ? "solid" : "ghost"} onClick={() => setPreview(!preview)}><Eye className="size-3.5" /> پیش‌نمایش</Button>
          <Button size="sm" variant={source ? "solid" : "ghost"} onClick={() => setSource(!source)}><Copy className="size-3.5" /> منبع</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 rounded-xl bg-surface p-2 ring-1 ring-line">
        <Button size="sm" variant="ghost" onClick={() => add("heading")}><FilePlus2 className="size-3.5" /> تیتر</Button>
        <Button size="sm" variant="ghost" onClick={() => add("paragraph")}><FilePlus2 className="size-3.5" /> متن</Button>
        <Button size="sm" variant="ghost" onClick={() => add("list")}><List className="size-3.5" /> لیست</Button>
        <Button size="sm" variant="ghost" onClick={() => add("table")}><Rows3 className="size-3.5" /> جدول</Button>
        <Button size="sm" variant="ghost" onClick={() => add("blockquote")}><Quote className="size-3.5" /> نقل‌قول</Button>
        <Button size="sm" variant="ghost" onClick={() => add("pre")}>کد</Button>
        <Button size="sm" variant="ghost" onClick={() => add("details")}>جزئیات</Button>
        <Button size="sm" variant="ghost" onClick={() => add("buttons")}>دکمه‌ها</Button>
        <Button size="sm" variant="ghost" onClick={() => add("photo")}><Image className="size-3.5" /> تصویر</Button>
        <Button size="sm" variant="ghost" onClick={() => add("video")}><Video className="size-3.5" /> ویدئو</Button>
        <Button size="sm" variant="ghost" onClick={() => add("document")}>سند</Button>
        <Button size="sm" variant="ghost" onClick={() => add("audio")}>صوت</Button>
        <Button size="sm" variant="ghost" onClick={() => add("math")}>فرمول</Button>
        <Button size="sm" variant="ghost" onClick={() => add("map")}>نقشه</Button>
        <Button size="sm" variant="ghost" onClick={() => add("divider")}>جداکننده</Button>
      </div>

      {source ? (
        <textarea
          dir="ltr"
          value={encodeRichDocument(doc)}
          onChange={(e) => {
            const parsed = decodeRichDocument(e.target.value);
            if (parsed) emit(parsed);
          }}
          className="min-h-72 w-full rounded-xl bg-bg p-3 font-mono text-[11px] leading-5 ring-1 ring-line outline-none focus:ring-accent/40"
        />
      ) : (
        <div className={preview ? "grid gap-4 xl:grid-cols-[1.15fr_.85fr]" : "grid gap-3"}>
          <div className="space-y-2">
            {doc.blocks.map((item, index) => (
              <BlockEditor
                key={index}
                block={item}
                index={index}
                count={doc.blocks.length}
                onUpdate={(patch) => update(index, patch)}
                onRemove={() => remove(index)}
                onUp={() => move(index, -1)}
                onDown={() => move(index, 1)}
                onAddListItem={() => addListItem(index)}
                onListItemChange={(i, text, checked) => updateListItem(index, i, text, checked)}
                onListItemRemove={(i) => removeListItem(index, i)}
                onAddTableRow={() => addTableRow(index)}
                onAddTableColumn={() => addTableColumn(index)}
                onCellChange={(r, c, text) => updateCell(index, r, c, text)}
                onButtonChange={(b, patch) => updateButton(index, b, patch)}
                onAddButton={() => addButton(index)}
                onRemoveButton={(b) => removeButton(index, b)}
              />
            ))}
          </div>
          {preview ? <Preview doc={doc} /> : null}
        </div>
      )}

      <p className="text-[10px] text-muted">
        این ویرایشگر خروجی Rich Message واقعی تولید می‌کند؛ رسانه‌های صریح در Bot API باید URL عمومی HTTP/HTTPS داشته باشند.
      </p>
    </div>
  );
}

function BlockEditor({
  block: item, index, count, onUpdate, onRemove, onUp, onDown,
  onAddListItem, onListItemChange, onListItemRemove,
  onAddTableRow, onAddTableColumn, onCellChange,
  onButtonChange, onAddButton, onRemoveButton,
}: any) {
  const type = String(item.type);
  return (
    <Panel className="bg-surface-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="accent">{type}</Badge>
          <span className="font-mono text-[9px] text-muted">BLOCK {String(index + 1).padStart(3, "0")}</span>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" disabled={index === 0} onClick={onUp}><ChevronUp className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" disabled={index === count - 1} onClick={onDown}><ChevronDown className="size-3.5" /></Button>
          <Button size="sm" variant="ghost" onClick={onRemove}><Trash2 className="size-3.5 text-danger" /></Button>
        </div>
      </div>

      <div className="mt-3">
        {type === "divider" ? <p className="text-xs text-muted">جداکننده</p> : null}

        {(type === "paragraph" || type === "heading" || type === "pre" || type === "blockquote" || type === "expandable_blockquote" || type === "pullquote") ? (
          <div className="grid gap-2">
            {type === "heading" ? (
              <label className="grid gap-1 text-[11px] text-muted">اندازه تیتر
                <select value={item.size || 2} onChange={(e) => onUpdate({ size: Number(e.target.value) })} className="h-9 rounded-lg bg-bg px-2 text-xs ring-1 ring-line">
                  {[1,2,3,4,5,6].map((x) => <option key={x} value={x}>H{x}</option>)}
                </select>
              </label>
            ) : null}
            {type === "pre" ? <input value={item.language || "text"} onChange={(e) => onUpdate({ language: e.target.value })} className="h-9 rounded-lg bg-bg px-3 text-xs ring-1 ring-line" placeholder="language" /> : null}
            <RichTextInput value={String(item.text || "")} rtl onChange={(text) => onUpdate({ text })} />
            {type === "pullquote" ? <input value={item.credit || ""} onChange={(e) => onUpdate({ credit: e.target.value })} className="h-9 rounded-lg bg-bg px-3 text-xs ring-1 ring-line" placeholder="credit" /> : null}
          </div>
        ) : null}

        {type === "details" ? (
          <div className="grid gap-2">
            <input value={item.summary || ""} onChange={(e) => onUpdate({ summary: e.target.value })} className="h-9 rounded-lg bg-bg px-3 text-xs ring-1 ring-line" placeholder="خلاصه جزئیات" />
            <RichTextInput value={String(item.blocks?.[0]?.text || "")} rtl onChange={(text) => onUpdate({ blocks: [{ type: "paragraph", text }] })} placeholder="محتوا" />
            <label className="flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={item.is_open === true} onChange={(e) => onUpdate({ is_open: e.target.checked })} /> باز به‌صورت پیش‌فرض</label>
          </div>
        ) : null}

        {type === "list" ? (
          <div className="grid gap-2">
            <select value={item.style || "bullet"} onChange={(e) => onUpdate({ style: e.target.value, ordered: e.target.value === "ordered", checklist: e.target.value === "checklist" })} className="h-9 rounded-lg bg-bg px-2 text-xs ring-1 ring-line">
              <option value="bullet">فهرست نقطه‌ای</option>
              <option value="ordered">فهرست شماره‌ای</option>
              <option value="checklist">چک‌لیست</option>
            </select>
            {(item.items || []).map((entry: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                {item.style === "checklist" ? <input type="checkbox" checked={entry.is_checked === true} onChange={(e) => onListItemChange(i, String(entry.blocks?.[0]?.text || ""), e.target.checked)} /> : null}
                <input value={String(entry.blocks?.[0]?.text || "")} onChange={(e) => onListItemChange(i, e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg bg-bg px-3 text-xs ring-1 ring-line" />
                <Button size="sm" variant="ghost" onClick={() => onListItemRemove(i)}><Trash2 className="size-3.5 text-danger" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={onAddListItem}><Plus className="size-3.5" /> افزودن آیتم</Button>
          </div>
        ) : null}

        {type === "table" ? (
          <div className="grid gap-2">
            {(item.cells || []).map((row: any[], r: number) => (
              <div key={r} className="grid gap-1" style={{ gridTemplateColumns: "repeat(" + Math.max(1, row.length) + ", minmax(0,1fr))" }}>
                {row.map((cell: any, c: number) => (
                  <input key={c} value={String(cell?.text || "")} onChange={(e) => onCellChange(r, c, e.target.value)} className={"h-9 rounded-lg bg-bg px-2 text-xs ring-1 ring-line " + (r === 0 ? "font-semibold" : "")} />
                ))}
              </div>
            ))}
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={onAddTableRow}>+ ردیف</Button>
              <Button size="sm" variant="ghost" onClick={onAddTableColumn}>+ ستون</Button>
              <label className="flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={item.is_bordered === true} onChange={(e) => onUpdate({ is_bordered: e.target.checked })} /> حاشیه</label>
              <label className="flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={item.is_striped === true} onChange={(e) => onUpdate({ is_striped: e.target.checked })} /> راه‌راه</label>
              <label className="flex items-center gap-2 text-[11px] text-muted"><input type="checkbox" checked={item.is_compact === true} onChange={(e) => onUpdate({ is_compact: e.target.checked })} /> فشرده</label>
            </div>
          </div>
        ) : null}

        {(type === "photo" || type === "video" || type === "document" || type === "audio") ? (
          <div className="grid gap-2">
            <input value={item[type]?.media || ""} onChange={(e) => onUpdate({ [type]: { type, media: e.target.value } })} className="h-9 rounded-lg bg-bg px-3 text-xs ring-1 ring-line" placeholder="https://..." dir="ltr" />
            <input value={String(item.caption || "")} onChange={(e) => onUpdate({ caption: e.target.value })} className="h-9 rounded-lg bg-bg px-3 text-xs ring-1 ring-line" placeholder="کپشن" />
          </div>
        ) : null}

        {type === "buttons" ? (
          <div className="grid gap-2">
            {(item.buttons || []).map((button: any, b: number) => (
              <div key={b} className="grid gap-2 rounded-xl bg-bg p-2 ring-1 ring-line sm:grid-cols-[1fr_9rem_1fr_6rem_auto]">
                <input value={String(button.text || "")} onChange={(e) => onButtonChange(b, { text: e.target.value })} className="h-9 rounded-lg bg-surface px-2 text-xs ring-1 ring-line" placeholder="متن دکمه" />
                <select value={button.callback_data ? "callback_data" : button.url ? "url" : button.copy_text ? "copy_text" : button.disabled ? "disabled" : "callback_data"} onChange={(e) => {
                  const kind = e.target.value;
                  const patch: Record<string, any> = { callback_data: undefined, url: undefined, copy_text: undefined, disabled: undefined };
                  if (kind === "callback_data") patch.callback_data = "sx:home";
                  if (kind === "url") patch.url = "https://telegram.org";
                  if (kind === "copy_text") patch.copy_text = { text: "کپی" };
                  if (kind === "disabled") patch.disabled = true;
                  onButtonChange(b, patch);
                }} className="h-9 rounded-lg bg-surface px-2 text-xs ring-1 ring-line">
                  <option value="callback_data">callback</option>
                  <option value="url">URL</option>
                  <option value="copy_text">کپی</option>
                  <option value="disabled">غیرفعال</option>
                </select>
                <input value={String(button.callback_data || button.url || button.copy_text?.text || "")} onChange={(e) => {
                  if (button.url) onButtonChange(b, { url: e.target.value });
                  else if (button.copy_text) onButtonChange(b, { copy_text: { text: e.target.value } });
                  else if (!button.disabled) onButtonChange(b, { callback_data: e.target.value });
                }} className="h-9 rounded-lg bg-surface px-2 text-xs ring-1 ring-line" placeholder="target" dir="ltr" disabled={!!button.disabled} />
                <select value={button.style || "link"} onChange={(e) => onButtonChange(b, { style: e.target.value })} className="h-9 rounded-lg bg-surface px-2 text-xs ring-1 ring-line">
                  <option value="primary">primary</option><option value="success">success</option><option value="link">link</option><option value="danger">danger</option>
                </select>
                <Button size="sm" variant="ghost" onClick={() => onRemoveButton(b)}><Trash2 className="size-3.5 text-danger" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={onAddButton}><Plus className="size-3.5" /> دکمه جدید</Button>
          </div>
        ) : null}

        {type === "mathematical_expression" ? <input value={item.expression || ""} onChange={(e) => onUpdate({ expression: e.target.value })} className="h-10 rounded-lg bg-bg px-3 text-sm ring-1 ring-line" dir="ltr" /> : null}
        {type === "anchor" ? <input value={item.name || ""} onChange={(e) => onUpdate({ name: e.target.value })} className="h-10 rounded-lg bg-bg px-3 text-sm ring-1 ring-line" placeholder="anchor-name" dir="ltr" /> : null}
        {type === "map" ? <div className="grid gap-2 sm:grid-cols-3"><input value={item.location?.latitude || ""} onChange={(e) => onUpdate({ location: { ...item.location, latitude: Number(e.target.value) } })} className="h-9 rounded-lg bg-bg px-2 text-xs ring-1 ring-line" placeholder="latitude" /><input value={item.location?.longitude || ""} onChange={(e) => onUpdate({ location: { ...item.location, longitude: Number(e.target.value) } })} className="h-9 rounded-lg bg-bg px-2 text-xs ring-1 ring-line" placeholder="longitude" /><input value={item.zoom || 10} onChange={(e) => onUpdate({ zoom: Number(e.target.value) })} className="h-9 rounded-lg bg-bg px-2 text-xs ring-1 ring-line" placeholder="zoom" /></div> : null}
      </div>
    </Panel>
  );
}


function RichTextInput({
  value,
  onChange,
  rtl = true,
  placeholder = "",
}: {
  value: string;
  onChange: (value: string) => void;
  rtl?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function wrap(open: string, close: string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const body = selected || "متن";
    const next = value.slice(0, start) + open + body + close + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const caretStart = start + open.length;
      el.setSelectionRange(caretStart, caretStart + body.length);
    });
  }

  return (
    <div className="overflow-hidden rounded-xl bg-bg ring-1 ring-line focus-within:ring-accent/40">
      <div className="flex flex-wrap gap-1 border-b border-line p-1.5">
        <ToolButton title="Bold" onClick={() => wrap("**", "**")}><Bold className="size-3.5" /></ToolButton>
        <ToolButton title="Italic" onClick={() => wrap("*", "*")}><Italic className="size-3.5" /></ToolButton>
        <ToolButton title="Strikethrough" onClick={() => wrap("~~", "~~")}><Strikethrough className="size-3.5" /></ToolButton>
        <ToolButton title="Spoiler" onClick={() => wrap("||", "||")}>S</ToolButton>
        <ToolButton title="Marked" onClick={() => wrap("==", "==")}><Highlighter className="size-3.5" /></ToolButton>
        <ToolButton title="Code" onClick={() => wrap("\`", "\`")}><Code2 className="size-3.5" /></ToolButton>
        <ToolButton title="Link" onClick={() => wrap("[", "](https://example.com)")}><Link2 className="size-3.5" /></ToolButton>
      </div>
      <textarea
        ref={ref}
        dir={rtl ? "rtl" : "ltr"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-24 w-full resize-y bg-transparent p-3 text-sm leading-6 outline-none"
      />
    </div>
  );
}

function ToolButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return <Button type="button" size="sm" variant="ghost" title={title} onClick={onClick} className="px-2">{children}</Button>;
}

function InlinePreview({ value }: { value: string }) {
  const nodes: any = markdownToRichText(value);
  const list = Array.isArray(nodes) ? nodes : [nodes];
  return <>{list.map((node:any,i:number) => <InlineNode key={i} node={node} />)}</>;
}

function InlineNode({ node }: { node: any }) {
  if (typeof node === "string" || typeof node === "number") return <span>{String(node)}</span>;
  if (Array.isArray(node)) return <>{node.map((x:any,i:number)=><InlineNode key={i} node={x}/>)}</>;
  const inner = <InlinePreview value={typeof node?.text === "string" ? node.text : ""} />;
  if (node?.type === "bold") return <strong>{inner}</strong>;
  if (node?.type === "italic") return <em>{inner}</em>;
  if (node?.type === "strikethrough") return <s>{inner}</s>;
  if (node?.type === "spoiler") return <span className="rounded bg-fg/80 px-1 text-transparent hover:text-fg">{inner}</span>;
  if (node?.type === "marked") return <mark className="rounded px-0.5">{inner}</mark>;
  if (node?.type === "code") return <code className="rounded bg-surface-2 px-1 font-mono text-xs">{node.text || ""}</code>;
  if (node?.type === "url") return <a href={node.url} target="_blank" rel="noreferrer" className="underline decoration-accent/60 underline-offset-2">{inner}</a>;
  return inner;
}

function Preview({ doc }: { doc: RichDocument }) {
  return (
    <Panel className="h-fit lg:sticky lg:top-28">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-mono text-[9px] text-accent">TELEGRAM RICH PREVIEW</p>
          <h3 className="text-sm font-semibold">پیش‌نمایش پیام</h3>
        </div>
        <Badge tone="ok">RTL</Badge>
      </div>
      <div dir={doc.is_rtl === false ? "ltr" : "rtl"} className="rounded-2xl bg-bg p-3 ring-1 ring-line">
        {doc.blocks.map((b, i) => <PreviewBlock key={i} block={b} />)}
      </div>
    </Panel>
  );
}

function PreviewBlock({ block: b }: { block: RichBlock }) {
  const type = String(b.type);
  if (type === "divider") return <hr className="my-3 border-line" />;
  if (type === "heading") {
    const Tag = b.size === 1 ? "h2" : b.size <= 3 ? "h3" : "h4";
    return <Tag className="mb-2 mt-2 font-semibold leading-tight"><InlinePreview value={String(b.text || "عنوان")} /></Tag>;
  }
  if (type === "paragraph" || type === "footer") return <p className="my-2 text-sm leading-6 whitespace-pre-wrap"><InlinePreview value={String(b.text || "")} /></p>;
  if (type === "pre") return <pre dir="ltr" className="my-2 overflow-auto rounded-xl bg-surface-2 p-3 text-xs">{b.text || ""}</pre>;
  if (["blockquote","expandable_blockquote","pullquote"].includes(type)) return <blockquote className="my-2 rounded-xl border-s-2 border-accent bg-surface-2 p-3 text-sm leading-6"><InlinePreview value={String(b.text || "")} />{b.blocks ? b.blocks.map((x:any,i:number)=><PreviewBlock key={i} block={x}/>) : null}{b.credit ? <footer className="mt-1 text-[10px] text-muted"><InlinePreview value={String(b.credit)} /></footer> : null}</blockquote>;
  if (type === "details") return <details open={b.is_open === true} className="my-2 rounded-xl bg-surface-2 p-3"><summary className="cursor-pointer font-medium">{b.summary || "جزئیات"}</summary><div className="mt-2 text-sm leading-6">{b.blocks?.map((x:any,i:number)=><PreviewBlock key={i} block={x}/>)}</div></details>;
  if (type === "list") return <ul className={"my-2 space-y-1 ps-5 " + (b.style === "ordered" ? "list-decimal" : "list-disc")}>{(b.items || []).map((x:any,i:number)=><li key={i} className="text-sm">{x.is_checked ? "☑ " : b.style === "checklist" ? "☐ " : ""}{x.blocks?.[0]?.text || ""}</li>)}</ul>;
  if (type === "table") return <div className="my-3 overflow-x-auto"><table className="w-full border-collapse text-xs"><tbody>{(b.cells || []).map((row:any[],r:number)=><tr key={r}>{row.map((cell:any,c:number)=>{const Cell=r===0?"th":"td";return <Cell key={c} className={"border border-line p-2 " + (r===0?"font-semibold bg-surface-2":"")}><InlinePreview value={String(cell?.text || "")} /></Cell>})}</tr>)}</tbody></table></div>;
  if (type === "buttons") return <div className="my-2 flex flex-wrap gap-1.5 justify-center">{(b.buttons || []).map((x:any,i:number)=><span key={i} className={"rounded-lg px-3 py-1.5 text-[11px] ring-1 ring-line " + (x.style === "primary" ? "bg-fg text-bg" : "bg-surface-2")}>{x.text || "دکمه"}</span>)}</div>;
  if (type === "photo") return <div className="my-2 overflow-hidden rounded-xl bg-surface-2">{b.photo?.media ? <img src={b.photo.media} alt="" className="max-h-64 w-full object-cover" /> : <div className="p-5 text-center text-xs text-muted">URL تصویر</div>}{b.caption ? <div className="p-2 text-xs">{b.caption}</div> : null}</div>;
  if (type === "video") return <div className="my-2 rounded-xl bg-surface-2 p-4 text-center text-xs text-muted">ویدئو: {b.video?.media || "URL ویدئو"}{b.caption ? <div className="mt-1 text-fg">{b.caption}</div> : null}</div>;
  if (["document","audio"].includes(type)) return <div className="my-2 rounded-xl bg-surface-2 p-3 text-xs">{type}: {b[type]?.media || "URL"}{b.caption ? <div className="mt-1">{b.caption}</div> : null}</div>;
  if (type === "mathematical_expression") return <div dir="ltr" className="my-2 rounded-xl bg-surface-2 p-3 text-center font-mono text-xs">{b.expression}</div>;
  if (type === "map") return <div className="my-2 rounded-xl bg-surface-2 p-3 text-xs">نقشه · {b.location?.latitude}, {b.location?.longitude} · زوم {b.zoom}</div>;
  if (type === "anchor") return <div className="my-2 text-[10px] text-muted">anchor: {b.name}</div>;
  return <p className="my-2 text-sm">{b.text || ""}</p>;
}
