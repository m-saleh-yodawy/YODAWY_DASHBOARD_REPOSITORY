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
            setTimeout(clickSubmit, 100);
            return;
        }

        submit.click();
    }

    function clickYes() {
        const yesButton = document.querySelector('#jqi_state0_buttonYes');

        if (!yesButton) {
            setTimeout(clickYes, 100);
            return;
        }

        yesButton.click();
        setTimeout(clickSubmit, 500);
    }

    function chooseMember() {
        if (memberIndex === null) return;

        const items = document.querySelectorAll(
            '#AlicoAdherents_body li[onclick*="flagAdherent"]'
        );

        if (!items.length) {
            setTimeout(chooseMember, 100);
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
            setTimeout(chooseMember, 100);
            return;
        }

        memberIndex = null;

        try {
            eval(onclick);
        } catch {
            member.click();
        }

        setTimeout(clickYes, 500);
        processing = false;
    }

    function triggerEligibility(certificate) {
        setTimeout(() => {
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

            setTimeout(chooseMember, 300);
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

        policy.addEventListener('paste', () => {
            setTimeout(() => processCard(policy.value), 50);
        });

        certificate.addEventListener('paste', () => {
            setTimeout(() => processCard(certificate.value), 50);
        });

        policy.addEventListener('input', () => {
            processCard(policy.value);
        });

        certificate.addEventListener('input', () => {
            processCard(certificate.value);
        });
    }

    setup();

    new MutationObserver(() => {
        setup();

        if (memberIndex !== null) {
            chooseMember();
        }
    }).observe(document.documentElement, {
        childList: true,
        subtree: true
    });
})();
