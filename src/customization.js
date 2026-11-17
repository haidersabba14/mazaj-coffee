export const preferenceChoices={theme:['dark','light','system'],cards:['normal','compact','rounded'],view:['board','list'],tone:['royal','bell','bright'],background:['forest','charcoal','coffee'],font:['system','serif','rounded'],icons:['outline','filled']};
export const sectionChoices=['orders','kitchen','pickup','products','loyalty','notifications','report','team','audit','settings','appearance','devices','management','ingredients','archives','customers','planning','seasons','security','restore','gifts','branches','images'];
export const shortcutChoices=['accepted','preparing','ready','delivered','cancelled','call'];
export const metricChoices=['daily','weekly','waiting','preparing','ready'];
export function validatePreferences(input,fail){
 if(!input||Array.isArray(input)||typeof input!=='object')fail('إعدادات غير صالحة');const v={};for(const [k,allowed]of Object.entries(preferenceChoices)){if(input[k]!==undefined){if(!allowed.includes(input[k]))fail('قيمة تخصيص غير صالحة');v[k]=input[k];}}
 if(input.accent!==undefined){if(!/^#[0-9a-fA-F]{6}$/.test(input.accent))fail('لون غير صالح');v.accent=input.accent;}
 for(const k of ['sound','vibration'])if(input[k]!==undefined){if(typeof input[k]!=='boolean')fail('إعداد صوت غير صالح');v[k]=input[k];}
 if(input.volume!==undefined){if(!Number.isFinite(input.volume)||input.volume<0||input.volume>1)fail('مستوى صوت غير صالح');v.volume=input.volume;}
 for(const [k,allowed]of [['sections',sectionChoices],['shortcuts',shortcutChoices],['metrics',metricChoices]])if(input[k]!==undefined){if(!Array.isArray(input[k])||input[k].length>allowed.length||new Set(input[k]).size!==input[k].length||input[k].some(x=>!allowed.includes(x)))fail('ترتيب تخصيص غير صالح');v[k]=input[k];}return v;
}
