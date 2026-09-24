# PRAHARI

**SIF precursor intelligence for process industries.**

PRAHARI reads unsafe-act, unsafe-condition and near-miss reports and scores their
**serious-injury and fatality (SIF) potential** from 0 to 100 — what the event could
have become, not the injury it happened to record. A near miss that ends with
“nobody was hurt” is scored on the hazardous energy, the failed control and the
person in the line of fire, never lowered by the lucky outcome.

It is a full-stack application: a React + TypeScript console, a Cloud Functions
service layer, and Firebase Auth, Firestore and Storage. Nothing in the product is
mocked.

It also includes **AI safety features** ([§12](#12-ai-safety-features)): live
monitoring from laptop, USB, IP or phone cameras for missing PPE, **unsafe acts,
unsafe conditions and near misses** using YOLO models you train or register and
host yourself, automatic camera incidents with evidence frames, photo reports that
the AI fills in and sends by itself, voice and text hazard reporting from a phone,
and incident structuring that never invents a detail. Without a trained model the monitoring page says **AI Model Not
Configured** — it never shows simulated detections.

> PRAHARI scores *potential*, not probability, and supports the judgement of
> competent people; it does not replace it. It is not affiliated with, or endorsed
> by, any operator. The multilingual vocabularies (Hindi, Assamese, Bengali) need
> review by native-speaking safety practitioners before operational use.

---

## Contents

1. [Architecture](#1-architecture)
2. [Frontend](#2-frontend)
3. [Backend service layer](#3-backend-service-layer)
4. [Firebase architecture](#4-firebase-architecture)
5. [Firestore schema](#5-firestore-schema)
6. [Authentication and roles](#6-authentication-and-roles)
7. [Security rules and headers](#7-security-rules-and-headers)
8. [Environment variables](#8-environment-variables)
9. [Installation](#9-installation)
10. [Local development](#10-local-development)
11. [Deployment](#11-deployment)
12. [AI safety features](#12-ai-safety-features)
13. [Testing](#13-testing)
14. [Known limitations](#14-known-limitations)

---

## 1. Architecture

```
 Browser (React 18 + TS, Vite, Tailwind v4)
   │  reads ──────────────► Firestore  (rules: verified users read; no client writes
   │                                     except the caller's own profile name)
   │  uploads ────────────► Storage    (rules: own folder, JPEG/PNG/WebP/PDF ≤ 10 MB,
   │                                     only before the report is filed)
   │  writes ─────────────► Cloud Functions callables (asia-south1, Node 22)
   │                          guard() → role claim + verified email + not disabled
   │                          parse() → shared zod schema
   │                          rateLimit() → per-user, per-hour
   │                          audit() → append-only audit log
   │
   └── Firebase Auth (email/password, Google, Apple, phone + SMS code; custom claim `role`)

 Firestore trigger  scoreReport  ── the only writer of a score, anywhere
   report created (pending) → engine → assessment + tier
                            → corrective actions (Tier 1/2)
                            → daily stats + per-installation heat roll-ups
 Scheduled          cleanupOrphanAttachments (daily) — removes uploads for
                    reports that were never filed
```

**Principle: people see only their own reports unless their role says otherwise.**
HSE officers and administrators read the whole register; an installation manager
reads their installation's; everyone else reads only what they filed. The rule
lives in `firestore.rules` (`canSee()`), so it holds for any client, and every
query in the app carries the matching filter.

**Principle: browsers read, the service layer writes.** Every mutation to reports,
verdicts, actions, roles and reference data goes through a callable that
authenticates, authorises, validates against the same schema the form uses, and
writes an audit entry. The rules forbid the client from writing any of those
collections directly.

**One engine, two places.** `functions/src/shared/` (engine, schemas, constants,
search tokeniser, types) is the single source of truth. `npm run sync` copies it
into `src/shared/` for the browser's live preview and form validation. The server
result is authoritative; the browser preview is labelled as such.

### Scoring engine (v2.0.0, deterministic)

`base 2 + energy (≤30) + failed barrier (≤30, +4 for multiple failures) + exposure (≤25)
+ aggravators (+5 each, ≤10) − mitigators (−3 each, ≤9, only when energy and barrier
are both absent)`, clamped to 0–100. Tier 1 ≥ 70 (respond within 24 h), Tier 2 ≥ 40
(72 h), Tier 3 below (7 days). A breach of a life-saving rule raises the score to a
**floor** of 70 — never a multiplier. Every phrase that contributed is recorded as
an evidence span and highlighted in the UI.

---

## 2. Frontend

| | |
|---|---|
| Stack | React 18.3, TypeScript 5.9 (strict), Vite 6, Tailwind CSS v4, React Router 7 |
| UI primitives | Radix Dialog / Dropdown / Tooltip, sonner toasts, lucide icons |
| Forms | react-hook-form + zod resolvers using the shared schemas |
| Design system | tokens in `src/styles/index.css` (`@theme`): near-black surfaces, one violet brand colour (“signal”) plus lime/mint accents for charts, status colours that each mean exactly one thing, pill buttons, Plus Jakarta Sans with IBM Plex Mono and Devanagari/Bengali fallbacks |

```
src/
  auth/          AuthProvider (session, role claim, live profile), route guards
  components/
    ui/          Button, Field/Input/Select/Textarea/Checkbox, Badge, Panel,
                 Table + Pagination, Modal + ConfirmDialog, Menu, Tooltip,
                 Skeleton, EmptyState, ErrorState, Alert, Segmented, Toaster
    assessment.tsx, charts.tsx, Attachments.tsx, ActionDialogs.tsx, …
  hooks/         useAsync, useLive (onSnapshot), usePager (cursor pagination),
                 ReferenceProvider (installations/activities, one listener each)
  layouts/       AppShell (sidebar + mobile drawer), AuthLayout
  lib/           firebase init, error translation, formatting, safe redirects
  pages/         Landing, auth/*, app/*, admin/*, NotFound
  ai/            camera access, speech-to-text, inference-service client
  services/      the only code that talks to Firebase (reads, callables, storage)
  shared/        GENERATED from functions/src/shared — do not edit
```

### Routes

| Route | Access | Purpose |
|---|---|---|
| `/` | public | Product page with a live, in-browser engine demo |
| `/signin` `/signup` `/forgot-password` | signed-out | Auth screens |
| `/auth/action` | public | Handler for email verification / password reset / email recovery links |
| `/verify-email` | signed-in, unverified | Resend link; continues automatically once verified |
| `/app` | verified | Dashboard: KPIs (count aggregations), 30-day trend, tier mix, live feed, hotspots |
| `/app/reports` | verified | Register: views, word search, tier/installation filters, sort, cursor pagination |
| `/app/reports/new` | verified | File a report with attachments and a live preview |
| `/app/reports/:id` | verified | Assessment, structured incident, camera evidence, worker statements, findings, score build-up, verdict, corrective actions, attachments |
| `/app/report` | verified | Mobile-first hazard report: voice or text, photo, GPS location; `?incident=<id>` adds a statement to an existing incident |
| `/app/monitoring` | verified | Live safety monitoring: missing PPE, unsafe acts, unsafe conditions and near misses; zones, model status, automatic incidents |
| `/app/actions` | verified | Corrective actions: status views, installation filter, update |
| `/app/insights` | verified | Heat by installation × day, recurring hazard signatures, verdict mix |
| `/app/settings` | verified | Profile name, role, password reset, sign out |
| `/app/admin/users` | admin | Search, change role, assign installation, disable/enable, delete |
| `/app/admin/reference` | admin | Installations and activities CRUD |
| `/app/admin/audit` | admin | Append-only audit log with event filter |

Routes from earlier versions (`/login`, `/triage`, `/submit`, `/heat`, `/actions`,
`/admin`, `/report/:id`) redirect to their new homes.

**Performance:** every route is lazy-loaded; the Functions and Storage SDKs are
loaded on first write/upload only; Firestore uses a persistent multi-tab cache;
lists are cursor-paginated (25 per page) and KPIs use `count()` aggregation, so no
screen downloads the whole register.

---

## 3. Backend service layer

`functions/src` (TypeScript → `functions/lib`, firebase-functions 7, firebase-admin 14, Node 22):

| Function | Min. role | What it does |
|---|---|---|
| `submitReport` | reviewer | Validates, checks the installation/activity are active, **verifies every attachment in Storage** (own folder, exists, real size and type), writes the report as `pending`. Rate-limited to 30/hour per user. |
| `scoreReport` (trigger) | — | Scores, drafts CAPA, opens Tier 1/2 actions, updates `stats` and `heat`. Marks the report `failed` rather than leaving it stuck. |
| `recordVerdict` | hse-officer | Confirm / escalate / downgrade / dismiss; writes a training label; transactional. |
| `rescoreReport` | admin | Re-runs the current engine; keeps stats and heat consistent (including reports that previously failed). |
| `archiveReport` | admin | Soft delete with a reason; cancels open actions; removes it from totals and heat. |
| `createAction` | hse-officer | Manual corrective action against a report. |
| `updateAction` | installation-manager* | Status, owner, due date, note. *Managers: only at their assigned installation, only status (not cancel) and note. |
| `deleteAction` | admin | Manual actions only; engine-drafted ones can only be cancelled. |
| `setUserRole` / `setUserDisabled` / `setUserInstallation` / `deleteUser` | admin | Claim + profile together; cannot target yourself. |
| `upsertReference` / `deleteReference` | admin | Unique names; refuses to delete anything a report references. |
| `createPpeIncident` | reviewer | Files a camera incident for a confirmed PPE violation: verifies the evidence frame in Storage, then **deduplicates in a transaction** on `ppeCooldowns/{camera}__{ppe type}` — within the cooldown it returns the existing incident instead of creating another. Rate-limited to 120/hour. |
| `addStatement` | reviewer | Adds a worker's voice or text statement to an existing incident (combined incident), up to 20. |
| `cleanupOrphanAttachments` (daily) | — | Deletes uploads older than 24 h whose report was never filed. |

Shared helpers (`functions/src/lib/core.ts`): `guard()` (auth, verified email, role
claim, disabled check), `parse()` (zod → readable `invalid-argument`), `audit()`,
`rateLimit()`, `internal()` (logs details server-side, returns a generic error).

---

## 4. Firebase architecture

| Service | Use |
|---|---|
| Authentication | Email/password with verification, Google, Apple and phone-number (SMS code) sign-in, password reset; role in a custom claim |
| Firestore | Register, actions, reference data, roll-ups, audit log, labels |
| Storage | Report attachments at `attachments/{uid}/{reportId}/{file}` |
| Cloud Functions (2nd gen) | Callables, Firestore trigger, scheduled sweep — region `asia-south1` |
| Hosting | SPA with security headers (CSP, frame denial, HSTS, …) |

---

## 5. Firestore schema

| Collection | Key fields | Written by |
|---|---|---|
| `users/{uid}` | `email, displayName, role, installationId, disabled, createdAt, lastSeenAt` | the user (create at lowest role; rename only) and admin callables |
| `reports/{id}` | `text, installationId/Name, activityId/Name, shift, type, contractor, attachments[], source (text/voice/camera), geo, status (pending/scored/failed), reportedBy (uid only), archived, verdictDecision, createdAt` + assessment: `score, tier, energy[], barrier[], exposure[], evidence[], contributions[], rulesTriggered[], capa[], structured{…}, searchTokens[], verdict{…}` + camera incidents: `camera{…}, ppe{violations, workers, model, settings, evidence}` + `statements[]` | `submitReport`, `createPpeIncident`, `addStatement`, `scoreReport`, `recordVerdict`, `rescoreReport`, `archiveReport` |
| `actions/{id}` | `reportId, reportedBy (the report's author, for visibility), installationId/Name, tier, order, control, rationale, owner, dueAt, status, source (engine/manual), note, closedAt/By` | trigger + action callables |
| `installations/{id}`, `activities/{id}` | `name, code, region, active, createdAt, updatedAt` | reference callables |
| `stats/{YYYY-MM-DD}` | `day, total, t1, t2, t3` | trigger (increments) |
| `heat/{installationId__day}` | `installationId, installationName, day, peak, count` | trigger / recompute |
| `labels/{id}` | narrative + prediction + human verdict (supervised training set) | `recordVerdict` |
| `auditLogs/{id}` | `action, actorUid, actorName, target, detail, at` | every callable |
| `rateLimits/{uid__bucket}` | fixed-window counters | callables (never readable) |
| `ppeCooldowns/{cameraId__ppeType}` | `reportId, until` — incident cooldown per camera and PPE type | `createPpeIncident` (never readable) |

**Relationships:** reports → installations/activities by id (names denormalised for
display); actions → reports by `reportId`; `reportedBy` → users by uid.
**Indexes:** 30 composite indexes in `firestore.indexes.json`, generated by
`npm run indexes` from the exact filter/sort matrix the UI issues; large text and
array-of-map fields are exempted from indexing.
**Search:** Firestore has no full-text search; `searchTokens` (unicode-aware, so
Hindi/Assamese/Bengali words work) supports whole-word `array-contains` search.

---

## 6. Authentication and roles

1. **Sign up** → account created → profile document created at role `reviewer` →
   verification email sent → parked on `/verify-email` (checks automatically).
2. **Verify** via the emailed link (handled by `/auth/action`) → token refreshed →
   console unlocked. Unverified accounts can read nothing and call nothing.
3. **Sign in** → session persisted in IndexedDB; `?next=` return path is sanitised
   against open redirects. **Google**, **Apple** and **phone number** (a one-time
   SMS code; ten digits are taken as an Indian `+91` number) sign in and sign up in
   one step. The provider has already proved the address or number, so these
   accounts count as verified in the client, the rules and `guard()`
   (`TRUSTED_SIGN_IN_PROVIDERS`). A phone account has no email; its profile
   stores an empty one and Settings shows the number instead.
4. **Forgot password** → reset link → `/auth/action` → new password (the page never
   reveals whether an address has an account).
5. **Role changes** apply immediately in the rules and callables via the custom
   claim; the person's open session is ended so their next sign-in carries the new
   role. Disabling an account signs it out everywhere.

| Capability | Reviewer | Installation manager | HSE officer | Admin |
|---|:-:|:-:|:-:|:-:|
| Read the reports they filed, and their actions | ✓ | ✓ | ✓ | ✓ |
| Read their installation's reports and actions | | ✓ | ✓ | ✓ |
| Read every report, site-wide totals and the heat map | | | ✓ | ✓ |
| File reports with attachments | ✓ | ✓ | ✓ | ✓ |
| Update actions (status/note) at own installation | | ✓ | ✓ | ✓ |
| Record verdicts; create, reassign, reschedule, cancel actions | | | ✓ | ✓ |
| Re-score, archive, delete manual actions | | | | ✓ |
| Users, roles, reference data, audit log, training labels | | | | ✓ |

---

## 7. Security rules and headers

- **`firestore.rules`** — a verified user reads a report (and its corrective
  actions) only if they filed it, or they manage that installation, or they are
  an HSE officer or administrator; site-wide daily totals and the heat map are
  officer-only. Reference data stays shared. All writes are denied except a
  user creating their own profile in an exact shape (role `reviewer`, not disabled,
  server timestamps, email matching the token — empty for a phone account) and later changing only
  `displayName`/`lastSeenAt`. Labels and the audit log are admin-read-only; rate
  limits are unreadable. Default deny.
- **`storage.rules`** — an attachment is readable by the same people as its
  report (author, that installation's manager, officers, administrators). Upload
  only into `attachments/{your uid}/{reportId}/`, only
  JPEG/PNG/WebP/PDF, 1 byte–10 MB, only while that report does not exist yet
  (cross-service check); owners may delete their own draft uploads; filed evidence
  is immutable. Default deny.
- **Callables** re-check everything the rules check, plus role, scope, rate and
  attachment integrity.
- **Hosting headers** (`firebase.json`, and the same set in `vercel.json`): Content-Security-Policy (no inline scripts;
  Firebase/Google origins only, plus reCAPTCHA for phone sign-in), `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
  HSTS, `nosniff`, Referrer-Policy, Permissions-Policy (camera, microphone and
  geolocation for this origin only), COOP. `npm run preview`
  serves the same headers, so the production build is tested with CSP enforced.
- **No secrets in the client.** Only public web-app identifiers are bundled; admin
  credentials are used only by local scripts via Application Default Credentials.

---

## 8. Environment variables

`.env` (copy from `.env.example`):

| Variable | Meaning |
|---|---|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Public web-app config from the Firebase console |
| `VITE_FUNCTIONS_REGION` | Must equal `FUNCTIONS_REGION` (`asia-south1`) |
| `VITE_USE_EMULATORS` | `true` to use the local emulator suite |
| `VITE_PPE_INFERENCE_URL` | Base URL of the PPE inference service (e.g. `http://127.0.0.1:8765`). Empty → monitoring shows *AI Model Not Configured*. In production also add it to `connect-src` in the CSP in `firebase.json` |
| `VITE_PPE_INFERENCE_TOKEN` | Optional shared secret; must match `PPE_TOKEN` on the service |

For the Vercel build (`npm run build:vercel`) the same variables go in `.env.vercel`
(git-ignored), with `VITE_USE_EMULATORS=false`.

Functions: `BOOTSTRAP_ADMIN_EMAIL` in `functions/.env.<project-id>` is the one
address allowed to claim the first administrator role (see [§11](#11-deployment));
the emulator's `functions/.env.local` leaves it empty, so nobody can claim there.

The inference service's own variables are listed in [§12](#12-ai-safety-features).

Test-only: `PLAYWRIGHT_CHANNEL=chrome` (use installed Chrome), `PREVIEW=1` (run E2E
against the production build).

---

## 9. Installation

Requirements: Node 22+, Java 21+ (for the Firestore/Storage emulators).

```bash
npm install
npm --prefix functions install
```

---

## 10. Local development

Everything runs locally against the Firebase emulators (project `demo-prahari`,
which can never reach a real project).

**Windows, one click:** double-click **`start-local.bat`**. On first run it
installs packages and creates `.env`; then it opens two windows — *PRAHARI
backend* (emulators) and *PRAHARI website* (dev server) — plus *PRAHARI AI
inference* when the model environment from [`ai/README.md`](ai/README.md) exists,
loads the demo data if the database is empty, and opens http://127.0.0.1:5173 in
your browser. Keep the windows open while you use the app; close them to stop it. If the page says
"refused to connect", the website window is not running — run the launcher again.

Or manually:

```bash
cp .env.example .env          # then switch to the emulator values at the bottom
npm run emulators             # terminal 1 — Auth, Firestore, Functions, Storage, Eventarc
npm run seed                  # once — reference data, 4 accounts, 30 days of history
npm run dev                   # terminal 2 — http://127.0.0.1:5173
```

On Windows, if Functions discovery times out, start the emulators with
`FUNCTIONS_DISCOVERY_TIMEOUT=90`. Emulator UI: http://127.0.0.1:4000.

Seeded accounts (emulator only), password `Prahari-demo-1`:
`admin@`, `officer@`, `manager@`, `reviewer@prahari.test`. In the emulator no email is
sent: verification and reset links are printed in the emulators' terminal output.

The seed writes narratives only; every score is produced by the real trigger, and
verdicts/action updates go through the real callables. Installation and people
names are generic.

---

## 11. Deployment

1. Create a Firebase project on the **Blaze** plan (2nd-gen functions and the
   scheduler require it).
2. Enable **Authentication** → Email/Password, Google, Apple and Phone. Add every
   domain the site is served from (e.g. `<name>.vercel.app`) to *Settings →
   Authorized domains* — otherwise Google/Apple pop-ups fail with "This domain is
   not authorised". Apple also needs a Services ID, key and the Firebase
   callback URL registered in your Apple Developer account. Under *Templates*, set
   the action URL to `https://<your-domain>/auth/action`.
3. Create **Firestore** (Native mode; `asia-south1` recommended) and **Storage**.
4. `npx firebase use --add <project-id>`; put the project's web config in `.env`
   with `VITE_USE_EMULATORS=false`.
5. Build and deploy:
   ```bash
   npm run build
   npx firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting
   ```
   **Or host the website on Vercel** (the backend still deploys to Firebase):
   put the web config in `.env.vercel`, then
   ```bash
   npx firebase deploy --only firestore:rules,firestore:indexes,storage,functions --project <project-id>
   npm run build:vercel          # → deploy/prahari, with vercel.json headers
   npx vercel deploy deploy/prahari --prod
   ```
6. Make the first administrator. Put your address in `functions/.env.<project-id>`
   as `BOOTSTRAP_ADMIN_EMAIL=…` before deploying functions, sign up with that
   address, open `/app/settings?setup=admin` and press *Become the first
   administrator*. It works once, and only while no administrator exists.
   Alternatively, with your own Google credentials:
   ```bash
   gcloud auth application-default login
   node scripts/grant-admin.mjs --project <project-id> <your-email>
   ```
7. As that admin, add installations and activities under *Reference data*.

**The PPE/hazard inference service**, for the hosted site, runs as a Hugging Face
Space (Docker, CPU) so any device — phones included — can use the models. The
Space definition is in [`ai/space/`](ai/space/README.md):
```bash
python ai/space/stage.py                       # server + weights + metrics → E:/prahari-ml/space-build
hf auth login                                  # once, with a Write token
hf upload <user>/prahari-ai E:/prahari-ml/space-build . --repo-type space
```
Then set `VITE_PPE_INFERENCE_URL=https://<user>-prahari-ai.hf.space` (in
`.env.vercel` and the Vercel project's environment) and add the site's origin to
`PPE_ALLOWED_ORIGINS` in `ai/space/Dockerfile`. `https://*.hf.space` is already in
the CSP. A free Space sleeps after 48 h without use; the first request wakes it
(1–2 minutes) and the monitoring page picks it up by itself.

The service can also stay on your own computer: a hosted HTTPS page may call
`http://127.0.0.1:8765` (it is in the CSP, and the service answers Chrome's
private-network preflight) — but only on that computer. Double-click
**`start-ai.bat`** to start just the AI service for the hosted site (Chrome may ask
once to let the site reach devices on the local network — allow it);
`start-local.bat` also allows `https://prahari-silk.vercel.app`.

If you use a custom `authDomain`, add it to `frame-src` in the CSP in `firebase.json`.

---

## 12. AI safety features

### Live safety monitoring (`/app/monitoring`)

```
 camera ──► browser frame grab ──► inference service (YOLO) ──► raw detections
                                                                    │
   functions/src/shared/ppe.ts (same code in browser and tests)  ◄──┘
     worker detection  → persons ≥ min confidence, tracked across frames (IoU tracker)
     PPE association   → helmet/vest/… box must overlap the body region it is worn on
     rule engine       → required PPE missing for ≥ N frames AND ≥ T seconds
     violation         → evidence frame uploaded to Storage
                       → createPpeIncident (server dedup + cooldown) → incident in Firestore
                       → scoreReport trigger scores and structures it like any report
```

- **Cameras:** laptop webcam, USB cameras (pick the device), a phone's rear or
  front camera (open the site on the phone), or an **IP camera** stream URL (MJPEG,
  MP4 or WebM over http(s); RTSP cameras need a gateway such as MediaMTX or go2rtc,
  and the stream server must allow this site via CORS). Browsers only allow camera
  and microphone access on `https://` or `localhost` — to use a phone on your LAN,
  serve the site over HTTPS (or deploy it).
- **Starts by itself.** When the page opens, the camera and detection start with
  no clicks: the camera name comes from the device, the installation is the
  person's assigned site (else the first active one), the default camera is used
  and helmet + vest are required. It reconnects if the camera is unplugged, picks
  up a camera plugged in later, and switches detection on when the AI service
  starts later. Everything stays editable; **Stop** is respected until **Start**
  is pressed, and *Start automatically* can be switched off. (The browser still
  asks for camera permission the first time — no site can skip that.)
- Permission errors in plain language (denied, no camera, camera busy), live
  status (FPS, inference time, workers in view) and a per-worker compliance list.
- **“No helmet” is never an object.** The model detects people and the PPE they
  wear; *missing* is decided by the rule engine from the PPE required at that
  camera. The dataset's `no_helmet`-style classes are dropped at preparation time.
- **Settings** (saved in the monitoring browser): minimum confidence (default
  **0.60**), confirmation frames (**10**), violation duration (**2 s**), incident
  cooldown (**300 s**), and which PPE is required at this camera. PPE the loaded
  model cannot detect is marked *Not in this model* and cannot be required, so it
  is never assumed missing.
- **No duplicate incidents:** the browser reports each continuing violation once,
  and `createPpeIncident` enforces the cooldown per camera and PPE type in a
  Firestore transaction, returning the existing incident instead of a new one.
- **Honest status:** if `VITE_PPE_INFERENCE_URL` is empty, the service is
  unreachable, or it has no evaluated model, the page shows **AI Model Not
  Configured** (with the reason) and the camera runs with detection off. Nothing
  is simulated.

### Unsafe acts, unsafe conditions and near misses

The same camera loop also runs hazard rules (`functions/src/shared/hazards.ts`)
on what general-purpose models see. Each confirmed hazard becomes a report **of
its type**, with the frame as evidence, through `createHazardIncident` (same
Storage check, same transactional cooldown per camera and hazard — per zone for
zone rules).

| Rule | Report type | What must be seen | Confirmed after |
|---|---|---|---|
| Person in a restricted zone | Unsafe act | a person's feet inside a *restricted* zone drawn on the view | 4 frames and 2 s |
| Mobile phone in use (off by default) | Unsafe act | a phone at a person's hand or face | 4 frames and 3 s |
| Missing PPE | Unsafe act | as above | as above |
| Person close to a moving vehicle | Near miss | a person on the same ground line as a car/truck/bus/forklift, within ~1 m, while the vehicle moves | 2 frames and 0.5 s |
| Person on the ground (possible fall) | Near miss | torso more than 55° from vertical (pose keypoints; body shape if no pose model) | 4 frames and 3 s |
| Fire / smoke | Unsafe condition | fire or smoke from the fire model | 3 frames and 1 s / 4 frames and 3 s |
| Keep-clear area obstructed | Unsafe condition | an object (chair, bag, box, vehicle, …) standing inside a *keep-clear* zone | 4 frames and 10 s |

- **Zones** are drawn by clicking corners on the live view (restricted, or keep
  clear for walkways and exits) and saved with the camera's settings.
- Rules the loaded models cannot see are marked *Not in these models*; zone rules
  wait for a zone. Nothing is assumed.
- **Models** (all served by the same inference service, each only with evaluation
  metrics): `general-coco` — COCO-pretrained YOLOv8n (people, vehicles, phones,
  objects; Ultralytics publishes 0.373 mAP50-95 on COCO; on our held-out
  construction-site test photos it finds people with precision 0.82 and recall
  0.77 at confidence 0.5); `pose-coco` — YOLOv8n-pose (17 body keypoints;
  published 0.504 pose mAP50-95; people on site photos: precision 0.82, recall
  0.78); `fire-v1` — trained here on the public-domain D-Fire dataset
  (held-out test: precision 0.68, recall 0.63, mAP50 0.68).

### Photo reports (`/app/report` → *Photo report*)

A worker takes a photo; every loaded model checks it and the hazard rules decide
what it shows — fire or smoke, a person down, a person within reach of a vehicle,
a worker without a helmet or vest, phone use (most serious first). The report is
filled in from that alone (type, a factual description with confidences, site,
GPS) and **sent automatically after a 5-second countdown** that the worker can
cancel or edit. It is stored with source *Worker photo (AI check)* and the list of
findings and models. If the service is unavailable or finds nothing it
recognises, the worker is told and writes the report themselves — nothing is
guessed.

### Reporting by voice or text (`/app/report`)

A mobile-first page for workers: **Voice** (browser speech-to-text in English
(India), Hindi, Bengali or Assamese where the browser supports it — the transcript
is always shown for review and editing), **Text**, **Add photo** (opens the phone
camera), **Location** (GPS, only when the person taps it) and **Submit**. Browsers
without speech recognition fall back to typing. Voice and text reports go through
the same `submitReport` pipeline, scoring and audit as the full form. Opened with
`?incident=<id>`, the page adds the worker's statement to an existing incident.

### Incident structuring

Every report gets a `structured` record — title, description, hazard type,
location, severity, potential consequence, recommended action, source and
timestamp — built by a deterministic, rule-based structurer
(`functions/src/shared/structure.ts`) on the server when the report is scored,
and previewed live in the browser. It only extracts what the text says: anything
not stated is **“Not specified”**, never guessed. The original report is kept
verbatim alongside it.

### Combined incidents

A camera incident holds the evidence frame, the model's detections and the
compliance state of every worker in view (or, for a hazard, what was seen, the
zone and the models); workers can then add **voice or text
statements** to the same incident (`addStatement`). The incident page shows each
source separately — *Camera AI detection*, *Worker voice report*, *Worker text
report*.

### The model

`ai/` holds the complete, replaceable model pipeline — see
[`ai/README.md`](ai/README.md): dataset download and conversion (YOLO annotation
format), training, validation, test-set evaluation (precision, recall, mAP50,
mAP50-95 per class), ONNX export, and the inference service. Heavy files
(datasets, runs, weights, exports) live in a work folder outside the repository (default
`E:/prahari-ml`, set `PRAHARI_ML_DIR` to change it). The model trained with this
recipe (`ppe-v1`, YOLOv8n) scores **precision 0.88, recall 0.78, mAP50 0.83** on
the held-out test split; per-class results are in `ai/README.md`, with the
hazard models' results.

The inference service (`ai/inference_service/server.py`) is a small HTTP API that
can run on the same laptop, a GPU server, a cloud VM or an edge device — the web
app only needs its URL:

| Variable | Meaning |
|---|---|
| `PPE_WEIGHTS` | Trained weights (`.pt` from a run, or an exported `.onnx` with its `manifest.json`) |
| `GENERAL_WEIGHTS`, `POSE_WEIGHTS`, `FIRE_WEIGHTS` | The hazard models (defaults under `E:/prahari-ml`); an empty value switches one off |
| `PPE_DEVICE` | `auto` (default), `cpu`, or a GPU index such as `0` |
| `PPE_HOST`, `PPE_PORT` | Bind address, default `127.0.0.1:8765` |
| `PPE_ALLOWED_ORIGINS` | Comma-separated site origins allowed to call it (CORS) |
| `PPE_TOKEN` | Optional shared secret (`Authorization: Bearer …`); set the same value as `VITE_PPE_INFERENCE_TOKEN` |
| `PPE_ALLOW_UNEVALUATED` | `1` to serve weights with no test metrics (development only) |

The service refuses to serve weights that were never evaluated, so a checkpoint
from an interrupted training run cannot go live by accident. `start-local.bat`
starts it automatically when `E:\prahari-ml\venv` exists.

---

## 13. Testing

All suites run against the live emulators — no mocks.

| Command | What it proves |
|---|---|
| `npm run typecheck` | Strict TypeScript across app, tests and tooling |
| `npm run test:engine` | 14 fixtures land on the expected tier (incl. Hindi and Assamese) |
| `npm run test:ppe` | 22 checks of the PPE rule engine: YOLO decoding, letterbox, NMS, PPE-to-worker association, tracking, multi-frame/duration confirmation, cooldown, and incident structuring (“Not specified”, no invented details) |
| `npm run test:rules` | 112 adversarial checks with real tokens: Firestore rules, Storage rules, who may read which report/action/attachment (own, installation, whole register, list queries), phone and Apple accounts (verified, own-only, no email in a phone profile), the one-time first-admin claim, callable authorisation and scoping, camera PPE and hazard incidents (types, zones, forged keys, deduplication), photo reports and statements |
| `npm run test:cleanup` | The orphan-attachment sweep deletes only what it should |
| `npm run test:e2e` | 49 Playwright tests (4 of them opt-in, with the real models): auth flows (sign-up → verify → sign-in, reset, bad links, open redirect; Google/Apple/phone offered; phone sign-in with an SMS code from the Auth emulator, wrong code refused), full report lifecycle with upload, register search/filters/pagination, verdicts and actions, admin users/reference/audit, role guards, report visibility (a reviewer sees only their own; a manager only their installation's), dashboard, voice/text reporting with GPS and structuring, speech fallback, camera start/stop with a real (fake-device) stream (and starting by itself once a refused camera permission is allowed) and honest *AI Model Not Configured* status, combined camera + statement incidents, and layout at 375 / 768 / 1280 / 1440 / 1920 px with no horizontal page scroll; any console error fails a test |
| `PREVIEW=1 npm run test:e2e` | The same suite against the production build with the CSP enforced |
| `npm test` | engine + PPE + hazards + rules + cleanup + E2E |
| `PPE_FAKE_CAMERA=<file.mjpeg> npx playwright test monitoring-model` | Opt-in, with the inference service running: Chrome's fake camera plays held-out test photos (made by `python ai/ppe/make_test_video.py`); a worker without a helmet must produce exactly **one** automatic incident with its evidence frame, and the repeat must be suppressed by the cooldown |
| `npm run test:hazards` | 30 checks of the hazard rules: zones, posture, vehicle motion and proximity, obstruction, phone use, fire, confirmation, cooldown, photo analysis, narratives and structuring |
| `PPE_HAZARD_CAMERA=… PPE_FIRE_PHOTO=… npx playwright test hazards-model` | Opt-in, with the inference service running: the camera files a restricted-zone unsafe act and a fire-or-smoke unsafe condition by itself from held-out test images; a fire-scene photo is checked, filled in and sent automatically; Cancel stops the send (media from `python ai/hazards/make_hazard_media.py`) |
| `python ai/ppe/evaluate.py` | Model precision / recall / mAP on the held-out test split (see [`ai/README.md`](ai/README.md)) |

---

## 14. Known limitations

- **Search** matches whole words (Firestore `array-contains`), not substrings or
  fuzzy matches; while searching, results are newest-first.
- **Engine vocabulary gaps.** It is a transparent rule-based scorer, not a language
  model. Example: “had no toe boards” is not recognised as a failed barrier while
  “missing toe boards” is. The Indic vocabularies need native-speaker review.
- **Role and disable changes** reach Firestore rules within the lifetime of the
  person's current ID token (≤ 1 hour) — the standard Firebase model; callables
  check the disabled flag immediately.
- **Attachment links** use Storage download URLs, which anyone holding the URL can
  open; they are only ever shown to verified users.
- **Scheduled sweep** does not run in the emulator (no Pub/Sub emulator configured);
  its logic is covered by `npm run test:cleanup`.
- **PPE model scope.** The shipped training recipe uses a public construction-site
  dataset (1,132 training images). How well it works on your cameras depends on
  angle, distance and lighting — label some of your own footage and retrain
  before relying on it (see `ai/README.md`). It has no harness class yet.
- **Monitoring runs in a browser tab**: one camera per tab, and detection pauses
  if the tab or computer sleeps. A 24/7 deployment should keep that machine awake
  or move frame capture to a server next to the cameras.
- **Speech-to-text is the browser's.** Chrome and Edge send the audio to their
  vendor's speech service; Firefox has none (the page falls back to typing).
- **Incident structuring is rule-based**, not a language model: hazards and
  locations it has no pattern for come out as “Not specified” rather than a guess.
- **Corrective actions created before report visibility was introduced** have no
  `reportedBy` field, so their reporter cannot see them. Run
  `node scripts/backfill-action-reporters.mjs --project <id>` once (it copies the
  author from each action's report). A deployed database also needs the new
  composite indexes: `npm run indexes`, then deploy `firestore:indexes`.
- **Hazard rules read a flat picture.** "Within ~1 m of a vehicle" and "same
  ground line" are judged in the image, not in 3-D, so camera angle matters; a
  person bending over can look like a fall to the body-shape fallback (the pose
  model is much better); orange lights can look like fire to `fire-v1`, which was
  trained mostly on outdoor and web photos; phones are small and found mainly at
  close range. Validate each rule on your own cameras and keep the confirmation
  times; the evidence frame lets an officer dismiss a false alarm in seconds.
- **Licensing:** the PPE dataset and Ultralytics YOLO are AGPL-3.0 (see
  `ai/README.md`).
- **Dev tooling advisories:** `npm audit` reports moderate advisories inside the
  `firebase-tools` CLI's dependency tree (no fixed release yet). The shipped web app
  and Cloud Functions report **0** vulnerabilities.
