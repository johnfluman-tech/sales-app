# CLAUDE.md — Intransit Technologies RDS02 Scripts

This file gives Claude Code context for working in `C:\scripts\` on INTRANSIT-RDS02.

## What This Server Does

INTRANSIT-RDS02 runs `sales_report.py` — a Python script that:
1. Connects to the SQL Server CRM database (`CCCRM` on this machine)
2. Pulls sales data for all reps
3. Writes aggregated results to Google Sheets (3 spreadsheets)
4. The Google Sheets feed a live sales dashboard app at https://johnfluman-tech.github.io/sales-app/intransit_app.html

## File Locations

- Main script: `C:\scripts\sales_report.py`
- Google credentials: `C:\scripts\google_credentials.json` (service account JSON — never modify or expose)
- Supabase config: `C:\scripts\supabase_config.py`
- Log output: `C:\scripts\logs\sales_report.log`
- Working copy on John's PC: `C:\Users\fluma\sales_report.py` (keep in sync)

## SQL Server Database

- **Server:** localhost (this machine, INTRANSIT-RDS02)
- **Database:** `CCCRM`
- **Connection:** via `pyodbc` with Windows auth or SQL auth (see `sales_report.py` connection string)

### Key Tables

| Table | Purpose |
|-------|---------|
| `dbo.ORDERHEA` | Order headers — one row per order |
| `dbo.ORDERDTL` | Order line items — one row per part per order |
| `dbo.INVCHEA` | Invoice headers — one row per invoice |
| `dbo.INVCDTL` | Invoice line items — sparsely populated, mostly avoid |
| `dbo.CUSTOMER` | Customer/account master table |
| `dbo.CUSTBAL` | Customer balances — NOT authoritative, use INVCHEA.BALANCE |

### Critical Column Rules (DO NOT VIOLATE)

- **Rep attribution:** Always use `dbo.ORDERHEA.USERNAME` — NEVER `dbo.CUSTOMER.USERNAME`
- **GP (gross profit):** Always use `dbo.INVCHEA.GP` — NEVER `dbo.INVCDTL.GP` (sparsely populated, mostly NULL)
- **Revenue:** `INVCHEA.INVOICE_TOTAL` = shipped revenue (aliased as `EXTENDED_PRICE` in exports)
- **AR Balance:** `INVCHEA.BALANCE` is authoritative — NOT `CUSTBAL`
- **Buyer tracking:** `INVCHEA` has NO EMAIL column — track buyer via `ORDERHEA.ORDERED_BY`
- **Do NOT use:** `SHIP_ACCT`, `RECNUM`, `INVOICED_BY`, `CUSTOMER.AVERAGE_PAY`

### Important ORDERHEA Columns

```
ORDER_NO, CUSTOMER_NO, USERNAME (rep), ORDERED_BY (buyer name),
ORDER_DATE, SHIP_DATE, STATUS, PO_NO
```

### Important ORDERDTL Columns

```
ORDER_NO, LINE_NO, PART_NO, DESCRIPTION, QTY_ORDERED, QTY_SHIPPED,
UNIT_PRICE, EXTENDED_PRICE
```

### Important INVCHEA Columns

```
INVOICE_NO, CUSTOMER_NO, ORDER_NO, INVOICE_DATE, INVOICE_TOTAL,
GP, BALANCE, SALES_REP (use ORDERHEA.USERNAME instead for rep attribution)
```

### Important CUSTOMER Columns

```
CUSTOMER_NO, NAME, USERNAME (DO NOT use for rep attribution),
CITY, STATE, STATUS, LAST_ACTIVITY
```

## Sales Reps — SQL USERNAME → App Rep ID

| SQL USERNAME | App Rep ID | Name |
|-------------|------------|------|
| `CKaren` | `CKaren` | Karen Mancebo |
| `BillP` | `BillP` | Bill Pratt |
| `PIan` | `PIan` | Ian Pitman |
| `RMauricio` | `RMauricio` | Mauricio Rangel |
| `LMancera` | `LMancera` | Lizeth Mancera |
| `bcastor` | `bcastor` | Brandon Castor |
| `FJohn` | `FJohn` / `ADMIN` | John Fluman (admin) |
| `Anolan` | `Anolan` | Ana Nolan |
| `Abraham` | (transferred) | Former rep — accounts now under MX team |
| `Arlin` | (transferred) | Former rep — accounts now under MX team |

**MX Team reps:** CKaren, BillP, PIan, RMauricio, LMancera, bcastor

## Google Sheets — 3 Spreadsheets

| Name | Spreadsheet ID | Purpose |
|------|---------------|---------|
| Main | `1xH_OC_fvSwQWZet95xBlJ951LsaQWru-glv2rkSnDm4` | Per-rep tabs, MASTER, _LOG, _COLLECTIONS, _CONTACTS, _OPEN_ORDERS — **AT 10M CELL LIMIT, do not add tabs here** |
| History | `192ELLBgiEUZ3z6ytkWXbmA24wS2BjHmclJdf_UF_c24` | _GP, _INVOICE_HISTORY, _SIGNATURES, _ATTACK_PLAN, _CONTACT_NOTES, _SUGGESTIONS, _CUSTOMER_DIRECTORY — **all new tabs go here** |
| Activity | `12dJ0eLFQse-_pi1k6rXc25yTkwwYTjMm32v11tGKeRo` | _REQS, _QUOTES |

### Key Tabs the App Reads

| Tab | Sheet | Columns | Notes |
|-----|-------|---------|-------|
| `_GP` | History | BUYER_NAME, EXTENDED_PRICE, GP, INVOICE_DATE, SALES_REP | 22K rows, all years all reps |
| `_INVOICE_HISTORY` | History | customer, invoiceNo, date, part, desc, qty, lineTotal, rep | Line items for current-rep accounts |
| `_COLLECTIONS` | Main | account name, balance, status, hold, days past due | Open AR |
| `_CONTACTS` | Main | ACCOUNT_NAME, CONTACT_NAME, EMAIL, PHONE, TITLE | 7,898 contacts |
| `_OPEN_ORDERS` | Main | order details | Unfulfilled orders |
| `_CUSTOMER_DIRECTORY` | History | CUSTOMER_NO, NAME, USERNAME, CITY, STATE, LAST_ACTIVITY | 2,487 CRM accounts |
| Per-rep tabs | Main | One tab per rep (CKaren, BillP, PIan, etc.) | Account-level YTD data |

### _LOG Tab Format (Main sheet)

Python script rows use: `[RUN_DATE, TOTAL_ACCOUNTS, INACTIVE, AT_RISK, ACTIVE, NOTE]`
- Col B is numeric (account count ~816) — used to identify script run rows vs app security events
- App security events have string in col B (LOGIN, FORCE_LOGOUT, etc.)

## What sales_report.py Does (Overview)

1. Connects to CCCRM SQL Server
2. For each rep tab: pulls account-level YTD revenue, prior year, status, follow-up date, notes
3. Pushes MASTER tab (all accounts combined)
4. Pushes `_GP` tab: 22K invoice header rows for GP analysis
5. Pushes `_INVOICE_HISTORY` tab: line items with part numbers (current-rep accounts)
6. Pushes `_COLLECTIONS` tab: open AR balances from INVCHEA.BALANCE
7. Pushes `_CONTACTS` tab: contact info from CRM
8. Pushes `_OPEN_ORDERS` tab: unfulfilled orders
9. Pushes `_CUSTOMER_DIRECTORY` tab: all CUSTOMER rows for active reps
10. Logs run stats to `_LOG` tab in Main sheet

## Scheduler

- Task name: `IntransitSalesReport`
- Schedule: every 30 minutes, 6 AM – 6 PM daily
- Runs as: SYSTEM
- Command: `python C:\scripts\sales_report.py >> C:\scripts\logs\sales_report.log 2>&1`
- Check status: `Get-ScheduledTaskInfo -TaskName "IntransitSalesReport"`
- View log: `Get-Content C:\scripts\logs\sales_report.log -Tail 50`

## Current Pending Task — Pre-Transfer Account History

**Background:** Karen Mancebo (MX Team manager) needs purchase history for 6 accounts that were transferred to MX team from former reps Abraham and Arlin. She needs:
1. Revenue in the year BEFORE MX team took over (under Abraham/Arlin)
2. **Most frequently ordered part numbers** from those accounts in the pre-transfer period
3. This data will be used to build customer outreach lists

**Target accounts:** San Luis Metal, Siemens, Martinrea, Porta Systems, Navistar, Thyssenkrupp

**The gap:** `_INVOICE_HISTORY` (line items with part numbers) only covers current-rep accounts. Pre-transfer line items are missing. Revenue-only data is available in `_GP` for all years.

**What needs to be built:** A new tab `_TRANSFER_HISTORY` in the History sheet that pulls ALL `ORDERDTL` line items for these 6 accounts across ALL years (not just current rep). This gives Karen the pre-transfer part numbers she needs.

### Suggested SQL for _TRANSFER_HISTORY

```sql
SELECT
    c.NAME                          AS ACCOUNT_NAME,
    oh.USERNAME                     AS SALES_REP,
    oh.ORDER_DATE,
    oh.INVOICE_DATE,
    od.PART_NO                      AS PART_NUMBER,
    od.DESCRIPTION,
    od.QTY_SHIPPED,
    od.EXTENDED_PRICE               AS LINE_REVENUE,
    ih.GP                           AS INVOICE_GP,
    ih.INVOICE_NO
FROM dbo.ORDERHEA oh
JOIN dbo.ORDERDTL od ON oh.ORDER_NO = od.ORDER_NO
JOIN dbo.CUSTOMER c  ON oh.CUSTOMER_NO = c.CUSTOMER_NO
LEFT JOIN dbo.INVCHEA ih ON oh.ORDER_NO = ih.ORDER_NO
WHERE c.NAME LIKE '%San Luis Metal%'
   OR c.NAME LIKE '%Siemens%'
   OR c.NAME LIKE '%Martinrea%'
   OR c.NAME LIKE '%Porta Systems%'
   OR c.NAME LIKE '%Navistar%'
   OR c.NAME LIKE '%Thyssenkrupp%'
ORDER BY c.NAME, oh.ORDER_DATE DESC
```

Run this to verify row counts before adding to sales_report.py. Then add a `push_transfer_history_tab()` function following the same pattern as `push_invoice_history_tab()`.

## Key Python Patterns in sales_report.py

```python
# Standard connection
conn = pyodbc.connect('DRIVER={SQL Server};SERVER=localhost;DATABASE=CCCRM;Trusted_Connection=yes')

# Standard tab push pattern
def push_some_tab(service, conn, all_tabs):
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT ...")
        rows = cursor.fetchall()
        headers = [desc[0] for desc in cursor.description]
        data = [headers] + [list(r) for r in rows]
        resize_tab(service, HISTORY_SPREADSHEET_ID, 'TabName', len(data), len(headers))
        write_to_sheet(service, HISTORY_SPREADSHEET_ID, 'TabName', data)
        print(f"  pushed {len(rows)} rows to _TAB_NAME")
    except Exception as e:
        import traceback
        traceback.print_exc()

# Always open own connection for standalone functions — don't rely on passed conn
# (main conn may be closed by the time the function runs)
```

## Important Notes

- Always test SQL queries in SSMS or a quick Python snippet before modifying sales_report.py
- After editing sales_report.py here, copy it to `C:\Users\fluma\sales_report.py` on John's local machine to keep in sync (or commit to the sales-app GitHub repo)
- The app at johnfluman-tech.github.io reads Google Sheets — changes only appear after sales_report.py runs and pushes new data
- Never expose `C:\scripts\google_credentials.json` or `C:\scripts\supabase_config.py` contents
