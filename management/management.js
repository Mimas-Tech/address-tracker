// management.js — the full UI: Dashboard / Sites / Addresses / Settings, plus
// the move view folded into the Dashboard. All reads/writes go through
// AT.storage; every mutation reloads + re-renders. Event handling is delegated,
// so re-rendering #view never leaves stale listeners behind.
(() => {
  const { storage, address, constants } = AT;
  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $('#view');

  let state = storage.defaultState();
  let tab = 'dashboard';
  let sitesQuery = '';

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

  // ---- render: dispatch ----------------------------------------------------

  function render() {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    if (!storage.currentAddress(state) && state.addresses.length === 0) {
      view.innerHTML = `<section class="card"><p>No address set up yet.</p>
        <button class="primary" data-action="onboarding">Run setup</button></section>`;
      return;
    }
    ({ dashboard: renderDashboard, sites: renderSites, addresses: renderAddresses, settings: renderSettings }[tab])();
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

  function renderSettings() {
    const s = state.settings;
    const toggle = (key, label) =>
      `<label class="toggle"><input type="checkbox" data-setting="${key}"${s[key] ? ' checked' : ''}> ${label}</label>`;
    const ignored = Object.entries(state.pages).filter(([, p]) => p.ignored);
    const ignoredList = ignored.length
      ? ignored.map(([key, p]) => `<li>${esc(pageName(p))} <span class="muted">${esc(p.domain || '')}</span>
          <button class="link" data-action="restore" data-key="${esc(key)}">Restore</button></li>`).join('')
      : `<li class="muted">Nothing ignored.</li>`;

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
        ${toggle('skipFooterHeader', 'Skip footers and headers')}
        ${toggle('rescanOnDomMutation', 'Re-scan when the page changes (SPA support)')}
        ${toggle('showBanner', 'Show the on-page banner during a move')}
      </section>
      <section class="card">
        <div class="block-title">Ignored sites</div>
        <ul class="recent">${ignoredList}</ul>
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
      } else {
        mergeById(s.addresses, incoming.addresses);
        mergeById(s.moves, incoming.moves);
        Object.assign(s.pages, incoming.pages || {});
        Object.assign(s.settings, incoming.settings || {});
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
        const { confirmed } = await openModal({
          title: 'Ignore site',
          message: 'This site will be hidden from the list. You can restore it any time from Settings.',
          okLabel: 'Ignore',
        });
        if (confirmed) await commit((s) => storage.setIgnored(s, key, true));
        break;
      }
      case 'restore': await commit((s) => storage.setIgnored(s, key, false)); break;
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
