/* A4 invoice PDF, drawn in the browser with the vendored pdf-lib (vendor/pdf-lib.min.js). Nothing is sent anywhere.
   Input is the stored invoice (header row + line snapshots + payments), so the PDF always shows the frozen numbers the
   database holds — the same figures as the screen, the CSV and the reports. Albanian letters (ë, ç, Ë, Ç) are in the
   standard PDF fonts' WinAnsi set; any character outside it is replaced by "?" rather than breaking the file.

   It never says "fiscalized" and carries no NIVF / NSLF / QR / fiscal verification data: these invoices are informal documents,
   and each page says so. Drafts are watermarked DRAFT and show no number; cancelled invoices are stamped CANCELLED. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory; else root.InvoicePdf = factory(root.PDFLib);
})(typeof self !== "undefined" ? self : this, function (PDFLib) {
  "use strict";
  const T = {
    sq: { invoice: "FATURË", draft: "DRAFT", cancelled: "ANULUAR", number: "Nr.", issued: "Data e lëshimit", due: "Afati i pagesës", billTo: "Faturuar për", from: "Nga", taxId: "NIPT", phone: "Tel", email: "Email",
      item: "Përshkrim", qty: "Sasia", price: "Çmimi", disc: "Zbritje", vat: "TVSH", total: "Totali", subtotal: "Nënshuma", lineDisc: "Zbritje në rreshta", ovDisc: "Zbritje e përgjithshme", taxable: "Baza e tatueshme",
      delivery: "Transporti", tax: "TVSH", grand: "TOTALI", paid: "Paguar", balance: "Mbetet për t'u paguar", payment: "Pagesa", bank: "Banka", method: "Mënyra", terms: "Kushtet", notes: "Shënime", order: "Porosia",
      page: "Faqja", of: "nga", notFiscal: "Dokument informal; nuk është faturë e fiskalizuar (pa NIVF/NSLF).", draftNote: "DRAFT - nuk është faturë e lëshuar", currency: "Monedha",
      methods: { cash: "Para në dorë", bank_transfer: "Transfertë bankare", card: "Kartë", other: "Tjetër", "": "" } },
    en: { invoice: "INVOICE", draft: "DRAFT", cancelled: "CANCELLED", number: "No.", issued: "Issue date", due: "Due date", billTo: "Bill to", from: "From", taxId: "Tax ID", phone: "Tel", email: "Email",
      item: "Description", qty: "Qty", price: "Unit price", disc: "Discount", vat: "VAT", total: "Total", subtotal: "Subtotal", lineDisc: "Line discounts", ovDisc: "Overall discount", taxable: "Taxable amount",
      delivery: "Delivery", tax: "VAT", grand: "TOTAL", paid: "Paid", balance: "Balance due", payment: "Payment", bank: "Bank", method: "Method", terms: "Terms", notes: "Notes", order: "Order",
      page: "Page", of: "of", notFiscal: "Informal document; not a fiscalized invoice (no NIVF/NSLF).", draftNote: "DRAFT - not an issued invoice", currency: "Currency",
      methods: { cash: "Cash", bank_transfer: "Bank transfer", card: "Card", other: "Other", "": "" } }
  };
  const A4 = [595.28, 841.89], M = 40;
  const fmtMoney = (v, cur) => { const n = Number(v) || 0; const s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); return (n < 0 ? "-" : "") + s + (cur ? " " + cur : ""); };
  const dmy = (d) => (d ? String(d).slice(8, 10) + "." + String(d).slice(5, 7) + "." + String(d).slice(0, 4) : "");
  const qtyText = (q) => { const n = Number(q); return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3))); };

  /* data: { invoice (invoice_overview row), items (invoice_items rows), payments (rows), seller (object; settings for drafts), lang, logo (Uint8Array|null) } */
  async function build(data) {
    const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
    const inv = data.invoice, items = data.items || [], pays = (data.payments || []).filter((p) => !p.reversed);
    const L = T[data.lang === "en" ? "en" : "sq"];
    const seller = inv.seller || data.seller || {};
    const doc = await PDFDocument.create();
    doc.setTitle((inv.number || "Draft") + " - " + (seller.company_name || "Invoice"));
    doc.setProducer("SubCore Solutions"); doc.setCreator("SubCore Solutions admin");
    const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let logo = null;
    if (data.logo) { try { logo = await doc.embedPng(data.logo); } catch { try { logo = await doc.embedJpg(data.logo); } catch { logo = null; } } }

    const clean = (t, f) => { t = String(t == null ? "" : t).replace(/[\r\n\t]+/g, " "); let o = ""; for (const ch of t) { try { f.encodeText(ch); o += ch; } catch { o += "?"; } } return o; };
    const width = (t, f, s) => f.widthOfTextAtSize(clean(t, f), s);
    const wrap = (t, f, s, w) => {
      const words = clean(t, f).split(" "), lines = []; let cur = "";
      for (let word of words) {
        while (f.widthOfTextAtSize(word, s) > w) { let k = word.length; while (k > 1 && f.widthOfTextAtSize(word.slice(0, k), s) > w) k--; if (cur) { lines.push(cur); cur = ""; } lines.push(word.slice(0, k)); word = word.slice(k); }
        const next = cur ? cur + " " + word : word;
        if (f.widthOfTextAtSize(next, s) <= w) cur = next; else { if (cur) lines.push(cur); cur = word; }
      }
      if (cur || !lines.length) lines.push(cur); return lines;
    };
    const ink = rgb(0.1, 0.12, 0.16), grey = rgb(0.4, 0.43, 0.48), line = rgb(0.82, 0.84, 0.87), accent = rgb(0.06, 0.32, 0.56), red = rgb(0.72, 0.1, 0.1);
    const pages = []; let page, y;
    const text = (t, x, yy, o) => { o = o || {}; const f = o.bold ? bold : font, s = o.size || 9; let str = clean(t, f); let xx = x; if (o.right) xx = x - f.widthOfTextAtSize(str, s); page.drawText(str, { x: xx, y: yy, size: s, font: f, color: o.color || ink }); };
    const hline = (yy, x1, x2, c, th) => page.drawLine({ start: { x: x1 || M, y: yy }, end: { x: x2 || A4[0] - M, y: yy }, thickness: th || 0.6, color: c || line });

    // column layout (x positions); right-aligned numeric columns
    const COL = { item: M, qty: 318, price: 378, disc: 436, vat: 478, total: A4[0] - M };
    function newPage(first) {
      page = doc.addPage(A4); pages.push(page); y = A4[1] - M;
      if (inv.status === "draft") page.drawText("DRAFT", { x: 120, y: 300, size: 130, font: bold, color: rgb(0.93, 0.93, 0.94), rotate: degrees(40), opacity: 0.7 });
      if (inv.status === "cancelled") page.drawText(L.cancelled, { x: 70, y: 300, size: 100, font: bold, color: rgb(0.97, 0.88, 0.88), rotate: degrees(40), opacity: 0.7 });
      if (first) return;
      text(seller.company_name || "", M, y - 8, { bold: true, size: 10 });
      text((inv.number ? L.number + " " + inv.number : L.draft), A4[0] - M, y - 8, { right: true, bold: true, size: 10 });
      y -= 26; tableHead();
    }
    function tableHead() {
      page.drawRectangle({ x: M, y: y - 5, width: A4[0] - 2 * M, height: 18, color: rgb(0.94, 0.95, 0.97) });
      text(L.item, COL.item + 4, y, { bold: true, size: 8 }); text(L.qty, COL.qty, y, { bold: true, size: 8, right: true }); text(L.price, COL.price, y, { bold: true, size: 8, right: true });
      text(L.disc, COL.disc, y, { bold: true, size: 8, right: true }); text(L.vat + " %", COL.vat, y, { bold: true, size: 8, right: true }); text(L.total, COL.total, y, { bold: true, size: 8, right: true });
      y -= 18;
    }

    /* ---- header ---- */
    newPage(true);
    let hx = M;
    if (logo) { const h = 38, w = logo.width * (h / logo.height); page.drawImage(logo, { x: M, y: y - h, width: Math.min(w, 140), height: h }); }
    text(inv.status === "draft" ? L.invoice + " (" + L.draft + ")" : L.invoice, A4[0] - M, y - 14, { right: true, bold: true, size: 20, color: accent });
    let ry = y - 34;
    if (inv.number) { text(L.number + " " + inv.number, A4[0] - M, ry, { right: true, bold: true, size: 11 }); ry -= 15; }
    text(L.issued + ": " + dmy(inv.issue_date), A4[0] - M, ry, { right: true, size: 9 }); ry -= 12;
    if (inv.due_date) { text(L.due + ": " + dmy(inv.due_date), A4[0] - M, ry, { right: true, size: 9 }); ry -= 12; }
    if (inv.order_ref) { text(L.order + ": " + inv.order_ref, A4[0] - M, ry, { right: true, size: 9, color: grey }); ry -= 12; }
    y -= 52;
    // seller (left) and customer (right)
    const colW = 240;
    const sellerLines = [[seller.company_name, true]].concat([seller.address, [seller.city, seller.country].filter(Boolean).join(", "), seller.tax_id ? L.taxId + ": " + seller.tax_id : "", seller.registration_no || "", seller.phone ? L.phone + ": " + seller.phone : "", seller.email ? L.email + ": " + seller.email : ""].filter(Boolean).map((t) => [t, false]));
    const c = inv.customer || {};
    const custLines = [[c.name, true]].concat([c.address, [c.city, c.country].filter(Boolean).join(", "), c.tax_id ? L.taxId + ": " + c.tax_id : "", c.phone ? L.phone + ": " + c.phone : "", c.email ? L.email + ": " + c.email : ""].filter(Boolean).map((t) => [t, false]));
    let ly = y, cy = y;
    text(L.from, M, ly, { size: 7.5, color: grey, bold: true }); ly -= 12;
    for (const [t, b] of sellerLines) for (const w of wrap(t || "", b ? bold : font, 9, colW)) { text(w, M, ly, { bold: b }); ly -= 11.5; }
    const cx = A4[0] / 2 + 20;
    text(L.billTo, cx, cy, { size: 7.5, color: grey, bold: true }); cy -= 12;
    for (const [t, b] of custLines) for (const w of wrap(t || "", b ? bold : font, 9, colW - 20)) { text(w, cx, cy, { bold: b }); cy -= 11.5; }
    y = Math.min(ly, cy) - 14;
    hline(y + 6); y -= 8;
    tableHead();

    /* ---- lines ---- */
    const itemW = COL.qty - 50 - COL.item - 8;
    items.forEach((it, idx) => {
      const nameLines = wrap(it.name, bold, 9, itemW);
      const sub = [it.sku ? "SKU " + it.sku : "", it.description || ""].filter(Boolean).join(" - ");
      const subLines = sub ? wrap(sub, font, 7.5, itemW) : [];
      const h = nameLines.length * 11 + subLines.length * 9.5 + 8;
      if (y - h < 150) newPage(false);
      let ty = y - 4;
      nameLines.forEach((w) => { text(w, COL.item + 4, ty, { bold: true }); ty -= 11; });
      subLines.forEach((w) => { text(w, COL.item + 4, ty, { size: 7.5, color: grey }); ty -= 9.5; });
      const dv = Number(it.discount_value) > 0 ? (it.discount_type === "percent" ? qtyText(it.discount_value) + "%" : fmtMoney(it.line_discount)) : "-";
      text(qtyText(it.qty), COL.qty, y - 4, { right: true }); text(fmtMoney(it.unit_price), COL.price, y - 4, { right: true });
      text(dv, COL.disc, y - 4, { right: true }); text(qtyText(it.vat_rate), COL.vat, y - 4, { right: true });
      text(fmtMoney(it.line_total), COL.total, y - 4, { right: true, bold: true });
      y -= h; hline(y + 3);
    });

    /* ---- totals ---- */
    const cur = inv.currency;
    const rows = [[L.subtotal, inv.gross_total]];
    if (Number(inv.line_discount_total) > 0) rows.push([L.lineDisc, -inv.line_discount_total]);
    if (Number(inv.overall_discount_total) > 0) rows.push([L.ovDisc, -inv.overall_discount_total]);
    rows.push([L.taxable, inv.taxable_total]);
    if (Number(inv.shipping) > 0) rows.push([L.delivery, inv.shipping]);
    rows.push([L.tax, inv.tax_total]);
    if (y - rows.length * 14 - 140 < 70) newPage(false);
    y -= 10;
    const lx = 355;
    for (const [l, v] of rows) { text(l, lx, y, { size: 9, color: grey }); text(fmtMoney(v), A4[0] - M, y, { right: true }); y -= 14; }
    hline(y + 8, lx, A4[0] - M, ink, 0.9); y -= 6;
    text(L.grand + " (" + cur + ")", lx, y, { bold: true, size: 11 }); text(fmtMoney(inv.total), A4[0] - M, y, { right: true, bold: true, size: 11 }); y -= 18;
    if (inv.status === "issued" || inv.status === "cancelled") {
      const paid = pays.reduce((a, p) => a + Math.round(Number(p.amount) * 100), 0) / 100;
      if (inv.status === "issued") {
        text(L.paid, lx, y, { size: 9, color: grey }); text(fmtMoney(paid), A4[0] - M, y, { right: true }); y -= 14;
        text(L.balance, lx, y, { bold: true, size: 9.5, color: Number(inv.total) - paid > 0 ? red : ink }); text(fmtMoney(Math.round((Number(inv.total) - paid) * 100) / 100), A4[0] - M, y, { right: true, bold: true, size: 9.5 }); y -= 14;
      }
    }

    /* ---- payment details, terms, notes ---- */
    y -= 6;
    const blocks = [];
    const bank = [seller.bank_name ? L.bank + ": " + seller.bank_name : "", seller.iban ? "IBAN: " + seller.iban : "", seller.swift ? "SWIFT: " + seller.swift : ""].filter(Boolean);
    if (bank.length || inv.payment_method) blocks.push([L.payment, bank.concat(inv.payment_method ? [L.method + ": " + (L.methods[inv.payment_method] || inv.payment_method)] : [])]);
    if (inv.payment_terms) blocks.push([L.terms, [inv.payment_terms]]);
    if (inv.notes) blocks.push([L.notes, [inv.notes]]);
    for (const [title, ls] of blocks) {
      const wl = ls.flatMap((t) => wrap(t, font, 8.5, A4[0] - 2 * M));
      if (y - wl.length * 11 - 20 < 60) newPage(false);
      text(title, M, y, { bold: true, size: 8, color: grey }); y -= 11;
      for (const w of wl) { text(w, M, y, { size: 8.5 }); y -= 11; }
      y -= 6;
    }
    if (inv.footer) { const wl = wrap(inv.footer, font, 8.5, A4[0] - 2 * M); if (y - wl.length * 11 < 60) newPage(false); for (const w of wl) { text(w, M, y, { size: 8.5, color: grey }); y -= 11; } }

    /* ---- footer on every page ---- */
    const total = pages.length;
    pages.forEach((pg, i) => {
      page = pg;
      hline(48, M, A4[0] - M);
      text(inv.status === "draft" ? L.draftNote : L.notFiscal, M, 36, { size: 7.5, color: grey });
      text(L.page + " " + (i + 1) + " " + L.of + " " + total, A4[0] - M, 36, { size: 7.5, color: grey, right: true });
      if (inv.number) text(inv.number, A4[0] - M, 26, { size: 7.5, color: grey, right: true });
    });
    return doc.save();
  }
  return { build, T, fmtMoney };
});
