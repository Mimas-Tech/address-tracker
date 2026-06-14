// popup.js — quick status: current address, move progress, counts, and the
// jump-off buttons. Read-only except for opening other pages.
(() => {
  const { storage, address } = AT;
  const body = document.getElementById('body');

  const openPage = (path) => {
    chrome.tabs.create({ url: chrome.runtime.getURL(path) });
    window.close();
  };

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function render(state) {
    const current = storage.currentAddress(state);
    if (!current) {
      body.innerHTML = `<p class="empty">No address set up yet.</p>`;
      addButton('Set up', 'primary', () => openPage('onboarding/onboarding.html'));
      return;
    }

    const move = storage.activeMove(state);
    const prog = storage.progress(state);
    const tracked = Object.values(state.pages).filter((p) => !p.ignored).length;

    const blocks = [];
    blocks.push(section('Current address', esc(address.format(current))));

    if (move) {
      const to = storage.addressById(state, move.toAddressId);
      const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
      blocks.push(section('Move in progress',
        `→ ${esc(to ? address.format(to) : '')}
         <div class="bar"><span style="width:${pct}%"></span></div>
         <div class="bar-label">${prog.done} / ${prog.total} done</div>`));
    }

    const needs = move ? prog.needs : 0;
    blocks.push(`<div class="stats">${tracked} site${tracked === 1 ? '' : 's'} tracked${
      move ? ` · ${needs} need update` : ''}</div>`);

    body.innerHTML = blocks.join('');

    addButton('Open dashboard', 'primary', () => openPage('management/management.html'));
    if (!move) addButton('Start move', 'secondary', () => openPage('management/management.html#move'));
  }

  function section(title, html) {
    return `<div class="block"><div class="block-title">${title}</div><div class="block-body">${html}</div></div>`;
  }

  function addButton(label, kind, onClick) {
    let row = document.querySelector('.btn-row');
    if (!row) { row = document.createElement('div'); row.className = 'btn-row'; body.appendChild(row); }
    const b = document.createElement('button');
    b.className = kind;
    b.textContent = label;
    b.addEventListener('click', onClick);
    row.appendChild(b);
  }

  storage.load().then(render);
})();
