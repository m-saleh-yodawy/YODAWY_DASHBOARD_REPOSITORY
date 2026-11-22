// ==UserScript==
// @name         Stock Checker
// @namespace    https://odoo.yodawy.com/
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @grant        none
// ==/UserScript==

(async function(){
'use strict';

const LOCATIONS={Gold:'GW/Stock',Silver:'SIW/Stock',Platinum:'AR-PP/Stock'};
const ID='ms-stock-hzb-checker';
let locationsCache=null;

async function rpc(model,method,kwargs){
    const r=await fetch(`/web/dataset/call_kw/${model}/${method}`,{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            jsonrpc:'2.0',
            method:'call',
            params:{model,method,args:[],kwargs},
            id:Date.now()+Math.random()
        })
    });
    const d=await r.json();
    if(d.error)throw Error(d.error.data?.message||d.error.message||'RPC Error');
    return d.result;
}

async function getLocations(){
    if(locationsCache)return locationsCache;

    const entries=await Promise.all(Object.entries(LOCATIONS).map(async([type,name])=>{
        const rows=await rpc('stock.location','search_read',{
            domain:['|',['complete_name','=',name],['name','=',name]],
            fields:['id','name','complete_name'],
            limit:20
        });
        const location=rows?.find(x=>x.complete_name===name)||rows?.[0];
        return {type,name,id:location?.id||null};
    }));

    if(entries.some(x=>!x.id))throw Error('Stock locations not found');

    locationsCache=entries;
    return entries;
}

function productData(p){
    return {
        id:p.id,
        display_name:p.display_name||p.name||'',
        default_code:p.default_code||'',
        barcode:p.barcode||'',
        hb_id:p.hb_id||'',
        lst_price:Number(p.lst_price||0)
    };
}

async function searchStockProducts(value){
    const text=value.trim();
    if(!text)return[];

    const locations=await getLocations();
    const locationIds=locations.map(x=>x.id);

    const quantRows=await rpc('stock.quant','search_read',{
        domain:['&',['location_id','in',locationIds],['product_id','ilike',text]],
        fields:['product_id','location_id'],
        limit:1000
    });

    const productIds=[...new Set(quantRows.map(x=>x.product_id?.[0]).filter(Boolean))];

    if(!productIds.length){
        const rows=await rpc('product.product','search_read',{
            domain:[
                '|','|','|',
                ['default_code','ilike',text],
                ['barcode','ilike',text],
                ['name','ilike',text],
                ['hb_id','ilike',text]
            ],
            fields:['id','name','display_name','default_code','barcode','hb_id','lst_price'],
            limit:100
        });
        return rows.map(productData);
    }

    const rows=await rpc('product.product','search_read',{
        domain:[['id','in',productIds]],
        fields:['id','name','display_name','default_code','barcode','hb_id','lst_price'],
        limit:1000,
        order:'name asc'
    });

    return rows.map(productData).sort((a,b)=>a.display_name.localeCompare(b.display_name,undefined,{numeric:true,sensitivity:'base'}));
}

async function stocksForProduct(productId){
    const locations=await getLocations();

    const rows=await rpc('stock.quant','search_read',{
        domain:[
            ['location_id','in',locations.map(x=>x.id)],
            ['product_id','=',productId]
        ],
        fields:['product_id','quantity','reserved_quantity','location_id'],
        limit:5000
    });

    const result={};
    locations.forEach(x=>{
        result[x.type]={quantity:0,location:x.name};
    });

    const map=new Map(locations.map(x=>[x.id,x.type]));

    rows.forEach(row=>{
        const type=map.get(row.location_id?.[0]);
        if(!type)return;
        result[type].quantity+=Number(row.quantity||0)-Number(row.reserved_quantity||0);
    });

    return result;
}

function escapeHTML(value){
    return String(value??'')
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/'/g,'&#039;');
}

function getPriceInfo(product){
    const text=String(product.display_name||product.name||'')
        .toLowerCase()
        .replace(/[(),]/g,' ')
        .replace(/\s+/g,' ')
        .trim();

    const price=Number(product.lst_price||0);
    const units={
        flexpen:'FLEXPEN',
        syringe:'SYRINGE',
        amp:'AMP',
        penfil:'PENFIL',
        vial:'VIAL',
        sachet:'SACHET',
        strip:'STRIP'
    };

    const patterns=[
        ['flexpen',/(\d+(?:\.\d+)?)\s*(?:flexpen|flexpens|flexben|flexbens)\b/i],
        ['syringe',/(\d+(?:\.\d+)?)\s*(?:syringe|syringes|سرنجة|سرنجات)\b/i],
        ['amp',/(\d+(?:\.\d+)?)\s*(?:amp|amps|ampoule|ampoules|ampule|ampules|امبول|امبولات|أمبول|أمبولات)\b/i],
        ['penfil',/(\d+(?:\.\d+)?)\s*(?:penfil|penfils|penfill|penfills)\b/i],
        ['vial',/(\d+(?:\.\d+)?)\s*(?:vial|vials|فيال|فيالات|قارورة|قوارير)\b/i],
        ['sachet',/(\d+(?:\.\d+)?)\s*(?:sachet|sachets|ساشيه|ساشيهات)\b/i],
        ['strip',/(\d+(?:\.\d+)?)\s*(?:strip|strips|شريط|شرائط)\b/i]
    ];

    for(const [type,regex] of patterns){
        const match=text.match(regex);
        if(match){
            const count=Number(match[1]);
            if(count>0){
                return {
                    unitPrice:price,
                    unit:units[type],
                    boxPrice:price*count,
                    box:'BOX'
                };
            }
        }
    }

    if(/\b(?:oral\s+drops?|drops?|solution|syrup|cream|ointment|gel|lotion|spray|powder|suspension|emulsion|soap|shampoo|mouthwash)\b|(?:نقط|قطرة|شراب|كريم|مرهم|جل|لوشن|بخاخ|بودرة|معلق|مستحلب)/i.test(text)){
        return {unitPrice:price,unit:'BOX',boxPrice:price,box:'BOX'};
    }

    if(/\bbox(?:es)?\b|علبة|علب/i.test(text)){
        return {unitPrice:price,unit:'BOX',boxPrice:price,box:'BOX'};
    }

    if(/\b(?:penfil|penfils|penfill|penfills|cartridge|cartridges|carroule|carroules)\b|خرطوشة|خراطيش/i.test(text)){
        return {unitPrice:price,unit:'PENFIL',boxPrice:null,box:'BOX'};
    }

    if(/\bsachet(?:s)?\b|ساشيه|ساشيهات/i.test(text)){
        return {unitPrice:price,unit:'SACHET',boxPrice:null,box:'BOX'};
    }

    if(/\bvial(?:s)?\b|فيال|فيالات|قارورة|قوارير/i.test(text)){
        return {unitPrice:price,unit:'VIAL',boxPrice:null,box:'BOX'};
    }

    if(/\bflexpen(?:s)?\b|\bflexben(?:s)?\b/i.test(text)){
        return {unitPrice:price,unit:'FLEXPEN',boxPrice:null,box:'BOX'};
    }

    if(/\bsyringe(?:s)?\b|سرنجة|سرنجات/i.test(text)){
        return {unitPrice:price,unit:'SYRINGE',boxPrice:null,box:'BOX'};
    }

    if(/\b(?:amp|amps|ampoule|ampoules|ampule|ampules)\b|امبول|امبولات|أمبول|أمبولات/i.test(text)){
        return {unitPrice:price,unit:'AMP',boxPrice:null,box:'BOX'};
    }

    if(/\b(?:strip|strips)\b|شريط|شرائط/i.test(text)){
        return {unitPrice:price,unit:'STRIP',boxPrice:null,box:'BOX'};
    }

    return {unitPrice:price,unit:'BOX',boxPrice:price,box:'BOX'};
}

function priceHTML(product){
    const info=getPriceInfo(product);
    let html=`${info.unitPrice.toFixed(2)} L.E / ${escapeHTML(info.unit)}`;

    if(info.boxPrice!==null&&Number.isFinite(info.boxPrice)&&info.unit!=='BOX'){
        html+=`<span style="margin-left:10px;color:#999!important">•</span><span style="margin-left:10px">${info.boxPrice.toFixed(2)} L.E / ${escapeHTML(info.box)}</span>`;
    }

    return html;
}

function createUI(){
    if(document.getElementById(ID))return;

    const icons={
        cubes:'<svg class="ms-stock-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m12 2 8 4.5-8 4.5-8-4.5L12 2Z"/><path d="M4 6.5v9L12 20l8-4.5v-9M12 11v9M8 4.25l8 4.5"/></svg>',
        close:'<svg class="ms-stock-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>',
        search:'<svg class="ms-stock-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>',
        spinner:'<svg class="ms-stock-icon ms-stock-spinner" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>'
    };

    const host=document.createElement('div');
    host.id=ID;
    host.style.cssText='all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;z-index:2147482000!important;pointer-events:none!important;display:block!important;font-family:"Nunito Sans",Arial,sans-serif!important';
    document.body.appendChild(host);

    host.innerHTML=`
<style>
@import url('https://fonts.googleapis.com/css2?family=Nunito+Sans:opsz,wght@6..12,300..900&display=swap');
#ms-stock-hzb-checker{pointer-events:none!important}
#ms-stock-hzb-checker,#ms-stock-hzb-checker *{box-sizing:border-box!important}
#ms-stock-hzb-checker *{font-family:'Nunito Sans',Arial,sans-serif!important}
#ms-stock-hzb-checker:has(#ms-stock-panel.open){background:#17131c85!important;backdrop-filter:blur(4px)!important;pointer-events:none!important}
#ms-stock-panel{position:absolute!important;top:50%!important;left:50%!important;display:none!important;flex-direction:column!important;width:min(900px,calc(100vw - 48px))!important;height:min(680px,calc(100vh - 48px))!important;max-height:calc(100vh - 24px)!important;transform:translate(-50%,-50%)!important;overflow:hidden!important;border:1px solid #d9d9de!important;border-radius:16px!important;background:#f7f6f8!important;color:#18181b!important;box-shadow:0 28px 80px #17131c40!important;pointer-events:auto!important}
#ms-stock-panel.open{display:flex!important}
#ms-stock-header{display:flex!important;flex:0 0 60px!important;align-items:center!important;justify-content:space-between!important;gap:14px!important;padding:0 20px!important;border-bottom:1px solid #d9d2df!important;background:#fff!important}
#ms-stock-title{display:flex!important;align-items:center!important;gap:11px!important;min-width:0!important}
#ms-stock-logo{display:grid!important;place-items:center!important;width:34px!important;height:34px!important;flex:0 0 34px!important;border-radius:9px!important;background:#875a7b!important;color:#fff!important;font-size:15px!important}
#ms-stock-logo .ms-stock-icon{width:18px!important;height:18px!important}
#ms-stock-name{display:flex!important;flex-direction:column!important;gap:2px!important;min-width:0!important;line-height:1.2!important}
#ms-stock-name strong{color:#18181b!important;font-size:13px!important;font-weight:700!important;letter-spacing:.035em!important}
#ms-stock-name span{overflow:hidden!important;color:#71717a!important;font-size:10.5px!important;text-overflow:ellipsis!important;white-space:nowrap!important}
#ms-stock-header-actions{display:flex!important;align-items:center!important;gap:10px!important}
.ms-stock-live{display:inline-flex!important;align-items:center!important;gap:6px!important;padding:5px 9px!important;border:1px solid #d7eadf!important;border-radius:999px!important;background:#eef8f2!important;color:#247a53!important;font-size:10px!important;font-weight:700!important;white-space:nowrap!important}
.ms-stock-live-dot{width:7px!important;height:7px!important;flex:0 0 7px!important;border-radius:50%!important;background:#2d9668!important}
#ms-stock-close{display:grid!important;place-items:center!important;width:34px!important;height:34px!important;padding:0!important;margin:0!important;border:1px solid #d9d9de!important;border-radius:8px!important;background:#fff!important;color:#68465f!important;cursor:pointer!important;font-size:16px!important;outline:0!important;transition:all .15s!important}
#ms-stock-close:hover{border-color:#d8c7d7!important;background:#f4eff2!important;color:#875a7b!important}
#ms-stock-close .ms-stock-icon{width:16px!important;height:16px!important}
.ms-stock-icon{display:block!important;flex:0 0 auto!important;fill:none!important;stroke:currentColor!important;stroke-width:2!important;stroke-linecap:round!important;stroke-linejoin:round!important}
.ms-stock-spinner{animation:ms-stock-spin .8s linear infinite!important}
@keyframes ms-stock-spin{to{transform:rotate(360deg)}}
#ms-stock-body{display:flex!important;flex:1 1 auto!important;flex-direction:column!important;gap:13px!important;min-height:0!important;padding:20px 22px!important;overflow:hidden!important;background:#e1e1e1!important}
.ms-stock-welcome{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;flex-wrap:wrap!important;flex:0 0 auto!important}
.ms-stock-welcome h1{margin:0!important;color:#18181b!important;font-size:19px!important;font-weight:700!important;letter-spacing:-.02em!important;line-height:1.25!important}
.ms-stock-welcome p{margin:4px 0 0!important;color:#71717a!important;font-size:11.5px!important;line-height:1.5!important}
.ms-stock-warehouse-count{display:inline-flex!important;align-items:center!important;gap:7px!important;min-height:25px!important;padding:3px 9px!important;border:1px solid #d9d9de!important;border-radius:7px!important;background:#f7f2f6!important;color:#68465f!important;font-size:10px!important;font-weight:700!important;white-space:nowrap!important}
#ms-stock-form{flex:0 0 auto!important;margin:0!important;padding:0!important}
#ms-stock-search-box{position:relative!important;display:flex!important;align-items:center!important;gap:9px!important;min-height:64px!important;padding:12px!important;margin:0!important;border:1px solid #d9d9de!important;border-radius:11px!important;background:#fff!important;box-shadow:0 2px 5px #29242e08!important}
#ms-stock-input-wrap{position:relative!important;flex:1 1 auto!important;min-width:0!important}
#ms-stock-input-wrap>.ms-stock-icon{position:absolute!important;top:50%!important;left:13px!important;z-index:1!important;width:14px!important;height:14px!important;transform:translateY(-50%)!important;color:#9b949f!important;pointer-events:none!important}
#ms-stock-input{display:block!important;width:100%!important;height:38px!important;min-height:38px!important;padding:0 12px 0 36px!important;margin:0!important;border:1px solid #d9d9de!important;border-radius:8px!important;outline:0!important;background:#fff!important;color:#18181b!important;font-size:12px!important;font-weight:600!important;line-height:38px!important;box-shadow:none!important;appearance:none!important;-webkit-appearance:none!important;transition:border-color .15s,box-shadow .15s!important}
#ms-stock-input:focus{border-color:#875a7b!important;box-shadow:0 0 0 3px rgba(135,90,123,.12)!important}
#ms-stock-input::placeholder{color:#aaa3ad!important;opacity:1!important;font-weight:400!important}
#ms-stock-search{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;flex:0 0 auto!important;height:38px!important;min-height:38px!important;padding:0 17px!important;margin:0!important;border:1px solid #875a7b!important;border-radius:8px!important;background:#875a7b!important;color:#fff!important;font-size:11.5px!important;font-weight:700!important;cursor:pointer!important;outline:0!important;box-shadow:0 2px 5px #875a7b1a!important;transition:all .15s!important}
#ms-stock-search:hover{border-color:#68465f!important;background:#68465f!important;box-shadow:0 3px 8px #68465f24!important}
#ms-stock-search .ms-stock-icon{width:14px!important;height:14px!important}
#ms-stock-search:disabled{border-color:#aaa!important;background:#aaa!important;cursor:not-allowed!important;box-shadow:none!important}
#ms-stock-dropdown{display:none!important;position:absolute!important;top:44px!important;left:0!important;right:0!important;max-height:300px!important;overflow-y:auto!important;overflow-x:hidden!important;z-index:2147483647!important;border:1px solid #d9d9de!important;border-radius:9px!important;background:#fff!important;box-shadow:0 12px 28px #17131c24!important}
#ms-stock-dropdown.open{display:block!important}
.ms-stock-product{display:block!important;width:100%!important;padding:10px 12px!important;margin:0!important;border:0!important;border-bottom:1px solid #f0edf1!important;background:#fff!important;color:#514a56!important;cursor:pointer!important;font-size:11px!important;line-height:1.45!important;text-align:left!important;transition:background .12s!important}
.ms-stock-product:last-child{border-bottom:0!important}
.ms-stock-product:hover,.ms-stock-product.active{background:#f7f2f7!important}
.ms-stock-product-name{display:block!important;color:#18181b!important;font-size:12px!important;font-weight:700!important}
.ms-stock-product-hzb{display:block!important;margin-top:3px!important;color:#71717a!important;font-size:10px!important;font-weight:600!important}
.ms-stock-product-price{display:block!important;margin-top:4px!important;color:#875a7b!important;font-size:11px!important;font-weight:700!important}
.ms-stock-dropdown-status{display:block!important;padding:14px!important;color:#71717a!important;font-size:11px!important;text-align:center!important}
#ms-stock-result{display:flex!important;flex:1 1 auto!important;flex-direction:column!important;gap:10px!important;min-height:0!important;overflow:auto!important;padding:13px!important;border:1px solid #d9d9de!important;border-radius:11px!important;background:#fff!important;box-shadow:0 2px 5px #29242e08!important;scrollbar-color:#d7cfd9 transparent!important;scrollbar-width:thin!important}
.ms-stock-status{display:flex!important;align-items:center!important;justify-content:center!important;gap:9px!important;min-height:100px!important;flex:1 1 auto!important;color:#71717a!important;font-size:12px!important;font-weight:600!important;text-align:center!important}
.ms-stock-dot{width:8px!important;height:8px!important;flex:0 0 8px!important;border-radius:50%!important;background:#875a7b!important;box-shadow:0 0 0 4px #f4eff2!important}
.ms-stock-result-title{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;min-height:48px!important;padding:8px 12px!important;margin:0 0 2px!important;border:1px solid #e8e0e9!important;border-radius:9px!important;background:#f7f2f7!important;color:#18181b!important;font-size:12px!important;font-weight:700!important;line-height:1.4!important;white-space:normal!important;overflow-wrap:anywhere!important}
.ms-stock-result-title>span:first-child{min-width:0!important}
.ms-stock-result-hzb{display:inline-block!important;margin-left:8px!important;color:#875a7b!important;font-size:10.5px!important;font-weight:700!important;white-space:nowrap!important}
.ms-stock-result-price{flex:0 0 auto!important;padding:5px 9px!important;border:1px solid #e2d5e3!important;border-radius:7px!important;background:#fff!important;color:#68465f!important;font-size:11px!important;font-weight:700!important;white-space:nowrap!important}
.ms-stock-row{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:15px!important;min-height:68px!important;padding:11px 14px!important;margin:0 0 8px!important;border:1px solid #d9d9de!important;border-radius:9px!important;background:#fff!important;box-shadow:0 2px 5px #29242e07!important;transition:border-color .15s,box-shadow .15s!important}
.ms-stock-row:last-child{margin-bottom:0!important}
.ms-stock-row:hover{border-color:#d8c7d7!important;box-shadow:0 3px 9px #68465f10!important}
.ms-stock-row-left{display:flex!important;align-items:center!important;gap:12px!important;min-width:0!important}
.ms-stock-row-badge{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:94px!important;min-height:27px!important;flex:0 0 94px!important;padding:4px 7px!important;border:1px solid #d9d9de!important;border-radius:7px!important;background:#f7f2f6!important;color:#68465f!important;font-size:10px!important;font-weight:800!important;letter-spacing:.04em!important;text-align:center!important}
.ms-stock-row-badge.platinum{border-color:#d8d8dc!important;background:#f0f0f2!important;color:#38383e!important}
.ms-stock-row-badge.gold{border-color:#efe2bd!important;background:#fbf6e9!important;color:#926b22!important}
.ms-stock-row-badge.silver{border-color:#d9e7f2!important;background:#edf4fa!important;color:#35678f!important}
.ms-stock-row-location{overflow:hidden!important;color:#71717a!important;font-size:10.5px!important;text-overflow:ellipsis!important;white-space:nowrap!important}
.ms-stock-row-qty{flex:0 0 auto!important;color:#18181b!important;font-size:19px!important;font-weight:800!important;letter-spacing:-.03em!important;font-variant-numeric:tabular-nums!important;white-space:nowrap!important}
#ms-stock-footer{display:flex!important;flex:0 0 34px!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;padding:0 20px!important;border-top:1px solid #d9d2df!important;background:#fff!important;color:#9b949f!important;font-size:9.5px!important;font-weight:700!important;letter-spacing:.06em!important}
#ms-stock-footer span:first-child{color:#68465f!important}
#ms-stock-hzb-systray-item{display:flex!important;align-items:center!important;justify-content:center!important;width:42px!important;height:46px!important;padding:0!important;margin:0!important;flex:0 0 42px!important}
#ms-stock-hzb-systray-button{display:flex!important;align-items:center!important;justify-content:center!important;width:42px!important;height:46px!important;padding:0!important;margin:0!important;border:0!important;background:transparent!important;color:rgba(255,255,255,.8)!important;cursor:pointer!important;outline:0!important}
#ms-stock-hzb-systray-button:hover{background:rgba(255,255,255,.08)!important;color:#fff!important}
#ms-stock-hzb-systray-button .ms-stock-icon{width:18px!important;height:18px!important;color:inherit!important}
.ms-stock-warehouse-count .ms-stock-icon{width:12px!important;height:12px!important}
@media(max-width:640px){
    #ms-stock-panel{width:calc(100vw - 20px)!important;height:calc(100vh - 20px)!important;max-height:calc(100vh - 20px)!important;border-radius:12px!important}
    #ms-stock-header{flex-basis:56px!important;padding:0 13px!important}
    #ms-stock-body{gap:10px!important;padding:13px!important}
    .ms-stock-welcome h1{font-size:17px!important}
    #ms-stock-search-box{gap:7px!important;padding:9px!important}
    #ms-stock-search{padding:0 11px!important}
    #ms-stock-result{padding:9px!important}
    #ms-stock-footer{padding:0 13px!important}
    .ms-stock-result-title{align-items:flex-start!important;flex-direction:column!important}
    .ms-stock-result-price{align-self:flex-start!important}
}
</style>
<div id="ms-stock-panel" role="dialog" aria-modal="true" aria-labelledby="ms-stock-heading">
    <header id="ms-stock-header">
        <div id="ms-stock-title">
            <div id="ms-stock-logo">${icons.cubes}</div>
            <div id="ms-stock-name">
                <strong id="ms-stock-heading">STOCK CHECKER</strong>
                <span>Search product availability by name or HZB</span>
            </div>
        </div>
        <div id="ms-stock-header-actions">
            <span class="ms-stock-live"><span class="ms-stock-live-dot"></span> LIVE STOCK</span>
            <button id="ms-stock-close" type="button" title="Close" aria-label="Close">${icons.close}</button>
        </div>
    </header>
    <main id="ms-stock-body">
        <section class="ms-stock-welcome">
            <div><h1>Stock Overview</h1><p>Check available quantities across Platinum, Gold and Silver warehouses.</p></div>
            <span class="ms-stock-warehouse-count">${icons.cubes} 3 WAREHOUSES</span>
        </section>
        <form id="ms-stock-form" autocomplete="off" novalidate>
            <div id="ms-stock-search-box">
                <div id="ms-stock-input-wrap">
                    ${icons.search}
                    <input id="ms-stock-input" type="search" name="ms_stock_search_x7k9" placeholder="Search product name or HZB..." autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-form-type="other" role="combobox" aria-autocomplete="list" aria-expanded="false">
                    <div id="ms-stock-dropdown"></div>
                </div>
                <button id="ms-stock-search" type="submit">${icons.search}<span>SEARCH</span></button>
            </div>
        </form>
        <div id="ms-stock-result" aria-live="polite">
            <div class="ms-stock-status"><span class="ms-stock-dot"></span><span>Search for a product or HZB to view warehouse availability</span></div>
        </div>
    </main>
    <footer id="ms-stock-footer"><span>YODAWY STOCK</span><span>WAREHOUSE AVAILABILITY</span></footer>
</div>`;

    const panel=host.querySelector('#ms-stock-panel');
    const input=host.querySelector('#ms-stock-input');
    const form=host.querySelector('#ms-stock-form');
    const button=host.querySelector('#ms-stock-search');
    const result=host.querySelector('#ms-stock-result');
    const close=host.querySelector('#ms-stock-close');
    const dropdown=host.querySelector('#ms-stock-dropdown');

    let searching=false;
    let lookupTimer=null;
    let lookupId=0;
    let products=[];
    let selectedProduct=null;
    let activeIndex=-1;

    const showStatus=text=>{
        result.innerHTML=`<div class="ms-stock-status"><span class="ms-stock-dot"></span><span>${escapeHTML(text)}</span></div>`;
    };

    const closeDropdown=()=>{
        dropdown.classList.remove('open');
        dropdown.innerHTML='';
        input.setAttribute('aria-expanded','false');
        activeIndex=-1;
    };

    const resetSearch=()=>{
        clearTimeout(lookupTimer);
        lookupId++;
        input.value='';
        selectedProduct=null;
        products=[];
        closeDropdown();
        showStatus('Search for a product or HZB');
    };

    const renderProducts=list=>{
        products=list||[];
        activeIndex=-1;

        if(!products.length){
            dropdown.innerHTML='<div class="ms-stock-dropdown-status">No product found in the 3 warehouses</div>';
            dropdown.classList.add('open');
            input.setAttribute('aria-expanded','true');
            return;
        }

        dropdown.innerHTML=products.map((p,i)=>`
            <div class="ms-stock-product" data-index="${i}" role="option">
                <span class="ms-stock-product-name">${escapeHTML(p.display_name)}</span>
                ${p.hb_id?`<span class="ms-stock-product-hzb">HZB: ${escapeHTML(p.hb_id)}</span>`:''}
                <span class="ms-stock-product-price">${priceHTML(p)}</span>
            </div>
        `).join('');

        dropdown.classList.add('open');
        input.setAttribute('aria-expanded','true');
    };

    const search=async()=>{
        if(searching)return;

        const value=input.value.trim();

        if(!value){
            showStatus('Enter product or HZB');
            input.focus();
            return;
        }

        if(!selectedProduct){
            const list=await searchStockProducts(value);

            if(list.length===1)selectedProduct=list[0];
            else if(list.length>1){
                renderProducts(list);
                return;
            }else{
                showStatus('No product found in the 3 warehouses');
                return;
            }
        }

        searching=true;
        button.disabled=true;
        button.innerHTML=icons.spinner+'<span>SEARCHING</span>';
        closeDropdown();
        showStatus('Checking Platinum + Gold + Silver...');

        try{
            const data=await stocksForProduct(selectedProduct.id);
            const rows=[['Platinum',data.Platinum],['Gold',data.Gold],['Silver',data.Silver]];

            result.innerHTML=`
                <div class="ms-stock-result-title">
                    <span>
                        ${escapeHTML(selectedProduct.display_name)}
                        ${selectedProduct.hb_id?`<span class="ms-stock-result-hzb">HZB: ${escapeHTML(selectedProduct.hb_id)}</span>`:''}
                    </span>
                    <span class="ms-stock-result-price">${priceHTML(selectedProduct)}</span>
                </div>
                ${rows.map(([type,stock])=>`
                    <div class="ms-stock-row">
                        <div class="ms-stock-row-left">
                            <span class="ms-stock-row-badge ${type.toLowerCase()}">${type.toUpperCase()}</span>
                            <span class="ms-stock-row-location">${escapeHTML(stock.location)}</span>
                        </div>
                        <span class="ms-stock-row-qty">${Number(stock.quantity||0).toLocaleString()}</span>
                    </div>
                `).join('')}
            `;
        }catch{
            showStatus('Search error');
        }finally{
            searching=false;
            button.disabled=false;
            button.innerHTML=icons.search+'<span>SEARCH</span>';
        }
    };

    const selectProduct=product=>{
        if(!product)return;
        selectedProduct=product;
        input.value=product.display_name||'';
        closeDropdown();
        search();
    };

    const lookup=async value=>{
        const id=++lookupId;

        if(!value){
            closeDropdown();
            return;
        }

        dropdown.innerHTML='<div class="ms-stock-dropdown-status">Searching products...</div>';
        dropdown.classList.add('open');
        input.setAttribute('aria-expanded','true');

        try{
            const list=await searchStockProducts(value);
            if(id!==lookupId)return;
            renderProducts(list);
        }catch{
            if(id!==lookupId)return;
            dropdown.innerHTML='<div class="ms-stock-dropdown-status">Search error</div>';
            dropdown.classList.add('open');
            input.setAttribute('aria-expanded','true');
        }
    };

    input.addEventListener('input',e=>{
        e.stopPropagation();
        selectedProduct=null;
        clearTimeout(lookupTimer);

        const value=input.value.trim();

        if(!value){
            closeDropdown();
            return;
        }

        lookupTimer=setTimeout(()=>lookup(value),250);
    });

    input.addEventListener('keydown',e=>{
        e.stopPropagation();

        if((e.key==='ArrowDown'||e.key==='ArrowUp')&&products.length){
            e.preventDefault();

            activeIndex=e.key==='ArrowDown'
                ?Math.min(activeIndex+1,products.length-1)
                :Math.max(activeIndex-1,0);

            dropdown.querySelector('.ms-stock-product.active')?.classList.remove('active');

            const item=dropdown.querySelector(`[data-index="${activeIndex}"]`);
            item?.classList.add('active');
            item?.scrollIntoView({block:'nearest'});
            return;
        }

        if(e.key==='Enter'&&activeIndex>=0&&products[activeIndex]){
            e.preventDefault();
            selectProduct(products[activeIndex]);
            return;
        }

        if(e.key==='Escape'){
            e.preventDefault();
            closeDropdown();
        }
    });

    input.addEventListener('blur',()=>setTimeout(closeDropdown,250));

    dropdown.addEventListener('mousedown',e=>{
        const item=e.target.closest('.ms-stock-product');
        if(!item)return;
        e.preventDefault();
        e.stopPropagation();
        selectProduct(products[Number(item.dataset.index)]);
    });

    form.addEventListener('submit',e=>{
        e.preventDefault();
        e.stopPropagation();
        search();
    });

    button.addEventListener('click',e=>{
        e.preventDefault();
        e.stopPropagation();
        search();
    });

    const closeOnOutsideClick=e=>{
        if(!panel.classList.contains('open')||panel.contains(e.target)||systrayItem.contains(e.target))return;
        resetSearch();
        panel.classList.remove('open');
        input.blur();
    };
    document.addEventListener('click',closeOnOutsideClick,true);

    close.addEventListener('click',e=>{
        e.preventDefault();
        e.stopPropagation();
        resetSearch();
        panel.classList.remove('open');
        input.blur();
    });

    const systrayItem=document.createElement('li');
    systrayItem.id='ms-stock-hzb-systray-item';
    systrayItem.setAttribute('role','menuitem');
    systrayItem.innerHTML=`
        <button id="ms-stock-hzb-systray-button" type="button" title="Stock HZB" aria-label="Stock HZB">
            ${icons.cubes}
        </button>`;

    const systrayButton=systrayItem.firstElementChild;

    systrayButton.addEventListener('mousedown',e=>e.stopPropagation());
    systrayButton.addEventListener('mouseup',e=>e.stopPropagation());
    systrayButton.addEventListener('click',e=>{
        e.preventDefault();
        e.stopPropagation();
        panel.classList.toggle('open');
        if(panel.classList.contains('open'))input.focus();
    });

    const insertSystray=()=>{
        const nav=document.querySelector('.o_main_navbar .o_menu_systray');
        if(!nav)return false;
        if(systrayItem.parentElement!==nav)nav.prepend(systrayItem);
        return true;
    };

    if(!insertSystray()){
        const observer=new MutationObserver(()=>{
            if(insertSystray())observer.disconnect();
        });
        observer.observe(document.body,{childList:true,subtree:true});
    }
    const registry=window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    registry['STOCK-HZB-CHECKER']={
        suspend(){clearTimeout(lookupTimer);lookupId++;document.removeEventListener('click',closeOnOutsideClick,true);host.remove();systrayItem.remove();return true;},
        resume(){if(!document.getElementById(ID))createUI();return true;}
    };
}

createUI();
})();
