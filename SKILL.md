---
name: wakehook
description: Install, configure, authorize and run wakehook so OpenClaw runs the user's morning routine when they wake up. wakehook turns Google Health / Fitbit sleep data into a neutral user.awake event and POSTs it to an OpenClaw mapped hook, which turns it into a wake action. Use when the user wants wake-triggered automations, mentions wakehook, or asks to "do something when I wake up".
homepage: https://github.com/robbeverhelst/wakehook
---

# wakehook → OpenClaw

`wakehook` is a tiny self-hosted service that watches the user's sleep data
(Google Health / Fitbit), detects the moment they **woke up**, and POSTs OpenClaw
a neutral `user.awake` event so the morning routine runs itself — at most once
per morning. OpenClaw maps that event into a wake action (its native pattern), so
wakehook stays vendor-neutral.

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

## Step 1 — add an OpenClaw mapped hook

wakehook POSTs the raw `user.awake` event to an OpenClaw **mapped hook**; OpenClaw
turns it into a wake of the main session via `hooks.mappings`. In the OpenClaw
gateway config:

```json5
{
  hooks: {
    enabled: true,
    path: "/hooks",            // must not be "/"
    token: "<HOOKS_TOKEN>",    // any strong random string
    mappings: [
      {
        match: { path: "wakehook" },   // matches POST /hooks/wakehook
        action: "wake",
        wakeMode: "now",
        name: "wakehook",
        // reads fields straight from wakehook's user.awake event:
        messageTemplate: "You woke at {{wokeAt}} (slept {{session.durationMin}} min).",
      },
    ],
  },
}
```

Note the gateway address (host + port — OpenClaw's docs examples use
`127.0.0.1:18789`; confirm the user's actual port). The delivery URL is then
`http://<gateway-host>:<port>/hooks/wakehook`, and `<HOOKS_TOKEN>` is the token
wakehook must present. (Verified: `/hooks/*` is gated by the token in a header —
`Authorization: Bearer <token>` or `x-openclaw-token: <token>`; query-string
tokens are rejected. The mapping then renders `messageTemplate` and wakes the
session.)

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
IANA zone, the subscriber `url` to the mapped hook from Step 1, and pass the
`<HOOKS_TOKEN>` as the `Authorization` header:

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
    {
      "id": "openclaw",
      "url": "http://<gateway-host>:<port>/hooks/wakehook",
      "headers": { "Authorization": "Bearer <HOOKS_TOKEN>" }
    }
  ]
}
```

> No `preset` needed — `generic` (the raw signed event) is the default and is what
> the OpenClaw mapping expects. `<HOOKS_TOKEN>` must equal the gateway's
> `hooks.token` from Step 1.
>
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

## Step 6 — decide what happens on wake (optional)

By default the Step-1 mapping just nudges the main session. To make waking up
*do* something, shape the behavior in the **mapping** (this is OpenClaw-side
config, not wakehook). wakehook only supplies the trigger; the actual abilities
(calendar, weather, messages, …) come from **OpenClaw's own skills/tools** —
install/enable those separately.

**A — simple nudge, routine in the prompt** (`action: "wake"`): make
`messageTemplate` the instruction the main session executes.

```json5
{
  match: { path: "wakehook" },
  action: "wake",
  wakeMode: "now",
  messageTemplate: "Good morning — the user just woke ({{wokeAt}}). Run the morning routine: review today's calendar, summarize overnight messages, and give the weather.",
}
```

**B — full routine run on a dedicated agent** (`action: "agent"`): route to an
agent that has the relevant skills, and deliver the result to a chat surface.

```json5
{
  match: { path: "wakehook" },
  action: "agent",
  agentId: "morning",          // an agent you've set up with calendar/weather/etc. skills
  wakeMode: "now",
  messageTemplate: "User woke at {{wokeAt}} (slept {{session.durationMin}} min). Produce the morning briefing.",
  deliver: true,               // send the result back to a chat surface…
  channel: "last",             // …e.g. Telegram/Discord (defaults to last used)
}
```

Note: you generally **don't** trigger a cron from this — wakehook *is* the real
wake signal, so it replaces guessing a fixed time. Just run the task on the event.
The capabilities themselves are separate OpenClaw skills; this step only wires
*when* and *what to ask for*.

## What OpenClaw receives

wakehook POSTs the raw, neutral event (the OpenClaw mapping templates it):

```
POST http://<gateway-host>:<port>/hooks/wakehook
Authorization: Bearer <HOOKS_TOKEN>
Content-Type: application/json

{ "event": "user.awake", "wokeAt": "2026-06-13T08:04:00Z", "user": "self",
  "source": "google-health",
  "session": { "start": "...", "end": "2026-06-13T08:04:00Z", "durationMin": 464 } }
```

The Step-1 mapping turns this into a `now` wake of the main session with the
templated text — handle that as the trigger to run the morning routine. wakehook
also sends `X-Wake-Event-Id` (and `X-Wake-Signature` if a `secret` is set) for
optional extra verification. Fires at most once per morning.

## Verify without waiting for morning

```bash
curl -X POST http://localhost:8080/test/replay \
  -H 'Content-Type: application/json' -d '{}'
```

Injects a synthetic wake "now" and delivers it exactly like a real one — confirm
OpenClaw maps it and runs the routine.

## Gotchas

- **Bun-only** — never run with Node.
- The `Authorization` bearer MUST equal OpenClaw's gateway `hooks.token`, or
  `/hooks/wakehook` rejects it (401). Hooks must be **enabled** and the
  **mapping** (`match.path: "wakehook"`) must exist, or the path won't route.
- **poll** needs the OAuth creds but **no inbound URL**; **webhook** is instant
  but unverified — prefer poll unless the user asks otherwise.
- A Google **API key is not enough** — it needs the OAuth client + `wakehook-auth`.
- If the hook returns 200 but nothing happens, check the OpenClaw version (a known
  issue affected some 2026.3.x builds) and that the mapping `action: "wake"` is set.

Source + full docs: https://github.com/robbeverhelst/wakehook
