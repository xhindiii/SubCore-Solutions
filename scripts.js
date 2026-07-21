const WHATSAPP_NUMBER = "355686661686";
const DEFAULT_LANG = "sq";

function getLang() {
  return localStorage.getItem("lang") || DEFAULT_LANG;
}

function setLang(lang) {
  localStorage.setItem("lang", lang);
  document.documentElement.lang = lang === "sq" ? "sq" : "en";
  applyTranslations(lang);
  updateLangButtons(lang);
  document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}

function applyTranslations(lang) {
  const t = translations[lang];
  if (!t) return;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (t[key]) el.textContent = t[key];
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (t[key]) el.placeholder = t[key];
  });

  document.querySelectorAll("select option[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (t[key]) el.textContent = t[key];
  });

  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (t[key]) el.setAttribute("aria-label", t[key]);
  });
}

function updateLangButtons(lang) {
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === lang);
    btn.setAttribute("aria-pressed", btn.dataset.lang === lang ? "true" : "false");
  });
}

function initLangSwitcher() {
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => setLang(btn.dataset.lang));
  });
  const lang = getLang();
  document.documentElement.lang = lang === "sq" ? "sq" : "en";
  applyTranslations(lang);
  updateLangButtons(lang);
}

function initMobileMenu() {
  const toggle = document.querySelector(".menu-toggle");
  const nav = document.querySelector("header nav");
  const overlay = document.querySelector(".nav-overlay");
  if (!toggle || !nav) return;

  function closeMenu() {
    nav.classList.remove("open");
    toggle.classList.remove("active");
    overlay?.classList.remove("visible");
    document.body.classList.remove("menu-open");
    toggle.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    nav.classList.add("open");
    toggle.classList.add("active");
    overlay?.classList.add("visible");
    document.body.classList.add("menu-open");
    toggle.setAttribute("aria-expanded", "true");
  }

  toggle.addEventListener("click", () => {
    if (nav.classList.contains("open")) closeMenu();
    else openMenu();
  });

  overlay?.addEventListener("click", closeMenu);

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}

function initScrollAnimations() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          entry.target.style.transitionDelay = `${Math.min(i * 0.08, 0.4)}s`;
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );

  document.querySelectorAll(".fade-in").forEach((el) => observer.observe(el));
}

function sendEmail(event) {
  event.preventDefault();

  const name = document.getElementById("name").value;
  const email = document.getElementById("email").value;
  const phone = document.getElementById("phone")?.value || "";
  const service = document.getElementById("service")?.value || "";
  const message = document.getElementById("message").value;

  let body = `Name: ${name}\nEmail: ${email}`;
  if (phone) body += `\nPhone: ${phone}`;
  if (service) body += `\nService: ${service}`;
  body += `\n\n${message}`;

  const subject = encodeURIComponent("Contact from Website - " + name);
  const encodedBody = encodeURIComponent(body);

  window.location.href = `mailto:info.subcoresolutions@gmail.com?subject=${subject}&body=${encodedBody}`;
}

function prefillServiceFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const service = params.get("service");
  const select = document.getElementById("service");
  if (service && select) {
    const option = select.querySelector(`option[value="${service}"]`);
    if (option) select.value = service;
  }
}

function initHeaderScroll() {
  const header = document.querySelector("header");
  if (!header) return;

  const onScroll = () => {
    header.classList.toggle("scrolled", window.scrollY > 10);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

function initActiveNav() {
  const path = window.location.pathname.split("/").pop() || "index.html";
  const hash = window.location.hash;

  document.querySelectorAll("header nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const isHome = path === "index.html" || path === "";
    const isHashLink = href.includes("#");

    link.classList.remove("active");

    if (isHashLink && isHome && hash && href.endsWith(hash)) {
      link.classList.add("active");
    } else if (!isHashLink && href === path) {
      link.classList.add("active");
    } else if (!isHashLink && isHome && (href === "index.html" || href === "./")) {
      link.classList.add("active");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initLangSwitcher();
  initMobileMenu();
  initScrollAnimations();
  initHeaderScroll();
  initActiveNav();
  prefillServiceFromUrl();
  if (typeof Cart !== "undefined") Cart.updateBadge();
});
