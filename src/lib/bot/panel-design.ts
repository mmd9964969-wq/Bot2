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

  // Back/navigation is the only always-blue navigation action.
  if(text.startsWith("‹")||text.startsWith("←")) return "primary";

  // Only explicit ON/OFF state controls are colored.
  if(
    /(^|:)(on|enable)(:|$)/i.test(data) ||
    /^(فعال‌سازی|فعال سازی|روشن)(\s|$)/i.test(text)
  ) return "primary";

  if(
    /(^|:)(off|disable)(:|$)/i.test(data) ||
    /^(خاموش‌سازی|خاموش سازی|خاموش|غیرفعال‌سازی|غیرفعال سازی)(\s|$)/i.test(text)
  ) return "danger";

  // Every other button remains neutral/glass.
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
