// Management UI. Every mutation reloads + re-renders; event handling is
// delegated so re-rendering #view never leaves stale listeners behind.
(() => {
  const { storage, address, constants } = AT;
  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $('#view');

  let state = storage.defaultState();
  let tab = 'dashboard';
  let sitesQuery = '';
  let excludeSel = new Set(); // selected rows in the Excludes table ('rule:…' | 'page:…')

  const TRASH = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0zM14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>`;

  // ---- helpers -------------------------------------------------------------

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const STATUS_LABEL = { needs_update: 'Needs Update', done: 'Done', up_to_date: 'Up to Date' };

  function statusBadge(s) {
    return `<span class="badge ${s}">${STATUS_LABEL[s]}</span>`;
  }

  const pageName = (p) => p.kind === 'manual' ? (p.label || 'Task') : (p.title || p.url || '(untitled)');
  const isWeb = (p) => p.kind === 'web';

  async function refresh() {
    state = await storage.load();
    render();
  }

  async function commit(fn) {
    await storage.update(fn);
    await refresh();
  }

  // ---- toast ---------------------------------------------------------------

  function showToast(page, addrs) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<div class="toast-title">Detected on ${esc(page.domain || page.title || 'a site')}</div>
      <div class="toast-sub">${esc(addrs.map(a => address.format(a)).join(', '))}</div>`;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ---- modal (replaces confirm / prompt / alert) ---------------------------

  const modal = $('#modal');
  let modalResolve = null;

  function openModal({ title = '', message = '', fields = [], okLabel = 'OK', cancelLabel = 'Cancel', danger = false, hideCancel = false }) {
    const titleEl = $('#modal-title');
    const msgEl = $('#modal-msg');
    const fieldsEl = $('#modal-fields');
    const errEl = $('#modal-error');
    const okBtn = $('#modal-ok');
    const cancelBtn = $('#modal-cancel');

    titleEl.textContent = title;
    titleEl.hidden = !title;
    msgEl.textContent = message;
    msgEl.hidden = !message;
    errEl.hidden = true;
    okBtn.textContent = okLabel;
    okBtn.className = `primary${danger ? ' danger' : ''}`;
    cancelBtn.textContent = cancelLabel;
    cancelBtn.hidden = hideCancel;

    fieldsEl.innerHTML = '';
    for (const f of fields) {
      const label = document.createElement('label');
      label.textContent = f.label || '';
      const input = document.createElement('input');
      input.type = f.type || 'text';
      input.value = f.default || '';
      input.placeholder = f.placeholder || '';
      input.setAttribute('data-field', f.key);
      if (f.required) input.required = true;
      input.autocomplete = 'off';
      label.appendChild(input);
      fieldsEl.appendChild(label);
    }

    return new Promise((resolve) => {
      modalResolve = resolve;
      modal.showModal();
      fieldsEl.querySelector('input')?.focus();
    });
  }

  $('#modal-ok').addEventListener('click', () => {
    const form = modal.querySelector('form');
    if (!form.reportValidity()) return;
    const values = {};
    for (const input of modal.querySelectorAll('[data-field]')) {
      values[input.dataset.field] = input.value.trim();
    }
    const resolve = modalResolve; modalResolve = null;
    modal.close();
    if (resolve) resolve({ confirmed: true, values });
  });

  $('#modal-cancel').addEventListener('click', () => {
    const resolve = modalResolve; modalResolve = null;
    modal.close();
    if (resolve) resolve({ confirmed: false, values: {} });
  });

  modal.addEventListener('close', () => {
    if (modalResolve) { const r = modalResolve; modalResolve = null; r({ confirmed: false, values: {} }); }
  });

  // ---- address dialog (shared by Start Move / Edit) ------------------------

  const dlg = $('#addr-dialog');
  let dlgResolve = null;

  function stateOptions(selected) {
    return ['<option value="">State…</option>']
      .concat(Object.values(constants.AU_STATES).map((c) =>
        `<option value="${c}"${c === selected ? ' selected' : ''}>${c}</option>`))
      .join('');
  }

  function readDialog() {
    const f = (n) => dlg.querySelector(`[data-f="${n}"]`).value.trim();
    return { line2: f('line2'), street: f('street'), suburb: f('suburb'), state: f('state'), postcode: f('postcode') };
  }

  function validateAddress(a) {
    if (!a.street || !a.suburb || !a.state) return 'Please fill in street, suburb and state.';
    if (!/^\d{4}$/.test(a.postcode)) return 'Postcode must be 4 digits.';
    return null;
  }

  function openAddressDialog(title, prefill) {
    $('#addr-dialog-title').textContent = title;
    dlg.querySelector('[data-f="state"]').innerHTML = stateOptions(prefill?.state || '');
    dlg.querySelector('[data-f="street"]').value = prefill?.street || '';
    dlg.querySelector('[data-f="line2"]').value = prefill?.line2 || '';
    dlg.querySelector('[data-f="suburb"]').value = prefill?.suburb || '';
    dlg.querySelector('[data-f="postcode"]').value = prefill?.postcode || '';
    $('#addr-dialog-error').hidden = true;
    return new Promise((resolve) => { dlgResolve = resolve; dlg.showModal(); });
  }

  $('#addr-dialog-save').addEventListener('click', (e) => {
    e.preventDefault();
    const addr = readDialog();
    const msg = validateAddress(addr);
    if (msg) { const el = $('#addr-dialog-error'); el.textContent = msg; el.hidden = false; return; }
    const resolve = dlgResolve; dlgResolve = null;
    dlg.close();
    resolve(addr);
  });
  dlg.addEventListener('close', () => { if (dlgResolve) { dlgResolve(null); dlgResolve = null; } });

  // ---- ignore dialog (scope: page / domain / starts-with) -------------------

  const ignoreDlg = $('#ignore-dialog');
  let ignoreResolve = null;
  let ignoreKey = '';

  const ignoreScope = () => ignoreDlg.querySelector('.seg-btn.active').dataset.scope;

  function ignoreRuleFor(scope) {
    if (scope === 'domain') return storage.domainOf(ignoreKey);
    if (scope === 'prefix') return storage.normalizeRule($('#ignore-prefix').value);
    return ignoreKey;
  }

  const IGNORE_HINTS = {
    page: 'Only this exact page is ignored',
    domain: 'Everything on this domain is ignored',
    prefix: 'Every URL starting with this is ignored',
  };

  function refreshIgnoreDialog(animate) {
    const scope = ignoreScope();
    const rule = ignoreRuleFor(scope);
    $('#ignore-prefix').hidden = scope !== 'prefix';
    $('#ignore-hint').textContent = IGNORE_HINTS[scope];
    $('#ignore-preview-text').textContent =
      scope === 'prefix' ? (rule ? rule + '…' : '—') : rule;
    $('#ignore-error').hidden = true;

    const applyWrap = $('#ignore-apply-wrap');
    if (scope === 'page') {
      applyWrap.hidden = true;
    } else {
      const count = rule
        ? Object.entries(state.pages).filter(([k, p]) =>
            isWeb(p) && !p.ignored && storage.ruleMatches(rule, k)).length
        : 0;
      applyWrap.hidden = false;
      $('#ignore-apply-label').textContent = `Also hide ${count} matching saved site${count === 1 ? '' : 's'}`;
    }

    if (animate) {
      const pv = $('#ignore-preview');
      pv.classList.remove('pop');
      void pv.offsetWidth; // restart the animation
      pv.classList.add('pop');
    }
  }

  // Resolves to { scope, rule, apply } or null on cancel.
  function openIgnoreDialog(key) {
    ignoreKey = key;
    ignoreDlg.querySelectorAll('.seg-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.scope === 'page'));
    $('#ignore-prefix').value = key;
    $('#ignore-apply').checked = true;
    refreshIgnoreDialog(true);
    return new Promise((resolve) => { ignoreResolve = resolve; ignoreDlg.showModal(); });
  }

  ignoreDlg.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.classList.contains('active')) return;
    ignoreDlg.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === btn));
    refreshIgnoreDialog(true);
    if (btn.dataset.scope === 'prefix') $('#ignore-prefix').focus();
  });
  $('#ignore-prefix').addEventListener('input', () => refreshIgnoreDialog(false));

  $('#ignore-save').addEventListener('click', () => {
    const scope = ignoreScope();
    const rule = ignoreRuleFor(scope);
    if (scope !== 'page' && !rule) {
      const el = $('#ignore-error');
      el.textContent = 'Enter a domain or URL prefix.';
      el.hidden = false;
      return;
    }
    const resolve = ignoreResolve; ignoreResolve = null;
    ignoreDlg.close();
    resolve({ scope, rule, apply: $('#ignore-apply').checked });
  });
  $('#ignore-cancel').addEventListener('click', () => ignoreDlg.close());
  ignoreDlg.addEventListener('close', () => {
    if (ignoreResolve) { const r = ignoreResolve; ignoreResolve = null; r(null); }
  });

  // ---- render: dispatch ----------------------------------------------------

  function render() {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (!storage.currentAddress(state) && state.addresses.length === 0) {
      view.innerHTML = `<section class="card"><p>No address set up yet.</p>
        <button class="primary" data-action="onboarding">Run setup</button></section>`;
      return;
    }
    ({ dashboard: renderDashboard, sites: renderSites, addresses: renderAddresses, settings: renderSettings, help: renderHelp }[tab] || renderDashboard)();
  }

  // ---- render: dashboard (+ move view) -------------------------------------

  function renderDashboard() {
    const move = storage.activeMove(state);
    const current = storage.currentAddress(state);
    const tracked = Object.values(state.pages).filter((p) => !p.ignored).length;

    if (!move) {
      view.innerHTML = `
        <section class="card">
          <div class="block-title">Current address</div>
          <div class="addr-line">${esc(address.format(current))}</div>
        </section>
        <section class="card">
          <div class="stat-row"><strong>${tracked}</strong> site${tracked === 1 ? '' : 's'} tracked</div>
          <button class="primary" data-action="start-move">Start move</button>
        </section>
        ${recentlyDetected()}`;
      return;
    }

    const to = storage.addressById(state, move.toAddressId);
    const prog = storage.progress(state);
    const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
    const scoped = Object.values(state.pages).filter((p) => storage.inScope(p, move));
    const needs = scoped.filter((p) => storage.deriveStatus(p, move) === 'needs_update');
    const done = scoped.filter((p) => storage.deriveStatus(p, move) === 'done');

    view.innerHTML = `
      <section class="card">
        <div class="block-title">Move in progress</div>
        <div class="addr-line">→ ${esc(to ? address.format(to) : '')}</div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="bar-label">${prog.done} / ${prog.total} done</div>
        <div class="btn-row">
          <button class="primary" data-action="complete-move">Complete move</button>
          <button class="secondary" data-action="cancel-move">Cancel move</button>
        </div>
      </section>
      ${prog.total === 0
        ? `<section class="card empty">Nothing detected yet. Browse your accounts, or add sites and tasks from the Sites tab.</section>`
        : `<div class="columns">
            ${moveColumn('Needs Update', needs, move)}
            ${moveColumn('Done', done, move)}
           </div>`}`;
  }

  function moveColumn(title, pages, move) {
    const rows = pages.map((p) => {
      const key = pageKey(p);
      const flip = storage.deriveStatus(p, move) === 'done'
        ? `<button class="link" data-action="mark-needs" data-key="${esc(key)}">Reopen</button>`
        : `<button class="link" data-action="mark-done" data-key="${esc(key)}">Mark done</button>`;
      const go = isWeb(p) && p.rawUrl ? ` · <a href="${esc(p.rawUrl)}" target="_blank">Go</a>` : '';
      return `<li><div class="li-main">${esc(pageName(p))}</div>
              <div class="li-sub">${flip}${go}</div></li>`;
    }).join('') || `<li class="muted">None</li>`;
    return `<section class="card column"><div class="block-title">${title} (${pages.length})</div><ul>${rows}</ul></section>`;
  }

  function recentlyDetected() {
    const recent = Object.values(state.pages)
      .filter((p) => isWeb(p) && !p.ignored && p.firstDetected)
      .sort((a, b) => b.lastVisited - a.lastVisited)
      .slice(0, 8);
    if (!recent.length) return '';
    const rows = recent.map((p) => `<li><span>${esc(pageName(p))}</span><span class="muted">${esc(p.domain)}</span></li>`).join('');
    return `<section class="card"><div class="block-title">Recently detected</div><ul class="recent">${rows}</ul></section>`;
  }

  // ---- render: sites -------------------------------------------------------

  function pageKey(p) {
    return Object.keys(state.pages).find((k) => state.pages[k] === p);
  }

  function buildSiteRows() {
    const move = storage.activeMove(state);
    const web = Object.entries(state.pages).filter(([, p]) => !p.ignored && isWeb(p));

    const q = sitesQuery.trim().toLowerCase();
    const filtered = q
      ? web.filter(([, p]) =>
          (p.domain || '').toLowerCase().includes(q) ||
          (p.title || '').toLowerCase().includes(q) ||
          (p.rawUrl || '').toLowerCase().includes(q) ||
          p.everDetected.some((id) => {
            const a = storage.addressById(state, id);
            return a && address.format(a).toLowerCase().includes(q);
          })
        )
      : web;

    if (!filtered.length) {
      const msg = q
        ? 'No sites match your search.'
        : 'No sites tracked yet. Browse your accounts, or add one below.';
      return `<tr><td colspan="5" class="empty-row">${msg}</td></tr>`;
    }

    return filtered.map(([key, p]) => {
      const k = esc(key);
      const status = move ? storage.deriveStatus(p, move) : null;
      const statusCol = status ? statusBadge(status) : '<span class="muted">—</span>';
      const statusAct = status
        ? (status === 'done'
            ? `<button class="link" data-action="mark-needs" data-key="${k}">Reopen</button>`
            : `<button class="link" data-action="mark-done" data-key="${k}">Mark done</button>`)
        : '';
      const domainEl = p.rawUrl
        ? `<a class="domain-pill" href="${esc(p.rawUrl)}" target="_blank" title="${esc(p.rawUrl)}">${esc(p.domain)}</a>`
        : `<span class="domain-pill">${esc(p.domain)}</span>`;
      const addrs = p.everDetected
        .map(id => storage.addressById(state, id))
        .filter(Boolean)
        .map(a => `<span class="addr-text">${esc(address.format(a))}</span>`)
        .join('');
      const noteHtml = p.note ? `<span class="row-note">${esc(p.note)}</span>` : '';
      return `<tr>
        <td class="col-domain">${domainEl}</td>
        <td class="col-page">
          <span class="page-title">${esc(p.title || p.url || '(untitled)')}</span>
          ${noteHtml}
        </td>
        <td class="col-addr">${addrs || '<span class="muted">—</span>'}</td>
        <td class="col-status">${statusCol}</td>
        <td class="col-actions"><div class="actions-row">
          ${statusAct ? statusAct + '<span class="actions-sep"></span>' : ''}
          <button class="link" data-action="edit-note" data-key="${k}">Note</button>
          <span class="actions-sep"></span>
          <button class="link muted" data-action="ignore" data-key="${k}">Ignore</button>
          <span class="actions-sep"></span>
          <button class="link danger" data-action="remove" data-key="${k}">Delete</button>
        </div></td>
      </tr>`;
    }).join('');
  }

  function renderSites() {
    const move = storage.activeMove(state);
    const web = Object.entries(state.pages).filter(([, p]) => !p.ignored && isWeb(p));
    const tasks = Object.entries(state.pages).filter(([, p]) => !p.ignored && p.kind === 'manual');
    const totalCount = web.length;

    const taskRows = tasks.map(([key, p]) => {
      const k = esc(key);
      const status = move ? storage.deriveStatus(p, move) : null;
      const statusCol = status ? statusBadge(status) : '<span class="muted">—</span>';
      const statusAct = status
        ? (status === 'done'
            ? `<button class="link" data-action="mark-needs" data-key="${k}">Reopen</button>`
            : `<button class="link" data-action="mark-done" data-key="${k}">Mark done</button>`)
        : '';
      const noteHtml = p.note ? `<span class="row-note">${esc(p.note)}</span>` : '';
      return `<tr>
        <td colspan="2" class="col-page">
          <span class="page-title">${esc(p.label || 'Task')}</span>${noteHtml}
        </td>
        <td class="col-addr"><span class="muted">Off-web</span></td>
        <td class="col-status">${statusCol}</td>
        <td class="col-actions"><div class="actions-row">
          ${statusAct ? statusAct + '<span class="actions-sep"></span>' : ''}
          <button class="link" data-action="edit-note" data-key="${k}">Note</button>
          <span class="actions-sep"></span>
          <button class="link danger" data-action="remove" data-key="${k}">Delete</button>
        </div></td>
      </tr>`;
    }).join('');

    const taskSection = tasks.length ? `
      <section class="card sites-card">
        <div class="block-title" style="padding:14px 16px 0">Off-web tasks (${tasks.length})</div>
        <div class="table-wrap">
          <table class="sites-table">
            <thead><tr>
              <th colspan="2">Task</th><th>Type</th><th>Status</th>
              <th class="col-actions-head">Actions</th>
            </tr></thead>
            <tbody>${taskRows}</tbody>
          </table>
        </div>
      </section>` : '';

    view.innerHTML = `
      <section class="card sites-card">
        <div class="sites-search-bar">
          <input type="search" id="sites-search"
            placeholder="Search domain, title or address…"
            value="${esc(sitesQuery)}">
          <span class="sites-stat">${totalCount} site${totalCount === 1 ? '' : 's'}</span>
          <div class="toolbar-btns">
            <button class="secondary" data-action="add-site">+ Add site</button>
            <button class="secondary" data-action="add-task"${move ? '' : ' disabled title="Start a move first"'}>+ Add task</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="sites-table">
            <thead><tr>
              <th class="col-domain">Domain</th>
              <th>Page</th>
              <th class="col-addr">Address detected</th>
              <th class="col-status">Status</th>
              <th class="col-actions-head">Actions</th>
            </tr></thead>
            <tbody id="sites-tbody">${buildSiteRows()}</tbody>
          </table>
        </div>
      </section>
      ${taskSection}`;
  }

  // ---- render: addresses ---------------------------------------------------

  function renderAddresses() {
    const cards = state.addresses
      .slice()
      .sort((a, b) => (a.status === 'current' ? -1 : 1) - (b.status === 'current' ? -1 : 1))
      .map(addressCard).join('');
    view.innerHTML = cards;
  }

  function addressCard(a) {
    const variants = (a.flaggedVariants || []).map((v) =>
      `<li><code>${esc(v)}</code> <button class="link danger" data-action="del-variant" data-id="${a.id}" data-variant="${esc(v)}">✕</button></li>`
    ).join('') || `<li class="muted">No custom variants yet.</li>`;
    const del = a.status === 'past'
      ? `<button class="link danger" data-action="del-address" data-id="${a.id}">Delete</button>` : '';
    return `<section class="card">
        <div class="addr-head">
          <div><span class="badge ${a.status === 'current' ? 'done' : 'up_to_date'}">${a.status}</span>
            <span class="addr-line">${esc(address.format(a))}</span></div>
          <div>
            <button class="link" data-action="edit-address" data-id="${a.id}">Edit</button>
            ${del}
          </div>
        </div>
        <div class="block-title">Known variants</div>
        <p class="muted small">Common abbreviations (St/Street, SA/South Australia) are matched automatically. Add custom forms below.</p>
        <ol class="variants">${variants}</ol>
        <button class="link" data-action="add-variant" data-id="${a.id}">+ Add variant</button>
      </section>`;
  }

  // ---- render: settings ----------------------------------------------------

  function renderHelp() {
    const sections = [
      { id: 'setup',       label: 'Getting started' },
      { id: 'detection',   label: 'How detection works' },
      { id: 'variants',    label: 'Address variants' },
      { id: 'moving',      label: 'When you move' },
      { id: 'sites-table', label: 'The sites table' },
      { id: 'settings',    label: 'Settings' },
      { id: 'privacy',     label: 'Privacy' },
    ];
    const nav = sections.map((s) =>
      `<a href="#help-${s.id}" data-help-anchor="help-${s.id}">${s.label}</a>`).join('');

    view.innerHTML = `<div class="help-layout">
      <div class="help-main">

        <section class="help-section" id="help-setup">
          <h2>Getting started</h2>
          <p>Before the extension can detect anything, it needs to know your address. The setup page opens automatically when you install the extension; if you skipped it, the Dashboard shows a <strong>Run setup</strong> button. That is the only setup required.</p>
          <p>Once set, the extension scans every page you visit in the background. When it finds your address on a new site, a small prompt in the top-right corner of the page asks whether to save the site or exclude it. Prefer silence? Turn off "Ask before saving" in Settings and sites are recorded automatically.</p>
          <h3>First time checklist</h3>
          <ol>
            <li>Enter your current address during setup.</li>
            <li>Browse normally — visit your bank, utilities, insurance, subscriptions — and click <strong>Save site</strong> when the prompt appears.</li>
            <li>Check the Sites tab after a few days to see what you have saved.</li>
            <li>When you move, click <strong>Start move</strong> on the Dashboard.</li>
          </ol>
        </section>

        <section class="help-section" id="help-detection">
          <h2>How detection works</h2>
          <p>On each page you visit, the extension scans visible text and pre-filled form fields. It normalises the text and looks for your address using common abbreviations — Street matches St, South Australia matches SA, and so on.</p>
          <p>On a match, what happens depends on the page: a site you already track is updated silently; a new site shows the save prompt (unless you have turned confirmation off); an excluded page is skipped entirely.</p>
          <p>Detection happens entirely on your device. The extension never sends page content anywhere.</p>
          <h3>When a site is not detected</h3>
          <p>Some sites display addresses in unusual formats — truncated, reordered, or with extra text. If a site has your address but it is not being detected, the fix is to add a variant. You can also right-click any address text on a page and use the Address Tracker context menu to add the site manually.</p>
        </section>

        <section class="help-section" id="help-variants">
          <h2>Address variants</h2>
          <p>A variant is an alternate form of your address — exactly as it appears on a specific site. Common abbreviations are matched automatically. Variants are for anything else.</p>
          <p><strong>Example:</strong> Your address is 12 Smith Street, Perth WA 6000. A site shows it as Smith St 12, Perth, 6000 WA. That will not match automatically — add it as a variant and it will.</p>
          <h3>Adding a variant from a page</h3>
          <p>Select the address text on the site, right-click, and choose <strong>Add as new variant</strong>. The Addresses tab opens with the text pre-filled. Review it and click Add.</p>
          <h3>Matching an existing variant</h3>
          <p>If the selected text matches a variant you have already saved, right-click and pick it from the list. This records the page without adding a duplicate.</p>
        </section>

        <section class="help-section" id="help-moving">
          <h2>When you move</h2>
          <p>Click <strong>Start move</strong> on the Dashboard and enter your new address. The extension uses the Sites list as your update checklist.</p>
          <h3>Working through the checklist</h3>
          <p>The Dashboard shows Needs Update and Done columns. Visit each site, update your address, then mark it done — from the Dashboard, the Sites table, or the on-page banner.</p>
          <h3>The on-page banner</h3>
          <p>When you visit a site that still has your old address, a small banner appears in the top-right corner. It shows your new address to copy, and lets you mark the site done, exclude the page with <strong>Not mine</strong> (for false matches — a neighbour's listing, a store locator), or dismiss it for the session. Can be turned off in Settings.</p>
          <h3>Completing the move</h3>
          <p>Once all sites are marked done, click <strong>Complete move</strong>. Your new address becomes current, the old one is archived, and the checklist clears. To stop mid-move, click <strong>Cancel move</strong> — the new address is discarded.</p>
          <h3>Off-web tasks</h3>
          <p>Some updates have no website — calling HR, visiting a post office, updating a driver's licence. Add these as tasks from the Sites tab using <strong>+ Add task</strong>. They appear in the checklist alongside detected sites.</p>
        </section>

        <section class="help-section" id="help-sites-table">
          <h2>The sites table</h2>
          <table class="help-table">
            <thead><tr><th>Column</th><th>What it shows</th></tr></thead>
            <tbody>
              <tr><td>Domain</td><td>Click to open the site. Hover to see the full URL.</td></tr>
              <tr><td>Page</td><td>Page title at the time of detection. Notes appear below if added.</td></tr>
              <tr><td>Address detected</td><td>The form of your address found on that page.</td></tr>
              <tr><td>Status</td><td>Only shown during a move: Needs Update or Done.</td></tr>
              <tr><td>Actions</td><td>Note, Ignore, Delete — see below.</td></tr>
            </tbody>
          </table>
          <h3>Actions</h3>
          <dl>
            <dt>Note</dt><dd>Add a private note — useful for login hints or special instructions.</dd>
            <dt>Ignore</dt><dd>Hide this page, its whole domain, or anything starting with a URL prefix you edit. Everything you exclude is listed under Settings → Excludes, where it can be restored or removed.</dd>
            <dt>Delete</dt><dd>Permanently remove the site and all its history. Cannot be undone.</dd>
          </dl>
        </section>

        <section class="help-section" id="help-settings">
          <h2>Settings</h2>
          <h3>Detection</h3>
          <dl>
            <dt>Scan visible page text</dt><dd>The main detection method. Scans rendered text on every page you visit.</dd>
            <dt>Scan pre-filled form values</dt><dd>Checks input fields for your address. Useful for account settings pages.</dd>
            <dt>Ask before saving newly detected sites</dt><dd>Shows an on-page prompt when your address is found on a new site, so you decide what gets saved or excluded. Turn off to record sites silently. Pages showing your old address during a move are always saved — that list is the whole point.</dd>
            <dt>Skip footers and headers</dt><dd>Reduces false positives from sites that print your address in every page footer.</dd>
            <dt>Re-scan when the page changes</dt><dd>Watches for DOM changes and re-scans. Enable for single-page apps (SPAs).</dd>
            <dt>Show on-page banner during a move</dt><dd>Shows the update banner when your old address is found. Disable if disruptive.</dd>
          </dl>
          <h3>Excludes</h3>
          <p>One table of everything the extension skips. <strong>Domain</strong> (<code>google.com</code>) and <strong>Prefix</strong> (<code>google.com/maps</code>) rules stop matching pages from ever being tracked or bannered. A <strong>Page</strong> exclude is a single page you've hidden — Restore brings it back with its history, Remove deletes it. Excludes are created from the Ignore action on the Sites tab, the on-page prompt, or added directly in Settings. To clear several at once, tick their checkboxes and use <strong>Delete All Selected</strong>.</p>
          <h3>Backup and transfer</h3>
          <p><strong>Export</strong> saves your addresses, sites list, and move history as a JSON file. Use this to back up your data or move it to another device.</p>
          <p><strong>Import</strong> loads a previously exported file. You can merge it with existing data or replace everything. The file contains your home address — keep it private.</p>
        </section>

        <section class="help-section" id="help-privacy">
          <h2>Privacy</h2>
          <p>Everything the extension stores stays on this device. No data is sent to any server. The extension makes no network requests of its own.</p>
          <p>The extension reads page content only to search for your address. It does not read passwords, payment details, or anything unrelated to address detection.</p>
          <p>If you uninstall the extension, all stored data is deleted by the browser. Export first if you want to keep your sites list.</p>
        </section>

      </div>
      <nav class="help-nav-side">${nav}</nav>
    </div>`;

    const navLinks = view.querySelectorAll('[data-help-anchor]');
    const helpSections = view.querySelectorAll('.help-section');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          navLinks.forEach((a) => a.classList.toggle('active', a.dataset.helpAnchor === e.target.id));
        }
      });
    }, { rootMargin: '-15% 0px -70% 0px' });
    helpSections.forEach((s) => observer.observe(s));

    navLinks.forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        view.querySelector('#' + a.dataset.helpAnchor)?.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  function renderSettings() {
    const s = state.settings;
    const toggle = (key, label) =>
      `<label class="toggle"><input type="checkbox" data-setting="${key}"${s[key] ? ' checked' : ''}> ${label}</label>`;
    // One Excludes table: domain/prefix rules and individually-ignored pages.
    const TYPE_ORDER = { Domain: 0, Prefix: 1, Page: 2 };
    const excludes = [
      ...(state.ignoreRules || []).map((r) => ({
        type: r.includes('/') ? 'Prefix' : 'Domain', value: r, rule: r, href: 'https://' + r,
        id: 'rule:' + r,
      })),
      ...Object.entries(state.pages)
        .filter(([, p]) => p.ignored)
        .map(([key, p]) => ({
          type: 'Page', value: key, key, href: p.rawUrl || 'https://' + key,
          id: 'page:' + key,
        })),
    ].sort((a, b) => (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || a.value.localeCompare(b.value));

    // Drop selections whose row no longer exists.
    excludeSel = new Set([...excludeSel].filter((id) => excludes.some((x) => x.id === id)));
    const allChecked = excludes.length > 0 && excludes.every((x) => excludeSel.has(x.id));

    const excludeRows = excludes.length
      ? excludes.map((x) => `<tr>
          <td class="col-check"><input type="checkbox" class="exclude-check"
            data-exid="${esc(x.id)}"${excludeSel.has(x.id) ? ' checked' : ''}></td>
          <td class="col-type">${x.type}</td>
          <td class="col-value"><a href="${esc(x.href)}" title="${esc(x.value)}" target="_blank" rel="noopener"><code>${esc(x.value)}</code></a></td>
          <td class="col-actions"><div class="actions-row">
            ${x.key
              ? `<button class="link" data-action="restore" data-key="${esc(x.key)}">Restore</button>
                 <span class="actions-sep"></span>
                 <button class="link danger" data-action="remove" data-key="${esc(x.key)}">Remove</button>`
              : `<button class="link danger" data-action="remove-rule" data-rule="${esc(x.rule)}">Remove</button>`}
          </div></td>
        </tr>`).join('')
      : `<tr><td colspan="4" class="empty-row">Nothing excluded. Use Ignore on the Sites tab, or add a rule.</td></tr>`;

    view.innerHTML = `
      <section class="card">
        <div class="block-title">Backup & transfer</div>
        <p class="muted small">The export contains your home address and the list of sites you have accounts on. Keep it private.</p>
        <div class="btn-row">
          <button class="primary" data-action="export">Export as JSON</button>
          <label class="file-btn secondary">Import…<input type="file" id="import-file" accept="application/json" hidden></label>
        </div>
        <label class="toggle"><input type="checkbox" id="replace-all"> Replace all data on import (otherwise merge)</label>
      </section>
      <section class="card">
        <div class="block-title">Detection</div>
        ${toggle('scanVisibleText', 'Scan visible page text')}
        ${toggle('scanFormValues', 'Scan pre-filled form values')}
        ${toggle('confirmDetections', 'Ask before saving newly detected sites')}
        ${toggle('skipFooterHeader', 'Skip footers and headers')}
        ${toggle('rescanOnDomMutation', 'Re-scan when the page changes (SPA support)')}
        ${toggle('showBanner', 'Show the on-page banner during a move')}
      </section>
      <section class="card">
        <div class="block-head">
          <div class="block-title">Excludes</div>
          <div class="block-head-btns">
            ${excludeSel.size
              ? `<button class="secondary danger" data-action="delete-selected">Delete All Selected (${excludeSel.size})</button>`
              : ''}
            <button class="secondary" data-action="add-rule">+ Add rule</button>
          </div>
        </div>
        <p class="muted small">Domain and Prefix rules stop matching pages from ever being tracked.
          A Page exclude keeps its history: Restore puts it back in your lists,
          Remove deletes it (a detected page returns on your next visit).</p>
        <div class="table-wrap">
          <table class="sites-table">
            <thead><tr>
              <th class="col-check">${excludes.length
                ? `<input type="checkbox" id="exclude-check-all"${allChecked ? ' checked' : ''}>` : ''}</th>
              <th class="col-type">Type</th>
              <th>Value</th>
              <th class="col-actions-head">Actions</th>
            </tr></thead>
            <tbody>${excludeRows}</tbody>
          </table>
        </div>
      </section>`;
  }

  // ---- actions -------------------------------------------------------------

  async function startMove() {
    if (!storage.currentAddress(state)) {
      await openModal({ title: 'No address set', message: 'Set up your current address before starting a move.', okLabel: 'OK', hideCancel: true });
      return;
    }
    const addr = await openAddressDialog('Your new address', null);
    if (addr) await commit((s) => storage.startMove(s, addr, Date.now()));
  }

  async function editAddress(id) {
    const a = storage.addressById(state, id);
    const addr = await openAddressDialog('Edit address', a);
    if (addr) await commit((s) => storage.editAddress(s, id, addr));
  }

  function exportData() {
    const data = {
      schemaVersion: state.schemaVersion, addresses: state.addresses,
      moves: state.moves, pages: state.pages, settings: state.settings,
      ignoreRules: state.ignoreRules || [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'address-tracker-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importData(file) {
    const replaceAll = $('#replace-all')?.checked;
    let incoming;
    try { incoming = JSON.parse(await file.text()); }
    catch {
      await openModal({ title: 'Import failed', message: 'That file is not valid JSON.', okLabel: 'OK', hideCancel: true });
      return;
    }
    if (incoming.schemaVersion !== storage.SCHEMA_VERSION) {
      await openModal({ title: 'Import failed', message: `Unsupported backup version (expected ${storage.SCHEMA_VERSION}).`, okLabel: 'OK', hideCancel: true });
      return;
    }
    const { confirmed } = await openModal({
      title: 'Import backup',
      message: replaceAll ? 'Replace ALL current data with this file?' : 'Merge this file into your current data?',
      okLabel: replaceAll ? 'Replace all' : 'Merge',
      danger: replaceAll,
    });
    if (!confirmed) return;

    await commit((s) => {
      if (replaceAll) {
        s.addresses = incoming.addresses || [];
        s.moves = incoming.moves || [];
        s.pages = incoming.pages || {};
        s.settings = { ...storage.defaultSettings(), ...(incoming.settings || {}) };
        s.ignoreRules = incoming.ignoreRules || [];
      } else {
        mergeById(s.addresses, incoming.addresses);
        mergeById(s.moves, incoming.moves);
        Object.assign(s.pages, incoming.pages || {});
        Object.assign(s.settings, incoming.settings || {});
        s.ignoreRules = [...new Set([...(s.ignoreRules || []), ...(incoming.ignoreRules || [])])];
      }
    });
  }

  function mergeById(target, incoming) {
    const map = new Map(target.map((x) => [x.id, x]));
    for (const item of incoming || []) map.set(item.id, item);
    target.length = 0;
    target.push(...map.values());
  }

  // ---- event delegation ----------------------------------------------------

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const { action, key, id, variant, tab: newTab } = t.dataset;
    const now = Date.now();

    switch (action) {
      case 'tab': tab = newTab; render(); break;
      case 'onboarding': location.href = chrome.runtime.getURL('onboarding/onboarding.html'); break;

      case 'start-move': await startMove(); break;
      case 'complete-move': {
        const { confirmed } = await openModal({
          title: 'Complete move',
          message: 'Tasks are cleared and the new address becomes current.',
          okLabel: 'Complete',
        });
        if (confirmed) await commit((s) => storage.completeMove(s, now));
        break;
      }
      case 'cancel-move': {
        const { confirmed } = await openModal({
          title: 'Cancel move',
          message: 'The new address is removed and the old one stays current.',
          okLabel: 'Cancel move',
          danger: true,
        });
        if (confirmed) await commit((s) => storage.cancelMove(s, now));
        break;
      }

      case 'mark-done': await commit((s) => storage.setOverride(s, key, 'done', now)); break;
      case 'mark-needs': await commit((s) => storage.setOverride(s, key, 'needs_update', now)); break;
      case 'ignore': {
        const res = await openIgnoreDialog(key);
        if (!res) break;
        await commit((s) => {
          if (res.scope === 'page') storage.setIgnored(s, key, true);
          else storage.addIgnoreRule(s, res.rule, res.apply);
        });
        break;
      }
      case 'restore': await commit((s) => storage.setIgnored(s, key, false)); break;
      case 'remove-rule': await commit((s) => storage.removeIgnoreRule(s, t.dataset.rule)); break;
      case 'delete-selected': {
        const n = excludeSel.size;
        if (!n) break;
        const { confirmed } = await openModal({
          title: 'Delete selected excludes',
          message: `${n} selected exclude${n === 1 ? '' : 's'} will be deleted. Rules stop applying; pages are removed with their history.`,
          okLabel: 'Delete',
          danger: true,
        });
        if (!confirmed) break;
        const ids = [...excludeSel];
        excludeSel.clear();
        await commit((s) => {
          for (const id of ids) {
            if (id.startsWith('rule:')) storage.removeIgnoreRule(s, id.slice(5));
            else storage.removePage(s, id.slice(5));
          }
        });
        break;
      }
      case 'add-rule': {
        const { confirmed, values } = await openModal({
          title: 'Add exclude rule',
          message: 'A domain or URL prefix. Matching pages are never tracked; already-saved matches become Page excludes.',
          fields: [{ key: 'rule', label: '', placeholder: 'google.com/maps', required: true }],
          okLabel: 'Add',
        });
        if (confirmed && values.rule) await commit((s) => storage.addIgnoreRule(s, values.rule, true));
        break;
      }
      case 'remove': {
        const { confirmed } = await openModal({
          title: 'Delete site',
          message: 'This will permanently remove the site and all its history.',
          okLabel: 'Delete',
          danger: true,
        });
        if (confirmed) await commit((s) => storage.removePage(s, key));
        break;
      }
      case 'edit-note': {
        const cur = state.pages[key]?.note || '';
        const { confirmed, values } = await openModal({
          title: 'Note',
          fields: [{ key: 'note', label: 'Note for this site', default: cur, placeholder: 'Add a note…' }],
          okLabel: 'Save',
        });
        if (confirmed) await commit((s) => storage.setNote(s, key, values.note));
        break;
      }
      case 'add-site': {
        const { confirmed, values } = await openModal({
          title: 'Add site',
          fields: [
            { key: 'url', label: 'URL', placeholder: 'https://example.com/account', required: true, type: 'url' },
            { key: 'label', label: 'Label (optional)', placeholder: '' },
          ],
          okLabel: 'Add',
        });
        if (confirmed && values.url) {
          await commit((s) => storage.addManualSite(s, { rawUrl: values.url, title: values.label }, now));
        }
        break;
      }
      case 'add-task': {
        const { confirmed, values } = await openModal({
          title: 'Add task',
          fields: [{ key: 'label', label: 'Task', placeholder: 'Call electricity provider', required: true }],
          okLabel: 'Add',
        });
        if (confirmed && values.label) {
          await commit((s) => storage.addManualTask(s, { label: values.label }, now));
        }
        break;
      }

      case 'edit-address': await editAddress(id); break;
      case 'del-address': {
        const move = storage.activeMove(state);
        if (move && (move.fromAddressId === id || move.toAddressId === id)) {
          await openModal({
            title: 'Cannot delete',
            message: 'This address is part of your active move. Complete or cancel the move first.',
            okLabel: 'OK',
            hideCancel: true,
          });
          break;
        }
        const { confirmed } = await openModal({
          title: 'Delete address',
          message: 'This past address will be permanently deleted.',
          okLabel: 'Delete',
          danger: true,
        });
        if (confirmed) await commit((s) => storage.deleteAddress(s, id));
        break;
      }
      case 'add-variant': {
        const { confirmed, values } = await openModal({
          title: 'Add variant',
          message: 'Add an address form to also match, as written on a site.',
          fields: [{ key: 'text', label: '', placeholder: 'PO Box 99, Perth WA 6000', required: true }],
          okLabel: 'Add',
        });
        if (confirmed && values.text) {
          await commit((s) => storage.addVariant(s, id, values.text));
        }
        break;
      }
      case 'del-variant': await commit((s) => storage.deleteVariant(s, id, variant)); break;

      case 'export': exportData(); break;
    }
  });

  document.addEventListener('change', async (e) => {
    if (e.target.dataset.setting) {
      const key = e.target.dataset.setting, val = e.target.checked;
      await commit((s) => { s.settings[key] = val; });
    } else if (e.target.classList.contains('exclude-check')) {
      if (e.target.checked) excludeSel.add(e.target.dataset.exid);
      else excludeSel.delete(e.target.dataset.exid);
      render();
    } else if (e.target.id === 'exclude-check-all') {
      if (e.target.checked) {
        document.querySelectorAll('.exclude-check').forEach((cb) => excludeSel.add(cb.dataset.exid));
      } else {
        excludeSel.clear();
      }
      render();
    } else if (e.target.id === 'import-file' && e.target.files[0]) {
      await importData(e.target.files[0]);
      e.target.value = '';
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'sites-search') {
      sitesQuery = e.target.value;
      const tbody = document.getElementById('sites-tbody');
      if (tbody) tbody.innerHTML = buildSiteRows();
    }
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    const prevPages = changes.pages?.oldValue || {};
    const nextPages = changes.pages?.newValue || {};
    await refresh();
    for (const [, page] of Object.entries(nextPages)) {
      if (!prevPages[page.url] && page.everDetected?.length && page.kind !== 'manual') {
        const addrs = page.everDetected.map(id => storage.addressById(state, id)).filter(Boolean);
        if (addrs.length) { showToast(page, addrs); break; }
      }
    }
  });

  async function handleUrlParams() {
    const params = new URLSearchParams(location.search);
    if (params.get('action') !== 'addVariant') return;
    const addressId = params.get('addressId');
    const text = params.get('text') || '';
    const pageUrl = params.get('pageUrl') || '';
    const pageTitle = params.get('pageTitle') || '';
    if (!addressId || !text) return;

    tab = 'addresses';
    history.replaceState(null, '', location.pathname);

    await refresh();

    const a = storage.addressById(state, addressId);
    const { confirmed, values } = await openModal({
      title: 'Add address variant',
      message: a ? `For: ${address.format(a)}` : '',
      fields: [{ key: 'text', label: 'Variant text', default: text, required: true }],
      okLabel: 'Add',
    });
    if (confirmed && values.text) {
      await commit((s) => {
        storage.addVariant(s, addressId, values.text);
        if (pageUrl) storage.recordScan(s, { url: pageUrl, rawUrl: pageUrl, title: pageTitle }, [addressId], Date.now());
      });
    }
  }

  async function handleHashAction() {
    if (location.hash !== '#move') return;
    history.replaceState(null, '', location.pathname);
    await startMove();
  }

  refresh().then(async () => {
    await handleUrlParams();
    await handleHashAction();
  });
})();
