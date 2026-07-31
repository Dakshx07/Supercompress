# Security Policy

## Supported versions

Please report vulnerabilities against the latest published PyPI release and the `main` branch of this repository.

## Reporting a vulnerability

Do **not** open a public issue for security reports.

Email [arjunkshah21@gmail.com](mailto:arjunkshah21@gmail.com), and include:

- Description of the issue
- Steps to reproduce
- Impact assessment (auth bypass, key leakage, data exposure, DoS, etc.)
- Any proof-of-concept limited to a private report

We will acknowledge receipt and work on a fix before any public disclosure.

## API keys

- Treat `sc_live_…` keys as secrets.
- Rotate keys from the [dashboard](https://supercompress.dev/dashboard) if exposed.
- Never commit keys, `.env` files, or Firebase/Stripe credentials to git.
