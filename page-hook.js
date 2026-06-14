// page-hook.js — runs in the page's MAIN world (injected by content.js).
//
// A content script lives in an isolated world and can't see the page's own
// history.pushState/replaceState calls. This tiny shim wraps them and fires a
// plain DOM event on window, which the content script listens for to re-scan
// after SPA navigations. The event carries no data, so it crosses worlds fine.
(() => {
  const fire = () => window.dispatchEvent(new Event('at:navigation'));
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      fire();
      return result;
    };
  }
  window.addEventListener('popstate', fire);
  window.addEventListener('hashchange', fire);
})();
