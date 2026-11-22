// ==UserScript==
// @name         Stock Checker
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @description  Search product stock across Abu Rawash and Engy warehouses.
// @match        https://odoo.yodawy.com/web*
// @grant        none
// ==/UserScript==

(function(){
    'use strict';

    const WAREHOUSES=[
        {group:'ABU RAWASH',name:'GOLD',key:'abuGold',path:'GW/Stock',locationId:617},
        {group:'ABU RAWASH',name:'SILVER',key:'abuSilver',path:'SIW/Stock',locationId:631},
        {group:'ABU RAWASH',name:'PLATINUM',key:'abuPlatinum',path:'AR-PP/Stock',locationId:127},
        {group:'ENGY',name:'GOLD',key:'engyGold',path:'POST-Engy Gold',locationId:673},
        {group:'ENGY',name:'SILVER',key:'engySilver',path:'PRE-Engy Silver',locationId:659},
        {group:'ENGY',name:'PLATINUM',key:'engyPlatinum',path:'ep/Stock',locationId:645}
    ];

    const ID='ms-stock-hzb-checker';
    let warehouseLocationsPromise=null;

    async function rpc(model,method,kwargs){
        const response=await fetch(`/web/dataset/call_kw/${model}/${method}`,{
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

        if(!response.ok)throw Error(`HTTP ${response.status}`);

        const data=await response.json();
        if(data.error)throw Error(data.error.data?.message||data.error.message||'RPC Error');
        return data.result;
    }

    async function getWarehouseLocations(){
        if(!warehouseLocationsPromise){
            warehouseLocationsPromise=Promise.all(WAREHOUSES.map(async warehouse=>{
                const rows=await rpc('stock.location','search_read',{
                    domain:[
                        '|',
                        ['complete_name','=',warehouse.path],
                        ['name','=',warehouse.path]
                    ],
                    fields:['id','name','complete_name'],
                    limit:20
                });

                const location=rows.find(row=>row.complete_name===warehouse.path)
                    ||rows.find(row=>row.name===warehouse.path);

                if(!location)throw Error(`Stock location not found: ${warehouse.path}`);

                return{...warehouse,id:location.id};
            })).catch(error=>{
                warehouseLocationsPromise=null;
                throw error;
            });
        }

        return warehouseLocationsPromise;
    }

    async function readProductQuants(productIds,locations){
        if(!productIds.length)return[];

        return rpc('stock.quant','search_read',{
            domain:[
                ['product_id','in',productIds],
                ['location_id','in',locations.map(location=>location.id)]
            ],
            fields:['product_id','location_id','product_uom_id','quantity','reserved_quantity'],
            limit:50000,
            order:'product_id asc'
        });
    }

    async function searchStockProducts(value){
        const text=value.trim();
        if(!text)return[];

        const [locations,productRows]=await Promise.all([
            getWarehouseLocations(),
            rpc('product.product','search_read',{
                domain:[
                    '|','|','|',
                    ['default_code','ilike',text],
                    ['barcode','ilike',text],
                    ['name','ilike',text],
                    ['hb_id','ilike',text]
                ],
                fields:['id','name','display_name','default_code','barcode','hb_id','lst_price'],
                limit:1000,
                order:'name asc'
            })
        ]);

        if(!productRows?.length)return[];

        const productIds=productRows.map(product=>product.id).filter(Boolean);
        if(!productIds.length)return[];

        const quants=await readProductQuants(productIds,locations);
        const stockedProductIds=new Set();

        quants.forEach(row=>{
            const productId=Array.isArray(row.product_id)?row.product_id[0]:row.product_id;
            const locationId=Array.isArray(row.location_id)?row.location_id[0]:row.location_id;
            const location=locations.find(item=>item.id===locationId);
            const available=Number(row.quantity||0)-Number(row.reserved_quantity||0);

            if(productId&&location&&available>0)stockedProductIds.add(productId);
        });

        return productRows
            .filter(product=>stockedProductIds.has(product.id))
            .sort((a,b)=>String(a.display_name||a.name||'').localeCompare(
                String(b.display_name||b.name||''),undefined,{numeric:true,sensitivity:'base'}
            ))
            .map(product=>({
                id:product.id,
                display_name:product.display_name||product.name||'',
                default_code:product.default_code||'',
                barcode:product.barcode||'',
                hb_id:product.hb_id||product.default_code||'',
                lst_price:Number(product.lst_price||0)
            }));
    }

    async function stocksForProduct(productId){
        const locations=await getWarehouseLocations();
        const rows=await readProductQuants([productId],locations);
        const result=Object.fromEntries(locations.map(location=>[
            location.key,
            {quantity:0,unit:'',location:location.path}
        ]));
        const locationById=new Map(locations.map(location=>[location.id,location]));

        rows.forEach(row=>{
            const locationId=Array.isArray(row.location_id)?row.location_id[0]:row.location_id;
            const location=locationById.get(locationId);
            if(!location)return;

            const quantity=Number(row.quantity||0);
            const reserved=Number(row.reserved_quantity||0);
            const stock=result[location.key];

            stock.quantity+=quantity-reserved;
            if(!stock.unit&&row.product_uom_id?.[1])stock.unit=row.product_uom_id[1];
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
        const units={flexpen:'FLEXPEN',syringe:'SYRINGE',amp:'AMP',penfil:'PENFIL',vial:'VIAL',sachet:'SACHET',strip:'STRIP'};
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
                if(count>0)return{unitPrice:price,unit:units[type],boxPrice:price*count,box:'BOX'};
            }
        }

        if(/\b(?:oral\s+drops?|drops?|solution|syrup|cream|ointment|gel|lotion|spray|powder|suspension|emulsion|soap|shampoo|mouthwash)\b|(?:نقط|قطرة|شراب|كريم|مرهم|جل|لوشن|بخاخ|بودرة|معلق|مستحلب)/i.test(text))return{unitPrice:price,unit:'BOX',boxPrice:price,box:'BOX'};
        if(/\bbox(?:es)?\b|علبة|علب/i.test(text))return{unitPrice:price,unit:'BOX',boxPrice:price,box:'BOX'};
        if(/\b(?:penfil|penfils|penfill|penfills|cartridge|cartridges|carroule|carroules)\b|خرطوشة|خراطيش/i.test(text))return{unitPrice:price,unit:'PENFIL',boxPrice:null,box:'BOX'};
        if(/\bsachet(?:s)?\b|ساشيه|ساشيهات/i.test(text))return{unitPrice:price,unit:'SACHET',boxPrice:null,box:'BOX'};
        if(/\bvial(?:s)?\b|فيال|فيالات|قارورة|قوارير/i.test(text))return{unitPrice:price,unit:'VIAL',boxPrice:null,box:'BOX'};
        if(/\bflexpen(?:s)?\b|\bflexben(?:s)?\b/i.test(text))return{unitPrice:price,unit:'FLEXPEN',boxPrice:null,box:'BOX'};
        if(/\bsyringe(?:s)?\b|سرنجة|سرنجات/i.test(text))return{unitPrice:price,unit:'SYRINGE',boxPrice:null,box:'BOX'};
        if(/\b(?:amp|amps|ampoule|ampoules|ampule|ampules)\b|امبول|امبولات|أمبول|أمبولات/i.test(text))return{unitPrice:price,unit:'AMP',boxPrice:null,box:'BOX'};
        if(/\b(?:strip|strips)\b|شريط|شرائط/i.test(text))return{unitPrice:price,unit:'STRIP',boxPrice:null,box:'BOX'};
        return{unitPrice:price,unit:'BOX',boxPrice:price,box:'BOX'};
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

        const host=document.createElement('div');

        host.id=ID;

        host.style.cssText=`
        all:initial!important;
        position:fixed!important;
        top:58px!important;
        right:16px!important;
        width:min(620px,calc(100vw - 32px))!important;
        z-index:2147482000!important;
        pointer-events:none!important;
        display:block!important;
        font-family:'Nunito Sans','Cairo',system-ui,-apple-system,sans-serif!important;
    `;

    document.body.appendChild(host);

    host.innerHTML=`
        <style>
#ms-stock-panel,#ms-stock-panel *{box-sizing:border-box!important;font-family:'Nunito Sans','Cairo',system-ui,-apple-system,sans-serif!important}
#ms-stock-panel{display:none!important;flex-direction:column!important;width:100%!important;max-height:calc(100vh - 76px)!important;overflow:hidden!important;border:1px solid #d9d9de!important;border-radius:12px!important;background:#f7f6f8!important;color:#18181b!important;box-shadow:0 16px 42px rgba(23,19,28,.18)!important;pointer-events:auto!important;transform-origin:top right!important}
#ms-stock-panel.open{display:flex!important;animation:ms-stock-enter .16s ease-out both!important}
@keyframes ms-stock-enter{from{opacity:0;transform:translateY(-6px) scale(.99)}to{opacity:1;transform:translateY(0) scale(1)}}
#ms-stock-header{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;min-height:68px!important;padding:12px 15px!important;border-bottom:1px solid #e6e2e8!important;background:#fff!important}
#ms-stock-title{display:flex!important;align-items:center!important;gap:10px!important;min-width:0!important}
#ms-stock-logo{display:grid!important;place-items:center!important;width:38px!important;height:38px!important;flex:0 0 38px!important;border:1px solid #875a7b!important;border-radius:10px!important;background:#875a7b!important;color:#fff!important;font-size:16px!important;box-shadow:0 2px 6px rgba(135,90,123,.18)!important}
#ms-stock-name{display:flex!important;flex-direction:column!important;gap:2px!important;min-width:0!important}
#ms-stock-name strong{color:#18181b!important;font-size:14px!important;font-weight:700!important;letter-spacing:-.01em!important;line-height:1.25!important}
#ms-stock-name span{color:#71717a!important;font-size:10.5px!important;line-height:1.4!important}
#ms-stock-header-meta{display:flex!important;align-items:center!important;gap:8px!important;margin-left:auto!important}
#ms-stock-warehouse-count{display:inline-flex!important;align-items:center!important;gap:5px!important;height:25px!important;padding:0 9px!important;border:1px solid #e5d9e3!important;border-radius:7px!important;background:#f4eff2!important;color:#68465f!important;font-size:9px!important;font-weight:700!important;letter-spacing:.04em!important;white-space:nowrap!important}
#ms-stock-close{display:grid!important;place-items:center!important;width:30px!important;height:30px!important;flex:0 0 30px!important;padding:0!important;border:1px solid #d9d9de!important;border-radius:8px!important;background:#fff!important;color:#71717a!important;cursor:pointer!important;font-size:15px!important;line-height:1!important;transition:all .15s ease!important}
#ms-stock-close:hover{border-color:#d8c7d7!important;background:#f4eff2!important;color:#68465f!important}
#ms-stock-body{display:flex!important;flex-direction:column!important;gap:11px!important;min-height:0!important;max-height:calc(100vh - 144px)!important;padding:13px!important;overflow:hidden!important;background:#f7f6f8!important}
#ms-stock-form{margin:0!important;padding:0!important}
#ms-stock-search-box{position:relative!important;display:flex!important;align-items:center!important;gap:8px!important;min-height:50px!important;padding:7px!important;border:1px solid #d9d9de!important;border-radius:10px!important;background:#fff!important;box-shadow:0 2px 5px rgba(41,36,46,.035)!important}
#ms-stock-input-wrap{position:relative!important;display:flex!important;align-items:center!important;flex:1 1 auto!important;min-width:0!important;height:36px!important}
#ms-stock-search-icon{display:grid!important;place-items:center!important;width:34px!important;flex:0 0 34px!important;color:#9b949f!important;font-size:12px!important;pointer-events:none!important}
#ms-stock-input{display:block!important;width:100%!important;min-width:0!important;height:36px!important;min-height:36px!important;padding:0 9px 0 0!important;margin:0!important;border:0!important;border-radius:7px!important;outline:0!important;background:transparent!important;background-image:none!important;color:#18181b!important;font-size:12px!important;font-weight:600!important;line-height:36px!important;box-shadow:none!important;appearance:none!important;-webkit-appearance:none!important;pointer-events:auto!important;user-select:text!important;-webkit-user-select:text!important}
#ms-stock-input::placeholder{color:#9b949f!important;font-weight:400!important;opacity:1!important}
#ms-stock-input:focus{outline:0!important;box-shadow:none!important}
#ms-stock-search{display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:7px!important;height:36px!important;min-height:36px!important;padding:0 14px!important;margin:0!important;border:1px solid #875a7b!important;border-radius:8px!important;background:#875a7b!important;color:#fff!important;font-size:11px!important;font-weight:700!important;letter-spacing:.01em!important;cursor:pointer!important;white-space:nowrap!important;pointer-events:auto!important;transition:all .15s ease!important}
#ms-stock-search:hover{border-color:#68465f!important;background:#68465f!important;box-shadow:0 3px 8px rgba(104,70,95,.14)!important}
#ms-stock-search:disabled{border-color:#d9d9de!important;background:#e1e1e1!important;color:#9b949f!important;cursor:wait!important;box-shadow:none!important}
#ms-stock-dropdown{display:none!important;position:absolute!important;top:calc(100% + 7px)!important;left:0!important;right:0!important;z-index:2147482001!important;max-height:290px!important;overflow-y:auto!important;overflow-x:hidden!important;border:1px solid #d9d9de!important;border-radius:10px!important;background:#fff!important;box-shadow:0 12px 28px rgba(23,19,28,.13)!important;pointer-events:auto!important}
#ms-stock-dropdown.open{display:block!important}
.ms-stock-product{display:flex!important;flex-direction:column!important;gap:3px!important;width:100%!important;padding:10px 12px!important;margin:0!important;border:0!important;border-bottom:1px solid #f0edf1!important;background:#fff!important;color:#18181b!important;cursor:pointer!important;text-align:left!important;transition:background .12s ease!important;pointer-events:auto!important}
.ms-stock-product:last-child{border-bottom:0!important}
.ms-stock-product:hover,.ms-stock-product.active{background:#f8f5f8!important}
.ms-stock-product-name{display:block!important;color:#18181b!important;font-size:12px!important;font-weight:700!important;line-height:1.35!important}
.ms-stock-product-hzb{display:block!important;color:#71717a!important;font-size:10px!important;font-weight:600!important;line-height:1.3!important}
.ms-stock-product-price{display:block!important;margin-top:2px!important;color:#875a7b!important;font-size:10.5px!important;font-weight:700!important;line-height:1.35!important}
.ms-stock-dropdown-status{display:block!important;padding:14px!important;color:#71717a!important;font-size:11px!important;text-align:center!important}
#ms-stock-result{display:flex!important;flex-direction:column!important;gap:10px!important;min-height:190px!important;max-height:calc(100vh - 220px)!important;padding:0!important;overflow-y:auto!important;overflow-x:hidden!important;border:0!important;border-radius:0!important;background:transparent!important}
.ms-stock-status{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:8px!important;min-height:170px!important;padding:24px!important;border:1px dashed #d9d9de!important;border-radius:10px!important;background:#fff!important;color:#71717a!important;font-size:11px!important;font-weight:600!important;text-align:center!important}
.ms-stock-status-icon{display:grid!important;place-items:center!important;width:40px!important;height:40px!important;border:1px solid #e5d9e3!important;border-radius:11px!important;background:#f4eff2!important;color:#875a7b!important;font-size:16px!important}
.ms-stock-status-title{color:#18181b!important;font-size:12px!important;font-weight:700!important}
.ms-stock-status-hint{color:#9b949f!important;font-size:10px!important;font-weight:400!important}
.ms-stock-result-title{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;min-width:0!important;padding:12px 13px!important;border:1px solid #d9d9de!important;border-radius:10px!important;background:#fff!important;box-shadow:0 2px 5px rgba(41,36,46,.035)!important}
.ms-stock-result-ident{display:flex!important;flex-direction:column!important;gap:4px!important;min-width:0!important}
.ms-stock-result-eyebrow{color:#9b949f!important;font-size:8.5px!important;font-weight:800!important;letter-spacing:.09em!important}
.ms-stock-result-name{overflow:hidden!important;color:#18181b!important;font-size:12px!important;font-weight:700!important;line-height:1.35!important;text-overflow:ellipsis!important}
.ms-stock-result-hzb{margin-left:0!important;color:#875a7b!important;font-size:10px!important;font-weight:700!important}
.ms-stock-result-price{display:flex!important;flex-direction:column!important;align-items:flex-end!important;gap:3px!important;flex:0 0 auto!important;padding-left:8px!important;color:#875a7b!important;font-size:11px!important;font-weight:700!important;text-align:right!important;white-space:nowrap!important}
.ms-stock-result-price::before{content:"PRICE";color:#9b949f!important;font-size:8px!important;font-weight:800!important;letter-spacing:.08em!important}
.ms-stock-group{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important;margin:0!important;padding:11px!important;border:1px solid #d9d9de!important;border-radius:10px!important;background:#fff!important;box-shadow:0 2px 5px rgba(41,36,46,.035)!important}
.ms-stock-group-title{display:flex!important;align-items:center!important;justify-content:space-between!important;grid-column:1/-1!important;min-height:26px!important;padding:0 1px 8px!important;margin:0 0 1px!important;border:0!important;border-bottom:1px solid #eee9ef!important;border-radius:0!important;background:transparent!important;color:#18181b!important;font-size:10.5px!important;font-weight:800!important;letter-spacing:.045em!important}
.ms-stock-group-title::after{content:"3 LOCATIONS";display:inline-flex!important;align-items:center!important;height:21px!important;padding:0 7px!important;border:1px solid #e5d9e3!important;border-radius:6px!important;background:#f4eff2!important;color:#68465f!important;font-size:8px!important;font-weight:700!important;letter-spacing:.03em!important}
.ms-stock-group-title i{margin-right:6px!important;color:#875a7b!important;font-size:10px!important}
.ms-stock-row{display:flex!important;flex-direction:column!important;align-items:stretch!important;justify-content:space-between!important;gap:12px!important;min-width:0!important;min-height:94px!important;padding:10px!important;margin:0!important;border:1px solid #e8e4e9!important;border-radius:9px!important;background:#fff!important;transition:border-color .15s ease,box-shadow .15s ease!important}
.ms-stock-row:hover{border-color:#d8c7d7!important;box-shadow:0 3px 9px rgba(104,70,95,.07)!important}
.ms-stock-row-left{display:flex!important;flex-direction:column!important;align-items:flex-start!important;gap:5px!important;min-width:0!important}
.ms-stock-row-badge{display:inline-flex!important;align-items:center!important;justify-content:center!important;max-width:100%!important;width:auto!important;min-height:21px!important;padding:0 7px!important;border:1px solid transparent!important;border-radius:6px!important;color:#fff!important;font-size:8.5px!important;font-weight:800!important;letter-spacing:.05em!important}
.ms-stock-row-badge.gold{border-color:#ead9a8!important;background:#fbf6e9!important;color:#926b22!important}
.ms-stock-row-badge.silver{border-color:#d9dfe4!important;background:#f2f4f6!important;color:#64717c!important}
.ms-stock-row-badge.platinum{border-color:#d9d9de!important;background:#f2f2f4!important;color:#514a56!important}
.ms-stock-row-location{overflow:hidden!important;max-width:100%!important;color:#9b949f!important;font-size:9px!important;line-height:1.25!important;text-overflow:ellipsis!important;white-space:nowrap!important}
.ms-stock-row-qty-wrap{display:flex!important;align-items:baseline!important;justify-content:space-between!important;gap:5px!important;margin-top:auto!important;padding-top:7px!important;border-top:1px solid #f1edf2!important}
.ms-stock-row-available{color:#9b949f!important;font-size:7.5px!important;font-weight:800!important;letter-spacing:.07em!important}
.ms-stock-row-qty{color:#18181b!important;font-size:17px!important;font-weight:800!important;letter-spacing:-.03em!important;line-height:1.1!important;white-space:nowrap!important}
#ms-stock-footer{display:flex!important;align-items:center!important;justify-content:space-between!important;min-height:29px!important;padding:0 15px!important;border-top:1px solid #e6e2e8!important;background:#fff!important;color:#9b949f!important;font-size:8px!important;font-weight:700!important;letter-spacing:.07em!important}
#ms-stock-footer span:last-child{color:#875a7b!important}
#ms-stock-hzb-systray-item{display:flex!important;align-items:center!important;justify-content:center!important;width:42px!important;height:46px!important;flex:0 0 42px!important;padding:0!important;margin:0!important;pointer-events:auto!important}
#ms-stock-hzb-systray-button{display:flex!important;align-items:center!important;justify-content:center!important;width:42px!important;height:46px!important;padding:0!important;margin:0!important;border:0!important;border-radius:0!important;background:transparent!important;color:rgba(255,255,255,.8)!important;cursor:pointer!important;outline:0!important;pointer-events:auto!important;transition:background .15s ease,color .15s ease!important}
#ms-stock-hzb-systray-button:hover{background:rgba(255,255,255,.08)!important;color:#fff!important}
#ms-stock-hzb-systray-button i{font-family:FontAwesome!important;font-size:17px!important;color:inherit!important}
@media(max-width:680px){#ms-stock-panel{max-height:calc(100vh - 66px)!important}#ms-stock-body{max-height:calc(100vh - 130px)!important;padding:10px!important}.ms-stock-group{grid-template-columns:repeat(2,minmax(0,1fr))!important}.ms-stock-row{min-height:88px!important}}
@media(max-width:430px){#ms-stock-header{padding:10px 11px!important}#ms-stock-warehouse-count{display:none!important}#ms-stock-body{gap:8px!important;padding:8px!important}#ms-stock-search-box{gap:4px!important;padding:5px!important}#ms-stock-search{padding:0 9px!important}.ms-stock-group{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:6px!important;padding:8px!important}.ms-stock-row{min-height:84px!important;padding:8px!important}.ms-stock-result-title{align-items:flex-start!important}}
</style>

        <div id="ms-stock-panel">
            <div id="ms-stock-header">
                <div id="ms-stock-title">
                    <div id="ms-stock-logo"><i class="fa fa-cubes" aria-hidden="true"></i></div>
                    <div id="ms-stock-name">
                        <strong>Stock Checker</strong>
                        <span>Product availability across all warehouses</span>
                    </div>
                </div>
                <div id="ms-stock-header-meta">
                    <span id="ms-stock-warehouse-count"><i class="fa fa-warehouse" aria-hidden="true"></i> 6 WAREHOUSES</span>
                    <button id="ms-stock-close" type="button" aria-label="Close Stock Checker"><i class="fa fa-times" aria-hidden="true"></i></button>
                </div>
            </div>
            <div id="ms-stock-body">
                <form id="ms-stock-form" autocomplete="off">
                    <div id="ms-stock-search-box">
                        <div id="ms-stock-input-wrap">
                            <span id="ms-stock-search-icon"><i class="fa fa-search" aria-hidden="true"></i></span>
                            <input id="ms-stock-input" type="text" name="ms_stock_product" placeholder="Search product name, HZB or barcode..." autocomplete="new-password" autocorrect="off" autocapitalize="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false">
                            <div id="ms-stock-dropdown"></div>
                        </div>
                        <button id="ms-stock-search" type="submit"><i class="fa fa-search" aria-hidden="true"></i> Search</button>
                    </div>
                </form>
                <div id="ms-stock-result">
                    <div class="ms-stock-status">
                        <span class="ms-stock-status-icon"><i class="fa fa-box-open" aria-hidden="true"></i></span>
                        <span class="ms-stock-status-title">Search for a product</span>
                        <span class="ms-stock-status-hint">Enter a product name, HZB or barcode to check availability.</span>
                    </div>
                </div>
            </div>
            <div id="ms-stock-footer"><span>YODAWY WORKSPACE</span><span>STOCK CHECKER</span></div>
        </div>
    `;

const panel=document.getElementById('ms-stock-panel');
const input=document.getElementById('ms-stock-input');
const form=document.getElementById('ms-stock-form');
const button=document.getElementById('ms-stock-search');
const result=document.getElementById('ms-stock-result');
const close=document.getElementById('ms-stock-close');
const dropdown=document.getElementById('ms-stock-dropdown');

let searching=false;
let lookupTimer=null;
let lookupId=0;
let products=[];
let selectedProduct=null;
let activeIndex=-1;

const stop=e=>{
    e.stopPropagation();
};

[
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'pointerdown',
    'pointerup',
    'touchstart'
].forEach(event=>{
    input.addEventListener(event,stop);
    button.addEventListener(event,stop);
    close.addEventListener(event,stop);
});

const showStatus=text=>{
    result.innerHTML=`
        <div class="ms-stock-status">
            <span class="ms-stock-status-icon"><i class="fa fa-circle-info" aria-hidden="true"></i></span>
            <span class="ms-stock-status-title">${escapeHTML(text)}</span>
            <span class="ms-stock-status-hint">Search across Abu Rawash and Engy warehouses.</span>
        </div>
    `;
};

const closeDropdown=()=>{
    dropdown.classList.remove('open');
    dropdown.innerHTML='';
    input.setAttribute('aria-expanded','false');
    activeIndex=-1;
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
        showStatus('Select a product from the list');
        input.focus();
        return;
    }

    searching=true;

    button.disabled=true;
    button.textContent='...';

    closeDropdown();

    showStatus('Checking all 6 warehouses...');

    try{
        const data=await stocksForProduct(
            selectedProduct.id
        );

        const groups=['ABU RAWASH','ENGY'];

        result.innerHTML=`
                <div class="ms-stock-result-title">
                    <div class="ms-stock-result-ident">
                        <span class="ms-stock-result-eyebrow">MATCHED PRODUCT</span>
                        <span class="ms-stock-result-name">${escapeHTML(selectedProduct.display_name)}</span>
                        ${selectedProduct.hb_id? `<span class="ms-stock-result-hzb">HZB: ${escapeHTML(selectedProduct.hb_id)}</span>` : ''}
                    </div>
                    <span class="ms-stock-result-price">${priceHTML(selectedProduct)}</span>
                </div>

                ${groups.map(group=>`
                    <div class="ms-stock-group">
                        <div class="ms-stock-group-title"><span><i class="fa fa-warehouse" aria-hidden="true"></i> ${group}</span></div>
                        ${WAREHOUSES.filter(warehouse=>warehouse.group===group).map(warehouse=>{
                            const stock=data[warehouse.key];
                            return `
                                <div class="ms-stock-row">
                                    <div class="ms-stock-row-left">
                                        <span class="ms-stock-row-badge ${warehouse.name.toLowerCase()}">
                                            ${warehouse.name}
                                        </span>
                                        <span class="ms-stock-row-location">
                                            ${escapeHTML(stock.location)}
                                        </span>
                                    </div>
                                    <span class="ms-stock-row-qty-wrap">
                                        <span class="ms-stock-row-available">AVAILABLE</span>
                                        <span class="ms-stock-row-qty">${Number(stock.quantity||0).toLocaleString()} ${escapeHTML(stock.unit)}</span>
                                    </span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `).join('')}
            `;
        }catch(error){
            showStatus(error.message||'Search error');
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

const renderProducts=list=>{
    products=list||[];
    activeIndex=-1;

    if(!products.length){
        dropdown.innerHTML=
            '<div class="ms-stock-dropdown-status">No product found in the 6 warehouses</div>';

        dropdown.classList.add('open');
        input.setAttribute('aria-expanded','true');

        return;
    }

    dropdown.innerHTML=products.map((p,i)=>`
            <div
                class="ms-stock-product"
                data-index="${i}"
                role="option"
            >
                <span class="ms-stock-product-name">
                    ${escapeHTML(p.display_name)}
                </span>

                ${p.hb_id? `<span class="ms-stock-product-hzb">HZB: ${escapeHTML(p.hb_id)}</span>` : ''}
                <span class="ms-stock-product-price">${priceHTML(p)}</span>
            </div>
        `).join('');

        dropdown.classList.add('open');
        input.setAttribute('aria-expanded','true');

        dropdown.querySelectorAll('.ms-stock-product').forEach(item=>{
            item.addEventListener('mousedown',e=>{
                e.preventDefault();
                e.stopPropagation();

                selectProduct(
                    products[Number(item.dataset.index)]
                );
            });
        });
    };

const lookup=async value=>{
    const id=++lookupId;

    if(!value){
        closeDropdown();
        return;
    }

    dropdown.innerHTML=
        '<div class="ms-stock-dropdown-status">Searching all 6 warehouses...</div>';

    dropdown.classList.add('open');
    input.setAttribute('aria-expanded','true');

    try{
        const list=await searchStockProducts(value);

        if(id!==lookupId)return;

        renderProducts(list);
    }catch{
        if(id!==lookupId)return;

        dropdown.innerHTML=
            '<div class="ms-stock-dropdown-status">Search error</div>';

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

    lookupTimer=setTimeout(()=>{
        lookup(value);
    },250);
});

input.addEventListener('keydown',e=>{
    e.stopPropagation();

    if(e.key==='ArrowDown'&&products.length){
        e.preventDefault();

        activeIndex=Math.min(
            activeIndex+1,
            products.length-1
        );

        dropdown.querySelectorAll('.ms-stock-product').forEach((x,i)=>{
            x.classList.toggle(
                'active',
                i===activeIndex
            );
        });

        const active=
              dropdown.querySelector('.ms-stock-product.active');

        if(active){
            active.scrollIntoView({
                block:'nearest'
            });
        }

        return;
    }

    if(e.key==='ArrowUp'&&products.length){
        e.preventDefault();

        activeIndex=Math.max(
            activeIndex-1,
            0
        );

        dropdown.querySelectorAll('.ms-stock-product').forEach((x,i)=>{
            x.classList.toggle(
                'active',
                i===activeIndex
            );
        });

        const active=
              dropdown.querySelector('.ms-stock-product.active');

        if(active){
            active.scrollIntoView({
                block:'nearest'
            });
        }

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
    setTimeout(()=>{
        closeDropdown();
    },250);
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

    panel.classList.remove('open');

    closeDropdown();
});

const systrayItem=document.createElement('li');

systrayItem.id='ms-stock-hzb-systray-item';
systrayItem.setAttribute('role','menuitem');

systrayItem.innerHTML=`
        <button
            id="ms-stock-hzb-systray-button"
            type="button"
            title="Stock HZB"
            aria-label="Stock HZB"
        >
            <i class="fa fa-cubes" role="img" aria-label="Stock HZB"></i>
        </button>
    `;

const systrayButton=
      systrayItem.querySelector(
          '#ms-stock-hzb-systray-button'
      );

systrayButton.addEventListener('mousedown',e=>{
    e.stopPropagation();
});

systrayButton.addEventListener('mouseup',e=>{
    e.stopPropagation();
});

systrayButton.addEventListener('click',e=>{
    e.preventDefault();
    e.stopPropagation();

    panel.classList.toggle('open');

    if(panel.classList.contains('open')){
        setTimeout(()=>{
            input.focus();
        },50);
    }
});

const insertSystray=()=>{
    const nav=document.querySelector(
        '.o_main_navbar .o_menu_systray'
    );

    if(!nav)return false;

    const existing=document.getElementById(
        'ms-stock-hzb-systray-item'
    );

    if(existing&&existing.parentElement===nav){
        nav.prepend(existing);
        return true;
    }

    nav.prepend(systrayItem);

    return true;
};

if(!insertSystray()){
    const observer=new MutationObserver(()=>{
        if(insertSystray()){
            observer.disconnect();
        }
    });

    observer.observe(document.body,{
        childList:true,
        subtree:true
    });
}
}

createUI();

})();