# Intransit Sales App — Project Context

## What This Repo Is
Sales intelligence platform for Intransit Technologies.
- `sales_report.py` — runs on RDS02, pulls from CCCRM SQL Server, pushes to Google Sheets
- `intransit_app.html` — single-file web app that reads from Google Sheets, used by sales reps daily
- `cleanup_main_sheet.py` — one-off utility to shrink/delete tabs when Google Sheets hits 10M cell limit

## Infrastructure

### RDS02 (Server: INTRANSIT-RDS02)
- All scripts live at `C:\scripts\`
- Python venv at `C:\scripts\venv\` (has pyodbc, pandas, openpyxl, google-auth)
- Run scripts with `C:\scripts\venv\Scripts\python.exe` (NOT system python)
- Set `$env:PYTHONIOENCODING = "utf-8"` before running interactively (arrow chars cause cp1252 crash)
- Logs at `C:\scripts\logs\sales_report.log`
- Excel reports at `C:\scripts\reports\`
- Two scheduled tasks run sales_report.py:
  - `SalesReport_Every30Min` — runs as managerman (requires login session)
  - `IntransitSalesReport` — runs as SYSTEM, daily 6AM–6PM every 30 min (preferred)

### Google Sheets
- **Main sheet** ID: `1xH_OC_fvSwQWZet95xBlJ951LsaQWru-glv2rkSnDm4`
  - Rep tabs (CKaren, BillP, PIan, etc.) — stub size only, data moved to History sheet
  - These tabs must stay small or the 10M cell limit breaks everything
- **History sheet** ID: `192ELLBgiEUZ3z6ytkWXbmA24wS2BjHmclJdf_UF_c24`
  - `_COLLECTIONS` — open AR balances with SALES_REP column
  - `_COLLECTIONS_INVOICES` — individual open invoices
  - `_INVOICE_HISTORY` — all invoice line items (58K+ rows)
  - `_GP` — GP by invoice
  - `_CONTACTS` — all contacts
  - `_REQS`, `_QUOTES`, `_CUSTOMER_STATS`, `_ORDERS_HISTORY`, `_OPEN_ORDERS`
  - `_CUSTOMER_DIRECTORY` — all accounts with YTD/lifetime revenue
  - `_TRANSFER_HISTORY` — pre-transfer history for Karen's 6 target accounts
  - `_LOG` — run log
- Service account credentials: `C:\scripts\google_credentials.json`

### GitHub Push (no git installed on RDS02)
Use the GitHub API directly:
```python
import urllib.request, json, base64
TOKEN = '<pat>'
API = f'https://api.github.com/repos/johnfluman-tech/sales-app/contents/<file>'
HEADERS = {'Authorization': f'Bearer {TOKEN}', 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
# GET sha, then PUT with base64 content + sha + commit message
```

---

## CCCRM Database

### Connection
```python
pyodbc.connect("DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=CCCRM;Trusted_Connection=yes;")
```

### Rep Attribution — THE CRITICAL RULE
**Always use `ACCOUNT_REP_VIEW` (sourced from `CONTACT.EMP_ID`) as the authoritative rep assignment.**

```sql
-- Correct pattern — used in every query in sales_report.py
WITH owned_accounts AS (
    SELECT arv.ACCOUNT AS CUSTOMER_ID,
           e.LOGIN_ID AS SALES_REP,
           ROW_NUMBER() OVER (PARTITION BY arv.ACCOUNT ORDER BY e.LOGIN_ID) AS rn
    FROM dbo.ACCOUNT_REP_VIEW arv
    JOIN dbo.EMPLOYEE e ON e.ID = arv.SALES_REP
    WHERE e.LOGIN_ID IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')
)
-- Then join: JOIN owned_accounts oa ON oa.CUSTOMER_ID = c.ID AND oa.rn = 1
```

**Why:** `CUSTOMER.USERNAME` and `ORDERHEA.USERNAME` are stale/wrong for many accounts.
`ACCOUNT_REP_VIEW` is defined as `SELECT DISTINCT SAFE_CUST_ID ACCOUNT, EMP_ID SALES_REP FROM CONTACT` — it reflects who the rep actually assigned in the CRM via contact records.

**Never use these for rep attribution:**
- `CUSTOMER.USERNAME` — stale text field, often 'Imported', wrong rep
- `ORDERHEA.USERNAME` — who TYPED the order, not the assigned rep
- `INVCHEA.USERNAME` — invoice processor (RAren, WH, BBen), never a sales rep
- `EMPLOYEE.USERNAME` — CRM access group ('Admin', 'FJohn', 'WH'), not the login identity

### Key Tables & Join Patterns
```sql
-- Orders → Customer
ORDERHEA oh JOIN CUSTOMER c ON oh.CUSTOMER_ID = c.ID

-- Orders → Invoices (ONE-TO-MANY — always aggregate, never assume 1:1)
ORDERHEA oh JOIN INVCHEA ih ON oh.ORDER_NUMBER = ih.ORDER_NUMBER

-- Contacts → Assigned Rep (source of ACCOUNT_REP_VIEW)
CONTACT ct JOIN EMPLOYEE e ON ct.EMP_ID = e.ID   -- use e.ID not e.RECNUM!

-- Part numbers
ORDERDTL.FULLPART  -- not PART_NO (doesn't exist)
```

### Critical Gotchas
- `EMPLOYEE.ID` ≠ `EMPLOYEE.RECNUM` — always join on `EMPLOYEE.ID`
- `CUSTOMER.ID` is the join key, NOT `CUSTOMER.CUSTOMER_NO` or `CUSTOMER.CUSTOMER_NUMBER`
- `INVCHEA.GP` is authoritative for gross profit — never use `INVCDTL.GP`
- `INVCHEA.BALANCE` is authoritative for AR — never use `CUSTBAL`
- Database is 32.8 GB on a server near capacity

### Row Counts (May 2026)
AUDIT: 1.7M | CALLNOTE: 908K | REQ: 258K | ORDERHEA: 53K | INVCHEA: 64K | CUSTOMER: 16K | CONTACT: 30K | EMPLOYEE: 101

### Active Sales Reps
| LOGIN_ID | Name | EMPLOYEE.USERNAME |
|----------|------|-------------------|
| CKaren | Karen Mancebo | Admin |
| PIan | Ian Pitman | Admin |
| RMauricio | Mauricio Rangel | Admin |
| LMancera | Lizeth Mancera | Admin |
| BillP | Bill Pratt | **FJohn** (not BillP — gotcha!) |
| FJohn | John Fluman | Admin |
| bcastor | Brandon Castor | FJohn |
| Anolan | Ana Nolan | FJohn |

---

## intransit_app.html — Web App

### Auth & User Identity
- Google OAuth with `@intransittech.com` accounts only
- `CONFIG.ADMIN_EMAIL = 'john.fluman@intransittech.com'`
- `state.repId` set from `CONFIG.REP_EMAIL_MAP` (email → LOGIN_ID string like 'CKaren', 'BillP')
- `state.isAdmin` = true only for john.fluman@

### Collections Page
- Reads `_COLLECTIONS` tab from History sheet — needs `SALES_REP` column populated
- Non-admin filter (as of 2026-05-30 fix): `if (c.salesRep) return c.salesRep === state.repId`
- Falls back to name-matching against state.accounts if salesRep is empty
- If page is empty for reps but works for admin: hard refresh with Ctrl+Shift+R

### Rep Email Map (update when new reps join)
```javascript
'kmancebo@intransittech.com':   'CKaren',
'bill.pratt@intransittech.com': 'BillP',
'ian.pitman@intransittech.com': 'PIan',
'mauricio.rangel@intransittech.com': 'RMauricio',
'lmancera@intransittech.com':   'LMancera',
'brandonar@intransittech.com':  'bcastor',
'anolan@intransittech.com':     'Anolan',
```

### Local API
`CONFIG.API_BASE = 'http://localhost:5050'` — Python API runs on RDS02

---

## sales_report.py — How It Works

1. **SQL pull** — connects to CCCRM, pulls invoices/contacts/collections/GP/orders etc. via `owned_accounts` CTE (ARV-based)
2. **Google Sheets backup** — backs up rep notes before overwriting
3. **Account summary** — builds 1,418 accounts across 8 reps
4. **Excel reports** — saves per-rep Excel files to `C:\scripts\reports\`
5. **Sheets push** — pushes all tabs to History sheet (and stub tabs to Main sheet)
6. **Runtime** ~2 minutes

### Deploying a New Version
```powershell
# On RDS02 — download from GitHub and run
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/johnfluman-tech/sales-app/main/sales_report.py" -OutFile "C:\scripts\sales_report.py"
$env:PYTHONIOENCODING = "utf-8"; & "C:\scripts\venv\Scripts\python.exe" "C:\scripts\sales_report.py"
```

### Key Numbers (post ARV fix, May 2026)
- Total accounts: 1,418 | Active: 243 | Inactive: 1,175 | Declining: 79
- Contacts: 16,752 | Invoice lines: 84,292 | GP records: 62,947
- Collections: 145 accounts | Open orders: 98

---

## Google Sheets Cell Limit Issue
Main sheet limit is 10M cells. When full, `_LOG` tab writes fail with HTTP 400.
Fix: run `cleanup_main_sheet.py` — shrinks rep tabs to stubs, frees ~3.3M cells.
Last run 2026-05-30: 100% → 66.7% of limit.

---

## AFL / Rep Attribution Edge Case
AFL Telecomunicaciones (CUSTOMER_ID 2103, 12132, 12795) has no contacts with EMP_ID set → doesn't appear in ACCOUNT_REP_VIEW → not attributed to any rep.
BillP placed 56 orders ($98K) for AFL via SALESPERSON_ID.
Fix: set CONTACT.EMP_ID = 1095 (BillP's EMPLOYEE.ID) on AFL's contacts in the CRM.
