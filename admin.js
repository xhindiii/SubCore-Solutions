const ADMIN_SESSION_KEY = "subcore_admin_session";
const SESSION_EXPIRY_KEY = "subcore_admin_session_expiry";
const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes

let adminData = null;
let adminServices = null;
let adminOrders = null;
let adminSettings = null;
let currentUser = null;

// Input validation and sanitization
const Validator = {
  sanitizeString(input) {
    if (typeof input !== 'string') return '';
    return input
      .trim()
      .replace(/[<>]/g, '') // Remove < and > to prevent XSS
      .replace(/javascript:/gi, '')
      .replace(/on\w+=/gi, '');
  },
  
  sanitizeEmail(input) {
    const email = this.sanitizeString(input);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) ? email : '';
  },
  
  sanitizeNumber(input, min = 0, max = Infinity) {
    const num = parseFloat(input);
    return isNaN(num) ? min : Math.max(min, Math.min(max, num));
  },
  
  sanitizeUrl(input) {
    const url = this.sanitizeString(input);
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol) ? url : '';
    } catch {
      return '';
    }
  },
  
  sanitizeSlug(input) {
    return this.sanitizeString(input)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
};

// Authentication
function isAdminLoggedIn() {
  const session = sessionStorage.getItem(ADMIN_SESSION_KEY);
  const expiry = sessionStorage.getItem(SESSION_EXPIRY_KEY);
  
  if (!session || !expiry) return null;
  
  // Check session expiration
  if (Date.now() > parseInt(expiry)) {
    adminLogout();
    return null;
  }
  
  try {
    return JSON.parse(session);
  } catch {
    return null;
  }
}

async function adminLogin(email, password) {
  if (typeof SupabaseClient === "undefined") {
    showError("Database connection not available");
    return false;
  }

  try {
    const result = await SupabaseClient.adminLogin(email, password);
    if (result.success) {
      const expiry = Date.now() + SESSION_DURATION;
      sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(result.user));
      sessionStorage.setItem(SESSION_EXPIRY_KEY, expiry.toString());
      currentUser = result.user;
      return true;
    }
    showError(result.error || "Invalid credentials");
    return false;
  } catch (error) {
    console.error("Login error:", error);
    showError("Login failed. Please try again.");
    return false;
  }
}

function adminLogout() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  sessionStorage.removeItem(SESSION_EXPIRY_KEY);
  currentUser = null;
}

function requireAuth() {
  if (!isAdminLoggedIn()) {
    adminLogout();
    window.location.reload();
    return false;
  }
  return true;
}

// Supabase helper to reduce duplication
async function safeSupabaseCall(fn, successMsg, errorMsg) {
  if (typeof SupabaseClient === "undefined") {
    showError("Database connection not available");
    return false;
  }
  try {
    await fn();
    if (successMsg) showSuccess(successMsg);
    return true;
  } catch (error) {
    console.error("Supabase error:", error);
    if (errorMsg) showError(errorMsg);
    return false;
  }
}

// Toast Notification System
const Toast = {
  container: null,
  
  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  
  show(type, title, message, duration = 5000) {
    this.init();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
      success: '✓',
      error: '✕',
      info: 'ℹ'
    };
    
    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button type="button" class="toast-close" aria-label="Close notification">×</button>
    `;
    
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.dismiss(toast));
    
    this.container.appendChild(toast);
    
    if (duration > 0) {
      setTimeout(() => this.dismiss(toast), duration);
    }
    
    return toast;
  },
  
  success(title, message, duration) {
    return this.show('success', title, message, duration);
  },
  
  error(title, message, duration) {
    return this.show('error', title, message, duration);
  },
  
  info(title, message, duration) {
    return this.show('info', title, message, duration);
  },
  
  dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    });
  }
};

// Error handling
function showError(message) {
  const errorEl = document.getElementById("admin-login-error");
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }
  Toast.error('Error', message);
}

function showSuccess(message) {
  Toast.success('Success', message);
}

function clearError() {
  const errorEl = document.getElementById("admin-login-error");
  if (errorEl) {
    errorEl.hidden = true;
  }
}

// Navigation
function showSection(sectionName) {
  document.querySelectorAll(".admin-nav").forEach(nav => {
    nav.classList.toggle("active", nav.dataset.section === sectionName);
  });
  document.querySelectorAll(".admin-section").forEach(section => {
    section.classList.toggle("active", section.id === `section-${sectionName}`);
  });
  document.getElementById("admin-page-title").textContent = sectionName.charAt(0).toUpperCase() + sectionName.slice(1);
}

// Initialize
async function initAdmin() {
  const loginScreen = document.getElementById("admin-login");
  const dashboardContainer = document.getElementById("admin-dashboard-container");
  const dashboardTemplate = document.getElementById("admin-dashboard-template");
  const user = isAdminLoggedIn();

  if (user) {
    // Inject dashboard from template
    currentUser = user;
    loginScreen.hidden = true;
    const dashboardClone = dashboardTemplate.content.cloneNode(true);
    dashboardContainer.appendChild(dashboardClone);
    document.getElementById("admin-user-name").textContent = user.full_name || "Admin";
    await loadAdminDashboard();
    bindDashboardEvents();
  } else {
    // Show only login screen
    document.getElementById("admin-login-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();
      const email = Validator.sanitizeEmail(document.getElementById("admin-email").value);
      const password = Validator.sanitizeString(document.getElementById("admin-password").value);
      
      if (!email || !password) {
        showError("Please enter both email and password");
        return;
      }
      
      if (await adminLogin(email, password)) {
        // Inject dashboard after successful login
        loginScreen.hidden = true;
        const dashboardClone = dashboardTemplate.content.cloneNode(true);
        dashboardContainer.appendChild(dashboardClone);
        document.getElementById("admin-user-name").textContent = currentUser?.full_name || "Admin";
        await loadAdminDashboard();
        bindDashboardEvents();
      }
    });
  }
}

// Bind dashboard events after injection
function bindDashboardEvents() {
  // Logout
  document.getElementById("admin-logout")?.addEventListener("click", () => {
    adminLogout();
    window.location.reload();
  });

  // Navigation
  document.querySelectorAll(".admin-nav").forEach(nav => {
    nav.addEventListener("click", () => {
      showSection(nav.dataset.section);
    });
  });

  // Language switcher
  document.querySelectorAll(".admin-header .lang-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.lang;
      localStorage.setItem("lang", lang);
      document.querySelectorAll(".admin-header .lang-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.lang === lang);
      });
    });
  });

  // Bind all admin forms
  bindAdminForms();
}

async function loadAdminDashboard() {
  await Promise.all([
    loadShopData(),
    loadServices(),
    loadOrders(),
    loadSettings()
  ]);
  updateDashboardStats();
  renderAdminProducts();
  renderAdminCategories();
  renderAdminServices();
  renderAdminOrders();
  renderContentForms();
  bindAdminForms();
}

async function loadShopData() {
  adminData = await ShopStore.load();
}

async function loadServices() {
  if (typeof SupabaseClient !== "undefined") {
    try {
      adminServices = await SupabaseClient.fetchServices();
    } catch {
      adminServices = [];
    }
  } else {
    adminServices = [];
  }
}

async function loadOrders() {
  if (typeof SupabaseClient !== "undefined") {
    try {
      adminOrders = await SupabaseClient.fetchOrders();
    } catch {
      adminOrders = [];
    }
  } else {
    adminOrders = [];
  }
}

async function loadSettings() {
  if (typeof SupabaseClient !== "undefined") {
    try {
      adminSettings = await SupabaseClient.fetchSettings();
    } catch {
      adminSettings = {};
    }
  } else {
    adminSettings = {};
  }
}

// Dashboard Statistics
function updateDashboardStats() {
  document.getElementById("stat-products").textContent = adminData?.products?.length || 0;
  document.getElementById("stat-orders").textContent = adminOrders?.length || 0;
  
  const totalRevenue = adminOrders?.reduce((sum, order) => sum + (order.total || 0), 0) || 0;
  document.getElementById("stat-revenue").textContent = ShopStore.formatPrice(totalRevenue);
  
  const activeServices = adminServices?.filter(s => s.available).length || 0;
  document.getElementById("stat-services").textContent = activeServices;

  // Recent orders
  const recentOrdersList = document.getElementById("recent-orders-list");
  if (recentOrdersList && adminOrders?.length > 0) {
    const recentOrders = adminOrders.slice(0, 5);
    recentOrdersList.innerHTML = recentOrders.map(order => `
      <div class="recent-order-item" style="padding: 0.75rem; border-bottom: 1px solid var(--color-border); display: flex; justify-content: space-between; align-items: center;">
        <div>
          <div style="font-weight: 500;">${order.customer_name}</div>
          <div style="font-size: 0.85rem; color: var(--color-text-muted);">${ShopStore.formatPrice(order.total)}</div>
        </div>
        <span class="status-pill ${order.status === 'completed' ? 'active' : 'inactive'}">${order.status}</span>
      </div>
    `).join("");
  } else if (recentOrdersList) {
    recentOrdersList.innerHTML = '<p style="color: var(--color-text-muted); text-align: center; padding: 2rem;">No orders yet</p>';
  }
}

// Products
function renderAdminProducts() {
  const tbody = document.getElementById("admin-products-body");
  if (!tbody) return;

  tbody.innerHTML = adminData.products.map((p) => {
    const cat = adminData.categories.find((c) => c.id === p.category);
    return `<tr>
      <td><img src="${p.image}" alt="" class="admin-thumb"></td>
      <td>${ShopStore.getLocalized(p, "en", "name")}</td>
      <td>${ShopStore.formatPrice(p.price, p.currency)}</td>
      <td>${cat ? ShopStore.getLocalized(cat, "en", "name") : p.category}</td>
      <td>${p.stock}</td>
      <td><span class="status-pill ${p.available ? "active" : "inactive"}">${p.available ? "Available" : "Unavailable"}</span></td>
      <td class="admin-actions">
        <button type="button" class="btn-sm" onclick="editProduct('${p.id}')">Edit</button>
        <button type="button" class="btn-sm btn-danger" onclick="deleteProduct('${p.id}')">Delete</button>
      </td>
    </tr>`;
  }).join("");
}

function renderAdminCategories() {
  const list = document.getElementById("admin-categories-list");
  if (!list) return;

  list.innerHTML = adminData.categories.map((c) =>
    `<div class="admin-category-item">
      <span>${ShopStore.getLocalized(c, "en", "name")} <code>${c.id}</code></span>
      <button type="button" class="btn-sm btn-danger" onclick="deleteCategory('${c.id}')">Delete</button>
    </div>`
  ).join("");

  const select = document.getElementById("product-category");
  if (select) {
    select.innerHTML = adminData.categories.map((c) =>
      `<option value="${c.id}">${ShopStore.getLocalized(c, "en", "name")}</option>`
    ).join("");
  }
}

// Services
function renderAdminServices() {
  const tbody = document.getElementById("admin-services-body");
  if (!tbody) return;

  tbody.innerHTML = adminServices.map((s) => {
    const name = ShopStore.getLocalized(s, "en", "name");
    return `<tr>
      <td><span style="font-size: 1.5rem;">${s.icon || '🔧'}</span></td>
      <td>${name}</td>
      <td>${ShopStore.formatPrice(s.price, s.currency)}</td>
      <td>${s.display_order || 0}</td>
      <td><span class="status-pill ${s.available ? "active" : "inactive"}">${s.available ? "Active" : "Inactive"}</span></td>
      <td class="admin-actions">
        <button type="button" class="btn-sm" onclick="editService('${s.id}')">Edit</button>
        <button type="button" class="btn-sm btn-danger" onclick="deleteService('${s.id}')">Delete</button>
      </td>
    </tr>`;
  }).join("");
}

function resetServiceForm() {
  document.getElementById("service-form").reset();
  document.getElementById("service-id-edit").value = "";
  document.getElementById("service-form-title").textContent = "Add Service";
}

function editService(id) {
  const s = adminServices.find((x) => x.id === id);
  if (!s) return;

  document.getElementById("service-id-edit").value = s.id;
  document.getElementById("service-id").value = s.id;
  document.getElementById("service-id").readOnly = true;
  document.getElementById("service-icon").value = s.icon || "";
  document.getElementById("service-display-order").value = s.display_order || 0;
  document.getElementById("service-price").value = s.price;
  document.getElementById("service-name-en").value = s.name.en || "";
  document.getElementById("service-name-sq").value = s.name.sq || "";
  document.getElementById("service-desc-en").value = s.description.en || "";
  document.getElementById("service-desc-sq").value = s.description.sq || "";
  document.getElementById("service-available").checked = s.available;
  document.getElementById("service-featured").checked = s.featured;
  document.getElementById("service-form-title").textContent = "Edit Service";
  document.getElementById("service-form").scrollIntoView({ behavior: "smooth" });
}

async function saveService(e) {
  e.preventDefault();
  if (!requireAuth()) return;
  
  const editId = document.getElementById("service-id-edit").value;
  const id = Validator.sanitizeSlug(document.getElementById("service-id").value);

  if (!id) {
    showError("Service ID is required");
    return;
  }

  const service = {
    id,
    name: {
      en: Validator.sanitizeString(document.getElementById("service-name-en").value),
      sq: Validator.sanitizeString(document.getElementById("service-name-sq").value)
    },
    description: {
      en: Validator.sanitizeString(document.getElementById("service-desc-en").value),
      sq: Validator.sanitizeString(document.getElementById("service-desc-sq").value)
    },
    price: Validator.sanitizeNumber(document.getElementById("service-price").value, 0),
    currency: "USD",
    icon: Validator.sanitizeString(document.getElementById("service-icon").value),
    display_order: Validator.sanitizeNumber(document.getElementById("service-display-order").value, 0),
    available: document.getElementById("service-available").checked,
    featured: document.getElementById("service-featured").checked
  };

  const success = await safeSupabaseCall(
    async () => {
      await SupabaseClient.upsertService(service);
      await loadServices();
      renderAdminServices();
    },
    "Service saved successfully",
    "Failed to save service to database"
  );

  if (success) {
    resetServiceForm();
    document.getElementById("service-id").readOnly = false;
  }
}

async function deleteService(id) {
  if (!requireAuth()) return;
  if (!confirm("Delete this service?")) return;
  
  await safeSupabaseCall(
    async () => {
      await SupabaseClient.deleteService(id);
      await loadServices();
      renderAdminServices();
    },
    "Service deleted successfully",
    "Failed to delete service from database"
  );
}

// Orders
function renderAdminOrders() {
  const tbody = document.getElementById("admin-orders-body");
  if (!tbody) return;

  tbody.innerHTML = adminOrders.map((order) => {
    const date = new Date(order.created_at).toLocaleDateString();
    return `<tr>
      <td>#${order.id}</td>
      <td>${order.customer_name}</td>
      <td>${order.customer_email}</td>
      <td>${ShopStore.formatPrice(order.total)}</td>
      <td>
        <select class="order-status-select" onchange="updateOrderStatus(${order.id}, this.value)">
          <option value="pending" ${order.status === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="processing" ${order.status === 'processing' ? 'selected' : ''}>Processing</option>
          <option value="completed" ${order.status === 'completed' ? 'selected' : ''}>Completed</option>
          <option value="cancelled" ${order.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
        </select>
      </td>
      <td>${date}</td>
      <td class="admin-actions">
        <button type="button" class="btn-sm" onclick="viewOrderDetails(${order.id})">View</button>
      </td>
    </tr>`;
  }).join("");
}

async function updateOrderStatus(id, status) {
  if (!requireAuth()) return;
  
  await safeSupabaseCall(
    async () => {
      await SupabaseClient.updateOrderStatus(id, status);
      await loadOrders();
      renderAdminOrders();
      updateDashboardStats();
    },
    "Order status updated successfully",
    "Failed to update order status"
  );
}

function viewOrderDetails(id) {
  const order = adminOrders.find(o => o.id === id);
  if (!order) return;

  const modal = document.getElementById("order-detail-modal");
  const content = document.getElementById("order-detail-content");

  const itemsHtml = order.items.map(item => {
    const product = adminData.products.find(p => p.id === item.id);
    const name = product ? ShopStore.getLocalized(product, "en", "name") : item.id;
    return `<div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--color-border);">
      <span>${name} × ${item.qty}</span>
      <span>${ShopStore.formatPrice((product?.price || 0) * item.qty)}</span>
    </div>`;
  }).join("");

  content.innerHTML = `
    <div style="margin-bottom: 1.5rem;">
      <h4 style="margin-bottom: 0.5rem;">Order #${order.id}</h4>
      <p style="color: var(--color-text-muted); font-size: 0.9rem;">${new Date(order.created_at).toLocaleString()}</p>
    </div>
    <div style="margin-bottom: 1.5rem;">
      <h4 style="margin-bottom: 0.5rem;">Customer Information</h4>
      <p><strong>Name:</strong> ${order.customer_name}</p>
      <p><strong>Email:</strong> ${order.customer_email}</p>
      <p><strong>Phone:</strong> ${order.customer_phone || 'N/A'}</p>
      <p><strong>Address:</strong> ${order.delivery_address || 'N/A'}</p>
    </div>
    <div style="margin-bottom: 1.5rem;">
      <h4 style="margin-bottom: 0.5rem;">Order Items</h4>
      ${itemsHtml}
      <div style="display: flex; justify-content: space-between; padding: 1rem 0; font-weight: 700; font-size: 1.1rem;">
        <span>Total</span>
        <span>${ShopStore.formatPrice(order.total)}</span>
      </div>
    </div>
    ${order.notes ? `<div style="margin-bottom: 1.5rem;"><h4 style="margin-bottom: 0.5rem;">Notes</h4><p>${order.notes}</p></div>` : ''}
  `;

  modal.hidden = false;
}

function closeOrderModal() {
  document.getElementById("order-detail-modal").hidden = true;
}

// Content Management
function renderContentForms() {
  if (!adminSettings) return;

  // Company info
  const companyInfo = adminSettings.company_info || {};
  document.getElementById("company-name").value = companyInfo.name || "";
  document.getElementById("company-tagline").value = companyInfo.tagline || "";
  document.getElementById("company-email").value = companyInfo.email || "";
  document.getElementById("company-secondary-email").value = companyInfo.secondary_email || "";
  document.getElementById("company-phone").value = companyInfo.phone || "";
  document.getElementById("company-whatsapp").value = companyInfo.whatsapp || "";

  // Hero content
  const heroContent = adminSettings.homepage_hero || {};
  document.getElementById("hero-title-en").value = heroContent.title_en || "";
  document.getElementById("hero-title-sq").value = heroContent.title_sq || "";
  document.getElementById("hero-subtitle-en").value = heroContent.subtitle_en || "";
  document.getElementById("hero-subtitle-sq").value = heroContent.subtitle_sq || "";
}

async function saveCompanyInfo(e) {
  e.preventDefault();
  if (!requireAuth()) return;
  
  const companyInfo = {
    name: Validator.sanitizeString(document.getElementById("company-name").value),
    tagline: Validator.sanitizeString(document.getElementById("company-tagline").value),
    email: Validator.sanitizeEmail(document.getElementById("company-email").value),
    secondary_email: Validator.sanitizeEmail(document.getElementById("company-secondary-email").value),
    phone: Validator.sanitizeString(document.getElementById("company-phone").value),
    whatsapp: Validator.sanitizeString(document.getElementById("company-whatsapp").value)
  };

  await safeSupabaseCall(
    async () => {
      await SupabaseClient.upsertSetting("company_info", companyInfo);
      await loadSettings();
    },
    "Company information saved successfully",
    "Failed to save company information"
  );
}

async function saveHeroContent(e) {
  e.preventDefault();
  if (!requireAuth()) return;
  
  const heroContent = {
    title_en: Validator.sanitizeString(document.getElementById("hero-title-en").value),
    title_sq: Validator.sanitizeString(document.getElementById("hero-title-sq").value),
    subtitle_en: Validator.sanitizeString(document.getElementById("hero-subtitle-en").value),
    subtitle_sq: Validator.sanitizeString(document.getElementById("hero-subtitle-sq").value)
  };

  await safeSupabaseCall(
    async () => {
      await SupabaseClient.upsertSetting("homepage_hero", heroContent);
      await loadSettings();
    },
    "Hero content saved successfully",
    "Failed to save hero content"
  );
}

// Forms
function bindAdminForms() {
  document.getElementById("product-form")?.addEventListener("submit", saveProduct);
  document.getElementById("category-form")?.addEventListener("submit", saveCategory);
  document.getElementById("service-form")?.addEventListener("submit", saveService);
  document.getElementById("product-image-file")?.addEventListener("change", handleImageUpload);
  document.getElementById("export-data")?.addEventListener("click", exportData);
  document.getElementById("import-data")?.addEventListener("click", () => {
    document.getElementById("import-file").click();
  });
  document.getElementById("import-file")?.addEventListener("change", importData);
  document.getElementById("change-password-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!requireAuth()) return;
    
    const pw = document.getElementById("new-password").value;
    if (pw.length < 6) {
      showError("Password must be at least 6 characters");
      return;
    }
    
    // Password change should be done via backend - for now, show message
    showSuccess("Password update requires backend implementation. Contact administrator.");
    document.getElementById("new-password").value = "";
  });
  document.getElementById("company-info-form")?.addEventListener("submit", saveCompanyInfo);
  document.getElementById("hero-content-form")?.addEventListener("submit", saveHeroContent);
}

function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 500000) {
    Toast.error('Upload Error', 'Image must be under 500KB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById("product-image").value = ev.target.result;
    document.getElementById("image-preview").src = ev.target.result;
    document.getElementById("image-preview").hidden = false;
  };
  reader.readAsDataURL(file);
}

function resetProductForm() {
  document.getElementById("product-form").reset();
  document.getElementById("product-id-edit").value = "";
  document.getElementById("product-form-title").textContent = "Add Product";
  document.getElementById("image-preview").hidden = true;
}

function editProduct(id) {
  const p = adminData.products.find((x) => x.id === id);
  if (!p) return;

  document.getElementById("product-id-edit").value = p.id;
  document.getElementById("product-id").value = p.id;
  document.getElementById("product-id").readOnly = true;
  document.getElementById("product-name-en").value = p.name.en || "";
  document.getElementById("product-name-sq").value = p.name.sq || "";
  document.getElementById("product-desc-en").value = p.description.en || "";
  document.getElementById("product-desc-sq").value = p.description.sq || "";
  document.getElementById("product-price").value = p.price;
  document.getElementById("product-stock").value = p.stock;
  document.getElementById("product-category").value = p.category;
  document.getElementById("product-image").value = p.image;
  document.getElementById("product-available").checked = p.available;
  document.getElementById("product-featured").checked = p.featured;
  document.getElementById("product-form-title").textContent = "Edit Product";
  document.getElementById("image-preview").src = p.image;
  document.getElementById("image-preview").hidden = false;
  document.getElementById("product-form").scrollIntoView({ behavior: "smooth" });
}

async function saveProduct(e) {
  e.preventDefault();
  if (!requireAuth()) return;
  
  const editId = document.getElementById("product-id-edit").value;
  const id = Validator.sanitizeSlug(document.getElementById("product-id").value);

  if (!id) {
    showError("Product ID is required");
    return;
  }

  const product = {
    id,
    name: {
      en: Validator.sanitizeString(document.getElementById("product-name-en").value),
      sq: Validator.sanitizeString(document.getElementById("product-name-sq").value)
    },
    description: {
      en: Validator.sanitizeString(document.getElementById("product-desc-en").value),
      sq: Validator.sanitizeString(document.getElementById("product-desc-sq").value)
    },
    price: Validator.sanitizeNumber(document.getElementById("product-price").value, 0),
    currency: "USD",
    category: Validator.sanitizeString(document.getElementById("product-category").value),
    image: Validator.sanitizeUrl(document.getElementById("product-image").value) || null,
    stock: Validator.sanitizeNumber(document.getElementById("product-stock").value, 0),
    available: document.getElementById("product-available").checked,
    featured: document.getElementById("product-featured").checked
  };

  if (editId) {
    const idx = adminData.products.findIndex((p) => p.id === editId);
    if (idx >= 0) adminData.products[idx] = product;
  } else {
    if (adminData.products.some((p) => p.id === id)) {
      showError("Product ID already exists");
      return;
    }
    adminData.products.push(product);
  }

  await ShopStore.save(adminData);
  showSuccess("Product saved successfully");
  resetProductForm();
  document.getElementById("product-id").readOnly = false;
  renderAdminProducts();
  updateDashboardStats();
}

async function deleteProduct(id) {
  if (!requireAuth()) return;
  if (!confirm("Delete this product?")) return;
  
  adminData.products = adminData.products.filter((p) => p.id !== id);
  await ShopStore.save(adminData);
  
  await safeSupabaseCall(
    async () => await SupabaseClient.deleteProduct(id),
    "Product deleted successfully",
    "Failed to delete product from database"
  );
  
  renderAdminProducts();
  updateDashboardStats();
}

async function saveCategory(e) {
  e.preventDefault();
  if (!requireAuth()) return;
  
  const id = Validator.sanitizeSlug(document.getElementById("category-id").value);
  if (!id) {
    showError("Category ID is required");
    return;
  }
  
  if (adminData.categories.some((c) => c.id === id)) {
    showError("Category ID already exists");
    return;
  }
  
  adminData.categories.push({
    id,
    slug: id,
    name: {
      en: Validator.sanitizeString(document.getElementById("category-name-en").value),
      sq: Validator.sanitizeString(document.getElementById("category-name-sq").value)
    }
  });
  await ShopStore.save(adminData);
  showSuccess("Category saved successfully");
  e.target.reset();
  renderAdminCategories();
}

async function deleteCategory(id) {
  if (!requireAuth()) return;
  if (adminData.products.some((p) => p.category === id)) {
    showError("Cannot delete category with existing products");
    return;
  }
  if (!confirm("Delete this category?")) return;
  adminData.categories = adminData.categories.filter((c) => c.id !== id);
  await ShopStore.save(adminData);
  
  await safeSupabaseCall(
    async () => await SupabaseClient.deleteCategory(id),
    "Category deleted successfully",
    "Failed to delete category from database"
  );
  
  renderAdminCategories();
}

function exportData() {
  const blob = new Blob([JSON.stringify(adminData, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "subcore-products.json";
  a.click();
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      adminData = JSON.parse(ev.target.result);
      ShopStore.save(adminData);
      renderAdminProducts();
      renderAdminCategories();
      updateDashboardStats();
      Toast.success('Import Complete', 'Data imported successfully.');
    } catch {
      Toast.error('Import Failed', 'Invalid JSON file.');
    }
  };
  reader.readAsText(file);
}

document.addEventListener("DOMContentLoaded", initAdmin);
