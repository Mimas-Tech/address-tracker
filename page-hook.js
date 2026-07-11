// MAIN-world shim: content scripts can't observe the page's own pushState/
// replaceState, so wrap them and fire a DOM event the content script hears.
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
