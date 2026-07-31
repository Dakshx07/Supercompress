/**
 * Lightweight transactional mail helpers.
 * Primary: Resend HTTP API (RESEND_API_KEY).
 * Fallback: queue only — drained by scripts/drain_welcome_emails.py via gog.
 */

const DEFAULT_FROM = process.env.WELCOME_FROM_EMAIL || "Arjun at SuperCompress <arjunkshah21@gmail.com>";

function welcomeCopy({ firstName, email }) {
  const hi = firstName ? `Hi ${firstName}` : "Hi";
  const subject = "Quick note from Arjun @ SuperCompress";
  const text = `${hi},

I'm Arjun, founder of SuperCompress. Noticed you signed up and wanted to say thanks — means a lot.

How are you liking the product so far? Anything confusing, missing, or that you'd want to see next? Even a one-liner reply helps a ton.

If you're stuck on setup, just reply to this email and I'll help personally.

Dashboard: https://supercompress.dev/dashboard
Coding agent proxy: https://supercompress.dev/coding-agent-proxy
Playground: https://supercompress.dev/playground

Thanks again,
Arjun
Founder, SuperCompress
arjunkshah21@gmail.com`;

  const html = `<p>${hi},</p>
<p>I'm Arjun, founder of SuperCompress. Noticed you signed up and wanted to say thanks — means a lot.</p>
<p>How are you liking the product so far? Anything confusing, missing, or that you'd want to see next? Even a one-liner reply helps a ton.</p>
<p>If you're stuck on setup, just reply to this email and I'll help personally.</p>
<p>
  <a href="https://supercompress.dev/dashboard">Dashboard</a> ·
  <a href="https://supercompress.dev/coding-agent-proxy">Coding agent proxy</a> ·
  <a href="https://supercompress.dev/playground">Playground</a>
</p>
<p>Thanks again,<br>Arjun<br>Founder, SuperCompress</p>`;

  return { subject, text, html, to: email };
}

async function sendViaResend({ to, subject, text, html, from = DEFAULT_FROM }) {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, provider: "resend", error: "RESEND_API_KEY not configured" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text,
      html,
      reply_to: "arjunkshah21@gmail.com",
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      provider: "resend",
      error: body?.message || body?.error || `HTTP ${res.status}`,
    };
  }
  return { ok: true, provider: "resend", id: body?.id || null };
}

async function sendWelcomeEmail({ email, firstName }) {
  if (!email || !String(email).includes("@")) {
    return { ok: false, error: "missing email" };
  }
  const copy = welcomeCopy({ firstName, email: String(email).trim() });
  const result = await sendViaResend(copy);
  return { ...result, subject: copy.subject, text: copy.text };
}

module.exports = {
  welcomeCopy,
  sendViaResend,
  sendWelcomeEmail,
  DEFAULT_FROM,
};
