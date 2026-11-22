(function(page){
'use strict';
if(page.YODAWY_INPUT_TYPOGRAPHY)return;
const doc=page.document;
const selector='input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="image"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]):not([type="range"]):not([type="color"]),textarea,select,[contenteditable]:not([contenteditable="false"])';
const arabic=/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const latin=/[A-Za-z]/;
const originals=new WeakMap();
const tracked=new Set();
let observer=null;
let frame=0;
const pending=new Set();
const fontLinks=[
 ['yd-nunito-sans-font','https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,300..900&display=swap'],
 ['yd-cairo-font','https://fonts.googleapis.com/css2?family=Cairo:wght@300..900&display=swap']
];
const loadFonts=()=>{
 for(const [id,href] of fontLinks){
  let link=doc.getElementById(id);
  if(!link){
   link=doc.createElement('link');
   link.id=id;
   link.rel='stylesheet';
   link.href=href;
   (doc.head||doc.documentElement).append(link);
  }
 }
};
const isArabic=element=>{
 const lang=String(element.closest('[lang]')?.getAttribute('lang')||doc.documentElement.lang||'').toLowerCase();
 if(lang==='ar'||lang.startsWith('ar-'))return true;
 if(element.closest('[dir="rtl"]')||element.getAttribute('dir')==='rtl')return true;
 const value=String(element instanceof page.HTMLSelectElement?[...element.selectedOptions].map(option=>option.textContent).join(' '):'value'in element?element.value:element.textContent||'').trim();
 if(arabic.test(value))return true;
 if(latin.test(value))return false;
 const hint=String(element.getAttribute('placeholder')||element.getAttribute('aria-label')||element.getAttribute('title')||'');
 if(arabic.test(hint))return true;
 try{if(element.matches(':dir(rtl)'))return true;}catch{}
 return false;
};
const apply=element=>{
 if(!(element instanceof page.HTMLElement)||!element.matches(selector))return;
 if(!originals.has(element))originals.set(element,['font-family','font-size','line-height'].map(name=>[name,element.style.getPropertyValue(name),element.style.getPropertyPriority(name)]));
 tracked.add(element);
 element.style.setProperty('font-family',isArabic(element)?"'Cairo',sans-serif":"'Nunito Sans',Arial,sans-serif",'important');
 element.style.setProperty('font-size','16px','important');
 element.style.setProperty('line-height','20px','important');
};
const scan=node=>{
 if(node.nodeType!==1)return;
 apply(node);
 node.querySelectorAll?.(selector).forEach(apply);
};
const schedule=node=>{
 pending.add(node);
 if(frame)return;
 frame=page.requestAnimationFrame(()=>{
  frame=0;
  const nodes=[...pending];
  pending.clear();
  nodes.forEach(scan);
 });
};
const onInput=event=>apply(event.target);
const start=()=>{
 if(!doc.body)return;
 loadFonts();
 doc.querySelectorAll(selector).forEach(apply);
 doc.addEventListener('input',onInput,true);
 doc.addEventListener('change',onInput,true);
 doc.addEventListener('focusin',onInput,true);
 const forget=node=>{
  if(node.nodeType!==1)return;
  if(node.matches?.(selector))tracked.delete(node);
  node.querySelectorAll?.(selector).forEach(element=>tracked.delete(element));
 };
 observer=new MutationObserver(records=>{
  for(const record of records){
   for(const node of record.removedNodes)forget(node);
   for(const node of record.addedNodes)schedule(node);
  }
 });
 observer.observe(doc.body,{childList:true,subtree:true});
};
const destroy=()=>{
 observer?.disconnect();
 observer=null;
 if(frame)page.cancelAnimationFrame(frame);
 frame=0;
 pending.clear();
 doc.removeEventListener('input',onInput,true);
 doc.removeEventListener('change',onInput,true);
 doc.removeEventListener('focusin',onInput,true);
 for(const element of tracked){
  const values=originals.get(element);
  if(!element.isConnected||!values)continue;
  for(const [name,value,priority] of values){
   if(value)element.style.setProperty(name,value,priority);
   else element.style.removeProperty(name);
  }
 }
 tracked.clear();
 delete page.YODAWY_INPUT_TYPOGRAPHY;
 return true;
};
page.YODAWY_INPUT_TYPOGRAPHY=Object.freeze({apply,refresh:()=>doc.querySelectorAll(selector).forEach(apply),destroy});
if(doc.body)start();else doc.addEventListener('DOMContentLoaded',start,{once:true});
})(window);
