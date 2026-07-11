// Content script: scans pages for the user's address, reports to the worker,
// and shows the on-page toast/banner. Runs in the top frame only and reaches
// into same-origin iframes itself.
(() => {
  if (window.top !== window) return;

  const BANNER_HOST_ID = '__address_tracker_banner__';
  const TOAST_HOST_ID = '__address_tracker_toast__';
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
  const FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
  const FOOTER_HEADER = 'footer, header, [role="contentinfo"], [role="banner"]';

  let settings = AT.storage.defaultSettings();
  let profiles = [];            // address profiles we're hunting right now
  let ignoreRules = [];         // normalized-URL prefixes we never scan
  let move = null;              // { fromId, toId, newAddressText } while moving
  let bannerDismissed = false;  // reset on navigation
  let toastDismissed = false;   // reset on navigation
  let lastUrl = location.href;

  async function loadConfig() {
    if (!contextAlive()) return;
    const state = await AT.storage.load();
    settings = state.settings;
    ignoreRules = state.ignoreRules || [];
    const active = AT.storage.activeMove(state);
    if (active) {
      const to = AT.storage.addressById(state, active.toAddressId);
      move = { fromId: active.fromAddressId, toId: active.toAddressId, newAddressText: to ? AT.address.format(to) : '' };
      profiles = state.addresses
        .filter((a) => a.id === active.fromAddressId || a.id === active.toAddressId)
        .map(AT.address.buildProfile);
    } else {
      move = null;
      const current = AT.storage.currentAddress(state);
      profiles = current ? [AT.address.buildProfile(current)] : [];
    }
  }

  function isHidden(el) {
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  }

  // Collects visible text and form values, recursing through open shadow roots
  // and same-origin iframes.
  function walk(node, acc) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue.trim();
      if (text) acc.text.push(text);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node;
    if (SKIP_TAGS.has(el.tagName)) return;
    if (el.id === BANNER_HOST_ID || el.id === TOAST_HOST_ID) return;
    if (settings.skipFooterHeader && el.matches(FOOTER_HEADER)) return;
    if (isHidden(el)) return;

    if (el.tagName === 'IFRAME') {
      walkIframe(el, acc);
      return;
    }

    if (settings.scanFormValues && FIELD_TAGS.has(el.tagName)) {
      collectFieldValue(el, acc);
    }

    if (el.shadowRoot) {
      for (const child of el.shadowRoot.childNodes) walk(child, acc);
    }
    for (const child of el.childNodes) walk(child, acc);
  }

  function walkIframe(iframe, acc) {
    try {
      const doc = iframe.contentDocument;
      if (doc && doc.body) walk(doc.body, acc);
    } catch { /* cross-origin — unreachable */ }
  }

  function collectFieldValue(el, acc) {
    if (el.type === 'password' || el.type === 'hidden') return;
    const value = (el.value || '').trim();
    if (value) acc.fields.push(value);
    if (el.tagName === 'SELECT' && el.selectedOptions[0]) {
      acc.fields.push(el.selectedOptions[0].textContent.trim());
    }
  }

  function scan() {
    if (!contextAlive() || !profiles.length || !document.body) return;

    // Checked per scan: SPA navigation changes the URL without reloading us.
    const key = AT.storage.normalizeUrl(location.href);
    if (ignoreRules.some((r) => AT.storage.ruleMatches(r, key))) {
      removeBanner();
      return;
    }

    const acc = { text: [], fields: [] };
    if (settings.scanVisibleText) walk(document.body, acc);
    else if (settings.scanFormValues) collectFieldsOnly(document.body, acc);

    const ctx = {
      text: AT.detect.normalize(acc.text.join(' ')),
      fields: acc.fields.map(AT.detect.normalize).filter(Boolean),
    };
    const matchedIds = AT.detect.scan(profiles, ctx);

    send('scan', { title: document.title, matchedIds }).then((res) => {
      if (res && res.prompt) showDetectToast(matchedIds);
    });

    updateBanner(matchedIds);
  }

  function collectFieldsOnly(root, acc) {
    for (const el of root.querySelectorAll('input, textarea, select')) {
      collectFieldValue(el, acc);
    }
  }

  // Move banner: shown while the old address is on the page.
  function updateBanner(matchedIds) {
    const shouldShow = move && settings.showBanner && !bannerDismissed &&
      matchedIds.includes(move.fromId);
    if (shouldShow) showBanner();
    else removeBanner();
  }

  function showBanner() {
    if (document.getElementById(BANNER_HOST_ID)) return;

    const host = document.createElement('div');
    host.id = BANNER_HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .bar { position: fixed; top: 12px; right: 12px; z-index: 2147483647;
               max-width: 360px; font: 13px/1.4 system-ui, sans-serif;
               background: #1D1B20; color: #E6E1E5; border-radius: 3px;
               box-shadow: 0 6px 24px rgba(0,0,0,.5); padding: 12px 14px;
               border: 1px solid #49454F; }
        .title { font-weight: 600; margin-bottom: 4px; }
        .addr { color: #D0BCFF; margin-bottom: 10px; word-break: break-word; }
        .row { display: flex; gap: 6px; flex-wrap: wrap; }
        button { font: inherit; border: 0; border-radius: 3px; padding: 5px 10px;
                 cursor: pointer; background: #2B2930; color: #E6E1E5; }
        button.primary { background: #D0BCFF; color: #381E72; }
        button:hover { filter: brightness(1.08); }
      </style>
      <div class="bar">
        <div class="title">Address Tracker · old address found here</div>
        <div class="addr">${escapeHtml(move.newAddressText)}</div>
        <div class="row">
          <button class="primary" data-act="copy">Copy new address</button>
          <button data-act="done">Mark as Done</button>
          <button data-act="ignore">Not mine</button>
          <button data-act="dismiss">✕</button>
        </div>
      </div>`;

    root.querySelector('[data-act="copy"]').addEventListener('click', () => {
      navigator.clipboard.writeText(move.newAddressText).catch(() => {});
    });
    root.querySelector('[data-act="done"]').addEventListener('click', () => {
      send('override', { status: 'done' });
      removeBanner();
    });
    root.querySelector('[data-act="ignore"]').addEventListener('click', () => {
      send('ignore');
      bannerDismissed = true;
      removeBanner();
    });
    root.querySelector('[data-act="dismiss"]').addEventListener('click', () => {
      bannerDismissed = true; // this session only; page stays in the list
      removeBanner();
    });

    (document.body || document.documentElement).appendChild(host);
  }

  function removeBanner() {
    document.getElementById(BANNER_HOST_ID)?.remove();
  }

  // Detection toast: a new site awaits confirmation — save it, or exclude the
  // page / domain / an edited prefix.
  function showDetectToast(matchedIds) {
    if (toastDismissed || document.getElementById(TOAST_HOST_ID)) return;
    if (!document.body) return;

    const key = AT.storage.normalizeUrl(location.href);
    const domain = AT.storage.domainOf(key);

    const host = document.createElement('div');
    host.id = TOAST_HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        .bar { position: fixed; top: 12px; right: 12px; z-index: 2147483647;
               max-width: 380px; font: 13px/1.4 system-ui, sans-serif;
               background: #1D1B20; color: #E6E1E5; border-radius: 3px;
               box-shadow: 0 6px 24px rgba(0,0,0,.5); padding: 12px 14px;
               border: 1px solid #49454F; }
        .title { font-weight: 600; margin-bottom: 4px; }
        .msg { color: #CAC4D0; margin-bottom: 10px; }
        .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .row + .row { margin-top: 8px; }
        .lbl { color: #938F99; font-size: 12px; }
        button { font: inherit; border: 0; border-radius: 3px; padding: 5px 10px;
                 cursor: pointer; background: #2B2930; color: #E6E1E5; }
        button.primary { background: #D0BCFF; color: #381E72; }
        button.ghost { background: transparent; border: 1px solid #49454F; color: #CAC4D0;
                       font-size: 12px; max-width: 160px;
                       overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        button:hover { filter: brightness(1.15); }
        input { flex: 1; min-width: 0; font: inherit; font-size: 12px; padding: 5px 8px;
                background: #2B2930; color: #E6E1E5; border: 1px solid #49454F;
                border-radius: 3px; outline: none; }
        input:focus { border-color: #D0BCFF; }
      </style>
      <div class="bar">
        <div class="title">Address Tracker · address detected</div>
        <div class="msg">Save this site to your update list?</div>
        <div class="row">
          <button class="primary" data-act="save">Save site</button>
          <button data-act="dismiss">Not now</button>
        </div>
        <div class="row">
          <span class="lbl">Ignore:</span>
          <button class="ghost" data-act="ig-page">This page</button>
          <button class="ghost" data-act="ig-domain" title="${escapeHtml(domain)}">${escapeHtml(domain)}</button>
          <button class="ghost" data-act="ig-prefix">Prefix…</button>
        </div>
        <div class="row" data-prefix-row hidden>
          <input type="text" value="${escapeHtml(key)}" spellcheck="false">
          <button data-act="ig-prefix-ok">Ignore</button>
        </div>
      </div>`;

    root.querySelector('[data-act="save"]').addEventListener('click', () => {
      send('save-page', { title: document.title, matchedIds });
      removeToast();
    });
    root.querySelector('[data-act="dismiss"]').addEventListener('click', () => {
      toastDismissed = true; // this session only; asks again next visit
      removeToast();
    });
    root.querySelector('[data-act="ig-page"]').addEventListener('click', () => {
      send('ignore', { title: document.title });
      toastDismissed = true;
      removeToast();
    });
    root.querySelector('[data-act="ig-domain"]').addEventListener('click', () => {
      send('ignore-rule', { rule: domain });
      removeToast();
    });
    root.querySelector('[data-act="ig-prefix"]').addEventListener('click', () => {
      const row = root.querySelector('[data-prefix-row]');
      row.hidden = false;
      row.querySelector('input').focus();
    });
    root.querySelector('[data-act="ig-prefix-ok"]').addEventListener('click', () => {
      const rule = root.querySelector('[data-prefix-row] input').value.trim();
      if (!rule) return;
      send('ignore-rule', { rule });
      removeToast();
    });

    document.body.appendChild(host);
  }

  function removeToast() {
    document.getElementById(TOAST_HOST_ID)?.remove();
  }

  function contextAlive() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  // Resolves to the worker's reply (or undefined if the context is gone).
  function send(type, extra = {}) {
    if (!contextAlive()) return Promise.resolve();
    try {
      return chrome.runtime.sendMessage({ type, url: location.href, ...extra }).catch(() => {});
    } catch {
      return Promise.resolve(); // context died between check and call
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
  }

  const debounce = (fn, ms) => {
    let t;
    return () => { clearTimeout(t); t = setTimeout(fn, ms); };
  };
  const scanSoon = debounce(scan, 800);

  function onNavigation() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    bannerDismissed = false; // new page, banner + toast may apply again
    toastDismissed = false;
    removeToast();
    scanSoon();
  }

  function watchMutations() {
    if (!settings.rescanOnDomMutation) return;
    new MutationObserver(scanSoon).observe(document.body, { childList: true, subtree: true });
  }

  async function init() {
    await loadConfig();
    window.addEventListener('at:navigation', onNavigation);
    watchMutations();

    // Never react to `pages` changes — our own scans write them, so that would loop.
    chrome.storage.onChanged.addListener(async (changes, area) => {
      try {
        if (area !== 'local') return;
        if (!changes.addresses && !changes.moves && !changes.settings && !changes.ignoreRules) return;
        await loadConfig();
        scan();
      } catch { /* extension reloaded — context no longer valid */ }
    });

    scan();
  }

  init();
})();
