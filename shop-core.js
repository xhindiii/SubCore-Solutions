/* Shared storefront helpers: language, formatting, catalogue loading, cart, product card.
   Loaded on every page (before scripts.js). */
const SHOP_STORAGE_KEY = "subcore_shop_data";
const CART_STORAGE_KEY = "subcore_cart";
const CATALOG_CACHE_KEY = "subcore_catalog_v2";
const CATALOG_TTL_MS = 2 * 60 * 1000;
const WHATSAPP_NUMBER = "355686661686";
const LOW_STOCK_LIMIT = 5;

/* Escapes text interpolated into innerHTML. Product, category and service text comes from the
   database, so it must never be inserted unescaped. */
function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function getShopLang() {
  return localStorage.getItem("lang") === "en" ? "en" : "sq";
}

/* Translate a key and replace {placeholders}. */
function tr(key, vars) {
  const lang = getShopLang();
  let s = (typeof translations !== "undefined" && (translations[lang]?.[key] ?? translations.en?.[key])) || key;
  if (vars) Object.keys(vars).forEach((k) => { s = s.split("{" + k + "}").join(vars[k]); });
  return s;
}
const tShop = tr; // legacy alias

/* Pick the current-language string from {en, sq} (or return a plain string). */
function loc(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return value[getShopLang()] || value.en || value.sq || "";
  return String(value);
}

const ShopStore = {
  data: null,
  _promise: null,

  /* Loads categories, products and shop settings. Order of preference:
     1. in-memory / short session cache  2. live database  3. last good copy  4. products.json */
  load(force = false) {
    if (!force && this._promise) return this._promise;
    this._promise = this._load(force);
    return this._promise;
  },

  async _load(force) {
    if (!force) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(CATALOG_CACHE_KEY) || "null");
        if (cached && Date.now() - cached.t < CATALOG_TTL_MS) { this.data = cached.d; return cached.d; }
      } catch { /* ignore */ }
    }

    if (typeof SupabaseClient !== "undefined" && SupabaseClient.raw) {
      try {
        const [catalog, settings] = await Promise.all([
          SupabaseClient.fetchCatalog(),
          SupabaseClient.fetchSettings().catch(() => ({}))
        ]);
        const data = {
          source: "live",
          categories: catalog.categories,
          products: catalog.products.filter((p) => p.available),
          settings: settings.shop_settings || {}
        };
        this._remember(data);
        return data;
      } catch (err) {
        console.warn("Live catalogue unavailable:", err.message);
      }
    }

    // Offline / not reachable: last good copy, then the bundled products.json
    try {
      const stale = JSON.parse(localStorage.getItem(SHOP_STORAGE_KEY) || "null");
      if (stale && stale.products) { stale.source = "cache"; this.data = stale; return stale; }
    } catch { /* ignore */ }
    try {
      const res = await fetch("products.json");
      if (res.ok) {
        const json = await res.json();
        const data = { source: "static", categories: json.categories || [], products: (json.products || []).map(normalizeStaticProduct), settings: {} };
        this.data = data;
        return data;
      }
    } catch { /* ignore */ }
    this._promise = null;
    throw new Error("Catalogue unavailable");
  },

  _remember(data) {
    this.data = data;
    try { sessionStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ t: Date.now(), d: data })); } catch { /* quota */ }
    try { localStorage.setItem(SHOP_STORAGE_KEY, JSON.stringify(data)); } catch { /* quota */ }
  },

  getProducts(data) { return (data || this.data)?.products || []; },
  getCategories(data) { return (data || this.data)?.categories || []; },
  getProductById(data, id) { return this.getProducts(data).find((p) => p.id === id); },
  getLocalized(obj, lang, field) {
    const v = obj ? obj[field] : null;
    if (v && typeof v === "object") return v[lang] || v.en || v.sq || "";
    return v || "";
  },

  formatPrice(price, currency) {
    const cur = currency || "USD";
    try {
      return new Intl.NumberFormat(getShopLang() === "sq" ? "sq-AL" : "en-US", {
        style: "currency", currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 2
      }).format(price);
    } catch {
      return cur + " " + Number(price).toFixed(2);
    }
  }
};

function normalizeStaticProduct(p) {
  return Object.assign({ brand: "", sku: "", compare_price: null, specs: [], images: p.image ? [p.image] : [], created_at: null }, p);
}

function money(amount, currency) { return ShopStore.formatPrice(amount, currency); }

/* ── Product helpers ───────────────────────────────────────────────── */
function productImage(p) { return (p.images && p.images[0]) || p.image || ""; }
function productName(p) { return loc(p.name); }
function isInStock(p) { return p.available !== false && p.stock > 0; }
function discountPercent(p) {
  return p.compare_price && p.compare_price > p.price ? Math.round((1 - p.price / p.compare_price) * 100) : 0;
}
function isNewProduct(p) {
  return !!p.created_at && Date.now() - new Date(p.created_at).getTime() < 21 * 86400000;
}
function productUrl(p) { return "product.html?id=" + encodeURIComponent(p.id); }

function stockStatus(p) {
  if (!isInStock(p)) return { key: "out", label: tr("shop.outOfStock") };
  if (p.stock <= LOW_STOCK_LIMIT) return { key: "low", label: tr("shop.lowStockLeft", { n: p.stock }) };
  return { key: "in", label: tr("shop.inStock") };
}

function placeholderBox() {
  return '<span class="no-image"><svg class="icon" aria-hidden="true"><use href="icons.svg#image"/></svg></span>';
}

function renderProductCard(p) {
  const name = escapeHtml(productName(p));
  const img = productImage(p);
  const pct = discountPercent(p);
  const status = stockStatus(p);
  const badges = [];
  if (pct) badges.push('<span class="badge badge-sale">-' + pct + '%</span>');
  else if (isNewProduct(p)) badges.push('<span class="badge badge-new">' + escapeHtml(tr("shop.new")) + "</span>");
  if (status.key === "low") badges.push('<span class="badge badge-low">' + escapeHtml(status.label) + "</span>");
  if (status.key === "out") badges.push('<span class="badge badge-out">' + escapeHtml(status.label) + "</span>");
  const old = pct ? '<span class="price-old">' + money(p.compare_price, p.currency) + "</span>" : "";
  const button = isInStock(p)
    ? '<button type="button" class="button button-sm" data-add-cart="' + escapeHtml(p.id) + '">' + escapeHtml(tr("shop.add")) + "</button>"
    : '<button type="button" class="button button-sm button-outline" disabled>' + escapeHtml(tr("shop.outOfStock")) + "</button>";
  return '<article class="product-card">' +
    '<a class="product-media" href="' + productUrl(p) + '" aria-label="' + name + '">' +
      (img ? '<img src="' + escapeHtml(img) + '" alt="' + name + '" loading="lazy" width="300" height="300" data-fallback>' : placeholderBox()) +
      '<span class="badges">' + badges.join("") + "</span></a>" +
    '<div class="product-body">' +
      (p.brand ? '<span class="product-brand">' + escapeHtml(p.brand) + "</span>" : "") +
      '<h3 class="product-name"><a href="' + productUrl(p) + '">' + name + "</a></h3>" +
      '<div class="price-row"><span class="price' + (pct ? " price-sale" : "") + '">' + money(p.price, p.currency) + "</span>" + old + "</div>" +
      button +
    "</div></article>";
}

/* Swap a broken image for the neutral placeholder. */
document.addEventListener("error", (e) => {
  const el = e.target;
  if (el && el.tagName === "IMG" && el.hasAttribute("data-fallback")) {
    el.removeAttribute("data-fallback");
    const holder = document.createElement("span");
    holder.innerHTML = placeholderBox();
    el.replaceWith(holder.firstChild);
  }
}, true);

/* Delegated "add to cart" buttons rendered by renderProductCard(). */
function bindAddToCart(root, products) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add-cart]");
    if (!btn) return;
    const product = products().find((p) => p.id === btn.dataset.addCart);
    if (!product || !isInStock(product)) return;
    const added = Cart.add(product.id, 1, product.stock);
    if (added === 0) {
      Toast.info(productName(product), tr("cart.onlyLeft", { n: product.stock }));
    } else {
      Toast.success(tr("shop.addedNamed", { name: productName(product) }), "", 3500, { href: "cart.html", label: tr("shop.viewCart") });
    }
  });
}

/* ── Cart ───────────────────────────────────────────────────────────── */
const Cart = {
  get() {
    try {
      const items = JSON.parse(localStorage.getItem(CART_STORAGE_KEY));
      return Array.isArray(items) ? items.filter((i) => i && i.id && i.qty > 0) : [];
    } catch { return []; }
  },
  save(items) {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    this.updateBadge();
    document.dispatchEvent(new CustomEvent("cartchange"));
  },
  /* Adds up to `max` in total. Returns how many were actually added. */
  add(productId, qty = 1, max = Infinity) {
    const items = this.get();
    const existing = items.find((i) => i.id === productId);
    const current = existing ? existing.qty : 0;
    const allowed = Math.max(0, Math.min(qty, max - current));
    if (allowed === 0) return 0;
    if (existing) existing.qty += allowed; else items.push({ id: productId, qty: allowed });
    this.save(items);
    return allowed;
  },
  update(productId, qty) {
    let items = this.get();
    if (qty <= 0) items = items.filter((i) => i.id !== productId);
    else { const it = items.find((i) => i.id === productId); if (it) it.qty = qty; }
    this.save(items);
  },
  remove(productId) { this.save(this.get().filter((i) => i.id !== productId)); },
  clear() { this.save([]); },
  count() { return this.get().reduce((n, i) => n + i.qty, 0); },
  updateBadge() {
    const n = this.count();
    document.querySelectorAll(".cart-count").forEach((el) => {
      el.textContent = n > 99 ? "99+" : n;
      el.classList.toggle("visible", n > 0);
    });
  }
};

/* Cart lines joined with live product data. Drops unknown/hidden products and clamps quantities
   to current stock; returns what changed so the UI can tell the customer. */
function resolveCart(data) {
  const lines = [];
  const notes = { removed: [], adjusted: [] };
  let items = Cart.get();
  let changed = false;
  items = items.filter((it) => {
    const product = ShopStore.getProductById(data, it.id);
    if (!product || !isInStock(product)) { notes.removed.push(it.id); changed = true; return false; }
    if (it.qty > product.stock) { it.qty = product.stock; notes.adjusted.push(product); changed = true; }
    lines.push({ product, qty: it.qty, subtotal: product.price * it.qty });
    return true;
  });
  if (changed) Cart.save(items);
  return { lines, notes };
}

/* Subtotal, delivery and total from shop settings (website_settings.shop_settings). */
function cartTotals(lines, settings) {
  const subtotal = lines.reduce((n, l) => n + l.subtotal, 0);
  const currency = lines[0]?.product.currency || "USD";
  const fee = settings && settings.shipping_fee !== null && settings.shipping_fee !== undefined && settings.shipping_fee !== "" ? Number(settings.shipping_fee) : null;
  const freeOver = settings && settings.free_shipping_over ? Number(settings.free_shipping_over) : null;
  let shipping = null, shippingKnown = false;
  if (fee !== null && !Number.isNaN(fee)) {
    shippingKnown = true;
    shipping = freeOver && subtotal >= freeOver ? 0 : fee;
  }
  return { subtotal, shipping, shippingKnown, total: subtotal + (shipping || 0), currency, freeOver };
}

function whatsappLink(text) {
  return "https://wa.me/" + WHATSAPP_NUMBER + (text ? "?text=" + encodeURIComponent(text) : "");
}

document.addEventListener("DOMContentLoaded", () => Cart.updateBadge());
window.addEventListener("storage", (e) => { if (e.key === CART_STORAGE_KEY) Cart.updateBadge(); });
