"""
cleanup_main_sheet.py
Run on INTRANSIT-RDS02: python C:\scripts\cleanup_main_sheet.py

Frees ~7-8M allocated cells from the Main Google Sheet by shrinking tabs
that were moved to the History sheet in commit e4bd54b (2026-05-29).

Tabs shrunk to 10 rows x 5 cols (= 50 cells each):
  - Per-rep tabs: BillP, PIan, CKaren, RMauricio, LMancera, bcastor, FJohn, Anolan
  - MASTER  (app never read this — can be deleted)
  - _CONTACTS
  - _OPEN_ORDERS
  - _LOG
  - _COLLECTIONS

Tabs left alone (still read by app from Main sheet):
  - _HIDDEN_ACCOUNTS  (app reads this for hidden account persistence)
  - Everything else not in the cleanup list
"""

import os
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

CREDENTIALS_FILE = r"C:\scripts\google_credentials.json"
SPREADSHEET_ID   = "1xH_OC_fvSwQWZet95xBlJ951LsaQWru-glv2rkSnDm4"
SCOPES           = ["https://www.googleapis.com/auth/spreadsheets"]

# Tabs to shrink to bare minimum (data cleared + grid = 10 rows x 5 cols)
SHRINK_TABS = [
    'BillP', 'PIan', 'CKaren', 'RMauricio', 'LMancera', 'bcastor', 'FJohn', 'Anolan',
    '_CONTACTS', '_OPEN_ORDERS', '_LOG', '_COLLECTIONS',
]

# Tabs to delete entirely (never used by app)
DELETE_TABS = ['MASTER']

# Tabs that must NOT be touched
PRESERVE_TABS = ['_HIDDEN_ACCOUNTS']

MIN_ROWS = 10
MIN_COLS = 5


def get_service():
    creds = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)
    return build("sheets", "v4", credentials=creds)


def shrink_tab(service, sheet_id, tab_title):
    """Clear data and resize tab to MIN_ROWS x MIN_COLS."""
    # Clear all data
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"'{tab_title}'!A1:Z10000"
    ).execute()

    # Resize grid to minimum
    service.spreadsheets().batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={"requests": [{
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {
                        "rowCount": MIN_ROWS,
                        "columnCount": MIN_COLS
                    }
                },
                "fields": "gridProperties.rowCount,gridProperties.columnCount"
            }
        }]}
    ).execute()

    cells_freed = "unknown"
    print(f"  SHRUNK: '{tab_title}' -> {MIN_ROWS} rows x {MIN_COLS} cols (50 cells)")


def delete_tab(service, sheet_id, tab_title):
    """Delete a tab entirely."""
    service.spreadsheets().batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={"requests": [{"deleteSheet": {"sheetId": sheet_id}}]}
    ).execute()
    print(f"  DELETED: '{tab_title}'")


def main():
    print("=" * 60)
    print("Main Sheet Cleanup — freeing cells for tabs moved to History")
    print("=" * 60)

    if not os.path.exists(CREDENTIALS_FILE):
        print(f"ERROR: Credentials not found at {CREDENTIALS_FILE}")
        return

    service = get_service()

    # Get current tab list with their sheet IDs and grid sizes
    meta = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    sheets = meta['sheets']

    tab_info = {}
    total_before = 0
    for s in sheets:
        props = s['properties']
        title = props['title']
        sid = props['sheetId']
        rows = props['gridProperties']['rowCount']
        cols = props['gridProperties']['columnCount']
        cells = rows * cols
        total_before += cells
        tab_info[title] = {'sheet_id': sid, 'rows': rows, 'cols': cols, 'cells': cells}

    print(f"\nCurrent Main sheet: {len(sheets)} tabs, {total_before:,} allocated cells")
    print(f"10M cell limit:     10,000,000 cells")
    print(f"Currently at:       {total_before/10_000_000*100:.1f}% of limit\n")

    # Show what we'll do
    unknown = []
    for title in SHRINK_TABS + DELETE_TABS:
        if title not in tab_info:
            unknown.append(title)

    if unknown:
        print(f"NOTE: These tabs not found in Main sheet (may already be gone): {unknown}")

    print("\nPlan:")
    cells_to_free = 0
    for title in SHRINK_TABS:
        if title in tab_info:
            info = tab_info[title]
            freed = info['cells'] - 50
            cells_to_free += freed
            print(f"  SHRINK '{title}': {info['rows']:,} rows x {info['cols']} cols = {info['cells']:,} cells -> 50 cells (free {freed:,})")
    for title in DELETE_TABS:
        if title in tab_info:
            info = tab_info[title]
            cells_to_free += info['cells']
            print(f"  DELETE '{title}': {info['rows']:,} rows x {info['cols']} cols = {info['cells']:,} cells (free {info['cells']:,})")
    for title in PRESERVE_TABS:
        if title in tab_info:
            info = tab_info[title]
            print(f"  KEEP   '{title}': {info['rows']:,} rows x {info['cols']} cols = {info['cells']:,} cells (still used by app)")

    print(f"\nEstimated cells freed: {cells_to_free:,}")
    print(f"Estimated cells after: {total_before - cells_to_free:,}")
    print(f"Estimated % of limit:  {(total_before - cells_to_free)/10_000_000*100:.1f}%")

    confirm = input("\nProceed? (yes/no): ").strip().lower()
    if confirm != 'yes':
        print("Aborted.")
        return

    print("\nRunning cleanup...")
    import time

    # Delete tabs first
    for title in DELETE_TABS:
        if title in tab_info:
            try:
                delete_tab(service, tab_info[title]['sheet_id'], title)
                time.sleep(1)
            except Exception as e:
                print(f"  ERROR deleting '{title}': {e}")

    # Shrink tabs
    for title in SHRINK_TABS:
        if title in tab_info:
            try:
                shrink_tab(service, tab_info[title]['sheet_id'], title)
                time.sleep(0.5)
            except Exception as e:
                print(f"  ERROR shrinking '{title}': {e}")

    # Final count
    meta2 = service.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
    total_after = sum(
        s['properties']['gridProperties']['rowCount'] * s['properties']['gridProperties']['columnCount']
        for s in meta2['sheets']
    )

    print(f"\n{'='*60}")
    print(f"Done!")
    print(f"  Before: {total_before:,} cells ({total_before/10_000_000*100:.1f}% of limit)")
    print(f"  After:  {total_after:,} cells ({total_after/10_000_000*100:.1f}% of limit)")
    print(f"  Freed:  {total_before - total_after:,} cells")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
