/**
 * Signup onboarding + power-user celebrate overlays.
 * Skippable; dither header; 10,000 free tokens per quest.
 */

const HEARD = [
  { id: "x", label: "X" },
  { id: "reddit", label: "Reddit" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "instagram", label: "Instagram" },
  { id: "word_of_mouth", label: "Word of mouth" },
];

const QUEST_COPY = {
  star: {
    title: "Star the repo",
    meta: "GitHub · Supercompress/Supercompress",
  },
  x_follow: {
    title: "Follow us on X",
    meta: "@arjunkshah21",
  },
  plugin: {
    title: "Install the coding agent plugin",
    meta: "One setup command for Cursor, Claude Code, Codex…",
  },
};

function fmtBonus(n) {
  return Number(n || 0).toLocaleString("en-US");
}

export function createOnboardingController({ apiFetch, onBonusChange } = {}) {
  let root = null;
  let state = null;
  let step = 1; // 1 = heard, 2 = quests, 3 = plugin cmds, celebrate = power
  let selectedHeard = null;
  let mode = "onboard"; // onboard | celebrate | plugin

  function ensureRoot() {
    if (root) return root;
    root = document.createElement("div");
    root.className = "sc-onboard";
    root.id = "sc-onboard";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.innerHTML = `
      <div class="sc-onboard-card">
        <div class="sc-onboard-dither" aria-hidden="true"></div>
        <div class="sc-onboard-inner" id="sc-onboard-inner"></div>
      </div>
    `;
    document.body.appendChild(root);
    root.addEventListener("click", (e) => {
      if (e.target === root) skip();
    });
    paintDither();
    return root;
  }

  function paintDither() {
    try {
      const wash = root?.querySelector(".sc-onboard-dither");
      if (!wash || !window.DitherKitLite) return;
      const opts = { color: "brand", intensity: 0.55 };
      if (typeof window.DitherKitLite.startDitherWashLoop === "function") {
        window.DitherKitLite.startDitherWashLoop(wash, opts);
      } else if (typeof window.DitherKitLite.renderDitherWash === "function") {
        window.DitherKitLite.renderDitherWash(wash, opts);
      }
    } catch (_) {
      /* optional visual */
    }
  }

  function stopDither() {
    try {
      const wash = root?.querySelector(".sc-onboard-dither");
      if (wash && typeof window.DitherKitLite?.stopDitherWashLoop === "function") {
        window.DitherKitLite.stopDitherWashLoop(wash);
      }
    } catch (_) {
      /* ignore */
    }
  }

  function open() {
    ensureRoot();
    root.classList.add("is-open");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(paintDither);
  }

  function close() {
    if (!root) return;
    stopDither();
    root.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  async function skip() {
    try {
      if (mode === "celebrate") {
        await apiFetch("/api/account?op=power-celebrate-seen", { method: "POST", body: "{}" });
      } else if (mode === "plugin") {
        mode = "onboard";
        step = 2;
        render();
        return;
      } else {
        await apiFetch("/api/account?op=onboarding-skip", { method: "POST", body: "{}" });
      }
    } catch (err) {
      console.warn("onboarding skip failed", err);
    }
    close();
  }

  function renderHeard() {
    const choices = HEARD.map(
      (h) => `
      <button type="button" class="sc-onboard-choice${selectedHeard === h.id ? " is-selected" : ""}" data-heard="${h.id}">
        ${h.label}
      </button>`
    ).join("");
    return `
      <div class="sc-onboard-steps" aria-hidden="true">
        <span class="sc-onboard-step-dot is-on"></span>
        <span class="sc-onboard-step-dot"></span>
      </div>
      <p class="sc-onboard-kicker">Quick start</p>
      <h2 class="sc-onboard-title" id="sc-onboard-title">Where did you hear about us?</h2>
      <p class="sc-onboard-lead">Helps us focus on the channels that actually work. Takes two seconds.</p>
      <div class="sc-onboard-grid">${choices}</div>
      <div class="sc-onboard-actions">
        <button type="button" class="sc-onboard-skip" data-act="skip">Skip for now</button>
        <button type="button" class="sc-onboard-btn" data-act="next-heard" ${selectedHeard ? "" : "disabled"}>Continue →</button>
      </div>
    `;
  }

  function renderQuests() {
    const actions = state?.actions || {};
    const bonus = state?.bonus_tokens || 0;
    const rows = ["star", "x_follow", "plugin"]
      .map((id) => {
        const done = !!actions[id];
        const copy = QUEST_COPY[id];
        return `
        <button type="button" class="sc-onboard-quest${done ? " is-done" : ""}" data-quest="${id}">
          <span class="sc-onboard-quest-copy">
            <p class="sc-onboard-quest-title">${copy.title}</p>
            <p class="sc-onboard-quest-meta">${copy.meta}</p>
          </span>
          <span class="sc-onboard-quest-badge">${done ? "Done" : "+10,000"}</span>
        </button>`;
      })
      .join("");
    return `
      <div class="sc-onboard-steps" aria-hidden="true">
        <span class="sc-onboard-step-dot is-on"></span>
        <span class="sc-onboard-step-dot is-on"></span>
      </div>
      <p class="sc-onboard-kicker">Get free credits</p>
      <h2 class="sc-onboard-title" id="sc-onboard-title">Earn 10,000 free tokens each</h2>
      <p class="sc-onboard-lead">Stack up to <strong>30,000</strong> extra free tokens on top of your monthly 1M. Skip anytime.</p>
      <p class="sc-onboard-bonus">Bonus so far: <strong>${fmtBonus(bonus)}</strong> free tokens</p>
      <div class="sc-onboard-grid">${rows}</div>
      <div class="sc-onboard-actions">
        <button type="button" class="sc-onboard-skip" data-act="skip">Skip for now</button>
        <button type="button" class="sc-onboard-btn" data-act="finish">Done →</button>
      </div>
    `;
  }

  function renderPlugin() {
    const cmds = state?.plugin_commands || [
      "npx supercompress-proxy setup",
      "npm i -g supercompress-proxy && supercompress setup",
    ];
    const blocks = cmds
      .map(
        (c, i) => `
      <div class="sc-onboard-cmd">
        <code id="sc-cmd-${i}">${c}</code>
        <button type="button" data-copy="${i}">Copy</button>
      </div>`
      )
      .join("");
    return `
      <p class="sc-onboard-kicker">Coding agent plugin</p>
      <h2 class="sc-onboard-title" id="sc-onboard-title">Install in one command</h2>
      <p class="sc-onboard-lead">Run this in your terminal, then come back and claim <strong>10,000</strong> free tokens.</p>
      <div class="sc-onboard-cmds">${blocks}</div>
      <div class="sc-onboard-actions">
        <button type="button" class="sc-onboard-btn sc-onboard-btn--ghost" data-act="back-quests">Back</button>
        <button type="button" class="sc-onboard-btn" data-act="claim-plugin">I installed it — claim 10,000 →</button>
      </div>
    `;
  }

  function renderCelebrate() {
    const share = String(state?.power_share_url || "https://twitter.com/intent/tweet?text=SuperCompress").replace(
      /"/g,
      "%22"
    );
    return `
      <p class="sc-onboard-kicker">Power user</p>
      <h2 class="sc-onboard-title" id="sc-onboard-title">You crossed 1M tokens</h2>
      <p class="sc-onboard-lead">Congrats — you're officially a SuperCompress power user. Tell the timeline.</p>
      <div class="sc-onboard-actions">
        <button type="button" class="sc-onboard-skip" data-act="skip">Not now</button>
        <a class="sc-onboard-btn" href="${share}" target="_blank" rel="noopener" data-act="share-x">Post on X →</a>
      </div>
    `;
  }

  function render() {
    ensureRoot();
    const inner = root.querySelector("#sc-onboard-inner");
    if (!inner) return;
    root.setAttribute("aria-labelledby", "sc-onboard-title");
    if (mode === "celebrate") inner.innerHTML = renderCelebrate();
    else if (mode === "plugin") inner.innerHTML = renderPlugin();
    else if (step === 2) inner.innerHTML = renderQuests();
    else inner.innerHTML = renderHeard();
    bind();
    paintDither();
  }

  function bind() {
    root.querySelectorAll("[data-heard]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedHeard = btn.getAttribute("data-heard");
        render();
      });
    });
    root.querySelectorAll("[data-quest]").forEach((btn) => {
      btn.addEventListener("click", () => onQuest(btn.getAttribute("data-quest")));
    });
    root.querySelectorAll("[data-act]").forEach((el) => {
      el.addEventListener("click", (e) => {
        const act = el.getAttribute("data-act");
        if (act === "skip") {
          e.preventDefault();
          skip();
        } else if (act === "next-heard") onHeardNext();
        else if (act === "finish") finishOnboarding();
        else if (act === "back-quests") {
          mode = "onboard";
          step = 2;
          render();
        } else if (act === "claim-plugin") claimQuest("plugin");
        else if (act === "share-x") {
          // let the link open; mark celebrate shown shortly after
          setTimeout(() => skip(), 400);
        }
      });
    });
    root.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const i = btn.getAttribute("data-copy");
        const code = root.querySelector(`#sc-cmd-${i}`)?.textContent || "";
        try {
          await navigator.clipboard.writeText(code);
          btn.textContent = "Copied";
          setTimeout(() => {
            btn.textContent = "Copy";
          }, 1200);
        } catch (_) {
          btn.textContent = "Select & copy";
        }
      });
    });
  }

  async function onHeardNext() {
    if (!selectedHeard) return;
    try {
      state = await apiFetch("/api/account?op=onboarding-heard", {
        method: "POST",
        body: JSON.stringify({ source: selectedHeard }),
      });
    } catch (err) {
      console.warn(err);
    }
    step = 2;
    render();
  }

  async function onQuest(id) {
    if (state?.actions?.[id]) return;
    if (id === "plugin") {
      mode = "plugin";
      render();
      return;
    }
    const url = id === "star" ? state?.links?.star : state?.links?.x_follow;
    if (url) window.open(url, "_blank", "noopener");
    await claimQuest(id);
  }

  async function claimQuest(id) {
    try {
      state = await apiFetch("/api/account?op=onboarding-claim", {
        method: "POST",
        body: JSON.stringify({ action: id }),
      });
      if (typeof onBonusChange === "function") onBonusChange(state);
      if (mode === "plugin") {
        mode = "onboard";
        step = 2;
      }
      render();
    } catch (err) {
      console.warn("claim failed", err);
    }
  }

  async function finishOnboarding() {
    try {
      await apiFetch("/api/account?op=onboarding-done", { method: "POST", body: "{}" });
    } catch (_) {}
    close();
  }

  async function maybeShow() {
    if (!apiFetch) return;
    try {
      state = await apiFetch("/api/account?op=onboarding");
    } catch (err) {
      console.warn("onboarding status failed", err);
      return;
    }
    let forcePower = false;
    try {
      const params = new URLSearchParams(window.location.search);
      forcePower = params.get("power") === "1";
      if (forcePower && window.history?.replaceState) {
        params.delete("power");
        const url = new URL(window.location.href);
        url.search = params.toString();
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}` || "/dashboard");
      }
    } catch (_) {
      /* ignore */
    }
    if (state?.needs_power_celebrate || forcePower) {
      mode = "celebrate";
      open();
      render();
      return;
    }
    if (state?.needs_onboarding) {
      mode = "onboard";
      step = state.heard ? 2 : 1;
      selectedHeard = state.heard || null;
      open();
      render();
    }
  }

  return { maybeShow, close, skip };
}
