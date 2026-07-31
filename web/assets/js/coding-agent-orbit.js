/** Scroll-driven coding-agent convergence scene. */
(function () {
  "use strict";

  const section = document.querySelector(".sc-agent-orbit");
  if (!section) return;

  const scene = section.querySelector(".sc-agent-orbit-scene");
  const nodes = [...section.querySelectorAll(".sc-agent-node")];
  const install = section.querySelector(".sc-agent-install");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let ticking = false;

  function update() {
    ticking = false;
    const rect = section.getBoundingClientRect();
    const travel = Math.max(1, section.offsetHeight - window.innerHeight);
    const progress = reduceMotion.matches ? 0.85 : Math.min(1, Math.max(0, -rect.top / travel));
    const width = window.innerWidth;
    const compact = width < 720;
    const positions = compact
      ? [[-120, -110], [-88, -40], [-120, 36], [-88, 108], [120, -110], [88, -40], [120, 36], [88, 108]]
      : [[-290, -145], [-230, -46], [-290, 52], [-230, 145], [290, -145], [230, -46], [290, 52], [230, 145]];

    scene.style.setProperty("--orbit-progress", progress.toFixed(3));
    nodes.forEach((node, index) => {
      const [x, y] = positions[index];
      const spin = index % 2 ? -14 : 14;
      const scale = 1 - progress * 0.22;
      const pull = 1 - progress;
      node.style.transform = `translate3d(calc(-50% + ${x * pull}px), calc(-50% + ${y * pull}px), 0) rotate(${spin * progress}deg) scale(${scale})`;
      node.style.opacity = String(Math.max(0.2, 1 - progress * 0.55));
    });
    if (install) {
      const show = Math.min(1, Math.max(0, (progress - 0.55) / 0.28));
      install.style.opacity = String(show);
      install.style.transform = `translateX(-50%) translateY(${(1 - show) * 28}px)`;
      install.style.pointerEvents = show > 0.7 ? "auto" : "none";
    }
  }

  function requestUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate, { passive: true });
  reduceMotion.addEventListener?.("change", requestUpdate);
  update();
})();
