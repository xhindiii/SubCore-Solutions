/* SubCore Solutions — promotional graphic engine (Phase 6).
   Draws an advert on a <canvas> from (1) a template spec = layout/style only, (2) the advert content typed or
   loaded in the admin, (3) the brand constants. It produces real PNG / JPEG / PDF files from the canvas —
   never a screenshot of the dashboard.

   IMPORTANT: nothing here reads or writes the shop catalog, services or invoices. The advertised price is plain
   text in the advert content; the module has no network access and no Supabase calls at all.

   Browser: window.PromoRender   Node (tests): module.exports (pure parts: sanitizer, prices, PDF writer). */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PromoRender = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var P = {};

  /* ---------- brand (company details already published on the site) ---------- */
  P.BRAND = {
    name: 'SubCore Solutions',
    phone: '+355 68 666 1686',
    email: 'info.subcoresolutions@gmail.com',
    web: 'subcoresolutions.online',
    instagram: '@subcore_solutions',
    logo: 'logo.png'
  };

  /* ---------- output formats ----------
     w/h in pixels. pt = PDF page size in points (print formats use exact paper sizes; social formats use 96 dpi -> 0.75 pt/px).
     safe = fraction of height kept free at top/bottom (Stories are covered by the app's own buttons there). */
  var MM = 72 / 25.4;
  P.FORMATS = {
    instagram_square:   { id: 'instagram_square',   group: 'social', w: 1080, h: 1080, pt: [810, 810], safe: 0 },
    instagram_portrait: { id: 'instagram_portrait', group: 'social', w: 1080, h: 1350, pt: [810, 1012.5], safe: 0 },
    story:              { id: 'story',              group: 'social', w: 1080, h: 1920, pt: [810, 1440], safe: 0.1 },
    facebook_post:      { id: 'facebook_post',      group: 'social', w: 1200, h: 630,  pt: [900, 472.5], safe: 0 },
    whatsapp_share:     { id: 'whatsapp_share',     group: 'social', w: 1200, h: 900,  pt: [900, 675], safe: 0 },
    print_a4:           { id: 'print_a4',           group: 'print',  w: 2480, h: 3508, pt: [210 * MM, 297 * MM], safe: 0 },
    print_a4_landscape: { id: 'print_a4_landscape', group: 'print',  w: 3508, h: 2480, pt: [297 * MM, 210 * MM], safe: 0 },
    print_a5:           { id: 'print_a5',           group: 'print',  w: 1748, h: 2480, pt: [148 * MM, 210 * MM], safe: 0 }
  };

  /* ---------- spec = the editable template ---------- */
  var FONT_STACKS = {
    sans:  '"IBM Plex Sans", "Segoe UI", Roboto, "Helvetica Neue", Arial, "Liberation Sans", "DejaVu Sans", sans-serif',
    serif: 'Georgia, "Times New Roman", "Liberation Serif", "DejaVu Serif", serif',
    mono:  '"Courier New", "Liberation Mono", "DejaVu Sans Mono", monospace',
    rounded: '"Trebuchet MS", "Segoe UI", "Verdana", "DejaVu Sans", sans-serif'
  };
  P.FONT_STACKS = FONT_STACKS;
  var ENUMS = {
    layout: ['stack', 'side', 'overlay'], bgType: ['solid', 'gradient'], align: ['left', 'center', 'right'],
    font: ['sans', 'serif', 'mono', 'rounded'], fit: ['contain', 'cover'], shape: ['rect', 'round', 'circle'],
    badgePos: ['tl', 'tr', 'bl', 'br'], priceStyle: ['pill', 'plain', 'outline'], logoBackdrop: ['auto', 'none', 'dark'], imageSide: ['left', 'right']
  };
  P.ENUMS = ENUMS;

  function pickEnum(v, list, d) { return list.indexOf(v) >= 0 ? v : d; }
  function num(v, min, max, d) { v = Number(v); if (!isFinite(v)) return d; return Math.min(max, Math.max(min, v)); }
  function bool(v, d) { return typeof v === 'boolean' ? v : d; }
  function hex(v, d) { v = String(v == null ? '' : v).trim(); return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v.toLowerCase() : d; }
  function str(v, max, d) { if (typeof v !== 'string') return d; return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }

  P.defaultSpec = function () {
    return {
      v: 1, layout: 'stack', align: 'left', imageSide: 'left',
      bg: { type: 'gradient', c1: '#ffffff', c2: '#e1f0f4', angle: 160 },
      colors: { text: '#18252d', muted: '#4f6a75', accent: '#176f86', accentText: '#ffffff', badge: '#b8321f', badgeText: '#ffffff' },
      fonts: { heading: 'sans', body: 'sans' },
      sizes: { title: 1, body: 1, price: 1, logo: 1 },
      image: { scale: 1, fit: 'contain', offsetX: 0, offsetY: 0, shape: 'round', frame: true, shadow: true },
      badge: { show: true, auto: true, position: 'tr' },
      price: { style: 'pill', showOld: true },
      cta: { show: true, text: '' },
      description: { show: true },
      brand: { logo: true, logoBackdrop: 'auto', phone: true, email: true, web: true, instagram: false },
      overlayShade: 0.65
    };
  };

  /* Returns a complete, safe spec from any input: unknown keys are dropped, numbers clamped, colours validated,
     strings length-limited. Running it twice gives the same result. */
  P.sanitizeSpec = function (input) {
    var d = P.defaultSpec(), s = (input && typeof input === 'object') ? input : {};
    var bg = s.bg || {}, c = s.colors || {}, f = s.fonts || {}, z = s.sizes || {}, im = s.image || {}, b = s.badge || {}, pr = s.price || {},
        cta = s.cta || {}, de = s.description || {}, br = s.brand || {};
    return {
      v: 1,
      layout: pickEnum(s.layout, ENUMS.layout, d.layout), align: pickEnum(s.align, ENUMS.align, d.align), imageSide: pickEnum(s.imageSide, ENUMS.imageSide, d.imageSide),
      bg: { type: pickEnum(bg.type, ENUMS.bgType, d.bg.type), c1: hex(bg.c1, d.bg.c1), c2: hex(bg.c2, d.bg.c2), angle: num(bg.angle, 0, 360, d.bg.angle) },
      colors: { text: hex(c.text, d.colors.text), muted: hex(c.muted, d.colors.muted), accent: hex(c.accent, d.colors.accent),
        accentText: hex(c.accentText, d.colors.accentText), badge: hex(c.badge, d.colors.badge), badgeText: hex(c.badgeText, d.colors.badgeText) },
      fonts: { heading: pickEnum(f.heading, ENUMS.font, d.fonts.heading), body: pickEnum(f.body, ENUMS.font, d.fonts.body) },
      sizes: { title: num(z.title, 0.5, 1.8, 1), body: num(z.body, 0.6, 1.8, 1), price: num(z.price, 0.6, 2, 1), logo: num(z.logo, 0.5, 2, 1) },
      image: { scale: num(im.scale, 0.4, 1.3, 1), fit: pickEnum(im.fit, ENUMS.fit, d.image.fit), offsetX: num(im.offsetX, -40, 40, 0), offsetY: num(im.offsetY, -40, 40, 0),
        shape: pickEnum(im.shape, ENUMS.shape, d.image.shape), frame: bool(im.frame, d.image.frame), shadow: bool(im.shadow, d.image.shadow) },
      badge: { show: bool(b.show, true), auto: bool(b.auto, true), position: pickEnum(b.position, ENUMS.badgePos, d.badge.position) },
      price: { style: pickEnum(pr.style, ENUMS.priceStyle, d.price.style), showOld: bool(pr.showOld, true) },
      cta: { show: bool(cta.show, true), text: str(cta.text, 40, '') },
      description: { show: bool(de.show, true) },
      brand: { logo: bool(br.logo, true), logoBackdrop: pickEnum(br.logoBackdrop, ENUMS.logoBackdrop, 'auto'),
        phone: bool(br.phone, true), email: bool(br.email, true), web: bool(br.web, true), instagram: bool(br.instagram, false) },
      overlayShade: num(s.overlayShade, 0, 0.9, 0.65)
    };
  };

  /* Four read-only starting points. Saved (editable) templates live in the promo_templates table. */
  P.BUILTIN_TEMPLATES = [
    { id: 'builtin-classic', name: 'SubCore Classic', builtin: true, spec: P.sanitizeSpec({}) },
    { id: 'builtin-dark', name: 'Dark & Bold', builtin: true, spec: P.sanitizeSpec({
      layout: 'side', align: 'left', bg: { type: 'gradient', c1: '#18252d', c2: '#176f86', angle: 135 },
      colors: { text: '#ffffff', muted: '#cfe3e9', accent: '#ffb400', accentText: '#18252d', badge: '#b8321f', badgeText: '#ffffff' },
      image: { shape: 'round', frame: false, shadow: true, fit: 'contain' }, price: { style: 'pill' }, brand: { instagram: true } }) },
    { id: 'builtin-impact', name: 'Image Impact', builtin: true, spec: P.sanitizeSpec({
      layout: 'overlay', align: 'left', bg: { type: 'solid', c1: '#18252d', c2: '#18252d' },
      colors: { text: '#ffffff', muted: '#e1ecef', accent: '#b8321f', accentText: '#ffffff', badge: '#ffb400', badgeText: '#18252d' },
      image: { fit: 'cover', shape: 'rect', frame: false, shadow: false }, overlayShade: 0.7 }) },
    { id: 'builtin-print', name: 'Clean Print', builtin: true, spec: P.sanitizeSpec({
      layout: 'stack', align: 'center', bg: { type: 'solid', c1: '#ffffff', c2: '#ffffff' },
      colors: { text: '#18252d', muted: '#4f6a75', accent: '#18252d', accentText: '#ffffff', badge: '#b8321f', badgeText: '#ffffff' },
      fonts: { heading: 'serif', body: 'sans' }, image: { shape: 'rect', frame: false, shadow: false },
      price: { style: 'outline' }, cta: { show: false }, brand: { instagram: true } }) }
  ];

  /* ---------- prices (advert text only; never written anywhere) ---------- */
  // "12500", "12 500", "12,500.50", "12.500,50", "1.500" (=1500), "1,5" (=1.5) -> integer minor units, null if empty, NaN if invalid.
  P.parsePrice = function (input) {
    if (input === null || input === undefined) return null;
    if (typeof input === 'number') { if (!isFinite(input) || input < 0) return NaN; input = String(input); }
    var s = String(input).replace(/[\s ]/g, '');
    if (s === '') return null;
    if (!/^\d[\d.,]*$/.test(s) && !/^[.,]\d+$/.test(s)) return NaN;
    var lastDot = s.lastIndexOf('.'), lastCom = s.lastIndexOf(','), dec = null;
    if (lastDot > -1 && lastCom > -1) dec = lastDot > lastCom ? '.' : ',';
    else if (lastDot > -1 || lastCom > -1) {
      var sep = lastDot > -1 ? '.' : ',';
      var count = s.split(sep).length - 1;
      if (count === 1 && !/^\d{1,3}[.,]\d{3}$/.test(s)) dec = sep; // "1,5" / "12.75" decimals; "1.500" is thousands
      else if (count > 1 && !new RegExp('^\\d{1,3}(\\' + sep + '\\d{3})+$').test(s)) return NaN;
    }
    var ip, fp = '';
    if (dec) { var i = s.lastIndexOf(dec); ip = s.slice(0, i); fp = s.slice(i + 1); ip = ip.replace(/[.,]/g, ''); if (/[.,]/.test(fp)) return NaN; }
    else ip = s.replace(/[.,]/g, '');
    if (!/^\d*$/.test(ip) || !/^\d*$/.test(fp) || (ip === '' && fp === '')) return NaN;
    var frac = (fp + '00').slice(0, 2), up = fp.length > 2 && fp.charAt(2) >= '5' ? 1 : 0;
    var n = Number((ip || '0') + frac) + up;
    return (isFinite(n) && n <= 1e12) ? n : NaN;
  };
  var CUR = { ALL: { sq: 'Lekë', en: 'ALL' }, EUR: { sq: '€', en: '€' }, USD: { sq: '$', en: '$' }, GBP: { sq: '£', en: '£' } };
  P.formatPrice = function (minor, currency, lang) {
    var neg = minor < 0; minor = Math.abs(Math.round(minor || 0));
    var ip = String(Math.floor(minor / 100)), fp = String(minor % 100); while (fp.length < 2) fp = '0' + fp;
    var th = lang === 'sq' ? '.' : ',', dc = lang === 'sq' ? ',' : '.';
    ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, th);
    var body = (neg ? '-' : '') + ip + (fp === '00' ? '' : dc + fp);
    var c = String(currency || 'ALL').toUpperCase(), lab = CUR[c] ? CUR[c][lang === 'sq' ? 'sq' : 'en'] : c;
    return body + ' ' + lab;
  };
  // Percentage off, only when the old price is genuinely higher than the advertised price.
  P.discountPercent = function (oldMinor, newMinor) {
    if (!(oldMinor > 0) || !(newMinor >= 0) || newMinor >= oldMinor) return null;
    var p = Math.round((oldMinor - newMinor) * 100 / oldMinor);
    return p >= 1 && p <= 99 ? p : null;
  };

  /* Builds the advert content from a catalogue product — a COPY: the values can be edited freely and are never saved to the product.
     product: {id,name:{en,sq}|string,description:{..},price,compare_price,currency,image,images,sku,brand} */
  P.contentFromProduct = function (product, lang) {
    var p = product || {};
    function loc(v) { if (v && typeof v === 'object') return String(v[lang] || v.en || v.sq || ''); return String(v == null ? '' : v); }
    var desc = loc(p.description).replace(/\s+/g, ' ').trim();
    if (desc.length > 160) desc = desc.slice(0, 157).replace(/\s+\S*$/, '') + '…';
    var cmp = Number(p.compare_price);
    return {
      title: loc(p.name).slice(0, 120), description: desc,
      price: p.price != null && isFinite(Number(p.price)) ? String(Number(p.price)) : '',
      oldPrice: isFinite(cmp) && cmp > Number(p.price) ? String(cmp) : '',
      offer: '', currency: String(p.currency || 'ALL').toUpperCase().slice(0, 3), imageUrl: p.image || (Array.isArray(p.images) && p.images[0]) || ''
    };
  };

  /* Checks the advert content; returns {errors:[code], warnings:[code]}. */
  P.checkContent = function (ad) {
    var errors = [], warnings = [];
    if (!String(ad.title || '').trim()) errors.push('title_required');
    var pr = P.parsePrice(ad.price), old = P.parsePrice(ad.oldPrice);
    if (pr === null) warnings.push('no_price'); else if (isNaN(pr)) errors.push('price_invalid');
    if (old !== null && isNaN(old)) errors.push('old_price_invalid');
    if (old !== null && !isNaN(old) && pr !== null && !isNaN(pr) && old <= pr) warnings.push('old_price_not_higher');
    if (pr === 0) warnings.push('price_zero');
    return { errors: errors, warnings: warnings };
  };

  /* ---------- PDF writer: one page, one JPEG, full bleed ---------- */
  function ascii(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; }
  function pdfText(s) { return String(s || '').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '').slice(0, 120); }
  function n2(x) { return (Math.round(x * 100) / 100).toString(); }
  P.buildPdf = function (o) {
    var jpeg = o.jpeg, w = o.width | 0, h = o.height | 0, pw = n2(o.pageW), ph = n2(o.pageH);
    if (!(jpeg instanceof Uint8Array) || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('jpeg_required');
    if (!(w > 0 && h > 0 && o.pageW > 0 && o.pageH > 0)) throw new Error('bad_size');
    var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var stamp = 'D:' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
    var content = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im0 Do Q';
    var parts = [], offsets = [], pos = 0;
    function put(u8) { parts.push(u8); pos += u8.length; }
    function obj(n, headStr, stream) {
      offsets[n] = pos;
      put(ascii(n + ' 0 obj\n' + headStr + (stream ? '\nstream\n' : '\n')));
      if (stream) { put(stream); put(ascii('\nendstream\n')); }
      put(ascii('endobj\n'));
    }
    put(ascii('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>');
    obj(4, '<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>', jpeg);
    obj(5, '<< /Length ' + content.length + ' >>', ascii(content));
    obj(6, '<< /Title (' + pdfText(o.title || 'Promotion') + ') /Producer (SubCore Solutions promo generator) /Creator (SubCore Solutions) /CreationDate (' + stamp + ') >>');
    var xref = pos, x = 'xref\n0 7\n0000000000 65535 f \n';
    for (var i = 1; i <= 6; i++) { var s = String(offsets[i]); while (s.length < 10) s = '0' + s; x += s + ' 00000 n \n'; }
    x += 'trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    put(ascii(x));
    var out = new Uint8Array(pos), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  };

  /* ---------- file names ---------- */
  P.fileName = function (title, formatId, ext) {
    var base = String(title || 'promo').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'promo';
    return 'subcore-' + base + '-' + formatId + '.' + ext;
  };

  /* =====================================================================
     Canvas drawing (browser only below this line)
     ===================================================================== */
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function font(weight, px, fam) { return weight + ' ' + Math.round(px) + 'px ' + FONT_STACKS[fam]; }
  // Greedy word wrap; a single over-long word is broken by characters.
  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/).filter(Boolean), lines = [], cur = '';
    function push(w) {
      while (ctx.measureText(w).width > maxW && w.length > 1) {
        var k = w.length; while (k > 1 && ctx.measureText(w.slice(0, k)).width > maxW) k--;
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      cur = w;
    }
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW) cur = t; else { if (cur) lines.push(cur); cur = ''; push(w); }
    });
    if (cur) lines.push(cur);
    return lines;
  }
  // Largest font size (<= start, >= min) whose wrapped text fits maxLines.
  function fit(ctx, text, weight, fam, maxW, maxLines, start, min) {
    var size = start, lines;
    for (;;) {
      ctx.font = font(weight, size, fam); lines = wrap(ctx, text, maxW);
      if (lines.length <= maxLines || size <= min) break;
      size = Math.max(min, size * 0.94);
    }
    if (lines.length > maxLines) { // still too long at the minimum size: cut with an ellipsis
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = last.replace(/\s+$/, '') + '…';
    }
    return { size: size, lines: lines };
  }
  function lum(h) { // relative luminance 0..1 of #rgb / #rrggbb
    h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(function (x) { return x + x; }).join('');
    var v = [0, 2, 4].map(function (i) { var c = parseInt(h.substr(i, 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  // The brand logo is white lettering, so it needs a dark surface: automatic = dark chip on light backgrounds, none on dark ones.
  function logoChip(spec) {
    if (spec.brand.logoBackdrop === 'dark') return true;
    if (spec.brand.logoBackdrop === 'none') return false;
    if (spec.layout === 'overlay') return false; // darkened photo
    var l = spec.bg.type === 'gradient' ? (lum(spec.bg.c1) + lum(spec.bg.c2)) / 2 : lum(spec.bg.c1);
    return l > 0.25;
  }
  function bgFill(ctx, spec, W, H) {
    var b = spec.bg;
    if (b.type === 'gradient') {
      var a = (b.angle - 90) * Math.PI / 180, cx = W / 2, cy = H / 2, r = Math.abs(W * Math.cos(a)) / 2 + Math.abs(H * Math.sin(a)) / 2;
      var g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      g.addColorStop(0, b.c1); g.addColorStop(1, b.c2); ctx.fillStyle = g;
    } else ctx.fillStyle = b.c1;
    ctx.fillRect(0, 0, W, H);
  }
  function drawImageInBox(ctx, img, box, spec, u, placeholder) {
    var im = spec.image;
    var bw = box.w * im.scale, bh = box.h * im.scale;
    var bx = box.x + (box.w - bw) / 2 + (im.offsetX / 100) * box.w, by = box.y + (box.h - bh) / 2 + (im.offsetY / 100) * box.h;
    if (spec.layout === 'overlay') { bx = box.x; by = box.y; bw = box.w; bh = box.h; }
    var radius = im.shape === 'circle' ? Math.min(bw, bh) / 2 : im.shape === 'round' ? 36 * u : 0;
    if (im.shape === 'circle') { var sz = Math.min(bw, bh); bx += (bw - sz) / 2; by += (bh - sz) / 2; bw = sz; bh = sz; }
    var pad = im.frame && spec.layout !== 'overlay' ? 22 * u : 0;
    // No image: the preview shows a hint, but an exported file never contains placeholder artwork.
    if (!(img && img.naturalWidth > 0) && !placeholder) return { x: bx, y: by, w: bw, h: bh };
    ctx.save();
    if (pad || im.shadow) {
      if (im.shadow && spec.layout !== 'overlay') { ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 40 * u; ctx.shadowOffsetY = 12 * u; }
      if (pad) { ctx.fillStyle = '#ffffff'; rr(ctx, bx, by, bw, bh, radius); ctx.fill(); }
      ctx.shadowColor = 'transparent';
    }
    var ix = bx + pad, iy = by + pad, iw = bw - 2 * pad, ih = bh - 2 * pad;
    if (img && img.naturalWidth > 0) {
      rr(ctx, ix, iy, iw, ih, Math.max(0, radius - pad)); ctx.clip();
      var sc = (im.fit === 'cover' || spec.layout === 'overlay') ? Math.max(iw / img.naturalWidth, ih / img.naturalHeight) : Math.min(iw / img.naturalWidth, ih / img.naturalHeight);
      var dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
      if (im.shadow && !pad && spec.layout !== 'overlay' && im.fit === 'contain') { ctx.shadowColor = 'rgba(0,0,0,0.28)'; ctx.shadowBlur = 36 * u; ctx.shadowOffsetY = 12 * u; }
      ctx.drawImage(img, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
    } else { // no image yet: a calm placeholder that is clearly not part of the final design intent
      ctx.fillStyle = 'rgba(127,127,127,0.18)'; rr(ctx, ix, iy, iw, ih, Math.max(0, radius - pad)); ctx.fill();
      ctx.fillStyle = 'rgba(127,127,127,0.7)'; ctx.font = font('600', 34 * u, 'sans'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('+ image', ix + iw / 2, iy + ih / 2);
    }
    ctx.restore();
    return { x: bx, y: by, w: bw, h: bh };
  }

  /* Draws the advert. opts: {format, spec, ad, images:{product, logo}, lang, scale}
     scale < 1 draws a smaller preview of the same layout; placeholder:true shows a "+ image" hint when there is no image (preview only). Returns {width,height, warnings:[]} */
  P.render = function (canvas, opts) {
    var fmt = typeof opts.format === 'string' ? P.FORMATS[opts.format] : opts.format;
    if (!fmt) throw new Error('unknown_format');
    var spec = P.sanitizeSpec(opts.spec), ad = opts.ad || {}, lang = opts.lang === 'en' ? 'en' : 'sq', scale = num(opts.scale, 0.05, 1, 1);
    var imgs = opts.images || {};
    var W = Math.round(fmt.w * scale), H = Math.round(fmt.h * scale);
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var u = Math.min(W, H) / 1080;           // one design unit
    var m = 64 * u, warn = [];
    var safeTop = H * fmt.safe, safeBot = H * fmt.safe;
    var landscape = W / H > 1.25;
    var layout = spec.layout === 'stack' && landscape ? 'side' : spec.layout;
    var s2 = spec; if (layout !== spec.layout) { s2 = JSON.parse(JSON.stringify(spec)); s2.layout = layout; }
    spec = s2;

    ctx.clearRect(0, 0, W, H);
    bgFill(ctx, spec, W, H);
    ctx.textBaseline = 'alphabetic';

    // footer metrics (logo + contact lines)
    var B = P.BRAND, contacts = [];
    if (spec.brand.phone) contacts.push(B.phone);
    if (spec.brand.email) contacts.push(B.email);
    if (spec.brand.web) contacts.push(B.web);
    if (spec.brand.instagram) contacts.push(B.instagram);
    var footerH = (spec.brand.logo || contacts.length) ? 118 * u * Math.max(0.8, Math.min(1.4, spec.sizes.logo)) : 0;
    var content = { x: m, y: m + safeTop, w: W - 2 * m, h: H - 2 * m - safeTop - safeBot - (footerH ? footerH + 24 * u : 0) };
    var footerY = H - m - safeBot - footerH;

    // regions
    var imgBox, textBox;
    if (layout === 'overlay') {
      imgBox = { x: 0, y: 0, w: W, h: H };
      textBox = { x: content.x, y: content.y, w: content.w, h: content.h };
    } else if (layout === 'side') {
      var iw = content.w * 0.46, gap = 40 * u, tw = content.w - iw - gap;
      var left = spec.imageSide === 'left';
      imgBox = { x: left ? content.x : content.x + tw + gap, y: content.y, w: iw, h: content.h };
      textBox = { x: left ? content.x + iw + gap : content.x, y: content.y, w: tw, h: content.h };
    } else {
      var ih = content.h * (H / W > 1.5 ? 0.46 : 0.5), g2 = 36 * u;
      imgBox = { x: content.x, y: content.y, w: content.w, h: ih };
      textBox = { x: content.x, y: content.y + ih + g2, w: content.w, h: content.h - ih - g2 };
    }

    // image first (overlay needs it behind everything)
    var drawn = null;
    if (layout === 'overlay') {
      drawn = drawImageInBox(ctx, imgs.product, imgBox, spec, u, !!opts.placeholder);
      var g = ctx.createLinearGradient(0, H * 0.25, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + spec.overlayShade + ')');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else drawn = drawImageInBox(ctx, imgs.product, imgBox, spec, u, !!opts.placeholder);

    // text block, sized so it always fits its box
    var C = spec.colors, al = spec.align, tx = textBox.x, tw2 = textBox.w;
    var anchorX = al === 'left' ? tx : al === 'center' ? tx + tw2 / 2 : tx + tw2;
    ctx.textAlign = al;
    var price = P.parsePrice(ad.price), old = P.parsePrice(ad.oldPrice);
    var priceStr = (price !== null && !isNaN(price)) ? P.formatPrice(price, ad.currency, lang) : '';
    var oldStr = (old !== null && !isNaN(old) && spec.price.showOld && (price === null || isNaN(price) || old > price)) ? P.formatPrice(old, ad.currency, lang) : '';
    var title = String(ad.title || '').trim(), desc = spec.description.show ? String(ad.description || '').trim() : '';
    var ctaText = spec.cta.show ? (spec.cta.text || (lang === 'sq' ? 'Na kontaktoni sot' : 'Contact us today')) : '';
    var pctVal = P.discountPercent(old, price);
    var offer = String(ad.offer || '').trim().slice(0, 28);
    var badgeText = offer || (spec.badge.auto && pctVal ? '-' + pctVal + '%' : '');
    if (!spec.badge.show) badgeText = '';

    var k = 1, blocks = null;
    for (var tries = 0; tries < 12; tries++, k *= 0.93) {
      var bl = [], total = 0;
      var tSize = 76 * u * spec.sizes.title * k;
      var t = fit(ctx, title, '700', spec.fonts.heading, tw2, 3, tSize, 30 * u);
      var tLH = t.size * 1.12; bl.push({ kind: 'title', lines: t.lines, size: t.size, lh: tLH, h: t.lines.length * tLH }); total += bl[0].h;
      if (desc) {
        var dSize = 32 * u * spec.sizes.body * k, d = fit(ctx, desc, '400', spec.fonts.body, tw2, landscape ? 2 : 3, dSize, 18 * u);
        var dLH = d.size * 1.35; bl.push({ kind: 'desc', lines: d.lines, size: d.size, lh: dLH, h: d.lines.length * dLH, gap: 18 * u }); total += 18 * u + bl[bl.length - 1].h;
      }
      if (oldStr) { var os = 36 * u * spec.sizes.price * k; bl.push({ kind: 'old', text: oldStr, size: os, h: os * 1.25, gap: 26 * u }); total += 26 * u + os * 1.25; }
      if (priceStr) {
        var ps = 78 * u * spec.sizes.price * k; ctx.font = font('800', ps, spec.fonts.heading);
        var maxPW = tw2 - 2 * 30 * u, sizeP = ps;
        while (ctx.measureText(priceStr).width > maxPW && sizeP > 24 * u) { sizeP *= 0.94; ctx.font = font('800', sizeP, spec.fonts.heading); }
        var padY = spec.price.style === 'plain' ? 0 : 20 * u;
        bl.push({ kind: 'price', text: priceStr, size: sizeP, pad: padY, h: sizeP * 1.15 + 2 * padY, gap: oldStr ? 8 * u : 26 * u }); total += bl[bl.length - 1].gap + bl[bl.length - 1].h;
      }
      if (ctaText) { var cs = 30 * u * spec.sizes.body * k; bl.push({ kind: 'cta', text: ctaText, size: cs, h: cs * 1.25 + 2 * 18 * u, gap: 28 * u }); total += 28 * u + bl[bl.length - 1].h; }
      blocks = bl;
      if (total <= textBox.h) break;
    }
    // vertical placement: overlay anchors to the bottom of the text box, others to the top
    var totalH = blocks.reduce(function (a, b2, i) { return a + b2.h + (i ? (b2.gap || 20 * u) : 0); }, 0);
    var y = layout === 'overlay' ? textBox.y + textBox.h - totalH : textBox.y;
    if (layout === 'side') y = textBox.y + Math.max(0, (textBox.h - totalH) / 2);
    if (totalH > textBox.h + 1) warn.push('text_overflow');
    blocks.forEach(function (b2, i) {
      if (i) y += (b2.gap || 20 * u);
      if (b2.kind === 'title') {
        ctx.fillStyle = C.text; ctx.font = font('700', b2.size, spec.fonts.heading);
        b2.lines.forEach(function (ln, j) { ctx.fillText(ln, anchorX, y + (j + 0.82) * b2.lh); });
      } else if (b2.kind === 'desc') {
        ctx.fillStyle = C.muted; ctx.font = font('400', b2.size, spec.fonts.body);
        b2.lines.forEach(function (ln, j) { ctx.fillText(ln, anchorX, y + (j + 0.85) * b2.lh); });
      } else if (b2.kind === 'old') {
        ctx.font = font('500', b2.size, spec.fonts.body); ctx.fillStyle = C.muted;
        var ow = ctx.measureText(b2.text).width, ox = al === 'left' ? anchorX : al === 'center' ? anchorX - ow / 2 : anchorX - ow;
        ctx.fillText(b2.text, anchorX, y + b2.size);
        ctx.strokeStyle = C.muted; ctx.lineWidth = Math.max(2, b2.size * 0.07);
        ctx.beginPath(); ctx.moveTo(ox - 4 * u, y + b2.size * 0.62); ctx.lineTo(ox + ow + 4 * u, y + b2.size * 0.62); ctx.stroke();
      } else if (b2.kind === 'price') {
        ctx.font = font('800', b2.size, spec.fonts.heading);
        var pw = ctx.measureText(b2.text).width, boxW = pw + 2 * 30 * u, bx = al === 'left' ? tx : al === 'center' ? tx + (tw2 - boxW) / 2 : tx + tw2 - boxW;
        if (spec.price.style === 'plain') { ctx.fillStyle = C.accent; ctx.fillText(b2.text, anchorX, y + b2.size * 0.9); }
        else {
          rr(ctx, bx, y, boxW, b2.h, b2.h / 2);
          if (spec.price.style === 'pill') { ctx.fillStyle = C.accent; ctx.fill(); ctx.fillStyle = C.accentText; }
          else { ctx.lineWidth = 5 * u; ctx.strokeStyle = C.accent; ctx.stroke(); ctx.fillStyle = C.accent; }
          ctx.textAlign = 'center'; ctx.fillText(b2.text, bx + boxW / 2, y + b2.pad + b2.size * 0.9); ctx.textAlign = al;
        }
      } else if (b2.kind === 'cta') {
        ctx.font = font('700', b2.size, spec.fonts.body);
        var cw = ctx.measureText(b2.text).width + 2 * 34 * u, cx0 = al === 'left' ? tx : al === 'center' ? tx + (tw2 - cw) / 2 : tx + tw2 - cw;
        rr(ctx, cx0, y, cw, b2.h, 12 * u); ctx.lineWidth = 3 * u; ctx.strokeStyle = C.text; ctx.fillStyle = 'rgba(255,255,255,0)'; ctx.stroke();
        ctx.fillStyle = C.text; ctx.textAlign = 'center'; ctx.fillText(b2.text, cx0 + cw / 2, y + 18 * u + b2.size * 0.95); ctx.textAlign = al;
      }
      y += b2.h;
    });

    // badge on the image
    if (badgeText) {
      var bs = 44 * u; ctx.font = font('800', bs, spec.fonts.heading); ctx.textAlign = 'center';
      var bw2 = Math.max(ctx.measureText(badgeText).width + 2 * 28 * u, 120 * u), bh2 = bs * 1.1 + 2 * 14 * u;
      var ref = drawn || imgBox, inset = 18 * u, pos = spec.badge.position;
      var bx2 = pos[1] === 'l' ? ref.x + inset : ref.x + ref.w - bw2 - inset;
      var by2 = pos[0] === 't' ? ref.y + inset : ref.y + ref.h - bh2 - inset;
      if (layout === 'overlay' && pos[0] === 'b') by2 = Math.min(by2, textBox.y - bh2 - inset);
      if (layout === 'overlay' && pos[0] === 't') by2 = Math.max(by2, m + safeTop);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 14 * u; ctx.shadowOffsetY = 4 * u;
      rr(ctx, bx2, by2, bw2, bh2, bh2 / 2); ctx.fillStyle = C.badge; ctx.fill(); ctx.restore();
      ctx.fillStyle = C.badgeText; ctx.fillText(badgeText, bx2 + bw2 / 2, by2 + 14 * u + bs * 0.88);
    }

    // footer: logo left, contact lines right
    if (footerH) {
      var fy = footerY, lh = footerH;
      if (spec.brand.logo) {
        var logo = imgs.logo, logoH = Math.min(lh - (logoChip(spec) ? 32 * u : 0), 96 * u * spec.sizes.logo), logoW = logo && logo.naturalWidth ? logoH * logo.naturalWidth / logo.naturalHeight : 280 * u;
        var chip = logoChip(spec), padL = chip ? 16 * u : 0;
        if (chip) { ctx.fillStyle = '#18252d'; rr(ctx, m, fy + (lh - logoH) / 2 - padL, logoW + 2 * padL, logoH + 2 * padL, 14 * u); ctx.fill(); }
        if (logo && logo.naturalWidth) ctx.drawImage(logo, m + padL, fy + (lh - logoH) / 2, logoW, logoH);
        else { ctx.textAlign = 'left'; ctx.fillStyle = C.text; ctx.font = font('700', 40 * u, 'sans'); ctx.fillText(B.name, m + padL, fy + lh / 2 + 14 * u); }
      }
      if (contacts.length) {
        var cs2 = Math.min(30 * u, (lh - 8 * u) / contacts.length / 1.25);
        ctx.font = font('500', cs2, 'sans'); ctx.fillStyle = layout === 'overlay' ? '#ffffff' : C.text; ctx.textAlign = 'right';
        var ch = cs2 * 1.3, cy0 = fy + (lh - ch * contacts.length) / 2;
        contacts.forEach(function (c2, j) { ctx.fillText(c2, W - m, cy0 + (j + 0.85) * ch); });
      }
    }
    return { width: W, height: H, warnings: warn };
  };

  /* ---------- loading images (browser) ---------- */
  // Loads an image from a data: URL, a same-origin path or an https Supabase URL. Cross-origin images are requested with
  // CORS so the canvas stays exportable; if the host refuses, the promise rejects and the caller asks for an upload instead.
  P.loadImage = function (src, crossOrigin) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (crossOrigin) img.crossOrigin = 'anonymous';
      img.onload = function () {
        if (img.naturalWidth * img.naturalHeight > 60e6) reject(new Error('image_too_large')); else resolve(img);
      };
      img.onerror = function () { reject(new Error('image_load_failed')); };
      img.src = src;
    });
  };

  /* ---------- exporting (browser) ---------- */
  function toBlob(canvas, type, q) {
    return new Promise(function (resolve, reject) {
      try { canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('export_failed')); }, type, q); }
      catch (e) { reject(new Error(e && e.name === 'SecurityError' ? 'canvas_tainted' : 'export_failed')); }
    });
  }
  P.exportPng = function (canvas) { return toBlob(canvas, 'image/png'); };
  P.exportJpeg = function (canvas, q) { return toBlob(canvas, 'image/jpeg', q || 0.92); };
  P.exportPdf = function (canvas, format, title) {
    var fmt = typeof format === 'string' ? P.FORMATS[format] : format;
    return toBlob(canvas, 'image/jpeg', 0.94).then(function (b) { return b.arrayBuffer(); }).then(function (buf) {
      var pdf = P.buildPdf({ jpeg: new Uint8Array(buf), width: canvas.width, height: canvas.height, pageW: fmt.pt[0], pageH: fmt.pt[1], title: title });
      return new Blob([pdf], { type: 'application/pdf' });
    });
  };

  return P;
});
