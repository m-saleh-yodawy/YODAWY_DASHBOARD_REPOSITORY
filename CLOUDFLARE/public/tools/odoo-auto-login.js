// ==UserScript==
// @name         Odoo Auto Login
// @namespace    http://tampermonkey.net/
// @version      1
// @description  Open Yodawy ERX directly by clicking the customer card number
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function(){
    'use strict';

    const companyMap={
        'administrative control authority (aca)':'administrative control authority (aca)',
        'ahly medical':'ahly medical',
        'ain shams university':'ain shams university',
        'amis':'amis',
        'apatch petroleum':'apatch petroleum',
        'axa services egypt':'axa services egypt',
        'axon':'axon',
        'bank misr':'bank misr',
        'baraka bank':'baraka bank',
        'bupa':'bupa',
        'care plus':'care plus',
        'central bank of egypt':'central bank of egypt',
        'cheiron - pico petroleum':'cheiron - pico petroleum',
        'ciaf':'ciaf',
        'coca-cola':'coca-cola',
        'des':'des',
        'dms':'dms',
        'egy-care':'egy-care',
        'egymed':'egymed',
        'el mashreq':'el mashreq',
        'eltawon':'eltawon',
        'emc':'emc',
        'eshpetco':'eshpetco',
        'globemed':'globemed',
        'housing and building research center':'housing and building research center',
        'inaya egypt co.':'inaya egypt co.',
        'iqvia psp':'iqvia psp',
        'journalist syndicate':'journalist syndicate',
        'libano-suisse':'libano-suisse',
        'life healthcare':'life healthcare',
        'masr el khier':'masr el khier',
        'medicard':'medicard',
        'medicare':'medicare',
        'mediconsult':'mediconsult',
        'medmark':'medmark',
        'medmisr':'medmisr',
        'mednet':'mednet',
        'medright':'medright',
        'medright tpa':'medright tpa',
        'medsure':'medsure',
        'metlife':'metlife',
        'misr health care':'misr health care',
        'national authority for printing & publishing':'national authority for printing & publishing',
        'neqabty':'neqabty',
        'next care':'next care',
        'nilesat':'nilesat',
        'omega care':'omega care',
        'pfizer psp':'pfizer psp',
        'prime health':'prime health',
        'prime health insurance':'prime health insurance',
        'reliance healthcare':'reliance healthcare',
        'roche psp':'roche psp',
        'sedico':'sedico',
        'seha one':'seha one',
        'sheraton':'sheraton',
        'smart medical services':'smart medical services',
        'suez canal life insurance':'suez canal life insurance',
        'unicare':'unicare',
        'unimed':'unimed',
        'wadi el neel':'wadi el neel',
        'yodawy direct orders':'yodawy direct orders'
    };

    const normalize=s=>s.replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim().toLowerCase();

    const style=document.createElement('style');
    style.textContent='span[name="user_ref"][data-erx-enabled="true"]{cursor:pointer!important}span[name="user_ref"][data-erx-enabled="true"]:hover{text-decoration:underline!important}';
    document.head.appendChild(style);

    function setup(){
        const r=document.querySelector('span[name="user_ref"]');
        const p=document.querySelector('span[name="payor_id"] span');
        const n=document.querySelector('span[name="prescription_number"]');
        if(!r||!p||!n||r.dataset.erxEnabled)return;

        r.dataset.erxEnabled='true';
        r.title='Open ERX';

        r.onclick=()=>{
            const company=companyMap[normalize(p.textContent)];
            if(!company)return alert(`Unsupported Company: ${normalize(p.textContent)}`);

            const url=`https://portal.yodawy.com/?tm=1&mode=openPortal&company=${encodeURIComponent(company)}&card=${encodeURIComponent(r.textContent.trim())}&fn=${encodeURIComponent(n.textContent.trim())}`;
            window.open(url,'_blank');
        };
    }

    const observer=new MutationObserver(setup);
    const registry=window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    registry['ODOO-AUTO-LOGIN']={
        suspend(){observer.disconnect();const ref=document.querySelector('span[name="user_ref"]');if(ref){ref.onclick=null;delete ref.dataset.erxEnabled;ref.removeAttribute('title');}style.remove();return true;},
        resume(){if(!style.isConnected)document.head.appendChild(style);observer.observe(document.body,{childList:true,subtree:true});setup();return true;}
    };
    observer.observe(document.body,{childList:true,subtree:true});
    setup();

})();
