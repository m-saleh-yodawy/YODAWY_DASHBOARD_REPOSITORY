// ==UserScript==
// @name         PORTAL >>> AUTO SPLIT
// @namespace    http://tampermonkey.net/
// @version      1
// @author       Mohamed Saleh
// @match        https://portal.yodawy.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(async function(){
    "use strict";

    const accounts={
        nextcare:{
            username:"",
            password:""
        },
        metlife:{
            username:"",
            password:""
        }
    };

    const params=new URLSearchParams(location.search);

    if(params.get("tm")!=="split")return;

    const company=(params.get("company")||"").trim().toLowerCase();
    const card=(params.get("card")||"").trim();
    const prescriptionKey=(params.get("fn")||"").trim();

    const cycle=(params.get("cycle")||"")
    .replace(/\+/g," ")
    .replace(/\s+/g," ")
    .trim();

    const payor=(params.get("payor")||"").trim();
    const employer=(params.get("employer")||"").trim();

    const expectedSplitCount=
          Number.parseInt(
              params.get("splitCount")||"0",
              10
          );

    let splitDrugs=[];

    try{
        const raw=params.get("split")||"";
        splitDrugs=raw?JSON.parse(raw):[];
    }catch{
        return alert("Invalid Split Data");
    }

    if(!Array.isArray(splitDrugs)||!splitDrugs.length){
        return alert("No Split Drugs Found");
    }

    if(
        !Number.isInteger(expectedSplitCount)||
        expectedSplitCount<=0
    ){
        return alert(
            "Invalid Split Count\n\n"+
            "Odoo did not send a valid number of selected drugs."
        );
    }

    if(expectedSplitCount!==splitDrugs.length){
        return alert(
            "Split Count Mismatch\n\n"+
            `Odoo Selected: ${expectedSplitCount}\n`+
            `Split Data: ${splitDrugs.length}`
        );
    }

    const account=accounts[company];

    if(!account)return alert(`Unsupported Company:\n${company}`);
    if(!card)return alert("Card Number Missing");
    if(!prescriptionKey)return alert("Prescription Number / FN Missing");
    if(!cycle)return alert("Cycle Missing\n\nPlease make sure Odoo sends the Cycle.");

    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

    const visible=selector=>
    [...document.querySelectorAll(selector)]
    .filter(el=>el.offsetParent!==null);

    const prescriptionResponses=[];

    function extractPrescriptionDetails(payload){
        const data=payload?.data?.GetPrescriptionDetails;

        if(
            !data||
            !Array.isArray(data.Medications)
        ){
            return null;
        }

        return data;
    }

    function registerPrescriptionDetails(details){
        if(!details)return;

        const existing=prescriptionResponses.find(
            item=>item.id===details.id
        );

        if(existing){
            existing.details=details;
        }else{
            prescriptionResponses.push({
                id:details.id,
                details
            });
        }
    }

    function inspectGraphQLPayload(payload){
        const details=extractPrescriptionDetails(payload);

        if(details){
            registerPrescriptionDetails(details);
        }
    }

    function installFetchInterceptor(){
        if(window.__tmAutoSplitFetchInstalled)return;

        window.__tmAutoSplitFetchInstalled=true;

        const originalFetch=window.fetch;

        window.fetch=async function(...args){
            const response=await originalFetch.apply(
                this,
                args
            );

            try{
                const request=args[0];

                const url=
                      typeof request==="string"
                ?request
                :request?.url||"";

                if(
                    url.includes(
                        "chronicapi.yodawy.com/graphql"
                    )
                ){
                    const clone=response.clone();

                    clone.json()
                        .then(inspectGraphQLPayload)
                        .catch(()=>{});
                }
            }catch{}

            return response;
        };
    }

    function installXHRInterceptor(){
        if(window.__tmAutoSplitXHRInstalled)return;

        window.__tmAutoSplitXHRInstalled=true;

        const originalOpen=
              XMLHttpRequest.prototype.open;

        const originalSend=
              XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open=function(
        method,
         url,
         ...rest
        ){
            this.__tmGraphQLUrl=
                String(url||"");

            return originalOpen.call(
                this,
                method,
                url,
                ...rest
            );
        };

        XMLHttpRequest.prototype.send=function(body){
            if(
                this.__tmGraphQLUrl?.includes(
                    "chronicapi.yodawy.com/graphql"
                )
            ){
                this.addEventListener(
                    "load",
                    ()=>{
                        try{
                            const payload=
                                  JSON.parse(
                                      this.responseText
                                  );

                            inspectGraphQLPayload(
                                payload
                            );
                        }catch{}
                    }
                );
            }

            return originalSend.call(
                this,
                body
            );
        };
    }

    installFetchInterceptor();
    installXHRInterceptor();

    async function waitForElement(
    find,
     timeout=30000,
     interval=200
    ){
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

    async function waitForCondition(
    condition,
     timeout=30000,
     interval=200
    ){
        const start=Date.now();

        while(Date.now()-start<timeout){
            try{
                const result=condition();

                if(result)return result;
            }catch{}

            await sleep(interval);
        }

        return null;
    }

    function clickLikeUser(el){
        if(!el){
            throw new Error(
                "Cannot click empty element"
            );
        }

        el.dispatchEvent(
            new MouseEvent("mousedown",{
                bubbles:true,
                cancelable:true,
                view:window
            })
        );

        el.dispatchEvent(
            new MouseEvent("mouseup",{
                bubbles:true,
                cancelable:true,
                view:window
            })
        );

        el.dispatchEvent(
            new MouseEvent("click",{
                bubbles:true,
                cancelable:true,
                view:window
            })
        );
    }

    function setReactValue(input,value){
        if(!input){
            throw new Error(
                "Input not found"
            );
        }

        input.setAttribute(
            "autocomplete",
            "off"
        );

        const setter=
              Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value"
              ).set;

        setter.call(input,value);

        input.dispatchEvent(
            new Event("input",{
                bubbles:true
            })
        );

        input.dispatchEvent(
            new Event("change",{
                bubbles:true
            })
        );
    }

    async function login(){
        if(
            document.body.innerText.includes(
                "Search Member"
            )
        ){
            return;
        }

        const inputs=await waitForElement(()=>{
            const list=visible("input");

            return list.length>=2
                ?list
            :null;
        });

        setReactValue(
            inputs[0],
            account.username
        );

        setReactValue(
            inputs[1],
            account.password
        );

        const button=await waitForElement(()=>
                                          [...document.querySelectorAll("button")]
                                          .find(
            b=>
            b.innerText
            .trim()
            .toLowerCase()==="login"
        )
                                         );

        await sleep(300);

        clickLikeUser(button);

        await sleep(3000);
    }

    async function openSearchMember(){
        const span=await waitForElement(()=>
                                        [...document.querySelectorAll("span")]
                                        .find(
            el=>
            el.textContent
            .trim()==="Search Member"
        )
                                       );

        const button=span.closest("button");

        if(!button){
            throw new Error(
                "Search Member button not found"
            );
        }

        clickLikeUser(button);

        await sleep(700);
    }

    async function fillCardNumber(){
        const input=await waitForElement(()=>{
            const inputs=
                  visible("input[type='text']");

            return inputs.length>=7
                ?inputs[6]
            :null;
        });

        setReactValue(
            input,
            card
        );

        await sleep(300);
    }

    async function clickProceed(){
        const span=await waitForElement(()=>
                                        [...document.querySelectorAll("span")]
                                        .find(
            el=>
            el.textContent
            .trim()==="Proceed"
        )
                                       );

        const button=span.closest("button");

        if(!button){
            throw new Error(
                "Proceed button not found"
            );
        }

        clickLikeUser(button);

        await sleep(2500);
    }

    async function getPrescriptionTable(){
        return waitForElement(()=>
                              [...document.querySelectorAll("table")]
                              .find(
            table=>
            table.innerText.includes("Date")&&
            table.innerText.includes("Expire")&&
            table.innerText.includes("Status")&&
            table.querySelector(
                "tbody tr"
            )
        )
                             );
    }

    async function getCurrentPortalFormNumber(){
        return waitForElement(()=>{
            const label=[
                ...document.querySelectorAll("label")
            ].find(
                el=>
                el.textContent.trim()==="Form Number"
            );

            if(!label?.parentElement)return null;

            const value=[
                ...label.parentElement.querySelectorAll(
                    "label"
                )
            ].find(
                el=>
                el!==label&&
                el.textContent.trim()
            );

            return value?.textContent.trim()||null;
        },15000);
    }

    function findCachedPrescriptionByNumber(){
        const target=String(
            prescriptionKey
        )
        .trim()
        .toLowerCase();

        for(const item of prescriptionResponses){
            const details=item.details;

            const candidates=[
                details?.PrescriptionNumber,
                details?.PrescriptionSerial,
                details?.FHIRReference
            ]
            .filter(Boolean)
            .map(
                value=>
                String(value)
                .trim()
                .toLowerCase()
            );

            if(candidates.includes(target)){
                return details;
            }
        }

        return null;
    }

    async function selectCorrectPrescription(){
        const target=prescriptionKey
        .trim()
        .toLowerCase();

        const table=
              await getPrescriptionTable();

        const rows=[
            ...table.querySelectorAll(
                "tbody > tr"
            )
        ];

        if(!rows.length){
            throw new Error(
                "No prescriptions found"
            );
        }

        for(const row of rows){
            const beforeIds=
                  new Set(
                      prescriptionResponses.map(
                          item=>item.id
                      )
                  );

            row.click();

            await sleep(500);

            let current="";

            try{
                current=(
                    await getCurrentPortalFormNumber()
                ).toLowerCase();
            }catch{}

            const response=
                  await waitForCondition(()=>{
                      const cached=
                            findCachedPrescriptionByNumber();

                      if(cached)return cached;

                      const newResponse=
                            prescriptionResponses.find(
                                item=>
                                !beforeIds.has(item.id)
                            );

                      return newResponse?.details||null;
                  },5000,100);

            if(response){
                const responseNumber=
                      String(
                          response.PrescriptionNumber||""
                      )
                .trim()
                .toLowerCase();

                if(
                    responseNumber===target||
                    current===target
                ){
                    return response;
                }
            }

            if(current===target){
                const cached=
                      findCachedPrescriptionByNumber();

                if(cached){
                    return cached;
                }
            }
        }

        throw new Error(
            `Correct prescription was not found.\n\nTarget Form Number: ${prescriptionKey}`
        );
    }

    function isSplitPageOpened(){
        const text=
              document.body.innerText||"";

        return(
            text.includes("Expiry Date")||
            text.includes("Max Amount")||
            text.includes(
                "Directly Sync Prescription After Splitting"
            )||
            [...document.querySelectorAll("label")]
            .some(
                l=>
                l.textContent
                .trim()
                .toLowerCase()==="expiry date"
            )||
            (
                document.querySelectorAll(
                    'input[type="checkbox"]'
                ).length&&
                text.toLowerCase().includes(
                    "split"
                )
            )
        );
    }

    async function clickSplitPrescription(){
        const button=await waitForElement(()=>{
            const span=[
                ...document.querySelectorAll("span")
            ].find(
                el=>
                el.textContent
                .replace(/\s+/g," ")
                .trim()
                .toLowerCase()==="split prescription"
            );

            const button=
                  span?.closest("button");

            if(!button)return null;

            const rect=
                  button.getBoundingClientRect();

            return rect.width&&
                rect.height&&
                !button.disabled
                ?button
            :null;
        });

        button.scrollIntoView({
            behavior:"auto",
            block:"center",
            inline:"center"
        });

        button.focus();

        HTMLButtonElement.prototype.click.call(
            button
        );

        await sleep(1000);

        if(isSplitPageOpened())return;

        const rect=
              button.getBoundingClientRect();

        const options={
            bubbles:true,
            cancelable:true,
            composed:true,
            view:window,
            button:0,
            buttons:1,
            clientX:
            rect.left+
            rect.width/2,
            clientY:
            rect.top+
            rect.height/2
        };

        for(
            const type of[
                "pointerdown",
                "mousedown",
                "pointerup",
                "mouseup",
                "click"
            ]
        ){
            const event=
                  type.startsWith("pointer")
            ?new PointerEvent(
                type,
                options
            )
            :new MouseEvent(
                type,
                options
            );

            button.dispatchEvent(event);

            await sleep(80);
        }

        await sleep(1200);

        if(isSplitPageOpened())return;

        button.click();

        await sleep(1500);

        if(!isSplitPageOpened()){
            throw new Error(
                "Split Prescription button was found but clicking it did not open Split screen"
            );
        }
    }

    function getSplitTable(){
        const tables=[
            ...document.querySelectorAll("table")
        ];

        const candidates=tables.filter(
            table=>
            table.querySelector(
                'tbody tr input[type="checkbox"]'
            )
        );

        if(!candidates.length){
            return null;
        }

        candidates.sort(
            (a,b)=>
            b.querySelectorAll(
                "tbody tr"
            ).length-
            a.querySelectorAll(
                "tbody tr"
            ).length
        );

        return candidates[0];
    }

    function getSplitRows(){
        const table=getSplitTable();

        if(!table)return[];

        return[
            ...table.querySelectorAll(
                "tbody > tr"
            )
        ].filter(
            row=>
            row.querySelector(
                'input[type="checkbox"]'
            )
        );
    }

    function getSelectedSplitRows(rows){
        return rows.filter(
            row=>
            row.querySelector(
                'input[type="checkbox"]'
            )?.checked
        );
    }

    function findMedicationByHZB(
    hzb,
     medications
    ){
        const target=
              String(hzb||"").trim();

        if(!target){
            return{
                valid:false,
                matches:[]
            };
        }

        const matches=[];

        medications.forEach(
            (med,index)=>{
                const medicationHZB=
                      med?.Drug_Dosage_Form_Id;

                if(
                    medicationHZB!==undefined&&
                    medicationHZB!==null&&
                    String(medicationHZB).trim()===target
                ){
                    matches.push({
                        medication:med,
                        index
                    });
                }
            }
        );

        if(matches.length!==1){
            return{
                valid:false,
                matches
            };
        }

        return{
            valid:true,
            ...matches[0]
        };
    }

    async function validatePopupOrder(
    medications,
     rows
    ){
        if(!medications.length){
            throw new Error(
                "Prescription contains no medications"
            );
        }

        if(!rows.length){
            throw new Error(
                "Split Popup contains no medication rows"
            );
        }

        if(
            medications.length!==rows.length
        ){
            throw new Error(
                `Medication / Popup order mismatch.\n\n`+
                `Prescription medications: ${medications.length}\n`+
                `Split popup rows: ${rows.length}`
            );
        }

        return true;
    }

    function validateSelectedCount(rows){
        const selectedRows=
              getSelectedSplitRows(rows);

        const actualCount=
              selectedRows.length;

        if(actualCount!==expectedSplitCount){
            throw new Error(
                `Split Selection Count Mismatch.\n\n`+
                `Odoo Selected: ${expectedSplitCount}\n`+
                `Portal Selected: ${actualCount}\n\n`+
                `The Split process was stopped to prevent an incorrect split.`
            );
        }

        if(actualCount!==splitDrugs.length){
            throw new Error(
                `Split Data / Portal Selection Mismatch.\n\n`+
                `Split Data: ${splitDrugs.length}\n`+
                `Portal Selected: ${actualCount}\n\n`+
                `The Split process was stopped.`
            );
        }

        return actualCount;
    }

    async function selectSplitDrugs(
    prescriptionDetails
    ){
        const medications=
              prescriptionDetails?.Medications;

        if(!Array.isArray(medications)){
            throw new Error(
                "GetPrescriptionDetails did not contain Medications"
            );
        }

        const rows=await waitForElement(()=>{
            const result=getSplitRows();

            return result.length
                ?result
            :null;
        },15000,100);

        await validatePopupOrder(
            medications,
            rows
        );

        const selectedIndexes=
              new Set();

        for(const drug of splitDrugs){
            if(
                drug?.hzb===undefined||
                drug?.hzb===null||
                !String(drug.hzb).trim()
            ){
                throw new Error(
                    `Missing HZB for Odoo drug:\n${drug?.name||"Unknown"}`
                );
            }

            const result=
                  findMedicationByHZB(
                      drug.hzb,
                      medications
                  );

            if(!result?.valid){
                const count=
                      result?.matches?.length||0;

                throw new Error(
                    `HZB not uniquely found in Portal.\n\n`+
                    `Odoo Drug: ${drug.name||"Unknown"}\n`+
                    `HZB: ${drug.hzb}\n`+
                    `Matches: ${count}`
                );
            }

            const medicationIndex=
                  result.index;

            if(
                selectedIndexes.has(
                    medicationIndex
                )
            ){
                throw new Error(
                    `Duplicate Portal medication index detected.\n\n`+
                    `HZB: ${drug.hzb}\n`+
                    `Index: ${medicationIndex+1}`
                );
            }

            const row=
                  rows[medicationIndex];

            if(!row){
                throw new Error(
                    `Popup row not found for medication index ${medicationIndex+1}`
                );
            }

            const checkbox=
                  row.querySelector(
                      'input[type="checkbox"]'
                  );

            if(!checkbox){
                throw new Error(
                    `Checkbox not found for medication index ${medicationIndex+1}`
                );
            }

            if(!checkbox.checked){
                clickLikeUser(checkbox);

                await sleep(100);
            }

            selectedIndexes.add(
                medicationIndex
            );
        }

        if(
            selectedIndexes.size!==expectedSplitCount
        ){
            throw new Error(
                `Odoo / Portal Selection Count Mismatch.\n\n`+
                `Odoo Selected: ${expectedSplitCount}\n`+
                `Portal Intended Selection: ${selectedIndexes.size}`
            );
            }

        await sleep(300);

        validateSelectedCount(rows);
    }

    function parseCycle(value){
        const match=String(value||"")
        .trim()
        .match(
            /^([A-Za-z]+)\s+(\d{4})$/
        );

        if(!match){
            throw new Error(
                `Invalid Cycle Format: ${value}`
            );
        }

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

        const month=
              monthMap[
                  match[1].toLowerCase()
              ];

        if(month===undefined){
            throw new Error(
                `Invalid Cycle Month: ${match[1]}`
            );
        }

        return{
            month,
            year:Number(match[2])
        };
    }

    async function fillSplitData(){
        const{month,year}=
              parseCycle(cycle);

        let display;

        if(company==="metlife"){
            const expiry=
                  new Date(
                      year,
                      month+1,
                      0
                  );

            display=
                `${expiry.getDate()} `+
                `${expiry.toLocaleString(
                "en-US",
                {month:"short"}
            )} `+
                `${String(
                expiry.getFullYear()
            ).slice(-2)}`;
        }else{
            const expiry=
                  new Date(
                      year,
                      month,
                      22
                  );

            display=
                `22 `+
                `${expiry.toLocaleString(
                "en-US",
                {month:"short"}
            )} `+
                `${String(
                expiry.getFullYear()
            ).slice(-2)}`;
        }

        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")]
                                         .find(
            l=>
            l.textContent
            .trim()
            .toLowerCase()==="expiry date"
        )
                                        );

        let input=
            label.parentElement
        ?.querySelector(
            'input[type="text"]'
        );

        if(!input){
            input=
                label.closest("div")
                ?.querySelector(
                'input[type="text"]'
            );
        }

        if(!input){
            input=[
                ...document.querySelectorAll(
                    'input[type="text"]'
                )
            ].find(
                el=>
                /expiry\sdate/i.test(
                    el.parentElement
                    ?.parentElement
                    ?.parentElement
                    ?.innerText||""
                )
            );
        }

        if(!input){
            throw new Error(
                "Expiry Date input not found"
            );
        }

        const setter=
              Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value"
              )?.set;

        if(!setter){
            throw new Error(
                "Native input value setter not found"
            );
        }

        const update=value=>{
            setter.call(input,value);

            input.dispatchEvent(
                new Event("input",{
                    bubbles:true
                })
            );

            input.dispatchEvent(
                new Event("change",{
                    bubbles:true
                })
            );
        };

        input.focus();

        update("");

        await sleep(100);

        update(display);

        input.dispatchEvent(
            new KeyboardEvent(
                "keydown",
                {
                    bubbles:true,
                    key:"Enter",
                    code:"Enter",
                    keyCode:13,
                    which:13
                }
            )
        );

        input.blur();

        await sleep(500);

        if(
            input.value
            .trim()
            .toLowerCase()!==display.toLowerCase()
        ){
            input.focus();

            update(display);

            input.blur();

            await sleep(400);
        }

        if(
            input.value
            .trim()
            .toLowerCase()!==display.toLowerCase()
        ){
            throw new Error(
                `Expiry Date could not be changed.\n\nExpected: ${display}\nCurrent: ${input.value}`
            );
        }
    }

    function generateSerial(){
        const letters=
              "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

        let serial="";

        for(let i=0;i<4;i++){
            serial+=letters[
                Math.floor(
                    Math.random()*
                    letters.length
                )
            ];
        }

        for(let i=0;i<4;i++){
            serial+=Math.floor(
                Math.random()*10
            );
        }

        return serial;
    }

    async function fillSerial(){
        const input=await waitForElement(()=>{
            const labels=[
                ...document.querySelectorAll("label")
            ].filter(
                l=>
                l.textContent.trim()==="Serial"
            );

            return labels[1]
                ?.parentElement
                ?.querySelector("input");
        });

        setReactValue(
            input,
            generateSerial()
        );
    }

    async function fillMaxAmount(){
        const input=await waitForElement(()=>{
            const labels=[
                ...document.querySelectorAll("label")
            ].filter(
                l=>
                l.textContent.trim()==="Max Amount"
            );

            return labels[1]
                ?.parentElement
                ?.querySelector("input");
        });

        setReactValue(
            input,
            "00"
        );
    }

    async function enableDirectSync(){
        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")]
                                         .find(
            l=>
            l.textContent
            .trim()==="Directly Sync Prescription After Splitting"
        )
                                        );

        const checkbox=
              label.parentElement
        ?.parentElement
        ?.querySelector(
            'input[type="checkbox"]'
        );

        if(!checkbox){
            throw new Error(
                "Direct Sync checkbox not found"
            );
        }

        if(!checkbox.checked){
            clickLikeUser(checkbox);
        }

        await sleep(300);
    }

    async function selectDropdown(
    labelText,
     itemText,
     errorText
    ){
        const label=await waitForElement(()=>
                                         [...document.querySelectorAll("label")]
                                         .find(
            l=>
            l.textContent.trim()===
            labelText
        )
                                        );

        const button=
              label.nextElementSibling
        ?.querySelector("button");

        if(!button){
            throw new Error(
                `${errorText} dropdown not found`
            );
        }

        clickLikeUser(button);

        const item=await waitForElement(()=>
                                        [...document.querySelectorAll(
                                            'span[role="menuitem"]'
                                        )].find(
            el=>
            el.textContent
            .trim()
            .toLowerCase()===
            itemText.toLowerCase()
        )
                                       );

        clickLikeUser(item);

        await sleep(300);
    }

    async function addSplitTag(){
        const input=await waitForElement(()=>
                                         [...document.querySelectorAll("input")]
                                         .find(
            el=>
            el.id?.includes("Tags")
        )
                                        );

        const key=Object.keys(input).find(
            k=>
            k.startsWith(
                "__reactInternalInstance"
            )
        );

        const props=
              input[key]
        ?._currentElement
        ?.props;

        if(!props){
            throw new Error(
                "Tags React props not found"
            );
        }

        props.onChange({
            target:{
                value:"SPLIT"
            }
        });

        props.onKeyUp({
            key:"Enter",
            keyCode:13,
            which:13,
            target:{
                value:"SPLIT"
            },
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

        const prescriptionDetails=
              await selectCorrectPrescription();

        if(
            !prescriptionDetails||
            !Array.isArray(
                prescriptionDetails.Medications
            )
        ){
            throw new Error(
                "Correct prescription was found but GetPrescriptionDetails data is missing"
            );
        }

        await clickSplitPrescription();

        await selectSplitDrugs(
            prescriptionDetails
        );

        await fillSplitData();

        await fillSerial();

        await fillMaxAmount();

        await enableDirectSync();

        if(company==="metlife"){
            await selectDropdown(
                "Odoo Payer",
                "MetLife",
                "Odoo Payer"
            );

            await selectDropdown(
                "Odoo Corporate",
                "The United Bank",
                "Odoo Corporate"
            );
        }else{
            await selectDropdown(
                "Odoo Payer",
                "Next Care",
                "Odoo Payer"
            );

            await selectDropdown(
                "Odoo Corporate",
                "Alex Bank",
                "Odoo Corporate"
            );
        }

        await selectDropdown(
            "Odoo Cycle",
            cycle,
            "Odoo Cycle"
        );

        await addSplitTag();
    }

    main().catch(
        error=>
        alert(
            `Split Automation Failed\n\n${error.message}`
            )
    );

})();
