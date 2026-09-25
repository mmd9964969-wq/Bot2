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
  const raw=(label+" "+callbackData).toLowerCase();

  // Destructive actions are red.
  if(
    /(^|:)(delete|remove|block|ban|kick|exit|off|disable|danger|reset|clear)/i.test(callbackData) ||
    /(حذف|پاک|مسدود|بن|اخراج|خروج|خاموش|غیرفعال|خطر|بازنشانی)/i.test(label)
  ) return "danger";

  // Positive / enabling actions are green.
  if(
    /(^|:)(confirm|enable|on|approve|accept|success)/i.test(callbackData) ||
    /(تایید|تأیید|فعال|روشن|ادامه|بله|ثبت)/i.test(label)
  ) return "success";

  // Primary blue is intentionally reserved for top-level navigation only.
  if(
    /^c:(locks|warnings|members|welcome|commands|stats|schedule|security|status)$/.test(callbackData) ||
    /^(مدیریت گروه|مرکز قفل|قفل و کنترل محتوا|اخطار و جریمه|مدیریت اعضا|آمار|امنیت|تنظیمات)$/i.test(raw.trim())
  ) return "primary";

  // Neutral buttons remain transparent, creating the premium/glass hierarchy.
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
