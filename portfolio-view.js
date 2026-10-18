/* Portfolio rendering shared by the public Projects pages and the admin "Preview".
   Pure functions: they return HTML strings and take the helpers they need, so the admin panel
   (which has its own helpers) and the public site (shop-core.js helpers) draw the same thing.
   Every value that comes from the database is escaped here; URLs are accepted only if http(s). */
(function (root) {
  "use strict";

  const globalHelpers = () => ({
    esc: root.escapeHtml,
    loc: root.loc,
    t: root.tr,
    lang: typeof root.getShopLang === "function" ? root.getShopLang() : "sq"
  });

  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : "");

  function dateLabel(iso, lang) {
    if (!iso) return "";
    const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
    if (isNaN(d)) return "";
    try { return d.toLocaleDateString(lang === "en" ? "en-GB" : "sq-AL", { month: "long", year: "numeric", timeZone: "UTC" }); }
    catch { return String(iso).slice(0, 4); }
  }

  function paragraphs(text, esc) {
    return String(text || "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
      .map((x) => "<p>" + esc(x).replace(/\n/g, "<br>") + "</p>").join("");
  }

  const placeholder = (esc) =>
    '<span class="project-ph" aria-hidden="true"><svg class="icon icon-lg"><use href="icons.svg#package"/></svg></span>';

  /* A card for the grid. `href` lets the admin preview disable navigation. */
  function card(p, h, opts) {
    h = h || globalHelpers(); opts = opts || {};
    const href = opts.href !== undefined ? opts.href : "project.html?id=" + encodeURIComponent(p.id);
    const title = h.loc(p.title);
    const cover = safeUrl(p.cover_image);
    const tech = (p.technologies || []).slice(0, 4).map((x) => "<li>" + h.esc(x) + "</li>").join("");
    const status = p.project_status && p.project_status !== "completed"
      ? '<span class="project-badge">' + h.esc(h.t("projects.status." + p.project_status)) + "</span>" : "";
    const feat = p.featured ? '<span class="project-badge project-badge-feat">' + h.esc(h.t("projects.featured")) + "</span>" : "";
    return '<article class="project-card' + (p.featured ? " is-featured" : "") + '">' +
      '<a class="project-media" href="' + h.esc(href) + '" tabindex="-1" aria-hidden="true">' +
        (cover ? '<img src="' + h.esc(cover) + '" alt="" loading="lazy" decoding="async">' : placeholder(h.esc)) +
        (feat || status ? '<span class="project-badges">' + feat + status + "</span>" : "") + "</a>" +
      '<div class="project-body">' +
        '<span class="project-cat">' + h.esc(h.loc(p.category)) + "</span>" +
        '<h3><a href="' + h.esc(href) + '">' + h.esc(title) + "</a></h3>" +
        "<p>" + h.esc(h.loc(p.summary)) + "</p>" +
        (tech ? '<ul class="tag-list" aria-label="' + h.esc(h.t("projects.tech")) + '">' + tech + "</ul>" : "") +
      "</div></article>";
  }

  /* Full project page body. `services` = [{id, name}] already resolved by the caller. */
  function detail(p, h, services) {
    h = h || globalHelpers(); services = services || [];
    const title = h.loc(p.title);
    const images = [safeUrl(p.cover_image)].concat((p.images || []).map(safeUrl)).filter(Boolean)
      .filter((u, i, a) => a.indexOf(u) === i);
    const main = images[0]
      ? '<img id="project-main-img" src="' + h.esc(images[0]) + '" alt="' + h.esc(title) + '" decoding="async">'
      : placeholder(h.esc);
    const thumbs = images.length > 1
      ? '<div class="project-thumbs" role="list">' + images.map((u, i) =>
          '<button type="button" class="project-thumb' + (i === 0 ? " active" : "") + '" role="listitem" data-img="' + h.esc(u) +
          '" aria-label="' + h.esc(h.t("projects.image") + " " + (i + 1)) + '"><img src="' + h.esc(u) + '" alt="" loading="lazy"></button>').join("") + "</div>"
      : "";
    const when = dateLabel(p.completed_on, h.lang);
    const meta = [
      [h.t("projects.category"), h.esc(h.loc(p.category))],
      [h.t("projects.statusLabel"), h.esc(h.t("projects.status." + (p.project_status || "completed")))],
      when ? [h.t("projects.completed"), h.esc(when)] : null
    ].filter(Boolean).map((r) => "<div><dt>" + h.esc(r[0]) + "</dt><dd>" + r[1] + "</dd></div>").join("");
    const url = safeUrl(p.url);
    const tech = (p.technologies || []).length
      ? '<h2>' + h.esc(h.t("projects.tech")) + '</h2><ul class="tag-list">' + p.technologies.map((x) => "<li>" + h.esc(x) + "</li>").join("") + "</ul>" : "";
    const svc = services.length
      ? '<h2>' + h.esc(h.t("projects.services")) + '</h2><ul class="tag-list tag-links">' + services.map((s) =>
          '<li><a href="services.html#' + h.esc(encodeURIComponent(s.id)) + '">' + h.esc(h.loc(s.name)) + "</a></li>").join("") + "</ul>" : "";
    return '<div class="project-detail">' +
      '<div class="project-gallery"><div class="project-hero">' + main + "</div>" + thumbs + "</div>" +
      '<div class="project-info">' +
        '<span class="project-cat">' + h.esc(h.loc(p.category)) + "</span>" +
        "<h1>" + h.esc(title) + "</h1>" +
        '<p class="lead">' + h.esc(h.loc(p.summary)) + "</p>" +
        '<dl class="project-meta">' + meta + "</dl>" +
        (url ? '<a class="button" href="' + h.esc(url) + '" target="_blank" rel="noopener noreferrer">' + h.esc(h.t("projects.visit")) + '</a>' : "") +
      "</div>" +
      '<div class="project-text">' + (paragraphs(h.loc(p.description), h.esc) ? "<h2>" + h.esc(h.t("projects.about")) + "</h2>" + paragraphs(h.loc(p.description), h.esc) : "") + tech + svc + "</div>" +
      "</div>";
  }

  const api = { card, detail, safeUrl, dateLabel };
  root.PortfolioView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
