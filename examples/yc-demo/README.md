# SuperCompress local web demo

Real working UI against the hosted SuperCompress API.

## Run

```bash
node examples/yc-demo/server.js
```

Open **http://127.0.0.1:3855**

## What you get

- Paste **API key** (`sc_live_…`) — entered manually in the UI
- Edit **query** and **input context**
- Click **Compress with SuperCompress**
- Local server proxies to `POST https://www.supercompress.dev/api/v1/compress`
- See compressed output + char/line/token stats, latency, policy

This is not a mock. Every compress hits the live API.
