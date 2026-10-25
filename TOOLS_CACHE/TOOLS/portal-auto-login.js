// ==UserScript==
// @name         PORTAL AUTO LOGIN
// @namespace    https://odoo.yodawy.com/
// @version      1
// @description  Unified Odoo to Portal login using YODAWY LOADER
// @author       Mohamed Saleh
// @match        https://odoo.yodawy.com/*
// @match        https://portal.yodawy.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    if (window.__YODAWY_AUTO_LOGIN_STARTED__) return;
    window.__YODAWY_AUTO_LOGIN_STARTED__ = true;

    const ACCOUNTS_GLOBAL = '__YODAWY_PORTAL_ACCOUNTS__';

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const normalize = value => String(value ?? '')
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const visible = selector => [
        ...document.querySelectorAll(selector)
    ].filter(element =>
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden'
    );

    function setInput(input, value) {
        input.setAttribute('autocomplete', 'off');

        const descriptor = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
        );

        descriptor.set.call(input, String(value ?? ''));

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function waitFor(find, timeout = 30000, interval = 300) {
        return new Promise((resolve, reject) => {
            const started = Date.now();

            const check = () => {
                let result;

                try {
                    result = find();
                } catch (_) {}

                if (result) {
                    resolve(result);
                    return;
                }

                if (Date.now() - started >= timeout) {
                    reject(new Error('Required page element was not found.'));
                    return;
                }

                setTimeout(check, interval);
            };

            check();
        });
    }

    function readAccountsFromLoader() {
        const parsed = window[ACCOUNTS_GLOBAL];

        if (!parsed || typeof parsed !== 'object') {
            throw new Error(
                'Account configuration was not provided by YODAWY LOADER.'
            );
        }

        const accounts =
            parsed.accounts ||
            parsed.users ||
            parsed.portal_users ||
            parsed;

        if (
            !accounts ||
            typeof accounts !== 'object' ||
            Array.isArray(accounts)
        ) {
            throw new Error('Invalid account configuration.');
        }

        return accounts;
    }

    function buildAccountIndex(accounts) {
        const index = new Map();

        for (const [company, account] of Object.entries(accounts)) {
            if (
                !account ||
                typeof account !== 'object' ||
                !String(account.username ?? '').trim() ||
                !String(account.password ?? '').trim()
            ) {
                continue;
            }

            index.set(normalize(company), {
                username: String(account.username),
                password: String(account.password)
            });
        }

        return index;
    }

    function resolveAccount(company, accountIndex) {
        return accountIndex.get(normalize(company)) || null;
    }

    function setupOdoo() {
        const card = document.querySelector('span[name="user_ref"]');
        const payer = document.querySelector('span[name="payor_id"] span');
        const prescription = document.querySelector(
            'span[name="prescription_number"]'
        );

        if (!card || !payer || !prescription || card.dataset.erxEnabled) {
            return;
        }

        card.dataset.erxEnabled = 'true';
        card.title = 'Open ERX';
        card.style.cursor = 'pointer';

        card.addEventListener('click', () => {
            const company = payer.textContent.trim();
            const cardNumber = card.textContent.trim();
            const formNumber = prescription.textContent.trim();

            if (!company || !cardNumber || !formNumber) {
                alert(
                    'Unable to read the company, card number, or Form Number.'
                );
                return;
            }

            const params = new URLSearchParams({
                tm: '1',
                mode: 'openPortal',
                company,
                card: cardNumber,
                fn: formNumber
            });

            window.open(
                `https://portal.yodawy.com/?${params.toString()}`,
                '_blank'
            );
        });
    }

    async function portalLogin() {
        const params = new URLSearchParams(location.search);

        if (
            params.get('tm') !== '1' ||
            params.get('mode') !== 'openPortal' ||
            params.has('split')
        ) {
            return;
        }

        const company = params.get('company') || '';
        const cardNumber = (params.get('card') || '').trim();
        const formNumber = (params.get('fn') || '').trim();

        let accountIndex;

        try {
            const accounts = readAccountsFromLoader();
            accountIndex = buildAccountIndex(accounts);
        } catch (_) {
            alert(
                'YODAWY LOADER did not provide the private account configuration. ' +
                'Check the Loader settings token and account-file access.'
            );
            return;
        }

        const account = resolveAccount(company, accountIndex);

        if (!account) {
            alert(
                `No Portal account matched this company:\n${company}\n\n` +
                'Check that the exact Odoo company name exists in ' +
                'CONFIG/yodaw_portal_users.json and that its username and password are filled in.'
            );
            return;
        }

        try {
            if (document.body.innerText.includes('Search Member')) {
                await continuePrescriptionSelection(
                    cardNumber,
                    formNumber
                );
                return;
            }

            const passwordInput = await waitFor(
                () => visible('input[type="password"]')[0]
            );

            const usernameInput = await waitFor(() =>
                visible('input').find(input =>
                    input !== passwordInput &&
                    ![
                        'hidden',
                        'submit',
                        'button',
                        'checkbox',
                        'password'
                    ].includes((input.type || '').toLowerCase())
                )
            );

            setInput(usernameInput, account.username);
            setInput(passwordInput, account.password);

            const loginButton = await waitFor(() =>
                [...document.querySelectorAll('button')].find(button =>
                    button.getClientRects().length > 0 &&
                    button.textContent.trim() === 'Login'
                )
            );

            loginButton.click();

            await sleep(2000);

            await continuePrescriptionSelection(
                cardNumber,
                formNumber
            );
        } catch (_) {
            alert(
                'Portal automation could not complete. ' +
                'Check the login page and prescription fields.'
            );
        }
    }

    async function continuePrescriptionSelection(
        cardNumber,
        formNumber
    ) {
        if (!cardNumber || !formNumber) {
            throw new Error('Missing card number or Form Number.');
        }

        const searchButton = await waitFor(() =>
            [...document.querySelectorAll('span')]
                .find(span =>
                    span.textContent.trim() === 'Search Member'
                )?.closest('button')
        );

        searchButton.click();
        await sleep(1000);

        const cardInput = await waitFor(() => {
            const inputs = visible('input[type="text"]');
            return inputs.length >= 7 ? inputs[6] : null;
        });

        setInput(cardInput, cardNumber);
        await sleep(500);

        const proceedButton = await waitFor(() =>
            [...document.querySelectorAll('span')]
                .find(span =>
                    span.textContent.trim() === 'Proceed'
                )?.closest('button')
        );

        proceedButton.click();
        await sleep(1500);

        await selectPrescriptionByFormNumber(formNumber);
    }

    async function selectPrescriptionByFormNumber(formNumber) {
        const target = normalize(formNumber);

        const table = await waitFor(() =>
            [...document.querySelectorAll('table')].find(table =>
                table.innerText.includes('Date') &&
                table.innerText.includes('Expire') &&
                table.innerText.includes('Status') &&
                table.querySelector('tbody tr')
            )
        );

        const rows = [...table.querySelectorAll('tbody > tr')];

        for (const row of rows) {
            row.click();

            const displayedFormNumber = await waitFor(() => {
                const label = [...document.querySelectorAll('label')]
                    .find(element =>
                        element.textContent.trim() === 'Form Number'
                    );

                if (!label) return null;

                const value = [
                    ...label.parentElement.querySelectorAll('label')
                ].find(element =>
                    element !== label &&
                    element.textContent.trim()
                );

                return value?.textContent.trim() || null;
            });

            if (normalize(displayedFormNumber) === target) {
                return;
            }

            await sleep(300);
        }

        alert(
            `No prescription matched Form Number:\n${formNumber}`
        );
    }

    if (location.hostname === 'odoo.yodawy.com') {
        const observer = new MutationObserver(setupOdoo);

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setupOdoo();
    }

    if (location.hostname === 'portal.yodawy.com') {
        portalLogin();
    }
})();
