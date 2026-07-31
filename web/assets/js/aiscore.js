(() => {
  const form = document.getElementById('score-form');
  const input = document.getElementById('site-url');
  const error = document.getElementById('form-error');
  const results = document.getElementById('results');
  const scoreDial = document.getElementById('score-dial');
  const authGate = document.getElementById('auth-gate');
  const googleAuth = document.getElementById('google-auth');
  const authError = document.getElementById('auth-error');
  const analysisStep = document.getElementById('analysis-step');
  const costForm = document.getElementById('cost-form');
  const costSubmit = document.getElementById('cost-submit');
  const costError = document.getElementById('cost-error');
  const costModal = document.getElementById('cost-modal');
  const lockedResults = document.getElementById('locked-results');
  const monthlyCost = document.getElementById('monthly-cost');
  const costValue = document.getElementById('cost-value');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pendingResult = null;
  let pendingSitePromise = null;
  let firebaseAuth = null;

  function selectedCost() { return Number(monthlyCost.value); }
  function formatMoney(value) { return `$${Math.round(value).toLocaleString('en-US')}`; }
  function maskedMoney(value) { return formatMoney(value).replace(/\d/g, 'X'); }
  monthlyCost.addEventListener('input', () => { costValue.textContent = `${formatMoney(selectedCost())} / month`; });

  function normalize(value) {
    let raw = value.trim();
    if (!raw) throw new Error('Enter a website to run your score.');
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const url = new URL(raw);
    if (!url.hostname.includes('.') || url.hostname.length < 4) throw new Error('Use a full domain, like yourcompany.com.');
    return url;
  }

  function modelScore(extracted) {
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const ai = clamp(Number(extracted?.ai_workflow_strength) || 5, 0, 10);
    const context = clamp(Number(extracted?.context_volume_signal) || 5, 0, 10);
    const opportunity = clamp(Number(extracted?.compression_opportunity) || 5, 0, 10);
    const rawText = [extracted?.company_summary, extracted?.ai_surface, extracted?.context_sources].filter(Boolean).join('|');
    const hash = [...rawText].reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 7);
    const variation = (hash % 7) - 3;
    const rubricScore = 58 + (ai * 1.5) + (context * 1.4) + (opportunity * 1.3);
    const modelScore = Number(extracted?.fit_score) || 76;
    const score = clamp(Math.round((modelScore * 0.35) + (rubricScore * 0.65) + variation), 68, 96);
    return { score, savings: 0, plan: extracted?.implementation_plan || 'Start with the longest recurring context path, place SuperCompress directly before the model call, and compare input tokens and answer quality for a small pilot.', hits: [extracted?.company_summary || 'Context.dev identified a product surface to assess.', extracted?.ai_surface || 'Context.dev found an AI or automation opportunity worth validating.', extracted?.context_sources || 'The first pilot should measure chat history, retrieval, memory, or tool-output growth.', extracted?.fit_rationale || 'A small production pilot can validate the opportunity without changing your model provider.'] };
  }

  async function fetchSiteText(url) {
    const response = await fetch('/api/aiscore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.toString() }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'The site could not be read.');
    return response.json();
  }

  async function getFirebaseAuth() {
    if (firebaseAuth) return firebaseAuth;
    const [{ initializeApp }, { getAuth, GoogleAuthProvider, signInWithPopup }] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js')
    ]);
    const response = await fetch('/api/firebase-config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Sign-in is temporarily unavailable. Please try again.');
    const config = await response.json();
    if (!config.apiKey || !config.authDomain || !config.projectId) throw new Error('Sign-in is not configured yet.');
    const app = initializeApp(config, 'aiscore');
    const auth = getAuth(app);
    firebaseAuth = { auth, GoogleAuthProvider, signInWithPopup };
    return firebaseAuth;
  }

  function animateNumber(node, target, prefix = '') {
    if (reduced) { node.textContent = `${prefix}${target}`; return; }
    const started = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - started) / 900);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = `${prefix}${Math.round(target * eased)}`;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function revealResults(result) {
    document.getElementById('results-title').textContent = result.score >= 75 ? 'A strong candidate for compression.' : result.score >= 55 ? 'There is a clear compression opportunity.' : 'Some compression potential is already visible.';
    document.getElementById('fit-status').textContent = result.score >= 75 ? 'High fit' : result.score >= 55 ? 'Good fit' : 'Early fit';
    document.getElementById('fit-caption').textContent = result.score >= 75 ? 'Your product shows the patterns where context compression tends to pay back fastest.' : 'Your URL shows some signals, but a traffic sample would make the estimate more precise.';
    document.getElementById('why-score').textContent = result.score >= 75 ? 'Your product likely creates repeated, oversized context across user requests.' : 'Your current public signals suggest a focused pilot is the best next step.';
    const signalList = document.getElementById('signal-list');
    signalList.replaceChildren(...(result.hits.length ? result.hits : ['The assessment starts from a conservative baseline until we see real request volume.', 'Compression is most valuable when prompts grow through memory, retrieval, or tool output.']).map(hit => {
      const item = document.createElement('li');
      item.textContent = hit;
      return item;
    }));
    document.getElementById('implementation-plan').textContent = result.plan;
    animateNumber(document.getElementById('fit-score'), result.score);
    const savingsRate = Math.min(0.60, Math.max(0.35, 0.35 + ((result.score - 64) / 32) * 0.25));
    result.savings = Math.round(selectedCost() * savingsRate);
    result.savingsRate = savingsRate;
    document.getElementById('savings-value').textContent = maskedMoney(result.savings);
    document.getElementById('savings-range').textContent = 'sign in to reveal';
    document.getElementById('savings-caption').textContent = 'Your estimate is ready. Sign in to reveal the figure based on your monthly spend.';
    scoreDial.style.background = `conic-gradient(var(--blue) ${result.score * 3.6}deg, #83aaff ${result.score * 3.6}deg, #c6d7fa ${result.score * 3.6}deg 360deg)`;
    results.hidden = false;
  }

  function revealSavings(result) {
    animateNumber(document.getElementById('savings-value'), result.savings, '$');
    document.getElementById('savings-range').textContent = 'at your spend';
    document.getElementById('savings-caption').textContent = `At ${formatMoney(selectedCost())} in monthly input spend, this assessment models roughly ${Math.round(result.savingsRate * 100)}% of that spend as addressable by compression.`;
  }

  async function unlockResults() {
    if (!pendingResult) return;
    authError.textContent = '';
    googleAuth.disabled = true;
    googleAuth.querySelector('span:nth-child(2)').textContent = 'Opening sign-in…';
    try {
      const { auth, GoogleAuthProvider, signInWithPopup } = await getFirebaseAuth();
      if (!auth.currentUser) await signInWithPopup(auth, new GoogleAuthProvider());
      revealSavings(pendingResult);
      lockedResults.hidden = false;
      authGate.hidden = true;
      lockedResults.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    } catch (authFailure) {
      authError.textContent = authFailure.code === 'auth/popup-closed-by-user' ? 'Sign-in was closed. Your assessment is still here.' : (authFailure.message || 'Could not complete sign-in.');
    } finally {
      googleAuth.disabled = false;
      googleAuth.querySelector('span:nth-child(2)').textContent = 'Continue with Google';
    }
  }

  googleAuth.addEventListener('click', unlockResults);

  form.addEventListener('submit', event => {
    event.preventDefault();
    error.textContent = '';
    let url;
    try { url = normalize(input.value); } catch (err) { error.textContent = err.message; input.focus(); return; }
    const submit = document.getElementById('score-submit');
    const status = document.getElementById('model-status');
    submit.disabled = true;
    input.disabled = true;
    submit.querySelector('span:first-child').textContent = 'Analyzing…';
    analysisStep.hidden = false;
    costModal.hidden = false;
    status.textContent = 'Context.dev is reading the pages that matter.';
    costError.textContent = '';
    results.hidden = true;
    authGate.hidden = true;
    lockedResults.hidden = true;
    pendingSitePromise = fetchSiteText(url);
    pendingSitePromise.catch(() => {});
    analysisStep.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  });

  costForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!pendingSitePromise) return;
    costSubmit.disabled = true;
    costSubmit.querySelector('span:first-child').textContent = 'Finishing…';
    document.getElementById('model-status').textContent = 'Finishing your AI fit assessment…';
    try {
      const site = await pendingSitePromise;
      pendingResult = modelScore(site.extracted);
      revealResults(pendingResult);
      costModal.hidden = true;
      analysisStep.hidden = true;
      authGate.hidden = false;
      lockedResults.hidden = true;
      document.getElementById('model-status').textContent = 'Ready. Your public savings preview is below.';
      results.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    } catch (assessmentError) {
      costError.textContent = assessmentError.message || 'The site could not be analyzed.';
      document.getElementById('model-status').textContent = 'We could not finish the assessment.';
    } finally {
      costSubmit.disabled = false;
      costSubmit.querySelector('span:first-child').textContent = 'Show my savings';
    }
  });

  document.getElementById('rerun').addEventListener('click', () => { results.hidden = true; authGate.hidden = true; lockedResults.hidden = true; analysisStep.hidden = true; costModal.hidden = true; pendingResult = null; pendingSitePromise = null; input.disabled = false; document.getElementById('score-submit').disabled = false; input.value = ''; document.getElementById('assessment').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); input.focus(); });
})();
