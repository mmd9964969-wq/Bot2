export type TelegramButtonStyle = "primary" | "success" | "danger";

export type DesignedButton = {
  text: string;
  callback_data: string;
  style?: TelegramButtonStyle;
};

function rawButtonText(value:string){
  return String(value??"").trim();
}

function cleanButtonLabel(value:string){
  const raw=rawButtonText(value);
  return raw.replace(/^[^A-Za-z\u0600-\u06FF\u0660-\u0669]+/u,"").trim();
}

function semanticStyle(label:string,callbackData:string):TelegramButtonStyle|undefined{
  const text=rawButtonText(label);
  const data=String(callbackData??"");
  if(/^(?:‹\s*)?بازگشت(?:\s|$)/u.test(text)||/^(?:‹|←)\s*/u.test(text)||/(^|:)back(?:$|:)/i.test(data)) return "primary";
  if(/(?:^|:)(?:on|enable)(?::|$)/i.test(data)||/^(?:فعال‌سازی|فعال سازی|روشن)(?:\s|$)/u.test(text)) return "success";
  if(/(?:^|:)(?:off|disable)(?::|$)/i.test(data)||/^(?:خاموش‌سازی|خاموش سازی|خاموش|غیرفعال‌سازی|غیرفعال سازی)(?:\s|$)/u.test(text)) return "danger";
  return undefined;
}

function visualButtonLabel(label:string,style:TelegramButtonStyle|undefined){
  const raw=rawButtonText(label);
  const clean=cleanButtonLabel(raw);
  if(!clean)return style==="primary"?"‹":"›";
  if(style==="primary")return "‹ "+clean;
  return "› "+clean;
}

export function glassButton(label:string,callbackData:string):DesignedButton{
  const style=semanticStyle(label,callbackData);
  // Telegram Bot API native button styles carry the color; labels stay clean.
  return {text:visualButtonLabel(label,style),callback_data:callbackData,...(style?{style}: {})};
}

export function glassKeyboard(rows:string[][][]){
  return {inline_keyboard: rows.map(row=>row.map(([label,callbackData])=>glassButton(label,callbackData)))};
}
