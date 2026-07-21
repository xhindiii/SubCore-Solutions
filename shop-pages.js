let shopData = null;
let activeCategory = "all";
let searchQuery = "";
let isLoading = false;
let loadError = null;

function isProductAvailable(product) {
  return product.available && product.stock > 0;
}

function filterProducts(products) {
  const lang = getShopLang();
  const q = searchQuery.toLowerCase();
  return products.filter((p) => {
    const name = ShopStore.getLocalized(p, lang, "name").toLowerCase();
    const desc = ShopStore.getLocalized(p, lang, "description").toLowerCase();
    const matchesSearch = !q || name.includes(q) || desc.includes(q);
    const matchesCategory = activeCategory === "all" || p.category === activeCategory;
    return matchesSearch && matchesCategory;
  });
}

function showLoading() {
  const grid = document.getElementById("product-grid");
  const empty = document.getElementById("shop-empty");
  const loading = document.getElementById("shop-loading");
  
  if (grid) grid.innerHTML = "";
  if (empty) empty.hidden = true;
  
  if (!loading) {
    const loadingEl = document.createElement("div");
    loadingEl.id = "shop-loading";
    loadingEl.className = "loading-state";
    loadingEl.innerHTML = `
      <div class="loading-spinner"></div>
      <p data-i18n="shop.loading">Loading products...</p>
    `;
    document.querySelector(".section")?.appendChild(loadingEl);
  } else {
    loading.hidden = false;
  }
}

function hideLoading() {
  const loading = document.getElementById("shop-loading");
  if (loading) loading.hidden = true;
}

function showError(message) {
  const grid = document.getElementById("product-grid");
  const empty = document.getElementById("shop-empty");
  const error = document.getElementById("shop-error");
  
  if (grid) grid.innerHTML = "";
  if (empty) empty.hidden = true;
  
  if (!error) {
    const errorEl = document.createElement("div");
    errorEl.id = "shop-error";
    errorEl.className = "error-state";
    errorEl.innerHTML = `
      <h3 data-i18n="shop.errorTitle">Error Loading Products</h3>
      <p>${message}</p>
      <button type="button" class="button" onclick="initShopListing()">${tShop("shop.retry")}</button>
    `;
    document.querySelector(".section")?.appendChild(errorEl);
  } else {
    error.querySelector("p").textContent = message;
    error.hidden = false;
  }
}

function hideError() {
  const error = document.getElementById("shop-error");
  if (error) error.hidden = true;
}

function renderProductCard(product, lang) {
  const name = ShopStore.getLocalized(product, lang, "name");
  const price = ShopStore.formatPrice(product.price, product.currency);
  const available = isProductAvailable(product);
  const fallbackImage = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect fill="%231a1a1a" width="300" height="300"/><text x="50%" y="50%" fill="%23666" text-anchor="middle" dy=".3em" font-size="20">No Image</text></svg>';

  return `<article class="product-card fade-in visible">
    <div class="product-card-image">
      <a href="product.html?id=${encodeURIComponent(product.id)}">
        <img src="${product.image}" 
             alt="${name}" 
             loading="lazy" 
             width="300" 
             height="300"
             onerror="this.src='${fallbackImage}'">
      </a>
    </div>
    <div class="product-card-body">
      ${renderStockBadge(product, lang)}
      <h3><a href="product.html?id=${encodeURIComponent(product.id)}">${name}</a></h3>
      <div class="product-price">${price}</div>
      <div class="product-card-actions">
        <a href="product.html?id=${encodeURIComponent(product.id)}" class="button button-outline">${tShop("shop.viewDetails")}</a>
        <button type="button" class="button" data-add-cart="${product.id}" ${available ? "" : "disabled"}>${tShop("shop.addToCart")}</button>
      </div>
    </div>
  </article>`;
}

function renderCategoryFilters(categories, lang) {
  const container = document.getElementById("category-filters");
  if (!container) return;

  const buttons = [
    `<button type="button" class="filter-btn ${activeCategory === "all" ? "active" : ""}" data-category="all">${tShop("shop.allCategories")}</button>`
  ];

  categories.forEach((cat) => {
    const name = ShopStore.getLocalized(cat, lang, "name");
    buttons.push(
      `<button type="button" class="filter-btn ${activeCategory === cat.id ? "active" : ""}" data-category="${cat.id}">${name}</button>`
    );
  });

  container.innerHTML = buttons.join("");

  container.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.category;
      renderShopListing();
    });
  });
}

function renderShopListing() {
  const grid = document.getElementById("product-grid");
  const empty = document.getElementById("shop-empty");
  if (!grid || !shopData) return;

  const lang = getShopLang();
  const products = filterProducts(ShopStore.getProducts(shopData));
  renderCategoryFilters(ShopStore.getCategories(shopData), lang);

  if (products.length === 0) {
    grid.innerHTML = "";
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;
  
  // Use DocumentFragment for better performance
  const fragment = document.createDocumentFragment();
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = products.map((p) => renderProductCard(p, lang)).join("");
  
  while (tempDiv.firstChild) {
    fragment.appendChild(tempDiv.firstChild);
  }
  
  grid.innerHTML = "";
  grid.appendChild(fragment);
  bindAddToCartButtons();
}

function bindAddToCartButtons() {
  document.querySelectorAll("[data-add-cart]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.addCart;
      const product = ShopStore.getProductById(shopData, id);
      if (!product || !isProductAvailable(product)) return;
      Cart.add(id, 1);
      showToast(tShop("shop.added"));
    });
  });
}

async function initShopListing() {
  const grid = document.getElementById("product-grid");
  if (!grid) return;

  showLoading();
  hideError();
  
  try {
    shopData = await ShopStore.load();
    hideLoading();
    renderShopListing();

    const searchInput = document.getElementById("shop-search");
    if (searchInput) {
      let debounce;
      searchInput.addEventListener("input", (e) => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          searchQuery = e.target.value.trim();
          renderShopListing();
        }, 200);
      });
    }
  } catch (error) {
    hideLoading();
    console.error("Failed to load shop data:", error);
    showError("Unable to load products. Please check your connection and try again.");
  }
}

async function initProductDetail() {
  const container = document.getElementById("product-detail");
  const notFound = document.getElementById("product-not-found");
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  shopData = await ShopStore.load();
  const product = id ? ShopStore.getProductById(shopData, id) : null;
  const lang = getShopLang();

  if (!product) {
    container.innerHTML = "";
    if (notFound) notFound.hidden = false;
    return;
  }

  if (notFound) notFound.hidden = true;
  const name = ShopStore.getLocalized(product, lang, "name").replace(/[<>]/g, '');
  const desc = ShopStore.getLocalized(product, lang, "description").replace(/[<>]/g, '');
  const price = ShopStore.formatPrice(product.price, product.currency);
  const available = isProductAvailable(product);
  const maxQty = Math.max(product.stock, 1);

  document.getElementById("breadcrumb-name").textContent = name;
  document.title = `${name} - SubCore Solutions`;

  container.innerHTML = `
    <div class="product-detail-image">
      <img src="${product.image}" alt="${name}" width="600" height="600">
    </div>
    <div class="product-detail-info">
      ${renderStockBadge(product, lang)}
      <h1>${name}</h1>
      <div class="product-price">${price}</div>
      <p class="product-detail-desc">${desc}</p>
      <div class="qty-control">
        <button type="button" id="qty-minus" aria-label="Decrease quantity">−</button>
        <input type="number" id="qty-input" value="1" min="1" max="${maxQty}" aria-label="${tShop("shop.quantity")}">
        <button type="button" id="qty-plus" aria-label="Increase quantity">+</button>
      </div>
      <button type="button" class="button" id="add-to-cart-btn" ${available ? "" : "disabled"}>${tShop("shop.addToCart")}</button>
      <a href="shop.html" class="button button-outline" style="margin-left:0.5rem;">${tShop("shop.continueShopping")}</a>
    </div>`;

  const qtyInput = document.getElementById("qty-input");
  document.getElementById("qty-minus")?.addEventListener("click", () => {
    qtyInput.value = Math.max(1, parseInt(qtyInput.value, 10) - 1);
  });
  document.getElementById("qty-plus")?.addEventListener("click", () => {
    qtyInput.value = Math.min(maxQty, parseInt(qtyInput.value, 10) + 1);
  });

  document.getElementById("add-to-cart-btn")?.addEventListener("click", () => {
    if (!available) return;
    const qty = Math.min(maxQty, Math.max(1, parseInt(qtyInput.value, 10) || 1));
    Cart.add(product.id, qty);
    showToast(tShop("shop.added"));
  });
}

function getCartItemsWithProducts() {
  return Cart.get()
    .map((item) => {
      const product = ShopStore.getProductById(shopData, item.id);
      return product ? { ...item, product } : null;
    })
    .filter(Boolean);
}

async function initCart() {
  const content = document.getElementById("cart-content");
  const empty = document.getElementById("cart-empty");
  if (!content) return;

  shopData = await ShopStore.load();
  const items = getCartItemsWithProducts();
  const lang = getShopLang();

  if (items.length === 0) {
    content.innerHTML = "";
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;

  let total = 0;
  const rows = items.map(({ product, qty }) => {
    const subtotal = product.price * qty;
    total += subtotal;
    const name = ShopStore.getLocalized(product, lang, "name").replace(/[<>]/g, '');
    return `<tr data-cart-id="${product.id}">
      <td>
        <div class="cart-product">
          <img src="${product.image}" alt="${name}" width="64" height="64">
          <a href="product.html?id=${encodeURIComponent(product.id)}">${name}</a>
        </div>
      </td>
      <td>${ShopStore.formatPrice(product.price, product.currency)}</td>
      <td>
        <div class="qty-control" style="margin:0;">
          <button type="button" class="cart-qty-minus" data-id="${product.id}">−</button>
          <input type="number" class="cart-qty-input" data-id="${product.id}" value="${qty}" min="1" max="${product.stock}" aria-label="${tShop("shop.quantity")}">
          <button type="button" class="cart-qty-plus" data-id="${product.id}">+</button>
        </div>
      </td>
      <td>${ShopStore.formatPrice(subtotal, product.currency)}</td>
      <td><button type="button" class="btn-sm cart-remove" data-id="${product.id}">${tShop("shop.remove")}</button></td>
    </tr>`;
  }).join("");

  content.innerHTML = `
    <div class="cart-table-wrap">
      <table class="cart-table">
        <thead>
          <tr>
            <th>${tShop("shop.product")}</th>
            <th>${tShop("shop.price")}</th>
            <th>${tShop("shop.quantity")}</th>
            <th>${tShop("shop.subtotal")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="cart-summary">
      <div class="cart-summary-row total">
        <span>${tShop("shop.total")}</span>
        <span>${ShopStore.formatPrice(total)}</span>
      </div>
      <a href="checkout.html" class="button" style="width:100%;margin-top:1rem;">${tShop("shop.proceedCheckout")}</a>
      <a href="shop.html" class="button button-outline" style="width:100%;margin-top:0.5rem;">${tShop("shop.continueShopping")}</a>
    </div>`;

  bindCartEvents();
}

function bindCartEvents() {
  document.querySelectorAll(".cart-qty-minus").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const input = document.querySelector(`.cart-qty-input[data-id="${id}"]`);
      const val = Math.max(1, parseInt(input.value, 10) - 1);
      Cart.update(id, val);
      initCart();
    });
  });

  document.querySelectorAll(".cart-qty-plus").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const input = document.querySelector(`.cart-qty-input[data-id="${id}"]`);
      const max = parseInt(input.max, 10);
      const val = Math.min(max, parseInt(input.value, 10) + 1);
      Cart.update(id, val);
      initCart();
    });
  });

  document.querySelectorAll(".cart-qty-input").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.id;
      const max = parseInt(input.max, 10);
      const val = Math.min(max, Math.max(1, parseInt(input.value, 10) || 1));
      Cart.update(id, val);
      initCart();
    });
  });

  document.querySelectorAll(".cart-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      Cart.remove(btn.dataset.id);
      initCart();
    });
  });
}

async function initCheckout() {
  const content = document.getElementById("checkout-content");
  const empty = document.getElementById("checkout-empty");
  if (!content) return;

  shopData = await ShopStore.load();
  const items = getCartItemsWithProducts();
  const lang = getShopLang();

  if (items.length === 0) {
    content.innerHTML = "";
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;

  let total = 0;
  const summaryItems = items.map(({ product, qty }) => {
    const subtotal = product.price * qty;
    total += subtotal;
    const name = ShopStore.getLocalized(product, lang, "name").replace(/[<>]/g, '');
    return `<div class="cart-summary-row">
      <span>${name} × ${qty}</span>
      <span>${ShopStore.formatPrice(subtotal, product.currency)}</span>
    </div>`;
  }).join("");

  content.innerHTML = `
    <div class="checkout-grid">
      <form id="checkout-form" class="card" style="padding:1.75rem;">
        <div class="form-group">
          <label for="checkout-name">${tShop("shop.fullName")} *</label>
          <input type="text" id="checkout-name" required autocomplete="name">
        </div>
        <div class="form-group">
          <label for="checkout-email">${tShop("shop.email")} *</label>
          <input type="email" id="checkout-email" required autocomplete="email">
        </div>
        <div class="form-group">
          <label for="checkout-phone">${tShop("shop.phone")} *</label>
          <input type="tel" id="checkout-phone" required autocomplete="tel">
        </div>
        <div class="form-group">
          <label for="checkout-address">${tShop("shop.address")} *</label>
          <textarea id="checkout-address" rows="3" required></textarea>
        </div>
        <div class="form-group">
          <label for="checkout-notes">${tShop("shop.notes")}</label>
          <textarea id="checkout-notes" rows="2"></textarea>
        </div>
        <button type="submit" class="button">${tShop("shop.placeOrder")}</button>
        <a href="cart.html" class="button button-outline" style="margin-left:0.5rem;">${tShop("shop.backToCart")}</a>
      </form>
      <div class="cart-summary">
        <h3 style="margin-bottom:1rem;font-size:1.1rem;">${tShop("shop.orderSummary")}</h3>
        ${summaryItems}
        <div class="cart-summary-row total">
          <span>${tShop("shop.total")}</span>
          <span>${ShopStore.formatPrice(total)}</span>
        </div>
      </div>
    </div>`;

  document.getElementById("checkout-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    placeOrder(items, total, lang);
  });
}

function placeOrder(items, total, lang) {
  const name = document.getElementById("checkout-name").value.trim();
  const email = document.getElementById("checkout-email").value.trim();
  const phone = document.getElementById("checkout-phone").value.trim();
  const address = document.getElementById("checkout-address").value.trim();
  const notes = document.getElementById("checkout-notes").value.trim();

  const orderLines = items.map(({ product, qty }) => {
    const pName = ShopStore.getLocalized(product, lang, "name");
    return `${pName} × ${qty} — ${ShopStore.formatPrice(product.price * qty, product.currency)}`;
  });

  let body = `New Shop Order\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}`;
  if (notes) body += `\nNotes: ${notes}`;
  body += `\n\n--- Items ---\n${orderLines.join("\n")}`;
  body += `\n\nTotal: ${ShopStore.formatPrice(total)}`;

  if (typeof SupabaseClient !== "undefined") {
    SupabaseClient.saveOrder({ name, email, phone, address, notes, items: items.map((i) => ({ id: i.product.id, qty: i.qty })), total }).catch(() => {});
  }

  const subject = encodeURIComponent(`Shop Order - ${name}`);
  const encodedBody = encodeURIComponent(body);
  window.location.href = `mailto:info.subcoresolutions@gmail.com?subject=${subject}&body=${encodedBody}`;

  const waMsg = encodeURIComponent(body);
  setTimeout(() => {
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${waMsg}`, "_blank");
  }, 500);

  Cart.clear();
  showToast(tShop("shop.orderSuccess"));
}

function showToast(message) {
  let toast = document.querySelector(".shop-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "shop-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

async function initShopPages() {
  const page = document.body.dataset.page;

  if (page === "product") await initProductDetail();
  else if (page === "cart") await initCart();
  else if (page === "checkout") await initCheckout();
  else await initShopListing();
}

document.addEventListener("DOMContentLoaded", initShopPages);

document.addEventListener("langchange", async () => {
  if (!shopData) shopData = await ShopStore.load();
  const page = document.body.dataset.page;
  if (page === "product") await initProductDetail();
  else if (page === "cart") await initCart();
  else if (page === "checkout") await initCheckout();
  else renderShopListing();
});
