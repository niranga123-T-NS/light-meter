#!/usr/bin/env python3
"""Generate docs/FIELD_DICTIONARY.md from a database built from the migrations.

Usage: PGHOST=... PGPORT=... PGUSER=postgres TEST_DB=dimo_test python3 scripts/gen_field_dictionary.py
Descriptions come from the Excel column definitions (supabase/functions/_shared/workbook.ts),
list names from the "-- lookup: x" comments in the migrations.
"""
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = os.environ.get('TEST_DB', 'dimo_test')

TABLES = [
    ('customers', 'Customer (account)', 'Salesperson: create in own territory; edit own / own-territory unowned accounts. Manager/Admin: all, assign owner and territory. Estimator: read only (accounts on assigned projects).'),
    ('contacts', 'Contact', 'Salesperson: create/edit for customers they can see. Manager/Admin: all. Estimator: read only.'),
    ('visits', 'Visit', 'Salesperson: create own; edit only while planned/draft; after submission changes go through a correction request approved by a manager. Manager/Admin: edit any (audited). Estimator: read visits linked to assigned projects.'),
    ('visit_contacts', 'Visit ↔ contact link', 'Same as the visit.'),
    ('visit_projects', 'Visit ↔ project link', 'Same as the visit.'),
    ('visit_opportunities', 'Visit ↔ package link', 'Same as the visit.'),
    ('projects', 'Project (one per physical project or tender)', 'Salesperson: create; edit own, own-territory or shared (member) projects. Manager/Admin: all. Estimator: read assigned projects.'),
    ('project_stakeholders', 'Project stakeholder', 'Anyone who can edit the project.'),
    ('project_members', 'Project team member', 'Manager/Admin or the project owner.'),
    ('opportunities', 'Opportunity / lighting package / bid', 'Owner, project editors, Manager/Admin. Stage changes validated by stage rules.'),
    ('actions', 'Action (follow-up task)', 'Owner, creator, Manager/Admin. Anyone who can see the parent may add one.'),
    ('quotations', 'Quotation revision', 'Salesperson/Estimator on visible packages; preparer or Manager/Admin may edit.'),
    ('quotation_financials', 'Quotation cost & margin (restricted)', 'Only roles in the margin_visible_roles setting (default Manager, Admin).'),
    ('project_milestones', 'Design / submittal milestone', 'Project members (estimators, designers), project editors, Manager/Admin.'),
    ('technical_notes', 'Technical note', 'Project members and editors add; author edits own.'),
    ('attachments', 'Attachment metadata (file in secure storage)', 'Uploader and Manager/Admin; readable by anyone who can read the parent record.'),
    ('correction_requests', 'Correction request for a submitted visit', 'Salesperson requests for own visits; Manager/Admin approve/reject.'),
]

REQUIRED_AT_SUBMIT = {
    'visits': {
        'salesperson_id': 'Required at submission', 'customer_id': 'Required at submission',
        'contact_unavailable_reason': 'Required at submission if no contact is linked',
        'visit_date': 'Required at submission', 'visit_type': 'Required at submission', 'purpose': 'Required at submission',
        'summary': 'Required at submission', 'outcome': 'Required at submission',
        'no_followup_reason': 'Required at submission if no next action is added',
        'location_unavailable_reason': 'Required at submission if GPS is mandatory (setting gps_required) and no location was captured',
    },
}

AUTO = {'id', 'code', 'version', 'created_at', 'created_by', 'updated_at', 'updated_by', 'normalized_name', 'weighted_value',
        'duration_minutes', 'last_activity_at', 'last_visit_at', 'submitted_at', 'closed_at', 'completed_at', 'territory_id_auto'}


def tidy(expr: str) -> str:
    expr = re.sub(r'\s+', ' ', expr)
    expr = re.sub(r'::(text|numeric|double precision|integer|bpchar|character varying|date)(\[\])?', '', expr)
    expr = re.sub(r'\((\d+)\)', r'\1', expr)
    while expr.startswith('(') and expr.endswith(')') and expr.count('(') == expr.count(')'):
        inner = expr[1:-1]
        depth, ok = 0, True
        for ch in inner:
            depth += ch == '('
            depth -= ch == ')'
            if depth < 0:
                ok = False
                break
        if not ok:
            break
        expr = inner
    return expr.replace("'", '')


def psql(sql: str) -> list[list[str]]:
    out = subprocess.run(['psql', '-d', DB, '-At', '-F', '\x1f', '-R', '\x1e', '-c', sql], capture_output=True, text=True, check=True).stdout
    return [rec.split('\x1f') for rec in out.rstrip('\n').split('\x1e') if rec.strip('\n')]


def descriptions() -> dict[str, dict[str, str]]:
    src = (ROOT / 'supabase/functions/_shared/workbook.ts').read_text()
    result: dict[str, dict[str, str]] = {}
    for block in re.finditer(r"key: '(\w+)'.*?columns: \[(.*?)\n    \],", src, re.S):
        sheet = block.group(1)
        result[sheet] = {m.group(1): m.group(2).replace("\\'", "'") for m in re.finditer(r"c\('(\w+)', '\w+', '((?:[^'\\]|\\.)*)'", block.group(2))}
    return result


def lookups() -> dict[tuple[str, str], str]:
    found = {}
    for f in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        table = None
        for line in f.read_text().splitlines():
            m = re.match(r'create table public\.(\w+)', line)
            if m:
                table = m.group(1)
            m = re.match(r'\s+(\w+) .*-- lookup: (\w+)', line)
            if m and table:
                found[(table, m.group(1))] = m.group(2)
    return found


def main() -> None:
    desc = descriptions()
    look = lookups()
    checks = psql("""
      select rel.relname, pg_get_constraintdef(c.oid)
      from pg_constraint c join pg_class rel on rel.oid = c.conrelid join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'public' and c.contype = 'c'""")
    lines = [
        '# Field dictionary',
        '',
        'Generated from the database schema by `scripts/gen_field_dictionary.py` – regenerate after changing a migration.',
        '',
        '* **Type** is the PostgreSQL type. `uuid` IDs are generated on the device for offline records; human-readable codes (CUS-, CON-, VIS-, PRJ-, OPP-, ACT-, QUO-) are issued by the server.',
        '* **Mandatory**: `Yes` = enforced by the database on every save; `Submit` = required when a visit is submitted (drafts may be incomplete); `Auto` = set by the system.',
        '* **Allowed values**: fixed values are enforced by check constraints; `list: x` values come from the administrator-maintained list `x` (Admin › Dropdown lists).',
        '* **Timestamps** (`timestamptz`) are stored in UTC and shown / exported in Asia/Colombo time. Money is always stored with its ISO 4217 currency.',
        '* **Edit permission** is enforced on the server by row-level security; see docs/SECURITY_AND_SYNC.md for the full matrix.',
        '',
    ]
    for table, title, perm in TABLES:
        cols = psql(f"""
          select a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), ''),
                 case when a.attgenerated = 's' then 'generated' else '' end
          from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = 'public.{table}'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum""")
        sheet = {'visit_contacts': 'visit_contacts'}.get(table, table)
        dmap = desc.get(sheet, {})
        tchecks = [c[1] for c in checks if c[0] == table]
        lines += [f'## {title} – `{table}`', '', f'**Edit permission:** {perm}', '',
                  '| Field | Type | Mandatory | Allowed values / validation | Description |', '|---|---|---|---|---|']
        for name, typ, notnull, default, generated in cols:
            allowed = []
            if (table, name) in look:
                allowed.append(f'list: {look[(table, name)]}')
            for ck in tchecks:
                if re.search(rf'\b{name}\b', ck):
                    m = re.search(rf"\b{name}\b = ANY \(ARRAY\[(.*?)\]", ck)
                    if m:
                        allowed.append(', '.join(re.findall(r"'([^']+)'", m.group(1))))
                    elif 'length(TRIM' in ck:
                        allowed.append('not blank')
                    else:
                        allowed.append(tidy(ck.replace('CHECK ', '')))
            if generated:
                allowed.append('calculated by the database')
            elif default and 'nextval' not in default and 'next_code' not in default and name not in ('id',):
                allowed.append(f'default {tidy(default)}')
            if 'next_code' in default:
                allowed.append('issued by server')
            mandatory = 'Auto' if name in AUTO or generated else ('Yes' if notnull == 't' else '')
            if table in REQUIRED_AT_SUBMIT and name in REQUIRED_AT_SUBMIT[table]:
                mandatory = 'Submit'
            d = dmap.get(name, '')
            lines.append(f"| `{name}` | {typ} | {mandatory} | {'; '.join(dict.fromkeys(allowed)).replace('|', '/')} | {d} |")
        lines.append('')
    lines += [
        '## Visit submission rule',
        '',
        'A visit can be saved as an incomplete draft on the device at any time. To submit, it needs: salesperson, customer, at least one contact or a "contact unavailable" reason, visit date, visit type, purpose, meeting summary, outcome, and at least one next action or a "no follow up" reason. When the `gps_required` setting is on, a check-in location or a "location unavailable" reason is also required (remote meetings are exempt). The app checks these before queuing; the database enforces them again (`visit_missing_fields`).',
        '',
        '## Pipeline stage rules',
        '',
        'Each stage (Admin › Pipeline stages) has a default probability, an outcome type (open, won, lost, on hold, cancelled), fields that must be filled before **leaving** it and fields required on **entering** it. The server validates these on every stage change; `weighted_value = estimated_value × probability ÷ 100`.',
        '',
    ]
    (ROOT / 'docs/FIELD_DICTIONARY.md').write_text('\n'.join(lines))
    print('wrote docs/FIELD_DICTIONARY.md')


if __name__ == '__main__':
    main()
