(() => {
  const header = document.querySelector(".df-header");
  if (header) {
    const sync = () => header.classList.toggle("is-scrolled", window.scrollY > 12);
    window.addEventListener("scroll", sync, { passive: true });
    sync();
  }

  const btn = document.querySelector(".df-menu-btn");
  const nav = document.getElementById("df-mobile-nav");
  if (btn && nav) {
    const close = () => {
      nav.classList.remove("is-open");
      nav.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      nav.classList.add("is-open");
      nav.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
    };

    btn.addEventListener("click", () => {
      if (nav.classList.contains("is-open")) close();
      else open();
    });
    nav.querySelectorAll("a").forEach((a) => a.addEventListener("click", close));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  // Sticky signup CTA — skip auth/dashboard shells & dismissed sessions
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  const skipSticky =
    path === "/dashboard" ||
    path.startsWith("/dashboard/") ||
    path === "/unsubscribe" ||
    document.body.classList.contains("dash-page") ||
    document.querySelector(".docs-layout");

  const dismissedKey = "sc_sticky_cta_dismissed";
  const dismissed = (() => {
    try { return sessionStorage.getItem(dismissedKey) === "1"; } catch { return false; }
  })();

  if (!skipSticky && !dismissed) {
    const bar = document.createElement("div");
    bar.className = "sc-sticky-cta";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Get free API key");
    bar.innerHTML = `
      <div class="sc-sticky-cta-copy">
        <strong>5M free tokens/mo</strong>
        <span>No credit card · ~65% lower LLM input cost</span>
      </div>
      <a class="sc-sticky-cta-btn" href="/dashboard?signup=1&utm_source=site&utm_medium=sticky_cta&utm_campaign=activation">Get free key</a>
      <button type="button" class="sc-sticky-cta-close" aria-label="Dismiss">×</button>
    `;
    document.body.appendChild(bar);
    document.body.classList.add("sc-sticky-pad");

    const showAfter = 480;
    const onScroll = () => {
      if (window.scrollY > showAfter) bar.classList.add("is-visible");
      else bar.classList.remove("is-visible");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    bar.querySelector(".sc-sticky-cta-close")?.addEventListener("click", () => {
      bar.remove();
      document.body.classList.remove("sc-sticky-pad");
      try { sessionStorage.setItem(dismissedKey, "1"); } catch {}
    });
  }
})();
