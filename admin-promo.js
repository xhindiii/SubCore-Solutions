/* Admin → Promo graphics (Phase 6).
   Pick a product, load its details into an ADVERT (a copy), set the advertised price, choose and tweak a template, preview, and export
   a real PNG / JPEG / PDF drawn from a canvas by promo-render.js.

   Hard rules kept here:
   - This file never writes to products, services, orders or invoices. The only database writes are to promo_templates (look-and-feel only).
   - The advertised price and the previous price are plain text in `ad`; editing them changes nothing else.
   - Uploaded images stay in the browser (data: URL) and are used only for the export. They are not uploaded anywhere. */
(function () {
  "use strict";
  const P = window.PromoRender;
  window.AdminViews = window.AdminViews || {};

  const FORMAT_LABELS = {
    instagram_square: "Instagram post — square (1080×1080)", instagram_portrait: "Instagram post — portrait (1080×1350)",
    story: "Story / WhatsApp status (1080×1920)", facebook_post: "Facebook post (1200×630)", whatsapp_share: "WhatsApp sharing (1200×900)",
    print_a4: "Print A4 portrait (300 dpi)", print_a4_landscape: "Print A4 landscape (300 dpi)", print_a5: "Print A5 portrait (300 dpi)"
  };
  const CONTROLS = [
    ["Layout", [
      ["layout", "select", "Layout", [["stack", "Image on top"], ["side", "Image beside text"], ["overlay", "Full-photo overlay"]]],
      ["align", "select", "Text alignment", [["left", "Left"], ["center", "Centre"], ["right", "Right"]]],
      ["imageSide", "select", "Image side (beside text)", [["left", "Left"], ["right", "Right"]]]]],
    ["Background", [
      ["bg.type", "select", "Style", [["solid", "Solid colour"], ["gradient", "Gradient"]]],
      ["bg.c1", "color", "Colour 1"], ["bg.c2", "color", "Colour 2 (gradient)"],
      ["bg.angle", "range", "Gradient angle", 0, 360, 5], ["overlayShade", "range", "Photo shade (overlay layout)", 0, 0.9, 0.05]]],
    ["Colours", [
      ["colors.text", "color", "Title text"], ["colors.muted", "color", "Description / old price"], ["colors.accent", "color", "Price & accent"],
      ["colors.accentText", "color", "Text on accent"], ["colors.badge", "color", "Badge"], ["colors.badgeText", "color", "Badge text"]]],
    ["Typography", [
      ["fonts.heading", "select", "Heading font", [["sans", "Sans-serif"], ["serif", "Serif"], ["rounded", "Rounded"], ["mono", "Monospace"]]],
      ["fonts.body", "select", "Body font", [["sans", "Sans-serif"], ["serif", "Serif"], ["rounded", "Rounded"], ["mono", "Monospace"]]],
      ["sizes.title", "range", "Title size", 0.5, 1.8, 0.05], ["sizes.body", "range", "Description size", 0.6, 1.8, 0.05], ["sizes.price", "range", "Price size", 0.6, 2, 0.05]]],
    ["Image placement", [
      ["image.fit", "select", "Fit", [["contain", "Show whole product"], ["cover", "Fill the frame"]]],
      ["image.shape", "select", "Shape", [["rect", "Square corners"], ["round", "Rounded"], ["circle", "Circle"]]],
      ["image.frame", "check", "White frame"], ["image.shadow", "check", "Shadow"],
      ["image.scale", "range", "Size", 0.4, 1.3, 0.05], ["image.offsetX", "range", "Move left / right", -40, 40, 1], ["image.offsetY", "range", "Move up / down", -40, 40, 1]]],
    ["Elements", [
      ["badge.show", "check", "Show badge"], ["badge.auto", "check", "Badge shows “-N%” when the old price is higher"],
      ["badge.position", "select", "Badge position", [["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]]],
      ["price.style", "select", "Price style", [["pill", "Filled pill"], ["outline", "Outlined"], ["plain", "Plain text"]]],
      ["price.showOld", "check", "Show previous price (struck through)"], ["description.show", "check", "Show description"],
      ["cta.show", "check", "Show call-to-action"], ["cta.text", "text", "Call-to-action text (blank = default)"]]],
    ["Company branding", [
      ["brand.logo", "check", "Show logo"], ["brand.logoBackdrop", "select", "Logo background (logo is white)", [["auto", "Automatic"], ["dark", "Dark chip"], ["none", "None"]]], ["sizes.logo", "range", "Logo size", 0.5, 2, 0.05],
      ["brand.phone", "check", "Show phone"], ["brand.email", "check", "Show e-mail"], ["brand.web", "check", "Show website"], ["brand.instagram", "check", "Show Instagram"]]]
  ];

  const getPath = (o, path) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
  function setPath(o, path, v) { const ks = path.split("."); let t = o; ks.slice(0, -1).forEach((k) => { t = t[k]; }); t[ks[ks.length - 1]] = v; }
  const clone = (x) => JSON.parse(JSON.stringify(x));

  /* State lives for the whole admin session so switching sections doesn't lose a half-made advert. */
  const st = {
    productId: "", ad: { title: "", description: "", price: "", oldPrice: "", offer: "", currency: "ALL" }, lang: "sq",
    templateId: "builtin-classic", spec: P.sanitizeSpec(P.BUILTIN_TEMPLATES[0].spec), format: "instagram_square",
    imgs: { product: null, logo: null }, imgNote: "", imgSource: "none", productImageUrl: "", logoTried: false, dirtySpec: false
  };

  window.AdminViews.promo = function (view, actions, X) {
    const { S, $, $$, esc, icon, toast, ok, fail, confirmBox, drawer, busy } = X;
    const templates = () => P.BUILTIN_TEMPLATES.concat(S.promoTemplates || []);
    const curTemplate = () => templates().find((t) => t.id === st.templateId);
    const canSave = () => S.promoTemplates !== null && S.promoTemplates !== undefined;
    const product = () => S.products.find((p) => p.id === st.productId);

    const opts = (list, cur) => list.map(([v, l]) => '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(l) + "</option>").join("");
    function control(c) {
      const [path, type, label, a, b, step] = c, v = getPath(st.spec, path), id = "pc-" + path.replace(/\./g, "-");
      if (type === "select") return '<label class="promo-ctl" for="' + id + '"><span>' + esc(label) + '</span><select id="' + id + '" data-spec="' + path + '">' + opts(a, v) + "</select></label>";
      if (type === "color") return '<label class="promo-ctl" for="' + id + '"><span>' + esc(label) + '</span><input type="color" id="' + id + '" data-spec="' + path + '" value="' + esc(String(v).length === 4 ? "#" + String(v).slice(1).split("").map((x) => x + x).join("") : v) + '"></label>';
      if (type === "range") return '<label class="promo-ctl" for="' + id + '"><span>' + esc(label) + '</span><input type="range" id="' + id + '" data-spec="' + path + '" min="' + a + '" max="' + b + '" step="' + step + '" value="' + v + '"></label>';
      if (type === "check") return '<label class="check-line" for="' + id + '"><input type="checkbox" id="' + id + '" data-spec="' + path + '"' + (v ? " checked" : "") + "> " + esc(label) + "</label>";
      return '<label class="promo-ctl" for="' + id + '"><span>' + esc(label) + '</span><input type="text" id="' + id + '" maxlength="40" data-spec="' + path + '" value="' + esc(v) + '"></label>';
    }

    view.innerHTML = '<div class="promo">' +
      '<div class="promo-side">' +
      '<div class="card"><div class="card-body">' +
      '<p class="promo-note">' + icon("tag") + " <span>Prices typed here are for the <strong>advert only</strong>. The shop catalogue, services and invoices are never changed from this page.</span></p>" +
      '<label class="promo-ctl"><span>1. Product</span><select id="pr-product"><option value="">— No product (type everything) —</option>' +
        S.products.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === st.productId ? " selected" : "") + ">" + esc(X.nm(p.name)) + "</option>").join("") + "</select></label>" +
      '<div class="promo-img"><div class="promo-img-row"><button type="button" class="button button-outline" id="pr-upload">' + icon("upload") + ' <span id="pr-upload-label">' + (st.imgs.product ? "Replace image" : "Upload image") + "</span></button>" +
      '<button type="button" class="button button-outline" id="pr-useprod"' + (product() && (product().image || (product().images || []).length) ? "" : " hidden") + '>Use product photo</button>' +
      '<input type="file" id="pr-file" accept="image/jpeg,image/png,image/webp" hidden></div><p class="muted small" id="pr-imgnote" aria-live="polite"></p></div>' +
      '<label class="promo-ctl"><span>2. Title</span><input id="ad-title" maxlength="120" value="' + esc(st.ad.title) + '"></label>' +
      '<label class="promo-ctl"><span>Description</span><textarea id="ad-description" rows="3" maxlength="200">' + esc(st.ad.description) + "</textarea></label>" +
      '<div class="promo-two"><label class="promo-ctl"><span>3. Advertised price</span><input id="ad-price" inputmode="decimal" value="' + esc(st.ad.price) + '"></label>' +
      '<label class="promo-ctl"><span>Currency</span><select id="ad-currency">' + opts([["ALL", "ALL (Lekë)"], ["EUR", "EUR (€)"], ["USD", "USD ($)"], ["GBP", "GBP (£)"]], st.ad.currency) + "</select></label></div>" +
      '<div class="promo-two"><label class="promo-ctl"><span>Previous price (optional)</span><input id="ad-old" inputmode="decimal" value="' + esc(st.ad.oldPrice) + '"></label>' +
      '<label class="promo-ctl"><span>Offer text (optional)</span><input id="ad-offer" maxlength="28" placeholder="e.g. Buy 2, get 1 free" value="' + esc(st.ad.offer) + '"></label></div>' +
      '<label class="promo-ctl"><span>Language of the advert</span><select id="ad-lang">' + opts([["sq", "Shqip"], ["en", "English"]], st.lang) + "</select></label>" +
      '<div id="ad-messages" class="promo-msgs" aria-live="polite"></div>' +
      "</div></div>" +
      '<div class="card"><div class="card-head"><h2>4. Template</h2></div><div class="card-body">' +
      '<label class="promo-ctl"><span>Saved template</span><select id="pr-template"></select></label>' +
      '<div class="promo-btns" id="pr-tpl-btns"></div><p class="muted small" id="pr-tpl-note"></p>' +
      '<div id="pr-controls">' + CONTROLS.map(([g, items], i) => '<details class="promo-group"' + (i === 0 ? " open" : "") + "><summary>" + esc(g) + "</summary>" + items.map(control).join("") + "</details>").join("") + "</div>" +
      "</div></div></div>" +
      '<div class="promo-main"><div class="card"><div class="card-body">' +
      '<label class="promo-ctl"><span>5. Format</span><select id="pr-format">' +
        ["social", "print"].map((g) => '<optgroup label="' + (g === "social" ? "Social media" : "Print") + '">' + Object.keys(P.FORMATS).filter((k) => P.FORMATS[k].group === g).map((k) => '<option value="' + k + '"' + (k === st.format ? " selected" : "") + ">" + esc(FORMAT_LABELS[k]) + "</option>").join("") + "</optgroup>").join("") + "</select></label>" +
      '<div class="promo-stage"><canvas id="pr-canvas" aria-label="Advert preview"></canvas></div>' +
      '<div class="promo-btns promo-export"><span>6. Export:</span>' +
      '<button type="button" class="button" id="ex-png">' + icon("download") + " PNG</button>" +
      '<button type="button" class="button button-outline" id="ex-jpg">' + icon("download") + " JPG</button>" +
      '<button type="button" class="button button-outline" id="ex-pdf">' + icon("download") + " PDF</button></div>" +
      '<p class="muted small">Files are drawn from the design above at full resolution — they are not screenshots. PDF pages contain the artwork as an image (text is not selectable).</p>' +
      "</div></div></div></div>";

    actions.innerHTML = "";
    const canvas = $("#pr-canvas");

    /* ---- rendering ---- */
    let raf = 0;
    function messages() {
      const chk = P.checkContent(st.ad), m = [];
      const T = { title_required: "Add a title.", price_invalid: "The advertised price is not a valid number.", old_price_invalid: "The previous price is not a valid number.",
        no_price: "No price entered: the advert will be shown without one.", old_price_not_higher: "The previous price is not higher than the advertised price, so it is not shown and no discount is claimed.", price_zero: "The advertised price is 0." };
      chk.errors.forEach((c) => m.push('<div class="promo-msg promo-err">' + esc(T[c]) + "</div>"));
      chk.warnings.forEach((c) => m.push('<div class="promo-msg">' + esc(T[c]) + "</div>"));
      const prod = product();
      if (prod && st.ad.price !== "" && P.parsePrice(st.ad.price) !== Math.round(prod.price * 100)) m.push('<div class="promo-msg">Advert price differs from the catalogue price (' + esc(P.formatPrice(Math.round(prod.price * 100), prod.currency, st.lang)) + "). The catalogue keeps its own price.</div>");
      if (!st.imgs.product) m.push('<div class="promo-msg">No image yet: the exported advert will have no picture. Upload one or choose a product with a photo.</div>');
      $("#ad-messages").innerHTML = m.join("");
      return chk;
    }
    function draw() {
      const f = P.FORMATS[st.format], scale = Math.min(1, 900 / Math.max(f.w, f.h));
      const r = P.render(canvas, { format: f, spec: st.spec, ad: st.ad, images: st.imgs, lang: st.lang, scale, placeholder: true });
      canvas.style.aspectRatio = f.w + " / " + f.h;
      canvas.dataset.format = f.id;
      if (r.warnings.indexOf("text_overflow") >= 0) $("#ad-messages").insertAdjacentHTML("beforeend", '<div class="promo-msg">The text is long for this format and was shrunk to fit. Shorten the title or description for a cleaner result.</div>');
    }
    function refresh() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { messages(); draw(); }); }
    function imgNote(t) { st.imgNote = t; const n = $("#pr-imgnote"); if (n) n.textContent = t; }
    imgNote(st.imgNote);

    /* ---- logo ---- */
    if (!st.imgs.logo && !st.logoTried) {
      st.logoTried = true;
      P.loadImage(P.BRAND.logo).then((i) => { st.imgs.logo = i; refresh(); }).catch(() => { refresh(); });
    }

    /* ---- images ---- */
    async function setProductImage(url, label) {
      try {
        const cross = /^https?:\/\//i.test(url);
        const img = await P.loadImage(url, cross);
        st.imgs.product = img; st.imgSource = "catalog"; st.productImageUrl = url;
        imgNote(label || "Using the product photo.");
        $("#pr-upload-label").textContent = "Replace image";
      } catch (e) {
        st.imgs.product = null;
        imgNote("The product photo could not be loaded for export (the image host may not allow it). Upload a copy of the image instead.");
      }
      refresh();
    }
    $("#pr-upload").addEventListener("click", () => $("#pr-file").click());
    $("#pr-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0]; e.target.value = "";
      if (!file) return;
      const chk = await SupabaseClient.checkImage(file);
      if (!chk.ok) { imgNote("Image not accepted: " + chk.reason); toast("error", "Image not accepted: " + chk.reason); return; }
      const url = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
      try {
        st.imgs.product = await P.loadImage(url); st.imgSource = "upload"; st.productImageUrl = "";
        imgNote("Using your uploaded image (" + file.name + "). It stays in this browser and is only used for the export.");
        $("#pr-upload-label").textContent = "Replace image";
      } catch (err) { imgNote("That file could not be read as an image."); }
      refresh();
    });
    $("#pr-useprod").addEventListener("click", () => { const p = product(); const u = p && (p.image || (p.images || [])[0]); if (u) setProductImage(u); });

    /* ---- product loading: copies values into the advert ---- */
    $("#pr-product").addEventListener("change", (e) => {
      st.productId = e.target.value;
      const p = product();
      if (!p) { refresh(); return; }
      const c = P.contentFromProduct(p, st.lang);
      st.ad = { title: c.title, description: c.description, price: c.price, oldPrice: c.oldPrice, offer: "", currency: c.currency };
      $("#ad-title").value = st.ad.title; $("#ad-description").value = st.ad.description; $("#ad-price").value = st.ad.price;
      $("#ad-old").value = st.ad.oldPrice; $("#ad-offer").value = ""; $("#ad-currency").value = st.ad.currency;
      $("#pr-useprod").hidden = !c.imageUrl;
      if (c.imageUrl) setProductImage(c.imageUrl); else { st.imgs.product = null; imgNote("This product has no photo. Upload an image."); refresh(); }
    });
    [["ad-title", "title"], ["ad-description", "description"], ["ad-price", "price"], ["ad-old", "oldPrice"], ["ad-offer", "offer"]].forEach(([id, k]) => $("#" + id).addEventListener("input", (e) => { st.ad[k] = e.target.value; refresh(); }));
    $("#ad-currency").addEventListener("change", (e) => { st.ad.currency = e.target.value; refresh(); });
    $("#ad-lang").addEventListener("change", (e) => {
      st.lang = e.target.value; const p = product();
      if (p) { const c = P.contentFromProduct(p, st.lang); st.ad.title = c.title; st.ad.description = c.description; $("#ad-title").value = c.title; $("#ad-description").value = c.description; }
      refresh();
    });
    $("#pr-format").addEventListener("change", (e) => { st.format = e.target.value; refresh(); });

    /* ---- templates ---- */
    function drawTemplateSelect() {
      const sel = $("#pr-template"), t = curTemplate();
      sel.innerHTML = '<optgroup label="Built-in">' + P.BUILTIN_TEMPLATES.map((x) => '<option value="' + x.id + '"' + (x.id === st.templateId ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</optgroup>" +
        (S.promoTemplates && S.promoTemplates.length ? '<optgroup label="Saved">' + S.promoTemplates.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === st.templateId ? " selected" : "") + ">" + esc(x.name) + "</option>").join("") + "</optgroup>" : "");
      const saved = t && !t.builtin;
      $("#pr-tpl-btns").innerHTML = canSave()
        ? '<button type="button" class="button button-outline" id="tpl-new">Save as new template</button>' +
          (saved ? '<button type="button" class="button button-outline" id="tpl-update">Update “' + esc(t.name) + '”</button><button type="button" class="button button-outline button-danger-outline" id="tpl-del">Delete</button>' : "")
        : "";
      $("#pr-tpl-note").textContent = !canSave()
        ? "Saving your own templates needs supabase-migration-v7-promo-reports.sql in your database. The four built-in templates work without it."
        : (t && t.builtin ? "Built-in templates are fixed. Change any setting, then “Save as new template” to keep your version." : st.dirtySpec ? "You have unsaved changes to this template." : "");
    }
    function applySpecToControls() {
      $$("[data-spec]").forEach((el) => {
        const v = getPath(st.spec, el.dataset.spec);
        if (el.type === "checkbox") el.checked = !!v; else el.value = el.type === "color" && String(v).length === 4 ? "#" + String(v).slice(1).split("").map((x) => x + x).join("") : v;
      });
    }
    $("#pr-template").addEventListener("change", (e) => {
      const t = templates().find((x) => x.id === e.target.value); if (!t) return;
      st.templateId = t.id; st.spec = P.sanitizeSpec(clone(t.spec)); st.dirtySpec = false;
      applySpecToControls(); drawTemplateSelect(); bindTplButtons(); refresh();
    });
    function onSpec(e) {
      const el = e.target.closest("[data-spec]"); if (!el) return;
      let v = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
      const next = clone(st.spec); setPath(next, el.dataset.spec, v);
      const wasDirty = st.dirtySpec;
      st.spec = P.sanitizeSpec(next); st.dirtySpec = true;
      // Only the first edit changes the template buttons/note; re-rendering them on every keystroke could swallow a click on them.
      if (!wasDirty) { drawTemplateSelect(); bindTplButtons(); }
      refresh();
    }
    // `input` fires for every control type (text, range, colour, select, checkbox); `change` would only repeat it on blur.
    $("#pr-controls").addEventListener("input", onSpec);

    function nameDrawer(title, initial, onSave) {
      const d = drawer(title, '<label class="promo-ctl"><span>Template name</span><input id="tpl-name" maxlength="80" value="' + esc(initial) + '"></label><p class="muted small">Saves layout, colours, fonts and options only — never a product, a price or an image.</p>',
        '<button type="button" class="button button-outline" data-close2>Cancel</button><button type="button" class="button" id="tpl-save">Save</button>');
      $("[data-close2]", d.el).addEventListener("click", d.close);
      $("#tpl-save", d.el).addEventListener("click", async (ev) => {
        const name = $("#tpl-name", d.el).value.trim(); if (!name) { toast("error", "Give the template a name."); return; }
        busy(ev.currentTarget, true);
        try { await onSave(name); d.close(); } catch (er) { fail(er, "Could not save the template"); busy(ev.currentTarget, false); }
      });
    }
    function bindTplButtons() {
      const n = $("#tpl-new"), u = $("#tpl-update"), d = $("#tpl-del");
      if (n) n.addEventListener("click", () => nameDrawer("Save as new template", "", async (name) => {
        const id = await SupabaseClient.savePromoTemplate({ name, spec: st.spec });
        await X.reload("promoTemplates"); st.templateId = id; st.dirtySpec = false; ok("Template saved"); drawTemplateSelect(); bindTplButtons();
      }));
      if (u) u.addEventListener("click", async (ev) => {
        const t = curTemplate(); busy(ev.currentTarget, true);
        try { await SupabaseClient.savePromoTemplate({ id: t.id, name: t.name, spec: st.spec }); await X.reload("promoTemplates"); st.dirtySpec = false; ok("Template updated"); }
        catch (er) { fail(er, "Could not update the template"); }
        drawTemplateSelect(); bindTplButtons();
      });
      if (d) d.addEventListener("click", async () => {
        const t = curTemplate();
        if (!(await confirmBox("Delete template?", "“" + t.name + "” will be removed. Adverts you already exported are not affected.", "Delete", true))) return;
        try { await SupabaseClient.deletePromoTemplate(t.id); await X.reload("promoTemplates"); st.templateId = "builtin-classic"; st.spec = P.sanitizeSpec(P.BUILTIN_TEMPLATES[0].spec); st.dirtySpec = false; ok("Template deleted"); applySpecToControls(); }
        catch (er) { fail(er, "Could not delete the template"); }
        drawTemplateSelect(); bindTplButtons(); refresh();
      });
    }
    if (!curTemplate()) { st.templateId = "builtin-classic"; st.spec = P.sanitizeSpec(P.BUILTIN_TEMPLATES[0].spec); }
    drawTemplateSelect(); bindTplButtons();

    /* ---- export: render a fresh full-size canvas (never the preview, never a screenshot) ---- */
    function download(blob, name) {
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    async function doExport(kind, btn) {
      const chk = P.checkContent(st.ad);
      if (chk.errors.length) { toast("error", "Fix the highlighted problems before exporting."); messages(); return; }
      busy(btn, true);
      try {
        const f = P.FORMATS[st.format], c = document.createElement("canvas");
        P.render(c, { format: f, spec: st.spec, ad: st.ad, images: st.imgs, lang: st.lang, scale: 1 });
        let blob;
        if (kind === "png") blob = await P.exportPng(c); else if (kind === "jpg") blob = await P.exportJpeg(c, 0.92); else blob = await P.exportPdf(c, f, st.ad.title);
        download(blob, P.fileName(st.ad.title, f.id, kind === "jpg" ? "jpg" : kind));
        ok(kind.toUpperCase() + " exported (" + f.w + "×" + f.h + ")");
      } catch (er) {
        fail(er, er && er.message === "canvas_tainted" ? "The product photo blocks export. Upload a copy of the image and try again" : "Export failed");
      }
      busy(btn, false);
    }
    $("#ex-png").addEventListener("click", (e) => doExport("png", e.currentTarget));
    $("#ex-jpg").addEventListener("click", (e) => doExport("jpg", e.currentTarget));
    $("#ex-pdf").addEventListener("click", (e) => doExport("pdf", e.currentTarget));

    refresh();
  };
})();
