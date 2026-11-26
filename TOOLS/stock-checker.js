// ==UserScript==
// @name         Stock Checker
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @grant        none
// ==/UserScript==

(async function(){
'use strict';

const TOOL_ID='TOOL-014';
const registry=window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
if(registry[TOOL_ID])return;
const LOCATIONS={Gold:'GW/Stock',Silver:'SIW/Stock',Platinum:'AR-PP/Stock'};
const ID='ms-stock-hzb-checker';
let locationsCache=null;
let destroyed=false;
let requestController=new AbortController();
let uiCleanup=null;

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
        }),
        signal:requestController.signal
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
    if(destroyed||uiCleanup)return;
    if(requestController.signal.aborted)requestController=new AbortController();

    const host=document.createElement('div');
    host.id=ID;
    host.style.cssText='all:initial!important;position:fixed!important;right:20px!important;bottom:20px!important;width:860px!important;z-index:2147483647!important;pointer-events:auto!important;display:block!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif!important';
    document.body.appendChild(host);

    host.innerHTML=`
<style>
#ms-stock-panel,#ms-stock-panel *{box-sizing:border-box!important;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif!important}
#ms-stock-panel{display:none!important;width:860px!important;height:500px!important;background:#fff!important;color:#666!important;border:1px solid #68465f!important;border-radius:6px!important;box-shadow:0 4px 16px rgba(0,0,0,.25)!important;overflow:hidden!important;pointer-events:auto!important}
#ms-stock-panel.open{display:block!important}
#ms-stock-header{height:48px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;padding:0 12px!important;background:#875A7B!important;color:#fff!important;border-radius:5px 5px 0 0!important}
#ms-stock-title{display:flex!important;align-items:center!important;gap:9px!important}
#ms-stock-logo{width:28px!important;height:28px!important;display:flex!important;align-items:center!important;justify-content:center!important;border-radius:4px!important;background:#68465f!important;color:#fff!important;font-size:13px!important;font-weight:700!important}
#ms-stock-name{display:flex!important;flex-direction:column!important;line-height:1.2!important}
#ms-stock-name strong{font-size:13px!important;color:#fff!important}
#ms-stock-name span{margin-top:2px!important;font-size:10px!important;color:rgba(255,255,255,.75)!important}
#ms-stock-close{width:28px!important;height:28px!important;border:1px solid rgba(255,255,255,.35)!important;border-radius:4px!important;background:transparent!important;color:#fff!important;cursor:pointer!important;font-size:17px!important;padding:0!important;margin:0!important;outline:0!important}
#ms-stock-body{height:426px!important;padding:10px!important;background:#fff!important}
#ms-stock-form{margin:0!important;padding:0!important}
#ms-stock-search-box{position:relative!important;display:flex!important;align-items:center!important;gap:7px!important;height:48px!important;padding:7px 9px!important;margin:0 0 8px!important;border:1px solid #d9d9d9!important;border-radius:4px!important;background:#fff!important}
#ms-stock-input-wrap{position:relative!important;flex:1 1 auto!important;min-width:0!important}
#ms-stock-input{display:block!important;width:100%!important;height:30px!important;padding:0 9px!important;margin:0!important;border:1px solid #ccc!important;border-radius:4px!important;outline:0!important;background:#fff!important;color:#111!important;font-size:14px!important;font-weight:700!important;line-height:30px!important;box-shadow:none!important;appearance:none!important;-webkit-appearance:none!important}
#ms-stock-input:focus{box-shadow:0 0 0 1px #875A7B!important}
#ms-stock-input::placeholder{color:#999!important;opacity:1!important}
#ms-stock-search{height:30px!important;padding:0 14px!important;margin:0!important;border:1px solid #68465f!important;border-radius:4px!important;background:#875A7B!important;color:#fff!important;font-size:10px!important;font-weight:700!important;cursor:pointer!important;outline:0!important}
#ms-stock-search:hover{background:#68465f!important}
#ms-stock-search:disabled{background:#aaa!important;border-color:#aaa!important;cursor:not-allowed!important}
#ms-stock-dropdown{display:none!important;position:absolute!important;top:33px!important;left:0!important;right:0!important;max-height:300px!important;overflow-y:auto!important;overflow-x:hidden!important;z-index:2147483647!important;background:#fff!important;border:1px solid #ccc!important;border-radius:4px!important;box-shadow:0 5px 14px rgba(0,0,0,.2)!important}
#ms-stock-dropdown.open{display:block!important}
.ms-stock-product{display:block!important;width:100%!important;padding:9px 10px!important;margin:0!important;border:0!important;border-bottom:1px solid #eee!important;background:#fff!important;color:#444!important;cursor:pointer!important;font-size:10px!important;line-height:1.4!important;text-align:left!important}
.ms-stock-product:last-child{border-bottom:0!important}
.ms-stock-product:hover,.ms-stock-product.active{background:#f3edf2!important}
.ms-stock-product-name{display:block!important;color:#111!important;font-size:14px!important;font-weight:700!important}
.ms-stock-product-hzb{display:block!important;margin-top:2px!important;color:#111!important;font-size:10px!important;font-weight:600!important}
.ms-stock-product-price{display:block!important;margin-top:3px!important;color:#875A7B!important;font-size:11px!important;font-weight:700!important}
.ms-stock-dropdown-status{display:block!important;padding:10px!important;color:#999!important;font-size:10px!important;text-align:center!important}
#ms-stock-result{height:352px!important;max-height:352px!important;overflow:hidden!important;padding:8px!important;border:1px solid #d9d9d9!important;border-radius:4px!important;background:#fff!important}
.ms-stock-status{display:flex!important;align-items:center!important;gap:7px!important;min-height:44px!important;color:#666!important;font-size:10px!important;font-weight:600!important}
.ms-stock-dot{width:7px!important;height:7px!important;flex:0 0 7px!important;border-radius:50%!important;background:#875A7B!important}
.ms-stock-result-title{min-height:34px!important;display:flex!important;align-items:center!important;padding:0 8px!important;margin-bottom:8px!important;color:#444!important;font-size:12px!important;font-weight:700!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;border-bottom:1px solid #eee!important}
.ms-stock-result-hzb{margin-left:8px!important;color:#875A7B!important;font-size:11px!important;font-weight:700!important;white-space:nowrap!important}
.ms-stock-result-price{margin-left:auto!important;padding-left:15px!important;color:#875A7B!important;font-size:13px!important;font-weight:700!important;white-space:nowrap!important}
.ms-stock-row{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:15px!important;height:72px!important;padding:10px 14px!important;margin-bottom:8px!important;border:1px solid #e2e2e2!important;border-radius:4px!important;background:#fff!important}
.ms-stock-row:last-child{margin-bottom:0!important}
.ms-stock-row-left{display:flex!important;align-items:center!important;gap:14px!important;min-width:0!important}
.ms-stock-row-badge{width:90px!important;flex:0 0 90px!important;text-align:center!important;padding:7px 4px!important;border-radius:4px!important;color:#fff!important;font-size:10px!important;font-weight:700!important}
.ms-stock-row-badge.platinum{background:#1c1c1c!important}
.ms-stock-row-badge.gold{background:#d4a72c!important}
.ms-stock-row-badge.silver{background:#8c969f!important}
.ms-stock-row-location{color:#999!important;font-size:10px!important;white-space:nowrap!important}
.ms-stock-row-qty{color:#875A7B!important;font-size:16px!important;font-weight:700!important;white-space:nowrap!important}
#ms-stock-footer{height:26px!important;display:flex!important;align-items:center!important;justify-content:center!important;border-top:1px solid #e6e6e6!important;background:#fafafa!important;color:#999!important;font-size:9px!important;border-radius:0 0 5px 5px!important}
#ms-stock-hzb-systray-item{display:flex!important;align-items:center!important;justify-content:center!important;width:42px!important;height:46px!important;padding:0!important;margin:0!important;flex:0 0 42px!important}
#ms-stock-hzb-systray-button{display:flex!important;align-items:center!important;justify-content:center!important;width:42px!important;height:46px!important;padding:0!important;margin:0!important;border:0!important;background:transparent!important;color:rgba(255,255,255,.8)!important;cursor:pointer!important;outline:0!important}
#ms-stock-hzb-systray-button:hover{background:rgba(255,255,255,.08)!important;color:#fff!important}
#ms-stock-hzb-systray-button i{font-family:FontAwesome!important;font-size:18px!important;color:inherit!important}
</style>

<div id="ms-stock-panel">
    <div id="ms-stock-header">
        <div id="ms-stock-title">
            <div id="ms-stock-logo">S</div>
            <div id="ms-stock-name">
                <strong>STOCK</strong>
                <span>Search by product name or HZB</span>
            </div>
        </div>
        <button id="ms-stock-close" type="button">×</button>
    </div>

    <div id="ms-stock-body">
        <form id="ms-stock-form" autocomplete="off" novalidate>
            <div id="ms-stock-search-box">
                <div id="ms-stock-input-wrap">
                    <input id="ms-stock-input" type="search" name="ms_stock_search_x7k9" placeholder="Search product or HZB..." autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-form-type="other" role="combobox" aria-autocomplete="list" aria-expanded="false">
                    <div id="ms-stock-dropdown"></div>
                </div>
                <button id="ms-stock-search" type="submit">SEARCH</button>
            </div>
        </form>

        <div id="ms-stock-result">
            <div class="ms-stock-status">
                <span class="ms-stock-dot"></span>
                <span>Search for a product or HZB</span>
            </div>
        </div>
    </div>

    <div id="ms-stock-footer">YODAWY • STOCK</div>
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
    let blurTimer=null;
    let observer=null;
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
        button.textContent='...';
        closeDropdown();
        showStatus('Checking Platinum + Gold + Silver...');

        try{
            const data=await stocksForProduct(selectedProduct.id);
            if(destroyed)return;
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
            button.textContent='SEARCH';
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
            if(destroyed||id!==lookupId)return;
            renderProducts(list);
        }catch{
            if(destroyed||id!==lookupId)return;
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

    input.addEventListener('blur',()=>{
        clearTimeout(blurTimer);
        blurTimer=setTimeout(closeDropdown,250);
    });

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
            <i class="yd-custom-icon fa fa-cubes" role="img" aria-label="Stock HZB"></i>
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
        observer=new MutationObserver(()=>{
            if(insertSystray()){
                observer.disconnect();
                observer=null;
            }
        });
        observer.observe(document.body,{childList:true,subtree:true});
    }

    uiCleanup=()=>{
        clearTimeout(lookupTimer);
        clearTimeout(blurTimer);
        lookupTimer=null;
        blurTimer=null;
        lookupId++;
        observer?.disconnect();
        observer=null;
        requestController.abort();
        panel.classList.remove('open');
        host.remove();
        systrayItem.remove();
        uiCleanup=null;
        return true;
    };
}

const instance={
    id:TOOL_ID,
    path:'TOOLS/stock-checker.js',
    suspend(){
        if(uiCleanup)uiCleanup();
        return true;
    },
    resume(){
        if(destroyed)return false;
        createUI();
        return true;
    },
    destroy(){
        if(destroyed)return true;
        destroyed=true;
        if(uiCleanup)uiCleanup();
        requestController.abort();
        if(registry[TOOL_ID]===instance)delete registry[TOOL_ID];
        return true;
    }
};
registry[TOOL_ID]=instance;
createUI();
})();
