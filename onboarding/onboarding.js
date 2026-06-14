// onboarding.js — three-way situation branch, then collect address(es) and
// (for a move) open the move immediately. Writes go straight through
// AT.storage.update; the background worker reacts via storage.onChanged.
(() => {
  const { storage, address, constants } = AT;
  const $ = (sel) => document.querySelector(sel);

  let situation = null;
  const isMove = () => situation === 'about_to_move' || situation === 'already_moved';

  // ---- form building -------------------------------------------------------

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
    return { street: val('street'), suburb: val('suburb'), state: val('state'), postcode: val('postcode') };
  }

  function validate(addr) {
    if (!addr.street || !addr.suburb || !addr.state) return 'Please fill in street, suburb and state.';
    if (!/^\d{4}$/.test(addr.postcode)) return 'Postcode must be 4 digits.';
    return null;
  }

  // ---- step navigation -----------------------------------------------------

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
})();
