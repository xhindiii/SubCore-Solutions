const SHOP_STORAGE_KEY = "subcore_shop_data";
const CART_STORAGE_KEY = "subcore_cart";

const ShopStore = {
  async load() {
    if (typeof SupabaseClient !== "undefined") {
      try {
        const available = await SupabaseClient.isAvailable();
        if (available) {
          const data = await SupabaseClient.fetchCatalog();
          if (data.products?.length) {
            localStorage.setItem(SHOP_STORAGE_KEY, JSON.stringify(data));
            return data;
          }
        }
      } catch { /* fall through to local */ }
    }

    const cached = localStorage.getItem(SHOP_STORAGE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        localStorage.removeItem(SHOP_STORAGE_KEY);
      }
    }
    try {
      const res = await fetch("data/products.json");
      if (!res.ok) throw new Error("Failed to load products");
      const data = await res.json();
      localStorage.setItem(SHOP_STORAGE_KEY, JSON.stringify(data));
      return data;
    } catch {
      return { categories: [], products: [] };
    }
  },

  save(data) {
    localStorage.setItem(SHOP_STORAGE_KEY, JSON.stringify(data));
    if (typeof SupabaseClient !== "undefined") {
      data.categories?.forEach((c) => SupabaseClient.upsertCategory(c).catch(() => {}));
      data.products?.forEach((p) => SupabaseClient.upsertProduct(p).catch(() => {}));
    }
  },

  getProducts(data) {
    return data?.products || [];
  },

  getCategories(data) {
    return data?.categories || [];
  },

  getProductById(data, id) {
    return this.getProducts(data).find((p) => p.id === id);
  },

  getLocalized(obj, lang, field) {
    if (!obj) return "";
    const val = obj[field];
    if (typeof val === "object" && val !== null) {
      return val[lang] || val.en || val.sq || "";
    }
    return val || "";
  },

  formatPrice(price, currency = "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(price);
  }
};

const Cart = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(CART_STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  },

  save(items) {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    this.updateBadge();
  },

  add(productId, qty = 1) {
    const items = this.get();
    const existing = items.find((i) => i.id === productId);
    if (existing) {
      existing.qty += qty;
    } else {
      items.push({ id: productId, qty });
    }
    this.save(items);
  },

  update(productId, qty) {
    let items = this.get();
    if (qty <= 0) {
      items = items.filter((i) => i.id !== productId);
    } else {
      const item = items.find((i) => i.id === productId);
      if (item) item.qty = qty;
    }
    this.save(items);
  },

  remove(productId) {
    this.save(this.get().filter((i) => i.id !== productId));
  },

  clear() {
    localStorage.removeItem(CART_STORAGE_KEY);
    this.updateBadge();
  },

  count() {
    return this.get().reduce((sum, i) => sum + i.qty, 0);
  },

  updateBadge() {
    const count = this.count();
    document.querySelectorAll(".cart-count").forEach((el) => {
      el.textContent = count;
      el.classList.toggle("visible", count > 0);
    });
  }
};

function getShopLang() {
  return localStorage.getItem("lang") || "sq";
}

function tShop(key) {
  const lang = getShopLang();
  const t = translations[lang];
  return t?.[key] || translations.en?.[key] || key;
}

function renderStockBadge(product, lang) {
  if (!product.available) {
    return `<span class="stock-badge out-of-stock">${tShop("shop.outOfStock")}</span>`;
  }
  if (product.stock <= 0) {
    return `<span class="stock-badge out-of-stock">${tShop("shop.outOfStock")}</span>`;
  }
  if (product.stock <= 5) {
    return `<span class="stock-badge low-stock">${tShop("shop.lowStock")} (${product.stock})</span>`;
  }
  return `<span class="stock-badge in-stock">${tShop("shop.inStock")}</span>`;
}

document.addEventListener("DOMContentLoaded", () => {
  Cart.updateBadge();
});
