// ==UserScript==
// @name         Portal Auto Split
// @namespace    http://tampermonkey.net/
// @version      1
// @author       Mohamed Saleh
// @match        https://portal.yodawy.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(async function(){
    "use strict";

    const params=new URLSearchParams(location.search);
    if(params.get("tm")!=="1")return;

    const company=(params.get("company")||"").trim().toLowerCase();
    const card=(params.get("card")||"").trim();
    const prescriptionKey=(params.get("fn")||"").trim();
    const cycle=(params.get("cycle")||"").replace(/\+/g," ").replace(/\s+/g," ").trim();
    const payor=(params.get("payor")||"").trim();
    const employer=(params.get("employer")||"").trim();
    const splitDrugs=(params.get("split")||"").split("||").map(x=>x.trim()).filter(Boolean);
    const requestedAccountType=(params.get("accountType")||"").trim().toUpperCase();

    if(!params.has("split")||!params.get("split").trim())return;

    history.replaceState(null,"",location.pathname+location.hash);

    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const waitForApi=async()=>{
        const started=Date.now();
        while(Date.now()-started<20000){
            const api=window.YODAWY_API_ENGINE;
            if(api?.getPortalAccounts&&api?.getPortalCredentials)return api;
            await sleep(250);
        }
        throw new Error("Cloud account service is unavailable.");
    };
    const resolveAccount=async()=>{
        const api=await waitForApi();
        const provider=company.includes("metlife")?"METLIFE":company.includes("nextcare")?"NEXTCARE":"";
        if(!provider)throw new Error("Unsupported Company: "+company);
        const accountResponse=await api.getPortalAccounts();
        const result=accountResponse?.data||accountResponse;
        if(result?.success!==true)throw new Error(result?.error||"Portal accounts could not be loaded.");
        const accounts=(result.accounts||[]).filter(item=>item.provider===provider);
        const settingsResponse=await api.get("/api/dashboard/settings");
        const settingsData=settingsResponse?.data||settingsResponse;
        const settings=settingsData?.settings||{};
        const preference=String(settings.preferences?.metlifeSplitAccount||"").toUpperCase();
        const accountType=provider==="METLIFE"?(requestedAccountType||preference||""):"PERSONAL";
        const candidates=accounts.filter(item=>item.accountType===accountType);
        if(!accountType)throw new Error("Select a MetLife split account in Dashboard settings first.");
        if(!candidates.length)throw new Error("The selected "+accountType+" "+provider+" account is not configured.");
        const credentialResponse=await api.getPortalCredentials(candidates[0].id);
        const response=credentialResponse?.data||credentialResponse;
        if(response?.success!==true||!response.credentials?.username||!response.credentials?.password)throw new Error("Portal credentials are unavailable.");
        return response.credentials;
    };

    if(!card)return alert("Card Number Missing");
    if(!prescriptionKey)return alert("Prescription Number / FN Missing");
    if(!cycle)return alert("Cycle Missing\\n\\nPlease make sure Odoo sends the Cycle.");
    if(!splitDrugs.length)return alert("No Split Drugs Found");

    let account;
    try{account=await resolveAccount();}catch(error){alert(error.message||"Portal account is unavailable.");return;}

    const visible=selector=>
    [...document.querySelectorAll(selector)].filter(el=>el.offsetParent!==null);

    async function waitForElement(find,timeout=30000,interval=200){
        const start=Date.now();

        while(Date.now()-start<timeout){
            try{
                const el=find();
                if(el)return el;
            }catch{}
            await sleep(interval);
        }

        throw new Error("Element Not Found");
    }

    function clickLikeUser(el){
        if(!el)throw new Error("Cannot click empty element");

        el.dispatchEvent(new MouseEvent("mousedown",{bubbles:true,cancelable:true,view:window}));
        el.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true,view:window}));
        el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window}));
    }

    function setReactValue(input,value){
        if(!input)throw new Error("Input not found");

        input.setAttribute("autocomplete","off");

        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;

        setter.call(input,value);
        input.dispatchEvent(new Event("input",{bubbles:true}));
        input.dispatchEvent(new Event("change",{bubbles:true}));
    }

    function normalizeDrugName(name){
        return String(name||"")
            .toUpperCase()
            .replace(/[µμ]/g,"MCG")
            .replace(/[^A-Z]/g,"")
            .slice(0,5);
    }

    function parseCycle(value){
        const match=String(value||"").trim().match(/^([A-Za-z]+)\s+(\d{4})$/);

        if(!match)throw new Error(`Invalid Cycle Format: ${value}`);

        const monthMap={
            january:0,
            february:1,
            march:2,
            april:3,
            may:4,
            june:5,
            july:6,
            august:7,
            september:8,
            october:9,
            november:10,
            december:11
        };

        const month=monthMap[match[1].toLowerCase()];

        if(month===undefined)throw new Error(`Invalid Cycle Month: ${match[1]}`);

        return{month,year:Number(match[2])};
    }

    function generateSerial(){
        const letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let serial="";

        for(let i=0;i<4;i++)serial+=letters[Math.floor(Math.random()*letters.length)];
        for(let i=0;i<4;i++)serial+=Math.floor(Math.random()*10);

        return serial;
    }

    async function login(){
        if(document.body.innerText.includes("Search Member"))return;

        const inputs=await waitForElement(()=>{
            const list=visible("input");
            return list.length>=2?list:null;
        });

        setReactValue(inputs[0],account.username);
        setReactValue(inputs[1],account.password);

        const button=await waitForElement(()=>
                                          [...document.querySelectorAll("button")].find(
            b=>b.innerText.trim().toLowerCase()==="login"
        )
                                         );

        await sleep(300);
        clickLikeUser(button);
        await sleep(3000);
    }

    async function openSearchMember(){
        const span=await waitForElement(()=>
                                        [...document.querySelectorAll("span")].find(
            el=>el.textContent.trim()==="Search Member"
        )
                                       );

        const button=span.closest("button");

        if(!button)throw new Error("Search Member button not found");

        clickLikeUser(button);
        await sleep(700);
    }

    async function fillCardNumber(){
        const input=await waitForElement(()=>{
            const inputs=visible("input[type='text']");
            return inputs.length>=7?inputs[6]:null;
        });

        setReactValue(input,card);
        await sleep(300);
    }

    async function clickProceed(){
        const span=await waitForElement(()=>
                                        [...document.querySelectorAll("span")].find(
            el=>el.textContent.trim()==="Proceed"
        )
                                       );

        const button=span.closest("button");

        if(!button)throw new Error("Proceed button not found");

        clickLikeUser(button);
        await sleep(2500);
    }

    async function getPrescriptionTable(){
        return waitForElement(()=>
                              [...document.querySelectorAll("table")].find(
            table=>
            table.innerText.includes("Date")&&
            table.innerText.includes("Expire")&&
            table.innerText.includes("Status")&&
            table.querySelector("tbody tr")
        )
                             );
    }

    async function getCurrentPortalFormNumber(){
        return waitForElement(()=>{
            const label=[...document.querySelectorAll("label")].find(
                el=>el.textContent.trim()==="Form Number"
            );

            if(!label?.parentElement)return null;

            const value=[...label.parentElement.querySelectorAll("label")].find(
                el=>el!==label&&el.textContent.trim()
            );

            return value?.textContent.trim()||null;
        },15000);
    }

    async function selectCorrectPrescription(){
        const target=prescriptionKey.toLowerCase();
        const table=await getPrescriptionTable();
        const rows=[...table.querySelectorAll("tbody > tr")];

        for(const row of rows){
            row.click();
            await sleep(500);

            const current=(await getCurrentPortalFormNumber()).toLowerCase();

            if(current===target)return;
        }

        throw new Error(`Correct prescription was not found. Target Form Number: ${prescriptionKey}`);
    }

    function isSplitPageOpened(){
        const text=document.body.innerText||"";

        return(
            text.includes("Expiry Date")||
            text.includes("Max Amount")||
            text.includes("Directly Sync Prescription After Splitting")||
            [...document.querySelectorAll("label")].some(
                l=>l.textContent.trim().toLowerCase()==="expiry date"
            )||
            (document.querySelectorAll('input[type="checkbox"]').length&&
             text.toLowerCase().includes("split"))
        );
    }

    async function clickSplitPrescription(){
        const button=await waitForElement(()=>{
            const span=[...document.querySelectorAll("span")].find(
                el=>el.textContent.replace(/\s+/g," ").trim().toLowerCase()==="split prescription"
            );

            const button=span?.closest("button");

            if(!button)return null;

            const rect=button.getBoundingClientRect();

            return rect.width&&rect.height&&!button.disabled?button:null;
        });

        button.scrollIntoView({behavior:"auto",block:"center",inline:"center"});
        button.focus();

        HTMLButtonElement.prototype.click.call(button);
        await sleep(1000);

        if(isSplitPageOpened())return;

        const rect=button.getBoundingClientRect();

        const options={
            bubbles:true,
            cancelable:true,
            composed:true,
            view:window,
            button:0,
            buttons:1,
            clientX:rect.left+rect.width/2,
            clientY:rect.top+rect.height/2
        };

        for(const type of["pointerdown","mousedown","pointerup","mouseup","click"]){
            const event=type.startsWith("pointer")
            ?new PointerEvent(type,options)
            :new MouseEvent(type,options);

            button.dispatchEvent(event);
            await sleep(80);
        }

        await sleep(1200);

        if(isSplitPageOpened())return;

        button.click();
        await sleep(1500);

        if(!isSplitPageOpened()){
            throw new Error("Split Prescription button was found but clicking it did not open Split screen");
        }
    }

    async function selectSplitDrugs(){
        const table=await waitForElement(()=>
                                         [...document.querySelectorAll("table")].find(
            table=>table.querySelector('input[type="checkbox"]')
        )
                                        );

        const rows=[...table.querySelectorAll("tbody tr")];
        let selected=0;

        for(const drug of splitDrugs){
            const target=normalizeDrugName(drug);
            let matched=false;

            for(const row of rows){
                const cell=row.cells[1];

                if(!cell)continue;

                const rowName=cell.innerText||"";
                const normalized=normalizeDrugName(rowName);

                if(!normalized.includes(target)&&!target.includes(normalized))continue;

                const checkbox=row.querySelector('input[type="checkbox"]');

                if(!checkbox)continue;

                if(!checkbox.checked){
                    clickLikeUser(checkbox);
                    await sleep(100);
                }

                selected++;
                matched=true;
                break;
            }

            if(!matched)throw new Error(`Drug not found: ${drug}`);
        }

        if(selected!==splitDrugs.length){
            throw new Error("Not all split drugs were found");
        }

        await sleep(300);
    }

    async function fillSplitData(){
        const{month,year}=parseCycle(cycle);

        let display;

        if(company==="metlife"){
            const expiry=new Date(year,month+1,0);
            display=`${expiry.getDate()} ${expiry.toLocaleString("en-US",{month:"short"})} ${String(expiry.getFullYear()).slice(-2)}`;
        }else{
            const expiry=new Date(year,month,22);
            display=`22 ${expiry.toLocaleString("en-US",{month:"short"})} ${String(expiry.getFullYear()).slice(-2)}`;
        }

        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")].find(
            l=>l.textContent.trim().toLowerCase()==="expiry date"
        )
                                        );

        let input=label.parentElement?.querySelector('input[type="text"]');

        if(!input){
            input=label.closest("div")?.querySelector('input[type="text"]');
        }

        if(!input){
            input=[...document.querySelectorAll('input[type="text"]')].find(
                el=>/expiry\s*date/i.test(el.parentElement?.parentElement?.parentElement?.innerText||"")
            );
        }

        if(!input)throw new Error("Expiry Date input not found");

        const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set;

        if(!setter)throw new Error("Native input value setter not found");

        const update=value=>{
            setter.call(input,value);
            input.dispatchEvent(new Event("input",{bubbles:true}));
            input.dispatchEvent(new Event("change",{bubbles:true}));
        };

        input.focus();
        update("");
        await sleep(100);
        update(display);

        input.dispatchEvent(new KeyboardEvent("keydown",{
            bubbles:true,
            key:"Enter",
            code:"Enter",
            keyCode:13,
            which:13
        }));

        input.blur();
        await sleep(500);

        if(input.value.trim().toLowerCase()!==display.toLowerCase()){
            input.focus();
            update(display);
            input.blur();
            await sleep(400);
        }

        if(input.value.trim().toLowerCase()!==display.toLowerCase()){
            throw new Error(`Expiry Date could not be changed.\n\nExpected: ${display}\nCurrent: ${input.value}`);
        }
    }

    async function fillSerial(){
        const input=await waitForElement(()=>{
            const labels=[...document.querySelectorAll("label")].filter(
                l=>l.textContent.trim()==="Serial"
            );

            return labels[1]?.parentElement?.querySelector("input");
        });

        setReactValue(input,generateSerial());
    }

    async function fillMaxAmount(){
        const input=await waitForElement(()=>{
            const labels=[...document.querySelectorAll("label")].filter(
                l=>l.textContent.trim()==="Max Amount"
            );

            return labels[1]?.parentElement?.querySelector("input");
        });

        setReactValue(input,"00");
    }

    async function enableDirectSync(){
        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")].find(
            l=>l.textContent.trim()==="Directly Sync Prescription After Splitting"
        )
                                        );

        const checkbox=label.parentElement?.parentElement?.querySelector('input[type="checkbox"]');

        if(!checkbox)throw new Error("Direct Sync checkbox not found");

        if(!checkbox.checked)clickLikeUser(checkbox);

        await sleep(300);
    }

    async function selectDropdown(labelText,itemText,errorText){
        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")].find(
            l=>l.textContent.trim()===labelText
        )
                                        );

        const button=label.nextElementSibling?.querySelector("button");

        if(!button)throw new Error(`${errorText} dropdown not found`);

        clickLikeUser(button);

        const item=await waitForElement(()=>
                                        [...document.querySelectorAll('span[role="menuitem"]')].find(
            el=>el.textContent.trim().toLowerCase()===itemText.toLowerCase()
        )
                                       );

        clickLikeUser(item);
        await sleep(300);
    }

    async function addSplitTag(){
        const input=await waitForElement(()=>
                                         [...document.querySelectorAll("input")].find(
            el=>el.id?.includes("Tags")
        )
                                        );

        const key=Object.keys(input).find(
            k=>k.startsWith("__reactInternalInstance")
        );

        const props=input[key]?._currentElement?.props;

        if(!props)throw new Error("Tags React props not found");

        props.onChange({target:{value:"SPLIT"}});

        props.onKeyUp({
            key:"Enter",
            keyCode:13,
            which:13,
            target:{value:"SPLIT"},
            preventDefault(){},
            stopPropagation(){}
        });

        await sleep(300);
    }

    async function main(){
        await login();
        await openSearchMember();
        await fillCardNumber();
        await clickProceed();
        await selectCorrectPrescription();
        await clickSplitPrescription();
        await selectSplitDrugs();
        await fillSplitData();
        await fillSerial();
        await fillMaxAmount();
        await enableDirectSync();

        if(company==="metlife"){
            await selectDropdown("Odoo Payer","MetLife","Odoo Payer");
            await selectDropdown("Odoo Corporate","The United Bank","Odoo Corporate");
        }else{
            await selectDropdown("Odoo Payer","Next Care","Odoo Payer");
            await selectDropdown("Odoo Corporate","Alex Bank","Odoo Corporate");
        }

        await selectDropdown("Odoo Cycle",cycle,"Odoo Cycle");
        await addSplitTag();
    }

    main().catch(error=>alert(`Split Automation Failed\n\n${error.message}`));

})();
