// ==UserScript==
// @name         Metlife Card Number
// @namespace    https://i-care.globemedegypt.com/
// @version      1
// @author       Mohamed Saleh
// @match        https://i-care.globemedegypt.com:8034/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const TOOL_ID='TOOL-007';
    const registry=window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    if(registry[TOOL_ID])return;
    let destroyed=false;
    let suspended=false;
    let workflowActive=false;
    let observer=null;
    let controller=new AbortController();
    const timers=new Set();
    const boundFields=new Map();
    const schedule=(callback,delay)=>{
        if(destroyed||suspended)return 0;
        const timer=window.setTimeout(()=>{timers.delete(timer);if(!destroyed&&!suspended)callback();},delay);
        timers.add(timer);
        return timer;
    };

    let memberIndex = null;
    let processing = false;

    function getFields() {
        return {
            policy: document.querySelector('#txtPolicy'),
            certificate: document.querySelector('#txtReference')
        };
    }

    function clickSubmit() {
        if(destroyed)return;
        const submit = [...document.querySelectorAll('a[onclick]')].find(a =>
            (a.getAttribute('onclick') || '').includes("ColdFusion.navigate('../chronic/med_check0.cfm'")
        );

        if (!submit) {
            schedule(clickSubmit, 100);
            return;
        }

        submit.click();
        workflowActive=false;
    }

    function clickYes() {
        if(destroyed)return;
        const yesButton = document.querySelector('#jqi_state0_buttonYes');

        if (!yesButton) {
            schedule(clickYes, 100);
            return;
        }

        yesButton.click();
        schedule(clickSubmit, 500);
    }

    function chooseMember() {
        if(destroyed)return;
        if (memberIndex === null) return;

        const items = document.querySelectorAll(
            '#AlicoAdherents_body li[onclick*="flagAdherent"]'
        );

        if (!items.length) {
            schedule(chooseMember, 100);
            return;
        }

        const member = items[memberIndex - 1];

        if (!member) {
            memberIndex = null;
            processing = false;
            workflowActive = false;
            return;
        }

        const onclick = member.getAttribute('onclick');

        if (!onclick) {
            schedule(chooseMember, 100);
            return;
        }

        memberIndex = null;

        try {
            eval(onclick);
        } catch {
            member.click();
        }

        schedule(clickYes, 500);
        processing = false;
    }

    function triggerEligibility(certificate) {
        schedule(() => {
            if (typeof certificate.onkeypress === 'function') {
                certificate.onkeypress.call(certificate, {
                    keyCode: 13,
                    which: 13,
                    target: certificate,
                    preventDefault() {},
                    stopPropagation() {}
                });
            } else if (typeof window.check_eligibility === 'function') {
                window.check_eligibility(
                    'P255580',
                    'icare2',
                    'P255580'
                );
            }

            schedule(chooseMember, 300);
        }, 100);
    }

    function processCard(value) {
        if(destroyed)return;
        if (processing) return;

        const parts = value.trim().split('-').map(x => x.trim());

        if (
            parts.length !== 4 ||
            parts.some(x => !/^\d+$/.test(x)) ||
            !parts[3] ||
            parseInt(parts[3], 10) < 1
        ) return;

        const { policy, certificate } = getFields();

        if (!policy || !certificate) return;

        processing = true;

        processing = true;
        workflowActive = true;
        memberIndex = parseInt(parts[3], 10);

        policy.value = parts[0] + parts[1];
        certificate.value = parts[2];

        policy.dispatchEvent(new Event('input', { bubbles: true }));
        policy.dispatchEvent(new Event('change', { bubbles: true }));
        certificate.dispatchEvent(new Event('input', { bubbles: true }));
        certificate.dispatchEvent(new Event('change', { bubbles: true }));

        triggerEligibility(certificate);
    }

    function setup() {
        if(destroyed)return;
        const { policy, certificate } = getFields();

        if (!policy || !certificate) return;
        if (policy.dataset.metlifeReady === '1') return;

        boundFields.set(policy, policy.getAttribute('data-metlife-ready'));
        boundFields.set(certificate, certificate.getAttribute('data-metlife-ready'));
        policy.dataset.metlifeReady = '1';
        certificate.dataset.metlifeReady = '1';

        policy.addEventListener('paste', () => {
            schedule(() => processCard(policy.value), 50);
        },{signal:controller.signal});

        certificate.addEventListener('paste', () => {
            schedule(() => processCard(certificate.value), 50);
        },{signal:controller.signal});

        policy.addEventListener('input', () => {
            processCard(policy.value);
        },{signal:controller.signal});

        certificate.addEventListener('input', () => {
            processCard(certificate.value);
        },{signal:controller.signal});
    }

    setup();

    const observe=()=>{
        if(destroyed||suspended||!document.documentElement)return;
        if(!observer)observer=new MutationObserver(()=>{
            if(destroyed||suspended)return;
            setup();
            if(memberIndex!==null)chooseMember();
        });
        observer.observe(document.documentElement,{childList:true,subtree:true});
    };

    const restoreFields=()=>{
        for(const [field,value] of boundFields){
            if(value===null)field.removeAttribute('data-metlife-ready');
            else field.setAttribute('data-metlife-ready',value);
        }
        boundFields.clear();
    };

    observe();

    const instance={
        id:TOOL_ID,
        path:'TOOLS/metlife-card-number.js',
        suspend(){
            if(destroyed)return true;
            if(workflowActive||processing||memberIndex!==null)return false;
            suspended=true;
            observer?.disconnect();
            controller.abort();
            for(const timer of timers)clearTimeout(timer);
            timers.clear();
            restoreFields();
            return true;
        },
        resume(){
            if(destroyed)return false;
            if(!suspended)return true;
            suspended=false;
            controller=new AbortController();
            setup();
            observe();
            return true;
        },
        destroy(){
            if(destroyed)return true;
            if(workflowActive||processing||memberIndex!==null)return false;
            destroyed=true;
            suspended=true;
            observer?.disconnect();
            observer=null;
            controller.abort();
            for(const timer of timers)clearTimeout(timer);
            timers.clear();
            restoreFields();
            if(registry[TOOL_ID]===instance)delete registry[TOOL_ID];
            return true;
        }
    };
    registry[TOOL_ID]=instance;
})();
