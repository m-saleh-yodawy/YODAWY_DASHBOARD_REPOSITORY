// ==UserScript==
// @name         Metlife Card Number
// @namespace    https://i-care.globemedegypt.com/
// @author       Mohamed Saleh
// @match        https://i-care.globemedegypt.com:8034/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    let memberIndex = null;
    let processing = false;
    let destroyed = false;
    const timers = new Set();
    const controller = new AbortController();
    let observer = null;
    const schedule = (callback, delay) => {
        const timer = setTimeout(() => {
            timers.delete(timer);
            if (!destroyed) callback();
        }, delay);
        timers.add(timer);
        return timer;
    };

    function getFields() {
        return {
            policy: document.querySelector('#txtPolicy'),
            certificate: document.querySelector('#txtReference')
        };
    }

    function clickSubmit() {
        const submit = [...document.querySelectorAll('a[onclick]')].find(a =>
            (a.getAttribute('onclick') || '').includes("ColdFusion.navigate('../chronic/med_check0.cfm'")
        );

        if (!submit) {
            schedule(clickSubmit, 100);
            return;
        }

        submit.click();
    }

    function clickYes() {
        const yesButton = document.querySelector('#jqi_state0_buttonYes');

        if (!yesButton) {
            schedule(clickYes, 100);
            return;
        }

        yesButton.click();
        schedule(clickSubmit, 500);
    }

    function chooseMember() {
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
        const { policy, certificate } = getFields();

        if (!policy || !certificate) return;
        if (policy.dataset.metlifeReady === '1') return;

        policy.dataset.metlifeReady = '1';
        certificate.dataset.metlifeReady = '1';

        policy.addEventListener('paste', () => schedule(() => processCard(policy.value), 50), { signal: controller.signal });
        certificate.addEventListener('paste', () => schedule(() => processCard(certificate.value), 50), { signal: controller.signal });
        policy.addEventListener('input', () => processCard(policy.value), { signal: controller.signal });
        certificate.addEventListener('input', () => processCard(certificate.value), { signal: controller.signal });
    }

    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);
    const instance = {
        destroy() {
            if (destroyed) return true;
            destroyed = true;
            memberIndex = null;
            processing = false;
            timers.forEach(clearTimeout);
            timers.clear();
            observer?.disconnect();
            controller.abort();
            document.querySelectorAll('#txtPolicy,#txtReference').forEach(field => delete field.dataset.metlifeReady);
            if (registry['TOOL-007'] === instance) delete registry['TOOL-007'];
            return true;
        }
    };
    registry['TOOL-007'] = instance;
    setup();
    observer = new MutationObserver(() => {
        if (destroyed) return;
        setup();
        if (memberIndex !== null) chooseMember();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
})();
