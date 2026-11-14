// ==UserScript==
// @name         ODOO >>> ALTERNATIVE QUANTITY WARNING
// @namespace    https://odoo.yodawy.com/
// @version      1
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/web*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(async function(){
'use strict';

const WARNING_CLASS='ms-alt-qty-warning';
const HIDE_CLASS='ms-alt-qty-hidden';
const STYLE_ID='ms-alt-qty-style';
const PACK_TYPES='strip|pack|box|amp|vial|bottle|sachet|tube';

const getPackSize=text=>{
    const m=String(text||'').match(new RegExp(`(?:${PACK_TYPES})\\s*(?:of)?\\s*([\\d.]+)\\s*(?:tablet|tablets|tab|capsule|capsules|cap|ml|mg|gm|g|piece|pieces)?`,'i'));
    return m?Number(m[1]):0;
};

const getQty=text=>{
    const m=String(text||'').trim().match(/^([\d.]+)/);
    return m?Number(m[1]):0;
};

const getOriginal=item=>{
    const title=item.querySelector('.yodawy-drug-title')?.textContent?.trim()||'';

    let m=title.match(
        new RegExp(
            `(?:^|,)\\s*([\\d.]+)\\s+(?:${PACK_TYPES})\\s+of\\s+([\\d.]+)\\s*\\w*`,
            'i'
        )
    );

    if(!m){
        m=title.match(
            new RegExp(
                `([\\d.]+)\\s+(?:${PACK_TYPES})\\s+of\\s+([\\d.]+)`,
                'i'
            )
        );
    }

    if(!m)return null;

    const qty=Number(m[1]);
    const unit=Number(m[2]);

    if(!qty||!unit)return null;

    return {
        qty,
        unit,
        total:qty*unit
    };
};

const getRequiredQty=(originalTotal,altUnit)=>{
    if(!originalTotal||!altUnit)return null;

    const exact=originalTotal/altUnit;
    const lower=Math.floor(exact);
    const upper=Math.ceil(exact);
    const allowed=altUnit*0.5;

    const lowerTotal=lower*altUnit;
    const upperTotal=upper*altUnit;

    const lowerDiff=originalTotal-lowerTotal;
    const upperDiff=upperTotal-originalTotal;

    const lowerValid=lower>0&&lowerDiff<=allowed;
    const upperValid=upper>0&&upperDiff<=allowed;

    if(lowerValid&&upperValid){
        return lowerDiff<=upperDiff
            ?{
                qty:lower,
                total:lowerTotal,
                difference:lowerDiff,
                type:'LOWER'
            }
            :{
                qty:upper,
                total:upperTotal,
                difference:upperDiff,
                type:'UPPER'
            };
    }

    if(lowerValid){
        return {
            qty:lower,
            total:lowerTotal,
            difference:lowerDiff,
            type:'LOWER'
        };
    }

    if(upperValid){
        return {
            qty:upper,
            total:upperTotal,
            difference:upperDiff,
            type:'UPPER'
        };
    }

    return null;
};

const injectStyles=()=>{
    if(document.getElementById(STYLE_ID))return;

    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
        .ms-alt-qty-warning{
            display:inline-flex;
            align-items:center;
            justify-content:center;
            gap:4px;
            margin-left:0;
            padding:3px 7px;
            border-radius:5px;
            background:#fff1f2;
            border:1px solid #fecdd3;
            color:#be123c;
            font-size:10px;
            font-weight:700;
            line-height:1;
            vertical-align:middle;
            cursor:help;
            white-space:nowrap;
        }
        .ms-alt-qty-current{
            opacity:.7;
            font-weight:600;
        }
        .ms-alt-qty-arrow{
            opacity:.5;
        }
        .ms-alt-qty-required{
            font-weight:800;
        }
        .${HIDE_CLASS}{
            display:none!important;
        }
    `;

    document.head.appendChild(style);
};

const hideOriginal=cell=>{
    [...cell.childNodes].forEach(node=>{
        if(node.nodeType===3&&node.textContent.trim()){
            const span=document.createElement('span');
            span.className=HIDE_CLASS;
            span.textContent=node.textContent;
            node.replaceWith(span);
        }else if(
            node.nodeType===1&&
            !node.classList.contains(WARNING_CLASS)
        ){
            node.classList.add(HIDE_CLASS);
        }
    });
};

const restoreOriginal=cell=>{
    cell.querySelectorAll(`.${HIDE_CLASS}`).forEach(el=>{
        if(el.parentElement===cell&&el.tagName==='SPAN'){
            el.replaceWith(document.createTextNode(el.textContent));
        }else{
            el.classList.remove(HIDE_CLASS);
        }
    });
};

const showResult=(cell,original,altUnit,required,currentQty)=>{
    const old=cell.querySelector(`.${WARNING_CLASS}`);

    if(required&&required.qty===currentQty){
        old?.remove();
        restoreOriginal(cell);
        return;
    }

    hideOriginal(cell);

    if(old){
        if(
            old.dataset.required===String(required?.qty||'')&&
            old.dataset.current===String(currentQty)
        ){
            return;
        }
        old.remove();
    }

    const el=document.createElement('span');
    el.className=WARNING_CLASS;
    el.dataset.required=String(required?.qty||'');
    el.dataset.current=String(currentQty);

    if(required){
        el.title=
            `Original: ${original.qty} × ${original.unit} = ${original.total}\n`+
            `Required: ${required.qty} × ${altUnit} = ${required.total}\n`+
            `Difference: ${required.difference}\n`+
            `Allowed: ${altUnit*0.5}\n`+
            `Odoo Qty: ${currentQty}`;

        const current=document.createElement('span');
        current.className='ms-alt-qty-current';
        current.textContent=currentQty;

        const arrow=document.createElement('span');
        arrow.className='ms-alt-qty-arrow';
        arrow.textContent='>>>';

        const requiredQty=document.createElement('span');
        requiredQty.className='ms-alt-qty-required';
        requiredQty.textContent=`${required.qty}`;

        el.append(current,arrow,requiredQty);
    }else{
        el.textContent='NO VALID QTY';
        el.title=
            `Original: ${original.total}\n`+
            `Alternative pack: ${altUnit}\n`+
            `Maximum allowed difference: ${altUnit*0.5}`;
    }

    cell.appendChild(el);
};

const checkItem=item=>{
    const table=item.querySelector('table');
    const original=getOriginal(item);

    if(!table||!original)return;

    table.querySelectorAll('tbody tr').forEach(row=>{
        const cells=row.querySelectorAll('td');

        if(cells.length<5)return;

        const alternative=cells[0]?.textContent?.trim();
        const form=cells[1]?.textContent?.trim();
        const currentQty=getQty(cells[3]?.textContent);
        const altUnit=getPackSize(form);

        if(!alternative||!altUnit)return;

        const required=getRequiredQty(original.total,altUnit);

        showResult(
            cells[3],
            original,
            altUnit,
            required,
            currentQty
        );
    });
};

const scan=()=>{
    document.querySelectorAll('.yodawy-accordion-item').forEach(checkItem);
};

let scanTimer=0;

const scheduleScan=()=>{
    clearTimeout(scanTimer);
    scanTimer=setTimeout(scan,100);
};

const observer=new MutationObserver(mutations=>{
    for(const mutation of mutations){
        if(mutation.target?.closest?.(`.${WARNING_CLASS}`))continue;

        const relevant=[
            ...mutation.addedNodes,
            ...mutation.removedNodes
        ].some(node=>{
            if(node.nodeType!==1)return false;
            if(node.matches?.(`.${WARNING_CLASS}`))return false;

            return node.matches?.('.yodawy-accordion-item')||
                   node.closest?.('.yodawy-accordion-item')||
                   node.querySelector?.('.yodawy-accordion-item');
        });

        if(relevant){
            scheduleScan();
            return;
        }
    }
});

injectStyles();

const registry=window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
registry['ALTERNATIVE-QUANTITY-WARNING']={
    suspend(){
        observer.disconnect();
        clearTimeout(scanTimer);
        document.querySelectorAll('.yodawy-accordion-item td').forEach(cell=>{restoreOriginal(cell);cell.querySelectorAll(`.${WARNING_CLASS}`).forEach(item=>item.remove());});
        document.getElementById(STYLE_ID)?.remove();
        return true;
    },
    resume(){injectStyles();observer.observe(document.body,{childList:true,subtree:true});scan();return true;}
};

observer.observe(document.body,{childList:true,subtree:true});
scan();

})();
