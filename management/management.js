// management.js — the full UI: Dashboard / Sites / Addresses / Settings, plus
// the move view folded into the Dashboard. All reads/writes go through
// AT.storage; every mutation reloads + re-renders. Event handling is delegated,
// so re-rendering #view never leaves stale listeners behind.
(() => {
  const { storage, address, constants } = AT;
  const $ = (sel, root = document) => root.querySelector(sel);
  const view = $('#view');

  let state = storage.defaultState();
  let tab = location.hash === '#move' ? 'dashboard' : 'dashboard';

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
    return { street: f('street'), suburb: f('suburb'), state: f('state'), postcode: f('postcode') };
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
        ? `<section class="card empty">Nothing detected yet — browse your accounts, or add sites/tasks from the Sites tab.</section>`
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
    // Pages are stored keyed by URL/task-id; find this entry's key.
    return Object.keys(state.pages).find((k) => state.pages[k] === p);
  }

  function renderSites() {
    const move = storage.activeMove(state);
    const entries = Object.entries(state.pages).filter(([, p]) => !p.ignored);
    const web = entries.filter(([, p]) => isWeb(p));
    const tasks = entries.filter(([, p]) => p.kind === 'manual');

    const byDomain = {};
    for (const [key, p] of web) (byDomain[p.domain] ||= []).push([key, p]);

    const domainGroups = Object.keys(byDomain).sort().map((domain) => {
      const rows = byDomain[domain].map(([key, p]) => siteRow(key, p, move)).join('');
      return `<details class="group"><summary>${esc(domain)} <span class="muted">(${byDomain[domain].length})</span></summary>${rows}</details>`;
    }).join('') || `<p class="muted">No sites tracked yet. Browse your accounts, or add one below.</p>`;

    const taskGroup = tasks.length
      ? `<details class="group" open><summary>Off-web tasks <span class="muted">(${tasks.length})</span></summary>
         ${tasks.map(([key, p]) => siteRow(key, p, move)).join('')}</details>` : '';

    view.innerHTML = `
      <section class="card">
        <div class="toolbar">
          <button class="secondary" data-action="add-site">+ Add site</button>
          <button class="secondary" data-action="add-task"${move ? '' : ' disabled title="Start a move first"'}>+ Add task</button>
        </div>
        ${domainGroups}
        ${taskGroup}
      </section>`;
  }

  function siteRow(key, p, move) {
    const status = storage.deriveStatus(p, move);
    const k = esc(key);
    const go = isWeb(p) && p.rawUrl ? `<a class="link" href="${esc(p.rawUrl)}" target="_blank">Go</a>` : '';
    const statusBtns = status === 'done'
      ? `<button class="link" data-action="mark-needs" data-key="${k}">Needs update</button>`
      : `<button class="link" data-action="mark-done" data-key="${k}">Mark done</button>`;
    const removeOrIgnore = p.addedManually
      ? `<button class="link danger" data-action="remove" data-key="${k}">Remove</button>`
      : `<button class="link danger" data-action="ignore" data-key="${k}">Ignore</button>`;
    const note = p.note ? `<div class="li-note">📝 ${esc(p.note)}</div>` : '';
    return `<div class="site-row">
        <div class="li-main">${esc(pageName(p))} ${statusBadge(status)}</div>
        <div class="li-sub">${go} ${statusBtns}
          <button class="link" data-action="edit-note" data-key="${k}">Note</button>
          ${removeOrIgnore}</div>
        ${note}
      </div>`;
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
        <ul class="variants">${variants}</ul>
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
        <p class="muted small">⚠️ The export contains your home address and the list of sites you have accounts on. Keep it private.</p>
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
    if (!storage.currentAddress(state)) { alert('Set up your current address first.'); return; }
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
    catch { alert('That file is not valid JSON.'); return; }
    if (incoming.schemaVersion !== storage.SCHEMA_VERSION) {
      alert(`Unsupported backup version (expected ${storage.SCHEMA_VERSION}).`); return;
    }
    if (!confirm(replaceAll ? 'Replace ALL current data with this file?' : 'Merge this file into your current data?')) return;

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

  // Merge incoming items into `target` (array) by id, in place.
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
    const { action, key, id, status, variant, tab: newTab } = t.dataset;
    const now = Date.now();

    switch (action) {
      case 'tab': tab = newTab; render(); break;
      case 'onboarding': location.href = chrome.runtime.getURL('onboarding/onboarding.html'); break;

      case 'start-move': await startMove(); break;
      case 'complete-move':
        if (confirm('Complete this move? Tasks are cleared and the new address becomes current.'))
          await commit((s) => storage.completeMove(s, now));
        break;
      case 'cancel-move':
        if (confirm('Cancel this move? The new address is removed and the old one stays current.'))
          await commit((s) => storage.cancelMove(s, now));
        break;

      case 'mark-done': await commit((s) => storage.setOverride(s, key, 'done', now)); break;
      case 'mark-needs': await commit((s) => storage.setOverride(s, key, 'needs_update', now)); break;
      case 'ignore':
        if (confirm('Ignore this site? It leaves the checklist and stops being monitored.'))
          await commit((s) => storage.setIgnored(s, key, true));
        break;
      case 'restore': await commit((s) => storage.setIgnored(s, key, false)); break;
      case 'remove':
        if (confirm('Remove this entry?')) await commit((s) => storage.removePage(s, key));
        break;
      case 'edit-note': {
        const cur = state.pages[key]?.note || '';
        const note = prompt('Note for this site:', cur);
        if (note !== null) await commit((s) => storage.setNote(s, key, note.trim()));
        break;
      }
      case 'add-site': {
        const url = prompt('Site URL (e.g. https://example.com/account):');
        if (url && url.trim()) {
          const title = prompt('A label for it (optional):', '') || '';
          await commit((s) => storage.addManualSite(s, { rawUrl: url.trim(), title: title.trim() }, now));
        }
        break;
      }
      case 'add-task': {
        const label = prompt('Task (e.g. "Call electricity provider"):');
        if (label && label.trim()) await commit((s) => storage.addManualTask(s, { label: label.trim() }, now));
        break;
      }

      case 'edit-address': await editAddress(id); break;
      case 'del-address': {
        const move = storage.activeMove(state);
        if (move && (move.fromAddressId === id || move.toAddressId === id)) {
          alert('This address is part of your active move. Complete or cancel the move first.');
          break;
        }
        if (confirm('Delete this past address?')) await commit((s) => storage.deleteAddress(s, id));
        break;
      }
      case 'add-variant': {
        const text = prompt('Add an address form to also match (as written on a site):');
        if (text && text.trim()) await commit((s) => storage.addVariant(s, id, text.trim()));
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
      e.target.value = ''; // allow re-importing the same file
    }
  });

  // Live-update when a scan (or another tab) changes storage.
  chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local') refresh(); });

  refresh();
})();
