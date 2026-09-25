export type TelegramButtonStyle = "primary" | "success" | "danger";

export type DesignedButton = {
  text: string;
  callback_data: string;
  style?: TelegramButtonStyle;
};

function normalizeButtonLabel(value:string){
  const raw=String(value??"").trim();
  if(!raw) return "›";
  const cleaned=raw.replace(/^[^A-Za-z\u0600-\u06FF\u0660-\u0669]+/u,"").trim();
  return cleaned ? "› "+cleaned : "›";
}

function semanticStyle(label:string,callbackData:string):TelegramButtonStyle|undefined{
  const text=String(label??"").trim();
  const data=String(callbackData??"");
  if(/^(?:بازگشت|‹|←)/.test(text)||/(^|:)back(?:$|:)/i.test(data)) return "primary";
  if(/(^|:)(on|enable)(:|$)/i.test(data)||/^(فعال‌سازی|فعال سازی|روشن)(\s|$)/i.test(text)) return "success";
  if(/(^|:)(off|disable)(:|$)/i.test(data)||/^(خاموش‌سازی|خاموش سازی|خاموش|غیرفعال‌سازی|غیرفعال سازی)(\s|$)/i.test(text)) return "danger";
  return undefined;
}

export function glassButton(label:string,callbackData:string):DesignedButton{
  const text=normalizeButtonLabel(label);
  // Telegram InlineKeyboardButton does not accept an arbitrary "style" field.
  // Keep semanticStyle() for local classification, but serialize only Telegram-supported fields.
  return {text,callback_data:callbackData};
}

export function glassKeyboard(rows:string[][][]){
  return {inline_keyboard: rows.map(row=>row.map(([label,callbackData])=>glassButton(label,callbackData)))};
}
