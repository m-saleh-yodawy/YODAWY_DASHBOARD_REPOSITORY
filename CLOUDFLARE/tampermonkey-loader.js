// ==UserScript==
// @name         YODAWY CLOUD LOADER
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        unsafeWindow
// @connect      yodawy-dashboard.m-saleh-yodawy.workers.dev
// @noframes
// ==/UserScript==
(async()=>{const p=unsafeWindow,a='https://yodawy-dashboard.m-saleh-yodawy.workers.dev',k='__YD_CLOUD_LOADER__';if(p[k])return;p[k]=1;const get=u=>new Promise((r,j)=>GM_xmlhttpRequest({method:'GET',url:u,anonymous:true,nocache:true,timeout:8000,onload:x=>x.status===200&&x.responseText?.trim()?r(x.responseText):j(),onerror:j,ontimeout:j,onabort:j}));const match=(v,s)=>{let i=0;return v.split('*').every((x,n)=>{const j=s.indexOf(x,i);if(j<0||(!n&&j))return false;i=j+x.length;return true})&&(v.endsWith('*')||i===s.length)};try{const c=JSON.parse(await get(a+'/site-access.json')),h=p.location.hostname.toLowerCase(),t=p.location.protocol,n=p.location.pathname;if(c.enabled!==true||!c.sites?.some(s=>s.enabled&&(s.host===h||s.host.startsWith('*.')&&h.endsWith(s.host.slice(1)))&&s.protocols?.includes(t)&&s.paths?.some(v=>match(v,n))))return delete p[k];await new Function('PAGE','STORE',await get(a+'/cloud-bootstrap.js'))(p,{get:GM_getValue,set:GM_setValue,remove:GM_deleteValue})}catch{delete p[k]}})();