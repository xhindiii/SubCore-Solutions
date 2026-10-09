/* SubCore admin panel — products, categories, services, orders, enquiries, settings.
   Talks to Supabase through SupabaseClient; every write is also enforced by RLS (is_admin()). */
(function () {
  "use strict";

  const SERVICE_ICONS = ["server", "network", "support", "cloud", "shield", "laptop", "activity", "refresh", "clipboard", "globe",
    "package", "cpu", "wifi", "drive", "printer", "tag", "award", "user", "search", "lock"];
  const ORDER_STATUS = [["pending", "New", "amber"], ["processing", "Processing", "blue"], ["completed", "Completed", "green"], ["cancelled", "Cancelled", "red"]];
  const INQ_STATUS = [["new", "New", "amber"], ["contacted", "Contacted", "blue"], ["done", "Done", "green"]];
  const SECTIONS = [
    ["dashboard", "Dashboard", "dashboard"],
    ["products", "Products", "package"],
    ["orders", "Orders", "cart"],
    ["inquiries", "Enquiries", "inbox"],
    ["categories", "Categories", "grid"],
    ["services", "Services", "support"],
    ["team", "Team", "users"],
    ["activity", "Activity", "activity"],
    ["settings", "Settings", "settings"]
  ];
  /* What each role may open. The database enforces the same rules (RLS); this only hides what would be refused. */
  const ACCESS = { admin: null, editor: ["dashboard", "products", "categories", "services", "settings"], staff: ["dashboard", "orders", "inquiries", "settings"] };
  const ROLE_LABEL = { admin: "Admin", editor: "Editor", staff: "Staff" };
  const ROLE_HELP = { admin: "Full access, including team, activity log and delivery settings.", editor: "Products, categories and services. Cannot see orders or customers.", staff: "Orders and enquiries. Cannot change the catalogue." };
  const PAGE = 20;

  const S = { admin: null, products: [], categories: [], services: [], orders: [], inquiries: null, settings: {}, section: "dashboard", team: [], audit: undefined, auditTable: "",
    pg: { products: 1, orders: 1, inquiries: 1, activity: 1 },
    pf: { q: "", cat: "", state: "", sort: "newest" }, of: { q: "", status: "" }, qf: { status: "" } };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const esc = (v) => String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (n) => '<svg class="icon" aria-hidden="true"><use href="icons.svg#' + n + '"/></svg>';
  const nm = (o) => (o && (o.en || o.sq)) || "";
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const slug = (s) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
  const fmtDate = (d) => d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const digits = (s) => String(s || "").replace(/\D/g, "");

  function waLink(phone) {
    let d = digits(phone);
    if (d.startsWith("00")) d = d.slice(2);
    else if (d.startsWith("0")) d = "355" + d.slice(1);
    else if (!d.startsWith("355") && d.length <= 9) d = "355" + d;
    return "https://wa.me/" + d;
  }
  const defaultCurrency = () => {
    const c = {};
    S.products.forEach((p) => { c[p.currency] = (c[p.currency] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || "USD";
  };
  function money(n, cur) {
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || defaultCurrency() }).format(n || 0); }
    catch { return (n || 0).toFixed(2) + " " + (cur || ""); }
  }

  /* ── Feedback ───────────────────────────────────────────────────── */
  function toast(type, text) {
    const box = $("#toasts");
    const t = document.createElement("div");
    t.className = "toast toast-" + type;
    t.setAttribute("role", type === "error" ? "alert" : "status");
    const c = document.createElement("div");
    c.className = "toast-content";
    c.textContent = text;
    t.appendChild(c);
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), type === "error" ? 7000 : 3500);
  }
  const ok = (t) => toast("success", t);
  const fail = (e, fallback) => { console.error(e); toast("error", (e && e.message) ? fallback + " — " + e.message : fallback); };

  function confirmBox(title, text, label, danger) {
    return new Promise((resolve) => {
      const bg = document.createElement("div");
      bg.className = "confirm-bg";
      bg.innerHTML = '<div class="confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="cf-t"><h3 id="cf-t">' + esc(title) + '</h3><p class="muted">' + esc(text) +
        '</p><div class="actions"><button type="button" class="button button-outline" data-no>Cancel</button><button type="button" class="button ' + (danger ? "button-danger" : "") + '" data-yes>' + esc(label || "Confirm") + "</button></div></div>";
      document.body.appendChild(bg);
      const done = (v) => { bg.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
      document.addEventListener("keydown", onKey, true);
      $("[data-no]", bg).addEventListener("click", () => done(false));
      $("[data-yes]", bg).addEventListener("click", () => done(true));
      $("[data-no]", bg).focus();
    });
  }

  /* Slide-over panel. body/footer are HTML strings. Returns { el, close }. */
  function drawer(title, bodyHtml, footerHtml) {
    const root = $("#drawer-root");
    const last = document.activeElement;
    const bg = document.createElement("div");
    bg.className = "drawer-bg";
    bg.innerHTML = '<div class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="dr-t"><div class="drawer-head"><h2 id="dr-t">' + esc(title) +
      '</h2><button type="button" class="icon-btn" data-close aria-label="Close">' + icon("x") + '</button></div><div class="drawer-body">' + bodyHtml +
      '</div>' + (footerHtml ? '<div class="drawer-foot">' + footerHtml + "</div>" : "") + "</div>";
    root.appendChild(bg);
    document.body.style.overflow = "hidden";
    const close = () => {
      bg.remove();
      if (!root.children.length) document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      last && last.focus && last.focus();
    };
    const onKey = (e) => { if (e.key === "Escape" && !$(".confirm-bg") && root.lastElementChild === bg) close(); };
    document.addEventListener("keydown", onKey);
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
    $("[data-close]", bg).addEventListener("click", close);
    const first = $("input:not([type=hidden]), select, textarea", bg);
    if (first) first.focus(); else $("[data-close]", bg).focus();
    return { el: bg, close };
  }

  const can = (id) => !S.admin || !ACCESS[S.admin.role] || ACCESS[S.admin.role].includes(id);
  const isAdmin = () => !!S.admin && S.admin.role === "admin";

  function pager(key, total) {
    const pages = Math.max(1, Math.ceil(total / PAGE));
    if (S.pg[key] > pages) S.pg[key] = pages;
    const cur = S.pg[key];
    const rows = (list) => list.slice((cur - 1) * PAGE, cur * PAGE);
    const html = total <= PAGE
      ? '<p class="muted small pager-note">' + total + (total === 1 ? " item" : " items") + "</p>"
      : '<nav class="pager" aria-label="Pages"><button type="button" class="button button-outline button-sm" data-page="' + key + '" data-dir="-1"' + (cur <= 1 ? " disabled" : "") + '>Previous</button><span>Page ' + cur + " of " + pages + " · " + total + ' items</span><button type="button" class="button button-outline button-sm" data-page="' + key + '" data-dir="1"' + (cur >= pages ? " disabled" : "") + ">Next</button></nav>";
    return { rows, html };
  }

  /* CSV with a leading BOM (Excel-friendly). Cells starting with = + - @ are prefixed so a spreadsheet never runs them as formulas. */
  function downloadCsv(name, header, rows) {
    const cell = (v) => { let t = String(v === null || v === undefined ? "" : v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const text = "\ufeff" + [header].concat(rows).map((r) => r.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = name + "-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const csvBtn = (act) => '<button type="button" class="button button-outline" data-action="' + act + '">' + icon("download") + " Export CSV</button>";

  function busy(btn, on) { if (btn) { btn.disabled = on; btn.classList.toggle("is-loading", on); } }

  /* ── Data ───────────────────────────────────────────────────────── */
  async function loadAll() {
    const safe = (p, fb) => p.catch((e) => { console.warn(e); return fb; });
    const [cat, services, orders, inquiries, settings] = await Promise.all([
      SupabaseClient.fetchCatalog(),
      safe(SupabaseClient.fetchServices(), []),
      can("orders") ? safe(SupabaseClient.fetchOrders(), []) : [],
      can("inquiries") ? safe(SupabaseClient.fetchInquiries(), null) : [],
      safe(SupabaseClient.fetchSettings(), {})
    ]);
    S.products = cat.products;
    S.categories = cat.categories;
    S.services = services;
    S.orders = orders;
    S.inquiries = inquiries;
    S.settings = settings;
    await SupabaseClient.detectExtended().catch(() => {});
    if (isAdmin()) S.audit = await safe(SupabaseClient.fetchAudit(300), null);
  }

  async function reload(what) {
    try {
      if (what === "catalog") { const c = await SupabaseClient.fetchCatalog(); S.products = c.products; S.categories = c.categories; }
      if (what === "services") S.services = await SupabaseClient.fetchServices();
      if (what === "orders") S.orders = await SupabaseClient.fetchOrders();
      if (what === "inquiries") S.inquiries = await SupabaseClient.fetchInquiries();
      if (what === "settings") S.settings = await SupabaseClient.fetchSettings();
      if (what === "team") S.team = await SupabaseClient.fetchTeam();
      if (what === "audit") S.audit = await SupabaseClient.fetchAudit(300);
    } catch (e) { fail(e, "Could not refresh data"); }
  }

  const newOrders = () => S.orders.filter((o) => o.status === "pending").length;
  const newInquiries = () => (S.inquiries || []).filter((q) => q.status === "new").length;

  /* ── Shell ──────────────────────────────────────────────────────── */
  function renderNav() {
    const badge = { orders: newOrders(), inquiries: newInquiries() };
    const make = (cls) => SECTIONS.filter((x) => can(x[0])).map(([id, label, ic]) =>
      '<button type="button" class="nav-btn" data-nav="' + id + '"' + (S.section === id ? ' aria-current="page"' : "") + ">" + icon(ic) + "<span>" + label + "</span>" +
      (badge[id] ? '<span class="nav-badge">' + badge[id] + "</span>" : "") + "</button>").join("");
    $("#nav").innerHTML = make();
    $("#tabbar").innerHTML = make();
  }

  function renderNotice() {
    const n = $("#notice");
    const msgs = [];
    if (!SupabaseClient.extended) msgs.push("The store upgrade is not installed in your database yet, so brand, SKU, sale price, extra photos and specifications are not saved. Run <strong>supabase-migration-v3-store.sql</strong> in the Supabase SQL editor.");
    if (S.inquiries === null && can("inquiries")) msgs.push("Enquiries are not being stored yet — the same migration creates that table.");
    if (isAdmin() && S.audit === null) msgs.push("Roles, the activity log and team management are not installed yet. Run <strong>supabase-migration-v4-security.sql</strong> in the Supabase SQL editor.");
    n.hidden = !msgs.length;
    n.innerHTML = msgs.join("<br>");
  }

  function go(section) {
    if (!SECTIONS.some((s) => s[0] === section) || !can(section)) section = "dashboard";
    S.section = section;
    if (location.hash !== "#" + section) history.replaceState(null, "", "#" + section);
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    renderNav();
    renderNotice();
    const title = SECTIONS.find((s) => s[0] === S.section)[1];
    $("#page-title").textContent = title;
    document.title = title + " — SubCore Admin";
    const actions = $("#page-actions");
    actions.innerHTML = "";
    const view = $("#view");
    ({ dashboard: viewDashboard, products: viewProducts, orders: viewOrders, inquiries: viewInquiries, categories: viewCategories, services: viewServices, team: viewTeam, activity: viewActivity, settings: viewSettings })[S.section](view, actions);
  }

  /* ── Dashboard ──────────────────────────────────────────────────── */
  function viewDashboard(view) {
    const active = S.products.filter((p) => p.available);
    const out = S.products.filter((p) => p.available && p.stock === 0);
    const low = S.products.filter((p) => p.available && p.stock > 0 && p.stock <= 5);
    const value = S.orders.filter((o) => o.status !== "cancelled").reduce((a, o) => a + o.total, 0);
    const recent = S.orders.slice(0, 6);
    const attention = out.concat(low).slice(0, 8);
    const desk = can("orders");
    view.innerHTML =
      '<div class="stats">' +
      stat("Products on sale", active.length, S.products.length - active.length + " hidden") +
      (desk ? stat("New orders", newOrders(), S.orders.length + " in total", newOrders() > 0) +
      stat("New enquiries", S.inquiries === null ? "–" : newInquiries(), S.inquiries === null ? "not installed" : S.inquiries.length + " in total", newInquiries() > 0) : "") +
      stat("Stock alerts", out.length + low.length, out.length + " sold out · " + low.length + " running low", out.length + low.length > 0) +
      (desk ? stat("Order value", money(value), "excluding cancelled") : "") + "</div>" +
      '<div class="cols">' + (!desk ? "" : '<section class="card"><div class="card-head"><h2>Latest orders</h2><button type="button" class="button button-outline button-sm" data-nav="orders">View all</button></div>' +
      (recent.length ? recent.map((o) => '<div class="list-row"><div><strong>' + esc(o.order_number || "#" + o.id) + "</strong> · " + esc(o.customer_name) + '<div class="muted small">' + esc(fmtDate(o.created_at)) + "</div></div><div>" + pill(o.status, ORDER_STATUS) + ' <strong class="num">' + money(o.total) + "</strong></div></div>").join("") : '<div class="empty">No orders yet. They appear here as soon as a customer checks out.</div>') +
      '</section>') + '<section class="card"><div class="card-head"><h2>Needs attention</h2></div>' +
      (attention.length ? attention.map((p) => '<div class="list-row"><span>' + esc(nm(p.name)) + '</span><span class="pill ' + (p.stock === 0 ? "red" : "amber") + '">' + (p.stock === 0 ? "Sold out" : p.stock + " left") + "</span></div>").join("") : '<div class="empty">Stock levels look fine.</div>') +
      "</section></div>";
    if (!S.products.length) view.insertAdjacentHTML("afterbegin", '<div class="card" style="margin-bottom:1.25rem"><div class="card-body"><strong>Start here:</strong> add your first category, then your first product. <button type="button" class="button button-sm" data-nav="products" style="margin-left:.5rem">Add products</button></div></div>');
  }
  function stat(label, value, hint, warn) {
    return '<div class="stat' + (warn ? " warn" : "") + '"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + '</div><div class="hint">' + esc(hint || "") + "</div></div>";
  }
  function pill(status, defs) {
    const d = defs.find((x) => x[0] === status) || [status, status, ""];
    return '<span class="pill ' + d[2] + '">' + esc(d[1]) + "</span>";
  }

  /* ── Products ───────────────────────────────────────────────────── */
  function filteredProducts() {
    const q = norm(S.pf.q);
    const sorters = { newest: null, name: (a, b) => nm(a.name).localeCompare(nm(b.name)), "price-asc": (a, b) => a.price - b.price, "price-desc": (a, b) => b.price - a.price, "stock-asc": (a, b) => a.stock - b.stock };
    const out = S.products.filter((p) => {
      if (S.pf.cat && p.category !== S.pf.cat) return false;
      if (S.pf.state === "hidden" && p.available) return false;
      if (S.pf.state === "visible" && !p.available) return false;
      if (S.pf.state === "out" && p.stock > 0) return false;
      if (S.pf.state === "low" && !(p.stock > 0 && p.stock <= 5)) return false;
      if (q && !norm([nm(p.name), p.name.sq, p.sku, p.brand, p.id].join(" ")).includes(q)) return false;
      return true;
    });
    return sorters[S.pf.sort] ? out.slice().sort(sorters[S.pf.sort]) : out;
  }
  const catName = (id) => { const c = S.categories.find((x) => x.id === id); return c ? nm(c.name) : "—"; };

  function viewProducts(view, actions) {
    actions.innerHTML = csvBtn("csv-products") + '<button type="button" class="button" data-action="new-product">' + icon("plus") + " Add product</button>";
    view.innerHTML =
      '<div class="toolbar"><input type="search" id="pf-q" placeholder="Search name, SKU, brand" value="' + esc(S.pf.q) + '" aria-label="Search products">' +
      '<select id="pf-cat" aria-label="Category"><option value="">All categories</option>' + S.categories.map((c) => '<option value="' + esc(c.id) + '"' + (S.pf.cat === c.id ? " selected" : "") + ">" + esc(nm(c.name)) + "</option>").join("") + "</select>" +
      '<select id="pf-state" aria-label="Status">' + [["", "All statuses"], ["visible", "Visible"], ["hidden", "Hidden"], ["low", "Low stock"], ["out", "Sold out"]].map((o) => '<option value="' + o[0] + '"' + (S.pf.state === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select>" +
      '<select id="pf-sort" aria-label="Sort by">' + [["newest", "Newest first"], ["name", "Name A–Z"], ["price-asc", "Price: low to high"], ["price-desc", "Price: high to low"], ["stock-asc", "Stock: lowest first"]].map((o) => '<option value="' + o[0] + '"' + (S.pf.sort === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select></div>" +
      '<div id="plist"></div>';
    $("#pf-q").addEventListener("input", (e) => { S.pf.q = e.target.value; S.pg.products = 1; drawProductList(); });
    $("#pf-cat").addEventListener("change", (e) => { S.pf.cat = e.target.value; S.pg.products = 1; drawProductList(); });
    $("#pf-state").addEventListener("change", (e) => { S.pf.state = e.target.value; S.pg.products = 1; drawProductList(); });
    $("#pf-sort").addEventListener("change", (e) => { S.pf.sort = e.target.value; S.pg.products = 1; drawProductList(); });
    drawProductList();
  }

  function drawProductList() {
    const all = filteredProducts();
    const pg = pager("products", all.length);
    const list = pg.rows(all);
    const box = $("#plist");
    if (!box) return;
    if (!all.length) {
      box.innerHTML = '<div class="card"><div class="empty">' + (S.products.length ? "No products match these filters." : 'No products yet.<br><br><button type="button" class="button" data-action="new-product">' + icon("plus") + " Add your first product</button>") + "</div></div>";
      return;
    }
    const thumb = (p) => p.image ? '<img class="thumb" src="' + esc(p.image) + '" alt="" loading="lazy">' : '<span class="thumb">' + icon("image") + "</span>";
    const stockInput = (p) => '<input type="number" min="0" step="1" value="' + p.stock + '" data-stock="' + esc(p.id) + '" class="status-select" style="width:76px" aria-label="Stock for ' + esc(nm(p.name)) + '">';
    const sw = (p, key, label) => '<label class="switch" title="' + label + '"><input type="checkbox" data-toggle="' + key + '" data-id="' + esc(p.id) + '"' + (p[key] ? " checked" : "") + ' aria-label="' + label + " " + esc(nm(p.name)) + '"><span></span></label>';
    const acts = (p) => '<div class="row-actions"><button type="button" class="icon-btn" data-action="edit-product" data-id="' + esc(p.id) + '" aria-label="Edit">' + icon("edit") + '</button><button type="button" class="icon-btn" data-action="dup-product" data-id="' + esc(p.id) + '" aria-label="Duplicate" title="Duplicate">' + icon("clipboard") + '</button><button type="button" class="icon-btn danger" data-action="del-product" data-id="' + esc(p.id) + '" aria-label="Delete">' + icon("trash") + "</button></div>";
    box.innerHTML =
      '<div class="table-wrap has-cards"><table class="data collapse"><thead><tr><th>Product</th><th>Category</th><th class="num">Price</th><th>Stock</th><th>Visible</th><th>Featured</th><th></th></tr></thead><tbody>' +
      list.map((p) => '<tr><td><div class="cell-prod">' + thumb(p) + "<div><strong>" + esc(nm(p.name)) + "</strong><small>" + esc([p.brand, p.sku].filter(Boolean).join(" · ")) + "</small></div></div></td><td>" + esc(catName(p.category)) +
        '</td><td class="num">' + money(p.price, p.currency) + (p.compare_price ? '<br><small class="muted"><s>' + money(p.compare_price, p.currency) + "</s></small>" : "") + "</td><td>" + stockInput(p) + "</td><td>" + sw(p, "available", "Visible") + "</td><td>" + sw(p, "featured", "Featured") + "</td><td>" + acts(p) + "</td></tr>").join("") +
      "</tbody></table></div>" +
      '<div class="cards">' + list.map((p) => '<div class="m-card"><div class="top"><div class="cell-prod" style="min-width:0">' + thumb(p) + "<div><strong>" + esc(nm(p.name)) + "</strong><small>" + esc(catName(p.category)) + '</small></div></div><strong class="num">' + money(p.price, p.currency) + '</strong></div><div class="meta"><label>Stock ' + stockInput(p) + '</label><label class="check-line">' + sw(p, "available", "Visible") + 'Visible</label></div><div class="bottom"><label class="check-line">' + sw(p, "featured", "Featured") + "Featured</label>" + acts(p) + "</div></div>").join("") + "</div>" +
      pg.html;
  }

  async function quickUpdate(id, fields) {
    try {
      await SupabaseClient.setProductFields(id, fields);
      const p = S.products.find((x) => x.id === id);
      if (p) Object.assign(p, fields);
      ok("Saved");
      renderNav();
    } catch (e) { fail(e, "Could not save"); await reload("catalog"); drawProductList(); }
  }

  /* Product form */
  function productForm(p, isNew) {
    const st = { images: (p.images || []).slice(), specs: (p.specs || []).map((s) => ({ en: (s.label && s.label.en) || "", sq: (s.label && s.label.sq) || "", value: (s.value && (s.value.en || s.value.sq)) || "" })), uploading: 0 };
    const ext = SupabaseClient.extended;
    const cats = S.categories.map((c) => '<option value="' + esc(c.id) + '"' + (p.category === c.id ? " selected" : "") + ">" + esc(nm(c.name)) + "</option>").join("");
    const val = (v) => esc(v === null || v === undefined ? "" : v);
    const body =
      '<form id="pform" novalidate>' +
      '<fieldset class="fieldset"><legend>Name & description</legend>' +
      '<div class="form-row"><div class="form-group"><label for="f-name-sq">Name (Albanian)</label><input id="f-name-sq" value="' + val(p.name.sq) + '" maxlength="120"></div>' +
      '<div class="form-group"><label for="f-name-en">Name (English)</label><input id="f-name-en" value="' + val(p.name.en) + '" maxlength="120"></div></div>' +
      '<div class="form-group"><label for="f-desc-sq">Description (Albanian)</label><textarea id="f-desc-sq" rows="3" maxlength="2000">' + val(p.description.sq) + "</textarea></div>" +
      '<div class="form-group"><label for="f-desc-en">Description (English)</label><textarea id="f-desc-en" rows="3" maxlength="2000">' + val(p.description.en) + '</textarea><div class="help">Fill in one language and the other is copied automatically if left empty.</div></div></fieldset>' +
      '<fieldset class="fieldset"><legend>Photos</legend><div class="img-grid" id="f-imgs"></div><div class="help" style="margin-top:.5rem">First photo is the main one. JPG, PNG or WebP, up to 5 MB each.</div>' +
      '<div style="display:flex;gap:.5rem;margin-top:.6rem"><input id="f-url" type="url" placeholder="…or paste an image URL" style="flex:1"><button type="button" class="button button-outline" id="f-url-add">Add</button></div></fieldset>' +
      '<fieldset class="fieldset"><legend>Pricing & stock</legend><div class="form-row">' +
      '<div class="form-group"><label for="f-price">Price</label><input id="f-price" inputmode="decimal" value="' + val(p.price) + '"></div>' +
      '<div class="form-group"><label for="f-compare">Old price (optional)</label><input id="f-compare" inputmode="decimal" value="' + val(p.compare_price) + '"' + (ext ? "" : " disabled") + '><div class="help">Shown crossed out with a % badge.</div></div>' +
      '<div class="form-group"><label for="f-cur">Currency</label><select id="f-cur">' + ["USD", "EUR", "ALL"].map((c) => '<option' + (p.currency === c ? " selected" : "") + ">" + c + "</option>").join("") + "</select></div>" +
      '<div class="form-group"><label for="f-stock">In stock</label><input id="f-stock" type="number" min="0" step="1" value="' + val(p.stock) + '"></div></div></fieldset>' +
      '<fieldset class="fieldset"><legend>Organisation</legend><div class="form-row">' +
      '<div class="form-group"><label for="f-cat">Category</label><select id="f-cat"><option value="">— None —</option>' + cats + "</select></div>" +
      '<div class="form-group"><label for="f-brand">Brand</label><input id="f-brand" value="' + val(p.brand) + '" maxlength="60"' + (ext ? "" : " disabled") + "></div>" +
      '<div class="form-group"><label for="f-sku">SKU</label><input id="f-sku" value="' + val(p.sku) + '" maxlength="60"' + (ext ? "" : " disabled") + "></div></div>" +
      '<label class="check-line"><span class="switch"><input type="checkbox" id="f-available"' + (p.available ? " checked" : "") + '><span></span></span>Visible in the shop</label>' +
      '<label class="check-line"><span class="switch"><input type="checkbox" id="f-featured"' + (p.featured ? " checked" : "") + '><span></span></span>Featured (shown on the home page)</label></fieldset>' +
      '<fieldset class="fieldset"' + (ext ? "" : " disabled") + '><legend>Specifications</legend><div id="f-specs"></div><button type="button" class="button button-outline button-sm" id="f-spec-add">' + icon("plus") + " Add specification</button></fieldset>" +
      "</form>";
    const dr = drawer(isNew ? "New product" : "Edit product", body,
      '<button type="button" class="button button-outline" data-close2>Cancel</button><button type="button" class="button" id="f-save">Save product</button>');
    const root = dr.el;
    $("[data-close2]", root).addEventListener("click", dr.close);

    function drawImages() {
      const g = $("#f-imgs", root);
      g.innerHTML = st.images.map((u, i) =>
        '<div class="img-tile"><img src="' + esc(u) + '" alt="">' + (i === 0 ? '<span class="main-flag">Main</span>' : "") +
        '<div class="tile-actions">' + (i > 0 ? '<button type="button" data-main="' + i + '">Make main</button>' : "<span></span>") + '<button type="button" data-rm="' + i + '">Remove</button></div></div>').join("") +
        Array.from({ length: st.uploading }, () => '<div class="img-tile"><span class="dropzone" style="height:100%;border:0">Uploading…</span></div>').join("") +
        '<label class="dropzone" id="f-drop">' + icon("upload") + "<span>Add photos</span><input type=\"file\" accept=\"image/jpeg,image/png,image/webp,image/gif\" multiple></label>";
      const input = $("#f-drop input", root);
      input.addEventListener("change", () => upload([...input.files]));
      const dz = $("#f-drop", root);
      ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
      ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
      dz.addEventListener("drop", (e) => upload([...e.dataTransfer.files]));
    }
    async function upload(files) {
      files = files.filter((f) => /^image\//.test(f.type));
      for (const f of files) {
        if (f.size > 5 * 1024 * 1024) { toast("error", f.name + " is larger than 5 MB"); continue; }
        st.uploading++; drawImages();
        try { st.images.push(await SupabaseClient.uploadImage(f)); }
        catch (e) { fail(e, "Upload failed for " + f.name); }
        st.uploading--; drawImages();
      }
    }
    root.addEventListener("click", (e) => {
      const m = e.target.closest("[data-main]"), r = e.target.closest("[data-rm]");
      if (m) { const i = +m.dataset.main; st.images.unshift(st.images.splice(i, 1)[0]); drawImages(); }
      if (r) { st.images.splice(+r.dataset.rm, 1); drawImages(); }
      const sr = e.target.closest("[data-spec-rm]");
      if (sr) { syncSpecs(); st.specs.splice(+sr.dataset.specRm, 1); drawSpecs(); }
    });
    $("#f-url-add", root).addEventListener("click", () => {
      const u = $("#f-url", root).value.trim();
      if (!/^https?:\/\//i.test(u)) { toast("error", "Enter a full image address starting with https://"); return; }
      st.images.push(u); $("#f-url", root).value = ""; drawImages();
    });

    function drawSpecs() {
      $("#f-specs", root).innerHTML = st.specs.map((s, i) =>
        '<div class="spec-row"><input data-sp="en" data-i="' + i + '" placeholder="Label (English)" value="' + esc(s.en) + '"><input data-sp="sq" data-i="' + i + '" placeholder="Label (Albanian)" value="' + esc(s.sq) + '"><input data-sp="value" data-i="' + i + '" placeholder="Value" value="' + esc(s.value) + '" style="grid-column:1/3"><button type="button" class="icon-btn danger" data-spec-rm="' + i + '" aria-label="Remove">' + icon("trash") + "</button></div>").join("");
    }
    function syncSpecs() { $$("[data-sp]", root).forEach((el) => { st.specs[+el.dataset.i][el.dataset.sp] = el.value; }); }
    $("#f-spec-add", root).addEventListener("click", () => { syncSpecs(); st.specs.push({ en: "", sq: "", value: "" }); drawSpecs(); $$("[data-sp='en']", root).pop().focus(); });
    drawImages(); drawSpecs();

    $("#f-save", root).addEventListener("click", async (ev) => {
      syncSpecs();
      const g = (id) => $("#" + id, root).value.trim();
      let nsq = g("f-name-sq"), nen = g("f-name-en");
      if (!nsq && !nen) { toast("error", "Please enter a product name"); $("#f-name-sq", root).focus(); return; }
      nsq = nsq || nen; nen = nen || nsq;
      const dsq = g("f-desc-sq") || g("f-desc-en"), den = g("f-desc-en") || g("f-desc-sq");
      const price = num(g("f-price"));
      if (!Number.isFinite(price) || price < 0) { toast("error", "Enter a valid price"); $("#f-price", root).focus(); return; }
      const stock = parseInt(g("f-stock") || "0", 10);
      if (!Number.isInteger(stock) || stock < 0) { toast("error", "Stock must be 0 or more"); $("#f-stock", root).focus(); return; }
      let compare = g("f-compare") ? num(g("f-compare")) : null;
      if (compare !== null && (!Number.isFinite(compare) || compare <= price)) { toast("error", "The old price must be higher than the price"); $("#f-compare", root).focus(); return; }
      if (st.uploading) { toast("error", "Wait for the photos to finish uploading"); return; }
      let id = p.id;
      if (isNew) {
        const base = slug(nen) || "product";
        id = base;
        while (S.products.some((x) => x.id === id)) id = base + "-" + Math.random().toString(36).slice(2, 6);
      }
      const product = {
        id, name: { sq: nsq, en: nen }, description: { sq: dsq, en: den }, price, currency: g("f-cur"), stock, compare_price: compare,
        category: $("#f-cat", root).value || null, brand: g("f-brand"), sku: g("f-sku"),
        available: $("#f-available", root).checked, featured: $("#f-featured", root).checked, images: st.images,
        specs: st.specs.filter((s) => (s.en || s.sq) && s.value).map((s) => ({ label: { en: s.en || s.sq, sq: s.sq || s.en }, value: { en: s.value, sq: s.value } }))
      };
      busy(ev.currentTarget, true);
      try {
        await SupabaseClient.upsertProduct(product);
        ok(isNew ? "Product added" : "Product saved");
        dr.close();
        await reload("catalog");
        render();
      } catch (e) { fail(e, "Could not save the product"); busy(ev.currentTarget, false); }
    });
  }
  const blankProduct = () => ({ id: "", name: { sq: "", en: "" }, description: { sq: "", en: "" }, price: "", compare_price: null, currency: defaultCurrency(), category: S.pf.cat || "", brand: "", sku: "", images: [], specs: [], stock: 1, available: true, featured: false });

  async function deleteProduct(id) {
    const p = S.products.find((x) => x.id === id);
    if (!p) return;
    if (!(await confirmBox("Delete this product?", "“" + nm(p.name) + "” will be removed from the shop for good. Past orders keep their own copy. To just hide it, switch off “Visible” instead.", "Delete", true))) return;
    try { await SupabaseClient.deleteProduct(id); ok("Product deleted"); await reload("catalog"); render(); }
    catch (e) { fail(e, "Could not delete the product"); }
  }

  /* ── Categories ─────────────────────────────────────────────────── */
  function viewCategories(view, actions) {
    actions.innerHTML = '<button type="button" class="button" data-action="new-category">' + icon("plus") + " Add category</button>";
    if (!S.categories.length) { view.innerHTML = '<div class="card"><div class="empty">No categories yet. Categories become the filters customers use in the shop.</div></div>'; return; }
    view.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr><th>Category</th><th>Albanian</th><th class="num">Products</th><th></th></tr></thead><tbody>' +
      S.categories.map((c) => { const n = S.products.filter((p) => p.category === c.id).length; return "<tr><td><strong>" + esc(c.name.en || c.id) + "</strong></td><td>" + esc(c.name.sq) + '</td><td class="num">' + n + '</td><td><div class="row-actions"><button type="button" class="icon-btn" data-action="edit-category" data-id="' + esc(c.id) + '" aria-label="Edit">' + icon("edit") + '</button><button type="button" class="icon-btn danger" data-action="del-category" data-id="' + esc(c.id) + '" aria-label="Delete">' + icon("trash") + "</button></div></td></tr>"; }).join("") + "</tbody></table></div>";
  }
  function categoryForm(c) {
    const isNew = !c;
    const dr = drawer(isNew ? "New category" : "Edit category",
      '<form id="cform" novalidate><div class="form-group"><label for="c-sq">Name (Albanian)</label><input id="c-sq" value="' + esc(c ? c.name.sq : "") + '" maxlength="60"></div><div class="form-group"><label for="c-en">Name (English)</label><input id="c-en" value="' + esc(c ? c.name.en : "") + '" maxlength="60"></div></form>',
      '<button type="button" class="button button-outline" data-close2>Cancel</button><button type="button" class="button" id="c-save">Save</button>');
    $("[data-close2]", dr.el).addEventListener("click", dr.close);
    $("#cform", dr.el).addEventListener("submit", (e) => e.preventDefault());
    $("#c-save", dr.el).addEventListener("click", async (ev) => {
      let sq = $("#c-sq", dr.el).value.trim(), en = $("#c-en", dr.el).value.trim();
      if (!sq && !en) { toast("error", "Enter a category name"); return; }
      sq = sq || en; en = en || sq;
      let id = c ? c.id : slug(en) || "category";
      if (isNew) { const b = id; while (S.categories.some((x) => x.id === id)) id = b + "-" + Math.random().toString(36).slice(2, 5); }
      busy(ev.currentTarget, true);
      try { await SupabaseClient.upsertCategory({ id, slug: c ? c.slug : id, name: { sq, en } }); ok("Category saved"); dr.close(); await reload("catalog"); render(); }
      catch (e) { fail(e, "Could not save the category"); busy(ev.currentTarget, false); }
    });
  }
  async function deleteCategory(id) {
    const n = S.products.filter((p) => p.category === id).length;
    if (n) { toast("error", "Move or delete the " + n + " product" + (n > 1 ? "s" : "") + " in this category first"); return; }
    if (!(await confirmBox("Delete this category?", "It will disappear from the shop filters.", "Delete", true))) return;
    try { await SupabaseClient.deleteCategory(id); ok("Category deleted"); await reload("catalog"); render(); }
    catch (e) { fail(e, "Could not delete the category"); }
  }

  /* ── Services ───────────────────────────────────────────────────── */
  function viewServices(view, actions) {
    actions.innerHTML = '<button type="button" class="button" data-action="new-service">' + icon("plus") + " Add service</button>";
    const intro = '<p class="muted" style="margin-bottom:1rem;max-width:62ch">Services you add here replace the built-in list on the Home and Services pages. Leave this empty to keep the built-in list.</p>';
    if (!S.services.length) { view.innerHTML = intro + '<div class="card"><div class="empty">No custom services yet.</div></div>'; return; }
    view.innerHTML = intro + '<div class="table-wrap"><table class="data"><thead><tr><th>Order</th><th>Service</th><th class="num">From</th><th>Visible</th><th></th></tr></thead><tbody>' +
      S.services.map((s) => '<tr><td>' + s.display_order + "</td><td><strong>" + esc(nm(s.name)) + "</strong>" + (s.featured ? ' <span class="pill blue">Home</span>' : "") + '</td><td class="num">' + (s.price ? money(s.price, s.currency) : "—") + '</td><td><label class="switch"><input type="checkbox" data-svc-toggle="' + esc(s.id) + '"' + (s.available ? " checked" : "") + ' aria-label="Visible ' + esc(nm(s.name)) + '"><span></span></label></td><td><div class="row-actions"><button type="button" class="icon-btn" data-action="edit-service" data-id="' + esc(s.id) + '" aria-label="Edit">' + icon("edit") + '</button><button type="button" class="icon-btn danger" data-action="del-service" data-id="' + esc(s.id) + '" aria-label="Delete">' + icon("trash") + "</button></div></td></tr>").join("") + "</tbody></table></div>";
  }
  function serviceForm(s) {
    const isNew = !s;
    s = s || { id: "", name: { sq: "", en: "" }, description: { sq: "", en: "" }, price: 0, currency: defaultCurrency(), icon: "server", featured: false, display_order: S.services.length + 1, available: true };
    const v = (x) => esc(x === null || x === undefined ? "" : x);
    const dr = drawer(isNew ? "New service" : "Edit service",
      '<form id="sform" novalidate><div class="form-row"><div class="form-group"><label for="s-sq">Name (Albanian)</label><input id="s-sq" value="' + v(s.name.sq) + '" maxlength="80"></div><div class="form-group"><label for="s-en">Name (English)</label><input id="s-en" value="' + v(s.name.en) + '" maxlength="80"></div></div>' +
      '<div class="form-group"><label for="s-dsq">Description (Albanian)</label><textarea id="s-dsq" rows="3" maxlength="400">' + v(s.description.sq) + '</textarea></div><div class="form-group"><label for="s-den">Description (English)</label><textarea id="s-den" rows="3" maxlength="400">' + v(s.description.en) + "</textarea></div>" +
      '<div class="form-row"><div class="form-group"><label for="s-price">Starting price (0 = hide)</label><input id="s-price" inputmode="decimal" value="' + v(s.price) + '"></div><div class="form-group"><label for="s-cur">Currency</label><select id="s-cur">' + ["USD", "EUR", "ALL"].map((c) => "<option" + (s.currency === c ? " selected" : "") + ">" + c + "</option>").join("") + '</select></div><div class="form-group"><label for="s-order">Display order</label><input id="s-order" type="number" step="1" value="' + v(s.display_order) + '"></div></div>' +
      '<div class="form-group"><label for="s-icon">Icon</label><select id="s-icon">' + SERVICE_ICONS.map((i) => "<option" + (s.icon === i ? " selected" : "") + ">" + i + "</option>").join("") + "</select></div>" +
      '<label class="check-line"><span class="switch"><input type="checkbox" id="s-feat"' + (s.featured ? " checked" : "") + '><span></span></span>Show on the home page</label><label class="check-line"><span class="switch"><input type="checkbox" id="s-av"' + (s.available ? " checked" : "") + "><span></span></span>Visible</label></form>",
      '<button type="button" class="button button-outline" data-close2>Cancel</button><button type="button" class="button" id="s-save">Save</button>');
    $("[data-close2]", dr.el).addEventListener("click", dr.close);
    $("#s-save", dr.el).addEventListener("click", async (ev) => {
      const g = (id) => $("#" + id, dr.el).value.trim();
      let sq = g("s-sq"), en = g("s-en");
      if (!sq && !en) { toast("error", "Enter a service name"); return; }
      sq = sq || en; en = en || sq;
      const price = g("s-price") ? num(g("s-price")) : 0;
      if (!Number.isFinite(price) || price < 0) { toast("error", "Enter a valid price"); return; }
      let id = s.id;
      if (isNew) { id = slug(en) || "service"; const b = id; while (S.services.some((x) => x.id === id)) id = b + "-" + Math.random().toString(36).slice(2, 5); }
      busy(ev.currentTarget, true);
      try {
        await SupabaseClient.upsertService({ id, name: { sq, en }, description: { sq: g("s-dsq") || g("s-den"), en: g("s-den") || g("s-dsq") }, price, currency: g("s-cur"), icon: g("s-icon"), featured: $("#s-feat", dr.el).checked, display_order: parseInt(g("s-order") || "0", 10) || 0, available: $("#s-av", dr.el).checked });
        ok("Service saved"); dr.close(); await reload("services"); render();
      } catch (e) { fail(e, "Could not save the service"); busy(ev.currentTarget, false); }
    });
  }
  async function deleteService(id) {
    if (!(await confirmBox("Delete this service?", "It will be removed from the website.", "Delete", true))) return;
    try { await SupabaseClient.deleteService(id); ok("Service deleted"); await reload("services"); render(); }
    catch (e) { fail(e, "Could not delete the service"); }
  }

  /* ── Orders ─────────────────────────────────────────────────────── */
  function viewOrders(view, actions) {
    if (actions) actions.innerHTML = csvBtn("csv-orders");
    const q = norm(S.of.q);
    let list = S.orders.filter((o) => (!S.of.status || o.status === S.of.status) && (!q || norm([o.order_number, o.id, o.customer_name, o.customer_phone, o.customer_email].join(" ")).includes(q)));
    view.innerHTML = '<div class="toolbar"><input type="search" id="of-q" placeholder="Search order no., name, phone" value="' + esc(S.of.q) + '" aria-label="Search orders"><select id="of-s" aria-label="Status"><option value="">All statuses</option>' + ORDER_STATUS.map((s) => '<option value="' + s[0] + '"' + (S.of.status === s[0] ? " selected" : "") + ">" + s[1] + "</option>").join("") + '</select></div><div id="olist"></div>';
    $("#of-q").addEventListener("input", (e) => { S.of.q = e.target.value; S.pg.orders = 1; viewOrders(view); $("#of-q").focus(); $("#of-q").setSelectionRange(99, 99); });
    $("#of-s").addEventListener("change", (e) => { S.of.status = e.target.value; S.pg.orders = 1; viewOrders(view); });
    const box = $("#olist");
    if (!list.length) { box.innerHTML = '<div class="card"><div class="empty">' + (S.orders.length ? "No orders match." : "No orders yet.") + "</div></div>"; return; }
    const items = (o) => o.items.reduce((a, i) => a + (i.qty || 0), 0);
    const opg = pager("orders", list.length); const all = list; list = opg.rows(all);
    box.innerHTML = '<div class="table-wrap has-cards"><table class="data collapse"><thead><tr><th>Order</th><th>Customer</th><th>Date</th><th class="num">Items</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>' +
      list.map((o) => '<tr style="cursor:pointer" data-action="open-order" data-id="' + o.id + '" tabindex="0"><td><strong>' + esc(o.order_number || "#" + o.id) + "</strong></td><td>" + esc(o.customer_name) + '<br><small class="muted">' + esc(o.customer_phone) + "</small></td><td>" + esc(fmtDate(o.created_at)) + '</td><td class="num">' + items(o) + '</td><td class="num">' + money(o.total) + "</td><td>" + pill(o.status, ORDER_STATUS) + "</td></tr>").join("") + "</tbody></table></div>" +
      '<div class="cards">' + list.map((o) => '<div class="m-card" data-action="open-order" data-id="' + o.id + '"><div class="top"><div><strong>' + esc(o.order_number || "#" + o.id) + "</strong><br>" + esc(o.customer_name) + "</div>" + pill(o.status, ORDER_STATUS) + '</div><div class="meta"><span>' + esc(fmtDate(o.created_at)) + "</span><span>" + items(o) + ' items</span></div><div class="bottom"><span class="muted small">' + esc(o.customer_phone) + "</span><strong>" + money(o.total) + "</strong></div></div>").join("") + "</div>" + opg.html;
  }
  function orderDetail(id) {
    const o = S.orders.find((x) => String(x.id) === String(id));
    if (!o) return;
    const wa = waLink(o.customer_phone);
    const lines = o.items.map((i) => '<tr><td>' + esc(nm(i.name) || i.id) + (i.sku ? '<br><small class="muted">' + esc(i.sku) + "</small>" : "") + '</td><td class="num">' + (i.qty || 0) + ' × ' + money(i.price || 0, i.currency) + '</td><td class="num">' + money((i.price || 0) * (i.qty || 0), i.currency) + "</td></tr>").join("");
    const dr = drawer("Order " + (o.order_number || "#" + o.id),
      '<dl class="kv"><dt>Placed</dt><dd>' + esc(fmtDate(o.created_at)) + "</dd><dt>Customer</dt><dd>" + esc(o.customer_name) + '</dd><dt>Phone</dt><dd><a href="tel:' + esc(o.customer_phone) + '">' + esc(o.customer_phone) + "</a></dd>" +
      (o.customer_email ? '<dt>Email</dt><dd><a href="mailto:' + esc(o.customer_email) + '">' + esc(o.customer_email) + "</a></dd>" : "") +
      "<dt>Address</dt><dd>" + esc(o.delivery_address) + "</dd>" + (o.notes ? "<dt>Notes</dt><dd>" + esc(o.notes) + "</dd>" : "") + "<dt>Payment</dt><dd>Cash on delivery</dd></dl>" +
      '<table class="items-table"><thead><tr><th>Item</th><th class="num">Qty × price</th><th class="num">Total</th></tr></thead><tbody>' + lines + "</tbody><tfoot>" +
      (o.shipping ? '<tr><td colspan="2">Delivery</td><td class="num">' + money(o.shipping) + "</td></tr>" : "") + '<tr><td colspan="2"><strong>Total</strong></td><td class="num"><strong>' + money(o.total) + "</strong></td></tr></tfoot></table>" +
      '<div class="form-group" style="margin-top:1.25rem"><label for="o-status">Status</label><select id="o-status">' + ORDER_STATUS.map((s) => '<option value="' + s[0] + '"' + (o.status === s[0] ? " selected" : "") + ">" + s[1] + "</option>").join("") + '</select><div class="help">Cancelling an order puts its items back in stock.</div></div>',
      '<a class="button button-outline" href="tel:' + esc(o.customer_phone) + '">Call</a><a class="button button-outline" target="_blank" rel="noopener" href="' + esc(wa) + '">WhatsApp</a><button type="button" class="button" id="o-save">Update status</button>');
    $("#o-save", dr.el).addEventListener("click", async (ev) => {
      const status = $("#o-status", dr.el).value;
      if (status === o.status) { dr.close(); return; }
      if (status === "cancelled" && !(await confirmBox("Cancel this order?", "The items go back into stock. You can set another status later, but stock will not be taken again.", "Cancel order", true))) return;
      busy(ev.currentTarget, true);
      try { await SupabaseClient.updateOrderStatus(o.id, status); ok("Order updated"); dr.close(); await Promise.all([reload("orders"), reload("catalog")]); render(); }
      catch (e) { fail(e, "Could not update the order"); busy(ev.currentTarget, false); }
    });
  }

  /* ── Enquiries ──────────────────────────────────────────────────── */
  function viewInquiries(view, actions) {
    if (actions && S.inquiries) actions.innerHTML = csvBtn("csv-inquiries");
    if (S.inquiries === null) { view.innerHTML = '<div class="card"><div class="empty">The enquiries table is not installed yet.<br>Run <strong>supabase-migration-v3-store.sql</strong> in Supabase to start collecting contact-form and service requests here.</div></div>'; return; }
    const all = S.inquiries.filter((q) => !S.qf.status || q.status === S.qf.status);
    const qpg = pager("inquiries", all.length);
    const list = qpg.rows(all);
    view.innerHTML = '<div class="toolbar"><select id="qf-s" aria-label="Status"><option value="">All statuses</option>' + INQ_STATUS.map((s) => '<option value="' + s[0] + '"' + (S.qf.status === s[0] ? " selected" : "") + ">" + s[1] + "</option>").join("") + '</select></div>';
    $("#qf-s").addEventListener("change", (e) => { S.qf.status = e.target.value; S.pg.inquiries = 1; viewInquiries(view); });
    if (!list.length) { view.insertAdjacentHTML("beforeend", '<div class="card"><div class="empty">No enquiries.</div></div>'); return; }
    const TYPE_LABEL = { contact: "Contact", service: "Service", support: "Support", quote: "Quote", consult: "Consultation", visit: "Site visit", product: "Product" };
    const typ = (q) => '<span class="pill ' + (q.type === "contact" ? "" : q.type === "support" ? "amber" : "blue") + '">' + esc(TYPE_LABEL[q.type] || q.type) + "</span>";
    view.insertAdjacentHTML("beforeend",
      '<div class="table-wrap has-cards"><table class="data collapse"><thead><tr><th>From</th><th>Type</th><th>Message</th><th>Date</th><th>Status</th></tr></thead><tbody>' +
      list.map((q) => '<tr style="cursor:pointer" data-action="open-inquiry" data-id="' + q.id + '" tabindex="0"><td><strong>' + esc(q.name) + '</strong><br><small class="muted">' + esc(q.phone || q.email) + "</small></td><td>" + typ(q) + (q.service ? "<br><small>" + esc(q.service) + "</small>" : "") + '</td><td style="max-width:340px">' + esc((q.message || "").slice(0, 110)) + "</td><td>" + esc(fmtDate(q.created_at)) + "</td><td>" + pill(q.status, INQ_STATUS) + "</td></tr>").join("") + "</tbody></table></div>" +
      '<div class="cards">' + list.map((q) => '<div class="m-card" data-action="open-inquiry" data-id="' + q.id + '"><div class="top"><div><strong>' + esc(q.name) + "</strong><br>" + typ(q) + "</div>" + pill(q.status, INQ_STATUS) + '</div><div class="muted small">' + esc((q.message || "").slice(0, 120)) + '</div><div class="meta"><span>' + esc(fmtDate(q.created_at)) + "</span></div></div>").join("") + "</div>" + qpg.html);
  }
  function inquiryDetail(id) {
    const q = (S.inquiries || []).find((x) => String(x.id) === String(id));
    if (!q) return;
    const wa = q.phone ? waLink(q.phone) : "";
    const dr = drawer("Enquiry from " + q.name,
      '<dl class="kv"><dt>Received</dt><dd>' + esc(fmtDate(q.created_at)) + "</dd><dt>Type</dt><dd>" + (q.type === "service" ? "Service request" : "Contact form") + "</dd>" + (q.service ? "<dt>Service</dt><dd>" + esc(q.service) + "</dd>" : "") +
      (q.phone ? '<dt>Phone</dt><dd><a href="tel:' + esc(q.phone) + '">' + esc(q.phone) + "</a></dd>" : "") + (q.email ? '<dt>Email</dt><dd><a href="mailto:' + esc(q.email) + '">' + esc(q.email) + "</a></dd>" : "") + "<dt>Language</dt><dd>" + (q.lang === "en" ? "English" : "Albanian") + "</dd></dl>" +
      '<div class="card"><div class="card-body" style="white-space:pre-wrap">' + (esc(q.message) || '<span class="muted">No message.</span>') + "</div></div>" +
      '<div class="form-group" style="margin-top:1.25rem"><label for="q-status">Status</label><select id="q-status">' + INQ_STATUS.map((s) => '<option value="' + s[0] + '"' + (q.status === s[0] ? " selected" : "") + ">" + s[1] + "</option>").join("") + "</select></div>",
      '<button type="button" class="button button-outline button-danger" id="q-del" style="margin-right:auto;background:#fff;color:#b42318">Delete</button>' + (q.email ? '<a class="button button-outline" href="mailto:' + esc(q.email) + '">Email</a>' : "") + (wa ? '<a class="button button-outline" target="_blank" rel="noopener" href="' + esc(wa) + '">WhatsApp</a>' : "") + '<button type="button" class="button" id="q-save">Save</button>');
    $("#q-save", dr.el).addEventListener("click", async (ev) => {
      busy(ev.currentTarget, true);
      try { await SupabaseClient.updateInquiryStatus(q.id, $("#q-status", dr.el).value); ok("Saved"); dr.close(); await reload("inquiries"); render(); }
      catch (e) { fail(e, "Could not save"); busy(ev.currentTarget, false); }
    });
    $("#q-del", dr.el).addEventListener("click", async () => {
      if (!(await confirmBox("Delete this enquiry?", "This cannot be undone.", "Delete", true))) return;
      try { await SupabaseClient.deleteInquiry(q.id); ok("Deleted"); dr.close(); await reload("inquiries"); render(); }
      catch (e) { fail(e, "Could not delete"); }
    });
  }

  /* ── Settings ───────────────────────────────────────────────────── */
  function viewSettings(view) {
    const cfg = S.settings.shop_settings || {};
    const adm = isAdmin();
    view.innerHTML = '<div class="settings-grid">' + (!adm ? "" :
      '<form class="card" id="set-shop" novalidate><div class="card-head"><h2>Delivery</h2></div><div class="card-body"><div class="form-row"><div class="form-group"><label for="st-fee">Delivery fee</label><input id="st-fee" inputmode="decimal" value="' + esc(cfg.shipping_fee ?? 0) + '"><div class="help">0 = free delivery.</div></div><div class="form-group"><label for="st-free">Free delivery over</label><input id="st-free" inputmode="decimal" value="' + esc(cfg.free_shipping_over ?? 0) + '"><div class="help">0 = no free-delivery threshold.</div></div></div><button type="submit" class="button">Save delivery settings</button></div></form>') +
      '<form class="card" id="set-pass" novalidate><div class="card-head"><h2>Change password</h2></div><div class="card-body"><div class="form-group"><label for="pw1">New password</label><input id="pw1" type="password" autocomplete="new-password" minlength="10"><div class="help">At least 10 characters.</div></div><div class="form-group"><label for="pw2">Repeat new password</label><input id="pw2" type="password" autocomplete="new-password"></div><button type="submit" class="button">Update password</button></div></form>' + (!adm ? "" :
      '<div class="card"><div class="card-head"><h2>Backup</h2></div><div class="card-body"><p class="muted" style="margin-top:0">Download a copy of your products, categories and services.</p><button type="button" class="button button-outline" data-action="export">Download backup (JSON)</button><p class="muted small" style="margin-bottom:0">Covers products, categories and services. Orders and enquiries are backed up with the database itself (see README → Backups).</p></div></div>') + '</div>';
    if (adm) $("#set-shop").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fee = num($("#st-fee").value || "0"), free = num($("#st-free").value || "0");
      if (!(fee >= 0) || !(free >= 0)) { toast("error", "Enter valid amounts"); return; }
      const b = $("button", e.target); busy(b, true);
      try { await SupabaseClient.upsertSetting("shop_settings", { shipping_fee: fee, free_shipping_over: free }); ok("Delivery settings saved"); await reload("settings"); }
      catch (err) { fail(err, "Could not save settings"); }
      busy(b, false);
    });
    $("#set-pass").addEventListener("submit", async (e) => {
      e.preventDefault();
      const a = $("#pw1").value, b2 = $("#pw2").value;
      if (a.length < 10) { toast("error", "Use at least 10 characters"); return; }
      if (a !== b2) { toast("error", "The passwords do not match"); return; }
      const b = $("button", e.target); busy(b, true);
      const r = await SupabaseClient.changeAdminPassword(a);
      busy(b, false);
      if (r.success) { ok("Password updated"); e.target.reset(); } else toast("error", r.error || "Could not update the password");
    });
  }
  /* ── Team (admin only) ──────────────────────────────────────────── */
  async function viewTeam(view) {
    view.innerHTML = '<div class="empty">Loading…</div>';
    await reload("team");
    if (S.section !== "team") return;
    const me = S.admin.id;
    const roleSel = (m) => '<select data-role-for="' + esc(m.id) + '" aria-label="Role for ' + esc(m.email) + '"' + (m.id === me ? " disabled" : "") + ">" + Object.keys(ROLE_LABEL).map((r) => '<option value="' + r + '"' + (m.role === r ? " selected" : "") + ">" + ROLE_LABEL[r] + "</option>").join("") + "</select>";
    view.innerHTML =
      '<div class="cols"><section class="card"><div class="card-head"><h2>Who has access</h2></div><div class="table-wrap"><table class="data"><thead><tr><th>Person</th><th>Role</th><th></th></tr></thead><tbody>' +
      S.team.map((m) => "<tr><td><strong>" + esc(m.full_name || m.email) + (m.id === me ? ' <span class="pill">You</span>' : "") + "</strong><br><small class=\"muted\">" + esc(m.email) + "</small></td><td>" + roleSel(m) + "</td><td>" + (m.id === me ? "" : '<button type="button" class="icon-btn danger" data-action="del-member" data-id="' + esc(m.id) + '" aria-label="Remove ' + esc(m.email) + '">' + icon("trash") + "</button>") + "</td></tr>").join("") +
      '</tbody></table></div></section><section class="card"><div class="card-head"><h2>Add a team member</h2></div><form class="card-body" id="member-form" novalidate>' +
      '<p class="muted small" style="margin-top:0">1. In Supabase open <strong>Authentication → Users → Add user</strong> and create their login (email and a strong password).<br>2. Enter the same email here and choose what they may do.</p>' +
      '<div class="form-group"><label for="m-email">Email</label><input id="m-email" type="email" autocomplete="off" required></div>' +
      '<div class="form-group"><label for="m-name">Name <span class="muted">(optional)</span></label><input id="m-name" autocomplete="off"></div>' +
      '<div class="form-group"><label for="m-role">Role</label><select id="m-role">' + Object.keys(ROLE_LABEL).map((r) => '<option value="' + r + '"' + (r === "staff" ? " selected" : "") + ">" + ROLE_LABEL[r] + "</option>").join("") + "</select></div>" +
      '<button type="submit" class="button">Add member</button></form>' +
      '<div class="card-body" style="border-top:1px solid var(--c-line)"><strong>What each role can do</strong><ul class="role-list">' + Object.keys(ROLE_LABEL).map((r) => "<li><strong>" + ROLE_LABEL[r] + ":</strong> " + esc(ROLE_HELP[r]) + "</li>").join("") + "</ul></div></section></div>";
    $("#member-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#m-email").value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { toast("error", "Enter a valid email address"); return; }
      const b = $("button", e.target); busy(b, true);
      try { await SupabaseClient.addTeamMember(email, $("#m-role").value, $("#m-name").value.trim()); ok("Team member added"); viewTeam(view); }
      catch (err) { fail(err, "Could not add the member"); busy(b, false); }
    });
  }

  /* ── Activity log (admin only) ──────────────────────────────────── */
  async function viewActivity(view, actions) {
    if (S.audit === null) { view.innerHTML = '<div class="card"><div class="empty">The activity log is not installed yet.<br>Run <strong>supabase-migration-v4-security.sql</strong> in Supabase.</div></div>'; return; }
    view.innerHTML = '<div class="empty">Loading…</div>';
    await reload("audit");
    if (S.section !== "activity") return;
    if (S.audit === null) { viewActivity(view, actions); return; }
    const rowsAll = S.audit.filter((r) => !S.auditTable || r.table_name === S.auditTable);
    actions.innerHTML = csvBtn("csv-activity");
    const tables = [...new Set(S.audit.map((r) => r.table_name))].sort();
    const apg = pager("activity", rowsAll.length);
    const rows = apg.rows(rowsAll);
    const what = (r) => {
      const o = r.old_data || {}, n = r.new_data || {};
      if (r.action === "UPDATE") { const ch = Object.keys(n).filter((k) => JSON.stringify(n[k]) !== JSON.stringify(o[k])); return "Changed " + (ch.join(", ") || "—"); }
      return r.action === "INSERT" ? "Created" : "Deleted";
    };
    view.innerHTML = '<div class="toolbar"><select id="au-t" aria-label="Filter by area"><option value="">All areas</option>' + tables.map((t) => '<option value="' + esc(t) + '"' + (S.auditTable === t ? " selected" : "") + ">" + esc(t) + "</option>").join("") + "</select></div>" +
      (rows.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Who</th><th>Area</th><th>Item</th><th>What</th></tr></thead><tbody>' +
        rows.map((r) => "<tr><td>" + esc(fmtDate(r.at)) + "</td><td>" + esc(r.actor_email || "Visitor / system") + "</td><td>" + esc(r.table_name) + "</td><td>" + esc(r.row_id) + "</td><td>" + esc(what(r)) + "</td></tr>").join("") + "</tbody></table></div>" : '<div class="card"><div class="empty">Nothing recorded yet.</div></div>') + apg.html;
    $("#au-t").addEventListener("change", (e) => { S.auditTable = e.target.value; S.pg.activity = 1; viewActivity(view, actions); });
  }

  function exportBackup() {
    const data = { exported_at: new Date().toISOString(), categories: S.categories, products: S.products, services: S.services };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "subcore-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function removeMember(id) {
    const m = S.team.find((x) => x.id === id);
    if (!m) return;
    if (!(await confirmBox("Remove " + m.email + "?", "They lose access to the admin straight away. Their login stays in Supabase and can be re-added later.", "Remove", true))) return;
    try { await SupabaseClient.removeTeamMember(id); ok("Removed"); render(); } catch (err) { fail(err, "Could not remove the member"); }
  }

  /* ── Events ─────────────────────────────────────────────────────── */
  document.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav) { go(nav.dataset.nav); return; }
    const pg = e.target.closest("[data-page]");
    if (pg && !pg.disabled) { S.pg[pg.dataset.page] += parseInt(pg.dataset.dir, 10); render(); window.scrollTo(0, 0); return; }
    const a = e.target.closest("[data-action]");
    if (!a) return;
    const id = a.dataset.id;
    switch (a.dataset.action) {
      case "new-product": if (!S.categories.length) { toast("info", "Tip: add a category first so customers can filter by it"); } productForm(blankProduct(), true); break;
      case "edit-product": productForm(S.products.find((p) => p.id === id), false); break;
      case "dup-product": { const p = JSON.parse(JSON.stringify(S.products.find((x) => x.id === id))); p.name.en += " (copy)"; p.name.sq += " (kopje)"; p.sku = ""; p.available = false; productForm(p, true); break; }
      case "del-product": deleteProduct(id); break;
      case "new-category": categoryForm(null); break;
      case "edit-category": categoryForm(S.categories.find((c) => c.id === id)); break;
      case "del-category": deleteCategory(id); break;
      case "new-service": serviceForm(null); break;
      case "edit-service": serviceForm(S.services.find((s) => s.id === id)); break;
      case "del-service": deleteService(id); break;
      case "open-order": orderDetail(id); break;
      case "open-inquiry": inquiryDetail(id); break;
      case "export": exportBackup(); break;
      case "csv-products": downloadCsv("subcore-products", ["ID", "Name (EN)", "Name (SQ)", "Category", "Brand", "SKU", "Price", "Compare price", "Currency", "Stock", "Visible", "Featured"],
        filteredProducts().map((p) => [p.id, p.name.en, p.name.sq, catName(p.category), p.brand, p.sku, p.price, p.compare_price, p.currency, p.stock, p.available ? "yes" : "no", p.featured ? "yes" : "no"])); break;
      case "csv-orders": downloadCsv("subcore-orders", ["Order", "Date", "Customer", "Phone", "Email", "Address", "Items", "Delivery", "Total", "Status"],
        S.orders.map((o) => [o.order_number || o.id, o.created_at, o.customer_name, o.customer_phone, o.customer_email, o.delivery_address, o.items.map((i) => (i.qty || 0) + "x " + (nm(i.name) || i.id)).join("; "), o.shipping || 0, o.total, o.status])); break;
      case "csv-inquiries": downloadCsv("subcore-enquiries", ["Date", "Type", "Name", "Phone", "Email", "Service", "Message", "Status"],
        (S.inquiries || []).map((q) => [q.created_at, q.type, q.name, q.phone, q.email, q.service, q.message, q.status])); break;
      case "csv-activity": downloadCsv("subcore-activity", ["When", "Who", "Action", "Area", "Item"], (S.audit || []).map((r) => [r.at, r.actor_email || "system", r.action, r.table_name, r.row_id])); break;
      case "del-member": removeMember(id); break;
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("tr[data-action]")) e.target.click();
  });
  document.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches("[data-role-for]")) {
      const m = S.team.find((x) => x.id === t.dataset.roleFor);
      if (!m || m.role === t.value) return;
      if (!(await confirmBox("Change role?", m.email + " will become " + ROLE_LABEL[t.value] + ". " + ROLE_HELP[t.value], "Change role", false))) { t.value = m.role; return; }
      try { await SupabaseClient.setTeamRole(m.id, t.value); m.role = t.value; ok("Role updated"); } catch (err) { fail(err, "Could not change the role"); t.value = m.role; }
    } else if (t.matches("[data-toggle]")) {
      await quickUpdate(t.dataset.id, { [t.dataset.toggle]: t.checked });
      $$('[data-toggle="' + t.dataset.toggle + '"][data-id="' + CSS.escape(t.dataset.id) + '"]').forEach((x) => { x.checked = t.checked; });
    } else if (t.matches("[data-stock]")) {
      const n = parseInt(t.value, 10);
      if (!Number.isInteger(n) || n < 0) { toast("error", "Stock must be 0 or more"); t.value = S.products.find((p) => p.id === t.dataset.stock).stock; return; }
      await quickUpdate(t.dataset.stock, { stock: n });
    } else if (t.matches("[data-svc-toggle]")) {
      const s = S.services.find((x) => x.id === t.dataset.svcToggle);
      try { await SupabaseClient.upsertService(Object.assign({}, s, { available: t.checked })); s.available = t.checked; ok("Saved"); }
      catch (err) { fail(err, "Could not save"); t.checked = !t.checked; }
    }
  });

  /* ── Auth & start ───────────────────────────────────────────────── */
  async function enter(admin) {
    S.admin = admin;
    $("#login").hidden = true;
    $("#app").hidden = false;
    $("#who").textContent = (admin.full_name || admin.email) + " · " + (ROLE_LABEL[admin.role] || admin.role);
    $("#view").innerHTML = '<div class="empty">Loading…</div>';
    try { await loadAll(); } catch (e) { fail(e, "Could not load data"); }
    go((location.hash || "").slice(1) || "dashboard");
  }

  async function init() {
    if (!window.supabase || !SupabaseClient.raw) {
      $("#login").hidden = false;
      const er = $("#login-error"); er.hidden = false; er.textContent = "Could not reach the database. Check your connection and reload.";
      return;
    }
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const er = $("#login-error"); er.hidden = true;
      const email = $("#login-email").value.trim(), pass = $("#login-pass").value;
      if (!email || !pass) { er.hidden = false; er.textContent = "Enter your email and password."; return; }
      const b = $("button[type=submit]", e.target); busy(b, true);
      const r = await SupabaseClient.adminLogin(email, pass);
      busy(b, false);
      if (!r.success) { er.hidden = false; er.textContent = r.error || "Sign-in failed."; return; }
      $("#login-pass").value = "";
      enter(r.user);
    });
    $("#logout").addEventListener("click", async () => { await SupabaseClient.adminLogout(); location.reload(); });
    window.addEventListener("hashchange", () => { if (S.admin) go((location.hash || "").slice(1)); });
    let admin = null;
    try { admin = await SupabaseClient.getCurrentAdmin(); } catch (e) { console.warn(e); }
    if (admin) enter(admin); else $("#login").hidden = false;
  }
  document.addEventListener("DOMContentLoaded", init);
})();
