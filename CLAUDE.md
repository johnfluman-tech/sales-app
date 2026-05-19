"At the end of every session, update this file with new files created, functions added, bugs fixed, and any new rules learned."

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A single-file SPA sales intelligence dashboard for Intransit Technologies. The entire frontend is `intransit_app.html` (~11,800 lines of vanilla JS/HTML/CSS — no build step, no frameworks). A Python backend script (`C:\scripts\sales_report.py` on INTRANSIT-RDS02) aggregates SQL Server data and writes to Google Sheets and Supabase.

Live: https://johnfluman-tech.github.io/sales-app/intransit_app.html

## Deploy

Always edit the working copy at `C:\Users\fluma\intransit_app.html`, then deploy:

```powershell
cd C:\Users\fluma\sales-app
copy C:\Users\fluma\intransit_app.html .
git add intransit_app.html && git commit -m "msg" && git push
```

**Never use PowerShell `Set-Content` on HTML** — it silently corrupts UTF-8. Use Python binary mode (`rb`/`wb`) for any programmatic file edits.

## Architecture

### Data Flow
```
Google Sign-In (GIS OAuth) → localStorage (it_token, it_anthro_key, it_sb_key)
  → Google Sheets API (primary data source, 3 spreadsheets)
  → Cloudflare Worker (intransit-worker.intransit-sales.workers.dev)
  → SQL Server CCCRM on INTRANSIT-RDS02
  → Python sales_report.py (scheduled aggregation → Sheets + Supabase)
```

### Google Sheets (3 spreadsheets)
| ID | Purpose |
|----|---------|
| `1xH_OC_fvSwQWZet95xBlJ951LsaQWru-glv2rkSnDm4` | Main (per-rep tabs, MASTER, _LOG, _COLLECTIONS, _CONTACTS, _OPEN_ORDERS, _CONTACT_NOTES) — **AT 10M CELL LIMIT** |
| `192ELLBgiEUZ3z6ytkWXbmA24wS2BjHmclJdf_UF_c24` | History (_GP 22K rows, _INVOICE_HISTORY, _SIGNATURES, _ATTACK_PLAN, _NDA_LOG, _CONTACT_NOTES, _SUGGESTIONS) |
| `12dJ0eLFQse-_pi1k6rXc25yTkwwYTjMm32v11tGKeRo` | Activity (_REQS ~21K, _QUOTES ~17K) |

**All new tabs go in the History sheet** — Main is full.

### _CONTACT_NOTES Sheet (CRITICAL — in History, not Main)
- Lives in `CONFIG.HISTORY_SPREADSHEET_ID` — NOT the Main sheet
- Columns: `ACCOUNT_NAME, CONTACT_NAME, TYPE, NOTE, DATE, REP` (header in row 1)
- All reads must use `sheetsGetFrom(CONFIG.HISTORY_SPREADSHEET_ID, "'_CONTACT_NOTES'!A1:Z2000")`
- All writes must pass `CONFIG.HISTORY_SPREADSHEET_ID` as 3rd arg to `sheetsAppend` / `sheetsUpdate`
- `state.contactNotesCache` must always be an **array** (not dict): `[['ACCOUNT_NAME',...], [row], ...]`
- Startup loader (inside `loadSupplementalData`) populates `state.contactNotesCache` from this sheet
- Functions that save and update cache: `saveContactNote`, `saveCollectionsNote`, `iqSaveLog`, `saveContactNoteFromView`

### Key App State & Cache Pattern
- `ensureCacheLoaded()` is the entry point for data — never call `loadSupplementalData()` directly
- `state.cacheLoaded` does NOT mean `state.accounts` is populated — they're separate flags
- Guard all cache object writes: `if(!state.collectionsCache) state.collectionsCache={}`
- `contactRevenueCache` is built from `gpCache` BUYER_NAME field after cache loads
- Buyer revenue source: `_GP` tab → `BUYER_NAME` column (from `ORDERHEA.ORDERED_BY`)

### Views
My Accounts, Daily Mission (100 AI picks), Dashboard, Collections (138 accts / ~$342K AR), Contacts (7,898), Attack Plan (kanban), Requests (admin), Access Log, Settings, Academy (🎓), Suggestions Board (💡 admin only), Notes Feed (📋 admin/manager/rep), Team Notes (📋 manager only), Team Profile (🏢 manager only)

### Notes Feed (`_renderNotesFeed`)
- **Sources loaded:**
  1. `acc.repNote` / `acc.note` from `state.accounts` → type `RepNote`
  2. Accounts with `followUpDate` but no repNote → type `FollowUp` (purple)
  3. `_CONTACT_NOTES` sheet (via cache or `sheetsGetFrom` HISTORY) → types: `ContactNote`, `CollectionsNote`, `Outcome`, `ManagerNote`
- **Access control:**
  - Admin (not simulating): sees all
  - Admin simulating manager (`state.viewingAsManager = true`): sees team notes
  - Real manager: sees own + team notes (uses `getManagerConfig().teamReps`)
  - `isActuallyTeamView = isTeamView` — personal Notes Feed always uses full admin access; Team Notes (`isTeamView=true`) scopes to team
- **Type colors:** RepNote=#3b82f6, ContactNote=#14b8a6, ManagerNote=#f59e0b, CollectionsNote=#ef4444, Outcome=#22c55e, FollowUp=#8b5cf6
- **Filter buttons:** ALL, REP, CONTACT, MGR, COLL, OUTCOME, FOLLOW-UP
- Called as `_renderNotesFeed(false)` for personal, `_renderNotesFeed(true)` for team view

### Task 7b — Notes Feed, Collections, Attack Plan (v1.50)
- **Notes Feed**: Two-panel layout (60% list, 40% AI panel); auto-analysis with `callAI`; quick-prompt buttons per role; `_nfLinkifyAccounts()` makes AI responses link account names
- **Collections notes**: `saveCollectionsNote` saves to `_CONTACT_NOTES` in History sheet via `sheetsAppend(..., CONFIG.HISTORY_SPREADSHEET_ID)`; updates `state.contactNotesCache` array
- **Attack Plan auto-save**: `apkAutoSave()` saves to `localStorage` immediately + schedules `saveAttackPlan` after 4s debounce; called from `apkMove` on every card move
- **Pool hide**: `apkHideAccount(name)` / `apkUnhideAccount(name)` persist to `localStorage` key `it_pool_hidden_[repId]`; `_apkUpdateHiddenBtn()` updates badge count
- **APP_VERSION** = `'1.50'`; `CHANGELOG` array; `showChangelog()` popover on version badge click

### Manager System (Task 6)
- `MANAGER_CONFIG` constant defines three manager roles: `CKaren` (personal rep + manager), `CMancilla` and `MPerezfreye` (manager-only, no personal accounts, resolved via `sharedWith` email array)
- All three managers share the same `teamReps`: `['PIan','RMauricio','LMancera','bcastor']`
- `getManagerRole(repId, email)` — resolves manager role at login by repId or sharedWith email match
- `getManagerConfig()` — returns `MANAGER_CONFIG[state.managerRole]` or null
- `state.managerRole` set at login via `getManagerRole()`; `isManager()` now checks `state.managerRole` too
- `__TEAM_ALL__` is the team-wide view value; all Manager View dropdown options now set `state.viewAsRep = '__TEAM_ALL__'`
- Admin dropdown has **no "Team Views" section** — Manager Views replaced it; `__MGR_X` sets `state.viewAsRep='__TEAM_ALL__'` + `state.managerRole=X` + `state.viewingAsManager=true`
- Manager dropdown shows "My Accounts" option only when `mgrMid === state.repId`

### Dashboard Team View (`refreshDashboard`)
- `repFilter = state.isAdmin ? (state.viewAsRep || null) : state.repId`
- When `repFilter === '__TEAM_ALL__'`: resolves `_teamRepsFilter` via `getManagerConfig().teamReps`
- `repMatchesFn` handles both single-rep and team filter for `accs`, `gpFiltered`, `ordersFiltered`, `reqsFiltered`

### Suggestions Board (`_SUGGESTIONS` in History sheet)
- **Admin/FJohn only** — `renderSuggestionsBoard` starts with `if (!isAdmin()) { switchView('accounts'); return; }`
- Nav item (`nav-suggestions-board`) hidden in `switchViewAs` whenever `state.viewAsRep` is set (any simulated view)
- Reads/writes all use `CONFIG.HISTORY_SPREADSHEET_ID`
- Sheet may not have a header row — `renderSuggestionsBoard` detects this and prepends synthetic headers
- `_rowOffset`: 1 when no sheet headers, 2 when headers present — used for `rowIdx` in `sheetsUpdate` calls
- `suggUpdateStatus` and `suggSaveReply` fall back to positional column indices (status=5, admin_response=6) when header lookup fails

### Note Stamps
- `getNoteStamp()` — returns `"repId · May 18, 2026"` format for prepending to notes
- `formatNoteStamp(repId, dateStr, isMgr)` — renders HTML stamp (gold for manager notes)

### Academy (Tasks 5B + 7b)
- XP system stored in `localStorage` as `it_academy_progress` (`{completedLessons, xp, quizAnswers, _firstTryBonus}`)
- 8 tracks, lesson content in `academyGetLessonContent(lessonId, progress)`
- `ACADEMY_LEVELS` constant maps XP thresholds to level names
- `TRACK_COLORS` constant maps track IDs to hex colors for tree dots
- Badge updated via `academyUpdateBadge()` called after login
- `acadVideoPlaceholder(lessonId)` — shows video embed or "coming soon" panel; URLs stored in `localStorage.it_academy_videos`
- `acadKeyTakeaway(text, tryItText, tryItView)` — green bordered takeaway block with optional "Try it now" link
- `acadLessonWrap` — now includes breadcrumb (`Track N — Title › N. Lesson`) + prev/next arrows at bottom
- `acadAnswerQuiz` — allows one retry on first wrong answer before locking; first-try correct = +25 XP bonus
- Lesson content defined for: t1-1, t1-2, t1-3, t1-4, t2-1, t2-2, t2-3, t2-4, t2-5, t2-6, t2-7, t3-2, t3-4, t7-1 through t7-5

## Critical Rules

### Auth
- **Never add `apis.google.com/js/api.js`** — breaks auth loop
- Auth prompt must be `''` (empty string) — never `'select_account'`
- `john.fluman@intransittech.com` → `repId='ADMIN'` in app, not `'FJohn'`
- Security: `@intransittech.com` domain only, 30-min timeout, rep isolation

### Database / SQL
- Rep attribution: always use `dbo.ORDERHEA.USERNAME` — **not** `CUSTOMER.USERNAME`
- GP: use `INVCHEA.GP` — **not** `INVCDTL.GP` (sparsely populated)
- `_GP` tab `EXTENDED_PRICE` = shipped revenue (aliased from SQL `INVOICE_TOTAL`)
- `INVCHEA` has **no EMAIL column** — track buyer via `ORDERHEA.ORDERED_BY`
- Do not use: `SHIP_ACCT`, `RECNUM`, `INVOICED_BY`, `CUSTOMER.AVERAGE_PAY`
- Collections balance: `INVCHEA.BALANCE` is authoritative (not `CUSTBAL`)

### JavaScript
- Never nest backtick template literals
- In Python scripts: apostrophes inside JS single-quoted strings need `\\'` in triple-quoted Python strings to produce `\'` in JS output (e.g. `"won\\'t"` → `"won\'t"` in file → `won't` in browser)
- Use `data-n` / `data-lid` / `data-view` attributes + `this.dataset.X` in onclick handlers to avoid quote-escaping issues in dynamically built HTML

### Google Sheets Spreadsheet Routing
- **Main sheet** (`CONFIG.SPREADSHEET_ID`): per-rep account tabs, MASTER, _LOG, _COLLECTIONS, _CONTACTS, _OPEN_ORDERS — **DO NOT add new data here, it is full**
- **History sheet** (`CONFIG.HISTORY_SPREADSHEET_ID`): _GP, _INVOICE_HISTORY, _SIGNATURES, _ATTACK_PLAN, _NDA_LOG, _CONTACT_NOTES, _SUGGESTIONS — all new persistent data goes here
- **Activity sheet** (`CONFIG.ACTIVITY_SPREADSHEET_ID` or 3rd ID): _REQS, _QUOTES
- `sheetsGet(range)` → Main sheet only; `sheetsGetFrom(id, range)` → any sheet; `sheetsAppend(range, rows, id?)` → optional 3rd arg for non-Main sheets; `sheetsUpdate(range, values, id?)` → same; `sheetsUpdateIn(id, range, values)` → explicit non-Main update

### Secrets
- `SUPABASE_SECRET` never in app code or GitHub — server only (`C:\scripts\supabase_config.py`)
- Supabase publishable key lives in `localStorage` as `it_sb_key`

## Sales Reps (usernames are case-sensitive)
`CKaren`, `BillP`, `PIan`, `RMauricio`, `LMancera`, `bcastor`, `FJohn` (admin = john.fluman), `Anolan`

Manager-only users (no personal rep accounts): `CMancilla` (carlos.mancilla@intransittech.com), `MPerezfreye` (manuel.perezfreyre@intransittech.com)

## Pending / Known Issues
- Dashboard loads slowly (30s+) — Supabase migration not yet complete (app still reads Sheets)
- `sales_report.py` needs to be scheduled on INTRANSIT-RDS02 via Windows Task Scheduler — target: every 30 minutes, silent background run, log to `C:\scripts\logs\sales_report.log`
- Each rep needs to allow the popup once before first use
- `_CONTACT_NOTES` tab may need to be manually created in History sheet if notes aren't persisting (create tab, add header row: `ACCOUNT_NAME, CONTACT_NAME, TYPE, NOTE, DATE, REP`)
- `saveContactNoteFromView` (line ~8508) does not update `state.contactNotesCache` after save — notes from Contacts view only appear in Notes Feed after next reload

## Session Log
### 2026-05-19
**Bugs fixed:**
- Notes Feed (`_renderNotesFeed`): `mgrCfg` was null for real managers (non-admin) — fixed by setting `mgrCfg` when `isMgr || isActuallyTeamView`; contact notes access control now lets managers see full team notes
- Admin dropdown: removed redundant "Team Views" section; Manager Views (`__MGR_X`) now set `state.viewAsRep='__TEAM_ALL__'` (was setting personal rep ID)
- `switchViewAs`: `__MGR_X` now sets `state.viewAsRep='__TEAM_ALL__'` so dashboard/notes show combined team data
- `refreshDashboard`: added `repMatchesFn` helper — `'__TEAM_ALL__'` now resolves team reps and filters GP/orders/reqs correctly (was matching zero records)
- Suggestions Board: reads were hitting Main sheet (wrong); fixed to use `sheetsGetFrom(HISTORY_SPREADSHEET_ID)`; added header-row detection with synthetic fallback; fixed `_rowOffset` bug (rowIdx off-by-1 caused last card status update to silently fail)
- `saveCollectionsNote`: was saving to `CONFIG.SPREADSHEET_ID` (Main, at cell limit) — changed to `CONFIG.HISTORY_SPREADSHEET_ID`; this was causing the "sheet error" toast and notes disappearing after reload
- `saveContactNote` + `iqSaveLog`: were setting `state.contactNotesCache = {}` (dict) after save, corrupting the array format the Notes Feed expects; fixed to maintain `[header, ...rows]` array format
- Notes Feed fallback read: `sheetsGet` was hitting Main sheet; fixed to `sheetsGetFrom(CONFIG.HISTORY_SPREADSHEET_ID, ...)`

**Features added:**
- Notes Feed: added `FollowUp` type (purple) — accounts with `followUpDate` set but no `repNote` now appear in feed
- Notes Feed: added FOLLOW-UP filter button to toolbar

**Files created this session:** `implement_t7b_s5.py`, `implement_t7b_s6.py`, `implement_t7b_s7.py`, `implement_t7b_s8.py`

### 2026-05-19 (continued)
**Bugs fixed:**
- Suggestions Board access: non-admin users could navigate to the page directly — added `if (!isAdmin()) { switchView('accounts'); return; }` guard at top of `renderSuggestionsBoard`
- `switchViewAs`: Suggestions Board nav (`nav-suggestions-board`) now hidden whenever admin is simulating any view (`state.viewAsRep` set) — hidden in all rep/manager/team simulations
- Notes Feed rep dropdown showing only MX team reps for admin/FJohn: `isActuallyTeamView` was `isTeamView || state.viewAsRep === '__TEAM_ALL__'` — previous MX Team visit left `state.viewAsRep='__TEAM_ALL__'` bleeding into the personal Notes Feed. Fixed by changing to `isActuallyTeamView = isTeamView` (Team Notes already passes `isTeamView=true` explicitly, so the condition was redundant and harmful)

**Access rules confirmed:**
- Admin/FJohn in Notes Feed: sees all reps, dropdown shows all CONFIG.REPS
- CKaren (manager): dropdown shows MX team reps, sees own + team accounts
- Regular rep (Anolan, etc.): no dropdown, sees own notes only
- Suggestions Board: admin/FJohn only — hidden and redirected for everyone else

### 2026-05-19 (session 3)
**Features added:**
- Academy: added full lesson content for all 23 previously-empty "coming soon" lessons across 5 tracks:
  - Track 3 (My Accounts): t3-1 (Account Detail Tabs), t3-3 (Setting Follow-Up Dates), t3-5 (Requesting Account Removal)
  - Track 4 (Attack Plan): t4-1 (Zone Strategy), t4-2 (Building Your First Plan), t4-3 (Using AI Advisor), t4-4 (Rotating Accounts), t4-5 (Territory Transfers)
  - Track 5 (Collections): t5-1 (AR Dashboard), t5-2 (Risk Badges), t5-3 (Gentle Reminder Email), t5-4 (Escalating to Firm/Final), t5-5 (Requesting Credit Hold)
  - Track 6 (AI Email Mastery): t6-1 (How Email Generator Works), t6-2 (Customizing Tone), t6-3 (Using Part Number History), t6-4 (Email Signature Setup), t6-5 (Grammar Check)
  - Track 8 (Sales Playbooks): t8-1 (Re-Engagement Playbook), t8-2 (Declining Account Rescue), t8-3 (High-Value Lost Account), t8-4 (Collections Escalation Playbook), t8-5 (New Account Onboarding)
- All lessons use existing helper functions (acadSection, acadTipCards, acadSteps, acadQuiz, acadKeyTakeaway, acadCompleteBtn, acadSequenceStep, acadDayStep, acadOutcomeRow, acadSignalRow, acadNoteTemplate)
- All content is aligned with actual app features (Collections badge system, Attack Plan zones, AI email generator, Settings signature, etc.)

**Academy content coverage:** All 37 lessons now have real content — `acadDefaultLesson` fallback no longer reached for any defined lesson.

### 2026-05-19 (session 4 — security hardening + Task 9)
**Security improvements (5 items — Worker + HTML):**
- Worker: added `/get-ip` (unauthenticated, returns `CF-Connecting-IP`) and `/geoip` (authenticated, returns city/country/org from `request.cf`)
- Worker: `verifyGoogleToken()` now checks `payload.exp` expiry, rejects expired tokens even if email is valid
- Worker: non-admin `PUT` to audit log paths (`_LOG`, `_ACCESS_LOG`, `_NDA_LOG`) returns 403
- HTML: `Content-Security-Policy` meta tag added to `<head>`
- HTML: `logAccessEntry('PENDING')` fires at NDA accept; `confirmLocation()` patches actual location into that row (fix audit gap)

**Task 9 — 10 fixes:**
- Fix 1/2/3 (AI key): all AI calls already go through Worker — removed API key references from Academy (step 2 now says set signature), help page, and academy tip. Settings page shows non-admin "AI features enabled — no setup needed" message.
- Fix 4 (bcastor): console.log at login: `bcastor accounts loaded: N`
- Fix 5 (Session ID): `generateSessionId()` function; `sessionStorage.it_session_id` set at `completeLogin()`; SESSION_ID column added to both NDA_LOG and ACCESS_LOG writes
- Fix 6 (IP logging): geo pre-fetched in `checkIPAndProceed()` and stored on `state.userIP/City/Country/Org`; `logAccessEntry()` reuses state data (no duplicate fetch)
- Fix 7 (Session timeout): `SESSION_TIMEOUT_MS` changed 30→60 min; `resetSessionTimer()` now sets a 55-min warning timer (`_warnTimer`) and shows "5 minutes to expiry" toast
- Fix 8 (Known IPs): `checkIPAndProceed()` called from `acceptNDA()` — pre-fetches geo, checks `localStorage.it_known_ips_repId`; known IP → auto-proceed with `logAccessEntry('Known Location')`; new IP → shows location modal with red warning banner (`loc-new-ip-warn`) and "This isn't me" button; `confirmLocation()` adds IP to known list (max 10); `locationNotMe()` logs `SUSPICIOUS_LOGIN` to `_LOG` and signs out
- Fix 9 (Unusual activity): `checkUnusualActivity()` runs 8s after admin login — reads `_ACCESS_LOG`, counts distinct IPs per rep (7d) and suspicious logins (24h), shows dismissable red banner and sends email via `/send-alert`
- Fix 10 (Force logout): "⏏ LOG OUT ALL" button in sidebar (admin only); force-logout confirmation modal; `forceLogoutAll()` writes `FORCE_LOGOUT_ALL` to `_LOG`; `forceLogoutUser(repId, email)` writes `FORCE_LOGOUT_USER`; `checkForceLogout()` polls `_LOG` every 2 min for events newer than `state.loginTime`; per-row "⏏ Force Logout" button in Access Log

**New state fields:** `state.loginTime`, `state.userIP`, `state.userCity`, `state.userCountry`, `state.userOrg`
**New localStorage keys:** `it_known_ips_[repId]` — array of up to 10 known IPs per rep
**Worker endpoints added:** `/get-ip` (no auth), `/geoip` (auth required), `ADMIN_EMAILS` const
**Commits:** `ad59e7d` (5 security items), `ffbf846` (Task 9 all 10 fixes)
