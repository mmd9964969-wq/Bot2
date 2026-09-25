export type TelegramButtonStyle = "primary" | "success" | "danger";

export type DesignedButton = {
  text: string;
  callback_data: string;
  style?: TelegramButtonStyle;
};

export function glassLabel(value:string){
  const label=String(value??"").trim();
  if(!label) return "›";
  if(label.startsWith("‹")||label.startsWith("←")) return label;
  if(label.startsWith("›")) return label;
  return "› "+label.replace(/^❯›\s*/,"");
}

function semanticStyle(label:string,callbackData:string):TelegramButtonStyle|undefined{
  const text=String(label??"").trim();
  const data=String(callbackData??"");

  // Back/navigation remains the only always-blue action.
  if(text.startsWith("‹")||text.startsWith("←")) return "primary";

  // Only explicit state-changing ON/OFF controls receive colors.
  if(
    /(^|:)(on|enable|confirm|approve|accept)(:|$)/i.test(data) ||
    /^(فعال|روشن|تأیید|تایید|ادامه|ثبت)(\s|$)/i.test(text)
  ) return "primary";

  if(
    /(^|:)(off|disable|delete|remove|block|ban|kick|danger|reset|clear)(:|$)/i.test(data) ||
    /^(خاموش|غیرفعال|حذف|پاک|مسدود|بن|اخراج|بازنشانی)(\s|$)/i.test(text)
  ) return "danger";

  // All ordinary buttons stay neutral/glass.
  return undefined;
}

export function glassButton(label:string,callbackData:string):DesignedButton{
  const text=glassLabel(label);
  const style=semanticStyle(label,callbackData);
  return style ? {text,callback_data:callbackData,style} : {text,callback_data:callbackData};
}

export function glassKeyboard(rows:string[][][]){
  return {
    inline_keyboard: rows.map(row=>row.map(([label,callbackData])=>glassButton(label,callbackData)))
  };
}
