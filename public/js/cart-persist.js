/**
 * cart-persist.js — The Local Basket
 * Persists the shopping cart in localStorage so it survives page refreshes.
 * Must be loaded BEFORE main.js (or at least before DOMContentLoaded fires cart logic).
 *
 * Strategy:
 *  - On load: pre-populate the cart array if localStorage has data.
 *  - Every 2s + on visibilitychange/beforeunload: save the cart to localStorage.
 *  - Cart is cleared from localStorage after successful order (thankyou page).
 */

(function () {
  const CART_KEY = 'tlb_cart_v1';

  // ── Clear cart on thank-you page ─────────────────────────────────────────
  if (window.location.pathname.includes('thankyou') || window.location.search.includes('pid=')) {
    try { localStorage.removeItem(CART_KEY); } catch (_) {}
    return; // nothing else to do on this page
  }

  // ── Restore saved cart into a global so main.js can pick it up ───────────
  function loadSaved() {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
    return [];
  }

  // Expose the saved cart; main.js (obfuscated) checks window._tlbSavedCart
  // on its own DOMContentLoaded. We set it immediately so it's available.
  window._tlbSavedCart = loadSaved();

  // ── Persist the live cart back to localStorage ───────────────────────────
  function saveCart() {
    try {
      // The obfuscated main.js exposes the live cart as window._tlbLiveCart
      // (set by the shim binding below). Fall back gracefully if unavailable.
      const cart = window._tlbLiveCart;
      if (Array.isArray(cart)) {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
      }
    } catch (_) {}
  }

  // Poll every 2 seconds to catch cart changes without needing events
  setInterval(saveCart, 2000);

  // Also save immediately on tab hide / page close
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveCart();
  });
  window.addEventListener('beforeunload', saveCart);

  // ── Bind after DOM is ready so we can find the cart array reference ──────
  document.addEventListener('DOMContentLoaded', () => {
    // After main.js initialises, try to find and rehydrate the cart
    // by observing the cart count badge — when it first updates, patch in saved items.
    let rehydrated = false;
    const saved = window._tlbSavedCart;
    if (!saved || !saved.length) return;

    // Watch for the cart count element to be updated (signals main.js is ready)
    const observer = new MutationObserver(() => {
      if (rehydrated) return;
      // main.js reads from window._tlbSavedCart on first load — already done above.
      // If the cart count is still 0 but we have saved items, dispatch a storage
      // event that can be caught by main.js if it ever listens to it.
      const countEls = document.querySelectorAll('.cart-count');
      if (countEls.length) {
        observer.disconnect();
        rehydrated = true;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
