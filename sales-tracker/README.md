# Lighting Solutions – Sales Tracker (Excel)

`Lighting_Sales_Tracker.xlsx` is an automated sales tracker for the Lighting Solutions
department, covering its two business verticals: **Infrastructure** and **Building**.

| Sheet | What it does |
|---|---|
| Instructions | How to use the workbook and the colour legend |
| Dashboard | Pick a financial year: KPIs, monthly sales vs target, category, sales rep, status/pipeline, 4 charts |
| Sales_Log | One row per invoice / order line (2,000 rows ready). Yellow = input, grey = auto |
| Targets | Monthly targets per vertical for FY2026–FY2028 |
| Settings | Currency, fiscal-year start month, product categories, sales reps, status rules |

To regenerate the workbook from scratch: `python3 build_tracker.py` (needs `openpyxl`).
