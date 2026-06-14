---
name: wakehook
description: Install, configure, authorize and run wakehook so OpenClaw runs the user's morning routine when they wake up. wakehook turns Google Health / Fitbit sleep data into a signed event and POSTs OpenClaw's /hooks/wake a one-line nudge each morning. Use when the user wants wake-triggered automations, mentions wakehook, or asks to "do something when I wake up".
homepage: https://github.com/robbeverhelst/wakehook
---

# wakehook → OpenClaw

`wakehook` is a tiny self-hosted service that watches the user's sleep data
(Google Health / Fitbit), detects the moment they **woke up**, and POSTs
OpenClaw's `/hooks/wake` a one-line nudge so the morning routine runs itself —
at most once per morning.

Work through the steps in order. **Ask the user** at the decision points instead
of assuming. Do not improvise from the README — these steps are verified.

## Prerequisites (check, don't assume)

1. **Bun ≥ 1.3** — `bun --version`; install with `curl -fsSL https://bun.sh/install | bash`.
   wakehook is Bun-only (`bun:sqlite`); never run it with Node.
2. **Google OAuth credentials** — a Google Cloud project with the **Health API**
   enabled and the `googlehealth.sleep.readonly` scope, plus an **OAuth 2.0
   client** (client id + secret). An API key will NOT work; sleep data needs
   user-consented OAuth. Ask the user for the id + secret (reuse their existing
   Google project if they have one).

## Step 1 — enable OpenClaw's inbound webhook

wakehook delivers by POSTing OpenClaw's gateway `/hooks/wake`. Make sure the
gateway has hooks enabled (OpenClaw gateway config):

```jsonc
{
  "hooks": {
    "enabled": true,
    "path": "/hooks",          // must not be "/"
    "token": "<HOOKS_TOKEN>"   // any strong random string
  }
}
```

Note OpenClaw's gateway address (host + port — the docs' examples use
`127.0.0.1:18789`; confirm the user's actual port). The delivery URL is then
`http://<gateway-host>:<port>/hooks/wake`, and `<HOOKS_TOKEN>` is the secret
wakehook must present. (Verified contract: `/hooks/wake` accepts
`{ "text": "...", "mode": "now" }` with `Authorization: Bearer <token>` or
`x-openclaw-token: <token>`; query-string tokens are rejected.)

## Step 2 — choose how wakehook gets the sleep data (ask the user)

Two modes — confirm which they want; **don't assume**:

- **poll** *(recommended default)* — wakehook pulls from Google on a timer.
  **No public URL / tunnel / open port** (all outbound). Trade-off: it fires on
  the next tick, so up to `pollIntervalMs` late (15 min by default). This path is
  verified end-to-end.
- **webhook** — Google pushes the instant data lands → fires immediately, but
  requires a **public HTTPS endpoint** for wakehook plus registering a Google
  Health sleep subscription. ⚠️ This path is **not yet verified** — only choose
  it if the user explicitly wants instant fires and can expose an endpoint.

If the user has no preference, use **poll**.

## Step 3 — configure wakehook

Create **`config.json`** in the working directory. Set `timezone` to the user's
IANA zone, the subscriber `url` to OpenClaw's `/hooks/wake`, and the subscriber
`secret` to OpenClaw's `<HOOKS_TOKEN>` from Step 1:

```json
{
  "dbPath": "./wake.sqlite",
  "source": "google-health",
  "inference": {
    "timezone": "Europe/Brussels",
    "windowStart": "04:00",
    "windowEnd": "11:00",
    "minDurationMin": 180,
    "supersedeGapMin": 45
  },
  "google": { "mode": "poll", "pollIntervalMs": 900000, "pollLookbackMin": 720 },
  "subscribers": [
    { "id": "openclaw", "url": "http://<gateway-host>:<port>/hooks/wake", "secret": "<HOOKS_TOKEN>", "preset": "openclaw" }
  ]
}
```

> If the user chose **webhook** mode instead: set `"google"` to
> `{ "mode": "webhook", "webhookAuthToken": "<random>" }`, also put
> `GOOGLE_WEBHOOK_AUTH_TOKEN` in `.env`, expose wakehook's `/webhook` over public
> HTTPS, and register a Google Health sleep subscription pointing at it. (Unverified.)

Create **`.env`** (keep secrets out of `config.json`):

```bash
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>
GOOGLE_REDIRECT_URI=http://localhost:8080/oauth/callback
```

Ensure `http://localhost:8080/oauth/callback` is an authorized redirect URI on the OAuth client.

## Step 4 — authorize once

```bash
bunx wakehook-auth
```

Prints a Google consent URL — give it to the user to open and approve. It stores
a refresh token in `./wake.sqlite` and auto-refreshes forever (one-time step).
If Google returns HTTP 400, the OAuth client is missing the
`localhost:8080/oauth/callback` redirect URI — add it and retry.

## Step 5 — run it

```bash
bunx wakehook
```

(Docker alt: `docker run -v wakehook-data:/data --env-file .env ghcr.io/robbeverhelst/wakehook`.)
Keep it running (long-lived process / service). In poll mode it polls Google
every `pollIntervalMs` and, on the morning wake, POSTs OpenClaw once.

## What OpenClaw receives

```
POST http://<gateway-host>:<port>/hooks/wake
Authorization: Bearer <HOOKS_TOKEN>
Content-Type: application/json

{ "text": "You woke at 07:13 (slept 7h44m).", "mode": "now" }
```

OpenClaw turns this into a `now` wake of the main session — handle it as the
trigger to run the morning routine. wakehook also sends `X-Wake-Signature`
(HMAC of the body with the secret) and `X-Wake-Event-Id` if you want extra
verification. Fires at most once per morning.

## Verify without waiting for morning

```bash
curl -X POST http://localhost:8080/test/replay \
  -H 'Content-Type: application/json' -d '{}'
```

Injects a synthetic wake "now" and delivers it exactly like a real one — confirm
OpenClaw receives and acts on it.

## Gotchas

- **Bun-only** — never run with Node.
- The subscriber `secret` MUST equal OpenClaw's gateway `hooks.token`, or
  `/hooks/wake` rejects it (401). Hooks must be **enabled** on the gateway.
- **poll** needs the OAuth creds but **no inbound URL**; **webhook** is instant
  but unverified — prefer poll unless the user asks otherwise.
- A Google **API key is not enough** — it needs the OAuth client + `wakehook-auth`.
- If `/hooks/wake` returns 200 but nothing happens, check the OpenClaw version
  (a known issue affected some 2026.3.x builds) or try `mode: "now"` is set.

Source + full docs: https://github.com/robbeverhelst/wakehook
