"""Builds Lighting_Sales_Tracker.xlsx - an automated sales tracker for the
Lighting Solutions department (Infrastructure and Building verticals).

Run:  python3 build_tracker.py
"""
from datetime import date

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, PieChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.comments import Comment
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation

OUT = "Lighting_Sales_Tracker.xlsx"
FIRST, LAST = 5, 2004  # data rows in Sales_Log (2,000 entries)

FONT = "Arial"
NAVY, INFRA_C, BLD_C = "1F3864", "2E75B6", "C55A11"
f_base = Font(name=FONT, size=10)
f_bold = Font(name=FONT, size=10, bold=True)
f_head = Font(name=FONT, size=10, bold=True, color="FFFFFF")
f_title = Font(name=FONT, size=16, bold=True, color=NAVY)
f_sub = Font(name=FONT, size=9, italic=True, color="595959")
f_input = Font(name=FONT, size=10, color="0000FF")
f_link = Font(name=FONT, size=10, color="008000")
fill_head = PatternFill("solid", fgColor=NAVY)
fill_infra = PatternFill("solid", fgColor=INFRA_C)
fill_bld = PatternFill("solid", fgColor=BLD_C)
fill_input = PatternFill("solid", fgColor="FFF2CC")
fill_calc = PatternFill("solid", fgColor="F2F2F2")
fill_total = PatternFill("solid", fgColor="D9E1F2")
fill_kpi = PatternFill("solid", fgColor="EAF1FB")
thin = Side(style="thin", color="BFBFBF")
box = Border(left=thin, right=thin, top=thin, bottom=thin)
center = Alignment(horizontal="center", vertical="center", wrap_text=True)

NUM = '#,##0;(#,##0);"-"'
PCT = '0.0%;(0.0%);"-"'
DATE_FMT = "dd-mmm-yyyy"

wb = Workbook()


def style_range(ws, ref, font=None, fill=None, fmt=None, border=True, align=None):
    for row in ws[ref]:
        for c in row:
            if font: c.font = font
            if fill: c.fill = fill
            if fmt: c.number_format = fmt
            if border: c.border = box
            if align: c.alignment = align


def header(ws, row, col, labels, fill=fill_head):
    for i, text in enumerate(labels):
        c = ws.cell(row=row, column=col + i, value=text)
        c.font, c.fill, c.alignment, c.border = f_head, fill, center, box


def widths(ws, mapping):
    for col, w in mapping.items():
        ws.column_dimensions[col].width = w


def add_name(name, ref):
    wb.defined_names[name] = DefinedName(name, attr_text=ref)


# --------------------------------------------------------------------------
# 1. Instructions
# --------------------------------------------------------------------------
ws = wb.active
ws.title = "Instructions"
ws.sheet_view.showGridLines = False
ws["B2"] = "Lighting Solutions - Sales Tracker"
ws["B2"].font = f_title
ws["B3"] = "Automated tracking for the Infrastructure and Building verticals"
ws["B3"].font = f_sub
lines = [
    ("HOW IT WORKS", None),
    ("1. Settings", "Set your currency label, fiscal-year start month, product categories, sales reps and status rules. Edit only the yellow cells."),
    ("2. Targets", "Enter monthly sales targets for each vertical (yellow cells) for every financial year."),
    ("3. Sales_Log", "Add one row per invoice / order line. Fill the yellow columns only; grey columns calculate automatically. Use the drop-downs for Vertical, Category, Sales Rep and Status."),
    ("4. Dashboard", "Pick the Financial Year in cell C4. All KPIs, tables and charts update automatically."),
    ("", None),
    ("COLOUR LEGEND", None),
    ("Yellow cell / blue text", "Input - type here"),
    ("Grey cell / black text", "Formula - do not overwrite"),
    ("Green text", "Value pulled from another sheet"),
    ("", None),
    ("RULES", None),
    ("Sales counted", "Only rows whose Status is flagged 'Yes' under 'Counts as Sale?' in Settings (default: Invoiced, Paid) are counted as sales."),
    ("Pipeline", "Rows flagged 'Yes' under 'Counts as Pipeline?' (default: Quotation, Order Confirmed) show as open pipeline."),
    ("Net Sales", "Qty x Unit Price x (1 - Discount %). Amounts exclude tax - enter prices without VAT/tax."),
    ("Gross margin", "Enter Unit Cost on every row. Rows without a cost add to sales but not to gross profit, which understates the margin %."),
    ("Financial Year", "Named by the calendar year in which it ends. With a start month of 1 (January), FY2026 = Jan-Dec 2026. With 4 (April), FY2027 = Apr 2026 - Mar 2027."),
    ("Capacity", f"Sales_Log holds {LAST - FIRST + 1:,} rows with formulas ready. Row 5 is an EXAMPLE - overwrite or delete its contents before real use."),
]
r = 5
for label, text in lines:
    ws.cell(row=r, column=2, value=label).font = f_bold if text is None else f_bold
    if text is None and label:
        ws.cell(row=r, column=2).font = Font(name=FONT, size=11, bold=True, color=NAVY)
    if text:
        c = ws.cell(row=r, column=3, value=text)
        c.font, c.alignment = f_base, Alignment(wrap_text=True, vertical="top")
        ws.cell(row=r, column=2).alignment = Alignment(vertical="top")
    r += 1
ws["B12"].fill = fill_input; ws["B12"].font = Font(name=FONT, size=10, bold=True, color="0000FF")
ws["B13"].fill = fill_calc
ws["B14"].font = Font(name=FONT, size=10, bold=True, color="008000")
widths(ws, {"A": 3, "B": 26, "C": 100})

# --------------------------------------------------------------------------
# 2. Settings
# --------------------------------------------------------------------------
st = wb.create_sheet("Settings")
st.sheet_view.showGridLines = False
st["B2"] = "Settings & Lists"
st["B2"].font = f_title
st["B3"] = "Edit the yellow cells. Lists feed the drop-downs in Sales_Log and the Dashboard tables."
st["B3"].font = f_sub

general = [
    ("Currency label", "USD", "Shown on the Dashboard. Change to your currency (e.g. LKR, AED, INR)."),
    ("Fiscal year start month (1-12)", 1, "1 = January. Use 4 for an April-March financial year."),
    ("Department", "Lighting Solutions", "Shown in the Dashboard title."),
]
for i, (lab, val, note) in enumerate(general):
    row = 5 + i
    st.cell(row=row, column=2, value=lab).font = f_bold
    c = st.cell(row=row, column=3, value=val)
    c.font, c.fill, c.border = f_input, fill_input, box
    st.cell(row=row, column=4, value=note).font = f_sub
add_name("Currency", "Settings!$C$5")
add_name("FYStart", "Settings!$C$6")
dv_month = DataValidation(type="whole", operator="between", formula1="1", formula2="12",
                          showErrorMessage=True, error="Enter a month number 1-12")
st.add_data_validation(dv_month)
dv_month.add("C6")

LIST_ROW, LIST_N = 11, 15  # lists occupy rows 11-25
verticals = ["Infrastructure", "Building"]
categories = [
    "Street Lighting", "Floodlighting", "High Mast", "Tunnel Lighting", "Solar Lighting",
    "Indoor Commercial", "Industrial / High Bay", "Architectural / Facade",
    "Emergency & Exit", "Lighting Controls", "Installation & Services",
]
reps = ["Sales Rep 1", "Sales Rep 2", "Sales Rep 3", "Sales Rep 4", "Sales Rep 5"]
statuses = [("Quotation", "No", "Yes"), ("Order Confirmed", "No", "Yes"),
            ("Invoiced", "Yes", "No"), ("Paid", "Yes", "No"), ("Lost", "No", "No")]

header(st, LIST_ROW - 1, 2, ["Business Verticals"])
header(st, LIST_ROW - 1, 4, ["Product Categories"])
header(st, LIST_ROW - 1, 6, ["Sales Reps"])
header(st, LIST_ROW - 1, 8, ["Status", "Counts as Sale?", "Counts as Pipeline?"])
for i in range(LIST_N):
    row = LIST_ROW + i
    for col, lst in ((4, categories), (6, reps)):
        c = st.cell(row=row, column=col, value=lst[i] if i < len(lst) else None)
        c.font, c.fill, c.border = f_input, fill_input, box
for i, v in enumerate(verticals):
    c = st.cell(row=LIST_ROW + i, column=2, value=v)
    c.font, c.border = f_bold, box
for i, (s, sale, pipe) in enumerate(statuses):
    for j, v in enumerate((s, sale, pipe)):
        c = st.cell(row=LIST_ROW + i, column=8 + j, value=v)
        c.font = f_bold if j == 0 else f_input
        c.border = box
        if j: c.fill, c.alignment = fill_input, center
st.cell(row=LIST_ROW + 2, column=2,
        value="Verticals are fixed - the Dashboard is built around these two.").font = f_sub
st.cell(row=LIST_ROW + 16, column=4,
        value="Up to 15 categories / reps. Add new ones in the next empty yellow cell.").font = f_sub
dv_yn = DataValidation(type="list", formula1='"Yes,No"', allow_blank=False)
st.add_data_validation(dv_yn)
dv_yn.add(f"I{LIST_ROW}:J{LIST_ROW + 4}")

L0, L1 = LIST_ROW, LIST_ROW + LIST_N - 1
add_name("VerticalList", f"Settings!$B${L0}:$B${L0 + 1}")
add_name("CategoryList", f"OFFSET(Settings!$D${L0},0,0,MAX(1,COUNTA(Settings!$D${L0}:$D${L1})),1)")
add_name("RepList", f"OFFSET(Settings!$F${L0},0,0,MAX(1,COUNTA(Settings!$F${L0}:$F${L1})),1)")
add_name("StatusList", f"Settings!$H${L0}:$H${L0 + 4}")
widths(st, {"A": 3, "B": 30, "C": 20, "D": 26, "E": 3, "F": 22, "G": 3, "H": 20, "I": 16, "J": 18})

# --------------------------------------------------------------------------
# 3. Sales_Log
# --------------------------------------------------------------------------
sl = wb.create_sheet("Sales_Log")
sl["A1"] = "Sales Log"
sl["A1"].font = f_title
sl["A2"] = ("Enter one row per invoice / order line. Yellow = input, grey = automatic. "
            "Row 5 is an EXAMPLE - overwrite it with your first real entry.")
sl["A2"].font = f_sub
cols = [
    # (header, width, kind)  kind: in = input, calc = formula
    ("Date", 12, "in"), ("Invoice / Ref No", 15, "in"), ("Customer", 26, "in"),
    ("Project / Site", 26, "in"), ("Vertical", 15, "in"), ("Product Category", 22, "in"),
    ("Description", 28, "in"), ("Qty", 8, "in"), ("Unit Price", 12, "in"),
    ("Discount %", 10, "in"), ("Net Sales", 14, "calc"), ("Unit Cost", 12, "in"),
    ("Total Cost", 14, "calc"), ("Gross Profit", 14, "calc"), ("GM %", 8, "calc"),
    ("Sales Rep", 16, "in"), ("Status", 16, "in"), ("Notes", 24, "in"),
    ("FY", 7, "calc"), ("FY Period", 8, "calc"), ("Month", 8, "calc"),
    ("Sale?", 7, "calc"), ("Pipeline?", 9, "calc"),
]
for i, (h, w, kind) in enumerate(cols, start=1):
    c = sl.cell(row=4, column=i, value=h)
    c.font, c.alignment, c.border = f_head, center, box
    c.fill = fill_head if kind == "in" else PatternFill("solid", fgColor="595959")
    sl.column_dimensions[get_column_letter(i)].width = w
sl.row_dimensions[4].height = 30

S = f"Settings!$H${L0}:$H${L0 + 4}"
for r in range(FIRST, LAST + 1):
    f = {
        "K": f'=IF(OR(H{r}="",I{r}=""),"",H{r}*I{r}*(1-N(J{r})))',
        "M": f'=IF(OR(H{r}="",L{r}=""),"",H{r}*L{r})',
        "N": f'=IF(OR(K{r}="",M{r}=""),"",K{r}-M{r})',
        "O": f'=IF(OR(N{r}="",K{r}=""),"",IF(K{r}=0,"",N{r}/K{r}))',
        "S": f'=IF(A{r}="","",YEAR(A{r})+IF(AND(FYStart>1,MONTH(A{r})>=FYStart),1,0))',
        "T": f'=IF(A{r}="","",MOD(MONTH(A{r})-FYStart,12)+1)',
        "U": f'=IF(A{r}="","",TEXT(A{r},"mmm"))',
        "V": f'=IF(Q{r}="","",IFERROR(INDEX(Settings!$I${L0}:$I${L0 + 4},MATCH(Q{r},{S},0)),"No"))',
        "W": f'=IF(Q{r}="","",IFERROR(INDEX(Settings!$J${L0}:$J${L0 + 4},MATCH(Q{r},{S},0)),"No"))',
    }
    for col, formula in f.items():
        sl[f"{col}{r}"] = formula

# formats per column (applied to the whole data block)
fmt_cols = {"A": DATE_FMT, "H": "#,##0", "I": NUM, "J": PCT, "K": NUM, "L": NUM,
            "M": NUM, "N": NUM, "O": PCT, "S": "0", "T": "0"}
for i, (_, _, kind) in enumerate(cols, start=1):
    L = get_column_letter(i)
    for r in range(FIRST, LAST + 1):
        c = sl[f"{L}{r}"]
        c.border = box
        if kind == "in":
            c.font, c.fill = f_input, fill_input
        else:
            c.font, c.fill = f_base, fill_calc
        if L in fmt_cols:
            c.number_format = fmt_cols[L]

# example row
example = {"A": date(2026, 9, 15), "B": "INV-0001", "C": "Example Contractors Ltd",
           "D": "Highway Stretch A", "E": "Infrastructure", "F": "Street Lighting",
           "G": "150W LED street light", "H": 120, "I": 185, "J": 0.05, "L": 120,
           "P": "Sales Rep 1", "Q": "Invoiced", "R": "EXAMPLE - replace with real data"}
for col, v in example.items():
    sl[f"{col}{FIRST}"] = v

rng = lambda col: f"{col}{FIRST}:{col}{LAST}"
dvs = [
    (DataValidation(type="list", formula1="=VerticalList", allow_blank=True,
                    showErrorMessage=True, error="Choose Infrastructure or Building"), "E"),
    (DataValidation(type="list", formula1="=CategoryList", allow_blank=True,
                    showErrorMessage=True, error="Choose a category from Settings"), "F"),
    (DataValidation(type="list", formula1="=RepList", allow_blank=True,
                    showErrorMessage=True, error="Choose a sales rep from Settings"), "P"),
    (DataValidation(type="list", formula1="=StatusList", allow_blank=True,
                    showErrorMessage=True, error="Choose a status from Settings"), "Q"),
    (DataValidation(type="date", operator="between", formula1="DATE(2020,1,1)",
                    formula2="DATE(2040,12,31)", allow_blank=True,
                    showErrorMessage=True, error="Enter a valid date"), "A"),
    (DataValidation(type="decimal", operator="between", formula1="0", formula2="1",
                    allow_blank=True, showErrorMessage=True,
                    error="Enter a discount between 0% and 100%"), "J"),
    (DataValidation(type="decimal", operator="greaterThanOrEqual", formula1="0",
                    allow_blank=True, showErrorMessage=True, error="Must be 0 or more"), "H"),
]
for dv, col in dvs:
    sl.add_data_validation(dv)
    dv.add(rng(col))

status_colors = {"Quotation": "FFF2CC", "Order Confirmed": "DDEBF7", "Invoiced": "E2EFDA",
                 "Paid": "A9D08E", "Lost": "F8CBAD"}
for s, color in status_colors.items():
    sl.conditional_formatting.add(rng("Q"), CellIsRule(
        operator="equal", formula=[f'"{s}"'], fill=PatternFill("solid", fgColor=color)))
sl.conditional_formatting.add(rng("O"), FormulaRule(
    formula=[f'AND(ISNUMBER(O{FIRST}),O{FIRST}<0)'], font=Font(color="C00000", bold=True)))

sl["K3"] = f'=SUBTOTAL(9,K{FIRST}:K{LAST})'
sl["N3"] = f'=SUBTOTAL(9,N{FIRST}:N{LAST})'
sl["J3"] = "Filtered total:"
for ref in ("K3", "N3"):
    sl[ref].font, sl[ref].number_format, sl[ref].fill, sl[ref].border = f_bold, NUM, fill_total, box
sl["J3"].font = f_bold
sl["J3"].alignment = Alignment(horizontal="right")
sl.freeze_panes = "B5"
sl.auto_filter.ref = f"A4:W{LAST}"
sl["K4"].comment = Comment("Qty x Unit Price x (1 - Discount %). Excludes tax.", "Tracker")
sl["S4"].comment = Comment("Financial year - named by the calendar year it ends in. "
                           "Start month is set in Settings!C6.", "Tracker")
sl["V4"].comment = Comment("Yes = counted as a sale (per Status rules in Settings).", "Tracker")

# --------------------------------------------------------------------------
# 4. Targets
# --------------------------------------------------------------------------
tg = wb.create_sheet("Targets")
tg.sheet_view.showGridLines = False
tg["B2"] = "Monthly Sales Targets"
tg["B2"].font = f_title
tg["B3"] = "Enter targets per vertical in the yellow cells (amounts in your Settings currency, excluding tax)."
tg["B3"].font = f_sub
header(tg, 5, 2, ["FY", "Period", "Month", "Infrastructure Target", "Building Target", "Total Target"])
tg["E5"].fill = fill_infra
tg["F5"].fill = fill_bld
TG_FIRST = 6
years = [2026, 2027, 2028]
r = TG_FIRST
for y in years:
    for p in range(1, 13):
        tg[f"B{r}"] = y
        tg[f"C{r}"] = p
        tg[f"D{r}"] = f'=TEXT(DATE(2000,FYStart+C{r}-1,1),"mmm")'
        tg[f"G{r}"] = f"=N(E{r})+N(F{r})"
        for col in "BCD":
            tg[f"{col}{r}"].font, tg[f"{col}{r}"].fill = f_base, fill_calc
        for col in "EF":
            tg[f"{col}{r}"].font, tg[f"{col}{r}"].fill = f_input, fill_input
        tg[f"G{r}"].font, tg[f"G{r}"].fill = f_base, fill_calc
        for col in "BCDEFG":
            tg[f"{col}{r}"].border = box
            tg[f"{col}{r}"].alignment = Alignment(horizontal="center") if col in "BCD" else Alignment()
        for col in "EFG":
            tg[f"{col}{r}"].number_format = NUM
        r += 1
    # annual subtotal
    tg[f"B{r}"] = y
    tg[f"C{r}"] = "Total"
    for col in "EFG":
        tg[f"{col}{r}"] = f"=SUM({col}{r - 12}:{col}{r - 1})"
    style_range(tg, f"B{r}:G{r}", font=f_bold, fill=fill_total, fmt=NUM)
    r += 2
TG_LAST = r - 1
tg["I5"] = "To add another year: copy a 13-row block, paste below, and change the FY number."
tg["I5"].font = f_sub
widths(tg, {"A": 3, "B": 8, "C": 8, "D": 8, "E": 20, "F": 20, "G": 18})
tg.freeze_panes = "B6"

# --------------------------------------------------------------------------
# 5. Dashboard
# --------------------------------------------------------------------------
db = wb.create_sheet("Dashboard", 1)
db.sheet_view.showGridLines = False
db["B2"] = '=Settings!$C$7&" - Sales Dashboard (FY"&$C$4&", amounts in "&Currency&")"'
db["B2"].font = f_title
db["B4"] = "Financial Year"
db["B4"].font = f_bold
db["C4"] = 2026
db["C4"].font = Font(name=FONT, size=12, bold=True, color="0000FF")
db["C4"].fill, db["C4"].border, db["C4"].alignment = fill_input, box, center
db["D4"] = "<- choose the year; everything below updates"
db["D4"].font = f_sub
dv_fy = DataValidation(type="list", formula1='"2024,2025,2026,2027,2028,2029,2030"')
db.add_data_validation(dv_fy)
dv_fy.add("C4")

LOG = lambda col: f"Sales_Log!${col}${FIRST}:${col}${LAST}"
FY_C = f'{LOG("S")},$C$4'
SALE = f'{LOG("V")},"Yes"'
PIPE = f'{LOG("W")},"Yes"'
TGT = lambda col: f"Targets!${col}${TG_FIRST}:${col}${TG_LAST}"

# KPI tiles (row 6 labels, row 7 values)
kpis = [
    ("Total Sales", f"=SUMIFS({LOG('K')},{FY_C},{SALE})", NUM),
    ("Infrastructure", f'=SUMIFS({LOG("K")},{FY_C},{SALE},{LOG("E")},"Infrastructure")', NUM),
    ("Building", f'=SUMIFS({LOG("K")},{FY_C},{SALE},{LOG("E")},"Building")', NUM),
    ("Annual Target", f"=SUMIFS({TGT('G')},{TGT('B')},$C$4,{TGT('C')},\">0\")", NUM),
    ("Achievement", "=IF(E7=0,\"\",B7/E7)", PCT),
    ("Gross Profit", f"=SUMIFS({LOG('N')},{FY_C},{SALE})", NUM),
    ("Gross Margin", "=IF(B7=0,\"\",G7/B7)", PCT),
    ("Open Pipeline", f"=SUMIFS({LOG('K')},{FY_C},{PIPE})", NUM),
]
for i, (lab, formula, fmt) in enumerate(kpis):
    col = 2 + i
    c = db.cell(row=6, column=col, value=lab)
    c.font, c.fill, c.alignment, c.border = f_head, fill_head, center, box
    if lab == "Infrastructure": c.fill = fill_infra
    if lab == "Building": c.fill = fill_bld
    v = db.cell(row=7, column=col, value=formula)
    v.font = Font(name=FONT, size=14, bold=True, color=NAVY)
    v.fill, v.alignment, v.border, v.number_format = fill_kpi, center, box, fmt
db.row_dimensions[7].height = 32

# Monthly performance table
MT = 10
db.cell(row=MT - 1, column=2, value="Monthly Performance").font = Font(name=FONT, size=12, bold=True, color=NAVY)
header(db, MT, 1, ["#", "Month", "Infra Sales", "Infra Target", "Infra Ach %",
                   "Building Sales", "Building Target", "Building Ach %",
                   "Total Sales", "Total Target", "Ach %", "Cumulative Sales", "Cumulative Target"])
for c in ("C", "D", "E"): db[f"{c}{MT}"].fill = fill_infra
for c in ("F", "G", "H"): db[f"{c}{MT}"].fill = fill_bld
db.row_dimensions[MT].height = 30
for p in range(1, 13):
    r = MT + p
    db[f"A{r}"] = p
    db[f"B{r}"] = f'=TEXT(DATE(2000,FYStart+A{r}-1,1),"mmm")'
    db[f"C{r}"] = f'=SUMIFS({LOG("K")},{FY_C},{SALE},{LOG("T")},$A{r},{LOG("E")},"Infrastructure")'
    db[f"D{r}"] = f"=SUMIFS({TGT('E')},{TGT('B')},$C$4,{TGT('C')},$A{r})"
    db[f"E{r}"] = f'=IF(D{r}=0,"",C{r}/D{r})'
    db[f"F{r}"] = f'=SUMIFS({LOG("K")},{FY_C},{SALE},{LOG("T")},$A{r},{LOG("E")},"Building")'
    db[f"G{r}"] = f"=SUMIFS({TGT('F')},{TGT('B')},$C$4,{TGT('C')},$A{r})"
    db[f"H{r}"] = f'=IF(G{r}=0,"",F{r}/G{r})'
    db[f"I{r}"] = f"=C{r}+F{r}"
    db[f"J{r}"] = f"=D{r}+G{r}"
    db[f"K{r}"] = f'=IF(J{r}=0,"",I{r}/J{r})'
    db[f"L{r}"] = f"=SUM($I${MT + 1}:I{r})"
    db[f"M{r}"] = f"=SUM($J${MT + 1}:J{r})"
    style_range(db, f"A{r}:M{r}", font=f_base, fmt=NUM)
    for c in ("E", "H", "K"): db[f"{c}{r}"].number_format = PCT
    db[f"A{r}"].font = Font(name=FONT, size=8, color="808080")
    db[f"A{r}"].number_format = "0"
    db[f"B{r}"].alignment = Alignment(horizontal="center")
MTOT = MT + 13
db[f"B{MTOT}"] = "Total"
for c in "CDFGIJ":
    db[f"{c}{MTOT}"] = f"=SUM({c}{MT + 1}:{c}{MT + 12})"
db[f"E{MTOT}"] = f'=IF(D{MTOT}=0,"",C{MTOT}/D{MTOT})'
db[f"H{MTOT}"] = f'=IF(G{MTOT}=0,"",F{MTOT}/G{MTOT})'
db[f"K{MTOT}"] = f'=IF(J{MTOT}=0,"",I{MTOT}/J{MTOT})'
style_range(db, f"A{MTOT}:M{MTOT}", font=f_bold, fill=fill_total, fmt=NUM)
for c in ("E", "H", "K"): db[f"{c}{MTOT}"].number_format = PCT

for ref in (f"E{MT + 1}:E{MTOT}", f"H{MT + 1}:H{MTOT}", f"K{MT + 1}:K{MTOT}", "F7"):
    db.conditional_formatting.add(ref, FormulaRule(
        formula=[f"AND(ISNUMBER({ref.split(':')[0]}),{ref.split(':')[0]}>=1)"],
        fill=PatternFill("solid", fgColor="C6EFCE"), font=Font(color="006100")))
    db.conditional_formatting.add(ref, FormulaRule(
        formula=[f"AND(ISNUMBER({ref.split(':')[0]}),{ref.split(':')[0]}>=0.8,{ref.split(':')[0]}<1)"],
        fill=PatternFill("solid", fgColor="FFEB9C"), font=Font(color="9C5700")))
    db.conditional_formatting.add(ref, FormulaRule(
        formula=[f"AND(ISNUMBER({ref.split(':')[0]}),{ref.split(':')[0]}<0.8)"],
        fill=PatternFill("solid", fgColor="FFC7CE"), font=Font(color="9C0006")))

# Sales by product category
CT = MTOT + 3
db.cell(row=CT - 1, column=2, value="Sales by Product Category").font = Font(name=FONT, size=12, bold=True, color=NAVY)
header(db, CT, 2, ["Product Category", "Infrastructure", "Building", "Total", "Share %",
                   "Gross Profit", "GM %"])
db[f"C{CT}"].fill, db[f"D{CT}"].fill = fill_infra, fill_bld
for i in range(LIST_N):
    r = CT + 1 + i
    src = f"Settings!$D${L0 + i}"
    db[f"B{r}"] = f'=IF({src}="","",{src})'
    db[f"B{r}"].font = f_link
    db[f"C{r}"] = f'=IF($B{r}="","",SUMIFS({LOG("K")},{FY_C},{SALE},{LOG("F")},$B{r},{LOG("E")},"Infrastructure"))'
    db[f"D{r}"] = f'=IF($B{r}="","",SUMIFS({LOG("K")},{FY_C},{SALE},{LOG("F")},$B{r},{LOG("E")},"Building"))'
    db[f"E{r}"] = f'=IF($B{r}="","",N(C{r})+N(D{r}))'
    db[f"F{r}"] = f'=IF(OR($B{r}="",$E${CT + 16}=0),"",E{r}/$E${CT + 16})'
    db[f"G{r}"] = f'=IF($B{r}="","",SUMIFS({LOG("N")},{FY_C},{SALE},{LOG("F")},$B{r}))'
    db[f"H{r}"] = f'=IF(OR($B{r}="",N(E{r})=0),"",G{r}/E{r})'
    style_range(db, f"C{r}:H{r}", font=f_base, fmt=NUM)
    db[f"B{r}"].border = box
    for c in "FH": db[f"{c}{r}"].number_format = PCT
CTOT = CT + 16
db[f"B{CTOT}"] = "Total"
for c in "CDEG":
    db[f"{c}{CTOT}"] = f"=SUM({c}{CT + 1}:{c}{CT + 15})"
db[f"F{CTOT}"] = f'=IF(E{CTOT}=0,"",1)'
db[f"H{CTOT}"] = f'=IF(E{CTOT}=0,"",G{CTOT}/E{CTOT})'
style_range(db, f"B{CTOT}:H{CTOT}", font=f_bold, fill=fill_total, fmt=NUM)
for c in "FH": db[f"{c}{CTOT}"].number_format = PCT
db.conditional_formatting.add(f"F{CT + 1}:F{CT + 15}", FormulaRule(
    formula=[f"ISNUMBER(F{CT + 1})"], fill=PatternFill("solid", fgColor="EAF1FB")))

# Pipeline by status (right of category table)
db.cell(row=CT - 1, column=10, value="Deals by Status").font = Font(name=FONT, size=12, bold=True, color=NAVY)
header(db, CT, 10, ["Status", "No. of Lines", "Infrastructure", "Building", "Total"])
db[f"L{CT}"].fill, db[f"M{CT}"].fill = fill_infra, fill_bld
for i in range(5):
    r = CT + 1 + i
    db[f"J{r}"] = f"=Settings!$H${L0 + i}"
    db[f"J{r}"].font = f_link
    db[f"K{r}"] = f'=COUNTIFS({FY_C},{LOG("Q")},$J{r})'
    db[f"L{r}"] = f'=SUMIFS({LOG("K")},{FY_C},{LOG("Q")},$J{r},{LOG("E")},"Infrastructure")'
    db[f"M{r}"] = f'=SUMIFS({LOG("K")},{FY_C},{LOG("Q")},$J{r},{LOG("E")},"Building")'
    db[f"N{r}"] = f"=L{r}+M{r}"
    style_range(db, f"K{r}:N{r}", font=f_base, fmt=NUM)
    db[f"J{r}"].border = box
r = CT + 6
db[f"J{r}"] = "Win rate (value)"
db[f"J{r}"].comment = Comment("Value counted as Sale / (Sale value + Lost value)", "Tracker")
db[f"N{r}"] = (f'=IF(($B$7+SUMIFS({LOG("K")},{FY_C},{LOG("Q")},"Lost"))=0,"",'
               f'$B$7/($B$7+SUMIFS({LOG("K")},{FY_C},{LOG("Q")},"Lost")))')
style_range(db, f"J{r}:N{r}", font=f_bold, fill=fill_total, fmt=PCT)

# Vertical share mini-table (feeds pie chart)
VS = CT + 9
db.cell(row=VS - 1, column=10, value="Vertical Share").font = Font(name=FONT, size=12, bold=True, color=NAVY)
header(db, VS, 10, ["Vertical", "Sales", "Share %", "Gross Profit", "GM %"])
for i, v in enumerate(verticals):
    r = VS + 1 + i
    db[f"J{r}"] = v
    db[f"K{r}"] = f"={'C' if i == 0 else 'D'}7"
    db[f"L{r}"] = f'=IF($B$7=0,"",K{r}/$B$7)'
    db[f"M{r}"] = f'=SUMIFS({LOG("N")},{FY_C},{SALE},{LOG("E")},J{r})'
    db[f"N{r}"] = f'=IF(K{r}=0,"",M{r}/K{r})'
    style_range(db, f"J{r}:N{r}", font=f_base, fmt=NUM)
    db[f"J{r}"].font = f_bold
    for c in "LN": db[f"{c}{r}"].number_format = PCT

# Sales rep performance
RT = CTOT + 3
db.cell(row=RT - 1, column=2, value="Sales Rep Performance").font = Font(name=FONT, size=12, bold=True, color=NAVY)
header(db, RT, 2, ["Sales Rep", "Infrastructure", "Building", "Total Sales", "Gross Profit",
                   "GM %", "Lines Won", "Open Pipeline"])
db[f"C{RT}"].fill, db[f"D{RT}"].fill = fill_infra, fill_bld
for i in range(LIST_N):
    r = RT + 1 + i
    src = f"Settings!$F${L0 + i}"
    db[f"B{r}"] = f'=IF({src}="","",{src})'
    db[f"B{r}"].font = f_link
    db[f"B{r}"].border = box
    g = lambda body: f'=IF($B{r}="","",{body})'
    db[f"C{r}"] = g(f'SUMIFS({LOG("K")},{FY_C},{SALE},{LOG("P")},$B{r},{LOG("E")},"Infrastructure")')
    db[f"D{r}"] = g(f'SUMIFS({LOG("K")},{FY_C},{SALE},{LOG("P")},$B{r},{LOG("E")},"Building")')
    db[f"E{r}"] = g(f"N(C{r})+N(D{r})")
    db[f"F{r}"] = g(f'SUMIFS({LOG("N")},{FY_C},{SALE},{LOG("P")},$B{r})')
    db[f"G{r}"] = f'=IF(OR($B{r}="",N(E{r})=0),"",F{r}/E{r})'
    db[f"H{r}"] = g(f'COUNTIFS({FY_C},{SALE},{LOG("P")},$B{r})')
    db[f"I{r}"] = g(f'SUMIFS({LOG("K")},{FY_C},{PIPE},{LOG("P")},$B{r})')
    style_range(db, f"C{r}:I{r}", font=f_base, fmt=NUM)
    db[f"G{r}"].number_format = PCT
RTOT = RT + 16
db[f"B{RTOT}"] = "Total"
for c in "CDEFHI":
    db[f"{c}{RTOT}"] = f"=SUM({c}{RT + 1}:{c}{RT + 15})"
db[f"G{RTOT}"] = f'=IF(E{RTOT}=0,"",F{RTOT}/E{RTOT})'
style_range(db, f"B{RTOT}:I{RTOT}", font=f_bold, fill=fill_total, fmt=NUM)
db[f"G{RTOT}"].number_format = PCT

widths(db, {"A": 4, "B": 22, "C": 15, "D": 15, "E": 14, "F": 15, "G": 15, "H": 14,
            "I": 15, "J": 16, "K": 15, "L": 15, "M": 15, "N": 14})
db.freeze_panes = "A5"

# Charts (placed to the right of the tables, column P onward)
def cats(r1, r2, col=2):
    return Reference(db, min_col=col, min_row=r1, max_row=r2)

ch = BarChart()
ch.type, ch.grouping, ch.overlap = "col", "clustered", -10
ch.title = "Monthly Sales by Vertical"
ch.y_axis.title = "Net Sales"
ch.y_axis.numFmt = "#,##0"
ch.add_data(Reference(db, min_col=3, min_row=MT, max_row=MT + 12), titles_from_data=True)
ch.add_data(Reference(db, min_col=6, min_row=MT, max_row=MT + 12), titles_from_data=True)
ch.set_categories(cats(MT + 1, MT + 12))
ch.series[0].graphicalProperties.solidFill = INFRA_C
ch.series[1].graphicalProperties.solidFill = BLD_C
ch.height, ch.width = 7.5, 16
ch.y_axis.delete = False
ch.x_axis.delete = False
db.add_chart(ch, "P4")

ln = LineChart()
ln.title = "Cumulative Sales vs Target"
ln.y_axis.numFmt = "#,##0"
ln.add_data(Reference(db, min_col=12, max_col=13, min_row=MT, max_row=MT + 12), titles_from_data=True)
ln.set_categories(cats(MT + 1, MT + 12))
ln.series[0].graphicalProperties.line.solidFill = NAVY
ln.series[0].graphicalProperties.line.width = 28000
ln.series[1].graphicalProperties.line.solidFill = "A6A6A6"
ln.series[1].graphicalProperties.line.dashStyle = "dash"
for sr in ln.series:
    sr.smooth = False
ln.height, ln.width = 7.5, 16
ln.y_axis.delete = False
ln.x_axis.delete = False
db.add_chart(ln, "P21")

pie = PieChart()
pie.title = "Sales Share by Vertical"
pie.add_data(Reference(db, min_col=11, min_row=VS, max_row=VS + 2), titles_from_data=True)
pie.set_categories(Reference(db, min_col=10, min_row=VS + 1, max_row=VS + 2))
pie.dataLabels = DataLabelList()
pie.dataLabels.showPercent = True
for attr in ("showVal", "showCatName", "showSerName", "showLegendKey", "showLeaderLines"):
    setattr(pie.dataLabels, attr, False)
from openpyxl.chart.series import DataPoint
for idx, color in enumerate((INFRA_C, BLD_C)):
    pt = DataPoint(idx=idx)
    pt.graphicalProperties.solidFill = color
    pie.series[0].dPt.append(pt)
pie.height, pie.width = 7.5, 16
db.add_chart(pie, "P38")

bc = BarChart()
bc.type, bc.grouping, bc.overlap = "bar", "stacked", 100
bc.title = "Sales by Product Category"
bc.x_axis.numFmt = "#,##0"
bc.add_data(Reference(db, min_col=3, max_col=4, min_row=CT, max_row=CT + len(categories)), titles_from_data=True)
bc.set_categories(cats(CT + 1, CT + len(categories)))
bc.series[0].graphicalProperties.solidFill = INFRA_C
bc.series[1].graphicalProperties.solidFill = BLD_C
bc.x_axis.scaling.orientation = "maxMin"
bc.height, bc.width = 12, 16
bc.x_axis.tickLblSkip = 1
bc.y_axis.delete = False
bc.x_axis.delete = False
db.add_chart(bc, "P55")

db.sheet_properties.tabColor = NAVY
sl.sheet_properties.tabColor = "FFC000"
tg.sheet_properties.tabColor = "FFC000"
st.sheet_properties.tabColor = "808080"
wb.active = 1
wb.save(OUT)
print("saved", OUT)
