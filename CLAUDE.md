> At the end of every session, update this file: new files created, functions added, bugs fixed, new rules learned.

---

# 🚨 RULE 1 — NEVER BREAK THE APP WITH PYTHON-GENERATED JS

**The #1 cause of blank-page / syntax-error crashes:**

NEVER write JS string concatenation from a Python script where a comparison condition uses `\\'value\\'` escaping. This produces `\'value\'` in the JS file — valid inside a JS string literal, but a hard **SyntaxError** in expression context. The entire `<script>` block fails to parse and the app shows a blank page.

**BAD (crashes entire app):**
```python
NEW = "...background:'+(!w._tab||w._tab==\\'attention\\'?'var(--blue-b)':'transparent')+'..."
# Produces in file: w._tab==\'attention\'  ← SyntaxError
```

**GOOD — always pre-compute booleans in an IIFE:**
```javascript
(function(){
  var _attn = !window._tab || window._tab === 'attention';
  return '<button style="background:' + (_attn ? 'var(--blue-b)' : 'transparent') + '">...</button>';
})()
```

**Rule:** When building JS HTML strings in Python scripts, pre-compute ALL boolean conditions as variables at the top of an IIFE. Never embed `==`, `===`, `!==` comparisons against quoted string values inside the concatenated string.

**Also:** After any Python script edits the HTML file, always run:
```bash
python _extract_js.py && node --check _check.js
```
to verify no syntax errors before committing. (`_extract_js.py` writes to `_check.js`, not `extracted_js.js`.)

**Additional Python escaping gotchas:**
- Apostrophes in user-visible strings (e.g. `your team's`) inside JS single-quoted strings need `\\'` → produces `\'` in file → `'` in browser
- `onmouseover="this.style.X='value'"` — the inner quotes break the outer JS string. Use numeric assignments (`this.style.opacity=0.75`) or data-attribute lookups instead. Never embed CSS var() references inside inline event handlers written from Python scripts.
- When using `replace_between(start, end, new)` — always normalize CRLF → LF first (`content.replace('\r\n', '\n')`) before doing any find/replace

---

# ⚠ RULE 2 — CRITICAL: NEVER REGRESS THESE BEHAVIORS

These have broken multiple times. Do not break them again:

1. **Hidden accounts** — accounts hidden via Requests & Approvals (JOHN_APPROVAL='YES') must persist across page reloads. Two-layer system: (a) JOHN_APPROVAL column in rep tab, (b) `_HIDDEN_ACCOUNTS` tab in History sheet read by `loadHiddenAccountsTab()`. The tab has **NO header row** — `loadHiddenAccountsTab()` detects this and reads positionally [name, rep, status]. Do NOT add a header check that returns early. Do NOT change column order in `approveRemovalDirect()`.

2. **Note history deduplication** — `loadNoteHistory()` must be called **ONCE** after all tabs load, NOT once per tab. Called at the bottom of the `loadAllAccounts()` loop (after all tabs finish). Calling it per-tab multiplies every note by the number of tabs (8× for admin).

3. **_CONTACT_NOTES in History sheet** — all reads/writes must use `CONFIG.HISTORY_SPREADSHEET_ID`, never `CONFIG.SPREADSHEET_ID` (Main is at cell limit).

4. **applyLanguage() nav icons** — must walk `.nav-item-inner` childNodes and update only the text node. Never set `el.textContent` or `el.innerHTML` on `.nav-item` — destroys badges and icons.

5. **Account Intel generic-word matching** — stop-word list (`technologies`, `manufacturing`, `engineering`, `corporation`, `inc`, etc.) must be applied in the safety net AND in the historyCache 5th fallback. "Zebra Technologies" → distinctive word = "zebra" only. Never remove this filtering.

---

# ⚠ RULE 3 — DEPLOY & FILE EDITING

- **Always edit working copy first:** `C:\Users\fluma\intransit_app.html`
- **Deploy to repo:**
  ```powershell
  cd C:\Users\fluma\sales-app
  Copy-Item C:\Users\fluma\intransit_app.html .
  git add intransit_app.html && git commit -m "msg" && git push
  ```
- **NEVER use PowerShell `Set-Content` on HTML** — silently corrupts UTF-8 (BOM, encoding loss)
- **Always use Python binary mode** for programmatic edits:
  ```python
  with open(SRC, 'rb') as f: content = f.read().decode('utf-8')
  # ... make changes ...
  with open(SRC, 'wb') as f: f.write(content.encode('utf-8'))
  ```

---

# ⚠ RULE 4 — JAVASCRIPT RULES

- **Never nest backtick template literals** — causes silent parse errors
- **In Python scripts:** apostrophes inside JS single-quoted strings need `\\'` in triple-quoted Python strings to produce `\'` in JS output (e.g. `"won\\'t"` → `"won\'t"` in file → `won't` in browser)
- **Use `data-n` / `data-lid` / `data-view` attributes + `this.dataset.X`** in onclick handlers to avoid quote-escaping issues in dynamically built HTML
- **Auth prompt must be `''`** (empty string) — never `'select_account'`
- **Never add `apis.google.com/js/api.js`** — breaks auth loop

---

# ⚠ RULE 5 — GOOGLE SHEETS ROUTING

Main sheet is at the 10M cell limit — **never write new data there**.

| Sheet | `CONFIG` key | Purpose |
|-------|-------------|---------|
| `1xH_OC_fvSwQWZet95xBlJ951LsaQWru-glv2rkSnDm4` | `SPREADSHEET_ID` | Main — per-rep tabs, MASTER, _LOG, _COLLECTIONS, _CONTACTS, _OPEN_ORDERS. **READ ONLY — DO NOT add data** |
| `192ELLBgiEUZ3z6ytkWXbmA24wS2BjHmclJdf_UF_c24` | `HISTORY_SPREADSHEET_ID` | History — _GP, _INVOICE_HISTORY, _SIGNATURES, _ATTACK_PLAN, _NDA_LOG, _CONTACT_NOTES, _SUGGESTIONS, _REQUEST_LOG, _POOL_MANAGED, _TRANSFER_HISTORY, _CUSTOMER_DIRECTORY. **All new data goes here** |
| `12dJ0eLFQse-_pi1k6rXc25yTkwwYTjMm32v11tGKeRo` | `ACTIVITY_SPREADSHEET_ID` | Activity — _REQS, _QUOTES |

**API helpers:**
- `sheetsGet(range)` → Main sheet only
- `sheetsGetFrom(id, range)` → any sheet
- `sheetsAppend(range, rows, id?)` → optional 3rd arg for non-Main
- `sheetsUpdate(range, values, id?)` → same
- `sheetsUpdateIn(id, range, values)` → explicit non-Main update

**_CONTACT_NOTES** lives in History sheet — `sheetsGetFrom(CONFIG.HISTORY_SPREADSHEET_ID, "'_CONTACT_NOTES'!A1:Z2000")`. `state.contactNotesCache` must always be an **array** `[header, ...rows]`, never a dict.

---

# ⚠ RULE 6 — AUTH & SECURITY

- `john.fluman@intransittech.com` → `repId='ADMIN'` (not `'FJohn'`)
- Domain restriction: `@intransittech.com` only
- `SUPABASE_SECRET` never in app code or GitHub — server only (`C:\scripts\supabase_config.py`)
- Supabase publishable key lives in `localStorage` as `it_sb_key`
- Worker allowlist: accepts any `@intransittech.com` email — no hardcoded ALLOWED_EMAILS list

---

# ⚠ RULE 7 — DATABASE / SQL

- Rep attribution: always use `dbo.ORDERHEA.USERNAME` — **not** `CUSTOMER.USERNAME`
- GP: use `INVCHEA.GP` — **not** `INVCDTL.GP` (sparsely populated)
- `_GP` tab `EXTENDED_PRICE` = shipped revenue (aliased from SQL `INVOICE_TOTAL`)
- `INVCHEA` has **no EMAIL column** — track buyer via `ORDERHEA.ORDERED_BY`
- Collections balance: `INVCHEA.BALANCE` is authoritative (not `CUSTBAL`)
- Do not use: `SHIP_ACCT`, `RECNUM`, `INVOICED_BY`, `CUSTOMER.AVERAGE_PAY`

---

# What This Is

A single-file SPA sales intelligence dashboard for Intransit Technologies. The entire frontend is `intransit_app.html` (~21,000 lines of vanilla JS/HTML/CSS — no build step, no frameworks). A Python backend (`C:\scripts\sales_report.py` on INTRANSIT-RDS02) aggregates SQL Server data and writes to Google Sheets and Supabase.

**Live:** https://johnfluman-tech.github.io/sales-app/intransit_app.html

## Architecture

### Data Flow
```
Google Sign-In (GIS OAuth) → localStorage (it_token, it_anthro_key, it_sb_key)
  → Google Sheets API (primary data source, 3 spreadsheets)
  → Cloudflare Worker (intransit-worker.intransit-sales.workers.dev)
  → SQL Server CCCRM on INTRANSIT-RDS02
  → Python sales_report.py (scheduled aggregation → Sheets + Supabase)
```

### Key App State & Cache Pattern
- `ensureCacheLoaded()` is the entry point for data — never call `loadSupplementalData()` directly
- `state.cacheLoaded` does NOT mean `state.accounts` is populated — they're separate flags
- Guard all cache object writes: `if(!state.collectionsCache) state.collectionsCache={}`
- `contactRevenueCache` is built from `gpCache` BUYER_NAME field after cache loads
- Buyer revenue source: `_GP` tab → `BUYER_NAME` column (from `ORDERHEA.ORDERED_BY`)
- `state.collectionsCache` is initialized to `{}` in the state object — never rely on lazy init

### Views
My Accounts, Daily Mission (100 AI picks), Dashboard, Collections, Contacts, Attack Plan, Prospects, My Outreach, Manager Hub, Requests & Approvals, My Requests, Hidden Accounts, Pool Management, Available Accounts, Access Log, Settings, Academy (🎓), Suggestions Board (💡 admin only), Notes Feed (📋), Team Notes (📋 manager), Team Profile (🏢 manager)

### Notes Feed (`_renderNotesFeed`)
- **Sources:** (1) `acc.repNote`/`acc.note` → RepNote; (2) accounts with `followUpDate` but no repNote → FollowUp (purple); (3) `_CONTACT_NOTES` → ContactNote, CollectionsNote, Outcome, ManagerNote
- **Access:** Admin=all; Admin simulating manager=team notes; Real manager=own+team; Rep=own only
- `isActuallyTeamView = isTeamView` — do NOT add `|| state.viewAsRep === '__TEAM_ALL__'`, it bleeds across views
- **Type colors:** RepNote=#3b82f6, ContactNote=#14b8a6, ManagerNote=#f59e0b, CollectionsNote=#ef4444, Outcome=#22c55e, FollowUp=#8b5cf6
- Called as `_renderNotesFeed(false)` for personal, `_renderNotesFeed(true)` for team view

### Manager System
- `MANAGER_CONFIG` defines three roles: `CKaren` (personal rep + manager), `CMancilla`, `MPerezfreye` (manager-only)
- All three share `teamReps`: `['CKaren','BillP','PIan','RMauricio','LMancera','bcastor']`
- `getManagerRole(repId, email)` → resolves manager role at login
- `getManagerConfig()` → returns `MANAGER_CONFIG[state.managerRole]` or null
- `__TEAM_ALL__` = team-wide view value; all Manager View dropdown options set `state.viewAsRep = '__TEAM_ALL__'`
- `canSeeTransferCandidates()` allowlist: `['ADMIN','BillP','CKaren','CMancilla','MPerezfreye']`
- FJohn (admin) is excluded from Manager Hub rep lists via `.filter(r => r !== 'FJohn')`

### Dashboard Team View
- `repFilter = state.isAdmin ? (state.viewAsRep || null) : state.repId`
- When `repFilter === '__TEAM_ALL__'`: resolves `_teamRepsFilter` via `getManagerConfig().teamReps`
- `repMatchesFn` handles both single-rep and team filter

### Suggestions Board
- Admin/FJohn only — `renderSuggestionsBoard` starts with `if (!isAdmin()) { switchView('accounts'); return; }`
- Nav item hidden whenever `state.viewAsRep` is set
- Reads/writes use `CONFIG.HISTORY_SPREADSHEET_ID`
- `_rowOffset`: 1 (no sheet headers) or 2 (headers present) — used for `rowIdx` in sheetsUpdate

### Attack Plan / Pool
- `apkAutoSave()` → `localStorage` immediately + schedules `saveAttackPlan` after 4s debounce
- Pool hide: persists to `localStorage` key `it_pool_hidden_[repId]`
- `window.apkCRMAccs` = CRM-only accounts not in `state.accounts` for current rep
- Pool filter: ALL / HAS SALES / NO SALES via `window._apkPoolFilter`
- CRM lastActivity `1753-01-01...` (SQL Server min date) → filter out, don't display

### Gmail Integration
- Scope: `https://www.googleapis.com/auth/gmail.readonly`
- `state.gmailToken` / `state.gmailTokenClient` — separate from Sheets token
- `requestGmailAccess(callback)` — uses `prompt: 'consent'` for first-time auth
- `state.gmailActivityCache` keyed by account name
- **Setup required:** Enable Gmail API in Google Cloud Console + add `gmail.readonly` scope to OAuth consent screen (client ID: `379521778420-8gjfdn4ea5knllkdvd675klu80tcl8jb.apps.googleusercontent.com`)

### Account Intel (Manager Hub)
- Quick-access targets: San Luis Metal, Siemens, Martinrea, Porta Systems, Navistar, Thyssenkrupp
- GP search has 4 fallbacks: AND-match → OR-match → extra names from transferHistoryCache → synthesize from `_TRANSFER_HISTORY`
- Stop-word list (`_gwStop` regex) filters generic words from all fallbacks — NEVER remove
- `_mgrIntelTransferPartsHtml` uses `_repNames` map for display names (not raw repIds)
- `mgrIntelAutocomplete()` triggers on oninput after 2 chars; dropdown `#mgr-intel-ac`

### Auth / Login Flow
- `completeLogin()` checks `sessionStorage.getItem('it_nda_accepted')` at TOP — shows NDA if not set
- `logLoginEvent()` writes to `_LOG` with 9 columns; called unconditionally in `completeLogin()`
- `setRepFromEmail()` normalizes email to printable ASCII (charCode 33–126) before map lookup — handles invisible Unicode chars in Google JWT
- `checkIPAndProceed()` always calls `showLocationModal(isNewIP)` — never auto-proceeds, even for known IPs
- `_signedOut` module-level flag prevents 401 cascade on concurrent requests after signout
- `refreshTokenSilent()` reuses `state.tokenClient` (not a new popup) — resolves via `state._pendingRefresh`
- NDA cleared in: `handleSignout()`, `showForcedLogoutMessage()`, `checkAuth()` (all 3 paths), `init()` `!authed` branch

### Academy
- XP in `localStorage` as `it_academy_progress`; 8 tracks; `ACADEMY_LEVELS` + `TRACK_COLORS` constants
- All 37 lessons have real content — `acadDefaultLesson` fallback no longer reached
- No welcome gate — all users go straight to 8 tracks view

### Pool / Request System
- `_POOL_MANAGED` tab in History sheet: columns `ACCOUNT_NAME, SOURCE_REP, PRIORITY, STATUS, ASSIGNED_TO, APPROVED_BY, APPROVED_DATE, NOTES`
- `_REQUEST_LOG` tab in History sheet: columns `TIMESTAMP, TYPE, ACCOUNT, REP, REASON, STATUS, ADMIN_NOTE`
- `writeRequestLog(type, account, repId, reason, status)` — fire-and-forget, doesn't block UI
- `resolveRequestLog(...)` — appends TYPE_RESOLVED row
- `poolLogAction(action, accName, detail)` — writes POOL_ACTION to `_REQUEST_LOG`

---

## Sales Reps (usernames are case-sensitive)
`CKaren`, `BillP`, `PIan`, `RMauricio`, `LMancera`, `bcastor`, `FJohn` (admin = john.fluman), `Anolan`

Manager-only (no personal rep accounts): `CMancilla` (carlos.mancilla@intransittech.com), `MPerezfreye` (manuel.perezfreyre@intransittech.com)

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

### Diagnosing blank accounts (F12 → Console)
- `[AUTH] setRepFromEmail: email → repId: X` — confirms email mapped correctly
- `[TAB] Loaded RMauricio: N accounts` — confirms tab loaded
- `[TAB] Error loading tab X: Sheets API error 400` → tab name mismatch in sheet
- `[AUTH] Email not in REP_EMAIL_MAP` → add email to CONFIG.REP_EMAIL_MAP

---

## Pending / Known Issues
- Dashboard loads slowly (30s+) — Supabase migration not yet complete
- `sales_report.py` target: every 30 min on INTRANSIT-RDS02, log to `C:\scripts\logs\sales_report.log`
- `saveContactNoteFromView` (~line 8508) does not update `state.contactNotesCache` after save — notes only appear in Notes Feed after next reload
- **`_CUSTOMER_DIRECTORY` confirmed working** — 2,487 accounts as of 2026-05-22. Re-run `sales_report.py` to refresh.
- `_POOL_MANAGED` tab must be created manually in History sheet with header row before first use
- `_REQUEST_LOG` tab auto-creates on first write (but create manually if issues: `TIMESTAMP, TYPE, ACCOUNT, REP, REASON, STATUS, ADMIN_NOTE`)
- Gmail API setup required per Google Cloud Console: enable Gmail API + add `gmail.readonly` scope

### `sales_report.py` deployment
- Copy `C:\Users\fluma\sales-app\sales_report.py` → `C:\scripts\sales_report.py` on INTRANSIT-RDS02
- `_CUSTOMER_DIRECTORY` export: `push_customer_directory_tab()` opens its own fresh pyodbc connection internally
- `scripts_CLAUDE.md` in repo → `C:\scripts\CLAUDE.md` on RDS02 (sync via GitHub raw URL)

---

## Session Log

### 2026-05-19
**Bugs fixed:**
- Notes Feed (`_renderNotesFeed`): `mgrCfg` was null for real managers — fixed by setting `mgrCfg` when `isMgr || isActuallyTeamView`
- Admin dropdown: removed redundant "Team Views" section; `__MGR_X` now sets `state.viewAsRep='__TEAM_ALL__'`
- `refreshDashboard`: added `repMatchesFn` — `'__TEAM_ALL__'` now resolves team reps correctly
- Suggestions Board: reads hitting Main sheet (wrong) → fixed to use History; fixed `_rowOffset` bug
- `saveCollectionsNote`: was saving to Main (at cell limit) → fixed to History
- `saveContactNote` + `iqSaveLog`: were setting `state.contactNotesCache = {}` (dict) → fixed to maintain array format
- Notes Feed fallback read: fixed to `sheetsGetFrom(CONFIG.HISTORY_SPREADSHEET_ID, ...)`

**Features added:** Notes Feed FollowUp type (purple) + FOLLOW-UP filter button

### 2026-05-19 (continued)
**Bugs fixed:**
- Suggestions Board: non-admin access guard added (`if (!isAdmin()) { switchView('accounts'); return; }`)
- `switchViewAs`: Suggestions Board nav now hidden whenever `state.viewAsRep` is set
- Notes Feed rep dropdown: `isActuallyTeamView = isTeamView` (removed `|| state.viewAsRep === '__TEAM_ALL__'` bleed)

### 2026-05-19 (session 3)
**Features added:** Academy — full lesson content for all 23 previously-empty lessons across 5 tracks (t3, t4, t5, t6, t8). All 37 lessons now have real content.

### 2026-05-19 (session 4 — security hardening + Task 9)
**Security:** Worker `/get-ip` + `/geoip` endpoints; token expiry check; non-admin PUT to audit log paths returns 403; CSP meta tag; `logAccessEntry('PENDING')` at NDA accept.
**Task 9:** AI key cleanup; bcastor logging; session IDs; IP/geo logging; 60-min timeout + 55-min warning; known IP flow; unusual activity banner; force logout.
**Commits:** `ad59e7d`, `ffbf846`

### 2026-05-19 (session 5 — Task 10)
**Features:** Rich History tab (invoice cards, GP%, tracking links, sort/pagination); SVG bar chart in Info tab; force logout UX; heartbeat `_ACTIVE_USERS`; NDA full-text capture; HIDE_FROM_POOL pool filter.
**Commit:** `b37798e`

### 2026-05-19 (session 6 — Task 11 + Task 12)
**Task 11:** Added `HIDE_FROM_POOL` column to all 9 Main sheet tabs via service account script.
**Task 12:** Transfer Candidates restricted to managers + admin via `canSeeTransferCandidates()`. `apkDoAssignToMe()` for admin/manager direct assignment.
**Commit:** `69aba6f`

### 2026-05-19 (session 7 — Task 13)
**Bugs fixed:** Double location modal (removed spurious `showLocationModal()` from `acceptNDA()`); `completeLogin()` now always calls `logLoginEvent()`.
**New functions:** `getUserIP`, `logLoginEvent`
**Commit:** `aba1556`

### 2026-05-19 (session 8 — Task 15)
**Fix 1:** NDA check at TOP of `completeLogin()` before app shows — applies to all users including cached OAuth.
**Fix 2:** `logLoginEvent()` writes 9 columns.
**Fix 3:** `canSeeTransferCandidates()` uses `state.repId` (not `state.user.repId`).
**Fix 4:** Manager daily mission team filter via `_isManagerTeamView`.
**Commit:** `c6700a8`

### 2026-05-19 (session 9 — Task 16)
**Changes:** Console log prefixes `[AUTH]`, `[NDA]`, `[LOG]`, `[ATTACK]` added throughout auth flow. `canSeeTransferCandidates()` allowlist tightened.
**Commit:** `ebdbb1b`

### 2026-05-20 (session 10)
**Bugs fixed:** NDA not showing after re-login — `checkAuth()` now clears `it_nda_accepted` from sessionStorage in all 3 return-false paths. Access Log 429 — `sheetsGetFrom()` now retries with exponential backoff (4s, 8s, 12s).
**Commits:** `1fc880d`, `6ddd195`

### 2026-05-20 (session 11 — OAuth loop fix + Prospects)
**TASK17:** `_signedOut` flag prevents 401 cascade; `refreshTokenSilent()` reuses `state.tokenClient`; `handleGoogleCredential()` 8s guard after signout.
**TASK18 Prospects:** All 5 features — CRM search modal, Prospects nav/view, AI outreach assistant, Daily Mission integration, admin bulk import. New: `_PROSPECTS` tab in History sheet.
**Commit:** `15ffae6`

### 2026-05-20 (session 12 — Carlos OAuth infinite loop fix)
**Three-part fix:** `_signedOut` module flag; `refreshTokenSilent()` via `state._pendingRefresh`; `handleGoogleCredential()` `_lastSignoutTime` guard.
**Commit:** `9364cd2`

### 2026-05-20 (session 13 — CRM pool + simulate login)
**Worker:** Removed `ALLOWED_EMAILS` hardcoded list — accepts any `@intransittech.com`.
**CRM pool:** `loadCustomerDirectory()` lowercase field mapping; `window.apkCRMAccs`; pool ALL/HAS SALES/NO SALES filters; CRM pool cards with 📊 badge.
**MANAGER_CONFIG:** CKaren added to her own teamReps.
**`completeLogin()`:** `state.viewAsRep = null` after `_loginComplete` to prevent bleed.
**Admin debug:** `debugSimulateLogin()` / `debugRestoreAdmin()` in Settings.
**Commits:** `ce82815`, `9a9646a`

### 2026-05-21 (session 14 — Karen/Mauricio crash fix)
**Bug fixed:** `state.collectionsCache` was undefined on fast login (single-tab reps) → race condition crash. Fixed: initialized to `{}` in state object + `|| {}` guards in `updateBadges()`.
**Bug fixed:** `#activity-warning` always visible → added `style="display:none"`.
**Bug fixed:** Data isolation — Collections/Contacts/AttackPlan now filter by `_myAccNames` Set from `state.accounts` (not by `acc.rep` string comparison).
**Diagnostics:** `[AUTH]` and `[TAB]` console logs throughout load flow.
**Commits:** `2beca95`, `a9e7f6e`, `89e6821`, `4957c23`

### 2026-05-22 (session 15 — Mauricio email + Academy + Collections contacts)
**Bugs fixed:** Mauricio email corrected in REP_EMAIL_MAP (`mauricio.rangel@`). Academy welcome gate removed. Collections contact fuzzy fallback via `state._buyerEmailMap`. `_CUSTOMER_DIRECTORY` fresh connection fix in `sales_report.py`.
**Commits:** `3b7e267`, `097fb69`, `1543361`, `60d9631`, `0927771`, `a921207`, `adb4e9f`

### 2026-05-22 (session 16 — Manager Hub 5 tools)
**Features:** Manager Hub tabs: Scoreboard (enhanced), Coaching, Collections, Pipeline, AI Brief. Admin sees Manager Hub (defaults to all reps). Collections scoped to teamReps for managers.
**Commits:** `b88e005`, `6c0ef05`, `f55e331`, `e3ebd27`

### 2026-05-24 (session 17 — Karen email diagnosis)
**Bugs fixed:** Karen view-as dropdown listed her twice. Karen repId null root cause: invisible Unicode chars in Google JWT email → `setRepFromEmail()` rewritten to filter to printable ASCII only. `completeLogin()` re-applies `setRepFromEmail()` if repId still null. `sheetsGetFrom()` 403 → `refreshTokenSilent()` retry. CSP expanded to include all Google API domains.
**Commits:** `3445fff`, `9448909`, `e2979c8`, `612458b`

### 2026-05-24 (session 18 — location modal fix)
**Bug fixed:** Location modal (HOME/OFFICE/TRAVEL) was skipped for known IPs. `checkIPAndProceed()` now always calls `showLocationModal(isNewIP)` — known IP just suppresses the red banner, not the modal.
**Commit:** `ad0da08`

### 2026-05-26 (session 19 — Supabase keep-alive)
Cloudflare Worker daily cron (`0 12 * * *`) pings Supabase to prevent project pause on free tier.

### 2026-05-26 (session 20 — Access Log v2 + Manager Hub Intel + CRM sync)
**Access Log v2:** Date range filter, rep filter, search, per-rep summary cards, 30-day SVG chart, anomaly tagging (AFTER HRS/WEEKEND/NEW DEVICE/MULTI-LOC), AI Security Brief, AI Row Explainer, pagination.
**Manager Hub Account Intel:** 🔍 tab with quick-access buttons for 6 transferred accounts, search, revenue-by-year chart, top recurring parts, AI outreach strategy.
**CRM sync indicator:** "DATA LAST UPDATED" in sidebar with relative time + color coding.
**Commits:** `b0159ed`, `4d23ac5`, `5cb1e97`

### 2026-05-26 (session 21 — Account Intel search fix)
**Bug fixed:** Quick-access buttons returned no results. Fix: search `state.accounts` first; OR-word fallback; "Did you mean?" suggestions; historyCache extended to matched account names.
**Commit:** `88a3a33`

### 2026-05-26 (session 22 — BillP MX Team + FJohn pipeline fix)
FJohn excluded from Manager Hub rep lists. BillP added to `teamReps` for all three manager roles.
**Commit:** `d5dae50`

### 2026-05-26 (session 23 — RDS02 Claude setup)
Claude Code installed on INTRANSIT-RDS02 (PS7 via MSI). `scripts_CLAUDE.md` created in repo → downloaded to `C:\scripts\CLAUDE.md` on RDS02. Karen pre-transfer history plan confirmed (`push_transfer_history_tab()` needed).
**Commit:** `3b16adc`

### 2026-05-26 (session 24 — Collections total fix + Account Intel before/after)
**Bug fixed:** Manager Hub Collections grand total inflated by orphaned entries. BEFORE/AFTER comparison card added to Account Intel.
**Commit:** `315f93b`

### 2026-05-26 (session 25 — Account Intel rebuild + CRM sync auto-refresh)
CRM sync indicator: relative time + auto-refresh every 60s. Account Intel: pre-transfer outreach list (year-prior filter), 📋 COPY LIST button, rep transition analysis, current rep performance bars.
**Commits:** `aba3717`, `94f8ff1`, `891f299`, `29131d0`, `7aef58b`

### 2026-05-26 (session 26 — Account Intel synthetic gpRows)
**Bug fixed:** Accounts not in gpCache BUYER_NAME (e.g. Siemens) showed blank. 4th fallback synthesizes gpRows from `_TRANSFER_HISTORY`. Rep names fixed ("PIAN" → "IAN PITMAN"). yearLabel uses actual rep name.
**Commit:** `babe8d7`

### 2026-05-26 (session 27 — Pool cleanup, Requests redesign, CRM accounts, Request Log)
**Task 1:** Removed POOL VISIBILITY block from Notes tab.
**Task 2:** Requests & Approvals completely rewritten (`_reqRenderPage`, `removeCard`, `infoCard`). Attack Plan pool card now routes through hide-request flow.
**Task 3:** ALL CRM filter in Accounts view shows CRM-only stubs at 72% opacity. `renderCRMOnlyDetail()` for CRM-only accounts.
**Task 4:** `_REQUEST_LOG` tab. `writeRequestLog` / `resolveRequestLog`. Deny-with-admin-note modals. "My Requests" nav for all users.
**JS syntax fix:** `infoCard` deny button used `\'@intransittech.com\'` in expression context → switched to `data-rid` attribute.
**Commits:** (multiple)

### 2026-05-26 (session 28 — Hidden Accounts + Return Requests + manager canEdit)
**Features:** `nav-hidden-accounts` + `renderHiddenAccountsView()`. Return request flow (`showReturnRequestModal`, `submitReturnRequest`, `approveReturnRequest`). Manager `canEdit` includes teamReps accounts. CRM pool excludes hidden accounts. Academy t1-1 + t3-5 lessons updated.
**Commit:** `c294fc5`

### 2026-05-26 (session 29 — Audit + 6 improvements)
**Bugs fixed:** `showLocationModal(isNewIP)` now uses the parameter. `apkConfirmReset()` clears zone dates.
**UX:** Sort direction arrows; Team Profile cards clickable; UNSAVED note dot; Force Data Refresh in Settings.
**New function:** `refreshAllData()`
**Commit:** `1eb82f2`

### 2026-05-27 (session 30 — Account Intel fixes + Pool Management)
**Account Intel:** Stop-word fix Round 3 for Ontic/Zebra (distinctive-word-only in safety net + historyCache 5th fallback AND-only). Autocomplete with arrow-key nav.
**Note history dedup:** `loadNoteHistory()` now called ONCE after all tabs, not per-tab.
**Hidden accounts persistence:** `loadHiddenAccountsTab()` now detects no-header row positionally.
**Requests cleanup:** HOLD dismissal buttons; TRANSFER resolved set filtering; RETURN deny fixed to `denyReturnRequest()`.
**Pool Management:** `nav-pool-management` (admin/manager) + `nav-available-pool` (all reps). `_POOL_MANAGED` History tab. NEEDS REVIEW / IN POOL / HIDDEN tabs with filter/sort/search/pagination. Audit trail via `poolLogAction()`.
**Commits:** (multiple)

### 2026-05-28 (session 31 — Pool Management improvements + Gmail Email Activity)
**Pool Management:** Three tabs (NEEDS REVIEW default, IN POOL, HIDDEN). Filter bar + pagination (50/page). Audit trail: `poolLogAction()` writes POOL_ACTION to `_REQUEST_LOG`.
**Gmail Email Activity tab:** New ✉ tab in account detail. `requestGmailAccess` (prompt: 'consent'), `gmailFetch`, `loadGmailActivity`, `renderGmailActivityTab`, `gmailConnectAndLoad`, `gmailLoadForAccount`. Settings Gmail card. Read-only sent folder, cached in memory only.
**New state:** `gmailToken`, `gmailTokenClient`, `gmailActivityCache`
**Commits:** `8b833e5`, `051c43c`

### 2026-05-28 (session 32 — JS syntax fix + My Outreach + Manager Hub Outreach)
**Features added:**
- **My Outreach** (📝 nav): attention scores (100pt formula: days-inactive penalty + no-note + overdue follow-up), contact coverage tab (Gmail emailed vs never emailed), AI coach tools (weekly plan, top 5 emails, revenue opportunities, call list, who I've missed, Gmail insights).
- **Manager Hub Outreach tab:** team email health, per-rep performance score (A+/A/B/C/D/F), AI analysis.
- **Gmail prompt:** changed to `prompt: 'consent'` for first-time auth (was `''` which silently fails for new scopes).

**Bugs fixed (critical — app was blank page):**
- `renderMyOutreachView` tab switcher: Python script generated `window._myOutreachTab==\'attention\'` in expression context — SyntaxError. Fixed by replacing with IIFE pre-computing `_attn`/`_cov` booleans.
- `renderMyOutreachView` unclosed ternary: `(_moTab === 'coverage' ? ... :` was missing closing `)`. Changed `'</div></div>';` → `'</div></div>');`.
- `_renderContactCoveragePanel` map callback: stray `)` before `;` in return statement. Removed.
- `CLAUDE.md` reorganized: all rules/checkpoints moved to front.

**Commit:** `ff60138`

### 2026-05-28 (session 33 — Gmail fixes + UI redesigns + Pool data + Intel targeting)
**Gmail fixes:**
- CSP `connect-src` missing `https://gmail.googleapis.com` → "Failed to fetch" on all Gmail API calls. Fixed.
- `_gmailEnsureToken()`: validates token with ping before scan, silently refreshes if expired/missing — no forced reconnect on every scan.
- `loadAllGmail()`: removed 50-account batch cap, scans all accounts. Saves slim cache to localStorage (`it_gmail_cache_[viewRep]`), auto-refreshes every 8h via `_gmailAutoScan()`.
- Collections "Open in Email" now logs outreach to `_CONTACT_NOTES` as `CollectionsNote`.

**My Outreach → Outreach Command Center redesign:**
- KPI bar (CRITICAL / AT RISK / FU OVERDUE / REPLY RATE), TODAY'S PLAYBOOK (top-5 urgent account cards), AI Coach button grid, Priority Queue with score rings and color-coded left borders.
- `_ring()`, `_kpi()`, `_aibtn()`, `_tabBtn()` helpers inside `renderMyOutreachView`.

**Pool Management — rich cards:**
- `_poolDays()`, `_poolYearBars()` helpers: days-idle counter (color-coded), YTD/lifetime/last-sale stat row, year bar chart, rep note, follow-up date, collections balance + risk.
- `_statsBar()`: 5-tile KPI bar (accounts, lifetime rev, YTD, avg idle, collections) + overdue-FU alert above each tab.
- NEEDS REVIEW: added 🔥 HOT button (direct hot-priority add). Pool/Hidden cards also enriched.

**Manager Hub Account Intel — dynamic targeting:**
- `_computeIntelTargets(teamReps, filter)`: scans team accounts for 35%+ revenue declines from peak year + multi-rep transfer history accounts. Respects teamReps permissions.
- Filter tabs: ALL / MAJOR DECLINE / MULTI-REP. Each button shows drop amount + %. Seeds always shown in ALL view.
- `_MGR_INTEL_SEEDS` keeps original 6; `_MGR_INTEL_TARGETS` aliased to seeds for backward compat.

**CLAUDE.md rule additions:**
- `node --check` command corrected: `python _extract_js.py && node --check _check.js`
- Python escaping: apostrophes in user strings need `\\'`, inline `onmouseover` with CSS vars → use opacity/numeric instead
- `replace_between()` with CRLF normalization is more reliable than full-string matching

**Commits:** `e59143c`, `3ddfe05`, `0490ec5`
