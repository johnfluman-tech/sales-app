"At the end of every session, update this file with new files created, functions added, bugs fixed, and any new rules learned."

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A single-file SPA sales intelligence dashboard for Intransit Technologies. The entire frontend is `intransit_app.html` (~11,500 lines of vanilla JS/HTML/CSS — no build step, no frameworks). A Python backend script (`C:\scripts\sales_report.py` on INTRANSIT-RDS02) aggregates SQL Server data and writes to Google Sheets and Supabase.

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
| `192ELLBgiEUZ3z6ytkWXbmA24wS2BjHmclJdf_UF_c24` | History (_GP 22K rows, _INVOICE_HISTORY, _SIGNATURES, _ATTACK_PLAN, _NDA_LOG) |
| `12dJ0eLFQse-_pi1k6rXc25yTkwwYTjMm32v11tGKeRo` | Activity (_REQS ~21K, _QUOTES ~17K) |

**All new tabs go in the History sheet** — Main is full.

### Key App State & Cache Pattern
- `ensureCacheLoaded()` is the entry point for data — never call `loadSupplementalData()` directly
- `state.cacheLoaded` does NOT mean `state.accounts` is populated — they're separate flags
- Guard all cache object writes: `if(!state.collectionsCache) state.collectionsCache={}`
- `contactRevenueCache` is built from `gpCache` BUYER_NAME field after cache loads
- Buyer revenue source: `_GP` tab → `BUYER_NAME` column (from `ORDERHEA.ORDERED_BY`)

### Views
My Accounts, Daily Mission (100 AI picks), Dashboard, Collections (138 accts / ~$342K AR), Contacts (7,898), Attack Plan (kanban), Requests (admin), Access Log, Settings, Academy (🎓), Suggestions Board (💡 admin only), Notes Feed (📋 admin/manager/rep), Team Notes (📋 manager only), Team Profile (🏢 manager only)

### Task 7b — Notes Feed, Collections, Attack Plan (v1.50)
- **Notes Feed**: Two-panel layout (60% list, 40% AI panel); sources: `acc.repNote`, `_CONTACT_NOTES` sheet; auto-analysis with `callAI`; quick-prompt buttons per role; `_nfLinkifyAccounts()` makes AI responses link account names
- **Collections notes**: `saveCollectionsNote` now saves to `_CONTACT_NOTES` immediately via `sheetsAppend`; updates `state.contactNotesCache` for Notes Feed
- **Attack Plan auto-save**: `apkAutoSave()` saves to `localStorage` immediately + schedules `saveAttackPlan` after 4s debounce; called from `apkMove` on every card move
- **Pool hide**: `apkHideAccount(name)` / `apkUnhideAccount(name)` persist to `localStorage` key `it_pool_hidden_[repId]`; `_apkUpdateHiddenBtn()` updates badge count
- **Admin View As dropdown**: `__MGR_X` prefix = simulate manager X personal view; `__TM_X` prefix = simulate manager X team view; handled in `switchViewAs`
- **APP_VERSION** = `'1.50'`; `CHANGELOG` array; `showChangelog()` popover on version badge click

### Manager System (Task 6)
- `MANAGER_CONFIG` constant defines three manager roles: `CKaren` (personal rep + manager), `CMancilla` and `MPerezfreye` (manager-only, no personal accounts, resolved via `sharedWith` email array)
- `getManagerRole(repId, email)` — resolves manager role at login by repId or sharedWith email match
- `getManagerConfig()` — returns `MANAGER_CONFIG[state.managerRole]` or null
- `state.managerRole` set at login via `getManagerRole()`; `isManager()` now checks `state.managerRole` too
- `__TEAM_ALL__` is the team-wide view value (replaces `MX_TEAM`); manager-only users auto-select it
- Manager dropdown shows "My Accounts" option only when `mgrMid === state.repId`

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
- In Python scripts: apostrophes inside JS single-quoted strings need `\\'` (not `\'`) to produce `\'` in the output file

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

### Secrets
- `SUPABASE_SECRET` never in app code or GitHub — server only (`C:\scripts\supabase_config.py`)
- Supabase publishable key lives in `localStorage` as `it_sb_key`

## Sales Reps (usernames are case-sensitive)
`CKaren`, `BillP`, `PIan`, `RMauricio`, `LMancera`, `bcastor`, `FJohn` (admin = john.fluman), `Anolan`

Manager-only users (no personal rep accounts): `CMancilla` (carlos.mancilla@intransittech.com), `MPerezfreye` (manuel.perezfreyre@intransittech.com)

## Pending / Known Issues
- Dashboard loads slowly (30s+) — Supabase migration not yet complete (app still reads Sheets)
- `sales_report.py` not yet scheduled on server (run manually)
- Each rep needs to allow the popup once before first use
