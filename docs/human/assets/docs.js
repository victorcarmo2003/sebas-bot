(function () {
  var LANG_KEY = "sebas-docs-lang";
  var root = document.documentElement;

  function applyLang(lang) {
    root.setAttribute("data-lang", lang);
    var toggle = document.getElementById("lang-toggle");
    if (toggle) toggle.textContent = lang === "pt" ? "EN" : "PT";
    document.querySelectorAll("[data-lang-label]").forEach(function (el) {
      el.textContent = lang.toUpperCase();
    });
  }

  function currentLang() {
    return localStorage.getItem(LANG_KEY) || (navigator.language || "").toLowerCase().indexOf("pt") === 0 ? "pt" : "en";
  }

  var initial = localStorage.getItem(LANG_KEY) || ((navigator.language || "").toLowerCase().indexOf("pt") === 0 ? "pt" : "en");
  applyLang(initial);

  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.getElementById("lang-toggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var next = root.getAttribute("data-lang") === "pt" ? "en" : "pt";
        localStorage.setItem(LANG_KEY, next);
        applyLang(next);
      });
    }

    var here = location.pathname.replace(/\/index\.html$/, "/");
    document.querySelectorAll(".sidebar a.navlink").forEach(function (a) {
      var href = a.getAttribute("href");
      if (!href) return;
      var resolved = new URL(href, location.href).pathname.replace(/\/index\.html$/, "/");
      if (resolved === here) a.classList.add("active");
    });
  });
})();
