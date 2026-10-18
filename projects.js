/* Public Projects pages (projects.html = list, project.html?id=… = one project).
   Only projects marked "published" are ever returned by the database to visitors (Row Level
   Security), so nothing unpublished can appear here. If the portfolio is empty or not installed
   yet, the page shows an honest "coming soon" message — it never invents projects. */
(function () {
  const grid = document.getElementById("project-grid");
  const root = document.getElementById("project-root");
  if (!grid && !root) return;

  let projects = null;   // null = not loaded, [] = loaded but empty
  let services = [];
  let filter = "all";
  let failed = false;

  const $ = (id) => document.getElementById(id);
  const catKey = (p) => (p.category && (p.category.en || p.category.sq)) || "";

  async function load() {
    try {
      const [list, svc] = await Promise.all([
        SupabaseClient.fetchProjects(),
        SupabaseClient.fetchServices().catch(() => [])
      ]);
      projects = (list || []).filter((p) => p.status === "published");
      services = svc || [];
    } catch (err) {
      console.warn("Projects unavailable.", err.message);
      failed = true; projects = [];
    }
    render();
  }

  function sorted(list) {
    return list.slice().sort((a, b) => Number(b.featured) - Number(a.featured) || a.display_order - b.display_order);
  }

  function renderList() {
    const empty = $("project-empty"), error = $("project-error"), bar = $("project-filters");
    if (projects === null) return;
    error.hidden = !failed;
    empty.hidden = failed || projects.length > 0;
    if (!projects.length) { grid.innerHTML = ""; bar.hidden = true; return; }

    const cats = [];
    projects.forEach((p) => { const k = catKey(p); if (k && !cats.some((c) => c.key === k)) cats.push({ key: k, label: loc(p.category) }); });
    if (filter !== "all" && !cats.some((c) => c.key === filter)) filter = "all";
    bar.hidden = cats.length < 2;
    bar.innerHTML = [{ key: "all", label: tr("projects.all") }].concat(cats).map((c) =>
      '<button type="button" class="filter-pill' + (c.key === filter ? " active" : "") + '" aria-pressed="' + (c.key === filter) + '" data-cat="' + escapeHtml(c.key) + '">' + escapeHtml(c.label) + "</button>").join("");
    const shown = sorted(projects.filter((p) => filter === "all" || catKey(p) === filter));
    grid.innerHTML = shown.map((p) => PortfolioView.card(p)).join("");
  }

  function renderDetail() {
    if (projects === null) return;
    const id = new URLSearchParams(location.search).get("id") || "";
    const p = projects.find((x) => x.id === id);
    const missing = $("project-missing");
    if (!p) { root.innerHTML = ""; missing.hidden = false; $("crumb-title").textContent = "—"; return; }
    missing.hidden = true;
    const linked = (p.services || []).map((sid) => services.find((s) => s.id === sid && s.available)).filter(Boolean);
    root.innerHTML = PortfolioView.detail(p, undefined, linked);
    $("crumb-title").textContent = loc(p.title);
    document.title = loc(p.title) + " — SubCore Solutions";
    const d = document.querySelector('meta[name="description"]');
    if (d) d.setAttribute("content", loc(p.summary));
  }

  function render() { grid ? renderList() : renderDetail(); }

  document.addEventListener("click", (e) => {
    const pill = e.target.closest && e.target.closest(".filter-pill");
    if (pill) { filter = pill.dataset.cat; renderList(); return; }
    const th = e.target.closest && e.target.closest(".project-thumb");
    if (th) {
      const img = $("project-main-img");
      if (img) img.src = th.dataset.img;
      document.querySelectorAll(".project-thumb").forEach((b) => b.classList.toggle("active", b === th));
    }
  });
  document.addEventListener("langchange", render);
  load();
})();
