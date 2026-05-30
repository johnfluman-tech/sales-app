"""
diagnose_attribution.py
Run on RDS02: python C:\scripts\diagnose_attribution.py

Diagnoses rep attribution to find: what is the CRM's actual "assigned rep" field,
and which accounts are incorrectly showing under FJohn.
"""
import pyodbc, sys

conn = pyodbc.connect(
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=localhost;"
    "DATABASE=CCCRM;"
    "Trusted_Connection=yes;"
)
cur = conn.cursor()

KNOWN_REPS = ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')

print("=" * 70)
print("ATTRIBUTION DIAGNOSTIC")
print("=" * 70)

# ── 1. CUSTOMER table columns ──────────────────────────────────────────────
print("\n[1] CUSTOMER table columns (rep/salesman-related):")
cur.execute("""
    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='CUSTOMER'
    ORDER BY ORDINAL_POSITION
""")
for row in cur.fetchall():
    name = row[0]
    if any(kw in name.upper() for kw in
           ['USER','REP','SALE','TERR','ASSIGN','OWNER','RESP','AGENT']):
        print(f"  *** {name} ({row[1]})")
    else:
        print(f"      {name} ({row[1]})")

# ── 2. What c.USERNAME looks like — distinct values ────────────────────────
print("\n[2] Distinct CUSTOMER.USERNAME values and count:")
cur.execute("""
    SELECT USERNAME, COUNT(*) AS cnt
    FROM dbo.CUSTOMER
    WHERE USERNAME IS NOT NULL AND USERNAME != ''
    GROUP BY USERNAME
    ORDER BY cnt DESC
""")
rows = cur.fetchall()
for r in rows[:30]:
    marker = " ***KNOWN REP***" if r[0] in KNOWN_REPS else ""
    print(f"  {r[0]!r:30s} {r[1]:>5}{marker}")
if len(rows) > 30:
    print(f"  ... and {len(rows)-30} more")

# ── 3. How many accounts each rep "owns" via c.USERNAME ──────────────────
print("\n[3] Accounts attributed to known reps via CUSTOMER.USERNAME:")
cur.execute(f"""
    SELECT USERNAME, COUNT(*) as cnt
    FROM dbo.CUSTOMER
    WHERE USERNAME IN {KNOWN_REPS}
    GROUP BY USERNAME
    ORDER BY cnt DESC
""")
for r in cur.fetchall():
    print(f"  {r[0]:15s} {r[1]:>5} accounts")

# ── 4. Check if SALESMAN or other rep column exists ────────────────────────
print("\n[4] Checking CUSTOMER.SALESMAN values (if column exists):")
try:
    cur.execute("""
        SELECT SALESMAN, COUNT(*) AS cnt
        FROM dbo.CUSTOMER
        WHERE SALESMAN IS NOT NULL AND SALESMAN != ''
        GROUP BY SALESMAN
        ORDER BY cnt DESC
    """)
    rows = cur.fetchall()
    for r in rows[:20]:
        print(f"  {r[0]!r:30s} {r[1]:>5}")
except Exception as e:
    print(f"  No SALESMAN column: {e}")

# ── 5. Problem accounts — Alstom and Hitchiner ────────────────────────────
PROBLEM_ACCS = ['Alstom Transportation Mexico', 'Hitchiner', 'Siemens']
print(f"\n[5] Detail for problem accounts (contains '{', '.join(PROBLEM_ACCS)}'):")
cur.execute("""
    SELECT c.ID, c.NAME, c.USERNAME as CUST_USERNAME,
           c.LAST_ACTIVITY
    FROM dbo.CUSTOMER c
    WHERE c.NAME LIKE '%Alstom%'
       OR c.NAME LIKE '%Hitchiner%'
       OR c.NAME LIKE '%Siemens%'
    ORDER BY c.NAME
""")
accounts = cur.fetchall()
for acc in accounts:
    cid, name, cust_user, last_act = acc
    print(f"\n  Account: {name}")
    print(f"    CUSTOMER.USERNAME = {cust_user!r}")
    print(f"    LAST_ACTIVITY     = {last_act}")

    # Orders breakdown by rep login
    cur.execute("""
        SELECT o.USERNAME, COUNT(*) as cnt, MAX(o.ORDER_DATE) as last_order
        FROM dbo.ORDERHEA o
        WHERE o.CUSTOMER_ID = ?
        GROUP BY o.USERNAME
        ORDER BY cnt DESC
    """, cid)
    order_rows = cur.fetchall()
    print(f"    Orders by login (ORDERHEA.USERNAME):")
    for r in order_rows[:10]:
        print(f"      {r[0]:20s} {r[1]:>4} orders, last={r[2]}")

    # Via EMPLOYEE table
    cur.execute("""
        SELECT e.USERNAME as EMP_USERNAME, o.USERNAME as LOGIN, COUNT(*) as cnt,
               MAX(o.ORDER_DATE) as last_order
        FROM dbo.ORDERHEA o
        JOIN dbo.EMPLOYEE e ON e.LOGIN_ID = o.USERNAME
        WHERE o.CUSTOMER_ID = ?
          AND e.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')
        GROUP BY e.USERNAME, o.USERNAME
        ORDER BY cnt DESC
    """, cid)
    emp_rows = cur.fetchall()
    print(f"    Via EMPLOYEE table (login->rep mapping):")
    for r in emp_rows[:10]:
        print(f"      login={r[1]:20s} -> rep={r[0]:15s} {r[2]:>4} orders, last={r[3]}")

# ── 6. FJohn's accounts breakdown ─────────────────────────────────────────
print("\n[6] How FJohn's accounts are attributed (current 3-priority logic):")
cur.execute("""
    -- Priority 1: c.USERNAME = 'FJohn'
    SELECT COUNT(*) FROM dbo.CUSTOMER WHERE USERNAME = 'FJohn'
""")
p1 = cur.fetchone()[0]
print(f"  Priority 1 (c.USERNAME='FJohn'): {p1} accounts")

cur.execute("""
    -- Accounts not directly assigned to FJohn but where FJohn placed most orders
    WITH direct_rep_orders AS (
        SELECT o.CUSTOMER_ID, o.USERNAME AS SALES_REP,
               COUNT(*) AS order_count
        FROM dbo.ORDERHEA o
        JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID
        WHERE o.USERNAME = 'FJohn'
          AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')
        GROUP BY o.CUSTOMER_ID, o.USERNAME
    ),
    all_rep_orders AS (
        SELECT o.CUSTOMER_ID, o.USERNAME AS SALES_REP,
               COUNT(*) AS order_count,
               ROW_NUMBER() OVER (PARTITION BY o.CUSTOMER_ID ORDER BY COUNT(*) DESC) as rn
        FROM dbo.ORDERHEA o
        JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID
        WHERE o.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')
          AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')
        GROUP BY o.CUSTOMER_ID, o.USERNAME
    )
    SELECT COUNT(*)
    FROM all_rep_orders
    WHERE SALES_REP = 'FJohn' AND rn = 1
""")
p2 = cur.fetchone()[0]
print(f"  Priority 2 (FJohn placed most orders): {p2} accounts")

# ── 7. FJohn accounts via Priority 2 — are they really his? ──────────────
print("\n[7] FJohn Priority-2 accounts (most orders) — show top 20 with details:")
cur.execute("""
    WITH all_rep_orders AS (
        SELECT o.CUSTOMER_ID, o.USERNAME AS SALES_REP,
               COUNT(*) AS order_count,
               MAX(o.ORDER_DATE) AS last_order,
               ROW_NUMBER() OVER (PARTITION BY o.CUSTOMER_ID ORDER BY COUNT(*) DESC, MAX(o.ORDER_DATE) DESC) as rn
        FROM dbo.ORDERHEA o
        JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID
        WHERE o.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')
          AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')
        GROUP BY o.CUSTOMER_ID, o.USERNAME
    )
    SELECT c.NAME, c.USERNAME as CUST_USER, aro.order_count, aro.last_order,
           -- runner-up rep
           (SELECT TOP 1 o2.USERNAME + '(' + CAST(COUNT(*) AS VARCHAR) + ')'
            FROM dbo.ORDERHEA o2
            WHERE o2.CUSTOMER_ID = aro.CUSTOMER_ID
              AND o2.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')
              AND o2.USERNAME != 'FJohn'
            GROUP BY o2.USERNAME
            ORDER BY COUNT(*) DESC) AS runner_up
    FROM all_rep_orders aro
    JOIN dbo.CUSTOMER c ON c.ID = aro.CUSTOMER_ID
    WHERE aro.SALES_REP = 'FJohn' AND aro.rn = 1
    ORDER BY aro.order_count DESC
""")
rows = cur.fetchall()
print(f"  Found {len(rows)} accounts attributed to FJohn via Priority 2:")
for r in rows[:20]:
    print(f"    {str(r[0])[:45]:45s} CUST_USER={str(r[1])[:12]:12s} FJohn={r[2]:>4} orders, runner_up={r[4]}")

# ── 8. Check EMPLOYEE table — what maps to FJohn? ─────────────────────────
print("\n[8] EMPLOYEE table — logins that map to FJohn:")
try:
    cur.execute("""
        SELECT LOGIN_ID, USERNAME, FIRST_NAME, LAST_NAME
        FROM dbo.EMPLOYEE
        WHERE USERNAME = 'FJohn'
        ORDER BY LOGIN_ID
    """)
    for r in cur.fetchall():
        print(f"  LOGIN_ID={r[0]!r:20s} -> USERNAME={r[1]} ({r[2]} {r[3]})")
except Exception as e:
    print(f"  Error: {e}")

# ── 9. Does CUSTOMER table have any other rep-assignment columns? ──────────
print("\n[9] All CUSTOMER columns containing 'SALE', 'REP', 'USER', 'TERR' in name:")
cur.execute("""
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='CUSTOMER' AND TABLE_SCHEMA='dbo'
      AND (COLUMN_NAME LIKE '%SALE%' OR COLUMN_NAME LIKE '%REP%'
           OR COLUMN_NAME LIKE '%USER%' OR COLUMN_NAME LIKE '%TERR%'
           OR COLUMN_NAME LIKE '%ASSIGN%' OR COLUMN_NAME LIKE '%OWNER%')
    ORDER BY ORDINAL_POSITION
""")
for r in cur.fetchall():
    print(f"  {r[0]}")

print("\n" + "="*70)
print("DONE. Share this output to determine the correct attribution logic.")
print("="*70)
conn.close()
