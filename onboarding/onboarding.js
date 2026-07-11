// Onboarding: situation branch, address entry, optional backup import.
(() => {
  const { storage, address, constants } = AT;
  const $ = (sel) => document.querySelector(sel);

  let situation = null;
  const isMove = () => situation === 'about_to_move' || situation === 'already_moved';

  function stateOptions() {
    return ['<option value="">State…</option>']
      .concat(Object.values(constants.AU_STATES).map((c) => `<option value="${c}">${c}</option>`))
      .join('');
  }

  function addressGroup(name, legend) {
    return `
      <fieldset class="addr-group" data-name="${name}">
        <legend>${legend}</legend>
        <label>Street address
          <input data-f="street" placeholder="12 Smith St" autocomplete="off"></label>
        <label>Unit / Apt / Suite (optional)
          <input data-f="line2" placeholder="Unit 3" autocomplete="off"></label>
        <label>Suburb
          <input data-f="suburb" placeholder="Adelaide" autocomplete="off"></label>
        <div class="row">
          <label>State<select data-f="state">${stateOptions()}</select></label>
          <label>Postcode
            <input data-f="postcode" placeholder="5000" maxlength="4" inputmode="numeric"></label>
        </div>
      </fieldset>`;
  }

  function renderForms() {
    const host = $('#address-forms');
    host.innerHTML = isMove()
      ? addressGroup('old', 'Your current (old) address') + addressGroup('new', 'Your new address')
      : addressGroup('single', 'Your current address');
  }

  function readGroup(name) {
    const root = document.querySelector(`.addr-group[data-name="${name}"]`);
    const val = (f) => root.querySelector(`[data-f="${f}"]`).value.trim();
    return { line2: val('line2'), street: val('street'), suburb: val('suburb'), state: val('state'), postcode: val('postcode') };
  }

  function validate(addr) {
    if (!addr.street || !addr.suburb || !addr.state) return 'Please fill in street, suburb and state.';
    if (!/^\d{4}$/.test(addr.postcode)) return 'Postcode must be 4 digits.';
    return null;
  }

  function goStep(id) {
    for (const s of ['step1', 'step2', 'done']) $('#' + s).hidden = (s !== id);
  }

  document.querySelectorAll('.choice').forEach((btn) => {
    btn.addEventListener('click', () => {
      situation = btn.dataset.situation;
      renderForms();
      goStep('step2');
    });
  });

  $('#back').addEventListener('click', () => goStep('step1'));

  $('#continue').addEventListener('click', async () => {
    const err = $('#form-error');
    err.hidden = true;

    const groups = isMove() ? [['old', readGroup('old')], ['new', readGroup('new')]]
                            : [['single', readGroup('single')]];
    for (const [, addr] of groups) {
      const msg = validate(addr);
      if (msg) { err.textContent = msg; err.hidden = false; return; }
    }

    const now = Date.now();
    await storage.update((s) => {
      if (isMove()) {
        storage.setInitialAddress(s, readGroup('old'), now); // becomes current...
        storage.startMove(s, readGroup('new'), now);          // ...then demoted, new is current
      } else {
        storage.setInitialAddress(s, readGroup('single'), now);
      }
    });

    $('#done-detail').textContent = isMove()
      ? 'Your move is underway. Browse your usual sites and Address Tracker will flag the ones still showing your old address.'
      : 'Browse normally — the list builds itself. Start a move from the dashboard whenever you need to.';
    goStep('done');
  });

  $('#open-dashboard').addEventListener('click', () => {
    location.href = chrome.runtime.getURL('management/management.html');
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const errEl = $('#import-error');
    errEl.hidden = true;

    let incoming;
    try { incoming = JSON.parse(await file.text()); }
    catch {
      errEl.textContent = 'That file is not valid JSON.';
      errEl.hidden = false;
      return;
    }

    if (incoming.schemaVersion !== storage.SCHEMA_VERSION) {
      errEl.textContent = `Unsupported backup version (expected ${storage.SCHEMA_VERSION}).`;
      errEl.hidden = false;
      return;
    }

    await storage.update((s) => {
      s.addresses = incoming.addresses || [];
      s.moves = incoming.moves || [];
      s.pages = incoming.pages || {};
      s.settings = { ...storage.defaultSettings(), ...(incoming.settings || {}) };
      s.ignoreRules = incoming.ignoreRules || [];
    });

    $('#done-detail').textContent = 'Your backup has been restored. All your addresses and sites are back.';
    goStep('done');
  });
})();
