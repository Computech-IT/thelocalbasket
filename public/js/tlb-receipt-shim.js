/**
 * tlb-receipt-shim.js
 * Intercepts the redirect to /thankyou.html?pid=... made by main.js
 * and saves the current order snapshot to localStorage BEFORE the page
 * navigates, so the receipt page can render instantly even if the webhook
 * hasn't finished writing to the DB yet.
 *
 * This works by overriding the `location.href` setter.
 * It is completely non-destructive: if anything fails, the redirect still happens.
 */
(function () {
  "use strict";

  // We hook into window.__tlbCart which main.js updates via cartObserver
  // and grab the last known snapshot when a redirect to /thankyou.html happens.
  function saveReceiptSnapshot(pid) {
    try {
      // Read the live cart snapshot that customer.js maintains on window
      const snapshot = window.__tlbLastOrder || {};
      localStorage.setItem("tlb_receipt_" + pid, JSON.stringify({
        date: new Date().toISOString(),
        grand_total: snapshot.grandTotal || 0,
        customer_email: snapshot.email || "",
        shipping: snapshot.shipping || {},
        items: snapshot.items || [],
        coupon: snapshot.coupon || {},
      }));
      console.log("📦 [TLB] Receipt snapshot saved to localStorage for pid:", pid);
    } catch (e) {
      console.warn("📦 [TLB] Could not save receipt snapshot:", e);
    }
  }

  // Override location.href assignment to intercept the redirect
  const origDescriptor = Object.getOwnPropertyDescriptor(window.Location.prototype, "href");
  if (origDescriptor && origDescriptor.set) {
    Object.defineProperty(window.location, "href", {
      configurable: true,
      get: origDescriptor.get,
      set: function (url) {
        try {
          const match = String(url).match(/\/thankyou\.html\?pid=([^&]+)/);
          if (match) {
            const pid = decodeURIComponent(match[1]);
            saveReceiptSnapshot(pid);
          }
        } catch (_) {}
        origDescriptor.set.call(this, url);
      },
    });
  }
})();
