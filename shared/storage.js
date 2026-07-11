// Single source of truth over chrome.storage.local: persistence, URL
// normalization, status derivation, and all state transitions. Transitions are
// plain state-mutating functions so they're unit-testable without Chrome.
globalThis.AT = globalThis.AT || {};

AT.storage = (() => {
  const KEYS = ['schemaVersion', 'addresses', 'moves', 'pages', 'settings', 'ignoreRules'];
  const SCHEMA_VERSION = 1;

  const uid = () => crypto.randomUUID();

  function defaultSettings() {
    return {
      scanVisibleText: true,
      scanFormValues: true,
      skipFooterHeader: true,
      rescanOnDomMutation: true,
      showBanner: true,
      confirmDetections: true, // ask on-page before saving a newly detected site
    };
  }

  function defaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      addresses: [],
      moves: [],
      pages: {},
      settings: defaultSettings(),
      ignoreRules: [],
    };
  }

  async function load() {
    const stored = await chrome.storage.local.get(KEYS);
    const state = defaultState();
    // Merge so a partially-written store (e.g. from import) still gets defaults.
    return {
      ...state,
      ...stored,
      settings: { ...state.settings, ...(stored.settings || {}) },
    };
  }

  async function save(state) {
    await chrome.storage.local.set({
      schemaVersion: state.schemaVersion ?? SCHEMA_VERSION,
      addresses: state.addresses,
      moves: state.moves,
      pages: state.pages,
      settings: state.settings,
      ignoreRules: state.ignoreRules,
    });
  }

  // Load -> transition -> save. Writes only the top-level keys that changed:
  // a pages-only scan must never look like an addresses/moves/settings change
  // to listeners, or content.js would re-scan in a loop.
  async function update(fn) {
    const state = await load();
    const before = {
      addresses: JSON.stringify(state.addresses),
      moves: JSON.stringify(state.moves),
      pages: JSON.stringify(state.pages),
      settings: JSON.stringify(state.settings),
      ignoreRules: JSON.stringify(state.ignoreRules),
    };
    const result = fn(state);
    const out = {};
    if (JSON.stringify(state.addresses) !== before.addresses) out.addresses = state.addresses;
    if (JSON.stringify(state.moves) !== before.moves) out.moves = state.moves;
    if (JSON.stringify(state.pages) !== before.pages) out.pages = state.pages;
    if (JSON.stringify(state.settings) !== before.settings) out.settings = state.settings;
    if (JSON.stringify(state.ignoreRules) !== before.ignoreRules) out.ignoreRules = state.ignoreRules;
    if (Object.keys(out).length) {
      out.schemaVersion = state.schemaVersion ?? SCHEMA_VERSION;
      await chrome.storage.local.set(out);
    }
    return result;
  }

  // Page identity is host + path; query params and fragment are dropped
  // (they're overwhelmingly session/tracking noise that spawns duplicates).
  function normalizeUrl(raw) {
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      const path = u.pathname.replace(/\/+$/, '') || '/';
      return host + path;
    } catch {
      return String(raw || '');
    }
  }

  const domainOf = (key) => key.split('/')[0];

  // Exclude rules: prefixes on the normalized URL key — "google.com" (whole
  // domain) or "google.com/maps" (starts-with). Matching pages are never tracked.

  function normalizeRule(text) {
    return String(text || '')
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '');
  }

  // A bare domain rule must not swallow "google.com.au"; a rule with a path is a plain prefix.
  function ruleMatches(rule, key) {
    const k = key.toLowerCase();
    if (rule.includes('/')) return k.startsWith(rule);
    return k === rule || k.startsWith(rule + '/');
  }

  const isRuleIgnored = (state, key) =>
    (state.ignoreRules || []).some((r) => ruleMatches(r, key));

  // applyToExisting also flags saved matching entries. Removing the rule later
  // does NOT un-flag them — pages are restored individually from Settings.
  function addIgnoreRule(state, text, applyToExisting) {
    const rule = normalizeRule(text);
    if (!rule) return null;
    state.ignoreRules = state.ignoreRules || [];
    if (!state.ignoreRules.includes(rule)) state.ignoreRules.push(rule);
    if (applyToExisting) {
      for (const [key, page] of Object.entries(state.pages)) {
        if (page.kind === 'web' && ruleMatches(rule, key)) page.ignored = true;
      }
    }
    return rule;
  }

  function removeIgnoreRule(state, rule) {
    state.ignoreRules = (state.ignoreRules || []).filter((r) => r !== rule);
  }

  const activeMove = (state) => state.moves.find((m) => m.status === 'in_progress') || null;
  const currentAddress = (state) => state.addresses.find((a) => a.status === 'current') || null;
  const addressById = (state, id) => state.addresses.find((a) => a.id === id) || null;

  // In scope of the move: old address was once seen here, or added manually
  // during this move. Ignored pages never count.
  function inScope(page, move) {
    if (!move || page.ignored) return false;
    return page.everDetected.includes(move.fromAddressId) || page.moveId === move.id;
  }

  // Status is always derived, never stored. Precedence:
  //   old address on the page now -> needs_update (beats an override),
  //   then user override, then new-address-seen -> done, else needs_update.
  function deriveStatus(page, move) {
    if (!move || !inScope(page, move)) return 'up_to_date';
    if (page.statusOverride) return page.statusOverride;
    if (page.lastDetected.includes(move.fromAddressId)) return 'needs_update';
    if (page.everDetected.includes(move.toAddressId)) return 'done';
    return 'needs_update';
  }

  function progress(state) {
    const move = activeMove(state);
    if (!move) return null;
    let done = 0, needs = 0;
    for (const page of Object.values(state.pages)) {
      if (!inScope(page, move)) continue;
      if (deriveStatus(page, move) === 'done') done++;
      else needs++;
    }
    return { done, needs, total: done + needs };
  }

  function makeAddress(fields, status, now) {
    return {
      id: uid(),
      line2: (fields.line2 || '').trim(),
      street: fields.street.trim(),
      suburb: fields.suburb.trim(),
      state: fields.state.trim(),
      postcode: fields.postcode.trim(),
      country: 'Australia',
      flaggedVariants: [],
      status,
      createdAt: now,
    };
  }

  function makePage(over, now) {
    return {
      kind: 'web',
      domain: '',
      url: null,
      rawUrl: null,
      title: '',
      label: '',
      everDetected: [],
      lastDetected: [],
      statusOverride: null,
      note: '',
      addedManually: false,
      moveId: null,
      ignored: false,
      firstDetected: now,
      lastVisited: now,
      statusChangedAt: now,
      ...over,
    };
  }

  function setInitialAddress(state, fields, now) {
    const addr = makeAddress(fields, 'current', now);
    state.addresses.push(addr);
    return addr;
  }

  function editAddress(state, id, fields) {
    const addr = addressById(state, id);
    if (!addr) return null;
    Object.assign(addr, {
      line2: (fields.line2 || '').trim(),
      street: fields.street.trim(),
      suburb: fields.suburb.trim(),
      state: fields.state.trim(),
      postcode: fields.postcode.trim(),
    });
    return addr;
  }

  function deleteAddress(state, id) {
    state.addresses = state.addresses.filter((a) => a.id !== id);
    sweepAddressId(state, id);
  }

  // Drops a deleted address id from every page's detection sets.
  function sweepAddressId(state, id) {
    for (const page of Object.values(state.pages)) {
      page.everDetected = page.everDetected.filter((x) => x !== id);
      page.lastDetected = page.lastDetected.filter((x) => x !== id);
    }
  }

  function addVariant(state, id, text) {
    const addr = addressById(state, id);
    const v = AT.detect.normalize(text);
    if (!addr || !v || addr.flaggedVariants.includes(v)) return null;
    addr.flaggedVariants.push(v);
    return v;
  }

  function deleteVariant(state, id, variant) {
    const addr = addressById(state, id);
    if (addr) addr.flaggedVariants = addr.flaggedVariants.filter((v) => v !== variant);
  }

  // New address becomes current, old becomes past. No bulk status write:
  // in-scope pages derive to needs_update automatically.
  function startMove(state, newFields, now) {
    const from = currentAddress(state);
    if (!from) return null;
    const to = makeAddress(newFields, 'current', now);
    from.status = 'past';
    state.addresses.push(to);
    const move = {
      id: uid(),
      fromAddressId: from.id,
      toAddressId: to.id,
      startedAt: now,
      completedAt: null,
      status: 'in_progress',
    };
    state.moves.push(move);
    clearOverrides(state);
    return move;
  }

  function completeMove(state, now) {
    const move = activeMove(state);
    if (!move) return null;
    move.status = 'completed';
    move.completedAt = now;
    clearOverrides(state);
    removeMoveTasks(state, move.id); // move tasks are one-time to-dos
    return move;
  }

  // Reverts the address swap and deletes the address created for the move.
  function cancelMove(state, now) {
    const move = activeMove(state);
    if (!move) return null;
    move.status = 'cancelled';
    move.completedAt = now;
    const from = addressById(state, move.fromAddressId);
    if (from) from.status = 'current';
    deleteAddress(state, move.toAddressId);
    clearOverrides(state);
    removeMoveTasks(state, move.id);
    return move;
  }

  function clearOverrides(state) {
    for (const page of Object.values(state.pages)) page.statusOverride = null;
  }

  function removeMoveTasks(state, moveId) {
    for (const [key, page] of Object.entries(state.pages)) {
      if (page.kind === 'manual' && page.moveId === moveId) delete state.pages[key];
    }
  }

  // What to do with a scan result before anything is written:
  //   'record' — save it (already-tracked page, confirmation off, or the move's
  //              old address — that one is never allowed to slip through)
  //   'prompt' — ask the user on-page before saving (new site, confirmation on)
  //   'skip'   — nothing to do (excluded, or no match on an unknown page)
  function scanDecision(state, key, matchedIds) {
    if (isRuleIgnored(state, key)) return 'skip';
    const existing = state.pages[key];
    if (existing) return existing.ignored ? 'skip' : 'record';
    if (!matchedIds.length) return 'skip';
    if (!state.settings.confirmDetections) return 'record';
    const move = activeMove(state);
    if (move && matchedIds.includes(move.fromAddressId)) return 'record';
    return 'prompt';
  }

  // Exclude a page even if it was never saved: create the entry if needed and
  // flag it, so the toast's "ignore page" works before the page is in the ledger.
  function ignorePage(state, { url, rawUrl, title }, now) {
    const key = normalizeUrl(url);
    if (!state.pages[key]) {
      state.pages[key] = makePage({
        domain: domainOf(key), url: key, rawUrl: rawUrl || url, title: title || '',
      }, now);
    }
    state.pages[key].ignored = true;
    return key;
  }

  // Creates a page only when something matched; excluded pages are left alone.
  function recordScan(state, { url, rawUrl, title }, matchedIds, now) {
    const key = normalizeUrl(url);
    if (isRuleIgnored(state, key)) return null;
    const existing = state.pages[key];

    if (existing) {
      if (existing.ignored) return null;
      existing.lastDetected = [...matchedIds];
      for (const id of matchedIds) {
        if (!existing.everDetected.includes(id)) existing.everDetected.push(id);
      }
      existing.lastVisited = now;
      if (title && !existing.title) existing.title = title;
      return key;
    }

    if (matchedIds.length === 0) return null;
    state.pages[key] = makePage({
      domain: domainOf(key),
      url: key,
      rawUrl: rawUrl || url,
      title: title || '',
      everDetected: [...matchedIds],
      lastDetected: [...matchedIds],
    }, now);
    return key;
  }

  // A site the user remembers but hasn't visited. In scope if a move is active.
  function addManualSite(state, { rawUrl, title, note }, now) {
    const key = normalizeUrl(rawUrl);
    if (state.pages[key]) return key;
    const move = activeMove(state);
    state.pages[key] = makePage({
      domain: domainOf(key),
      url: key,
      rawUrl,
      title: title || '',
      note: note || '',
      addedManually: true,
      moveId: move ? move.id : null,
    }, now);
    return key;
  }

  // An off-web task (phone call, in person, mail). Only exists within a move.
  function addManualTask(state, { label, note }, now) {
    const move = activeMove(state);
    if (!move) return null;
    const key = 'task:' + uid();
    state.pages[key] = makePage({
      kind: 'manual',
      label,
      note: note || '',
      addedManually: true,
      moveId: move.id,
    }, now);
    return key;
  }

  function setOverride(state, key, status, now) {
    const page = state.pages[key];
    if (!page) return;
    page.statusOverride = status;
    page.statusChangedAt = now;
  }

  function setIgnored(state, key, ignored) {
    const page = state.pages[key];
    if (page) page.ignored = ignored;
  }

  // Hard delete. A still-detected page will be re-tracked on the next visit.
  function removePage(state, key) {
    delete state.pages[key];
  }

  function setNote(state, key, note) {
    const page = state.pages[key];
    if (page) page.note = note;
  }

  return {
    KEYS, SCHEMA_VERSION, defaultState, defaultSettings,
    load, save, update,
    normalizeUrl, domainOf,
    normalizeRule, ruleMatches, isRuleIgnored, addIgnoreRule, removeIgnoreRule,
    activeMove, currentAddress, addressById, inScope, deriveStatus, progress,
    setInitialAddress, editAddress, deleteAddress, addVariant, deleteVariant,
    startMove, completeMove, cancelMove,
    scanDecision, ignorePage,
    recordScan, addManualSite, addManualTask, setOverride, setIgnored, removePage, setNote,
  };
})();
