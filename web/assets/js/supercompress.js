/** SuperCompress-style interactions: nav, video, vision scroll, FAQ, scroll reveal */

(function () {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const trackGrowth = (eventName, detail = {}) => {
    if (typeof window.va === "function") window.va("event", { name: eventName, ...detail });
    window.dispatchEvent(new CustomEvent("supercompress:growth", { detail: { eventName, ...detail } }));
  };

  document.querySelectorAll("[data-growth-event]").forEach((element) => {
    element.addEventListener("click", () => trackGrowth(element.dataset.growthEvent, { href: element.href || "" }));
  });

  /* Mobile nav */
  const menuBtn = document.getElementById("df-menu-btn");
  const mobileNav = document.getElementById("df-mobile-nav");
  menuBtn?.addEventListener("click", () => {
    const hidden = mobileNav?.classList.toggle("hidden");
    menuBtn.setAttribute("aria-expanded", hidden ? "false" : "true");
  });
  mobileNav?.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => {
      mobileNav.classList.add("hidden");
      menuBtn?.setAttribute("aria-expanded", "false");
    });
  });

  /* Coding agent install command */
  document.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.getAttribute("data-copy");
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        button.textContent = "Copied";
        window.setTimeout(() => { button.textContent = "Copy"; }, 1600);
      } catch {
        button.textContent = "Select + copy";
        window.setTimeout(() => { button.textContent = "Copy"; }, 1600);
      }
    });
  });

  /* Launch video — muted autoplay local launch.mp4; Unmute toggles sound */
  function wireLaunchVideo(frameId) {
    const frame = document.getElementById(frameId);
    if (!frame) return;

    const live = frame.querySelector(".hero-frame-video--live");
    const soundBtn = frame.querySelector(".launch-video-sound");
    if (!live) return;

    live.muted = true;
    live.defaultMuted = true;
    live.loop = true;
    live.playsInline = true;

    const markPlaying = () => {
      live.classList.add("is-active");
      frame.classList.add("is-playing");
    };

    const tryPlay = () => {
      live.muted = true;
      return live.play().then(markPlaying).catch(() => {});
    };

    tryPlay();
    live.addEventListener("playing", markPlaying);
    live.addEventListener("canplay", () => {
      if (live.paused) tryPlay();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && live.paused) tryPlay();
    });

    const setMutedUi = (muted) => {
      live.muted = muted;
      if (!soundBtn) return;
      soundBtn.textContent = muted ? "Unmute" : "Mute";
      soundBtn.setAttribute("aria-label", muted ? "Unmute launch video" : "Mute launch video");
      frame.classList.toggle("is-live-sound", !muted);
    };

    soundBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (live.muted) {
        // Keep the same launch-post clip — just unmute from current position
        live.loop = false;
        setMutedUi(false);
        live.play().then(markPlaying).catch(() => setMutedUi(true));
      } else {
        live.loop = true;
        setMutedUi(true);
        if (live.paused) tryPlay();
      }
    });

    live.addEventListener("ended", () => {
      if (live.muted) return;
      live.loop = true;
      setMutedUi(true);
      tryPlay();
    });
  }

  wireLaunchVideo("launch-video-frame");
  wireLaunchVideo("launch-video-frame-mobile");

  /* Vision scroll word reveal */
  const runway = document.getElementById("vision-runway");
  const words = document.querySelectorAll(".vision-word");

  if (words.length && !reduced) {
    words.forEach((w) => {
      w.style.opacity = "0.12";
    });

    function updateVision() {
      if (!runway) return;
      const rect = runway.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = runway.offsetHeight - vh;
      const scrolled = Math.min(Math.max(-rect.top, 0), total);
      const progress = total > 0 ? scrolled / total : 1;

      words.forEach((w, i) => {
        const wordProgress = (progress * words.length - i) / 2;
        const opacity = Math.min(1, Math.max(0.12, wordProgress));
        w.style.opacity = String(opacity);
      });
    }

    window.addEventListener("scroll", updateVision, { passive: true });
    window.addEventListener("resize", updateVision, { passive: true });
    updateVision();
  } else {
    words.forEach((w) => {
      w.style.opacity = "1";
    });
  }

  /* FAQ accordion */
  document.querySelectorAll(".df-faq-item button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = btn.closest(".df-faq-item");
      const open = item?.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  /* Scroll reveal */
  function inViewport(el, margin = 80) {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight - margin && rect.bottom > margin;
  }

  function revealEl(el) {
    el.classList.add("is-visible");
  }

  function initScrollReveal() {
    const revealEls = document.querySelectorAll(".df-reveal, .df-reveal-stagger");
    if (!revealEls.length) return;

    if (reduced) {
      revealEls.forEach(revealEl);
      return;
    }

    document.querySelectorAll(".df-reveal-stagger").forEach((parent) => {
      [...parent.children].forEach((child, i) => child.style.setProperty("--stagger-i", String(i)));
    });

    const pending = new Set(revealEls);

    function flushVisible() {
      pending.forEach((el) => {
        if (inViewport(el, 40)) {
          revealEl(el);
          pending.delete(el);
          io?.unobserve(el);
        }
      });
    }

    let io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            revealEl(entry.target);
            pending.delete(entry.target);
            io.unobserve(entry.target);
          });
        },
        { threshold: 0.05, rootMargin: "0px 0px -40px 0px" }
      );
      revealEls.forEach((el) => io.observe(el));
    } else {
      revealEls.forEach(revealEl);
      return;
    }

    flushVisible();
    window.addEventListener("scroll", flushVisible, { passive: true });
    window.addEventListener("resize", flushVisible, { passive: true });
    requestAnimationFrame(flushVisible);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initScrollReveal);
  } else {
    initScrollReveal();
  }
})();
