/* Strings for the Projects pages and the "related projects" line on Services.
   Merged on top of translations.js (load after translations-extra.js). */
(function () {
  const extra = {
    en: {
      "projects.page.title": "Our projects",
      "projects.page.lead": "Websites, web applications and IT work delivered by SubCore Solutions.",
      "projects.all": "All",
      "projects.featured": "Featured",
      "projects.loading": "Loading projects…",
      "projects.empty.title": "Our portfolio is being prepared",
      "projects.empty.text": "Completed projects will be listed here. In the meantime, tell us what you need and we will answer with a clear offer.",
      "projects.empty.cta": "Request a quote",
      "projects.error": "Projects could not be loaded right now. Please try again later.",
      "projects.notfound": "This project is not available.",
      "projects.back": "All projects",
      "projects.tech": "Technologies",
      "projects.services": "Services delivered",
      "projects.about": "About this project",
      "projects.category": "Category",
      "projects.statusLabel": "Status",
      "projects.completed": "Completed",
      "projects.status.completed": "Completed",
      "projects.status.ongoing": "In progress",
      "projects.status.maintained": "Maintained by us",
      "projects.visit": "Visit the project",
      "projects.image": "Image",
      "projects.related": "Related projects",
      "projects.cta.title": "Need something similar?",
      "projects.cta.text": "Tell us about your project and we will reply with questions and a clear offer.",
      "projects.cta.btn": "Request a quote",
      "services.pricelabel": "Price"
    },
    sq: {
      "projects.page.title": "Projektet tona",
      "projects.page.lead": "Website, aplikacione web dhe punë IT të realizuara nga SubCore Solutions.",
      "projects.all": "Të gjitha",
      "projects.featured": "Në pah",
      "projects.loading": "Po ngarkohen projektet…",
      "projects.empty.title": "Portofoli po përgatitet",
      "projects.empty.text": "Projektet e përfunduara do të listohen këtu. Ndërkohë, na tregoni çfarë ju duhet dhe do t'ju kthejmë përgjigje me një ofertë të qartë.",
      "projects.empty.cta": "Kërko ofertë",
      "projects.error": "Projektet nuk mund të ngarkohen tani. Provoni përsëri më vonë.",
      "projects.notfound": "Ky projekt nuk është i disponueshëm.",
      "projects.back": "Të gjitha projektet",
      "projects.tech": "Teknologjitë",
      "projects.services": "Shërbimet e ofruara",
      "projects.about": "Rreth këtij projekti",
      "projects.category": "Kategoria",
      "projects.statusLabel": "Statusi",
      "projects.completed": "Përfunduar",
      "projects.status.completed": "I përfunduar",
      "projects.status.ongoing": "Në vazhdim",
      "projects.status.maintained": "Mirëmbahet nga ne",
      "projects.visit": "Vizito projektin",
      "projects.image": "Imazhi",
      "projects.related": "Projekte të lidhura",
      "projects.cta.title": "Ju duhet diçka e ngjashme?",
      "projects.cta.text": "Na tregoni për projektin tuaj dhe do t'ju kthejmë përgjigje me pyetje dhe një ofertë të qartë.",
      "projects.cta.btn": "Kërko ofertë",
      "services.pricelabel": "Çmimi"
    }
  };
  if (typeof translations === "undefined") return;
  ["en", "sq"].forEach((lang) => Object.assign(translations[lang], extra[lang]));
})();
