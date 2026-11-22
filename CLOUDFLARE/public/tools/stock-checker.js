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
        {group:'ENGY',name:'GOLD',key:'engyGold',path:'egw/Stock',locationId:673},
        {group:'ENGY',name:'SILVER',key:'engySilver',path:'esiw/Stock',locationId:659},
        {group:'ENGY',name:'PLATINUM',key:'engyPlatinum',path:'ep/Stock',locationId:645}
    ];

    const ID='ms-stock-hzb-checker';
    let stockLocationTreePromise=null;

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

    async function getStockLocationTree(){
        if(!stockLocationTreePromise){
            stockLocationTreePromise=(async()=>{
                const domain=[
                    ...Array(WAREHOUSES.length-1).fill('|'),
                    ...WAREHOUSES.map(warehouse=>['id','child_of',warehouse.locationId])
                ];

                const rows=await rpc('stock.location','search_read',{
                    domain,
                    fields:['id','complete_name','location_id'],
                    limit:20000,
                    order:'complete_name asc'
                });

                const rootIds=new Set(WAREHOUSES.map(warehouse=>warehouse.locationId));
                const foundRoots=new Set(rows.filter(row=>rootIds.has(row.id)).map(row=>row.id));
                const missing=WAREHOUSES.filter(warehouse=>!foundRoots.has(warehouse.locationId));

                if(missing.length){
                    throw Error(`Stock locations not found: ${missing.map(warehouse=>warehouse.path).join(', ')}`);
                }

                const parents=new Map(rows.map(row=>[
                    row.id,
                    Array.isArray(row.location_id)?row.location_id[0]:null
                ]));
                const rootByLocationId=new Map();

                rows.forEach(row=>{
                    let current=row.id;
                    const visited=new Set();

                    while(current&&!visited.has(current)){
                        if(rootIds.has(current)){
                            rootByLocationId.set(row.id,current);
                            break;
                        }

                        visited.add(current);
                        current=parents.get(current);
                    }
                });

                return{
                    locationIds:[...rootByLocationId.keys()],
                    rootByLocationId
                };
            })().catch(error=>{
                stockLocationTreePromise=null;
                throw error;
            });
        }

        return stockLocationTreePromise;
    }

    async function readQuantGroups(productIds,tree){
        const domain=[
            ['product_id','in',productIds],
            ['location_id','in',tree.locationIds]
        ];

        try{
            const groups=await rpc('stock.quant','read_group',{
                domain,
                fields:[
                    'product_id',
                    'location_id',
                    'product_uom_id',
                    'quantity:sum',
                    'reserved_quantity:sum'
                ],
                groupby:['product_id','location_id','product_uom_id'],
                lazy:false,
                limit:20000
            });

            if(groups.some(row=>(row.quantity===undefined&&row.quantity_sum===undefined)||(row.reserved_quantity===undefined&&row.reserved_quantity_sum===undefined))){
                throw Error('Unsupported stock aggregation response');
            }

            return groups;
        }catch{
            return rpc('stock.quant','search_read',{
                domain,
                fields:['product_id','location_id','product_uom_id','quantity','reserved_quantity'],
                limit:50000,
                order:'product_id asc'
            });
        }
    }

    function getWarehouseForQuant(row,tree){
        const locationId=Array.isArray(row.location_id)?row.location_id[0]:row.location_id;
        const rootId=tree.rootByLocationId.get(locationId);
        return WAREHOUSES.find(warehouse=>warehouse.locationId===rootId)||null;
    }

    async function searchStockProducts(value){
        const text=value.trim();
        if(!text)return[];

        const [tree,productRows]=await Promise.all([
            getStockLocationTree(),
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

        const quantGroups=await readQuantGroups(productIds,tree);
        const stockedProductIds=new Set();

        quantGroups.forEach(row=>{
            const productId=Array.isArray(row.product_id)?row.product_id[0]:row.product_id;
            if(productId&&getWarehouseForQuant(row,tree))stockedProductIds.add(productId);
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
        const tree=await getStockLocationTree();
        const rows=await readQuantGroups([productId],tree);
        const result=Object.fromEntries(WAREHOUSES.map(warehouse=>[
            warehouse.key,
            {quantity:0,unit:'',location:warehouse.path}
        ]));

        rows.forEach(row=>{
            const warehouse=getWarehouseForQuant(row,tree);
            if(!warehouse)return;

            const quantity=Number(row.quantity??row.quantity_sum??0);
            const reserved=Number(row.reserved_quantity??row.reserved_quantity_sum??0);
            const stock=result[warehouse.key];

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
        right:20px!important;
        bottom:20px!important;
        width:860px!important;
        z-index:2147483647!important;
        pointer-events:none!important;
        display:block!important;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif!important;
    `;

    document.body.appendChild(host);

    host.innerHTML=`
        <style>
            #ms-stock-panel,#ms-stock-panel *{
                box-sizing:border-box!important;
                font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif!important;
            }

            #ms-stock-panel{
                display:none!important;
                width:860px!important;
                height:500px!important;
                min-height:500px!important;
                max-height:500px!important;
                background:#fff!important;
                color:#666!important;
                border:1px solid #68465f!important;
                border-radius:6px!important;
                box-shadow:0 4px 16px rgba(0,0,0,.25)!important;
                overflow:hidden!important;
                pointer-events:auto!important;
            }

            #ms-stock-panel.open{
                display:block!important;
            }

            #ms-stock-header{
                height:48px!important;
                display:flex!important;
                align-items:center!important;
                justify-content:space-between!important;
                padding:0 12px!important;
                background:#875A7B!important;
                color:#fff!important;
                border-radius:5px 5px 0 0!important;
            }

            #ms-stock-title{
                display:flex!important;
                align-items:center!important;
                gap:9px!important;
            }

            #ms-stock-logo{
                width:28px!important;
                height:28px!important;
                display:flex!important;
                align-items:center!important;
                justify-content:center!important;
                border-radius:4px!important;
                background:#68465f!important;
                color:#fff!important;
                font-size:13px!important;
                font-weight:700!important;
            }

            #ms-stock-name{
                display:flex!important;
                flex-direction:column!important;
                line-height:1.2!important;
            }

            #ms-stock-name strong{
                font-size:13px!important;
                color:#fff!important;
            }

            #ms-stock-name span{
                margin-top:2px!important;
                font-size:10px!important;
                color:rgba(255,255,255,.75)!important;
            }

            #ms-stock-close{
                width:28px!important;
                height:28px!important;
                border:1px solid rgba(255,255,255,.35)!important;
                border-radius:4px!important;
                background:transparent!important;
                color:#fff!important;
                cursor:pointer!important;
                font-size:17px!important;
                padding:0!important;
                margin:0!important;
                outline:0!important;
            }

            #ms-stock-body{
                height:426px!important;
                padding:10px!important;
                background:#fff!important;
            }

            #ms-stock-form{
                margin:0!important;
                padding:0!important;
            }

            #ms-stock-search-box{
                position:relative!important;
                display:flex!important;
                align-items:center!important;
                gap:7px!important;
                min-height:48px!important;
                height:48px!important;
                padding:7px 9px!important;
                margin:0 0 8px 0!important;
                border:1px solid #d9d9d9!important;
                border-radius:4px!important;
                background:#fff!important;
            }

            #ms-stock-input-wrap{
                position:relative!important;
                flex:1 1 auto!important;
                min-width:0!important;
            }

            #ms-stock-input{
                display:block!important;
                width:100%!important;
                height:30px!important;
                min-height:30px!important;
                padding:0 9px!important;
                margin:0!important;
                border:1px solid #ccc!important;
                border-radius:4px!important;
                outline:none!important;
                background:#fff!important;
                background-image:none!important;
                color:#111!important;
                font-size:14px!important;
                font-weight:bold!important;
                line-height:30px!important;
                box-shadow:none!important;
                appearance:none!important;
                -webkit-appearance:none!important;
                pointer-events:auto!important;
                user-select:text!important;
                -webkit-user-select:text!important;
                cursor:text!important;
            }

            #ms-stock-input:focus{
                border-color:#875A7B!important;
                box-shadow:0 0 0 1px #875A7B!important;
            }

            #ms-stock-input::placeholder{
                color:#999!important;
                opacity:1!important;
            }

            #ms-stock-search{
                height:30px!important;
                padding:0 14px!important;
                margin:0!important;
                border:1px solid #68465f!important;
                border-radius:4px!important;
                background:#875A7B!important;
                color:#fff!important;
                font-size:10px!important;
                font-weight:700!important;
                cursor:pointer!important;
                pointer-events:auto!important;
                outline:0!important;
            }

            #ms-stock-search:hover{
                background:#68465f!important;
            }

            #ms-stock-search:disabled{
                background:#aaa!important;
                border-color:#aaa!important;
                cursor:not-allowed!important;
            }

            #ms-stock-dropdown{
                display:none!important;
                position:absolute!important;
                top:33px!important;
                left:0!important;
                right:0!important;
                max-height:300px!important;
                overflow-y:auto!important;
                overflow-x:hidden!important;
                z-index:2147483647!important;
                background:#fff!important;
                border:1px solid #ccc!important;
                border-radius:4px!important;
                box-shadow:0 5px 14px rgba(0,0,0,.2)!important;
                pointer-events:auto!important;
            }

            #ms-stock-dropdown.open{
                display:block!important;
            }

            .ms-stock-product{
                display:block!important;
                width:100%!important;
                padding:9px 10px!important;
                margin:0!important;
                border:0!important;
                border-bottom:1px solid #eee!important;
                background:#fff!important;
                color:#444!important;
                cursor:pointer!important;
                font-size:10px!important;
                line-height:1.4!important;
                text-align:left!important;
                pointer-events:auto!important;
            }

            .ms-stock-product:last-child{
                border-bottom:0!important;
            }

            .ms-stock-product:hover,
            .ms-stock-product.active{
                background:#f3edf2!important;
            }

            .ms-stock-product-name{
                display:block!important;
                color:#111!important;
                font-size:14px!important;
                font-weight:bold!important;
            }

            .ms-stock-product-hzb{
                display:block!important;
                margin-top:2px!important;
                color:#111!important;
                font-size:10px!important;
                font-weight:600!important;
            }

            .ms-stock-product-price{
                display:block!important;
                margin-top:3px!important;
                color:#875A7B!important;
                font-size:11px!important;
                font-weight:700!important;
            }

            .ms-stock-dropdown-status{
                display:block!important;
                padding:10px!important;
                color:#999!important;
                font-size:10px!important;
                text-align:center!important;
            }

            #ms-stock-result{
                height:352px!important;
                max-height:352px!important;
                overflow-y:auto!important;
                overflow-x:hidden!important;
                padding:8px!important;
                border:1px solid #d9d9d9!important;
                border-radius:4px!important;
                background:#fff!important;
            }

            .ms-stock-status{
                display:flex!important;
                align-items:center!important;
                gap:7px!important;
                min-height:44px!important;
                color:#666!important;
                font-size:10px!important;
                font-weight:600!important;
            }

            .ms-stock-dot{
                width:7px!important;
                height:7px!important;
                flex:0 0 7px!important;
                border-radius:50%!important;
                background:#875A7B!important;
            }

            .ms-stock-result-title{
                height:34px!important;
                display:flex!important;
                align-items:center!important;
                justify-content:space-between!important;
                gap:10px!important;
                padding:0 8px!important;
                margin-bottom:8px!important;
                color:#444!important;
                font-size:12px!important;
                font-weight:700!important;
                white-space:nowrap!important;
                overflow:hidden!important;
                border-bottom:1px solid #eee!important;
            }

            .ms-stock-result-name{
                min-width:0!important;
                overflow:hidden!important;
                text-overflow:ellipsis!important;
            }

            .ms-stock-result-hzb{
                margin-left:8px!important;
                color:#875A7B!important;
                font-size:11px!important;
                font-weight:700!important;
            }

            .ms-stock-result-price{
                flex:0 0 auto!important;
                padding-left:10px!important;
                color:#875A7B!important;
                font-size:12px!important;
                font-weight:700!important;
            }

            .ms-stock-group{
                margin:0 0 8px 0!important;
            }

            .ms-stock-group-title{
                display:flex!important;
                align-items:center!important;
                height:25px!important;
                padding:0 9px!important;
                margin:0 0 6px 0!important;
                border-left:3px solid #875A7B!important;
                border-radius:2px!important;
                background:#f8f5f7!important;
                color:#68465f!important;
                font-size:10px!important;
                font-weight:800!important;
                letter-spacing:.4px!important;
            }

            .ms-stock-row{
                display:flex!important;
                align-items:center!important;
                justify-content:space-between!important;
                gap:15px!important;
                height:47px!important;
                min-height:47px!important;
                padding:10px 14px!important;
                margin-bottom:8px!important;
                border:1px solid #e2e2e2!important;
                border-radius:4px!important;
                background:#fff!important;
            }

            .ms-stock-row:last-child{
                margin-bottom:0!important;
            }

            .ms-stock-row-left{
                display:flex!important;
                align-items:center!important;
                gap:14px!important;
                min-width:0!important;
            }

            .ms-stock-row-badge{
                width:90px!important;
                flex:0 0 90px!important;
                text-align:center!important;
                padding:7px 4px!important;
                border-radius:4px!important;
                color:#fff!important;
                font-size:10px!important;
                font-weight:700!important;
            }

            .ms-stock-row-badge.platinum{
                background:#9aa0a6!important;
            }

            .ms-stock-row-badge.gold{
                background:#d4a72c!important;
            }

            .ms-stock-row-badge.silver{
                background:#8c969f!important;
            }

            .ms-stock-row-location{
                color:#999!important;
                font-size:10px!important;
                white-space:nowrap!important;
            }

            .ms-stock-row-qty{
                color:#875A7B!important;
                font-size:16px!important;
                font-weight:700!important;
                white-space:nowrap!important;
            }

            #ms-stock-footer{
                height:26px!important;
                display:flex!important;
                align-items:center!important;
                justify-content:center!important;
                border-top:1px solid #e6e6e6!important;
                background:#fafafa!important;
                color:#999!important;
                font-size:9px!important;
                border-radius:0 0 5px 5px!important;
            }

            #ms-stock-hzb-systray-item{
                display:flex!important;
                align-items:center!important;
                justify-content:center!important;
                width:42px!important;
                height:46px!important;
                padding:0!important;
                margin:0!important;
                flex:0 0 42px!important;
                pointer-events:auto!important;
            }

            #ms-stock-hzb-systray-button{
                display:flex!important;
                align-items:center!important;
                justify-content:center!important;
                width:42px!important;
                height:46px!important;
                padding:0!important;
                margin:0!important;
                border:0!important;
                background:transparent!important;
                color:rgba(255,255,255,.8)!important;
                cursor:pointer!important;
                outline:0!important;
                pointer-events:auto!important;
            }

            #ms-stock-hzb-systray-button:hover{
                background:rgba(255,255,255,.08)!important;
                color:#fff!important;
            }

            #ms-stock-hzb-systray-button i{
                font-family:FontAwesome!important;
                font-size:18px!important;
                color:inherit!important;
            }
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
                <form id="ms-stock-form" autocomplete="off">
                    <div id="ms-stock-search-box">
                        <div id="ms-stock-input-wrap">
                            <input
                                id="ms-stock-input"
                                type="text"
                                name="ms_stock_product"
                                placeholder="Search product or HZB..."
                                autocomplete="new-password"
                                autocorrect="off"
                                autocapitalize="off"
                                spellcheck="false"
                                role="combobox"
                                aria-autocomplete="list"
                                aria-expanded="false"
                            >
                            <div id="ms-stock-dropdown"></div>
                        </div>

                        <button id="ms-stock-search" type="submit">
                            SEARCH
                        </button>
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
                <span class="ms-stock-dot"></span>
                <span>${escapeHTML(text)}</span>
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
                    <span class="ms-stock-result-name">
                        ${escapeHTML(selectedProduct.display_name)}
                        ${selectedProduct.hb_id? `<span class="ms-stock-result-hzb">HZB: ${escapeHTML(selectedProduct.hb_id)}</span>` : ''}
                    </span>
                    <span class="ms-stock-result-price">${priceHTML(selectedProduct)}</span>
                </div>

                ${groups.map(group=>`
                    <div class="ms-stock-group">
                        <div class="ms-stock-group-title">${group}</div>
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
                                    <span class="ms-stock-row-qty">
                                        ${Number(stock.quantity||0).toLocaleString()}
                                        ${escapeHTML(stock.unit)}
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