"""
check_afl.py — Run on RDS02: python C:\scripts\check_afl.py
Shows every rep-attribution fact about AFL Telecomunicaciones.
"""
import pyodbc, sys
conn = pyodbc.connect(
    "DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=CCCRM;Trusted_Connection=yes;"
)
cur = conn.cursor()
REPS = ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')

print("=" * 65)
print("AFL TELECOMUNICACIONES — attribution deep dive")
print("=" * 65)

# 1. CUSTOMER record
cur.execute("SELECT ID, NAME, USERNAME, LAST_ACTIVITY FROM dbo.CUSTOMER WHERE NAME LIKE '%AFL%'")
rows = cur.fetchall()
print(f"\n[1] CUSTOMER table rows matching 'AFL':")
for r in rows:
    print(f"  ID={r[0]}  NAME={r[1]}")
    print(f"       CUSTOMER.USERNAME = {r[2]!r}  <-- This is Priority-1 rep")
    print(f"       LAST_ACTIVITY     = {r[3]}")
    cid = r[0]

if not rows:
    print("  NOT FOUND — check exact name spelling"); conn.close(); sys.exit()

# Use first match
cid = rows[0][0]

# 2. Every login that ever placed an order for this account
print(f"\n[2] Every ORDER login (ORDERHEA.USERNAME) for customer ID={cid}:")
cur.execute("""
    SELECT o.USERNAME, COUNT(*) AS cnt, MIN(o.ORDER_DATE) AS first_order, MAX(o.ORDER_DATE) AS last_order
    FROM dbo.ORDERHEA o WHERE o.CUSTOMER_ID = ?
    GROUP BY o.USERNAME ORDER BY cnt DESC
""", cid)
for r in cur.fetchall():
    marker = " ***KNOWN REP***" if r[0] in REPS else ""
    print(f"  {str(r[0]):25s}  {r[1]:>4} orders  {r[2]} → {r[3]}{marker}")

# 3. Via EMPLOYEE table — which logins resolve to known reps
print(f"\n[3] EMPLOYEE table resolution (login → rep) for AFL orders:")
cur.execute("""
    SELECT o.USERNAME AS login, e.USERNAME AS rep,
           COUNT(*) AS cnt, MAX(o.ORDER_DATE) AS last_order
    FROM dbo.ORDERHEA o
    JOIN dbo.EMPLOYEE e ON e.LOGIN_ID = o.USERNAME
    WHERE o.CUSTOMER_ID = ?
      AND e.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')
    GROUP BY o.USERNAME, e.USERNAME
    ORDER BY cnt DESC
""", cid)
emp_rows = cur.fetchall()
if emp_rows:
    for r in emp_rows:
        print(f"  login={str(r[0]):25s} → rep={r[1]:10s}  {r[2]:>4} orders, last={r[3]}")
else:
    print("  (No EMPLOYEE matches — all orders entered under direct rep logins)")

# 4. Direct-rep orders (Priority 2 logic)
print(f"\n[4] Priority-2 check — known-rep direct orders for AFL:")
cur.execute("""
    SELECT o.USERNAME AS rep, COUNT(*) AS cnt, MAX(o.ORDER_DATE) AS last_order
    FROM dbo.ORDERHEA o WHERE o.CUSTOMER_ID = ?
      AND o.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')
    GROUP BY o.USERNAME ORDER BY cnt DESC
""", cid)
p2_rows = cur.fetchall()
if p2_rows:
    for r in p2_rows:
        print(f"  {r[0]:15s}  {r[1]:>4} orders, last={r[2]}")
    winner = p2_rows[0][0]
    print(f"\n  → Priority-2 winner: {winner}")
else:
    print("  (No direct known-rep orders — would fall to Priority-3 EMPLOYEE lookup)")

# 5. What our current 3-priority logic assigns
cur.execute("SELECT USERNAME FROM dbo.CUSTOMER WHERE ID = ?", cid)
c_user = (cur.fetchone() or ['?'])[0]
print(f"\n[5] CURRENT ATTRIBUTION RESULT:")
if c_user in REPS:
    print(f"  Priority 1 WIN: CUSTOMER.USERNAME = {c_user!r}")
elif p2_rows:
    print(f"  Priority 2 WIN: most orders by direct rep = {p2_rows[0][0]!r}")
elif emp_rows:
    print(f"  Priority 3 WIN: EMPLOYEE lookup = {emp_rows[0][1]!r}")
else:
    print(f"  No rep found (account would not appear)")

print(f"\n[6] What the CRM 'assigned rep' field should show:")
print(f"  Per user: should be BillP (Bill Pratt)")
print(f"  CUSTOMER.USERNAME is currently: {c_user!r}")
print(f"  If this is wrong, the CRM data needs correcting OR")
print(f"  we need to use a different field (SALESMAN, etc.)")

# 7. Check if SALESMAN column exists and what it shows
print(f"\n[7] CUSTOMER.SALESMAN for AFL (if column exists):")
try:
    cur.execute("SELECT SALESMAN FROM dbo.CUSTOMER WHERE ID = ?", cid)
    salesman = cur.fetchone()
    print(f"  SALESMAN = {salesman[0]!r}" if salesman else "  (no row)")
except:
    print("  (SALESMAN column does not exist)")

# 8. Any other rep-like columns
print(f"\n[8] All CUSTOMER columns with rep-related names:")
cur.execute("""
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME='CUSTOMER' AND TABLE_SCHEMA='dbo'
      AND (COLUMN_NAME LIKE '%SALE%' OR COLUMN_NAME LIKE '%REP%'
           OR COLUMN_NAME LIKE '%USER%' OR COLUMN_NAME LIKE '%TERR%'
           OR COLUMN_NAME LIKE '%ASSIGN%' OR COLUMN_NAME LIKE '%OWNER%'
           OR COLUMN_NAME LIKE '%AGENT%')
    ORDER BY ORDINAL_POSITION
""")
cols = [r[0] for r in cur.fetchall()]
print(f"  Columns found: {cols}")
if cols:
    col_list = ', '.join(cols)
    cur.execute(f"SELECT {col_list} FROM dbo.CUSTOMER WHERE ID = ?", cid)
    vals = cur.fetchone()
    if vals:
        for col, val in zip(cols, vals):
            print(f"  {col:30s} = {val!r}")

print("\n" + "="*65)
print("Share this output — it shows exactly why AFL lands under FJohn.")
print("="*65)
conn.close()
