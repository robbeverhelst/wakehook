<div align="center">

<img src="docs/architecture.svg" alt="wakehook — health APIs flow into wakehook, which infers the wake moment and fans a signed user.awake event out to OpenClaw, Home Assistant, or any URL" width="100%">

# ⏰ wakehook

**A webhook that fires when you wake up.**

Plug in your sleep data, get a clean `user.awake` event — then make your morning *do something*.

<br>

![status](https://img.shields.io/badge/status-v1-FF8A4B)
![runtime](https://img.shields.io/badge/built%20with-Bun-000000?logo=bun)
![lang](https://img.shields.io/badge/TypeScript-3178c6?logo=typescript&logoColor=white)
![license](https://img.shields.io/badge/license-MIT-43b581)
![providers](https://img.shields.io/badge/source-Google%20Health-4dd0e1)

</div>

---

## 🌅 The idea

You wake up. Your Fitbit knows. So why does *nothing happen?*

**wakehook** is the missing piece: a tiny, self-hosted service that watches your sleep data,
figures out the moment you actually **woke up**, and **broadcasts a signed `user.awake` event**
to anything you want — your AI agent, your smart home, a script, a webhook URL.

It's deliberately **not built for any one tool.** [OpenClaw](https://docs.openclaw.ai) is just
*one* subscriber, sitting next to Home Assistant, n8n, a smart lamp, or your own code.

> 🧠 wakehook states a **fact** — *"this person woke at 07:03"* — and broadcasts it.
> Every subscriber decides its own **behavior**. The bus knows nothing about their purpose.

📐 Full rationale & decision log in [`DESIGN.md`](./DESIGN.md).

## ☕ A morning, scripted

```
06:58  you stir, your Fitbit logs the end of sleep
07:00  your phone syncs → Google Health → wakehook            "sleep data changed"
07:00  wakehook: main sleep? ✓  ends this morning? ✓  not fired yet today? ✓  → FIRE
07:00  ┌─ OpenClaw       → "morning! here's your day, weather's clear, 2 overnight msgs"
       ├─ Home Assistant → bedroom lights fade up, coffee machine on
       └─ your script    → logs wake time to a spreadsheet
```

You didn't touch your phone. It just *happened.*

## 🤔 Why it has to exist

You can't point Google Health's webhook straight at OpenClaw (or anything else):

| Blocker | What goes wrong |
|---|---|
| **Semantics** | Google's webhook means *"sleep data changed"* — it also fires for naps, mid-night syncs, and edits. It is **not** "you woke up." Something must fetch the session and *infer* the wake. |
| **Payload** | Google speaks `{operation, healthUserId, intervals}`; your consumer speaks something else entirely. |
| **Handshake** | Google demands an ownership-verification challenge and a `204` ack with 7-day retries. Your agent's endpoint won't play along. |

wakehook is the translator that closes that gap — **generically**, so *anything* can subscribe.

## ⚙️ How it works

```
you wake → (phone syncs) → Google Health cloud ──POST──▶ /webhook
   └─ ack 204 → fetch session → infer wake → dedup ──▶ fan out signed user.awake
                                                         ├─▶ OpenClaw       → runs a workflow
                                                         ├─▶ Home Assistant → lamp on
                                                         └─▶ any URL        → its own behavior
```

The wake rule (every threshold configurable): fire when a session is the **main** sleep,
**ends today** inside a **morning window**, is **long enough**, and we **haven't already fired
today** — with a **supersede** re-fire to heal Fitbit's rare split-night logs.

Tuned to two priorities:

- 🛟 **Never miss a wakeup** — no freshness gate, so a late-syncing webhook still fires.
- ⚡ **Fire as fast as the data arrives** — we act on the first qualifying signal, zero batching.

> Latency floor is your phone syncing to the cloud (open the Fitbit app to force it instantly);
> wakehook itself adds ~zero delay.

## 📦 The event subscribers receive

```http
POST <subscriber-url>
X-Wake-Signature: sha256=<hmac of body with the subscriber's secret>
X-Wake-Event-Id: <user>:<wokeAt>

{ "event": "user.awake", "wokeAt": "2026-06-14T07:03:00+02:00",
  "user": "<healthUserId>", "source": "google-health",
  "session": { "start": "...", "end": "...", "durationMin": 431 } }
```

- **`generic`** subscribers get exactly this — the vendor-neutral, signed contract.
- **`openclaw`** subscribers instead get a factual nudge
  (`POST /hooks/wake { "text": "You woke at 07:03 (slept 7h11m).", "mode": "now" }`) — and
  OpenClaw decides what to run.

## 🚀 Quick start

```bash
bun install
cp config.example.json config.json     # edit subscribers + timezone; secrets can live in env
cp .env.example .env                    # GOOGLE_CLIENT_ID / SECRET / WEBHOOK_AUTH_TOKEN

bun run auth        # one-time Google authorization (mints the refresh token)
bun run dev         # or: bun run start  /  docker build -t wakehook . && docker run ...
```

Then expose `/webhook` publicly — Cloudflare Tunnel, reverse proxy, VPS, your call; wakehook
bakes in **no ingress assumptions** — and create a Google Health **sleep** webhook subscription
pointing at it.

### 🧪 Test it without waiting for morning

```bash
curl -X POST http://localhost:8080/test/replay \
  -H "Authorization: Bearer $GOOGLE_WEBHOOK_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{}'    # fires a synthetic wake "now"; pass {"end":"...","durationMin":420} to control it
```

## 🔑 Google setup notes

- Create a Google Cloud project, enable the Health API, configure the OAuth consent screen,
  add yourself as a test user. Scope: `googlehealth.sleep.readonly`.
- **Publish the app to "In Production"** (still unverified, 100-user cap — fine for personal
  use) so the refresh token doesn't expire after 7 days (the "Testing" default).

## 🧩 Add your own provider

Google Health is just the first `Source`. The core (inference, dedup, fan-out) is
provider-agnostic, so a new provider touches **no core code**:

1. Implement the `Source` interface (`src/types.ts`) under `src/sources/<name>/`. A source
   declares one or both **capabilities**:
   - **`webhook`** (push) — the provider POSTs to `/webhook`
     *(Google Health, Fitbit Web, WHOOP, Withings, Oura, Sleep as Android…)*.
   - **`poll`** (pull) — wakehook polls it on a timer
     *(on-device Health Connect bridge, Open Wearables, plain REST APIs…)*.
2. Register it with **one line** in `src/sources/registry.ts`.
3. Select it via `"source": "<name>"` in config.

The server mounts `/webhook` only for push sources; the scheduler drives poll sources. No new
providers ship today — but the interface is ready for both kinds.

➕ **New subscriber shape?** Add a `preset` branch in `src/subscribers/fanout.ts`.

## 🛠️ Stack

**Bun** · **Hono** · **`bun:sqlite`** — single portable service, shipped as a Docker image,
12-factor config. Core logic is unit tested (`bun test`).

## 📍 Status

v1: Google Health source + wake inference + signed fan-out + `openclaw`/`generic` presets,
with a generic push/poll `Source` interface ready for more providers. The Google
sleep-response field mapping (`mapSession`) is isolated in one place so it can be confirmed
against the live API.

## 📄 License

MIT
