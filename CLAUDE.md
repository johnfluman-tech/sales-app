"At the end of every session, update this file with new files created, functions added, bugs fixed, and any new rules learned."

## ⚠ CRITICAL — NEVER REGRESS THESE BEHAVIORS

These things have broken more than once. Do not break them again:

1. **Hidden accounts** — accounts hidden via Requests & Approvals (JOHN_APPROVAL='YES') must persist across page reloads. Two-layer system: (a) JOHN_APPROVAL column in rep tab, (b) `_HIDDEN_ACCOUNTS` tab in History sheet read by `loadHiddenAccountsTab()`. The tab has NO header row — `loadHiddenAccountsTab()` detects this and reads positionally [name, rep, status]. Do NOT add a header check that returns early. Do NOT change column order in `approveRemovalDirect()`.

2. **Note history deduplication** — `loadNoteHistory()` must be called ONCE after all tabs load, NOT once per tab. Called at the bottom of the `loadAllAccounts()` loop (after all tabs finish). Calling it per-tab multiplies every note by the number of tabs (8× for admin).

3. **_CONTACT_NOTES in History sheet** — all reads/writes must use `CONFIG.HISTORY_SPREADSHEET_ID`, never `CONFIG.SPREADSHEET_ID` (Main is at cell limit).

4. **applyLanguage() nav icons** — must walk `.nav-item-inner` childNodes and update only the text node. Never set `el.textContent` or `el.innerHTML` on `.nav-item` — destroys badges and icons.

5. **Account Intel generic-word matching** — stop-word list (`technologies`, `manufacturing`, `engineering`, `corporation`, `inc`, etc.) must be applied in the safety net AND in the historyCache 5th fallback. "Zebra Technologies" → distinctive word = "zebra" only. Never remove this filtering.

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

### Confirmed Google Account Emails (REP_EMAIL_MAP)
| repId | Google email |
|-------|-------------|
| FJohn (ADMIN) | john.fluman@intransittech.com |
| CKaren | kmancebo@intransittech.com |
| BillP | bill.pratt@intransittech.com |
| PIan | ian.pitman@intransittech.com |
| RMauricio | **mauricio.rangel@intransittech.com** (NOT mrangel@) |
| LMancera | lmancera@intransittech.com |
| bcastor | brandonar@intransittech.com |
| Anolan | anolan@intransittech.com |
| CMancilla | carlos.mancilla@intransittech.com |
| MPerezfreye | manuel.perezfreyre@intransittech.com |

## Pending / Known Issues
- Dashboard loads slowly (30s+) — Supabase migration not yet complete (app still reads Sheets)
- `sales_report.py` needs to be scheduled on INTRANSIT-RDS02 via Windows Task Scheduler — target: every 30 minutes, silent background run, log to `C:\scripts\logs\sales_report.log`
- Each rep needs to allow the popup once before first use
- `_CONTACT_NOTES` tab may need to be manually created in History sheet if notes aren't persisting (create tab, add header row: `ACCOUNT_NAME, CONTACT_NAME, TYPE, NOTE, DATE, REP`)
- `saveContactNoteFromView` (line ~8508) does not update `state.contactNotesCache` after save — notes from Contacts view only appear in Notes Feed after next reload
- **`_CUSTOMER_DIRECTORY` confirmed working** — 2,487 accounts in History sheet as of 2026-05-22. Attack Plan CRM pool is live. Re-run `sales_report.py` on INTRANSIT-RDS02 to refresh.

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

### 2026-05-19 (session 5 — Task 10)
**Features added (all 10 fixes):**
- Fix 1-5 (History tab): Rewritten `renderHistoryTab(acc)` — groups line items by invoice (from `historyCache`), joins with `gpCache` for GP$/GP%, `collectionsInvoicesCache` for balance/tracking, renders rich invoice cards with tracking links (UPS/FedEx/DHL). Sort buttons (Newest/Oldest/Largest), pagination 20/page with SHOW MORE button using `data-acc`. RFQ + Quote sections also sorted newest-first with full detail.
- Fix 6 (Panel layout): `.detail-tabs` gets `flex-shrink:0`; `.detail-body` gets `min-height:0`; `.detail-header` gets `flex-shrink:0`. `renderInfoTab(acc)` replaced with SVG bar chart (green=growing, orange=declining, dark=zero) + year table + expanded account detail fields.
- Fix 7 (Force logout UX): `showForcedLogoutMessage()` replaces full `document.body` with signed-out overlay. Force logout result modal shows ✅ success or ❌ failure with TRY AGAIN. `state.loginTime` now stored to `sessionStorage.it_login_time` at login AND restored in `checkAuth()` on page reload. `checkForceLogout()` called at start of every `switchView()`.
- Fix 8 (Active Users): `sendHeartbeat()` upserts row in `_ACTIVE_USERS` History sheet tab; `state._heartbeatRow` caches row index; heartbeat runs every 60s after login. `loadActiveUsers()` renders online table + 24h sessions in Settings (admin-only `#active-users-section`). Auto-refresh every 60s while on Settings page.
- Fix 9 (NDA capture): `acceptNDA()` stores full NDA text to `localStorage` key `it_nda_[repId]_[timestamp]`; key added as column N in `_NDA_LOG`. `viewNDARecord(key)` opens modal with full NDA text (close via `data-mid` pattern). `exportNDALog()` downloads CSV. NDA log table enhanced with Session ID + NDA Version columns.
- Fix 10 (Pool filter): `hideFromPool !== 'YES'` filter added to all 4 Transfer Candidate queries. Pool removal modal button renamed to "REQUEST REMOVE FROM POOL" with clearer description. `adminSetPoolHide(accName, hide)` new function — updates `HIDE_FROM_POOL` column in sheet + in-memory; shows "HIDE_FROM_POOL column not in sheet" error if column missing. `johnPoolHtml` admin buttons (Hide/Restore) added to Notes tab `renderNoteInput` for admin-only view.

**New functions:** `histShowMore`, `histSetSort`, `renderHistoryTab` (replaced), `renderInfoTab` (replaced), `showForcedLogoutMessage`, `sendHeartbeat`, `loadActiveUsers`, `viewNDARecord`, `exportNDALog`, `adminSetPoolHide`
**New state fields:** `state._heartbeatRow`, `state._histPage`, `state._histSort`, `state._ndaLogRows`
**New localStorage keys:** `it_nda_[repId]_[timestamp]` — full NDA text record
**New sessionStorage keys:** `it_login_time` — loginTime persisted across page reload
**Pending (manual):** Add `HIDE_FROM_POOL` column to `_MASTER` and rep tabs in Google Sheets; update `sales_report.py` to pass `hideFromPool` field
**Commit:** `b37798e`

### 2026-05-19 (session 6 — Task 11 + Task 12)
**Task 11 completed:**
- Added `HIDE_FROM_POOL` column to all 9 tabs in Main sheet: `MASTER`, `CKaren`, `BillP`, `PIan`, `RMauricio`, `LMancera`, `bcastor`, `FJohn`, `Anolan`
- Rep tabs have 3-row merged header structure; actual column headers in row 4; `HIDE_FROM_POOL` appended as next column after `JOHN_APPROVAL`
- Service account: `sales-report-bot@intransit-reports.iam.gserviceaccount.com`, credentials at `C:\scripts\google_credentials.json`
- Script written/run/deleted: `C:\scripts\add_hide_from_pool.py`

**Task 12 completed — Transfer Candidates restricted to managers + admin:**
- `canSeeTransferCandidates()` — new helper: `isAdmin() || !!state.managerRole || state.user.repId === 'BillP'`
- `renderAttackPlan()`: `otherAccs` gated — returns `[]` for regular reps
- `apkRender()`: pre-computes `_canTransfer`, `_transferHeaderHtml`, `_transferPanelHtml` before `el.innerHTML`; replaces IIFE with empty placeholder filled via `apkRenderTransferPanel()` post-render (also fixes all nested backtick violations in that function)
- `apkMove()`: removed unused `otherAccs` line
- `apkRequestHideTransfer()`: transfer panel re-render gated with `canSeeTransferCandidates()`
- `apkRenderTransferPanel()`: removed erroneous `loadActiveUsers()` / `clearInterval` block that was copy-pasted from Settings view
- `apkShowTransferActionModal()`: added ASSIGN DIRECTLY button for admin/manager users (pre-computed `_assignBtnHtml` using `data-n` attribute)
- `apkDoAssignToMe(name)` — new async function: reassigns account to `window.apkRep` in-memory, logs `ACCOUNT_ASSIGNED` to `_LOG`, re-renders transfer panel
- Regular reps (PIan, RMauricio, LMancera, bcastor, Anolan): see no transfer header, no transfer panel, no REQUESTS button
- BillP: sees transfer panel (view-only), no ASSIGN DIRECTLY button
- Managers + Admin: see all transfer UI + ASSIGN DIRECTLY button

**New functions:** `canSeeTransferCandidates`, `apkDoAssignToMe`
**Commit:** `69aba6f`

### 2026-05-19 (session 7 — Task 13)
**Task 13: Fix login + NDA logging for all users**

**Root cause:** `completeLogin()` had no login event write — logging only happened via `acceptNDA()` → `checkIPAndProceed()` → `logAccessEntry()`, which has race conditions and only writes to `_ACCESS_LOG` (History), not `_LOG` (Main). Also `acceptNDA()` was calling `showLocationModal()` unconditionally at its start, before `checkIPAndProceed()` had run — causing the location modal to appear twice for new IPs.

**Bugs fixed:**
- `acceptNDA()`: removed spurious `showLocationModal()` call at top of function; `checkIPAndProceed()` already handles showing the location modal for new IPs — the early call caused a double-modal bug
- `completeLogin()`: now always calls `logLoginEvent()` immediately after the `_loginComplete` guard, so every login (new OR returning user with cached token) is logged to `_LOG` Main Sheet with 3-attempt retry

**Features added:**
- `getUserIP()` — calls Worker `/get-ip` (unauthenticated) to get caller's real IP; used by `logLoginEvent()`
- `logLoginEvent(userData)` — writes LOGIN event to `'_LOG'!A1` (Main Sheet) with: ISO timestamp, email, event=LOGIN, details (repId + IP), user agent, session ID; retries up to 3× with 1s delay on failure
- `console.log('completeLogin called for:', email, repId)` — diagnostic log at start of `completeLogin()`

**New functions:** `getUserIP`, `logLoginEvent`
**Worker:** `/get-ip` route already existed (added in Task 9) — no Worker changes needed
**Commit:** `aba1556`

### 2026-05-19 (session 8 — Task 15)
**Task 15: NDA fix + login logging + transfer candidates + manager daily mission**

**Fix 1 — NDA before app shows:**
- `completeLogin()` now checks `sessionStorage.getItem('it_nda_accepted')` at the TOP, before showing the app or setting `_loginComplete`
- If NDA not yet accepted: calls `showNDA()` and returns immediately — login screen stays visible
- After NDA accept, `acceptNDA()` → `checkIPAndProceed()` → `completeLoginAfterLocation()` → `completeLogin()` resumes (NDA flag is now set, proceeds normally)
- Applies to ALL users including those with cached OAuth tokens

**Fix 2 — Login logging columns:**
- `logLoginEvent()` now writes 9 columns: `TIMESTAMP, EVENT, EMAIL, REP_ID, IP_ADDRESS, LOCATION_CLAIM('PENDING'), DEVICE, STATUS('NORMAL'), SESSION_ID`
- Added `console.log` at function entry and each attempt for diagnostics
- Error catch now logs the full error object (not just `e.message`)

**Fix 3 — Transfer candidates for CKaren/BillP:**
- `canSeeTransferCandidates()` was using `state.user.repId` (always undefined) — now uses `state.repId`
- Added `repId === 'CKaren'` (belt-and-suspenders alongside `!!state.managerRole` which already covers her)

**Fix 4 — Manager daily mission team filter:**
- Added `_isManagerTeamView = !!state.managerRole && viewAsRep === '__TEAM_ALL__'`
- When true: events filtered to team rep emails (PIan, RMauricio, LMancera, bcastor); repAccounts filtered to team rep IDs
- FJohn and BillP events never appear in manager team view
- `repEmailMap` hoisted to be shared across all branches

**Commit:** `c6700a8`

### 2026-05-19 (session 9 — Task 16)
**Task 16: Audit + console logs + tightened allowlist**

**Audit findings (all clean after Task 15):**
- NDA check: `completeLogin()` lines 2832-2836, fires before `_loginComplete` is set or app shows — no isAdmin guard
- `logLoginEvent()` called at line 2842, NOT inside any if() block
- `canSeeTransferCandidates()` called at line 10004 before `el.innerHTML` — layout already expands when panel absent (flex:1 fills full width)
- No `sessionStorage.clear()` or `removeItem('it_nda_accepted')` found anywhere

**Changes made:**
- `completeLogin()`: replaced generic console.log with `[AUTH] Login started for:` + `[NDA] sessionStorage it_nda_accepted:` diagnostic lines
- `showNDA()`: added `[NDA] Showing NDA modal for:` log at function entry
- `acceptNDA()`: added `[NDA] Accepted by:` log at function entry
- `logLoginEvent()`: updated to `[LOG] Writing login event for:` format (both entry and per-attempt)
- `canSeeTransferCandidates()`: replaced `repId === 'BillP' || repId === 'CKaren'` with explicit allowlist `['ADMIN','BillP','CKaren','CMancilla','MPerezfreye']`; added `[ATTACK] canSeeTransferCandidates:` log

**How to verify in browser DevTools (F12 → Console):**
- On any login: `[AUTH] Login started for: ...` then `[NDA] sessionStorage it_nda_accepted: null`
- NDA modal: `[NDA] Showing NDA modal for: ...`
- After accept: `[NDA] Accepted by: ...`
- Login logging: `[LOG] Writing login event for: ...` then `Login logged ✓ for ...`
- Attack Plan open: `[ATTACK] canSeeTransferCandidates: true/false for rep: ...`

**Commit:** `ebdbb1b`

### 2026-05-20 (session 10)
**Bugs fixed:**

- **NDA not showing after re-login (root cause found + fixed):** `checkAuth()` was clearing the expired OAuth token from localStorage but never touching sessionStorage — so `it_nda_accepted` survived token expiry and the NDA was skipped on the next login. Fixed by clearing `it_nda_accepted`, `it_session_id`, `it_login_time` from sessionStorage in ALL three paths that return false from `checkAuth()`: (1) expired token path, (2) no-token path, (3) `init()` `!authed` branch. Every path that reaches the login screen now clears the NDA flag.

- **Access Log page showing "API error 429":** Google Sheets API rate-limits at ~60 reads/minute per user. During cache load, many concurrent reads fire; opening the Access Log immediately after login added one more and tipped it over. Fixed in `sheetsGetFrom()` — 429 now triggers exponential backoff retry: waits 4s, 8s, 12s (3 attempts) before surfacing an error. Applies to all `sheetsGetFrom` calls app-wide.

**Commits:** `1fc880d` (NDA checkAuth fix), `6ddd195` (429 retry fix)

**NDA clear points (all paths covered):**
1. `handleSignout()` — manual sign out ✓
2. `showForcedLogoutMessage()` + `_forcedLogoutReload()` — force logout ✓
3. `checkAuth()` expired token path ✓ (new)
4. `checkAuth()` no token path ✓ (new)
5. `init()` `!authed` branch ✓ (new)

### 2026-05-20 (session 11 — TASK17 login loop fix + TASK18 Prospects)

**TASK17 — OAuth loop fix:**
- Root cause: `sheetsGetFrom()` concurrent-401 path was calling `handleSignout()` immediately, kicking Karen/Mauricio back to login while another request was already refreshing the token. Fixed by throwing instead of signing out in the concurrent-401 branch.
- Secondary: `checkIPAndProceed()` and `confirmLocation()` both called `loadAllAccounts()` as fire-and-forget — creating 2 concurrent loads that both hit 401 simultaneously. Removed both redundant calls.
- TASK17 OAuth popup loop: added `state.loginInProgress` guard in `handleGoogleCredential()`, 30s timeout in `requestSheetsToken()`, reset in `handleSignout()`, and pre-set in `init()` for cached sessions.

**TASK18 — Prospecting + Cold Account Features (all 5 features):**

**Feature 1 — Live CRM Account Search:**
- Added "🔍 FIND ACCOUNT" button in My Accounts topbar (shown only when on accounts view via `switchView`)
- CRM search modal (`#crm-search-modal`) with 3-char min input — searches `state.customerDirectory` client-side
- `loadCustomerDirectory()` — loads `_CUSTOMER_DIRECTORY` tab from History Sheet into `state.customerDirectory` on startup (non-blocking after `schedLoadFromSheets()`)
- `_CUSTOMER_DIRECTORY` tab must be populated by `sales_report.py` on INTRANSIT-RDS02: columns `CUSTOMER_ID, NAME, USERNAME, CITY, STATE, LAST_ACTIVITY`
- Results show company name, rep, city/state, last activity + "Add to My Prospects" button

**Feature 2 — Prospects Tab:**
- Sidebar nav item "🎯 Prospects" between Contacts and Attack Plan
- Two-panel layout: left = prospect list with filter bar (priority: All/Hot/Warm/Cold; source: All/Manual/CRM; sort: Name/Priority/Last Contacted/Date Added); right = detail panel
- Prospect cards show priority emoji badge, company, source, days since last contact
- Detail panel tabs: Notes, Contacts, Outreach, Research, Convert
- Notes tab: view existing notes + add timestamped note (updates `LAST_CONTACTED`)
- Contacts tab: add/remove contact name/title/email/phone (stored as JSON in `CONTACTS_JSON` column)
- Convert tab: detects if prospect company matches an existing account (invoice data), shows convert banner
- Add Prospect modal: manual form (name, priority, industry, website, city/state, notes)
- CRM search flow: clicking "Add to My Prospects" pre-fills the add form with company name + CRM ID
- Saves to `_PROSPECTS` tab in History Sheet (must be created manually or auto-created on first write)

**Feature 3 — AI Prospecting Assistant:**
- Outreach tab: AI cold intro + follow-up email generator using `claude-haiku-4-5-20251001`
- Research tab: AI company research profile using `claude-haiku-4-5-20251001`
- System prompt includes rep ID and top part numbers from invoice history

**Feature 4 — Daily Mission Integration:**
- Hot prospects (PRIORITY=Hot, STATUS=Active) prepended to `aiPicks` array in `renderFollowUpCommandCenter()`
- Rendered with gold `🎯 PROSPECT` badge, shows priority + days since last contact
- Click takes rep to Prospects view

**Feature 5 — Admin Bulk Import:**
- "📥 Bulk Import" button in Prospects list header (admin only via `isAdmin()`)
- Full-page CSV import panel with rep selector and paste area
- CSV format: `COMPANY_NAME,WEBSITE,INDUSTRY,CITY,STATE,PRIORITY,NOTES`
- Skips duplicates; appends all new rows to `_PROSPECTS` in one `sheetsAppend` call

**New state fields:** `state.prospectCache`, `state.customerDirectory`, `state._prospectsLoaded`, `state._selectedProspect`, `state._prospectTab`
**New localStorage keys:** `window._prospectFilter` (priority/source/sort filter state)
**New HTML:** `#crm-search-modal`, `#add-prospect-modal`

**New functions:** `showCRMSearch`, `closeCRMSearch`, `crmSearchInput`, `addToProspects`, `showAddProspectModal`, `_openAddProspectForm`, `closeAddProspectModal`, `submitAddProspect`, `saveProspect`, `_updateProspectInSheet`, `_updateProspectsBadge`, `loadCustomerDirectory`, `loadProspects`, `renderProspectsView`, `selectProspect`, `_prospectSwitchTab`, `_renderProspectDetailHtml`, `_getProspectTabHtml`, `_prospectNotesHtml`, `_prospectContactsHtml`, `_prospectOutreachHtml`, `_prospectResearchHtml`, `_prospectConvertHtml`, `_attachProspectDetailEvents`, `_attachProspectTabEvents`, `saveProspectNote`, `saveProspectContact`, `deleteProspectContact`, `deleteProspect`, `convertProspect`, `prospectSetPriority`, `prospectsGenerateEmail`, `prospectsResearch`, `showBulkImportProspects`, `processBulkImport`

**Pending (manual setup required on INTRANSIT-RDS02):**
- Add `_CUSTOMER_DIRECTORY` export to `sales_report.py` — write all dbo.CUSTOMER rows (columns: CUSTOMER_ID, NAME, USERNAME, CITY, STATE, LAST_ACTIVITY) to a `_CUSTOMER_DIRECTORY` tab in History Sheet after the main run
- The `_PROSPECTS` tab in History Sheet will be auto-created on first prospect save (sheetsAppend creates it if it doesn't exist, as long as the tab exists — may need to create the tab manually first in Google Sheets)

**Commit:** `15ffae6`

### 2026-05-20 (session 12 — Carlos OAuth infinite loop fix)

**Root cause identified:** Multiple concurrent Sheets API calls fired after login (from `loadAllAccounts()` + `ensureCacheLoaded()`). When any returned 401, `refreshTokenSilent()` was called — which created a **new** `initTokenClient` (popup). On Carlos's PC the popup went to background, timed out after 12s, called `handleSignout()`, which reset `_refreshingToken`. The still-running background async calls then hit 401 again, each creating another popup — infinite cascade.

**Three-part fix (commit `9364cd2`):**

- **`_signedOut` module-level flag:** Set to `true` in `handleSignout()`, cleared to `false` in `completeLogin()` when `_loginComplete` is set. In `sheetsGetFrom()` 401 handler, if `_signedOut` is true, just throw immediately — no popup, no `handleSignout()` cascade.

- **`refreshTokenSilent()` rewired to reuse `state.tokenClient`:** Instead of creating a new `initTokenClient` (separate popup context), the function sets `state._pendingRefresh = { resolve, reject, tid }` and calls `state.tokenClient.requestAccessToken({ prompt: '' })`. The `requestSheetsToken()` callback checks `state._pendingRefresh` after the token arrives — if set, it resolves/rejects and returns WITHOUT calling `completeLogin()` (the token is just updated silently). The 55-min proactive refresh now uses the same mechanism with no new popup.

- **`handleGoogleCredential()` loop guard:** Added `window._lastSignoutTime` guard — if GIS fires within 8 seconds of a signout, the callback is suppressed. `handleSignout()` sets `window._lastSignoutTime = Date.now()`.

**New state field:** `state._pendingRefresh` — `null` normally; `{ resolve, reject, tid }` while a silent refresh is in progress.
**New module-level var:** `let _signedOut = false` — declared after the state object.

### 2026-05-20 (session 13 — CRM pool + debug simulate login)

**TASK21 — Cloudflare Worker whitelist fix:**
- Removed `ALLOWED_EMAILS` hardcoded list from worker `verifyGoogleToken()` — was blocking Carlos (carlos.mancilla) and Manuel (manuel.perezfreyre) with 403
- Worker now accepts any `@intransittech.com` email without a list check
- Deployed via `wrangler deploy`

**CRM Discovery field name fixes:**
- `loadCustomerDirectory()` maps columns to lowercase keys: `{id, name, rep, city, state, lastActivity}`
- `showCRMDiscovery()`, `apkAIRankCRM()`, `apkAIPicker()`, `apkAcceptAIPicks()` were all using uppercase field names (`c.NAME`, `c.USERNAME`, `c.CUSTOMER_ID`) — fixed to lowercase throughout
- `showCRMDiscovery()` now shows setup instructions when directory is empty (not just a blank panel)

**Settings CRM Directory status card:**
- New card shown for admin/manager (not in simulated view) showing loaded count, timestamp, Reload button
- `loadCustomerDirectory(force)` now accepts `force` param; updates `state._directoryLoadedAt` on load
- `reloadCRMDirectory()` — force-reload handler for Reload button

**MANAGER_CONFIG — CKaren added to her own teamReps:**
- `'CKaren': { teamReps: ['CKaren','PIan','RMauricio','LMancera','bcastor'] }` — was missing CKaren herself
- Fixes MX Team dashboard view not counting her own accounts

**`completeLogin()` — stale rep filter fix:**
- Added `state.viewAsRep = null` immediately after `state._loginComplete = true`
- Prevents a previous admin view-as session from bleeding into a fresh login

**`sales_report.py` — `_CUSTOMER_DIRECTORY` export:**
- Added `push_customer_directory_tab(service, conn, all_tabs)` function
- Writes all `dbo.CUSTOMER` rows for active reps to `_CUSTOMER_DIRECTORY` tab in History Sheet
- Called in `main()` after `push_customer_stats_tab`
- Columns: `CUSTOMER_ID, NAME, USERNAME, CITY, STATE, LAST_ACTIVITY`
- Scheduled on INTRANSIT-RDS02 at 15-min intervals (already running)

**Attack Plan Pool — CRM accounts + filters (commit `ce82815`):**
- `renderAttackPlan()` now builds `window.apkCRMAccs` — `state.customerDirectory` entries for the current rep that are NOT already in `state.accounts`; adds them to `planState` as 'pool'
- `apkGetCols()` includes `window.apkCRMAccs` in pool/zone distribution (separate from `repAccNames`)
- Pool header: three filter buttons — **ALL**, **HAS SALES**, **NO SALES** — toggle via `window._apkPoolFilter`
- `apkRenderPool()` applies filter using `_crmNames` Set before rendering
- `apkCardHtml()` pool cards: CRM-only accounts (`!acc`) get blue left border, `📊 CRM` badge, city/state/last-activity instead of dollar amount
- `apkSetPoolFilter(f)` — new function: sets filter, re-renders pool, updates button active state

**Admin debug: Simulate Login As (commit `9a9646a`):**
- New section in Settings (admin only, orange border) — buttons for all 9 users
- `debugSimulateLogin(repId, email, managerRoleKey)` — swaps `state.repId`, `state.isAdmin`, `state.managerRole`, `state.viewAsRep`, `state.user` to simulate that user; saves original state to `window._debugOrigState`; prints `[SIM]` diagnostics to console showing accounts-in-data vs accounts-visible; shows orange sticky banner at top of page
- `debugRestoreAdmin()` — restores all original state, removes banner
- Console output: `[SIM] Accounts for rep "X" in state.accounts: N` and `[SIM] getViewAccounts() returned: N accounts` — identifies filtering bugs without needing user to log in

**New state fields:** `window.apkCRMAccs`, `window._apkPoolFilter`, `state._directoryLoadedAt`
**New functions:** `apkSetPoolFilter`, `debugSimulateLogin`, `debugRestoreAdmin`, `reloadCRMDirectory`
**Commits:** `ce82815` (CRM pool), `9a9646a` (simulate login)

**Note:** `_CUSTOMER_DIRECTORY` export confirmed working as of 2026-05-22 — 2,487 accounts pushed.

### 2026-05-21 (session 14 — Karen/Mauricio accounts crash fix)

**Bug fixed — "Cannot convert undefined or null to object" on login:**
- **Root cause:** `state.collectionsCache` was never initialized in the state object. Only `collectionsNotes` and `collectionsInvoicesCache` were in the initial state. `collectionsCache` was created lazily inside `loadSupplementalData()` (line 1673: `if(!state.collectionsCache) state.collectionsCache={}`) only when collections data was processed.
- **Race condition:** `loadAllAccounts()` and `ensureCacheLoaded()` run in parallel. When `loadAllAccounts()` finishes, the `.then()` chain calls `updateBadges()`, which called `Object.keys(state.collectionsCache)`. If `ensureCacheLoaded()` hadn't yet reached the collections-processing step, `state.collectionsCache` was `undefined` → crash.
- **Why only Karen/Mauricio:** Admin John loads all 8 tabs (~10–15s), giving `ensureCacheLoaded()` time to set the cache. Karen loads 5 team tabs; Mauricio (and potentially other single-tab reps) loads 1 tab (~1–2s) — almost always finishes before the cache loader initializes `collectionsCache`.
- **Fix 1:** Added `collectionsCache: {}` to the state object initialization (alongside `collectionsNotes` and `collectionsInvoicesCache`) so it is always a valid object from the start.
- **Fix 2:** Added `|| {}` guards in `updateBadges()`: `Object.keys(state.collectionsCache || {})` and `Object.keys(state.contactsCache || {})` — belt-and-suspenders in case any future lazy initialization follows the same pattern.

**Commit:** `2beca95`

**Bug fixed — UNUSUAL ACTIVITY DETECTED banner showing for all users:**
- `#activity-warning` div had no `display:none` in its initial HTML, so it was visible for every user on every page load
- The `.show` class added by JS had no corresponding CSS rule to override it either
- Fix: added `style="display:none"` to the div; changed JS trigger from `classList.add('show')` to `style.display = 'block'` so it only appears when a non-admin views 200+ accounts in one session
- **Commit:** `a9e7f6e`

**Bug fixed — Data isolation for non-admin reps (Mauricio, Karen, all reps):**
- Root cause: Collections, Contacts, and Attack Plan filters used `repFilter` (based on `state.repId`) to filter `acc.rep` field. If the `SALES_REP` column value in the sheet didn't exactly match the rep ID (or repFilter was null), ALL records showed instead of just that rep's.
- Fix (`89e6821`): Non-admin filtering now uses `state.accounts` as the truth source:
  - Collections: builds `_myAccNames` Set from `state.accounts`; filters by account name match instead of `acc.rep` comparison
  - Contacts: same `_ctMyAccNames` Set approach — contacts from accounts not in the set are skipped
  - Attack Plan: guard added — regular reps (not admin, not manager) see "sign out and back in" message instead of all-reps picker when `repFilter` is null
- These filters are **more robust than repId**: even if email mapping fails or repFilter is null, a non-admin can never see another rep's data (they'd see nothing, not everything)

**Diagnostics added (commit `4957c23`):**
- `setRepFromEmail` now logs `[AUTH] setRepFromEmail: email@... → repId: X` and warns with `[AUTH] Email not in REP_EMAIL_MAP` if the email isn't mapped — makes it immediately clear in F12 if an email needs to be added to `CONFIG.REP_EMAIL_MAP`
- `loadAllAccounts` tab error handler now shows a user-visible toast when the user's own tab fails: "Could not load your accounts (tab: X). Contact John if this persists."
- `loadAllAccounts` shows a toast when `state.accounts` is empty after load for non-admins
- `sheetsGetFrom` now includes the Google API response body in error messages for non-401/429 errors — makes 400 "Unable to parse range" errors identifiable without checking Network tab

**How to diagnose Mauricio / Karen blank accounts:**
1. Open F12 → Console before logging in
2. After login, look for: `[AUTH] setRepFromEmail: mrangel@intransittech.com → repId: RMauricio`
3. Then: `[TAB] Loaded RMauricio: N accounts` (N should be > 0)
4. If instead: `[TAB] Error loading tab RMauricio: Sheets API error 400: Unable to parse range...` → the tab name in the sheet doesn't match 'RMauricio' exactly
5. If: `[AUTH] Email not in REP_EMAIL_MAP` → add their email to `CONFIG.REP_EMAIL_MAP`

### 2026-05-22 (session 15 — Mauricio email fix, Academy gate, Collections contacts, CRM directory)

**Bug fixed — Mauricio repId null (no data loading):**
- `CONFIG.REP_EMAIL_MAP` had `'mrangel@intransittech.com'` — actual Google account is `mauricio.rangel@intransittech.com`
- Added correct mapping; kept old entry as fallback
- Also fixed `getDisclaimer()` which had the same wrong email
- **Commit:** `3b7e267`

**Bug fixed — Academy showing only 1 page for new users:**
- `renderAcademyView()` had a welcome gate that redirected first-time users (0 completed lessons) to a splash page instead of the tracks view
- Removed the gate entirely — all users go straight to all 8 tracks
- **Commit:** `097fb69`

**Bug fixed — Collections email contacts not linking:**
- `state.contactsCache` lookup by account name failed due to name format mismatches between `_COLLECTIONS` and `_CONTACTS` sheets
- Added `state._buyerEmailMap` built at cache load: keyed by contact name (lowercase) → contacts with emails; cross-references `_GP` ORDERED_BY (buyer names) back to `_CONTACTS` emails
- Added 2 new fallbacks in `selectCollectionsAccount()`:
  1. Buyer-name fuzzy fallback: strips punctuation, matches on 2+ words >3 chars across `contactRevenueCache` keys
  2. Rep-tab primary contact fallback: uses `acc.contactEmail` if all other lookups fail
- **Commits:** `1543361`, `60d9631`, `0927771`

**Bug fixed — `_CUSTOMER_DIRECTORY` not populating (CRM pool in Attack Plan):**
- **Root cause 1:** `push_customer_directory_tab()` was called after the main `conn` was already closed (`→ SQL connection closed.` printed before push functions ran)
- **Fix:** Function now opens its own fresh `pyodbc.connect()` internally; closes it in a `finally` block — no longer depends on the passed-in `conn`
- **Root cause 2 (earlier):** Function had silent `except` — only printed exception message, not traceback. Added `import traceback` + `traceback.print_exc()` + step-by-step progress prints so failures are visible
- Also added `resize_tab()` call before write to handle large datasets (default 5100-row tab limit was too small)
- **Result:** 2,487 CRM accounts now in `_CUSTOMER_DIRECTORY` tab — Attack Plan CRM pool working
- **Commits:** `a921207` (verbose logging), `adb4e9f` (fresh connection fix)

**`sales_report.py` deployment note:**
- Always copy `C:\Users\fluma\sales_report.py` (or `C:\Users\fluma\sales-app\sales_report.py`) → `C:\scripts\sales_report.py` on INTRANSIT-RDS02 before running
- The repo version (`sales-app\sales_report.py`) and the working copy (`C:\Users\fluma\sales_report.py`) are kept in sync
- `loadCustomerDirectory()` runs automatically for all users at page load — no manual action needed after script runs

### 2026-05-22 (session 16 — Manager Hub 5 tools + nav/scope fixes)

**Feature: Manager Hub expanded to 5 tools (commit `b88e005`)**
- Added 3 new tabs to existing Manager Hub (was: Scoreboard, Accountability, Playbook):
  - **💰 Collections** (`_mgrCollectionsHtml`): total team AR summary cards, per-rep AR badges with high-risk flags, full sorted table of all open balances with days-past-due and hold status
  - **📈 Pipeline** (`_mgrPipelineHtml`): YoY revenue/GP% comparison table per rep, Silent Churn list (accounts that bought last year but nothing yet this year — sorted by prior-year revenue), Declining+Open-AR risk table
  - **🤖 AI Brief** (`_mgrAIBriefHtml` + `mgrAIBrief`): three AI report types — Weekly Team Summary, Monthly Forecast, and per-rep 1:1 Coaching Prep buttons; all use `claude-haiku-4-5-20251001`
- **Scoreboard enhanced**: added `thisYear` GP filter from `gpCache`; new YTD Revenue + GP% columns (green ≥20%, gold ≥12%, red below); header updated
- **Playbook**: removed inline AI Coach Report section (moved to dedicated AI Brief tab)
- Tab renamed: "Accountability" → "Coaching"

**Bug fixed — Manager Hub not visible to admin (commit `e3ebd27`)**
- `nav-manager-hub` was only shown inside `if (isManager())` block at login — admin John never saw it
- Fix: added separate `if (isManager() || isAdmin()) { nav-manager-hub.show }` block before the manager-only block
- `renderManagerHub()`: when admin has no `managerRole`, `teamReps` defaults to `CONFIG.REPS` (all reps) and `teamName` = 'All Reps'
- `debugRestoreAdmin()`: updated to keep `nav-manager-hub` visible after restoring admin session

**Bug fixed — debugSimulateLogin not showing manager nav items (commit `6c0ef05`)**
- Simulating CMancilla/MPerezfreye left `nav-manager-hub`, `nav-team-notes`, `nav-team-profile` hidden because only `completeLogin()` updated nav visibility
- Fix: after state swap in `debugSimulateLogin`, iterates nav IDs and shows/hides based on `isManager()`
- Fix: `debugRestoreAdmin()` also updates nav items to match restored role

**Bug fixed — Collections showing all 816 accounts for managers (commit `f55e331`)**
- When simulating a manager (or real manager login), `_myAccNames` was built from all of `state.accounts`, letting Anolan/FJohn/BillP invoices leak into the manager collections view
- Fix in `renderCollectionsView()`: when `isManager() && getManagerConfig()`, filters `state.accounts` to only accounts whose `rep` is in `teamReps` before building `_myAccNames`
- Applies to both simulation mode and real manager logins (belt-and-suspenders)

**Manager Hub — how teamReps resolves:**
- `CMancilla` / `MPerezfreye`: `MANAGER_CONFIG[state.managerRole].teamReps` = `['CKaren','PIan','RMauricio','LMancera','bcastor']`
- `CKaren` in manager mode: same teamReps (including herself)
- Admin John (no managerRole): defaults to `CONFIG.REPS` — sees all reps in Scoreboard/Pipeline/etc.
- Admin simulating a manager: uses that manager's `teamReps`

**New functions:** `_mgrCollectionsHtml`, `_mgrPipelineHtml`, `_mgrAIBriefHtml`, `mgrAIBrief`
**Commits:** `b88e005` (5 tools), `6c0ef05` (sim nav fix), `f55e331` (collections scope), `e3ebd27` (admin nav + all-reps default)

### 2026-05-24 (session 17 — Karen email diagnosis + view-as dropdown fix)

**Karen view-as dropdown fixed (prev session):**
- Dropdown was listing CKaren twice — once as "My Accounts" and once in the team list
- Fix: added `if (r === state.repId) return;` in the `teamReps.forEach` loop to skip the manager's own repId

**Karen "READ ONLY / NO ACCOUNTS MATCH" — diagnostic deployed:**
- **Symptom:** Karen's sidebar showed "READ ONLY" + "NO ACCOUNTS MATCH" — `state.repId` was null
- **Root cause hypothesis:** Her Google OAuth email is NOT `kmancebo@intransittech.com` — it may be a different primary email (e.g., `karen.mancebo@intransittech.com`) while `kmancebo@...` is just an alias in Workspace
- **Evidence:** `state.user.name = 'Karen Mancebo'` was set correctly (from JWT name field), but `state.repId` null means the email field didn't match REP_EMAIL_MAP
- **F12 console also showed:** `ERR_INTERNET_DISCONNECTED`, `ERR_NAME_NOT_RESOLVED`, `400 Bad Request` — all to Cloudflare Worker — this is a secondary network issue on Karen's PC (likely firewall/proxy blocking `*.workers.dev` domains intermittently); the 400 errors are from `loadSupplementalData()` making Sheets API calls

**Diagnostic fix deployed (commit `3445fff`):**
1. `setRepFromEmail()`: added visible toast "⚠ Email not recognized: [email] — contact john.fluman@..." when email isn't in REP_EMAIL_MAP
2. `completeLogin()` + `completeLoginAfterLocation()`: changed "READ ONLY" label to "NOT MAPPED: [actual email]" so the exact email is visible in the sidebar
- **Next step:** Ask Karen to reload the page and tell you what email shows in the sidebar (or look at F12 console for `[AUTH] setRepFromEmail:` log) — then add that email to `CONFIG.REP_EMAIL_MAP` mapped to 'CKaren'

**Secondary issue — Worker connectivity on Karen's PC:**
- Some requests to `intransit-worker.intransit-sales.workers.dev` fail with ERR_NAME_NOT_RESOLVED or ERR_INTERNET_DISCONNECTED
- This is a network/DNS issue on her machine — could be corporate firewall, VPN, or proxy blocking Cloudflare Workers (`*.workers.dev`)
- Workaround: ensure Karen's PC has internet access to `*.cloudflare.com` and `*.workers.dev`

**Root cause identified — invisible Unicode chars in Google JWT email (commit `612458b`):**
- Karen's email IS `kmancebo@intransittech.com` (confirmed) and IS in `CONFIG.REP_EMAIL_MAP`
- The actual root cause: Google JWT `payload.email` can contain invisible Unicode characters (zero-width space U+200B, BOM U+FEFF, soft hyphen U+00AD, etc.) that appear identical visually but fail exact string comparison against the map key
- `setRepFromEmail()` completely rewritten to normalize email before lookup:
  - Filters characters to only printable ASCII (charCode 33–126), discarding all invisible/Unicode chars
  - Lowercases the result before map lookup
  - Logs both raw and normalized email + char codes to console when NOT IN MAP
  - Shows toast with the normalized email (not the raw one) so the actual mismatch is visible

**Belt-and-suspenders repId re-apply in `completeLogin()` (commit `9448909`):**
- Added guard after `_loginComplete` is set: if `state.repId` is still null but `state.user.email` exists, calls `setRepFromEmail()` again
- Covers any race condition where the email mapping ran before the email was fully loaded into state

**403 token refresh in `sheetsGetFrom()` (commit `e2979c8`):**
- Root cause: Google access tokens expire after 60 minutes; Worker returns 403 when token is expired; app had no auto-refresh in place for the Sheets proxy path
- Fix: `sheetsGetFrom()` on 403 now calls `refreshTokenSilent()` (uses `prompt: 'none'` — no popup) once; if refresh succeeds, retries the request; if refresh fails (e.g., no `tokenClient` for cached login path), shows clear toast "Session expired — please sign out and sign back in"
- `_retry='post403'` guard prevents infinite retry loop

**CSP expanded (commit `e2979c8`):**
- `connect-src` was missing `oauth2.googleapis.com`, `www.googleapis.com`, `sheets.googleapis.com` — all used by the Sheets/OAuth flow
- `script-src` was missing `apis.google.com`
- `font-src` expanded to include `data:`; `img-src` expanded to include `blob:`
- `frame-src` added `content.googleapis.com`
- Full updated CSP now allows all Google API resources the OAuth flow needs without CSP violations

**Result:**
- Karen fully working — sees "MANAGER — CKaren" in sidebar, her accounts load, view-as dropdown shows "My Accounts" + "MX Team View", Manager Hub / Team Notes / Team Profile nav items all appear
- All four commits: `3445fff` (diagnostic), `9448909` (belt-and-suspenders), `e2979c8` (403 refresh + CSP), `612458b` (email normalization root-cause fix)

### 2026-05-24 (session 18 — location modal fix)

**Bug fixed — location modal (HOME / OFFICE / TRAVEL / Other) not appearing on login:**
- **Symptom:** Users logged in without being asked to claim their location; Access Log showed "Known Location" instead of the actual place selected
- **Root cause:** `checkIPAndProceed()` had two branches — known IP → skip modal entirely + log "Known Location"; new IP → show modal. Once any IP was saved as known (after first confirmed login), the location selection was bypassed on all future logins from that IP
- **Intended behavior:** The modal should appear on **every** login so reps can claim HOME / OFFICE / TRAVEL / Other. The known-IP check should only suppress the red "This is a new location" security warning banner, not the modal itself
- **Fix:** Removed the auto-proceed branch from `checkIPAndProceed()`; now always calls `showLocationModal(isNewIP)` where `isNewIP` is `false` for known IPs (no red banner) and `true` for new IPs (red banner shown)
- **Commit:** `ad0da08`

### 2026-05-26 (session 19 — Supabase keep-alive + location modal)

**Supabase keep-alive cron (Cloudflare Worker):**
- Supabase free tier pauses projects after 7 days of inactivity — app currently has 0 Supabase requests (still reading from Sheets)
- Added daily cron trigger (`0 12 * * *` = noon UTC / 7 AM Eastern) to `intransit-worker`
- Added `scheduled()` handler in `index.js` — pings `https://hutmehcaijdxbqchuivh.supabase.co/rest/v1/` with anon key header; logs result to console
- `SUPABASE_ANON_KEY` added as Worker secret via `wrangler secret put`
- `wrangler.toml` updated with `[triggers] crons = ["0 12 * * *"]`
- Deployed — Supabase project will never pause while Worker is live

**Bug fixed — location modal (HOME / OFFICE / TRAVEL) skipped for known IPs (commit `ad0da08`):**
- See session 18 entry above

### 2026-05-26 (session 20 — Access Log v2, Manager Hub Intel, CRM sync indicator)

**Access Log v2 — 7 improvements (commit `b0159ed`):**
- **Date range filter:** 7D / 30D / 90D / ALL TIME toggle — scopes all stats and table to selected window
- **Rep filter dropdown:** filter the entire log to one rep
- **Search box:** live search across email, IP, city, org, location
- **Per-rep summary cards:** one card per rep showing last login date+location, sessions this month, usual location, LOW/MEDIUM/HIGH risk badge (HIGH = any suspicious flag, MEDIUM = 3+ anomalies, LOW = clean)
- **30-day activity chart:** SVG bar chart — blue = normal days, amber = anomaly days, red = suspicious days
- **Enhanced anomaly tagging:** every row gets auto-tagged: `🌙 AFTER HRS` (before 6am/after 10pm), `📅 WEEKEND`, `📱 NEW DEVICE` (first time rep used this device+browser combo), `🌍 MULTI-LOC` (same rep, two cities on same day). Tags shown as color-coded badges on each row.
- **AI Security Brief:** purple button → AI reads last 30 days of filtered logs, returns plain-English summary: overall posture, per-rep patterns, action recommendations (claude-haiku-4-5-20251001)
- **AI Row Explainer:** 🤖 button on every row → AI explains risk level (Low/Medium/High), whether anomaly flags are concerning, and recommended action
- **Pagination:** 50 rows per page with page navigation; "Showing X–Y of Z records" counter
- **New filter buttons:** AFTER HRS / WEEKEND / NEW DEVICE / MULTI-LOC / ⚡ ANY ANOMALY added alongside existing location filters
- **6th KPI card:** Anomalies count added alongside Total, Today, Unique Users, Unique IPs, Suspicious
- **Functions added/replaced:** `renderAccessLog`, `_alTagAnomalies`, `_alBuildView`, `_alRepCards`, `_alBuildChartData`, `_alActivityChart`, `_alApplyFilters`, `_alRenderTable`, `accessLogDateRange`, `accessLogRepFilter`, `accessLogSearch`, `accessLogLocFilter`, `accessLogSetPage`, `accessLogAIBrief`, `accessLogAIRow`, `filterAccessLog` (shim), `exportAccessLog`

**Manager Hub — Account Intel tab (commit `4d23ac5`):**
- New **🔍 Account Intel** tab added to Manager Hub tab bar
- Designed for Karen (MX Team manager) to look up pre-transfer account history
- **Quick Access buttons** for 6 transferred accounts: San Luis Metal, Siemens, Martinrea, Porta Systems, Navistar, Thyssenkrupp
- **Search box** — type any account name to look up
- **Revenue by Year (All Reps):** searches all 22K `gpCache` records by BUYER_NAME fuzzy match; groups by year with horizontal bar chart; shows per-rep revenue breakdown — includes pre-transfer years under Abraham/Arlin alongside MX team years
- **Top Recurring Parts:** searches `historyCache` for matching account; shows part number, description, order count, total revenue, last sold date (top 12)
- **🤖 Build Outreach Strategy:** AI generates re-engagement plan for that account — best angle, email subject line, opening paragraph referencing actual purchase history, top 2-3 parts to lead with (claude-haiku-4-5-20251001)
- **Note:** `historyCache` line items cover current-rep assignments only (1,969 records); pre-transfer line items not available unless `sales_report.py` SQL is expanded. GP revenue by year covers all history.
- **New functions:** `_mgrIntelHtml`, `mgrIntelLookup`, `mgrIntelAI`
- **Constant added:** `_MGR_INTEL_TARGETS` = list of Karen's transferred target accounts

**CRM last sync indicator in sidebar (commit `5cb1e97`):**
- All users see "CRM DATA / [timestamp]" at the bottom of the sidebar nav, just above Sign Out
- Reads `_LOG!A1:F500` from Main sheet; finds most recent row where col B is numeric (Python script log format: `RUN_DATE, TOTAL_ACCOUNTS, INACTIVE, AT_RISK, ACTIVE, NOTE`)
- Timestamp formatted as human-friendly: "May 26, 2:30 PM"
- Color-coded freshness: white = fresh (<2 hrs), amber = stale (2–8 hrs), red = very stale (>8 hrs — possible scheduler issue)
- Loads non-blocking after login alongside `loadCustomerDirectory`
- `state._lastCRMSync` stores the parsed run data for use elsewhere
- **New function:** `loadLastRunTime()`

### 2026-05-26 (session 21 — Account Intel search fix)

**Bug fixed — Account Intel quick-access buttons returning no results (commit `88a3a33`):**
- **Root cause 1:** `mgrIntelLookup` only searched `gpCache` by `BUYER_NAME` — never searched `state.accounts` by account name. The quick-access button labels ("San Luis Metal", "Siemens", etc.) are partial/informal names; the actual account names in the app differ (e.g., "San Luis Metal Stampings S.A." or similar). Since gpCache BUYER_NAME also stores the CRM-exact name, partial matches failed.
- **Root cause 2:** AND-word matching (`qWords.every(...)`) required ALL words to appear in the BUYER_NAME. Multi-word searches like "San Luis Metal" required "san", "luis", AND "metal" — any variation in the stored name caused zero results.

**Fix:**
1. **Searches `state.accounts` by account name first** — the full list of accounts in the manager/admin view. Shows matching accounts as clickable cards with an **OPEN ACCOUNT** button (`selectAccountByName`) that navigates directly to that account's detail view.
2. **OR-word fallback** — if AND-match finds nothing in either source, retries with any-word (OR) matching using words >3 chars. Result is marked "(broad match)" so Karen knows it's a fuzzy result.
3. **"Did you mean?" suggestions** — when nothing is found at all, scores all `state.accounts` by word overlap and shows the top 6 closest names as clickable buttons.
4. **historyCache lookup extended** — also tries matched account names (not just the raw query string) when searching for top recurring parts.
5. **GP buyer name list** — header now shows the actual BUYER_NAME variants found in the data (e.g., "SAN LUIS METAL STAMPINGS") so Karen can see what the CRM calls the account.

**How Account Intel now works:**
- Click "Siemens" → finds any account in `state.accounts` whose name contains "siemens" → shows OPEN ACCOUNT → also shows all GP revenue for all BUYER_NAMEs containing "siemens" across all years
- If exact name found in accounts, the historyCache lookup also tries that full name for top parts
- If nothing matches, suggested account names from the app appear as buttons to try

**`sales_report.py` scheduling note:**
- Script runs on INTRANSIT-RDS02; last run was May 26 at 8:08 AM (visible in sidebar CRM DATA indicator)
- To automate: on INTRANSIT-RDS02, create a Windows Task Scheduler task running `python C:\scripts\sales_report.py` every 30 minutes, logging to `C:\scripts\logs\sales_report.log`
- Claude Code installed on INTRANSIT-RDS02 (PS7 installed via MSI, `claude` runs in pwsh) — can be used to work with SQL and task scheduler directly on the server
- Scheduled task setup attempted via Claude Code on RDS02 (session 21)

### 2026-05-26 (session 22 — BillP added to MX Team + FJohn pipeline fix)

**Bug fixed — FJohn accounts appearing in Manager Hub Pipeline (commit `d5dae50`):**
- **Root cause:** Admin Manager Hub fallback (`mgrCfg` null → no active manager simulation) used `CONFIG.REPS` which includes `'FJohn'`. FJohn is admin, not a sales rep, so he appeared in Pipeline/Scoreboard/Collections when admin viewed Manager Hub without a manager simulation active.
- **Fix:** Added `.filter(function(r){ return r !== 'FJohn'; })` to the admin fallback in `renderManagerHub()` — FJohn is now excluded from all Manager Hub tabs regardless of view mode.

**BillP added to MX Team (commit `d5dae50`):**
- `MANAGER_CONFIG` updated — BillP added to `teamReps` for all three manager roles: `CKaren`, `CMancilla`, `MPerezfreye`
- Previous teamReps: `['CKaren','PIan','RMauricio','LMancera','bcastor']`
- New teamReps: `['CKaren','BillP','PIan','RMauricio','LMancera','bcastor']`
- BillP now appears in Manager Hub Scoreboard, Pipeline, Collections, AI Brief, and Coaching tabs for all manager views

### 2026-05-26 (session 23 — RDS02 Claude setup + scripts_CLAUDE.md + Karen transfer history plan)

**Claude Code installed on INTRANSIT-RDS02:**
- PowerShell 7 installed via MSI (`C:\temp\pwsh7.msi`) — required because Claude Code needs PS7 or Git bash; Windows Server doesn't have winget so installed via `(New-Object Net.WebClient).DownloadFile(...)`
- Claude Code installed via `npm install -g @anthropic-ai/claude-code` in original PS5 window; runs in `pwsh` (PS7)
- Logged in as John Fluman (Intransittech Claude Team plan)

**`scripts_CLAUDE.md` created and deployed:**
- File: `C:\Users\fluma\sales-app\scripts_CLAUDE.md` in repo (commit `3b16adc`)
- Downloaded to RDS02 at `C:\scripts\CLAUDE.md` via `(New-Object Net.WebClient).DownloadFile("https://raw.githubusercontent.com/johnfluman-tech/sales-app/main/scripts_CLAUDE.md","C:\scripts\CLAUDE.md")`
- Contains: SQL schema, key table/column rules, rep mappings, Google Sheets IDs and tab structure, sales_report.py overview, scheduler config, pending _TRANSFER_HISTORY task with suggested SQL
- Claude on RDS02 confirmed it read the file successfully
- **Sync workflow:** When Claude on RDS02 learns something new → update `C:\scripts\CLAUDE.md` there → tell Claude here → commit to GitHub to keep both in sync

**Memory system clarification:**
- Claude on RDS02 has its own local memory at `C:\Users\managerman\.claude\projects\...` — only visible to RDS02 sessions
- Claude here has memory at `C:\Users\fluma\.claude\projects\...` — only visible here
- `C:\scripts\CLAUDE.md` is the shared bridge — source of truth for both instances

**Karen's pre-transfer history — plan confirmed:**
- Karen needs: revenue + top recurring part numbers for 6 transferred accounts (San Luis Metal, Siemens, Martinrea, Porta Systems, Navistar, Thyssenkrupp) from BEFORE MX team took them over (Abraham/Arlin era)
- Gap: `_INVOICE_HISTORY` only covers current-rep accounts — pre-transfer line items (part numbers) are missing
- Plan: add `push_transfer_history_tab()` to `sales_report.py` using suggested SQL in `scripts_CLAUDE.md`; writes `_TRANSFER_HISTORY` tab to History sheet
- Claude on RDS02 has been asked to run the SQL query to verify row counts before modifying sales_report.py
- Account Intel tab in Manager Hub will be updated to read `_TRANSFER_HISTORY` once populated

**Account Intel search fix (commit `88a3a33`):**
- `mgrIntelLookup` now searches `state.accounts` by name first, then `gpCache` by BUYER_NAME
- OR-word fallback when AND-match finds nothing; "Did you mean?" suggestions from state.accounts
- OPEN ACCOUNT button on each matched account card → calls `selectAccountByName()`

### 2026-05-26 (session 24 — Collections total fix + Account Intel before/after comparison)

**Bug fixed — Manager Hub Collections grand total inflated (commit `315f93b`):**
- **Root cause:** `collEntries` in `_mgrCollectionsHtml` included orphaned entries where `state.accounts.find()` returned null (account name matched `teamAccNames` via case-insensitive lookup but rep couldn't be assigned). These entries had `rep: ''` and counted in `totalAR` but not in any per-rep badge — causing grand total > sum of badges.
- **Fix:** After building `collEntries`, added filter: `collEntries = collEntries.filter(function(c){ return teamReps.indexOf(c.rep) !== -1; });` — only entries with a recognized team rep are counted. Grand total now equals the exact sum of per-rep badge amounts.

**Feature added — BEFORE / AFTER MX TEAM comparison card in Account Intel (commit `315f93b`):**
- Added to `mgrIntelLookup()` — appears between the matching account cards and the revenue-by-year chart
- Splits `gpRows` by `mxTeamReps` (from `getManagerConfig().teamReps`, falls back to hardcoded MX list): `preRows` = non-MX reps (Abraham/Arlin era), `postRows` = MX reps
- Shows two-column comparison: BEFORE MX TEAM ($amount, years, rep names) vs SINCE MX TEAM ($amount, years)
- Center column: trend arrow (↑ green / ↓ red) + % change — only appears if both sides have data
- "No prior data" label when no pre-MX history; "no shipments yet" when MX team hasn't shipped yet
- New computed variables: `mxTeamReps`, `preRows`, `postRows`, `preTotal`, `postTotal`, `preYears`, `postYears`, `preReps`, `comparisonHtml`

### 2026-05-26 (session 25 — Account Intel full rebuild + CRM sync indicator)

**Feature: CRM sync indicator — relative time + auto-refresh (commit `aba3717`):**
- Sidebar label changed from "CRM DATA" to "DATA LAST UPDATED", font 12px bold
- Shows relative time: "30 min ago", "2 hrs ago", "just now" instead of absolute timestamp
- `_updateCRMSyncDisplay()` — recalculates age every 60s via `window._crmDisplayTimer` (no re-fetch needed)
- `loadLastRunTime()` re-fetches from Sheets every 15 min via `window._crmFetchTimer` to catch new script runs
- Colors: green (<1 hr), amber (1–8 hrs), red (>8 hrs = scheduler issue)

**Feature: Account Intel — pre-transfer outreach list with year-prior filter (commit `94f8ff1`):**
- `_mgrIntelTransferPartsHtml()`: identifies transfer year by finding earliest year current rep appears in `_TRANSFER_HISTORY` line items; filters parts to **year prior** to transfer only (falls back to all pre-transfer if no data for that year)
- Numbered rank table (#1–15), top 3 rows highlighted, part numbers in gold amber, orders shown as "Nx"
- **📋 COPY LIST button** → `copyTransferPartsList()` writes formatted plaintext to clipboard with header, year label, export date — Karen can paste directly into email or spreadsheet
- Section reordered to appear FIRST (hero section) before revenue chart
- Current rep top parts section hidden when empty (irrelevant for transferred accounts)

**Feature: Account Intel — rep transition analysis (commits `891f299`, `29131d0`):**
- `_mgrCurrentRepPerfHtml(accMatches, currentRepId, currentRepName, currentRepRows, priorRepId, priorRepName, gpRevCol, gpDateCol, gpRepCol)` — new function showing current rep performance since taking over
- Rep badge: initials circle, name, "Has this account since [year]", "Previously: [prior rep] held this account"
- Year-by-year bar chart of current rep's revenue + GP% (green ≥20%, amber ≥12%, red below); current year shown in blue
- Trend: % change vs prior full year (↑ green / ↓ red)
- Comparison card replaced: no longer says "BEFORE MX TEAM / SINCE MX TEAM" — now says "UNDER [PRIOR REP]" vs "UNDER [CURRENT REP]" based on actual invoice data
- `currentRepId` derived from `state.accounts` match or most recent GP invoice (whoever is invoicing NOW)
- `priorRepId` = rep with highest total revenue before current rep took over (e.g. Abraham, Arlin)
- `_mgrIntelTransferPartsHtml` updated to use `currentRepId` instead of hard-coded MX rep list for pre/post split
- Outreach list label: "WHAT THEY WERE BUYING BEFORE [CURRENT REP] TOOK OVER"

**Bug fixed — Account Intel GP search failing for some accounts (commit `7aef58b`):**
- When gpCache BUYER_NAME AND/OR-match returns empty, now tries a third fallback: exact account names from `accMatches` + `displayName` from matching `transferHistoryCache` entry, using OR-word matching
- Catches cases where account's legal CRM name (e.g., "NAVISTAR DE MEXICO S.A.") differs from the short search query ("Navistar")
- "No GP records" message updated to explain mismatch and suggest asking John to check the _GP tab buyer name

**Section order in Account Intel after these changes:**
1. Header (account name, total all-time revenue)
2. Matching account cards (OPEN ACCOUNT button)
3. CURRENT REP PERFORMANCE SINCE TAKING OVER (rep badge + year-by-year bars)
4. ACCOUNT REVENUE — REP COMPARISON (prior rep vs current rep aggregate)
5. ★ OUTREACH LIST — WHAT THEY WERE BUYING BEFORE [REP] TOOK OVER (📋 COPY LIST)
6. REVENUE BY YEAR — ALL REPS chart
7. TOP PARTS — CURRENT REP (hidden if empty)
8. AI OUTREACH STRATEGY button

**New functions:** `_mgrCurrentRepPerfHtml`, `copyTransferPartsList`, `_updateCRMSyncDisplay`
**Modified functions:** `mgrIntelLookup` (rep transition analysis, GP search fallback), `_mgrIntelTransferPartsHtml` (currentRepId param), `loadLastRunTime` (intervals added)
**Commits:** `aba3717` (CRM sync), `94f8ff1` (outreach list), `891f299` (current rep perf), `29131d0` (rep transition), `7aef58b` (GP fallback)

### 2026-05-26 (session 26 — Account Intel synthetic gpRows + text label fixes)

**Bug fixed — Account Intel blank for accounts not in gpCache BUYER_NAME (commit `babe8d7`):**
- **Root cause:** For accounts like Siemens, gpCache BUYER_NAME stores a different legal entity name (e.g., "SIEMENS SA DE CV") than the search query or account name in `state.accounts`. All three gpCache fallbacks (AND-match, OR-match, extra-names via transferHistoryCache displayName) returned empty rows. This caused:
  1. "CURRENT REP PERFORMANCE — No shipments on record for Ian Pitman on this account yet."
  2. "No GP revenue records matched this account name." in the comparison card
  3. Revenue-by-year chart showing nothing
- **Fix:** Added 4th fallback in `mgrIntelLookup` — when `gpRows` is still empty after all gpCache attempts, searches `state.transferHistoryCache` by normalized query + accMatch names, then **synthesizes gpRows** from `_TRANSFER_HISTORY` lines (each line → a gpRow with rep, date, revenue). Since `_TRANSFER_HISTORY` contains ALL years ALL reps for the 6 target accounts (Abraham/Arlin pre-transfer + Ian/MX post-transfer), all downstream sections now work: year-by-year bars for Ian, Abraham vs Ian comparison, revenue chart.
- Console log: `[INTEL] Synthesized N gpRows from _TRANSFER_HISTORY for: [account]`

**Bug fixed — "WHAT THEY WERE BUYING BEFORE PIAN TOOK OVER" (commit `babe8d7`):**
- `_mgrIntelTransferPartsHtml` header label used `(currentRepId||'current rep').toUpperCase()` → produced "PIAN" not "IAN PITMAN"
- Added `_repNames` map to `_mgrIntelTransferPartsHtml` scope; label now uses `_repNames[currentRepId]` → "IAN PITMAN"

**Bug fixed — "year before MX team took over" in yearLabel (commit `babe8d7`):**
- yearLabel string hardcoded "MX team" — now uses actual rep name: `'year before Ian Pitman took over (2023)'`
- `copyTransferPartsList()` subtitle also fixed from "before MX team took over in 2023" → "before Ian Pitman took over in 2023"
- `window._intelTransferParts` now stores `currentRepId` and `currentRepName` so copy function can use them

**How the 6 target accounts now work end-to-end:**
- Karen clicks "Siemens" → `mgrIntelLookup('Siemens')`
- `state.accounts` finds "Siemens, S.A. de C.V." → `currentRepId = 'PIan'`
- gpCache returns 0 rows (BUYER_NAME mismatch) → 4th fallback kicks in, synthesizes 800+ gpRows from `_TRANSFER_HISTORY`
- `currentRepRows` = Ian's rows (2023–2026), `priorRows` = Abraham's rows (2019–2022)
- `_mgrCurrentRepPerfHtml` renders Ian's year-by-year bars with GP% and trend vs prior year
- `comparisonHtml` shows "UNDER ABRAHAM" vs "UNDER IAN PITMAN" with % change
- `_mgrIntelTransferPartsHtml` shows top 15 parts from 2022 (year before Ian took over in 2023)
- Header reads: "WHAT THEY WERE BUYING BEFORE IAN PITMAN TOOK OVER"
- yearLabel: "2022 — year before Ian Pitman took over (2023)"

### 2026-05-26 (session 27 — Tasks 1–4: Pool UI cleanup, Requests page redesign, CRM accounts, Request Log)

**Task 1 — Removed "POOL VISIBILITY — ADMIN" block from Notes tab:**
- Removed `johnPoolHtml` variable and its `${johnPoolHtml}` usage from `renderNoteInput` return template
- `adminSetPoolHide()` function retained — still used by Attack Plan pool filter logic (lines ~11104, 13030, 13072, 13098)
- Pool hide/restore is now only accessible via Attack Plan pool cards, not the Notes tab

**Task 2 — Attack Plan modal + Requests & Approvals page redesign:**
- Attack Plan modal: replaced "🚫 REQUEST REMOVE FROM POOL" button with "🚫 REQUEST TO HIDE FROM APP" — routes through `showQuickHideRequest()` → `submitHideRequest()` → REMOVE_FLAG column → admin approval (same path as Notes tab request)
- `renderRemovalsView()` completely rewritten: loads all request data into `window._reqData`, defers rendering to `_reqRenderPage()`
- `_reqRenderPage()` — new function: 4 KPI cards (Needs Approval / Info+CRM / Accounts Hidden / NDA Records); tab bar (PENDING REVIEW / APPROVED+HIDDEN / NDA LOG); filter chips (All Types / Hide / Hold / Transfer)
- `removeCard()` — rich hide-request card: rep initials circle, color-coded border, rep's reason quote block, APPROVE HIDE + DENY buttons via `data-n`
- `infoCard()` — rich hold/transfer card: same visual language, action box shows CRM instructions
- APPROVED/HIDDEN tab: hidden accounts (UNHIDE) + globally removed accounts (RESTORE TO POOLS)
- NDA LOG tab: table + CSV export
- `reqSwitchTab(tab)` + `reqSetFilter(f)` — helper functions for tab/filter state without re-fetching data
- Python binary-mode replacement script used for the 320-line function rewrite

**Task 3 — All CRM accounts visible in Accounts view:**
- Filter buttons changed: ALL → "ALL CRM" (shows all CRM accounts merged with shipped); SHIPPED → revenue accounts only; ACTIVE/INACTIVE/DECLINING apply to shipped accounts only
- `getViewAccounts()` updated: when `activeFilter === 'all'`, merges `state.customerDirectory` accounts not already in `state.accounts` as `_crmOnly` stubs; respects `_repFilter` and `_repList` for team/rep scoping
- `renderAccountsView()`: CRM-only rows render at 72% opacity with "CRM" badge, city/state, last activity, "No shipments" amount; count strip shows "X shipped + Y CRM accounts"
- `selectAccount()`: CRM-only accounts branch to `renderCRMOnlyDetail(acc)` — shows account name, rep, city/state, last CRM activity, "ADD TO PROSPECTS" button
- `loadCustomerDirectory()`: after load, re-renders accounts view if filter is 'all' and tbody exists (fixes timing — directory loads async after initial render)
- `switchViewAs()`: resets `state.activeFilter = 'all'` on every rep switch so each view starts showing full CRM pool
- Anolan had 20 shipped accounts visible before; now shows all 700+ CRM accounts in ALL CRM filter

### 2026-05-26 (session 27 — Task 4: Request Log + deny-with-note)

**Features added (commit `9e49d5c`):**

**New `_REQUEST_LOG` tab in History sheet:**
- `writeRequestLog(type, account, repId, reason, status)` — appends PENDING row to `_REQUEST_LOG` in History sheet (columns: TIMESTAMP, TYPE, ACCOUNT, REP, REASON, STATUS, ADMIN_NOTE)
- `resolveRequestLog(type, account, repId, status, adminNote)` — appends `TYPE_RESOLVED` row when admin approves or denies
- Both functions are fire-and-forget (`.catch(function(){})`) — failure doesn't block the UI action

**Wired into all request flows:**
- `submitHideRequest()` — writes PENDING HIDE row to `_REQUEST_LOG` when rep submits
- `apkDoRequestTransfer()` — writes PENDING TRANSFER row to `_REQUEST_LOG` when rep submits
- `approveRemovalDirect()` — writes HIDE_RESOLVED / APPROVED after hiding account
- `denyRemoval()` — writes HIDE_RESOLVED / DENIED with admin note after denying

**Deny with admin note:**
- `showDenyHideModal(accountName)` — modal with textarea for admin note; calls `denyRemoval(name, note)`
- `denyRemoval(accountName, adminNote)` — updated signature; removes REMOVE_FLAG from sheet; writes DENIED to log; no longer uses `confirm()` dialog
- `showDenyTransferModal(accName, repEmail)` — modal with textarea for admin note; calls `denyTransferRequest(name, email, note)`
- `denyTransferRequest(accName, repEmail, adminNote)` — writes TRANSFER_DENIED to `_LOG` + DENIED to `_REQUEST_LOG`
- Requests page `infoCard` for TRANSFER type now shows "✗ DENY" button → `showDenyTransferModal()`
- Requests page `removeCard` DENY button now calls `showDenyHideModal()` (was calling `denyRemoval()` directly with no note)

**New "My Requests" sidebar nav + view (all users):**
- `nav-request-log` nav item in System section — visible to all logged-in users
- `renderRequestLogView()` — reads `_REQUEST_LOG` from History sheet; shows KPI cards (PENDING/APPROVED/DENIED counts); status-colored cards showing account, type, rep, reason, admin note
- Admin: sees all requests + inline APPROVE HIDE / DENY buttons (re-use existing approve/deny functions)
- Rep: sees only own requests filtered by `state.repId`
- DENIED cards show action buttons: "↩ RE-REQUEST TRANSFER" (goes to Attack Plan) or "↩ RE-REQUEST HIDE" / "🚫 REQUEST HIDE INSTEAD" (calls `showQuickHideRequest`)

**New functions:** `writeRequestLog`, `resolveRequestLog`, `showDenyHideModal`, `showDenyTransferModal`, `denyTransferRequest`, `renderRequestLogView`
**Modified functions:** `denyRemoval` (new adminNote param + modal flow), `approveRemovalDirect` (+ resolveRequestLog), `submitHideRequest` (+ writeRequestLog), `apkDoRequestTransfer` (+ writeRequestLog), `infoCard` in `_reqRenderPage` (+ deny button for TRANSFER), `removeCard` in `_reqRenderPage` (DENY now calls showDenyHideModal)

**Setup required:** `_REQUEST_LOG` tab will auto-create in History sheet on first request submit (sheetsAppend creates the tab if it exists; if not, create tab manually with header: `TIMESTAMP, TYPE, ACCOUNT, REP, REASON, STATUS, ADMIN_NOTE`)

**Bug fixed — JS syntax error crashing entire app (commit `11d251a`):**
- `infoCard` deny button used `\'@intransittech.com\'` (backslash-escaped quote) in expression context — valid inside a JS string literal but a hard SyntaxError at expression level; caused the entire `<script>` block to fail parsing, making the app completely non-functional
- Fix: switched to `data-rid` attribute (repId only, no email concatenation needed in template); `showDenyTransferModal(accName, repIdOrEmail)` now accepts either repId or full email — appends `@intransittech.com` if `@` is absent

### 2026-05-26 (session 28 — Hidden Accounts view + Return Requests + manager canEdit + CRM pool fixes)

**Features added (commit `c294fc5`):**

**Hidden Accounts nav + view:**
- New `nav-hidden-accounts` (🔒) in sidebar System section — visible to all logged-in users
- `renderHiddenAccountsView()` — scopes to rep (own accounts), manager (teamReps accounts), admin (redirect to Requests & Approvals)
- Badge shows count of hidden accounts in scope
- Each card has **↩ REQUEST RETURN** button

**Return Request flow:**
- `showReturnRequestModal(accName)` — modal with reason textarea
- `submitReturnRequest(accName, reason)` — calls `writeRequestLog('RETURN', ...)` to `_REQUEST_LOG`
- `approveReturnRequest(accName, repId)` — calls `unhideAccount()` + `resolveRequestLog()` + re-renders Requests page
- RETURN type wired throughout: `renderRequestLogView` shows orange ↩ tag with APPROVE RETURN (admin) / RE-REQUEST RETURN (rep) buttons
- Admin Requests & Approvals: RETURN filter button added; orange `returnCard()` function; `renderRemovalsView` loads RETURN rows from `_REQUEST_LOG`

**Manager canEdit fix:**
- `renderNoteInput`: `canEdit` now includes managers for their team reps — `const mgrCfg = getManagerConfig(); const canEdit = state.isAdmin || acc.rep === state.repId || (!!mgrCfg && mgrCfg.teamReps && mgrCfg.teamReps.includes(acc.rep));`
- Karen can now submit hide requests for PIan, RMauricio, LMancera, bcastor accounts

**MX Team view fix (getViewAccounts CRM pool):**
- `getViewAccounts()` now builds `hiddenNames` Set from `state.hiddenAccounts` and filters CRM pool to exclude them
- Previously hidden accounts appeared as CRM-only stubs (📊 CRM badge) in __TEAM_ALL__ view — now correctly excluded

**Attack Plan CRM pool fixes:**
- CRM lastActivity `1753-01-01 00:00:00` (SQL Server min date) now filtered: `_crmAct` only shown if not starting with `'1753'`; also truncated to date-only (10 chars)
- `apkOpenAccount()`: when clicked account is CRM-only (not in `state.accounts`), now sets filter to 'all' + shows info toast instead of "not found" error

**Academy updates:**
- t1-1 SVG sidebar diagram: expanded from 280→360px height; added Prospects 🎯, My Requests 📋, Hidden Accounts 🔒 nav items with callout lines
- t3-5 lesson: completely rewritten — now covers hide request flow (Notes tab → REQUEST HIDE), My Requests tracking, Hidden Accounts view, Request to Return flow; uses `acadSteps()` with 5 numbered steps

**New functions:** `renderHiddenAccountsView`, `showReturnRequestModal`, `submitReturnRequest`, `approveReturnRequest`
**New nav:** `nav-hidden-accounts` (🔒 Hidden Accounts)
**Modified functions:** `renderNoteInput`, `getViewAccounts`, `renderRemovalsView`, `_reqRenderPage`, `renderRequestLogView`, `apkCardHtml` (CRM date fix), `apkOpenAccount` (CRM click fix)

### 2026-05-26 (session 29 — Multi-agent audit + 6 targeted improvements)

**Audit methodology:**
- Spawned 4 parallel AI agents (Explore agents) to review all views simultaneously:
  1. My Accounts, Account Detail (Info/History/Notes/Contacts tabs), Collections
  2. Attack Plan, Prospects, Daily Mission
  3. Manager Hub, Dashboard, Team views, Auth flow
  4. Requests & Approvals, Hidden Accounts, My Requests, Access Log, Academy, Settings
- Each agent returned numbered issue lists with line numbers and function names
- Verified reported bugs against actual code before implementing (many audit flags were false positives)

**Confirmed bugs fixed:**
- **Location modal new IP warning not showing:** `showLocationModal(isNewIP)` accepted the `isNewIP` parameter but never used it. Fixed: shows/hides `loc-new-ip-warn` div based on `isNewIP`.
- **Zone dates persist after plan reset:** `apkConfirmReset()` cleared `window.apkState` but not `window.apkZoneDates`. Fixed: clears zone dates + removes localStorage key on reset.

**UX improvements added:**
- **Sort direction arrows:** `sortAccountList()` now appends UP or DOWN arrow to the active sort button (NAME UP, VALUE DOWN, etc.).
- **Team Profile cards clickable:** Rep cards in `renderTeamProfile()` now have onclick to navigate to that rep's accounts view. Shows "VIEW ->" label and hover highlight.
- **Unsaved note indicator:** Gold "UNSAVED" dot added after SAVE & LOCK button in Notes tab. Appears when user types; hidden when re-rendered after save.
- **Force Data Refresh in Settings:** New "Data & Cache" card in Settings with Refresh All Data button. Calls `refreshAllData()` which clears all cache objects and re-runs `ensureCacheLoaded()`. Shows cache status (GP rows count, history rows count).

**New functions:** `refreshAllData`
**Modified functions:** `showLocationModal` (isNewIP finally used), `apkConfirmReset` (zone dates cleared), `sortAccountList` (direction arrows), `renderTeamProfile` (clickable cards), `renderNoteInput` (unsaved dot), input event listeners (dot show/hide)
**Commit:** `1eb82f2`

### 2026-05-27 (session 30 — Account Intel fixes + Requests cleanup + Pool Management)

**Account Intel — wrong company data (Ontic/Zebra):**
- **Root cause (Ontic):** gpCache 2nd fallback OR-match returned "Ozkon Inc." before 3rd fallback ran; safety net used ALL qWords including "inc" which matched "Ozkon **Inc**." — Round 1 fix (stop-words) wasn't enough
- **Root cause (Zebra):** historyCache 5th fallback had same OR-match problem — "technologies" from "Zebra Technologies" matched "Neros Technologies"
- **Fix Round 3:** Changed safety net to use distinctive-word-filtered qWords only; changed historyCache 5th fallback to AND-only matching (no OR fallback). Resolved both Ontic and Zebra.
- **Stop-word list** applies in: 3rd gpCache fallback AND-match, safety net distinctive-word check, historyCache 5th fallback — all must use the same `_gwStop` regex

**Account Intel — autocomplete:**
- `mgrIntelAutocomplete(val)` — triggers on oninput after 2 chars; scores accounts: exact prefix=100, substring=80, all-words=60, any-word=30; shows up to 12 results with rep + YTD revenue in dropdown
- `mgrIntelKeydown(event)` — arrow nav, Enter selects, Esc closes
- `mgrIntelAcHover(i)` / `mgrIntelSelect(name)` — hover highlight + fill input + trigger search
- Input wrapped in `position:relative` div; dropdown `#mgr-intel-ac` absolutely positioned below

**Note history deduplication:**
- `loadNoteHistory(tab)` was called once per tab → 8× duplication for admin
- Fixed: removed call from per-tab loop; call `loadNoteHistory()` once after all tabs finish
- Function signature changed: `async function loadNoteHistory()` (tab param removed — was never used)

**Hidden accounts not persisting in Requests & Approvals:**
- `_HIDDEN_ACCOUNTS` tab has NO header row; `loadHiddenAccountsTab()` was checking for 'ACCOUNT_NAME' header and returning empty Set when not found
- Fixed: detect header vs data row positionally — `hasHeader = firstRow[0] === 'ACCOUNT_NAME' || firstRow[2] === 'STATUS'`; if no header, `dataRows = rows` (no slice)

**Requests & Approvals — HOLD/TRANSFER/RETURN dismissal:**
- HOLD requests had no dismiss mechanism; added DONE IN CRM + NOT NEEDED buttons → `resolveHoldRequest(accName, repId, status)`
- TRANSFER requests reappeared after deny because page re-reads `_LOG` on every render; fixed by building `resolvedSet` from `_REQUEST_LOG` and filtering during `allItems` construction
- RETURN card DENY called `denyRemoval()` (wrong); fixed to `denyReturnRequest()` which calls `resolveRequestLog()`
- New functions: `resolveHoldRequest`, `denyReturnRequest`

**Pool Management feature (commit `c2bc937`):**
- **`nav-pool-management`** (admin/manager only): "🏊 Pool Management" — shows all inactive/declining accounts for the team; admin can mark AVAILABLE/HIDDEN, set Hot/Warm/Cold priority, assign to specific rep or ALL reps
- **`nav-available-pool`** (all reps): "🏆 Available Accounts" — shows AVAILABLE accounts assigned to them or ALL; CLAIM button marks it for them; NOT INTERESTED dismisses it
- Data persists to `_POOL_MANAGED` tab in History sheet — **create this tab manually with header row: `ACCOUNT_NAME, SOURCE_REP, PRIORITY, STATUS, ASSIGNED_TO, APPROVED_BY, APPROVED_DATE, NOTES`**
- STATUS values: AVAILABLE, HIDDEN, CLAIMED, REMOVED
- `loadPoolManaged(force)` — loads on startup non-blocking; caches in `state.poolManagedCache`
- `poolSaveRecord(record)` — finds existing row by name and updates in-place, or appends new row
- `_updatePoolBadge()` — updates badge count on Available Accounts nav item
- `renderPoolManagementView()` — 3 sections: IN POOL, NEEDS REVIEW (bulk of inactive accounts), HIDDEN (collapsed details)
- `renderAvailablePoolView()` — sorted Hot→Warm→Cold; enriched with state.accounts data for revenue/status
- Nav visibility: shown for admin+manager in completeLogin; hidden in regular-rep simulation via switchViewAs
- `isInactive(a)` / `isDeclining(a)` — existing functions used to source the pool candidates

**New state field:** `state.poolManagedCache` (initialized to null, populated by `loadPoolManaged`)
**New functions:** `loadPoolManaged`, `_updatePoolBadge`, `poolSaveRecord`, `poolMarkAvailable`, `poolMarkHidden`, `poolSetPriority`, `poolAssignTo`, `poolRemoveFromPool`, `poolClaim`, `poolNotInterested`, `renderPoolManagementView`, `renderAvailablePoolView`
**Commit:** `c2bc937`

### 2026-05-28 (session 31 — Pool Management improvements)

**Pool Management — tabs, filters, audit trail (commit `8b833e5`):**
- Replaced single-page stacked layout with three tabs: **NEEDS REVIEW** (default), **IN POOL**, **HIDDEN**
- HIDDEN section is now always visible as a full tab — no longer collapsed in `<details>`; shows who hid each account and when
- IN POOL cards now show audit info: who added the account to pool and on what date
- Filter bar on every tab: search box (live), rep dropdown, sort (Revenue / Name / Last Sale / Rep)
- NEEDS REVIEW paginates at 50 rows with SHOW MORE button (long inactive lists no longer flood the screen)
- Audit trail: `poolLogAction(action, accName, detail)` — writes POOL_ACTION row to `_REQUEST_LOG` in History sheet with actor (state.repId) and timestamp; called from `poolMarkAvailable`, `poolMarkHidden`, `poolAssignTo`, `poolRemoveFromPool`
- Filter/sort state stored in `window._poolFilter` (`{ tab, rep, sort, search, page }`)
- New helper functions: `_poolMgmtState`, `poolMgmtTab`, `poolMgmtRep`, `poolMgmtSort`, `poolMgmtSearch`, `poolMgmtShowMore`, `poolLogAction`
