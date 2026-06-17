# Atelier Builder — Workstream 2: Client ↔ Stylist Chat (STAGING ONLY)

> This is **Workstream 2** of the same staging build. **Build Workstream 1 (`ATELIER_CYNTHIA_BUILD.md`) first** — it's parity-blocking and fully self-contained — then build this. All HARD GUARDRAILS from `ATELIER_CYNTHIA_BUILD.md §HARD GUARDRAILS` apply here unchanged (staging Supabase `yuoxmcujmpfuujjchkcl` only; never deploy/migrate to live; additive+nullable schema; branch `feature/cynthia-styling`; never touch auth passwords; keep Karl's WIP).

---

## 0. INTEGRATION NOTES — READ BEFORE BUILDING

The spec in §1–§12 below is the product intent. It was written against an idealized schema; adapt it to **this** codebase and to staging-safe operation as follows. These notes override the spec wherever they conflict.

### 0a. Schema adaptation (the spec's DDL will NOT run as written)
The spec's `§3` DDL assumes `clients(id) uuid` and a `stylists` table. Neither matches reality:
- **Clients are text-id.** The real table is `gp_clients` (the app also queries a `clients` name — confirm whether `clients` is a view over `gp_clients`); `id` is a **text** Mongo ObjectID. So: `conversations.client_id text REFERENCES gp_clients(id)`.
- **There is no `stylists` table — stylists live in `users`** (`users.id uuid`, `role in ('admin','stylist','support')`). So: `conversations.stylist_id uuid REFERENCES users(id)`.
- **`messages.sender_id` is polymorphic** (a client text-id OR a stylist uuid). Don't FK it to one type. Use `sender_id text` (store either, interpret via `sender_type`), or two nullable columns `client_sender_id text` / `stylist_sender_id uuid`. Pick one and document it.
- Everything else (the two tables, indexes, kinds) is fine. Add as new sequential migrations (`migrations/009_chat.sql`, …) — additive only.

### 0b. RLS is DIFFERENT here (do NOT blanket `USING(true)`)
`conversations`/`messages` are **private** and are **not** read by the public anon lookbook. So unlike the shared lookbook tables, these get **properly restrictive** RLS: a client may read/write only rows in their own conversation; stylists (authenticated `users`) get their assigned books. Verify how the logged-in client identity maps to a `client_id` first (check `LoginPage.tsx`, the unified-auth model, and the email-match pattern in `supabase/migrations/003_fix_rls_email_match.sql`) and scope policies off that mapping. Get this right — it's a privacy boundary.

### 0c. OUTWARD-COMMS SAFETY — the load-bearing staging rule
This workstream sends messages to real people (Slack, email, push). **During the staging build, the system must NEVER post to a real client's Slack channel, email a real client, or push a real client.** Hard rules:
- All Slack posting, Resend email, and web push on staging go **only** to a dedicated **TEST Slack channel** and **test recipient(s)** that Karl designates. No real client destination, ever.
- Until those test destinations + tokens exist, build the wiring behind env vars and exercise it with **mocks / a logging stub**, not live sends.
- Seed a **test client** and **test stylist** on staging to drive the whole loop. Never seed or message into live.
Treat any path that could message a real client as a stop-and-log, not a thing to "try once."

### 0d. Credential gates (build the wiring; batch ONE ask to Karl; never invent secrets)
You cannot self-provision these — build everything behind env placeholders, stub/mocked, and put a single consolidated "Karl, I need these to light up Slack/email/push on staging" list in `CYNTHIA_BUILD_REPORT.md`:
- **Slack app for staging:** bot token (`xoxb-…`), signing secret, the **Events API Request URL must be registered to your deployed staging Edge Function endpoint**, and the bot invited to the **test channel** (+ its channel ID). Karl creates the Slack app; you provide him the exact Request URL once the function is deployed.
- **Resend:** API key + a verified from-domain (Karl already uses Resend — he may point you at an existing key; if so, still send only to test recipients on staging).
- **Test destinations:** the test Slack channel ID + test client/stylist identities.
- **VAPID keypair (web push):** you MAY generate this yourself (`web-push generateVAPIDKeys`), store the private key in staging function env + public key in `.env.staging.local`, and document it — not a hard gate.
Per the autonomy rules: build all the code, gate only on the secrets above, and keep going on everything that doesn't need them.

### 0e. Greenfield reality check (scope honestly in BUILD_LOG)
- **There is no PWA yet** — no `manifest.json`, no service worker, no apple-mobile meta in `index.html`. Phase 3 builds the installable-PWA shell from scratch (manifest + `display:standalone`, service worker, offline shell, Badging API, web push, silent refresh + magic-link fallback, add-to-home-screen onboarding overlay). This is real work — don't under-scope it.
- **No Slack/Resend/cron infra exists** in the repo today. Edge Functions deploy to staging Supabase (`supabase functions deploy <fn> --project-ref yuoxmcujmpfuujjchkcl --no-verify-jwt`, with `SUPABASE_ACCESS_TOKEN`). SLA cron: prefer a **Supabase scheduled function / pg_cron on staging** (the staging DB already runs pg_cron) over Vercel cron, to keep it on the staging stack; either is acceptable if staging-scoped.
- Match existing brand system + component patterns; the client-facing bubble must look like the rest of the client experience and be iPad/iPhone-correct.

### 0f. Build order within this workstream
Spec §10 phases. **MVP = Phases 1–4.** Build Phase 1 **fully and live-testable on staging** first (it needs no external secrets — pure Supabase loop). Then build Phases 2–4 code-complete behind the gated env, testing against the test channel/recipients once Karl supplies them (mocks until then). Phases 5–6 per spec. Verify every §11 acceptance criterion on staging; for gated external bits, verify against test destinations and log results.

### 0g. Deploy/verify
Same staging stack and the **staging-only deploy procedure** in `ATELIER_CYNTHIA_BUILD.md §7`. Never `npm run deploy`/`ship`. Edge Functions and cron → staging Supabase ref `yuoxmcujmpfuujjchkcl` only.

---

# Client ↔ Stylist Chat — Build Spec
**Status:** Draft for build
**Surface:** Atelier client login pages (client-facing PWA) + Slack (stylist-facing)

## 1. What we're building
A chat bubble on the Atelier client login experience that lets a logged-in client message their stylist. The client uses Atelier as an installed app on their iPhone; the stylist responds from Slack on her phone. Every message is stored in Supabase. An SLA cron guarantees no client waits too long without a response.

### Core promises
- **Easy for the client** — tap a bubble, type, get notified of replies. No new app to download; the bookmarked Atelier PWA *is* the app.
- **Easy for the stylist** — she replies in Slack, where she already lives, with phone push for free.
- **Documented** — every message (both directions) is a row in Supabase. Business owns the history.
- **Accountable** — an SLA cron flags any unanswered client message before the promised turnaround lapses.

### The one reframe that drives the architecture
Slack and SMS are **reply surfaces**, not the system of record. **Supabase is the source of truth.** Every message is written to Postgres first, then fanned out to whatever surface the stylist uses. This makes documentation, SLA tracking, and future surfaces (native console, SMS) trivial — and avoids losing history to Slack's retention limits.

```
Client (Atelier PWA)  ──►  Supabase (SoR)  ──►  Slack thread (stylist replies)
        ▲                       │                        │
        └──── web push ◄────────┴──── Realtime ◄─────────┘
                                │
                                └──► SLA cron ──► #escalations (metadata only)
```

## 2. Architecture
| Layer | Choice | Notes |
|---|---|---|
| Client UI | Atelier PWA chat bubble | Same login/session as the looks experience |
| System of record | Supabase Postgres | `conversations` + `messages` tables |
| Client live updates | Supabase Realtime | Pushes stylist replies into the open bubble |
| Stylist reply surface | Slack | One channel per stylist's book; thread per client |
| Client → Slack | Supabase Edge Function | Posts to Slack on new client message |
| Slack → client | Slack Events API → Edge Function | Captures stylist reply, writes to Supabase |
| Client notifications | Web Push (PWA) + email fallback (Resend) | Badge + lock-screen banner |
| SLA enforcement | Cron (Vercel cron or Supabase scheduled fn) | Two-tier escalation |

Decisions consistent with the existing stack: Supabase as SoR, Resend for warm/transactional email, Slack already in use by the team. **No Twilio in v1** — Slack mobile push covers stylist phone notification; email covers client notification fallback. SMS remains a future option precisely because the data lives in Supabase (bolt-on, not re-architecture).

## 3. Data model (Supabase)
> Adapt per §0a: `client_id text REFERENCES gp_clients(id)`, `stylist_id uuid REFERENCES users(id)`, polymorphic `sender_id`. Additive migration only.
```sql
CREATE TABLE conversations (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        uuid NOT NULL REFERENCES clients(id),
    stylist_id       uuid REFERENCES stylists(id),      -- assigned lead stylist
    status           text NOT NULL DEFAULT 'active',     -- active, archived
    slack_channel_id text,                               -- stylist's book channel
    slack_thread_ts  text,                               -- THE routing key (Slack thread)
    last_inbound_at  timestamptz,                        -- last client message
    last_response_at timestamptz,                        -- last stylist message
    sla_due_at       timestamptz,                        -- computed deadline for next response
    escalation_stage int NOT NULL DEFAULT 0,             -- 0 none, 1 re-pinged stylist, 2 channel
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    sender_type     text NOT NULL,                       -- client, stylist, system
    sender_id       uuid,                                -- client_id or stylist_id, null for system
    body            text,
    attachments     jsonb DEFAULT '[]',                  -- images, look-card refs
    message_kind    text NOT NULL DEFAULT 'text',        -- text, image, look_card, system_ack
    slack_ts        text,                                -- Slack message ts (for dedupe/edit)
    read_at         timestamptz,                         -- when the OTHER party read it
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_conversations_sla ON conversations(sla_due_at) WHERE status = 'active';
```
**RLS:** clients can only read/write `messages` in their own `conversation`. Do not loosen existing policies — add scoped policies for these two tables only. (See §0b — use restrictive RLS here, not the lookbook's open SELECT.)

## 4. The two notification paths (both must work)
### 4a. Client → Stylist (the easy direction)
1. Client types → insert `messages` row (`sender_type='client'`), update `conversations.last_inbound_at` and `sla_due_at`.
2. **Instant auto-ack:** insert a `system` message ("Got it! {Stylist} typically replies within {window}.") and render it immediately. Off-hours copy swaps to "She'll see this first thing in the morning."
3. Edge Function posts the message into the stylist's Slack channel. First message of a conversation opens a thread headed with the client's name; store `slack_thread_ts`. Subsequent messages post into that thread.
4. Slack mobile push notifies the stylist on her phone — free, no Twilio.

### 4b. Stylist → Client (the direction that's easy to forget)
1. Stylist replies **in the Slack thread**.
2. Slack Events API → Edge Function → insert `messages` row (`sender_type='stylist'`), update `last_response_at`, reset `escalation_stage=0`.
3. Supabase Realtime pushes it into the client's open bubble live.
4. **If the client app is closed:** Web Push wakes the service worker → shows lock-screen banner ("Sarah replied 💬") → calls `setAppBadge(unreadCount)` for the red badge.
5. **Fallback if push not granted:** send "You have a reply from {Stylist}" via Resend email with a deep link back into the chat.
> The reverse path is load-bearing. If the client never learns a reply arrived, the whole experience collapses. Do not ship 4a without 4b.

## 5. iOS PWA requirements (client side)
- **Add to Home Screen is mandatory** for web push *and* badges — neither works in a plain Safari tab. iOS never auto-prompts, so onboarding must coach it (see SOP) or staff does it on the client's phone in person.
- **Web Push** requires iOS 16.4+ (a non-issue in 2026), home-screen install, and granted notification permission.
- **Badging API** (`navigator.setAppBadge(count)` / `clearAppBadge()`): red unread count on the icon. Driven from the server — the push payload carries the unread count; the service worker stamps the badge; `clearAppBadge()` on read.
  - iOS has **no silent badge-only push** — a push that updates the badge must also show a notification. That's fine: client gets both banner + badge.
- **Standalone display mode** (`display: "standalone"` in the manifest) so it opens full-screen with no browser chrome.
- **Offline shell** via service worker so it opens instantly on bad signal.

### Session persistence — be honest about iOS
The "400-day cookie → never log in again" assumption does **not** hold reliably on iOS. Under ITP, script-writable storage (where the Supabase auth token lives) can be evicted after ~7 days of **non-use**, and home-screen PWAs have had storage-wipe bugs.
- **Active clients stay logged in indefinitely** — usage keeps the session refreshing. They functionally never see a login screen.
- **Only fully-dormant clients (weeks of non-use) risk eviction.** For them the recovery must be one tap.
- **Build:** (1) silent refresh-token renewal on app open so active users never notice; (2) a frictionless **magic-link** re-auth fallback so an evicted client is one tap from back in — no password, no friction.
Accurate promise: **"It feels like an app and they basically never deal with login,"** not "they will never log in again."

## 6. SLA escalation cron
Runs every few minutes. **Ship this day one.**
### Business-hours aware
- Each stylist has business hours + timezone. The SLA clock **pauses outside business hours** — an 11pm message does not escalate at 1am.
- `sla_due_at` is computed from `last_inbound_at` + the response window, skipping non-business hours.
### Two-tier, to avoid diffusion of responsibility
1. **Stage 1 — re-ping the assigned stylist directly** (DM / direct @mention in her thread) when `sla_due_at` is approaching/passed. Quiet, targeted.
2. **Stage 2 — escalate to `#escalations`** only if still unanswered at a second, later threshold. `@here` (not `@channel`) so offline stylists aren't buzzed at night. All stylists are in this channel as backup coverage.
### Privacy-safe escalation
`#escalations` posts are **metadata only** — never the client's message content. Example: "⏰ Maria has been waiting 2h — tap to respond" + deep link into the conversation.
### Claim mechanism
An escalation post has a "I've got it" action (Slack button / emoji react). Claiming sets the responder, stands the others down, and is visible so coverage is unambiguous.
### Threshold linkage
The escalation threshold must be **tighter than the client-facing promise.** If clients are told "within 2 hours," Stage 1 fires ~90 min so the gap is caught *before* the promise breaks.

## 7. Client-facing turnaround expectations
- **Displayed expectation:** show "Typically replies within {window} during business hours" near the input.
- **Instant auto-ack** on every client send (see 4a step 2).
- **Off-hours messaging:** auto-ack swaps to a morning-reply message.
- The displayed window, the auto-ack copy, and the cron threshold are **one linked number** — change them together.
- Suggested starting window: **2 business hours** (escalate at 90 min). Tune from real data.

## 8. The differentiator — wire chat into the looks
- Stylist can **drop a look card directly into the chat** ("here's the dress I mentioned 👇").
- Client can tap a look and **send it into the chat** ("more like this").
- `messages.message_kind = 'look_card'` with the look reference in `attachments`.
This cross-link is what turns a chat widget into the app experience. Design the message type now even if the UI ships in a later pass.

## 9. Other product details
- **Empty state:** first open is a pre-seeded warm welcome message from the stylist, not a blank box.
- **Stylist identity (lead + assistant):** show real names, but make the lead clearly primary so the client never feels handed off. Both are in the Slack channel and can reply into the thread.
- **Read receipts (lightweight):** "Seen" on both sides via `messages.read_at`.
- **Reassignment:** when a stylist changes, reassign `conversations.stylist_id` and re-point `slack_channel_id`. History stays put.
- **Attachments:** store in Supabase Storage; reference in `attachments`.

## 10. Build phases
1. **Phase 1 — Data + client UI:** schema, RLS, chat bubble, send/receive via Realtime, auto-ack, empty state. (Internal-only loop, no Slack yet.)
2. **Phase 2 — Slack relay both directions:** Edge Function out, Events API in, thread mapping, channel-per-stylist setup.
3. **Phase 3 — PWA hardening:** manifest/standalone, service worker, web push, Badging API, silent refresh + magic-link fallback, add-to-home-screen onboarding overlay + Resend email fallback.
4. **Phase 4 — SLA cron:** business-hours model, two-tier escalation, `#escalations` metadata posts, claim mechanism.
5. **Phase 5 — Looks ↔ chat:** look-card message type, drop-into-chat from both sides.
6. **Phase 6 — Polish:** read receipts, reassignment tooling, identity persona.
MVP = Phases 1–4. Phases 5–6 make it special.

## 11. Acceptance criteria
- [ ] Client sends a message; stylist receives a Slack push on her phone within seconds. *(staging: into the TEST channel)*
- [ ] Stylist replies in Slack; client sees it live (app open) AND gets a banner + badge (app closed, push granted) OR an email (push not granted). *(staging: test recipients)*
- [ ] Client added to Home Screen sees the red unread badge on the icon; it clears on read.
- [ ] An active client never sees a login screen across weeks of use; a dormant client recovers in one magic-link tap.
- [ ] An unanswered message re-pings the stylist at Stage 1 and posts metadata-only to `#escalations` (staging: a test escalations channel) at Stage 2 with a working claim action.
- [ ] No client message content ever appears in `#escalations`.
- [ ] SLA clock does not escalate outside the stylist's business hours.
- [ ] Every message both directions is queryable in Supabase.

## 12. Open decisions
- Exact response window + escalation thresholds (start 2h / 90min).
- Channel structure: one per stylist's book vs per-client (start: per-book, thread-per-client).
- Whether assistant stylist gets equal reply rights or triage-only.
- Business hours per stylist (source of truth: where?). *(Build a minimal `stylist_hours`/`users` business-hours field on staging; flag for Karl to confirm canonical source.)*

---
**Companion doc:** `docs/SOP-client-stylist-chat.md` — the stylist-facing operating procedure (not a build artifact, but build the product so the SOP is accurate).
