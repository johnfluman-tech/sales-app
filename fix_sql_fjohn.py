"""
fix_sql_fjohn.py
Fixes FJohn over-attribution in all 5 SQL queries.

Root cause: FJohn (admin) enters orders across many accounts on behalf of other
reps. The previous 'most orders' Priority-2 logic gave those accounts to FJohn
even when BillP, Karen, etc. had fewer orders but are the real account managers.

New priority chain for unassigned accounts (c.USERNAME not a known rep):
  P2: Non-FJohn rep with the most direct orders wins
  P3: FJohn only if NO other known rep placed any direct order for this account
  P4: EMPLOYEE table fallback (dmacdonald->FJohn etc.) only when P2+P3 both miss

Applied to all 5 queries: dir_sql, main sql, line_items_sql, collections_sql, gp_sql.
"""

SRC = r'C:\Users\fluma\sales-app\sales_report.py'

with open(SRC, 'rb') as f:
    content = f.read().decode('utf-8')
content = content.replace('\r\n', '\n')
changes = []

# ── Block A: 12-space-indented (dir_sql, collections_sql, gp_sql — 3 occurrences) ──

old_12 = (
    "            WITH direct_rep_orders AS (\n"
    "                SELECT o.CUSTOMER_ID, o.USERNAME AS SALES_REP,\n"
    "                       COUNT(*) AS order_count, MAX(o.ORDER_DATE) AS last_order\n"
    "                FROM dbo.ORDERHEA o\n"
    "                JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "                WHERE o.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "                  AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "                GROUP BY o.CUSTOMER_ID, o.USERNAME\n"
    "            ),\n"
    "            direct_rep_ranked AS (\n"
    "                SELECT CUSTOMER_ID, SALES_REP,\n"
    "                       ROW_NUMBER() OVER (PARTITION BY CUSTOMER_ID ORDER BY order_count DESC, last_order DESC) AS rn\n"
    "                FROM direct_rep_orders\n"
    "            ),\n"
    "            rep_by_employee AS (\n"
    "                SELECT o.CUSTOMER_ID, e.USERNAME AS SALES_REP,\n"
    "                       ROW_NUMBER() OVER (PARTITION BY o.CUSTOMER_ID ORDER BY o.ORDER_DATE DESC) AS rn\n"
    "                FROM dbo.ORDERHEA o\n"
    "                JOIN dbo.EMPLOYEE e ON e.LOGIN_ID = o.USERNAME\n"
    "                JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "                WHERE e.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "                  AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "                  AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM direct_rep_ranked WHERE rn = 1)\n"
    "            ),\n"
    "            owned_accounts AS (\n"
    "                SELECT c.ID AS CUSTOMER_ID, c.USERNAME AS SALES_REP\n"
    "                FROM dbo.CUSTOMER c\n"
    "                WHERE c.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "                UNION ALL\n"
    "                SELECT CUSTOMER_ID, SALES_REP FROM direct_rep_ranked WHERE rn = 1\n"
    "                UNION ALL\n"
    "                SELECT CUSTOMER_ID, SALES_REP FROM rep_by_employee WHERE rn = 1\n"
    "            )"
)

new_12 = (
    "            WITH non_fjohn_orders AS (\n"
    "                -- FJohn is admin and enters orders across many accounts on behalf of other reps.\n"
    "                -- Exclude him from Priority-2 so the actual managing rep wins.\n"
    "                SELECT o.CUSTOMER_ID, o.USERNAME AS SALES_REP,\n"
    "                       COUNT(*) AS order_count, MAX(o.ORDER_DATE) AS last_order\n"
    "                FROM dbo.ORDERHEA o\n"
    "                JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "                WHERE o.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','Anolan')\n"
    "                  AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "                GROUP BY o.CUSTOMER_ID, o.USERNAME\n"
    "            ),\n"
    "            non_fjohn_ranked AS (\n"
    "                SELECT CUSTOMER_ID, SALES_REP,\n"
    "                       ROW_NUMBER() OVER (PARTITION BY CUSTOMER_ID ORDER BY order_count DESC, last_order DESC) AS rn\n"
    "                FROM non_fjohn_orders\n"
    "            ),\n"
    "            fjohn_fallback AS (\n"
    "                -- FJohn gets credit only for accounts where no other known rep placed any order\n"
    "                SELECT DISTINCT o.CUSTOMER_ID, 'FJohn' AS SALES_REP\n"
    "                FROM dbo.ORDERHEA o\n"
    "                JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "                WHERE o.USERNAME = 'FJohn'\n"
    "                  AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "                  AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM non_fjohn_ranked WHERE rn = 1)\n"
    "            ),\n"
    "            rep_by_employee AS (\n"
    "                -- EMPLOYEE login lookup: only for accounts neither P2 nor P3 covered\n"
    "                SELECT o.CUSTOMER_ID, e.USERNAME AS SALES_REP,\n"
    "                       ROW_NUMBER() OVER (PARTITION BY o.CUSTOMER_ID ORDER BY o.ORDER_DATE DESC) AS rn\n"
    "                FROM dbo.ORDERHEA o\n"
    "                JOIN dbo.EMPLOYEE e ON e.LOGIN_ID = o.USERNAME\n"
    "                JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "                WHERE e.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "                  AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "                  AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM non_fjohn_ranked WHERE rn = 1)\n"
    "                  AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM fjohn_fallback)\n"
    "            ),\n"
    "            owned_accounts AS (\n"
    "                SELECT c.ID AS CUSTOMER_ID, c.USERNAME AS SALES_REP\n"
    "                FROM dbo.CUSTOMER c\n"
    "                WHERE c.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "                UNION ALL\n"
    "                SELECT CUSTOMER_ID, SALES_REP FROM non_fjohn_ranked WHERE rn = 1\n"
    "                UNION ALL\n"
    "                SELECT CUSTOMER_ID, SALES_REP FROM fjohn_fallback\n"
    "                UNION ALL\n"
    "                SELECT CUSTOMER_ID, SALES_REP FROM rep_by_employee WHERE rn = 1\n"
    "            )"
)

n = content.count(old_12)
assert n == 3, f"Expected 3 matches for 12-space block, got {n}"
content = content.replace(old_12, new_12)
changes.append(f"A. 12-space block (dir_sql, collections_sql, gp_sql) x{n}")

# ── Block B: 8-space with comments (main sql — 1 occurrence) ──

old_8c = (
    "        WITH direct_rep_orders AS (\n"
    "            SELECT o.CUSTOMER_ID, o.USERNAME AS SALES_REP,\n"
    "                   COUNT(*) AS order_count, MAX(o.ORDER_DATE) AS last_order\n"
    "            FROM dbo.ORDERHEA o\n"
    "            JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "            WHERE o.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "            GROUP BY o.CUSTOMER_ID, o.USERNAME\n"
    "        ),\n"
    "        direct_rep_ranked AS (\n"
    "            SELECT CUSTOMER_ID, SALES_REP,\n"
    "                   ROW_NUMBER() OVER (PARTITION BY CUSTOMER_ID ORDER BY order_count DESC, last_order DESC) AS rn\n"
    "            FROM direct_rep_orders\n"
    "        ),\n"
    "        rep_by_employee AS (\n"
    "            -- EMPLOYEE table fallback: only for accounts where no known rep placed direct orders\n"
    "            -- (e.g. dmacdonald->FJohn for Zebra Technologies)\n"
    "            SELECT o.CUSTOMER_ID, e.USERNAME AS SALES_REP,\n"
    "                   ROW_NUMBER() OVER (PARTITION BY o.CUSTOMER_ID ORDER BY o.ORDER_DATE DESC) AS rn\n"
    "            FROM dbo.ORDERHEA o\n"
    "            JOIN dbo.EMPLOYEE e ON e.LOGIN_ID = o.USERNAME\n"
    "            JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "            WHERE e.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM direct_rep_ranked WHERE rn = 1)\n"
    "        ),\n"
    "        owned_accounts AS (\n"
    "            -- Priority 1: Direct assignment via c.USERNAME\n"
    "            SELECT c.ID AS CUSTOMER_ID, c.USERNAME AS SALES_REP\n"
    "            FROM dbo.CUSTOMER c\n"
    "            WHERE c.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "            UNION ALL\n"
    "            -- Priority 2: Rep placed most orders for this account with their own login\n"
    "            SELECT CUSTOMER_ID, SALES_REP FROM direct_rep_ranked WHERE rn = 1\n"
    "            UNION ALL\n"
    "            -- Priority 3: EMPLOYEE table fallback (only accounts with no direct rep orders)\n"
    "            SELECT CUSTOMER_ID, SALES_REP FROM rep_by_employee WHERE rn = 1\n"
    "        )"
)

new_8c = (
    "        WITH non_fjohn_orders AS (\n"
    "            SELECT o.CUSTOMER_ID, o.USERNAME AS SALES_REP,\n"
    "                   COUNT(*) AS order_count, MAX(o.ORDER_DATE) AS last_order\n"
    "            FROM dbo.ORDERHEA o\n"
    "            JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "            WHERE o.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','Anolan')\n"
    "              AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "            GROUP BY o.CUSTOMER_ID, o.USERNAME\n"
    "        ),\n"
    "        non_fjohn_ranked AS (\n"
    "            SELECT CUSTOMER_ID, SALES_REP,\n"
    "                   ROW_NUMBER() OVER (PARTITION BY CUSTOMER_ID ORDER BY order_count DESC, last_order DESC) AS rn\n"
    "            FROM non_fjohn_orders\n"
    "        ),\n"
    "        fjohn_fallback AS (\n"
    "            SELECT DISTINCT o.CUSTOMER_ID, 'FJohn' AS SALES_REP\n"
    "            FROM dbo.ORDERHEA o\n"
    "            JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "            WHERE o.USERNAME = 'FJohn'\n"
    "              AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM non_fjohn_ranked WHERE rn = 1)\n"
    "        ),\n"
    "        rep_by_employee AS (\n"
    "            SELECT o.CUSTOMER_ID, e.USERNAME AS SALES_REP,\n"
    "                   ROW_NUMBER() OVER (PARTITION BY o.CUSTOMER_ID ORDER BY o.ORDER_DATE DESC) AS rn\n"
    "            FROM dbo.ORDERHEA o\n"
    "            JOIN dbo.EMPLOYEE e ON e.LOGIN_ID = o.USERNAME\n"
    "            JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "            WHERE e.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM non_fjohn_ranked WHERE rn = 1)\n"
    "              AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM fjohn_fallback)\n"
    "        ),\n"
    "        owned_accounts AS (\n"
    "            -- P1: Direct CUSTOMER.USERNAME assignment\n"
    "            SELECT c.ID AS CUSTOMER_ID, c.USERNAME AS SALES_REP\n"
    "            FROM dbo.CUSTOMER c\n"
    "            WHERE c.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "            UNION ALL\n"
    "            -- P2: Non-FJohn rep with most direct orders (FJohn excluded — he's admin)\n"
    "            SELECT CUSTOMER_ID, SALES_REP FROM non_fjohn_ranked WHERE rn = 1\n"
    "            UNION ALL\n"
    "            -- P3: FJohn only if no other known rep placed any order\n"
    "            SELECT CUSTOMER_ID, SALES_REP FROM fjohn_fallback\n"
    "            UNION ALL\n"
    "            -- P4: EMPLOYEE table fallback (dmacdonald->FJohn etc., only if P2+P3 both miss)\n"
    "            SELECT CUSTOMER_ID, SALES_REP FROM rep_by_employee WHERE rn = 1\n"
    "        )"
)

n = content.count(old_8c)
assert n == 1, f"Expected 1 match for 8-space-comment block (main sql), got {n}"
content = content.replace(old_8c, new_8c)
changes.append("B. 8-space-comment block (main sql) x1")

# ── Block C: 8-space no-comments (line_items_sql — 1 occurrence) ──

old_8nc = (
    "        WITH direct_rep_orders AS (\n"
    "            SELECT o.CUSTOMER_ID, o.USERNAME AS SALES_REP,\n"
    "                   COUNT(*) AS order_count, MAX(o.ORDER_DATE) AS last_order\n"
    "            FROM dbo.ORDERHEA o\n"
    "            JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "            WHERE o.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "            GROUP BY o.CUSTOMER_ID, o.USERNAME\n"
    "        ),\n"
    "        direct_rep_ranked AS (\n"
    "            SELECT CUSTOMER_ID, SALES_REP,\n"
    "                   ROW_NUMBER() OVER (PARTITION BY CUSTOMER_ID ORDER BY order_count DESC, last_order DESC) AS rn\n"
    "            FROM direct_rep_orders\n"
    "        ),\n"
    "        rep_by_employee AS (\n"
    "            SELECT o.CUSTOMER_ID, e.USERNAME AS SALES_REP,\n"
    "                   ROW_NUMBER() OVER (PARTITION BY o.CUSTOMER_ID ORDER BY o.ORDER_DATE DESC) AS rn\n"
    "            FROM dbo.ORDERHEA o\n"
    "            JOIN dbo.EMPLOYEE e ON e.LOGIN_ID = o.USERNAME\n"
    "            JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "            WHERE e.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM direct_rep_ranked WHERE rn = 1)\n"
    "        ),\n"
    "        owned_accounts AS (\n"
    "            SELECT c.ID AS CUSTOMER_ID, c.USERNAME AS SALES_REP\n"
    "            FROM dbo.CUSTOMER c\n"
    "            WHERE c.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "            UNION ALL\n"
    "            SELECT CUSTOMER_ID, SALES_REP FROM direct_rep_ranked WHERE rn = 1\n"
    "            UNION ALL\n"
    "            SELECT CUSTOMER_ID, SALES_REP FROM rep_by_employee WHERE rn = 1\n"
    "        )"
)

new_8nc = (
    "        WITH non_fjohn_orders AS (\n"
    "            SELECT o.CUSTOMER_ID, o.USERNAME AS SALES_REP,\n"
    "                   COUNT(*) AS order_count, MAX(o.ORDER_DATE) AS last_order\n"
    "            FROM dbo.ORDERHEA o\n"
    "            JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "            WHERE o.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','Anolan')\n"
    "              AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "            GROUP BY o.CUSTOMER_ID, o.USERNAME\n"
    "        ),\n"
    "        non_fjohn_ranked AS (\n"
    "            SELECT CUSTOMER_ID, SALES_REP,\n"
    "                   ROW_NUMBER() OVER (PARTITION BY CUSTOMER_ID ORDER BY order_count DESC, last_order DESC) AS rn\n"
    "            FROM non_fjohn_orders\n"
    "        ),\n"
    "        fjohn_fallback AS (\n"
    "            SELECT DISTINCT o.CUSTOMER_ID, 'FJohn' AS SALES_REP\n"
    "            FROM dbo.ORDERHEA o\n"
    "            JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "            WHERE o.USERNAME = 'FJohn'\n"
    "              AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM non_fjohn_ranked WHERE rn = 1)\n"
    "        ),\n"
    "        rep_by_employee AS (\n"
    "            SELECT o.CUSTOMER_ID, e.USERNAME AS SALES_REP,\n"
    "                   ROW_NUMBER() OVER (PARTITION BY o.CUSTOMER_ID ORDER BY o.ORDER_DATE DESC) AS rn\n"
    "            FROM dbo.ORDERHEA o\n"
    "            JOIN dbo.EMPLOYEE e ON e.LOGIN_ID = o.USERNAME\n"
    "            JOIN dbo.CUSTOMER c ON c.ID = o.CUSTOMER_ID\n"
    "            WHERE e.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND c.USERNAME NOT IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "              AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM non_fjohn_ranked WHERE rn = 1)\n"
    "              AND o.CUSTOMER_ID NOT IN (SELECT CUSTOMER_ID FROM fjohn_fallback)\n"
    "        ),\n"
    "        owned_accounts AS (\n"
    "            SELECT c.ID AS CUSTOMER_ID, c.USERNAME AS SALES_REP\n"
    "            FROM dbo.CUSTOMER c\n"
    "            WHERE c.USERNAME IN ('CKaren','BillP','PIan','RMauricio','LMancera','bcastor','FJohn','Anolan')\n"
    "            UNION ALL\n"
    "            SELECT CUSTOMER_ID, SALES_REP FROM non_fjohn_ranked WHERE rn = 1\n"
    "            UNION ALL\n"
    "            SELECT CUSTOMER_ID, SALES_REP FROM fjohn_fallback\n"
    "            UNION ALL\n"
    "            SELECT CUSTOMER_ID, SALES_REP FROM rep_by_employee WHERE rn = 1\n"
    "        )"
)

n = content.count(old_8nc)
assert n == 1, f"Expected 1 match for 8-space-nocomment block (line_items_sql), got {n}"
content = content.replace(old_8nc, new_8nc)
changes.append("C. 8-space-nocomment block (line_items_sql) x1")

with open(SRC, 'wb') as f:
    f.write(content.encode('utf-8'))

print(f"Done -- {len(changes)} changes applied:")
for c in changes:
    print(f"  {c}")
print("\nRun sales_report.py on RDS02 after deploying.")
