"""
find_crm_sp.py — Run on RDS02: python C:\scripts\find_crm_sp.py
Finds the stored procedure(s) the CRM uses to show account/customer details,
then shows the column it uses to display the assigned salesperson.
"""
import pyodbc, sys
conn = pyodbc.connect(
    "DRIVER={ODBC Driver 17 for SQL Server};SERVER=localhost;DATABASE=CCCRM;Trusted_Connection=yes;"
)
cur = conn.cursor()

print("=" * 65)
print("LOOKING FOR CRM REP/SALESPERSON LOGIC")
print("=" * 65)

# 1. All stored procedures — look for customer/account/rep related ones
print("\n[1] Stored procedures with customer/account/rep/sales in name:")
cur.execute("""
    SELECT ROUTINE_NAME
    FROM INFORMATION_SCHEMA.ROUTINES
    WHERE ROUTINE_TYPE = 'PROCEDURE'
      AND (ROUTINE_NAME LIKE '%CUST%' OR ROUTINE_NAME LIKE '%ACCT%'
           OR ROUTINE_NAME LIKE '%ACCOUNT%' OR ROUTINE_NAME LIKE '%REP%'
           OR ROUTINE_NAME LIKE '%SALES%' OR ROUTINE_NAME LIKE '%CONTACT%')
    ORDER BY ROUTINE_NAME
""")
procs = [r[0] for r in cur.fetchall()]
for p in procs:
    print(f"  {p}")
if not procs:
    print("  (none found)")

# 2. ALL stored procedures — show full list so we don't miss any
print("\n[2] All stored procedures in CCCRM:")
cur.execute("""
    SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES
    WHERE ROUTINE_TYPE = 'PROCEDURE'
    ORDER BY ROUTINE_NAME
""")
all_procs = [r[0] for r in cur.fetchall()]
for p in all_procs:
    print(f"  {p}")

# 3. Views that reference CUSTOMER with a rep/salesman join
print("\n[3] Views referencing customer + rep/salesman:")
cur.execute("""
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.VIEWS
    WHERE (TABLE_NAME LIKE '%CUST%' OR TABLE_NAME LIKE '%REP%' OR TABLE_NAME LIKE '%SALES%')
    ORDER BY TABLE_NAME
""")
views = [r[0] for r in cur.fetchall()]
for v in views:
    print(f"  {v}")
if not views:
    print("  (none)")

# 4. ALL tables — look for a rep/salesman assignment table
print("\n[4] Tables that might store rep assignment:")
cur.execute("""
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE='BASE TABLE'
      AND (TABLE_NAME LIKE '%REP%' OR TABLE_NAME LIKE '%SALES%' OR TABLE_NAME LIKE '%ASSIGN%'
           OR TABLE_NAME LIKE '%TERR%' OR TABLE_NAME LIKE '%AGENT%')
    ORDER BY TABLE_NAME
""")
tables = [r[0] for r in cur.fetchall()]
for t in tables:
    print(f"  {t}")
if not tables:
    print("  (none)")

# 5. All columns named SALESMAN, REP_ID, SALES_REP, etc. across all tables
print("\n[5] Columns named like SALESMAN/REP/AGENT across all tables:")
cur.execute("""
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE (COLUMN_NAME LIKE '%SALES%' OR COLUMN_NAME LIKE '%REP%'
           OR COLUMN_NAME LIKE '%AGENT%' OR COLUMN_NAME LIKE '%ASSIGN%'
           OR COLUMN_NAME LIKE '%OWNER%' OR COLUMN_NAME LIKE '%TERR%')
      AND TABLE_NAME NOT IN ('sysdiagrams')
    ORDER BY TABLE_NAME, COLUMN_NAME
""")
for r in cur.fetchall():
    print(f"  {r[0]:30s}  {r[1]:30s}  ({r[2]})")

# 6. Show AFL Telecomunicaciones across ALL tables to find any rep link
print("\n[6] AFL Telecomunicaciones customer IDs: 12132 and 12795")
print("    Searching for any table that references these IDs with a rep column...")
# Look in SALESMAN, CUSTSAL, SALESREP type tables
for cid in [12132, 12795]:
    print(f"\n  Customer ID {cid}:")
    # Try common cross-reference table names
    for tbl in ['CUSTSAL','CUSTSALES','SALESREP','CUSTREP','CUST_REP','CUSTOMER_REP',
                'TERRITORY','SALESMAN','SALESMEN','EMPLOYEE_CUSTOMER']:
        try:
            cur.execute(f"SELECT TOP 3 * FROM dbo.{tbl} WHERE CUSTOMER_ID=?", cid)
            rows = cur.fetchall()
            if rows:
                cols = [d[0] for d in cur.description]
                print(f"    Found in {tbl}: {cols}")
                for r in rows:
                    print(f"      {r}")
        except:
            pass

print("\n" + "="*65)
print("Share this output — it shows where the CRM stores the assigned rep.")
print("="*65)
conn.close()
