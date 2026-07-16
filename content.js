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
  let addressLabels = {};       // address id -> formatted string, for the toast
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
    addressLabels = Object.fromEntries(state.addresses.map((a) => [a.id, AT.address.format(a)]));
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
    if (!contextAlive()) return;

    const host = document.createElement('div');
    host.id = BANNER_HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${cardStyles()}</style>
      <div class="bar">
        ${cardHead()}
        <div class="msg">This page still shows your <b>old address</b>. Your new address:</div>
        <div class="addr">${escapeHtml(move.newAddressText)}</div>
        <div class="row">
          <button class="primary" data-act="copy">Copy new address</button>
          <button data-act="done">Mark as Done</button>
          <button data-act="ignore">Not mine</button>
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

  // Shared look for the toast and the banner.
  function cardStyles() {
    return `
      .bar { position: fixed; top: 16px; right: 16px; z-index: 2147483647;
             width: 340px; max-width: calc(100vw - 32px);
             font: 13px/1.45 system-ui, -apple-system, sans-serif;
             background: #1D1B20; color: #E6E1E5; border-radius: 3px;
             box-shadow: 0 12px 40px rgba(0,0,0,.55), 0 2px 8px rgba(0,0,0,.35);
             border: 1px solid #49454F; border-top: 2px solid #D0BCFF;
             padding: 12px 14px 14px; animation: at-in .25s ease; }
      @keyframes at-in { from { opacity: 0; transform: translateY(-10px); }
                         to   { opacity: 1; transform: none; } }
      @keyframes at-out { to { opacity: 0; transform: translateY(-10px); } }
      .bar.out { animation: at-out .15s ease forwards; }
      .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .head img { width: 20px; height: 20px; flex: none; }
      .name { font-weight: 600; font-size: 13px; flex: 1; letter-spacing: .01em; }
      .x { flex: none; background: transparent; border: 0; color: #938F99;
           font: 14px/1 system-ui, sans-serif; cursor: pointer; padding: 2px 6px;
           border-radius: 3px; }
      .x:hover { color: #E6E1E5; background: #2B2930; }
      .msg { color: #CAC4D0; margin-bottom: 12px; }
      .msg b { color: #E6E1E5; font-weight: 600; }
      .addr { color: #D0BCFF; margin-bottom: 12px; word-break: break-word; }
      .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
      .divider { height: 1px; background: #36343B; margin: 12px -14px; }
      .lbl { color: #938F99; font-size: 12px; }
      .ok { color: #A5D6A7; margin-bottom: 0; }
      button.link { background: transparent; color: #938F99; font-size: 12px;
                    padding: 5px 6px; margin-left: auto; }
      button.link:hover { color: #E6E1E5; }
      button { font: inherit; border: 0; border-radius: 3px; padding: 5px 10px;
               cursor: pointer; background: #2B2930; color: #E6E1E5; }
      button.primary { background: #D0BCFF; color: #381E72; font-weight: 600; }
      button.ghost { background: transparent; border: 1px solid #49454F; color: #CAC4D0;
                     font-size: 12px; max-width: 150px;
                     overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      button:hover { filter: brightness(1.15); }
      input { flex: 1; min-width: 0; font: inherit; font-size: 12px; padding: 5px 8px;
              background: #2B2930; color: #E6E1E5; border: 1px solid #49454F;
              border-radius: 3px; outline: none; }
      input:focus { border-color: #D0BCFF; }`;
  }

  function cardHead() {
    return `
      <div class="head">
        <img src="${chrome.runtime.getURL('icons/48.png')}" alt="">
        <span class="name">Address Tracker</span>
        <button class="x" data-act="dismiss" title="Dismiss">✕</button>
      </div>`;
  }

  // Detection toast: a new site awaits confirmation — save it, or exclude the
  // page / domain / an edited prefix.
  function showDetectToast(matchedIds) {
    if (toastDismissed || document.getElementById(TOAST_HOST_ID)) return;
    if (!document.body || !contextAlive()) return;

    const key = AT.storage.normalizeUrl(location.href);
    const domain = AT.storage.domainOf(key);
    const label = addressLabels[matchedIds[0]] || '';
    // During a move only the new address can reach here — the old one is auto-recorded.
    const kind = move && matchedIds.includes(move.toId) ? 'new address' : 'address';

    const host = document.createElement('div');
    host.id = TOAST_HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>${cardStyles()}</style>
      <div class="bar">
        ${cardHead()}
        <div class="msg">Found your ${kind} on <b>${escapeHtml(domain)}</b>${label ? ':' : '.'}</div>
        ${label ? `<div class="addr">${escapeHtml(label)}</div>` : ''}
        <div class="row">
          <button class="primary" data-act="save">Save site</button>
          <button class="ghost" data-act="dismiss">Not now</button>
          <button class="link" data-act="more">Ignore instead…</button>
        </div>
        <div data-ignore-row hidden>
          <div class="divider"></div>
          <div class="row">
            <span class="lbl">Ignore:</span>
            <button class="ghost" data-act="ig-page">This page</button>
            <button class="ghost" data-act="ig-domain" title="${escapeHtml(domain)}">${escapeHtml(domain)}</button>
            <button class="ghost" data-act="ig-prefix">Prefix…</button>
          </div>
          <div class="row" data-prefix-row hidden style="margin-top:8px">
            <input type="text" value="${escapeHtml(key)}" spellcheck="false">
            <button data-act="ig-prefix-ok">Ignore</button>
          </div>
        </div>
      </div>`;

    root.querySelector('[data-act="save"]').addEventListener('click', () => {
      send('save-page', { title: document.title, matchedIds });
      toastConfirm(root, 'Saved to your list');
    });
    root.querySelectorAll('[data-act="dismiss"]').forEach((b) => b.addEventListener('click', () => {
      toastDismissed = true; // this session only; asks again next visit
      hideToast();
    }));
    root.querySelector('[data-act="more"]').addEventListener('click', (e) => {
      e.target.hidden = true;
      root.querySelector('[data-ignore-row]').hidden = false;
    });
    root.querySelector('[data-act="ig-page"]').addEventListener('click', () => {
      send('ignore', { title: document.title });
      toastDismissed = true;
      toastConfirm(root, 'This page will be ignored');
    });
    root.querySelector('[data-act="ig-domain"]').addEventListener('click', () => {
      send('ignore-rule', { rule: domain });
      toastConfirm(root, `${domain} will be ignored`);
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
      toastConfirm(root, 'Prefix rule added');
    });

    document.addEventListener('keydown', onToastEscape);
    document.body.appendChild(host);
  }

  // Swap the toast body for a short "done" note, then fade out.
  function toastConfirm(root, text) {
    const bar = root.querySelector('.bar');
    if (!bar) return;
    bar.innerHTML = `
      <div class="head">
        <img src="${chrome.runtime.getURL('icons/48.png')}" alt="">
        <span class="name">Address Tracker</span>
      </div>
      <div class="msg ok">✓ ${escapeHtml(text)}</div>`;
    setTimeout(hideToast, 1400);
  }

  function onToastEscape(e) {
    if (e.key !== 'Escape') return;
    toastDismissed = true;
    hideToast();
  }

  // Animated close for user-driven dismissals.
  function hideToast() {
    const host = document.getElementById(TOAST_HOST_ID);
    document.removeEventListener('keydown', onToastEscape);
    if (!host) return;
    const bar = host.shadowRoot && host.shadowRoot.querySelector('.bar');
    if (!bar) { host.remove(); return; }
    bar.classList.add('out');
    setTimeout(() => host.remove(), 160);
  }

  // Instant close for navigation.
  function removeToast() {
    document.removeEventListener('keydown', onToastEscape);
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
