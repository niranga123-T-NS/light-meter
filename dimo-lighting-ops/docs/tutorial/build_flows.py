import os; exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'flows.py')).read())

# ---------- 1. Inquiry flow
L=['Sales','SM Projects','Design Manager','Designer / Engineer','SM Estimation','Estimator','GM / DGM']
s=Swim(L,11,lane_h=80,fs=8.2)
s.node('raise','Sales',0,'Raise inquiry: pick Route A / B / C, attach files, Submit')
s.node('mode','SM Projects',1,'Confirm release mode (+ debtor check)','appr')
s.node('dmacc','Design Manager',1,'Route A / C: Accept, Return or Reject (4 wh)','appr')
s.node('seacc','SM Estimation',1,'Route B: Accept, Return, Reject or Send to Design','appr')
s.node('assign','Design Manager',2,'Assign designer: task, size, due date')
s.node('work','Designer / Engineer',3,'Confirm date → work, log, upload, brands → Submit')
s.node('rev','Design Manager',4,'Review (1 wd): Approve or Return','appr')
s.node('rel','Design Manager',5,'Release design (mode confirmed)')
s.node('seaccA','SM Estimation',6,'Accept job → Assign estimator')
s.node('price','Estimator',7,'Confirm date → price, suppliers → Submit')
s.node('qapp','SM Estimation',8,'Approve quotation (1 wd) or Return','appr')
s.node('gm','GM / DGM',8,'Final approval: high value or low margin','appr')
s.node('relq','Estimator',9,'Release to sales with quotation no. & files')
s.node('client','Sales',10,'Submit to client → response → Won / Lost','end')
def mid(k): x,y,w,h=s.nodes[k]; return y+h/2-4
s.edge('raise','mode'); s.edge('raise','dmacc'); s.edge('raise','seacc')
s.edge('dmacc','assign'); s.edge('assign','work'); s.edge('work','rev')
s.edge('rev','work','Returned',dashed=True,red=True,mode='back')
s.edge('rev','rel')
s.edge('rel','seaccA','Route A',lx=s.nodes['seaccA'][0]-12,ly=mid('rel')+60)
s.edge('rel','client','Route C (design only)',lx=860,ly=mid('rel'))
s.edge('seacc','seaccA','Route B – straight to estimation',lx=520,ly=mid('seacc'))
s.edge('seacc','dmacc','Send to Design',dashed=True,red=True,mode='early')
s.edge('seaccA','price'); s.edge('price','qapp')
s.edge('qapp','price','Returned',dashed=True,red=True,mode='back')
s.edge('qapp','relq','OK',lx=s.nodes['qapp'][0]+s.nodes['qapp'][2]+6,ly=mid('qapp')); s.edge('qapp','gm','above limit')
s.edge('gm','relq'); s.edge('relq','client')
inquiry_svg=s.svg()

# ---------- 2. Approvals chains
chains=[
 ('Weekly plan',[('Sales','Submit plan (Sat 13:00)'),('SM Projects','Approve / Return (Mon 09:00)')],'Plan approved'),
 ('Visit to another sales person\'s customer',[('System','Detected on plan / visit'),('SM Projects','Joint visit, reassign account or reject')],'Decision logged'),
 ('Release mode (every inquiry)',[('Sales','Proposes mode 1 / 2 / 3'),('SM Projects','Confirm or return')],'Design can be released'),
 ('Debtor check',[('System','Customer has overdue debt'),('SM Projects','Proceed or keep on hold')],'Inquiry continues'),
 ('Mixed duty offer',[('Sales','Duty-free + duty-paid'),('SM Projects','Step 1'),('GM / DGM','Final approval')],'Offer allowed'),
 ('Duty status / release mode change',[('Sales','Request change + reason'),('SM Projects','Approve or return')],'Inquiry updated'),
 ('Client expectation change',[('Sales','Request change + reason'),('Design Manager','Step 1 (Route A / C)'),('SM Estimation','Final approval')],'Scope updated'),
 ('Early design release (mode 3)',[('Sales','Request + reason'),('Design Manager','Step 1'),('SM Projects','Final approval')],'Design to sales early'),
 ('Design review',[('Designer / Engineer','Submit for review'),('Design Manager','Approve or return (1 wd)')],'Design approved'),
 ('Due date change',[('Designer / Engineer','Request another date'),('Design Manager','Accept new date')],'New due version'),
 ('Estimation due date / hold',[('Estimator','Request date or hold'),('SM Estimation','Approve (4 wh)')],'Clock updated'),
 ('Quotation',[('Estimator','Submit for approval'),('SM Estimation','Approve or return (1 wd)'),('GM / DGM','If > value limit or < margin floor')],'Release to sales'),
 ('Sample request',[('Sales','Request sample'),('Operations','Availability (1 wd)'),('SM Projects','Approve / return / reject')],'Dispatch'),
 ('Sample new return date',[('Sales','Request new date'),('SM Projects','Approve or reject')],'Return date moved'),
 ('KPI targets',[('SM Projects','Set monthly targets'),('GM / DGM','Approve')],'Targets active'),
]
rowh=34; W=1100; bw=205; gap=34; x0=250
svg=''
for i,(name,steps,res) in enumerate(chains):
    y=i*rowh
    if i%2==0: svg+=f'<rect x="0" y="{y}" width="{W}" height="{rowh}" fill="#f8f9fb"/>'
    svg+=f'<text x="8" y="{y+rowh/2+4}" font-size="10.5" font-weight="700" fill="#111827">{esc(name)}</text>'
    x=x0
    for j,(role,t) in enumerate(steps):
        fill,stroke=ROLE[role]
        svg+=f'<rect x="{x}" y="{y+4}" width="{bw}" height="{rowh-8}" rx="5" fill="{fill}" stroke="{stroke}" stroke-width="1.3"/>'
        svg+=f'<text x="{x+8}" y="{y+15}" font-size="8" font-weight="700" fill="{stroke}">{esc(role.upper())}</text>'
        svg+=f'<text x="{x+8}" y="{y+26}" font-size="9" fill="#111827">{esc(t)}</text>'
        if j>0: svg+=f'<circle cx="{x+bw-6}" cy="{y+10}" r="5.5" fill="#C8102E"/><text x="{x+bw-6}" y="{y+13}" font-size="7.5" text-anchor="middle" fill="#fff" font-weight="700">✓</text>'
        x2=x+bw
        x+=bw+gap
        svg+=f'<path d="M{x2+3},{y+rowh/2} L{x-3},{y+rowh/2}" stroke="#374151" stroke-width="1.3" marker-end="url(#ar)"/>'
    svg+=f'<rect x="{x}" y="{y+6}" width="{W-x-4}" height="{rowh-12}" rx="{(rowh-12)/2}" fill="#111827"/>'
    svg+=textblock(x,y+6,W-x-4,rowh-12,res,9,'#fff')
approvals_svg=f'<svg viewBox="0 0 {W} {len(chains)*rowh}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Liberation Sans, Arial, sans-serif">{ARROWDEF}{svg}</svg>'

# ---------- 3. Plans, visits, projects
s=Swim(['System','Sales','SM Projects','GM / DGM'],8,lane_h=100)
s.node('rem','System',0,'Reminders Fri 16:00 and Sat 10:00')
s.node('plan','Sales',1,'Build next week\'s plan: + Add visit per slot')
s.node('sub','Sales',2,'Submit plan for approval (by Sat 13:00)')
s.node('app','SM Projects',3,'Approve / Approve with comments / Return (Mon 09:00)','appr')
s.node('vis','Sales',4,'Check in at site (GPS) → visit report by 20:00 → Check out')
s.node('inq','Sales',5,'Create project if new · Convert to inquiry when design / quote needed')
s.node('rev','SM Projects',5,'Review visits: Mark reviewed / coaching comment · GPS review')
s.node('rate','SM Projects',6,'Plan vs actual → Rate the week · Scorecards & targets')
s.node('tg','GM / DGM',7,'Approve KPI targets · Overall dashboard','appr')
s.node('late','System',3,'Late plan → alert SM Projects')
s.edge('rem','plan'); s.edge('plan','sub'); s.edge('sub','app')
s.edge('app','sub','Returned – fix same day',dashed=True,red=True,mode='back')
s.edge('app','vis'); s.edge('vis','inq'); s.edge('vis','rev'); s.edge('rev','rate'); s.edge('rate','tg')
s.edge('sub','late',dashed=True)
plans_svg=s.svg()

# ---------- 4. Debtors
s=Swim(['Operations','System','Sales','SM Projects','GM / DGM'],6,lane_h=66)
s.node('up','Operations',0,'Saturday: upload debtors Excel → map → Confirm upload')
s.node('age','System',1,'Ageing buckets; alerts at 60 / 120 / 180 days')
s.node('fu','Sales',2,'My Debtors: follow-up comments, promised date, collected')
s.node('mm','Operations',3,'Collection mismatch check in next upload')
s.node('legal','Operations',4,'If unrecoverable: Place under Legal (case, next hearing)')
s.node('hear','System',5,'Hearing alert 2 days before (critical)')
s.node('smp','SM Projects',2,'Debtor check on new inquiries: proceed / hold','appr')
s.node('gmv','GM / DGM',5,'Receives legal hearing alerts · Debtors ageing report')
s.edge('up','age'); s.edge('age','fu'); s.edge('age','smp'); s.edge('fu','mm'); s.edge('mm','legal'); s.edge('legal','hear'); s.edge('hear','gmv')
debtors_svg=s.svg()

# ---------- 5. Samples
s=Swim(['Sales','Operations','SM Projects'],6,lane_h=70)
s.node('req','Sales',0,'+ Request sample: items, purpose, required-by date → Submit')
s.node('av','Operations',1,'Record availability (1 wd)')
s.node('ap','SM Projects',2,'Approve / Return with comment / Reject','appr')
s.node('ho','Operations',3,'Dispatch → delivery note / photo → Record handover')
s.node('nd','Sales',4,'Need longer? Request new return date')
s.node('nda','SM Projects',4,'Approve new return date','appr')
s.node('ret','Operations',5,'Record return: Good / Damaged / Incomplete','end')
s.edge('req','av'); s.edge('av','ap'); s.edge('ap','ho'); s.edge('ho','nd'); s.edge('nd','nda'); s.edge('ho','ret','on time',lx=880,ly=s.nodes['ho'][1]+s.nodes['ho'][3]/2-4); s.edge('nda','ret')
samples_svg=s.svg()

# ---------- 6. Escalation ladder
steps=[('75% of time used','Owner',  '#E8A317'),('Due within 1 working day','Owner + their manager','#E8A317'),
       ('Overdue (Level 1)','+ Sales person + SM Projects','#C62828'),('Overdue 1 wd (Level 2)','+ SM Projects / SM Estimation (by team)','#C62828'),
       ('Overdue 2 wd (Level 3)','+ GM / DGM','#7f1d1d')]
W=1100; bw=196; g=24; svg=''
for i,(t,who,c) in enumerate(steps):
    x=i*(bw+g); y=10+ (4-i)*14
    h=150-(4-i)*14
    svg+=f'<rect x="{x}" y="{y}" width="{bw}" height="{h}" rx="8" fill="{c}"/>'
    svg+=f'<text x="{x+bw/2}" y="{y+26}" font-size="13" font-weight="700" fill="#fff" text-anchor="middle">{esc(t)}</text>'
    svg+=textblock(x,y+36,bw,h-40,'Notified: '+who,10.5,'#fff')
    if i: svg+=f'<path d="M{x-g+3},{y+h/2+10} L{x-3},{y+h/2+10}" stroke="#374151" stroke-width="1.6" marker-end="url(#ar)"/>'
ladder_svg=f'<svg viewBox="0 0 {W} 170" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Liberation Sans, Arial, sans-serif">{ARROWDEF}{svg}</svg>'

# ---------- 7. Overview: who hands work to whom
ov=Swim(['Client','Sales','SM Projects','Design Manager','Designer / Engineer','SM Estimation','Estimator','GM / DGM','Operations'],6,lane_h=46,fs=8.6)
ov.node('c1','Client',0,'Need / tender / drawings')
ov.node('s1','Sales',1,'Visits · projects · inquiries')
ov.node('p1','SM Projects',2,'Plans · release mode · approvals · coaching','appr')
ov.node('d1','Design Manager',2,'Accept · assign · review · release','appr')
ov.node('g1','Designer / Engineer',3,'Design work & files')
ov.node('e1','SM Estimation',3,'Accept · assign · approve quote','appr')
ov.node('x1','Estimator',4,'Pricing & quotation → released via sales')
ov.node('m1','GM / DGM',4,'High-value / low-margin quotes · targets · dashboards','appr')
ov.node('o1','Operations',1,'Debtors upload · legal · samples')
ov.node('c2','Client',5,'Quotation / design delivered','end')
ov.edge('c1','s1'); ov.edge('s1','p1'); ov.edge('s1','d1'); ov.edge('d1','g1'); ov.edge('s1','e1','Route B',lx=ov.nodes['e1'][0]-40,ly=ov.nodes['e1'][1]-3); ov.edge('g1','e1','Route A',mode='early')
ov.edge('e1','x1'); ov.edge('e1','m1'); ov.edge('x1','c2')
overview_svg=ov.svg()

legend='''<div class="legend">
<span><i class="b act"></i>Action</span><span><i class="b appr"></i>Decision / approval ✓</span><span><i class="b end"></i>End result</span>
<span><svg width="34" height="10"><path d="M1,5 L30,5" stroke="#374151" stroke-width="1.4" marker-end="url(#ar2)"/><defs><marker id="ar2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker></defs></svg>Next step</span>
<span><svg width="34" height="10"><path d="M1,5 L30,5" stroke="#C8102E" stroke-width="1.4" stroke-dasharray="4 3"/></svg>Returned / sent back</span>
<span class="muted">wh = working hours · wd = working days (Mon–Fri 08:30–17:30, excluding holidays)</span></div>'''

def pg(title,sub,svgc,note='',first=False):
    return f'''<section class="pg{' first' if first else ''}"><div class="ph"><div><div class="t">{title}</div><div class="s">{sub}</div></div><div class="logo">DIMO</div></div>
{svgc}{note}{legend}</section>'''

htmlout=f'''<!doctype html><html><head><meta charset="utf-8"><title>DIMO Workflow and Approval Flow Charts</title><style>
@page {{ size: A4 landscape; margin: 10mm 12mm 12mm 12mm; }}
body {{ font-family:"Liberation Sans",Arial,sans-serif; color:#1f2937; margin:0; font-size:9.5pt; }}
.pg {{ page-break-before: always; }} .pg.first {{ page-break-before: auto; }}
.ph {{ display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #C8102E; padding-bottom:2mm; margin-bottom:3mm; }}
.ph .t {{ font-size:16pt; font-weight:700; color:#111827; }} .ph .s {{ color:#6b7280; font-size:9.5pt; }}
.logo {{ font-size:22pt; font-weight:800; color:#C8102E; letter-spacing:2px; }}
.legend {{ display:flex; flex-wrap:wrap; gap:5mm; align-items:center; margin-top:2.5mm; font-size:8.5pt; color:#374151; }}
.legend span {{ display:inline-flex; align-items:center; gap:1.5mm; }}
.b {{ display:inline-block; width:18px; height:11px; border-radius:3px; border:1.4px solid #374151; background:#fff; }}
.b.appr {{ border:2px solid #C8102E; }} .b.end {{ background:#111827; border-radius:6px; }}
.muted {{ color:#6b7280; }}
.note {{ font-size:8.8pt; background:#f6f7f9; border-left:4px solid #1D4ED8; padding:2mm 3mm; margin-top:2mm; }}
h3 {{ font-size:11pt; margin:3mm 0 1.5mm; color:#111827; }}
</style></head><body>
{pg('Who works with whom – overview','All roles of the Lighting Operations System and how work passes between them',overview_svg,'<div class="note">Sales raises every inquiry. SM Projects confirms how results are released; Design and Estimation each <b>accept → assign → review → release</b>; GM / DGM approves only exceptions (high value, low margin, mixed duty, targets). Operations runs debtors and samples alongside.</div>',True)}
{pg('Inquiry flow – Design and Estimation (Routes A, B, C)','From the sales request to the quotation or design reaching the client',inquiry_svg,'<div class="note"><b>Route A</b> design → estimation · <b>Route B</b> estimation only (BOQ / spec available) · <b>Route C</b> design only. Any manager can <b>Return for information</b> (the clock pauses and sales is notified) or <b>Reject</b> with a reason. SM Estimation can send a Route B inquiry to Design, turning it into Route A.</div>')}
{pg('Approval chains – who approves what','Every approval in the system: who raises it, each approval step in order, and the result',approvals_svg,'<div class="note">All approvals appear in the approver’s <b>Approvals</b> tab with a push notification. Returning or rejecting always needs a reason, and every decision is logged. Value limit and margin floor for GM / DGM approval are set by the System Administrator.</div>')}
{pg('Weekly plan, visits and coaching','The weekly sales cycle between sales people, SM Projects and GM / DGM',plans_svg)}
<section class="pg"><div class="ph"><div><div class="t">Debtors and samples</div><div class="s">Operations Executive with sales and managers</div></div><div class="logo">DIMO</div></div>
<h3>Debtors</h3>{debtors_svg}<h3>Samples</h3>{samples_svg}{legend}</section>
<section class="pg"><div class="ph"><div><div class="t">Deadlines and escalation ladder</div><div class="s">Every job has one owner and one due date; the clock counts working time only</div></div><div class="logo">DIMO</div></div>
{ladder_svg}
<h3>Standard targets</h3>
<table style="width:100%;border-collapse:collapse;font-size:9.2pt">
<tr style="background:#111827;color:#fff"><th style="text-align:left;padding:1.5mm">Step</th><th style="text-align:left;padding:1.5mm">Owner</th><th style="text-align:left;padding:1.5mm">Target</th></tr>
<tr><td style="padding:1.2mm;border-bottom:1px solid #e5e7eb">Accept / assign a new inquiry</td><td>Design Manager / SM Estimation</td><td>4 working hours</td></tr>
<tr><td style="padding:1.2mm;border-bottom:1px solid #e5e7eb">Confirm due date on an assigned job</td><td>Designer / Estimator</td><td>4 working hours</td></tr>
<tr><td style="padding:1.2mm;border-bottom:1px solid #e5e7eb">Design work</td><td>Designer / Engineer</td><td>Small 3 · Medium 5 · Large 10 working days</td></tr>
<tr><td style="padding:1.2mm;border-bottom:1px solid #e5e7eb">Design review · Quotation approval · Clarifications</td><td>Design Manager · SM Estimation · Designer</td><td>1 working day each</td></tr>
<tr><td style="padding:1.2mm;border-bottom:1px solid #e5e7eb">Weekly plan submit / approve</td><td>Sales / SM Projects</td><td>Sat 13:00 / Mon 09:00</td></tr>
<tr><td style="padding:1.2mm;border-bottom:1px solid #e5e7eb">Visit report</td><td>Sales</td><td>Same day by 20:00</td></tr>
<tr><td style="padding:1.2mm;border-bottom:1px solid #e5e7eb">Debtors upload</td><td>Operations</td><td>Every Saturday (alert if missing by 22:00)</td></tr>
</table>
<div class="legend"><span><i class="b" style="background:#1E8E3E;border-color:#1E8E3E"></i>Green – on track</span><span><i class="b" style="background:#E8A317;border-color:#E8A317"></i>Amber – 75% used or due within 1 wd</span><span><i class="b" style="background:#C62828;border-color:#C62828"></i>Red – overdue</span><span><i class="b" style="background:#8A8F98;border-color:#8A8F98"></i>Grey – on hold (clock paused)</span></div>
</section>
</body></html>'''
open('workflow_charts.html','w').write(htmlout)
