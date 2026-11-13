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

    const TOOL_ID = 'TOOL-002';
    const TOOL_PATH = 'TOOLS/portal-auto-login.js';
    const registry = window.YODAWY_TOOL_INSTANCES ||= Object.create(null);

    if (registry[TOOL_ID]) return;

    const state = {
        destroyed: false,
        observer: null,
        handlers: new Map(),
        timers: new Set(),
        controller: new AbortController()
    };

    const ensureActive = () => {
        if (state.destroyed) throw new Error('Tool stopped');
    };

    const ACCOUNTS_GLOBAL = '__YODAWY_PORTAL_ACCOUNTS__';

    const sleep = ms => new Promise((resolve, reject) => {
        if (state.destroyed) return reject(new Error('Tool stopped'));
        const timer = setTimeout(() => {
            state.timers.delete(timer);
            state.controller.signal.removeEventListener('abort', abort);
            resolve();
        }, ms);
        const abort = () => {
            clearTimeout(timer);
            state.timers.delete(timer);
            reject(new Error('Tool stopped'));
        };
        state.timers.add(timer);
        state.controller.signal.addEventListener('abort', abort, { once: true });
    });

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

    async function waitFor(find, timeout = 30000, interval = 300) {
        const started = Date.now();

        while (Date.now() - started < timeout) {
            ensureActive();

            try {
                const result = find();
                if (result) return result;
            } catch (_) {}

            await sleep(interval);
        }

        throw new Error('Required page element was not found.');
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
        if (state.destroyed) return;

        const card = document.querySelector('span[name="user_ref"]');
        const payer = document.querySelector('span[name="payor_id"] span');
        const prescription = document.querySelector(
            'span[name="prescription_number"]'
        );

        if (!card || !payer || !prescription || state.handlers.has(card)) return;

        const previous = {
            title: card.getAttribute('title'),
            cursor: card.style.cursor
        };

        const handler = () => {
            const company = payer.textContent.trim();
            const cardNumber = card.textContent.trim();
            const formNumber = prescription.textContent.trim();

            if (!company || !cardNumber || !formNumber) {
                alert('Unable to read the company, card number, or Form Number.');
                return;
            }

            const params = new URLSearchParams({
                tm: '1',
                mode: 'openPortal',
                company,
                card: cardNumber,
                fn: formNumber
            });

            window.open(`https://portal.yodawy.com/?${params.toString()}`, '_blank');
        };

        card.dataset.erxEnabled = 'true';
        card.title = 'Open ERX';
        card.style.cursor = 'pointer';
        card.addEventListener('click', handler);
        state.handlers.set(card, { handler, previous });
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
            ensureActive();
            alert(
                'YODAWY LOADER did not provide the private Portal accounts. ' +
                'Check the PORTAL_ACCOUNTS object inside the Loader script.'
            );
            return;
        }

        const account = resolveAccount(company, accountIndex);

        if (!account) {
            alert(
                `No Portal account matched this company:\n${company}\n\n` +
                'Check that the company exists in the PORTAL_ACCOUNTS object inside ' +
                'the Loader script and that its username and password are filled in.'
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
            if (!state.destroyed) {
                alert(
                    'Portal automation could not complete. ' +
                    'Check the login page and prescription fields.'
                );
            }
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
        state.observer = new MutationObserver(setupOdoo);
        state.observer.observe(document.body, {
            childList: true,
            subtree: true
        });
        setupOdoo();
    }

    if (location.hostname === 'portal.yodawy.com') {
        portalLogin();
    }

    const instance = Object.freeze({
        id: TOOL_ID,
        path: TOOL_PATH,
        destroy: async () => {
            if (state.destroyed) return true;
            state.destroyed = true;
            state.controller.abort();
            state.observer?.disconnect();

            for (const [element, item] of state.handlers) {
                element.removeEventListener('click', item.handler);
                delete element.dataset.erxEnabled;
                if (item.previous.title === null) element.removeAttribute('title');
                else element.setAttribute('title', item.previous.title);
                element.style.cursor = item.previous.cursor;
            }

            state.handlers.clear();
            for (const timer of state.timers) clearTimeout(timer);
            state.timers.clear();
            if (registry[TOOL_ID] === instance) delete registry[TOOL_ID];
            return true;
        }
    });

    registry[TOOL_ID] = instance;
})();
