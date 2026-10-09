/* Storefront pages: shop listing (filters, sort, search), product detail, cart, checkout.
   Picks the page by which container exists in the HTML. */
(function () {
  const PAGE_SIZE = 12;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const icon = (name, cls = "") => '<svg class="icon ' + cls + '" aria-hidden="true"><use href="icons.svg#' + name + '"/></svg>';
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  let data = null;
  let products = [];

  async function loadData(force) {
    data = await ShopStore.load(force);
    products = ShopStore.getProducts(data);
    return data;
  }
  const categoryName = (id) => {
    const c = ShopStore.getCategories(data).find((x) => x.id === id);
    return c ? loc(c.name) : "";
  };

  /* ════════════════════════════ SHOP LISTING ════════════════════════════ */
  function initShop() {
    const grid = $("#product-grid");
    const state = { q: "", cats: new Set(), brands: new Set(), min: null, max: null, stock: false, sale: false, sort: "featured", shown: PAGE_SIZE };
    const openGroups = new Set(["cat", "brand", "price", "avail"]);
    let view = [];

    /* URL <-> state */
    function readUrl() {
      const p = new URLSearchParams(location.search);
      state.q = p.get("q") || "";
      state.cats = new Set((p.get("category") || "").split(",").filter(Boolean));
      state.brands = new Set((p.get("brand") || "").split(",").filter(Boolean));
      state.min = p.get("min") !== null && p.get("min") !== "" ? Number(p.get("min")) : null;
      state.max = p.get("max") !== null && p.get("max") !== "" ? Number(p.get("max")) : null;
      state.stock = p.get("stock") === "1";
      state.sale = p.get("sale") === "1";
      state.sort = ["featured", "newest", "priceAsc", "priceDesc", "nameAsc"].includes(p.get("sort")) ? p.get("sort") : "featured";
    }
    function writeUrl() {
      const p = new URLSearchParams();
      if (state.q) p.set("q", state.q);
      if (state.cats.size) p.set("category", [...state.cats].join(","));
      if (state.brands.size) p.set("brand", [...state.brands].join(","));
      if (state.min !== null) p.set("min", state.min);
      if (state.max !== null) p.set("max", state.max);
      if (state.stock) p.set("stock", "1");
      if (state.sale) p.set("sale", "1");
      if (state.sort !== "featured") p.set("sort", state.sort);
      const qs = p.toString();
      history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
    }

    /* Filtering. `skip` leaves one facet out so its own counts stay meaningful. */
    function matches(p, skip) {
      if (skip !== "q" && state.q) {
        const hay = norm([p.name?.en, p.name?.sq, p.description?.en, p.description?.sq, p.brand, p.sku, categoryName(p.category)].join(" "));
        if (!norm(state.q).split(/\s+/).filter(Boolean).every((t) => hay.includes(t))) return false;
      }
      if (skip !== "cat" && state.cats.size && !state.cats.has(p.category)) return false;
      if (skip !== "brand" && state.brands.size && !state.brands.has(p.brand)) return false;
      if (skip !== "price") {
        if (state.min !== null && p.price < state.min) return false;
        if (state.max !== null && p.price > state.max) return false;
      }
      if (skip !== "stock" && state.stock && !isInStock(p)) return false;
      if (skip !== "sale" && state.sale && !discountPercent(p)) return false;
      return true;
    }

    const time = (p) => (p.created_at ? new Date(p.created_at).getTime() : 0);
    const sorters = {
      featured: (a, b) => Number(b.featured) - Number(a.featured) || time(b) - time(a),
      newest: (a, b) => time(b) - time(a),
      priceAsc: (a, b) => a.price - b.price,
      priceDesc: (a, b) => b.price - a.price,
      nameAsc: (a, b) => productName(a).localeCompare(productName(b), getShopLang())
    };
    function compute() {
      const base = sorters[state.sort];
      view = products.filter((p) => matches(p)).sort((a, b) => Number(isInStock(b)) - Number(isInStock(a)) || base(a, b));
    }

    /* Filter panel */
    function renderFilters() {
      const focusKey = document.activeElement?.dataset?.fk;
      const cats = ShopStore.getCategories(data).map((c) => ({ c, n: products.filter((p) => p.category === c.id && matches(p, "cat")).length, total: products.filter((p) => p.category === c.id).length })).filter((x) => x.total > 0);
      const brandNames = [...new Set(products.map((p) => p.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const brands = brandNames.map((b) => ({ b, n: products.filter((p) => p.brand === b && matches(p, "brand")).length }));
      const prices = products.map((p) => p.price);
      const lo = prices.length ? Math.floor(Math.min(...prices)) : 0;
      const hi = prices.length ? Math.ceil(Math.max(...prices)) : 0;
      const cur = products[0]?.currency;

      const check = (fk, facet, value, label, n, on) =>
        '<label class="check-row' + (n === 0 && !on ? " is-empty" : "") + '"><input type="checkbox" data-fk="' + fk + '" data-facet="' + facet + '" value="' + escapeHtml(value) + '"' + (on ? " checked" : "") + "><span>" + escapeHtml(label) + '</span><span class="count">' + n + "</span></label>";
      const group = (key, title, body) =>
        '<details class="filter-group" data-group="' + key + '"' + (openGroups.has(key) ? " open" : "") + "><summary>" + escapeHtml(title) + icon("chevron-down") + '</summary><div class="filter-body">' + body + "</div></details>";

      let html = "";
      if (cats.length) html += group("cat", tr("shop.category"), cats.map((x) => check("cat:" + x.c.id, "cat", x.c.id, loc(x.c.name), x.n, state.cats.has(x.c.id))).join(""));
      if (brands.length) html += group("brand", tr("shop.brand"), brands.map((x) => check("brand:" + x.b, "brand", x.b, x.b, x.n, state.brands.has(x.b))).join(""));
      html += group("price", tr("shop.price") + (cur ? " (" + (new Intl.NumberFormat("en", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol" }).format(0).replace(/[\d.,\s]/g, "") || cur) + ")" : ""),
        '<div class="price-inputs"><input type="number" inputmode="decimal" min="0" step="any" id="f-min" data-fk="min" placeholder="' + (lo || tr("shop.min")) + '" value="' + (state.min ?? "") + '" aria-label="' + escapeHtml(tr("shop.min")) + '"><span class="dash">–</span>' +
        '<input type="number" inputmode="decimal" min="0" step="any" id="f-max" data-fk="max" placeholder="' + (hi || tr("shop.max")) + '" value="' + (state.max ?? "") + '" aria-label="' + escapeHtml(tr("shop.max")) + '"></div>');
      html += group("avail", tr("shop.availability"),
        check("stock", "stock", "1", tr("shop.inStockOnly"), products.filter((p) => isInStock(p) && matches(p, "stock")).length, state.stock) +
        check("sale", "sale", "1", tr("shop.onSale"), products.filter((p) => discountPercent(p) && matches(p, "sale")).length, state.sale));
      $("#filter-groups").innerHTML = html;
      if (focusKey) $('[data-fk="' + CSS.escape(focusKey) + '"]')?.focus();
    }

    function activeChips() {
      const chips = [];
      state.cats.forEach((id) => chips.push({ label: categoryName(id) || id, off: () => state.cats.delete(id) }));
      state.brands.forEach((b) => chips.push({ label: b, off: () => state.brands.delete(b) }));
      if (state.min !== null || state.max !== null) {
        const cur = products[0]?.currency;
        const f = (n) => (cur ? money(n, cur) : n);
        const label = state.min !== null && state.max !== null ? f(state.min) + " – " + f(state.max) : state.min !== null ? "≥ " + f(state.min) : "≤ " + f(state.max);
        chips.push({ label, off: () => { state.min = null; state.max = null; } });
      }
      if (state.stock) chips.push({ label: tr("shop.inStockOnly"), off: () => { state.stock = false; } });
      if (state.sale) chips.push({ label: tr("shop.onSale"), off: () => { state.sale = false; } });
      if (state.q) chips.push({ label: "“" + state.q + "”", off: () => { state.q = ""; $("#shop-search").value = ""; } });
      return chips;
    }

    let chipActions = [];
    function renderResults() {
      const chips = activeChips();
      chipActions = chips.map((c) => c.off);
      $("#active-chips").innerHTML = chips.map((c, i) => '<button type="button" class="chip" data-chip="' + i + '">' + escapeHtml(c.label) + icon("x") + '<span class="sr-only"> ' + escapeHtml(tr("common.close")) + "</span></button>").join("");
      $("#clear-filters").hidden = chips.length === 0;
      const badge = chips.filter((c) => !c.label.startsWith("“")).length;
      $("#filter-badge").textContent = badge ? " (" + badge + ")" : "";
      $("#drawer-apply").textContent = tr("shop.showResults", { n: view.length });

      const n = view.length;
      $("#result-count").innerHTML = "<strong>" + (n === 1 ? tr("shop.results1") : tr("shop.results", { n })) + "</strong>";

      const empty = $("#shop-empty");
      if (n === 0) {
        grid.innerHTML = "";
        empty.hidden = false;
        const none = products.length === 0;
        $("h3", empty).textContent = none ? tr("shop.empty.title") : tr("shop.noResults");
        $("p", empty).textContent = none ? tr("shop.empty.desc") : tr("shop.noResultsDesc");
        $("#empty-clear").hidden = none;
      } else {
        empty.hidden = true;
        grid.innerHTML = view.slice(0, state.shown).map(renderProductCard).join("");
      }
      const more = $("#load-more");
      more.hidden = n <= state.shown;
      if (!more.hidden) {
        $("#load-status").textContent = tr("shop.showing", { a: Math.min(state.shown, n), b: n });
        $("#load-progress").style.width = Math.round((Math.min(state.shown, n) / n) * 100) + "%";
      }
      grid.setAttribute("aria-busy", "false");
    }

    function update(opts = {}) {
      if (!opts.keepPage) state.shown = PAGE_SIZE;
      compute();
      renderFilters();
      renderResults();
      writeUrl();
    }

    /* Wiring */
    let priceTimer, searchTimer;
    $("#filter-groups").addEventListener("change", (e) => {
      const el = e.target;
      const facet = el.dataset.facet;
      if (!facet) return;
      if (facet === "cat" || facet === "brand") {
        const set = facet === "cat" ? state.cats : state.brands;
        el.checked ? set.add(el.value) : set.delete(el.value);
      } else if (facet === "stock") state.stock = el.checked;
      else if (facet === "sale") state.sale = el.checked;
      update();
    });
    $("#filter-groups").addEventListener("input", (e) => {
      if (e.target.id !== "f-min" && e.target.id !== "f-max") return;
      clearTimeout(priceTimer);
      priceTimer = setTimeout(() => {
        const v = (id) => { const x = $(id).value.trim(); return x === "" || Number.isNaN(Number(x)) ? null : Number(x); };
        state.min = v("#f-min");
        state.max = v("#f-max");
        if (state.min !== null && state.max !== null && state.min > state.max) [state.min, state.max] = [state.max, state.min];
        update();
      }, 350);
    });
    $("#filter-groups").addEventListener("toggle", (e) => {
      const g = e.target.dataset?.group;
      if (g) e.target.open ? openGroups.add(g) : openGroups.delete(g);
    }, true);
    $("#active-chips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-chip]");
      if (!b) return;
      chipActions[Number(b.dataset.chip)]();
      update();
    });
    const clearAll = () => { state.cats.clear(); state.brands.clear(); state.min = state.max = null; state.stock = state.sale = false; state.q = ""; $("#shop-search").value = ""; update(); };
    ["#clear-filters", "#drawer-clear", "#empty-clear"].forEach((s) => $(s)?.addEventListener("click", clearAll));
    $("#shop-search").addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.q = e.target.value.trim(); update(); }, 200);
    });
    $("#shop-sort").addEventListener("change", (e) => { state.sort = e.target.value; update(); });
    $("#load-more-btn").addEventListener("click", () => {
      state.shown += PAGE_SIZE;
      update({ keepPage: true });
      const cards = $$(".product-card", grid);
      cards[Math.max(0, cards.length - PAGE_SIZE)]?.querySelector("a")?.focus({ preventScroll: true });
    });
    $("#shop-retry").addEventListener("click", start);
    bindAddToCart(grid, () => products);

    /* Mobile filter drawer */
    const drawer = $("#filters"), backdrop = $("#drawer-backdrop"), toggle = $("#filter-toggle");
    toggle.setAttribute("aria-controls", "filters");
    toggle.setAttribute("aria-expanded", "false");
    const closeDrawer = () => {
      drawer.classList.remove("open"); backdrop.classList.remove("open");
      document.body.classList.remove("drawer-open"); toggle.setAttribute("aria-expanded", "false");
    };
    toggle.addEventListener("click", () => {
      drawer.classList.add("open"); backdrop.classList.add("open");
      document.body.classList.add("drawer-open"); toggle.setAttribute("aria-expanded", "true");
      $("#drawer-close")?.focus();
    });
    backdrop.addEventListener("click", closeDrawer);
    $("#drawer-apply").addEventListener("click", closeDrawer);
    $("#drawer-close")?.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
    window.matchMedia("(min-width: 961px)").addEventListener("change", (e) => { if (e.matches) closeDrawer(); });

    /* Boot */
    function skeleton() {
      grid.setAttribute("aria-busy", "true");
      grid.innerHTML = '<div class="skeleton-card"><div class="sk-img"></div><div class="sk-line"></div><div class="sk-line short"></div></div>'.repeat(8);
    }
    async function start() {
      $("#shop-error").hidden = true;
      skeleton();
      try {
        await loadData(true);
        readUrl();
        $("#shop-search").value = state.q;
        $("#shop-sort").value = state.sort;
        update();
      } catch (err) {
        console.error(err);
        grid.innerHTML = "";
        grid.setAttribute("aria-busy", "false");
        $("#shop-error").hidden = false;
      }
    }
    document.addEventListener("langchange", () => { if (data) { $("#shop-sort").value = state.sort; update({ keepPage: true }); } });
    start();
  }

  /* ════════════════════════════ PRODUCT PAGE ════════════════════════════ */
  function initProduct() {
    const id = new URLSearchParams(location.search).get("id");
    let product = null, imgIndex = 0, qty = 1, tab = "desc";

    function setMeta(p) {
      const name = productName(p);
      const desc = (loc(p.description) || name).replace(/\s+/g, " ").slice(0, 155);
      document.title = name + " — SubCore Solutions";
      const set = (sel, attr, val) => { const el = $(sel); if (el) el.setAttribute(attr, val); };
      set('meta[name="description"]', "content", desc);
      set('link[rel="canonical"]', "href", "https://subcoresolutions.online/product.html?id=" + encodeURIComponent(p.id));
      set('meta[property="og:title"]', "content", name);
      set('meta[property="og:description"]', "content", desc);
      set('meta[property="og:url"]', "href" in {} ? "" : "content", "https://subcoresolutions.online/product.html?id=" + encodeURIComponent(p.id));
      const img = productImage(p);
      if (img && !$('meta[property="og:image"]')) {
        const m = document.createElement("meta"); m.setAttribute("property", "og:image"); m.setAttribute("content", img); document.head.appendChild(m);
      }
      let ld = $("#ld-product");
      if (!ld) { ld = document.createElement("script"); ld.type = "application/ld+json"; ld.id = "ld-product"; document.head.appendChild(ld); }
      ld.textContent = JSON.stringify({
        "@context": "https://schema.org", "@type": "Product", name, description: desc,
        image: (p.images || []).concat(p.image ? [p.image] : []).filter((v, i, a) => v && a.indexOf(v) === i),
        sku: p.sku || undefined, brand: p.brand ? { "@type": "Brand", name: p.brand } : undefined,
        offers: { "@type": "Offer", price: p.price, priceCurrency: p.currency, availability: isInStock(p) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: "https://subcoresolutions.online/product.html?id=" + encodeURIComponent(p.id) }
      });
    }

    function addToCart() {
      const added = Cart.add(product.id, qty, product.stock);
      if (added === 0) Toast.info(productName(product), tr("cart.onlyLeft", { n: product.stock }));
      else Toast.success(tr("shop.addedNamed", { name: productName(product) }), "", 3500, { href: "cart.html", label: tr("shop.viewCart") });
    }

    function render() {
      const p = product;
      const name = escapeHtml(productName(p));
      const imgs = p.images && p.images.length ? p.images : (p.image ? [p.image] : []);
      const pct = discountPercent(p);
      const st = stockStatus(p);
      const inStock = isInStock(p);
      const desc = loc(p.description);
      const specs = (p.specs || []).filter((s) => s && (loc(s.label) || loc(s.value)));
      const cat = categoryName(p.category);

      $("#breadcrumb-name").textContent = productName(p);
      const crumb = $("#pd-breadcrumb");
      crumb.innerHTML = '<a href="index.html">' + escapeHtml(tr("nav.home")) + '</a><span class="sep">/</span><a href="shop.html">' + escapeHtml(tr("nav.shop")) + "</a>" +
        (cat ? '<span class="sep">/</span><a href="shop.html?category=' + encodeURIComponent(p.category) + '">' + escapeHtml(cat) + "</a>" : "") +
        '<span class="sep">/</span><span id="breadcrumb-name">' + name + "</span>";

      const gallery = '<div class="gallery"><div class="gallery-main" id="gallery-main">' +
        (imgs.length ? '<img src="' + escapeHtml(imgs[imgIndex]) + '" alt="' + name + '" width="640" height="640" data-fallback>' : placeholderBox()) + "</div>" +
        (imgs.length > 1 ? '<div class="gallery-thumbs">' + imgs.map((u, i) => '<button type="button" class="thumb' + (i === imgIndex ? " active" : "") + '" data-i="' + i + '" aria-label="' + (i + 1) + " / " + imgs.length + '"><img src="' + escapeHtml(u) + '" alt="" loading="lazy" data-fallback></button>').join("") + "</div>" : "") + "</div>";

      const short = desc ? desc.split(/\n+/)[0].slice(0, 220) : "";
      const info = '<div class="pd-info">' +
        '<div class="pd-meta">' + (p.brand ? "<span>" + escapeHtml(tr("pd.brand")) + ": <strong>" + escapeHtml(p.brand) + "</strong></span>" : "") +
          (cat ? '<span>' + escapeHtml(tr("pd.category")) + ': <a href="shop.html?category=' + encodeURIComponent(p.category) + '">' + escapeHtml(cat) + "</a></span>" : "") +
          (p.sku ? "<span>" + escapeHtml(tr("pd.sku")) + ": " + escapeHtml(p.sku) + "</span>" : "") + "</div>" +
        "<h1>" + name + "</h1>" +
        '<div class="pd-price"><span class="price' + (pct ? " price-sale" : "") + '">' + money(p.price, p.currency) + "</span>" +
          (pct ? '<span class="price-old">' + money(p.compare_price, p.currency) + '</span><span class="save">' + escapeHtml(tr("pd.save", { n: pct })) + "</span>" : "") + "</div>" +
        '<div class="stock ' + st.key + '">' + escapeHtml(st.label) + "</div>" +
        (short ? '<p class="pd-summary">' + escapeHtml(short) + "</p>" : "") +
        '<div class="pd-buy">' +
          (inStock ? '<div class="qty" role="group" aria-label="' + escapeHtml(tr("shop.quantity")) + '"><button type="button" id="qty-minus" aria-label="−">' + icon("minus") + '</button><input type="number" id="qty-input" value="' + qty + '" min="1" max="' + p.stock + '" inputmode="numeric" aria-label="' + escapeHtml(tr("shop.quantity")) + '"><button type="button" id="qty-plus" aria-label="+">' + icon("plus") + "</button></div>" : "") +
          '<div class="button-primary-wrap"><button type="button" class="button" id="add-btn"' + (inStock ? "" : " disabled") + ">" + icon("cart") + "<span>" + escapeHtml(inStock ? tr("shop.add") : tr("shop.outOfStock")) + "</span></button></div>" +
        "</div>" +
        '<a class="button button-outline button-block" target="_blank" rel="noopener" href="' + whatsappLink(productName(p) + " — " + location.href) + '">' + icon("whatsapp", "icon-fill") + "<span>" + escapeHtml(tr("pd.askWhatsapp")) + "</span></a>" +
        '<div class="assurances">' +
          [["truck", "a1"], ["support", "a2"], ["phone", "a3"]].map(([ic, k]) => '<div class="assurance">' + icon(ic) + "<div><strong>" + escapeHtml(tr("pd." + k + ".title")) + "</strong><br>" + escapeHtml(tr("pd." + k + ".desc")) + "</div></div>").join("") +
        "</div></div>";

      const tabs = '<div class="tabs"><div class="tab-list" role="tablist">' +
        '<button type="button" class="tab" role="tab" data-tab="desc" aria-selected="' + (tab === "desc") + '">' + escapeHtml(tr("pd.description")) + "</button>" +
        (specs.length ? '<button type="button" class="tab" role="tab" data-tab="specs" aria-selected="' + (tab === "specs") + '">' + escapeHtml(tr("pd.specs")) + "</button>" : "") + "</div>" +
        '<div class="tab-panel" id="tab-desc" role="tabpanel"' + (tab === "desc" ? "" : " hidden") + "><p>" + escapeHtml(desc || tr("pd.noDescription")) + "</p></div>" +
        (specs.length ? '<div class="tab-panel" id="tab-specs" role="tabpanel"' + (tab === "specs" ? "" : " hidden") + '><table class="spec-table"><tbody>' + specs.map((s) => "<tr><th>" + escapeHtml(loc(s.label)) + "</th><td>" + escapeHtml(loc(s.value)) + "</td></tr>").join("") + "</tbody></table></div>" : "") + "</div>";

      $("#product-detail").innerHTML = '<div class="pd-grid">' + gallery + info + "</div>" + tabs;
      $("#product-not-found").hidden = true;

      /* sticky buy bar (mobile only via CSS) */
      const sticky = $("#sticky-buy");
      if (inStock) {
        sticky.innerHTML = '<span class="price">' + money(p.price, p.currency) + '</span><button type="button" class="button" id="sticky-add">' + icon("cart") + "<span>" + escapeHtml(tr("shop.add")) + "</span></button>";
        sticky.hidden = false;
        document.body.classList.add("has-sticky-buy");
        $("#sticky-add").addEventListener("click", addToCart);
      } else {
        sticky.hidden = true;
        document.body.classList.remove("has-sticky-buy");
      }

      /* wiring */
      $$(".thumb").forEach((b) => b.addEventListener("click", () => { imgIndex = Number(b.dataset.i); render(); $$(".thumb")[imgIndex]?.focus(); }));
      $$(".tab").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab; render(); $('.tab[data-tab="' + tab + '"]')?.focus(); }));
      if (inStock) {
        const input = $("#qty-input");
        const clamp = (v) => Math.min(p.stock, Math.max(1, parseInt(v, 10) || 1));
        const set = (v) => { qty = clamp(v); input.value = qty; $("#qty-minus").disabled = qty <= 1; $("#qty-plus").disabled = qty >= p.stock; };
        $("#qty-minus").addEventListener("click", () => set(qty - 1));
        $("#qty-plus").addEventListener("click", () => set(qty + 1));
        input.addEventListener("change", () => set(input.value));
        set(qty);
        $("#add-btn").addEventListener("click", addToCart);
      }
      renderRelated();
    }

    function renderRelated() {
      const others = products.filter((p) => p.id !== product.id && isInStock(p));
      const same = others.filter((p) => p.category === product.category);
      const list = same.concat(others.filter((p) => p.category !== product.category && p.featured)).slice(0, 4);
      const section = $("#related");
      if (!list.length) { section.hidden = true; return; }
      $("#related-grid").innerHTML = list.map(renderProductCard).join("");
      section.hidden = false;
    }

    async function start() {
      try {
        await loadData();
      } catch {
        $("#product-detail").innerHTML = "";
        $("#product-not-found").hidden = false;
        return;
      }
      product = ShopStore.getProductById(data, id);
      if (!product) {
        $("#product-detail").innerHTML = "";
        $("#product-not-found").hidden = false;
        $("#breadcrumb-name").textContent = "—";
        document.title = tr("pd.notFound") + " — SubCore Solutions";
        const robots = document.createElement("meta"); robots.name = "robots"; robots.content = "noindex"; document.head.appendChild(robots);
        return;
      }
      setMeta(product);
      render();
    }
    bindAddToCart($("#related-grid"), () => products);
    document.addEventListener("langchange", () => { if (product) { setMeta(product); render(); } });
    start();
  }

  /* ════════════════════════════ CART ════════════════════════════ */
  function initCart() {
    const root = $("#cart-content");
    let first = true;

    function summaryHtml(totals, withButton) {
      const lang = getShopLang();
      let ship;
      if (!totals.shippingKnown) ship = '<span class="muted">' + escapeHtml(tr("cart.shippingTbd")) + "</span>";
      else ship = totals.shipping === 0 ? escapeHtml(tr("cart.free")) : money(totals.shipping, totals.currency);
      const hint = totals.shippingKnown && totals.freeOver && totals.subtotal < totals.freeOver
        ? '<p class="summary-note">' + icon("truck") + "<span>" + escapeHtml(tr("cart.freeOver", { amount: money(totals.freeOver, totals.currency) })) + "</span></p>" : "";
      return '<aside class="summary"><h2>' + escapeHtml(tr("shop.orderSummary")) + "</h2>" +
        '<div class="summary-row"><span>' + escapeHtml(tr("cart.subtotal")) + "</span><span>" + money(totals.subtotal, totals.currency) + "</span></div>" +
        '<div class="summary-row"><span>' + escapeHtml(tr("cart.shipping")) + "</span><span>" + ship + "</span></div>" +
        '<div class="summary-row total"><span>' + escapeHtml(tr("cart.total")) + "</span><span>" + money(totals.total, totals.currency) + "</span></div>" + hint +
        (withButton ? '<a href="checkout.html" class="button button-block">' + escapeHtml(tr("cart.checkout")) + icon("arrow-right") + "</a>" : "") +
        '<p class="summary-note">' + icon("lock") + "<span>" + escapeHtml(tr("pd.a1.desc")) + "</span></p></aside>";
    }

    function render() {
      const { lines, notes } = resolveCart(data);
      if (first) {
        first = false;
        if (notes.removed.length) Toast.info(tr("cart.unavailable"), "");
        notes.adjusted.forEach((p) => Toast.info(productName(p), tr("cart.onlyLeft", { n: p.stock })));
      }
      if (!lines.length) { root.innerHTML = ""; $("#cart-empty").hidden = false; return; }
      $("#cart-empty").hidden = true;
      const totals = cartTotals(lines, data.settings);
      const items = lines.map(({ product: p, qty, subtotal }) => {
        const name = escapeHtml(productName(p));
        const img = productImage(p);
        return '<div class="cart-item" data-id="' + escapeHtml(p.id) + '">' +
          '<a class="cart-thumb" aria-label="' + name + '" href="' + productUrl(p) + '">' + (img ? '<img src="' + escapeHtml(img) + '" alt="' + name + '" data-fallback>' : placeholderBox()) + "</a>" +
          "<div><h2><a href=\"" + productUrl(p) + '">' + name + '</a></h2><div class="unit">' + money(p.price, p.currency) + " " + escapeHtml(tr("cart.each")) + "</div>" +
            '<div class="item-controls"><div class="qty" role="group" aria-label="' + escapeHtml(tr("shop.quantity")) + '">' +
              '<button type="button" data-act="minus" aria-label="−"' + (qty <= 1 ? " disabled" : "") + ">" + icon("minus") + '</button><input type="number" data-act="input" value="' + qty + '" min="1" max="' + p.stock + '" inputmode="numeric" aria-label="' + escapeHtml(tr("shop.quantity")) + '">' +
              '<button type="button" data-act="plus" aria-label="+"' + (qty >= p.stock ? " disabled" : "") + ">" + icon("plus") + "</button></div>" +
              '<button type="button" class="remove-btn" data-act="remove">' + icon("trash", "icon-sm") + escapeHtml(tr("shop.remove")) + "</button></div></div>" +
          '<div class="line-total">' + money(subtotal, p.currency) + "</div></div>";
      }).join("");
      root.innerHTML = '<div class="cart-layout"><div><div class="cart-list">' + items + "</div>" +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:1rem;gap:1rem;flex-wrap:wrap"><a class="text-link" href="shop.html">' + icon("arrow-left") + escapeHtml(tr("shop.continueShopping")) + '</a><button type="button" class="link-btn" data-act="clear">' + escapeHtml(tr("cart.clear")) + "</button></div></div>" +
        summaryHtml(totals, true) + "</div>";
    }

    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const row = b.closest(".cart-item");
      const id = row?.dataset.id;
      const item = Cart.get().find((i) => i.id === id);
      if (b.dataset.act === "clear") { Cart.clear(); render(); return; }
      if (!row) return;
      if (b.dataset.act === "remove") { Cart.remove(id); render(); }
      else if (b.dataset.act === "minus" && item) { Cart.update(id, item.qty - 1); render(); }
      else if (b.dataset.act === "plus" && item) { Cart.update(id, item.qty + 1); render(); }
    });
    root.addEventListener("change", (e) => {
      if (e.target.dataset.act !== "input") return;
      const id = e.target.closest(".cart-item").dataset.id;
      const p = ShopStore.getProductById(data, id);
      Cart.update(id, Math.min(p.stock, Math.max(1, parseInt(e.target.value, 10) || 1)));
      render();
    });
    document.addEventListener("langchange", () => data && render());
    loadData().then(render).catch(() => {
      root.innerHTML = '<div class="error-state"><h3>' + escapeHtml(tr("shop.errorTitle")) + "</h3><p>" + escapeHtml(tr("shop.errorDesc")) + '</p><button type="button" class="button" onclick="location.reload()">' + escapeHtml(tr("shop.retry")) + "</button></div>";
    });
    window.__cartSummary = summaryHtml; // reused by checkout markup
  }

  /* ════════════════════════════ CHECKOUT ════════════════════════════ */
  function initCheckout() {
    const root = $("#checkout-content");
    let done = false;

    function orderText(name, phone, orderNo, lines, totals) {
      const rows = lines.map((l) => "- " + productName(l.product) + " × " + l.qty + " — " + money(l.subtotal, l.product.currency));
      return [orderNo ? tr("co.orderNo") + ": " + orderNo : "", name + (phone ? " · " + phone : ""), "", ...rows, "", tr("cart.total") + ": " + money(totals.total, totals.currency) + (totals.shippingKnown ? "" : " (+ " + tr("cart.shipping").toLowerCase() + ")")].filter((x, i) => x !== "" || i > 1).join("\n");
    }

    function render() {
      if (done) return;
      const { lines } = resolveCart(data);
      if (!lines.length) { root.innerHTML = ""; $("#checkout-empty").hidden = false; return; }
      $("#checkout-empty").hidden = true;
      const totals = cartTotals(lines, data.settings);
      const keep = {};
      $$("#checkout-form [name]").forEach((el) => { keep[el.name] = el.value; });
      const f = (n) => escapeHtml(keep[n] || "");

      const rows = lines.map((l) => '<div class="summary-row"><span>' + escapeHtml(productName(l.product)) + " × " + l.qty + "</span><span>" + money(l.subtotal, l.product.currency) + "</span></div>").join("");
      let ship = !totals.shippingKnown ? '<span class="muted">' + escapeHtml(tr("cart.shippingTbd")) + "</span>" : totals.shipping === 0 ? escapeHtml(tr("cart.free")) : money(totals.shipping, totals.currency);

      root.innerHTML = '<div class="checkout-layout"><form id="checkout-form" class="checkout-form" novalidate>' +
        '<div class="panel"><h2 class="panel-title" style="font-size:1.2rem;margin-bottom:1.1rem">' + escapeHtml(tr("co.contact")) + "</h2>" +
          '<div class="form-group"><label for="co-name">' + escapeHtml(tr("form.name")) + '</label><input type="text" id="co-name" name="name" autocomplete="name" value="' + f("name") + '" required></div>' +
          '<div class="form-row"><div class="form-group"><label for="co-phone">' + escapeHtml(tr("form.phone")) + '</label><input type="tel" id="co-phone" name="phone" autocomplete="tel" value="' + f("phone") + '" required></div>' +
          '<div class="form-group"><label for="co-email">' + escapeHtml(tr("form.email")) + ' <span class="optional">(' + escapeHtml(tr("common.optional")) + ')</span></label><input type="email" id="co-email" name="email" autocomplete="email" value="' + f("email") + '"></div></div></div>' +
        '<div class="panel"><h2 class="panel-title" style="font-size:1.2rem;margin-bottom:1.1rem">' + escapeHtml(tr("co.delivery")) + "</h2>" +
          '<div class="form-row"><div class="form-group"><label for="co-city">' + escapeHtml(tr("co.city")) + '</label><input type="text" id="co-city" name="city" autocomplete="address-level2" value="' + f("city") + '" required></div>' +
          '<div class="form-group"><label for="co-address">' + escapeHtml(tr("co.address")) + '</label><input type="text" id="co-address" name="address" autocomplete="street-address" value="' + f("address") + '" required></div></div>' +
          '<div class="form-group" style="margin-bottom:0"><label for="co-notes">' + escapeHtml(tr("co.notes")) + ' <span class="optional">(' + escapeHtml(tr("common.optional")) + ')</span></label><textarea id="co-notes" name="notes" rows="3" placeholder="' + escapeHtml(tr("co.notesPh")) + '">' + f("notes") + "</textarea></div></div>" +
        '<div class="panel"><h2 class="panel-title" style="font-size:1.2rem;margin-bottom:1.1rem">' + escapeHtml(tr("co.payment")) + "</h2>" +
          '<label class="radio-card"><input type="radio" name="payment" value="cod" checked><span><strong>' + escapeHtml(tr("co.cod")) + "</strong><span>" + escapeHtml(tr("co.codDesc")) + "</span></span></label></div>" +
        '<div class="hp-field" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>' +
        '<div class="form-status" id="co-status" role="alert" hidden></div>' +
        '<div class="button-group" style="margin-top:1.25rem"><button type="submit" class="button" id="co-submit">' + escapeHtml(tr("co.place")) + '</button><a href="cart.html" class="button button-outline">' + escapeHtml(tr("co.back")) + "</a></div>" +
        "</form>" +
        '<aside class="summary"><h2>' + escapeHtml(tr("shop.orderSummary")) + '</h2><div class="summary-items">' + rows + "</div>" +
        '<div class="summary-row"><span>' + escapeHtml(tr("cart.subtotal")) + "</span><span>" + money(totals.subtotal, totals.currency) + "</span></div>" +
        '<div class="summary-row"><span>' + escapeHtml(tr("cart.shipping")) + "</span><span>" + ship + "</span></div>" +
        '<div class="summary-row total"><span>' + escapeHtml(tr("cart.total")) + "</span><span>" + money(totals.total, totals.currency) + "</span></div>" +
        '<p class="summary-note">' + icon("lock") + "<span>" + escapeHtml(tr("co.secure")) + "</span></p></aside></div>";

      const form = $("#checkout-form");
      form.addEventListener("input", (e) => { if (e.target.name) FormUtil.setError(e.target, ""); });
      form.addEventListener("submit", (e) => { e.preventDefault(); submit(form, lines, totals); });
    }

    async function submit(form, lines, totals) {
      if (form.elements.website.value) return;
      const v = (n) => form.elements[n].value.trim();
      let ok = true;
      const need = (n, msg) => { if (!v(n)) { FormUtil.setError(form.elements[n], msg || tr("form.required")); ok = false; } else FormUtil.setError(form.elements[n], ""); };
      need("name"); need("city"); need("address");
      if (!FormUtil.phone(v("phone"))) { FormUtil.setError(form.elements.phone, v("phone") ? tr("form.invalidPhone") : tr("form.required")); ok = false; } else FormUtil.setError(form.elements.phone, "");
      if (v("email") && !FormUtil.email(v("email"))) { FormUtil.setError(form.elements.email, tr("form.invalidEmail")); ok = false; } else FormUtil.setError(form.elements.email, "");
      const status = $("#co-status");
      if (!ok) { FormUtil.status(status, "error", tr("form.fixErrors")); form.querySelector(".has-error input")?.focus(); return; }
      FormUtil.status(status, "", "");

      const btn = $("#co-submit");
      setBusy(btn, true, tr("co.placing"));
      try {
        const res = await SupabaseClient.placeOrder({
          name: v("name"), phone: v("phone"), email: v("email"),
          address: v("city") + ", " + v("address"), notes: v("notes"),
          items: lines.map((l) => ({ id: l.product.id, qty: l.qty })), total: totals.total
        });
        done = true;
        Cart.clear();
        ShopStore.load(true).catch(() => {}); // refresh stock for the next visit
        showConfirmation(v("name"), v("phone"), res.order_number, lines, totals);
      } catch (err) {
        setBusy(btn, false);
        if (err.code === "OUT_OF_STOCK") {
          FormUtil.status(status, "error", tr("co.stockError") + " ");
          const a = document.createElement("a"); a.href = "cart.html"; a.textContent = tr("co.back"); status.appendChild(a);
          ShopStore.load(true).catch(() => {});
        } else {
          console.error(err);
          FormUtil.status(status, "error", tr("co.error") + " ");
          const a = document.createElement("a");
          a.href = whatsappLink(orderText(v("name"), v("phone"), "", lines, totals) + "\n" + v("city") + ", " + v("address"));
          a.target = "_blank"; a.rel = "noopener"; a.textContent = "WhatsApp"; status.appendChild(a);
        }
      }
    }

    function showConfirmation(name, phone, orderNo, lines, totals) {
      $("#checkout-head").hidden = true;
      document.title = tr("co.thanks", { name }) + " — SubCore Solutions";
      const wa = whatsappLink(orderText(name, phone, orderNo, lines, totals));
      root.innerHTML = '<div class="confirm"><div class="confirm-icon">' + icon("check") + "</div>" +
        "<h1>" + escapeHtml(tr("co.thanks", { name })) + '</h1><p class="lead">' + escapeHtml(tr("co.received")) + "</p>" +
        (orderNo ? '<div class="order-number">' + escapeHtml(tr("co.orderNo")) + ": " + escapeHtml(orderNo) + "</div>" : "") +
        '<div class="panel next-steps" style="text-align:left"><h2 class="panel-title" style="font-size:1.05rem;margin-bottom:.5rem">' + escapeHtml(tr("co.next.title")) + "</h2><ul>" +
          ["co.next1", "co.next2", "co.next3"].map((k) => "<li>" + icon("check") + "<span>" + escapeHtml(tr(k)) + "</span></li>").join("") + "</ul></div>" +
        '<div class="button-group"><a class="button button-whatsapp" href="' + wa + '" target="_blank" rel="noopener">' + icon("whatsapp", "icon-fill") + "<span>" + escapeHtml(tr("co.whatsapp")) + '</span></a><a class="button button-outline" href="shop.html">' + escapeHtml(tr("shop.continueShopping")) + "</a></div></div>";
      window.scrollTo({ top: 0, behavior: "smooth" });
      $(".confirm h1")?.setAttribute("tabindex", "-1");
      $(".confirm h1")?.focus({ preventScroll: true });
    }

    document.addEventListener("langchange", () => data && render());
    loadData().then(render).catch(() => {
      root.innerHTML = '<div class="error-state"><h3>' + escapeHtml(tr("shop.errorTitle")) + "</h3><p>" + escapeHtml(tr("shop.errorDesc")) + '</p><button type="button" class="button" onclick="location.reload()">' + escapeHtml(tr("shop.retry")) + "</button></div>";
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if ($("#product-grid")) initShop();
    else if ($("#product-detail")) initProduct();
    else if ($("#cart-content")) initCart();
    else if ($("#checkout-content")) initCheckout();
  });
})();
