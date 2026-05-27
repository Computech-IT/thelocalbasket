document.addEventListener("DOMContentLoaded", () => {
  const isProfilePage = window.location.pathname.includes("profile.html");
  let customerSession = null;
  let wishlistItems = new Set();

  async function fetchSession() {
    try {
      const res = await fetch("/api/customer/session");
      const data = await res.json();
      customerSession = data.loggedIn ? data : null;
      if (customerSession) await fetchWishlist();
      
      if (isProfilePage) {
        renderProfileUI();
      } else {
        setupWishlistObserver();
        setupCheckoutProxy();
        setupSPACartLogic(); // NEW: Setup the SPA routing
      }
    } catch (e) {
      console.error("Session fetch failed", e);
      if (isProfilePage) renderProfileUI();
    }
  }

  // --- SPA Cart Logic ---
  function setupSPACartLogic() {
    const cartBtns = document.querySelectorAll(".spa-cart-btn");
    const homePage = document.getElementById("homePage");
    const cartPage = document.getElementById("cartPage");
    const loginOverlay = document.getElementById("loginOverlay");
    const closeLoginOverlay = document.getElementById("closeLoginOverlay");
    const backToShopBtn = document.getElementById("backToShopBtn");

    // Open Cart or Auth Overlay
    cartBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (!customerSession) {
          // Show in-place auth overlay
          renderAuthOverlayUI();
          loginOverlay.classList.remove("d-none");
        } else {
          // Open Cart Page
          openCartPage();
        }
      });
    });

    // Back button
    if (backToShopBtn) {
      backToShopBtn.addEventListener("click", () => {
        cartPage.classList.add("d-none");
        homePage.classList.remove("d-none");
      });
    }

    // Close Auth Overlay
    if (closeLoginOverlay) {
      closeLoginOverlay.addEventListener("click", () => {
        loginOverlay.classList.add("d-none");
      });
    }
  }

  function openCartPage() {
    const homePage = document.getElementById("homePage");
    const cartPage = document.getElementById("cartPage");
    homePage.classList.add("d-none");
    cartPage.classList.remove("d-none");
    window.scrollTo(0,0);
    fillShippingInfo();
  }

  function fillShippingInfo() {
    if (!customerSession) return;
    const emailField = document.querySelector(".shipping-email");
    const nameField = document.querySelector(".shipping-name");
    const phoneField = document.querySelector(".contact-number");
    
    if (emailField && !emailField.readOnly) {
      emailField.value = customerSession.email;
      emailField.readOnly = true;
    }
    if (nameField && !nameField.value) nameField.value = customerSession.full_name || "";
    if (phoneField && !phoneField.value) phoneField.value = customerSession.phone || "";
  }

  // Observe cartSummary for dynamic rewrites by obfuscated main.js
  const cartObserver = new MutationObserver(() => fillShippingInfo());
  window.addEventListener("DOMContentLoaded", () => {
    const summary = document.getElementById("cartSummary");
    if (summary) cartObserver.observe(summary, { childList: true, subtree: true });
  });

  function renderAuthOverlayUI() {
    const root = document.getElementById("loginOverlayRoot");
    root.innerHTML = `
      <div class="auth-card mx-auto bg-white p-5 rounded-4 shadow" style="max-width: 450px; width: 100%;">
        <h3 class="font-playfair text-center mb-4">Please Log In</h3>
        <p class="text-center text-muted mb-4">Log in to view your bag and securely checkout.</p>
        <form id="overlayLoginForm">
          <div class="mb-3">
            <label class="form-label">Email</label>
            <input type="email" class="form-control" id="overlayLoginEmail" required>
          </div>
          <div class="mb-4">
            <label class="form-label">Password</label>
            <input type="password" class="form-control" id="overlayLoginPass" required>
          </div>
          <button type="submit" class="btn btn-dark w-100 rounded-pill mb-3 py-2">Login</button>
          <div class="text-center">
            <a href="#" class="text-muted text-decoration-none" id="overlayShowRegister">Create an account</a>
          </div>
        </form>
      </div>
    `;
    document.getElementById("overlayLoginForm").onsubmit = async (e) => {
      e.preventDefault();
      await handleAuthRequest("/api/customer/login", {
        email: document.getElementById("overlayLoginEmail").value,
        password: document.getElementById("overlayLoginPass").value
      });
    };
    document.getElementById("overlayShowRegister").onclick = (e) => { e.preventDefault(); renderOverlayRegisterUI(); };
  }

  function renderOverlayRegisterUI() {
    const root = document.getElementById("loginOverlayRoot");
    root.innerHTML = `
      <div class="auth-card mx-auto bg-white p-5 rounded-4 shadow" style="max-width: 450px; width: 100%;">
        <h3 class="font-playfair text-center mb-4">Create Account</h3>
        <form id="overlayRegForm">
          <div class="mb-3">
            <label class="form-label">Full Name</label>
            <input type="text" class="form-control" id="overlayRegName" required>
          </div>
          <div class="mb-3">
            <label class="form-label">Email</label>
            <input type="email" class="form-control" id="overlayRegEmail" required>
          </div>
          <div class="mb-4">
            <label class="form-label">Password</label>
            <input type="password" class="form-control" id="overlayRegPass" required>
          </div>
          <button type="submit" class="btn btn-dark w-100 rounded-pill mb-3 py-2">Register</button>
          <div class="text-center">
            <a href="#" class="text-muted text-decoration-none" id="overlayShowLogin">Already have an account?</a>
          </div>
        </form>
      </div>
    `;
    document.getElementById("overlayRegForm").onsubmit = async (e) => {
      e.preventDefault();
      await handleAuthRequest("/api/customer/register", {
        email: document.getElementById("overlayRegEmail").value,
        password: document.getElementById("overlayRegPass").value,
        full_name: document.getElementById("overlayRegName").value,
        phone: ""
      });
    };
    document.getElementById("overlayShowLogin").onclick = (e) => { e.preventDefault(); renderAuthOverlayUI(); };
  }

  async function handleAuthRequest(endpoint, payload) {
    const res = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      // Auth successful! Update session without reloading page so cart isn't lost!
      await fetchSession();
      document.getElementById("loginOverlay").classList.add("d-none");
      openCartPage();
    } else {
      alert("Authentication failed. Please check your credentials.");
    }
  }

  function setupCheckoutProxy() {
    const fakeBtn = document.getElementById("fakeCheckoutBtn");
    const realBtn = document.getElementById("checkoutBtn");
    if (!fakeBtn || !realBtn) return;
    
    if (customerSession) {
      const emailField = document.querySelector(".shipping-email");
      const nameField = document.querySelector(".shipping-name");
      const phoneField = document.querySelector(".contact-number");
      
      if (emailField) {
        emailField.value = customerSession.email;
        emailField.readOnly = true; // Lock email to prevent spoofing
      }
      if (nameField) nameField.value = customerSession.full_name || "";
      if (phoneField) phoneField.value = customerSession.phone || "";
    }
    
    fakeBtn.addEventListener("click", () => {
      if (!customerSession) {
        const loginOverlay = document.getElementById("loginOverlay");
        if (loginOverlay) {
          renderAuthOverlayUI();
          loginOverlay.classList.remove("d-none");
        } else {
          window.location.href = "/profile.html";
        }
        return;
      }

      // Snapshot the order so the receipt shim can save it to localStorage
      // before main.js redirects to /thankyou.html
      try {
        window.__tlbLastOrder = {
          email: customerSession.email,
          shipping: {
            name:    document.querySelector(".shipping-name")?.value  || customerSession.full_name || "",
            email:   customerSession.email,
            phone:   document.querySelector(".contact-number")?.value || customerSession.phone    || "",
            address: document.querySelector(".shipping-address")?.value || "",
            pincode: document.querySelector(".shipping-pincode")?.value || "",
          },
          // Items & totals will be filled by main.js — we capture what we can here
          items: [],
          coupon: {},
          grandTotal: 0,
        };
      } catch (_) {}

      realBtn.click();
    });
  }

  async function fetchWishlist() {
    try {
      const res = await fetch("/api/customer/wishlist");
      const data = await res.json();
      wishlistItems = new Set(data.map(w => w.id));
    } catch(e) {}
  }

  // --- Profile Page UI ---
  function renderProfileUI() {
    const root = document.getElementById("appRoot");
    if (!root) return;

    if (!customerSession) {
      root.innerHTML = `
        <div class="auth-card mx-auto" style="max-width: 400px;">
          <h3 class="font-playfair text-center mb-4">Welcome Back</h3>
          <form id="loginForm">
            <div class="mb-3">
              <label class="form-label">Email</label>
              <input type="email" class="form-control" id="loginEmail" required>
            </div>
            <div class="mb-4">
              <label class="form-label">Password</label>
              <input type="password" class="form-control" id="loginPass" required>
            </div>
            <button type="submit" class="btn btn-dark w-100 rounded-pill mb-3 py-2">Login</button>
            <div class="text-center">
              <a href="#" class="text-muted text-decoration-none" id="showRegister" style="font-size: 0.9rem;">New here? Create an account</a>
            </div>
          </form>
        </div>
      `;
      document.getElementById("loginForm").onsubmit = handleLogin;
      document.getElementById("showRegister").onclick = (e) => { e.preventDefault(); renderRegisterUI(); };
    } else {
      renderDashboardUI();
    }
  }

  function renderRegisterUI() {
    const root = document.getElementById("appRoot");
    root.innerHTML = `
      <div class="auth-card mx-auto" style="max-width: 400px;">
        <h3 class="font-playfair text-center mb-4">Create Account</h3>
        <form id="registerForm">
          <div class="mb-3">
            <label class="form-label">Full Name</label>
            <input type="text" class="form-control" id="regName" required>
          </div>
          <div class="mb-3">
            <label class="form-label">Email</label>
            <input type="email" class="form-control" id="regEmail" required>
          </div>
          <div class="mb-4">
            <label class="form-label">Password</label>
            <input type="password" class="form-control" id="regPass" required>
          </div>
          <button type="submit" class="btn btn-dark w-100 rounded-pill mb-3 py-2">Register</button>
          <div class="text-center">
            <a href="#" class="text-muted text-decoration-none" id="showLogin" style="font-size: 0.9rem;">Already have an account? Login</a>
          </div>
        </form>
      </div>
    `;
    document.getElementById("registerForm").onsubmit = handleRegister;
    document.getElementById("showLogin").onclick = (e) => { e.preventDefault(); renderProfileUI(); };
  }

  function renderDashboardUI() {
    const root = document.getElementById("appRoot");
    root.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-4">
        <h2 class="font-playfair mb-0">My Account</h2>
        <button class="btn btn-outline-danger btn-sm rounded-pill px-4" id="dashboardLogoutBtn">Logout</button>
      </div>
      <p class="text-muted mb-4">Logged in as <strong>${customerSession.email}</strong></p>
      
      <ul class="nav nav-tabs mb-4" id="profileTabs">
        <li class="nav-item">
          <button class="nav-link active px-4" data-bs-toggle="tab" data-bs-target="#orders">Order History</button>
        </li>
        <li class="nav-item">
          <button class="nav-link px-4" data-bs-toggle="tab" data-bs-target="#wishlist" id="dashboardWishlistBtn">My Wishlist</button>
        </li>
      </ul>
      
      <div class="tab-content">
        <div class="tab-pane fade show active" id="orders">
          <div id="ordersList" class="text-center py-5"><div class="spinner-border text-muted"></div></div>
        </div>
        <div class="tab-pane fade" id="wishlist">
          <div id="wishlistGrid" class="text-center py-5"><div class="spinner-border text-muted"></div></div>
        </div>
      </div>
    `;
    
    document.getElementById("dashboardLogoutBtn").addEventListener("click", logoutCustomer);
    document.getElementById("dashboardWishlistBtn").addEventListener("click", loadWishlistTab);
    
    loadOrders();
  }

  async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const password = document.getElementById("loginPass").value;
    const res = await fetch("/api/customer/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    if (res.ok) {
      window.location.reload();
    } else {
      alert("Invalid credentials. Please try again.");
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    const email = document.getElementById("regEmail").value;
    const password = document.getElementById("regPass").value;
    const full_name = document.getElementById("regName").value;
    const res = await fetch("/api/customer/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name, phone: "" })
    });
    if (res.ok) {
      window.location.reload();
    } else {
      alert("Registration failed. Email might already exist.");
    }
  }

  window.logoutCustomer = async () => {
    await fetch("/api/customer/logout", { method: "POST" });
    window.location.reload();
  };

  async function loadOrders() {
    const res = await fetch("/api/customer/orders");
    const orders = await res.json();
    const container = document.getElementById("ordersList");
    if (!orders || orders.error || !orders.length) {
      container.innerHTML = `<div class="text-center py-5"><i class="bi bi-box-seam display-4 text-muted mb-3 d-block"></i><p class="text-muted">You have no past orders yet.</p></div>`;
      return;
    }

    // Group rows by payment_id so each checkout is one card
    const grouped = {};
    for (const o of orders) {
      const pid = o.payment_id || ('row-' + o.id);
      if (!grouped[pid]) {
        grouped[pid] = { payment_id: pid, items: [], date: o.sale_date, total: 0 };
      }
      grouped[pid].items.push(o);
      grouped[pid].total += Number(o.total_price || 0);
    }

    container.innerHTML = Object.values(grouped).map(g => {
      const previewImg = g.items[0]?.product_image || '/images/logo.PNG';
      const previewName = g.items[0]?.product_name || 'Order';
      const extra = g.items.length > 1 ? ` + ${g.items.length - 1} more` : '';
      const shortId = g.payment_id.replace(/^DEV-/, '').slice(-8).toUpperCase();
      const receiptLink = '/thankyou.html?pid=' + encodeURIComponent(g.payment_id);
      return `
        <div class="order-card border rounded-4 p-3 mb-3 bg-white shadow-sm">
          <div class="d-flex align-items-center gap-3">
            <img src="${previewImg}" style="width:72px;height:72px;object-fit:cover;border-radius:12px;flex-shrink:0;" onerror="this.src='/images/logo.PNG'">
            <div class="flex-grow-1 min-width-0">
              <h6 class="mb-1 fw-semibold text-truncate">${previewName}${extra}</h6>
              <div class="text-muted" style="font-size:0.82rem;"><i class="bi bi-calendar3 me-1"></i>${new Date(g.date).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}</div>
              <div class="mt-1">
                <span class="badge bg-success-subtle text-success me-2 rounded-pill">Paid</span>
                <span class="fw-bold text-dark">₹${Number(g.total).toFixed(2)}</span>
              </div>
              <div class="text-muted mt-1" style="font-size:0.75rem; font-family: monospace;">#TLB-${shortId}</div>
            </div>
            <a href="${receiptLink}" target="_blank" class="btn btn-sm btn-outline-dark rounded-pill flex-shrink-0" style="white-space:nowrap;">
              <i class="bi bi-receipt me-1"></i>Receipt
            </a>
          </div>
        </div>`;
    }).join('');
  }

  window.loadWishlistTab = async () => {
    const res = await fetch("/api/customer/wishlist");
    const items = await res.json();
    const container = document.getElementById("wishlistGrid");
    if (!items.length) {
      container.innerHTML = `<div class="text-center py-5 w-100"><i class="bi bi-heart display-4 text-muted mb-3 d-block"></i><p class="text-muted">Your wishlist is empty.</p></div>`;
      container.className = "";
      return;
    }
    container.className = "wishlist-grid";
    container.innerHTML = items.map(p => `
      <div class="product-card position-relative">
        <div class="product-img-wrapper" style="height: 180px; overflow: hidden; border-radius: var(--radius-md) var(--radius-md) 0 0;">
          <img src="${p.image || '/img/placeholder.png'}" class="product-img w-100 h-100" style="object-fit: cover;" alt="${p.name}">
          <button class="btn btn-light rounded-circle shadow-sm position-absolute top-0 end-0 m-2 text-danger remove-wishlist-btn" data-id="${p.id}" style="z-index: 10;">
            <i class="bi bi-heart-fill"></i>
          </button>
        </div>
        <div class="product-body p-3 text-center">
          <h6 class="product-title mb-2 text-truncate">${p.name}</h6>
          <p class="product-price mb-0">₹${p.price}</p>
        </div>
      </div>
    `).join("");
    
    container.querySelectorAll('.remove-wishlist-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleWishlist(btn.dataset.id, btn);
      });
    });
  };

  // --- Main Shop Page Wishlist Injection ---
  function setupWishlistObserver() {
    const grid = document.getElementById("productsGrid");
    if (!grid) return;
    
    // Inject heart into already rendered cards
    injectHearts(grid.querySelectorAll(".product-card"));

    // Watch for newly rendered cards (e.g. after filter)
    const observer = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.nodeType === 1 && node.classList.contains("product-card")) {
            injectHearts([node]);
          } else if (node.nodeType === 1 && node.querySelectorAll) {
            injectHearts(node.querySelectorAll(".product-card"));
          }
        });
      });
    });
    observer.observe(grid, { childList: true, subtree: true });
  }

  function injectHearts(cards) {
    cards.forEach(card => {
      // Avoid duplicate injections
      if (card.querySelector('.wishlist-btn-injected')) return;
      
      const imgWrapper = card.querySelector('.product-img-wrapper');
      if (!imgWrapper) return;
      
      const productId = parseInt(card.dataset.id);
      if (!productId || isNaN(productId)) return;

      const isWished = wishlistItems.has(productId);
      
      const btn = document.createElement("button");
      btn.className = "wishlist-btn-injected btn btn-light btn-sm rounded-circle shadow-sm position-absolute top-0 end-0 m-2";
      btn.style.zIndex = "10";
      btn.style.width = "32px";
      btn.style.height = "32px";
      btn.style.display = "flex";
      btn.style.alignItems = "center";
      btn.style.justifyContent = "center";
      btn.innerHTML = `<i class="bi bi-heart${isWished ? '-fill text-danger' : ''}"></i>`;
      btn.onclick = (e) => {
        e.stopPropagation();
        toggleWishlist(productId, btn);
      };
      
      imgWrapper.appendChild(btn);
    });
  }

  window.toggleWishlist = async (productId, btnEl) => {
    if (!customerSession) {
      window.location.href = "/profile.html";
      return;
    }
    try {
      const res = await fetch("/api/customer/wishlist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId })
      });
      const data = await res.json();
      if (data.success) {
        if (data.action === "added") {
          wishlistItems.add(productId);
          btnEl.innerHTML = '<i class="bi bi-heart-fill text-danger"></i>';
        } else {
          wishlistItems.delete(productId);
          btnEl.innerHTML = '<i class="bi bi-heart"></i>';
          if (isProfilePage) loadWishlistTab();
        }
      }
    } catch(e) {
      console.error(e);
    }
  };

  fetchSession();
});
