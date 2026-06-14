---
name: wakehook
description: Install, configure, authorize and run wakehook so OpenClaw runs the user's morning routine when they wake up. wakehook turns Google Health / Fitbit sleep data into a signed user.awake event and POSTs OpenClaw a factual nudge each morning. Use when the user wants wake-triggered automations, mentions wakehook, or asks to "fire something when I wake up".
homepage: https://github.com/robbeverhelst/wakehook
---

# wakehook → OpenClaw

`wakehook` is a tiny self-hosted service that watches the user's sleep data
(Google Health / Fitbit), figures out the moment they **woke up**, and POSTs
OpenClaw a one-line nudge so the morning routine runs itself — at most once per
morning. This skill installs and wires it up end to end.

Run it in **poll mode** (the default below): wakehook *pulls* from Google on a
timer, so all traffic is outbound — **no public URL, tunnel, or open port.**

Follow the steps in order. Do not improvise an install from the README — these
are the verified steps.

## Prerequisites (check, don't assume)

1. **Bun ≥ 1.3** — `bun --version`. If missing: `curl -fsSL https://bun.sh/install | bash`.
   (wakehook is Bun-only; it imports `bun:sqlite`. Do **not** run it with Node.)
2. **Google OAuth credentials** for a Google Cloud project that has the **Health
   API** enabled and the `googlehealth.sleep.readonly` scope on its consent
   screen: a **client id** and **client secret**. If the user already uses Google
   with OpenClaw, reuse that project's OAuth 2.0 *client* (an API key will NOT
   work — sleep data needs user-consented OAuth). Ask the user for these.
3. **Where to deliver events** — wakehook delivers to OpenClaw via an HTTP POST.
   Ask the user for OpenClaw's wake endpoint URL and a shared secret (any random
   string; it doubles as the bearer token). If unknown, ask the user to confirm
   the endpoint that should run the morning routine.

## Step 1 — install

No install needed; run it on demand with Bun:

```bash
bunx wakehook        # the service (poller)
bunx wakehook-auth   # the one-time Google authorization
```

(Docker alternative: `docker run -v wakehook-data:/data --env-file .env ghcr.io/robbeverhelst/wakehook`.)

## Step 2 — configure

Create **`config.json`** in the working directory. Replace the timezone with the
user's IANA zone, and the subscriber `url`/`secret` with OpenClaw's:

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
    { "id": "openclaw", "url": "<OPENCLAW_WAKE_URL>", "secret": "<SHARED_SECRET>", "preset": "openclaw" }
  ]
}
```

Create **`.env`** (keep secrets out of `config.json`):

```bash
GOOGLE_CLIENT_ID=<client-id>
GOOGLE_CLIENT_SECRET=<client-secret>
GOOGLE_REDIRECT_URI=http://localhost:8080/oauth/callback
```

> The `googlehealth.sleep.readonly` scope is requested automatically — no scope
> config needed. Make sure `http://localhost:8080/oauth/callback` is an
> authorized redirect URI on the OAuth client.

## Step 3 — authorize once

```bash
bunx wakehook-auth
```

This prints a Google consent URL. Give it to the user to open and approve. After
approval it stores a refresh token in `./wake.sqlite` and auto-refreshes forever
— this is a **one-time** step.

> If it prints an HTTP 400 from Google, the OAuth client is missing the
> `localhost:8080/oauth/callback` redirect URI — add it and retry.

## Step 4 — run it

```bash
bunx wakehook
```

It now polls Google every 15 minutes and, when it detects the morning wake,
delivers to OpenClaw. Keep this process running (a long-lived process or a
service). The token + once-per-morning dedup persist in `./wake.sqlite`.

## What OpenClaw receives

When the user wakes, wakehook sends **one** request to the configured URL:

```
POST <OPENCLAW_WAKE_URL>
Authorization: Bearer <SHARED_SECRET>
Content-Type: application/json
X-Wake-Signature: sha256=<hmac of the body with SHARED_SECRET>
X-Wake-Event-Id: <user>:<wokeAt ISO>

{ "text": "You woke at 07:13 (slept 7h44m).", "mode": "now" }
```

Treat this as the trigger to run the morning routine. The body is a factual
nudge — decide the behavior on OpenClaw's side. Verify `X-Wake-Signature` with
`SHARED_SECRET` if you want to authenticate it beyond the bearer token. It fires
at most once per morning (later split-sleep edits supersede once).

## Verify without waiting for morning

```bash
curl -X POST http://localhost:8080/test/replay \
  -H 'Content-Type: application/json' -d '{}'
```

This injects a synthetic wake "now" and delivers it exactly like a real one —
use it to confirm OpenClaw receives and handles the event.

## Gotchas

- **Bun-only** — never run with Node (`bun:sqlite`).
- **Poll mode needs the OAuth creds** (you call Google's API) but **no inbound URL**.
- **Webhook (instant) mode exists but is unverified** — stay on poll.
- A Google **API key is not enough**; sleep data requires the OAuth client + auth above.
- One running instance per user; events are keyed per person and deduped per day.

See {baseDir} / the repo for source and full docs: https://github.com/robbeverhelst/wakehook
