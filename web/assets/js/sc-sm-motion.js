/**
 * SuperCompress SM-layout motion — hero stagger, catalog spine, copy toast.
 */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("gs-ready");

  function toast(msg) {
    var el = document.getElementById("sc-toast");
    if (!el) return;
    el.textContent = msg || "Copied";
    el.hidden = false;
    if (typeof gsap !== "undefined") {
      gsap.fromTo(el, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "power3.out" });
    }
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      if (typeof gsap !== "undefined") {
        gsap.to(el, {
          y: 8,
          opacity: 0,
          duration: 0.25,
          onComplete: function () {
            el.hidden = true;
          },
        });
      } else {
        el.hidden = true;
      }
    }, 1500);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject();
  }

  function heroIntro() {
    var nodes = document.querySelectorAll(".hero-in");
    if (!nodes.length) return;
    if (reduce || typeof gsap === "undefined") {
      nodes.forEach(function (n) {
        n.style.opacity = "1";
        n.style.transform = "none";
      });
      return;
    }
    gsap.set(nodes, { opacity: 0, y: 18 });
    gsap.to(nodes, {
      opacity: 1,
      y: 0,
      duration: 0.7,
      stagger: 0.08,
      ease: "power3.out",
      delay: 0.05,
    });
  }

  function catalogSpine() {
    var items = document.querySelectorAll("#spine li");
    var cards = document.querySelectorAll("[data-card]");
    if (!items.length || !cards.length) return;

    var idx = 0;
    var timer = null;
    var interval = 5000;

    function show(i) {
      idx = i;
      items.forEach(function (el, n) {
        el.setAttribute("aria-current", n === i ? "true" : "false");
      });
      cards.forEach(function (card) {
        var on = Number(card.getAttribute("data-card")) === i;
        card.hidden = !on;
      });
      var counter = document.querySelector(".sc-catalog .sc-section-bar span:last-child");
      if (counter) counter.textContent = "[" + (i + 1) + " / " + items.length + "]";
    }

    function next() {
      show((idx + 1) % items.length);
    }

    function start() {
      stop();
      if (reduce) return;
      timer = setInterval(next, interval);
    }
    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    items.forEach(function (el) {
      el.addEventListener("click", function () {
        show(Number(el.getAttribute("data-index")) || 0);
        start();
      });
    });

    show(0);
    start();
  }

  function copyHandlers() {
    document.querySelectorAll("[data-copy]").forEach(function (el) {
      el.addEventListener("click", function () {
        copyText(el.getAttribute("data-copy") || "").then(function () {
          toast("Copied");
          if (typeof gsap !== "undefined") {
            gsap.fromTo(el, { scale: 0.98 }, { scale: 1, duration: 0.3, ease: "back.out(2)" });
          }
        });
      });
    });
  }

  function buttonPress() {
    if (reduce || typeof gsap === "undefined") return;
    document.querySelectorAll(".btn-primary, .btn-secondary, .sc-compress").forEach(function (btn) {
      btn.addEventListener("pointerdown", function () {
        gsap.to(btn, { scale: 0.97, duration: 0.1, overwrite: "auto" });
      });
      btn.addEventListener("pointerup", function () {
        gsap.to(btn, { scale: 1, duration: 0.25, ease: "power3.out", overwrite: "auto" });
      });
      btn.addEventListener("pointerleave", function () {
        gsap.to(btn, { scale: 1, duration: 0.25, overwrite: "auto" });
      });
    });
  }

  function boot() {
    heroIntro();
    catalogSpine();
    copyHandlers();
    buttonPress();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
