/**
 * SuperCompress landing motion — GSAP microcomponents
 * Waits for fonts, word-staggers hero, floats via wrappers, scroll reveals.
 */
(function () {
  "use strict";

  if (typeof gsap === "undefined") return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof ScrollTrigger !== "undefined") gsap.registerPlugin(ScrollTrigger);

  // Match supermemory ease-out-strong
  var EASE = "expo.out";
  var EASE_SOFT = "power3.out";

  var root = document.documentElement;
  root.classList.add("gs-ready");
  if (reduce) root.classList.add("gs-reduce");

  function toast(msg) {
    var el = document.getElementById("sm-toast");
    if (!el) return;
    el.textContent = msg || "Copied";
    el.hidden = false;
    gsap.fromTo(
      el,
      { autoAlpha: 0, y: 14, scale: 0.96 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.38, ease: EASE }
    );
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      gsap.to(el, {
        autoAlpha: 0,
        y: 10,
        duration: 0.28,
        ease: "power2.in",
        onComplete: function () {
          el.hidden = true;
        },
      });
    }, 1600);
  }

  function copyText(text) {
    if (!text) return Promise.reject();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        document.body.removeChild(ta);
      }
    });
  }

  function splitWords(el) {
    if (!el || el.dataset.split === "1") return el.querySelectorAll(".sm-word");
    var html = "";
    el.childNodes.forEach(function (node) {
      if (node.nodeType === 3) {
        var parts = node.textContent.split(/(\s+)/);
        parts.forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) {
            html += part;
          } else {
            html += '<span class="sm-word">' + part + "</span>";
          }
        });
      } else if (node.nodeType === 1) {
        if (node.classList && node.classList.contains("sm-line")) {
          var inner = "";
          node.childNodes.forEach(function (c) {
            if (c.nodeType === 3) {
              c.textContent.split(/(\s+)/).forEach(function (part) {
                if (!part) return;
                if (/^\s+$/.test(part)) inner += part;
                else inner += '<span class="sm-word">' + part + "</span>";
              });
            } else if (c.nodeType === 1) {
              inner += c.outerHTML;
            }
          });
          html += '<span class="sm-line">' + inner + "</span>";
        } else {
          html += node.outerHTML;
        }
      }
    });
    el.innerHTML = html;
    el.dataset.split = "1";
    return el.querySelectorAll(".sm-word");
  }

  function heroIntro() {
    var center = document.querySelector(".sm-hero-center");
    if (!center) return;

    var chip = center.querySelector(".sm-chip");
    var headline = center.querySelector(".sm-headline");
    var words = splitWords(headline);
    var sub = center.querySelector(".sm-subhead");
    var ctas = center.querySelectorAll(".sm-cta-row > *");
    var npx = center.querySelector(".sm-npx");
    var hands = document.querySelector(".sm-hands-frame");
    var floats = document.querySelectorAll(".sm-token-float");

    if (reduce) {
      gsap.set([chip, words, sub, ctas, npx, hands, floats], { clearProps: "all" });
      return;
    }

    gsap.set([chip, sub, ctas, npx], { autoAlpha: 0, y: 22 });
    gsap.set(words, { autoAlpha: 0, y: 36, rotateX: 18, transformOrigin: "50% 100%" });
    if (hands) {
      gsap.set(hands, { autoAlpha: 0, y: 48, scale: 0.975, clipPath: "inset(8% 6% 8% 6% round 22px)" });
    }
    if (floats.length) gsap.set(floats, { autoAlpha: 0, y: 28, scale: 0.9 });

    var tl = gsap.timeline({ defaults: { ease: EASE } });
    tl.to(chip, { autoAlpha: 1, y: 0, duration: 0.6 }, 0.05)
      .to(
        words,
        { autoAlpha: 1, y: 0, rotateX: 0, duration: 0.75, stagger: 0.045 },
        0.12
      )
      .to(sub, { autoAlpha: 1, y: 0, duration: 0.6 }, 0.42)
      .to(ctas, { autoAlpha: 1, y: 0, duration: 0.55, stagger: 0.08 }, 0.55)
      .to(npx, { autoAlpha: 1, y: 0, duration: 0.55 }, 0.68);

    if (hands) {
      tl.to(
        hands,
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          clipPath: "inset(0% 0% 0% 0% round 22px)",
          duration: 1.05,
          ease: EASE_SOFT,
        },
        0.5
      );
    }
    if (floats.length) {
      tl.to(
        floats,
        { autoAlpha: 1, y: 0, scale: 1, duration: 0.7, stagger: 0.14, ease: "back.out(1.5)" },
        0.9
      );
    }
  }

  function floats() {
    if (reduce) return;
    document.querySelectorAll(".sm-token-float").forEach(function (wrap, i) {
      gsap.to(wrap, {
        y: i % 2 === 0 ? -12 : 10,
        duration: 3 + i * 0.4,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        delay: 1.4 + i * 0.25,
      });
    });

    var arrow = document.querySelector(".sm-chip-arrow");
    if (arrow) {
      gsap.to(arrow, {
        x: 4,
        duration: 1,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
        delay: 1,
      });
    }
  }

  function handsParallax() {
    if (reduce || typeof ScrollTrigger === "undefined") return;
    var art = document.querySelector(".sm-hands-art");
    var frame = document.querySelector(".sm-hands-frame");
    if (!art || !frame) return;
    gsap.fromTo(
      art,
      { yPercent: -4 },
      {
        yPercent: 10,
        ease: "none",
        scrollTrigger: {
          trigger: frame,
          start: "top bottom",
          end: "bottom top",
          scrub: 0.6,
        },
      }
    );
  }

  function scrollReveals() {
    var nodes = gsap.utils.toArray(".reveal");
    if (!nodes.length) return;

    if (reduce || typeof ScrollTrigger === "undefined") {
      nodes.forEach(function (n) {
        n.classList.add("visible");
      });
      return;
    }

    nodes.forEach(function (n) {
      n.classList.add("js-ready", "gs-reveal");
      gsap.fromTo(
        n,
        { autoAlpha: 0, y: 40 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.9,
          ease: EASE,
          scrollTrigger: {
            trigger: n,
            start: "top 86%",
            toggleActions: "play none none none",
          },
          onComplete: function () {
            n.classList.add("visible");
          },
        }
      );
    });

    var cards = gsap.utils.toArray(".feature-card, .ht-step");
    if (cards.length) {
      gsap.from(cards, {
        autoAlpha: 0,
        y: 32,
        duration: 0.75,
        stagger: 0.14,
        ease: EASE,
        scrollTrigger: {
          trigger: cards[0].closest(".ht-step-list, .feature-grid") || cards[0],
          start: "top 80%",
        },
      });
    }
  }

  function chartBars() {
    if (reduce || typeof ScrollTrigger === "undefined") return;
    gsap.utils.toArray(".bar-track i, .ht-bar-track i").forEach(function (bar) {
      var w = bar.style.width;
      if (!w) return;
      gsap.fromTo(
        bar,
        { width: "0%", autoAlpha: 0.4 },
        {
          width: w,
          autoAlpha: 1,
          duration: 1.2,
          ease: EASE,
          scrollTrigger: {
            trigger: bar.closest(".chart") || bar,
            start: "top 78%",
          },
        }
      );
    });
  }

  function tokenCounters() {
    if (reduce) return;
    document.querySelectorAll("[data-count-to]").forEach(function (el) {
      var target = parseInt(el.getAttribute("data-count-to"), 10) || 0;
      var obj = { v: 0 };
      gsap.to(obj, {
        v: target,
        duration: 1.55,
        delay: 1.15,
        ease: "power2.out",
        onUpdate: function () {
          el.textContent = Math.round(obj.v).toLocaleString("en-US");
        },
      });
    });
  }

  function navScroll() {
    var nav = document.querySelector(".sm-nav");
    if (!nav || typeof ScrollTrigger === "undefined") return;
    ScrollTrigger.create({
      start: 8,
      onUpdate: function (self) {
        nav.classList.toggle("is-scrolled", self.scroll() > 8);
      },
    });
  }

  function buttonMicro() {
    if (reduce) return;
    var sel =
      ".sm-btn-primary, .sm-btn-secondary, .compress-button, .ht-compress, .button.primary, .button.secondary";
    document.querySelectorAll(sel).forEach(function (btn) {
      btn.addEventListener("pointerenter", function () {
        gsap.to(btn, { scale: 1.03, duration: 0.28, ease: EASE_SOFT, overwrite: "auto" });
      });
      btn.addEventListener("pointerleave", function () {
        gsap.to(btn, { scale: 1, duration: 0.4, ease: EASE, overwrite: "auto" });
      });
      btn.addEventListener("pointerdown", function () {
        gsap.to(btn, { scale: 0.965, duration: 0.1, ease: "power2.in", overwrite: "auto" });
      });
      btn.addEventListener("pointerup", function () {
        gsap.to(btn, { scale: 1.02, duration: 0.22, ease: EASE_SOFT, overwrite: "auto" });
      });
    });

    var chip = document.querySelector(".sm-chip");
    if (chip) {
      chip.addEventListener("pointerenter", function () {
        gsap.to(chip, { y: -2, duration: 0.25, ease: EASE_SOFT, overwrite: "auto" });
      });
      chip.addEventListener("pointerleave", function () {
        gsap.to(chip, { y: 0, duration: 0.35, ease: EASE, overwrite: "auto" });
      });
    }
  }

  function featureTilt() {
    if (reduce) return;
    document.querySelectorAll(".feature-card").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var r = card.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5;
        var y = (e.clientY - r.top) / r.height - 0.5;
        gsap.to(card, {
          rotateY: x * 4,
          rotateX: -y * 4,
          transformPerspective: 900,
          duration: 0.4,
          ease: EASE_SOFT,
          overwrite: "auto",
        });
      });
      card.addEventListener("pointerleave", function () {
        gsap.to(card, {
          rotateY: 0,
          rotateX: 0,
          duration: 0.6,
          ease: EASE,
          overwrite: "auto",
        });
      });
    });
  }

  function copyHandlers() {
    var pip = document.getElementById("copy-pip");
    if (pip) {
      pip.addEventListener("click", function () {
        copyText(pip.getAttribute("data-copy") || "").then(function () {
          var label = pip.querySelector(".sm-npx-copy");
          if (label) {
            var prev = label.textContent;
            label.textContent = "COPIED";
            gsap.fromTo(
              pip,
              { borderColor: "rgba(37,99,235,0.55)", y: 0 },
              { borderColor: "rgba(37,99,235,0.2)", y: -1, duration: 0.35, yoyo: true, repeat: 1 }
            );
            setTimeout(function () {
              label.textContent = prev;
            }, 1400);
          }
          toast("Copied to clipboard");
        });
      });
    }
    document.querySelectorAll("[data-copy]").forEach(function (el) {
      if (el.id === "copy-pip") return;
      el.addEventListener("click", function () {
        copyText(el.getAttribute("data-copy") || "").then(function () {
          toast("Copied");
          gsap.fromTo(el, { scale: 0.94 }, { scale: 1, duration: 0.4, ease: "back.out(2)" });
        });
      });
    });
  }

  function compressDelight() {
    var btn = document.getElementById("impact-send");
    var out = document.querySelector(".result-panel, .ht-panel--dark");
    if (!btn || reduce) return;
    btn.addEventListener("click", function () {
      gsap
        .timeline()
        .to(btn, { rotate: 16, scale: 0.94, duration: 0.18, ease: "power2.inOut" })
        .to(btn, { rotate: 0, scale: 1, duration: 0.45, ease: "back.out(1.8)" });
      if (!out) return;
      out.classList.remove("is-fresh");
      gsap.delayedCall(0.4, function () {
        out.classList.add("is-fresh");
        gsap.fromTo(
          out,
          { autoAlpha: 0.85, y: 8 },
          { autoAlpha: 1, y: 0, duration: 0.5, ease: EASE }
        );
      });
    });
  }

  function glowDrift() {
    if (reduce) return;
    var glow = document.querySelector(".sm-hero-glow");
    if (!glow) return;
    gsap.to(glow, {
      xPercent: 10,
      yPercent: -8,
      duration: 9,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });
  }

  function marqueeBoost() {
    // CSS already drives .marquee-track — don't double-animate
  }

  function boot() {
    heroIntro();
    floats();
    handsParallax();
    scrollReveals();
    chartBars();
    tokenCounters();
    navScroll();
    buttonMicro();
    featureTilt();
    copyHandlers();
    compressDelight();
    glowDrift();
    marqueeBoost();
    if (typeof ScrollTrigger !== "undefined") {
      requestAnimationFrame(function () {
        ScrollTrigger.refresh();
      });
    }
  }

  function start() {
    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(function () {
      // one frame so layout settles with correct metrics
      requestAnimationFrame(boot);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
