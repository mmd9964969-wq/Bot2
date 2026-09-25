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

export function glassButton(label:string,callbackData:string):DesignedButton{
  const text=glassLabel(label);
  let style:TelegramButtonStyle|undefined;

  if(
    /(^|:)(delete|remove|block|ban|kick|exit|off|disable|danger|reset)/i.test(callbackData) ||
    /(حذف|پاک|مسدود|بن|اخراج|خروج|خاموش|غیرفعال|بازنشانی)/i.test(label)
  ) style="danger";
  else if(
    /(^|:)(confirm|enable|on|approve|accept|success)/i.test(callbackData) ||
    /(تایید|فعال|ادامه|بله|تأیید)/i.test(label)
  ) style="success";
  else if(
    /(^|:)(home|stats|status|settings|customers|licenses|locks|warnings|members|security|commands|schedule)/i.test(callbackData) ||
    /(مدیریت|مرکز|وضعیت|آمار|تنظیمات|قفل|اخطار|اعضا|امنیت|دستورات|زمان)/i.test(label)
  ) style="primary";

  return style ? {text,callback_data:callbackData,style} : {text,callback_data:callbackData};
}

export function glassKeyboard(rows:string[][][]){
  return {
    inline_keyboard: rows.map(row=>row.map(([label,callbackData])=>glassButton(label,callbackData)))
  };
}
