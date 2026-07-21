const WHATSAPP_NUMBER = "355686661686";
const DEFAULT_LANG = "sq";

// Toast Notification System (shared across site)
const Toast = {
  container: null,
  
  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  
  show(type, title, message, duration = 5000) {
    this.init();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
      success: '✓',
      error: '✕',
      info: 'ℹ'
    };
    
    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || icons.info}</div>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button type="button" class="toast-close" aria-label="Close notification">×</button>
    `;
    
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => this.dismiss(toast));
    
    this.container.appendChild(toast);
    
    if (duration > 0) {
      setTimeout(() => this.dismiss(toast), duration);
    }
    
    return toast;
  },
  
  success(title, message, duration) {
    return this.show('success', title, message, duration);
  },
  
  error(title, message, duration) {
    return this.show('error', title, message, duration);
  },
  
  info(title, message, duration) {
    return this.show('info', title, message, duration);
  },
  
  dismiss(toast) {
    if (!toast || !toast.parentNode) return;
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    });
  }
};

// Form Validation Helper
const FormValidator = {
  validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  },
  
  validatePhone(phone) {
    const re = /^[\d\s\+\-\(\)]+$/;
    return re.test(phone) && phone.replace(/\D/g, '').length >= 8;
  },
  
  validateRequired(value) {
    return value && value.trim().length > 0;
  },
  
  validateMinLength(value, min) {
    return value && value.trim().length >= min;
  },
  
  setFieldState(field, state, message = '') {
    const formGroup = field.closest('.form-group');
    if (!formGroup) return;
    
    formGroup.classList.remove('has-error', 'has-success');
    
    let messageEl = formGroup.querySelector('.validation-message');
    if (!messageEl) {
      messageEl = document.createElement('div');
      messageEl.className = 'validation-message';
      formGroup.appendChild(messageEl);
    }
    
    if (state === 'error') {
      formGroup.classList.add('has-error');
      messageEl.textContent = message;
      messageEl.classList.add('visible', 'error');
      messageEl.classList.remove('success');
    } else if (state === 'success') {
      formGroup.classList.add('has-success');
      messageEl.textContent = message;
      messageEl.classList.add('visible', 'success');
      messageEl.classList.remove('error');
    } else {
      messageEl.classList.remove('visible', 'error', 'success');
    }
  },
  
  clearFieldState(field) {
    const formGroup = field.closest('.form-group');
    if (!formGroup) return;
    
    formGroup.classList.remove('has-error', 'has-success');
    const messageEl = formGroup.querySelector('.validation-message');
    if (messageEl) {
      messageEl.classList.remove('visible', 'error', 'success');
    }
  }
};

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
  
  const form = event.target;
  const formGroup = form.closest('.contact-grid');
  
  const nameField = document.getElementById("name");
  const emailField = document.getElementById("email");
  const phoneField = document.getElementById("phone");
  const serviceField = document.getElementById("service");
  const messageField = document.getElementById("message");
  
  let isValid = true;
  
  // Validate name
  if (!FormValidator.validateRequired(nameField.value)) {
    FormValidator.setFieldState(nameField, 'error', 'Name is required');
    isValid = false;
  } else {
    FormValidator.setFieldState(nameField, 'success');
  }
  
  // Validate email
  if (!FormValidator.validateEmail(emailField.value)) {
    FormValidator.setFieldState(emailField, 'error', 'Please enter a valid email address');
    isValid = false;
  } else {
    FormValidator.setFieldState(emailField, 'success');
  }
  
  // Validate phone if present
  if (phoneField && phoneField.value && !FormValidator.validatePhone(phoneField.value)) {
    FormValidator.setFieldState(phoneField, 'error', 'Please enter a valid phone number');
    isValid = false;
  } else if (phoneField && phoneField.value) {
    FormValidator.setFieldState(phoneField, 'success');
  }
  
  // Validate message
  if (!FormValidator.validateMinLength(messageField.value, 10)) {
    FormValidator.setFieldState(messageField, 'error', 'Message must be at least 10 characters');
    isValid = false;
  } else {
    FormValidator.setFieldState(messageField, 'success');
  }
  
  if (!isValid) {
    Toast.error('Form Error', 'Please fix the errors before submitting');
    return;
  }
  
  // Add loading state
  form.classList.add('form-submitting');
  
  const name = nameField.value.trim().replace(/[<>]/g, '');
  const email = emailField.value.trim();
  const phone = phoneField?.value.trim().replace(/[<>]/g, '') || "";
  const service = serviceField?.value.trim() || "";
  const message = messageField.value.trim().replace(/[<>]/g, '');

  let body = `Name: ${name}\nEmail: ${email}`;
  if (phone) body += `\nPhone: ${phone}`;
  if (service) body += `\nService: ${service}`;
  body += `\n\n${message}`;

  const subject = encodeURIComponent("Contact from Website - " + name);
  const encodedBody = encodeURIComponent(body);

  // Simulate form submission delay
  setTimeout(() => {
    window.location.href = `mailto:info.subcoresolutions@gmail.com?subject=${subject}&body=${encodedBody}`;
    
    form.classList.remove('form-submitting');
    Toast.success('Message Sent', 'Your email client should open with the message pre-filled');
    
    // Clear form
    form.reset();
    [nameField, emailField, phoneField, messageField].forEach(field => {
      if (field) FormValidator.clearFieldState(field);
    });
  }, 500);
}

function initContactFormValidation() {
  const nameField = document.getElementById("name");
  const emailField = document.getElementById("email");
  const phoneField = document.getElementById("phone");
  const messageField = document.getElementById("message");
  
  if (nameField) {
    nameField.addEventListener('blur', () => {
      if (nameField.value) {
        if (FormValidator.validateRequired(nameField.value)) {
          FormValidator.setFieldState(nameField, 'success');
        } else {
          FormValidator.setFieldState(nameField, 'error', 'Name is required');
        }
      }
    });
    
    nameField.addEventListener('input', () => {
      if (nameField.classList.contains('has-error')) {
        FormValidator.clearFieldState(nameField);
      }
    });
  }
  
  if (emailField) {
    emailField.addEventListener('blur', () => {
      if (emailField.value) {
        if (FormValidator.validateEmail(emailField.value)) {
          FormValidator.setFieldState(emailField, 'success');
        } else {
          FormValidator.setFieldState(emailField, 'error', 'Please enter a valid email address');
        }
      }
    });
    
    emailField.addEventListener('input', () => {
      if (emailField.classList.contains('has-error')) {
        FormValidator.clearFieldState(emailField);
      }
    });
  }
  
  if (phoneField) {
    phoneField.addEventListener('blur', () => {
      if (phoneField.value) {
        if (FormValidator.validatePhone(phoneField.value)) {
          FormValidator.setFieldState(phoneField, 'success');
        } else {
          FormValidator.setFieldState(phoneField, 'error', 'Please enter a valid phone number');
        }
      }
    });
    
    phoneField.addEventListener('input', () => {
      if (phoneField.classList.contains('has-error')) {
        FormValidator.clearFieldState(phoneField);
      }
    });
  }
  
  if (messageField) {
    messageField.addEventListener('blur', () => {
      if (messageField.value) {
        if (FormValidator.validateMinLength(messageField.value, 10)) {
          FormValidator.setFieldState(messageField, 'success');
        } else {
          FormValidator.setFieldState(messageField, 'error', 'Message must be at least 10 characters');
        }
      }
    });
    
    messageField.addEventListener('input', () => {
      if (messageField.classList.contains('has-error')) {
        FormValidator.clearFieldState(messageField);
      }
    });
  }
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
  initContactFormValidation();
  if (typeof Cart !== "undefined") Cart.updateBadge();
});
