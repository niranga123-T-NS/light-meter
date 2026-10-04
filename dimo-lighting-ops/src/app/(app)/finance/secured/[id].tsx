import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { DataTable } from "@/components/DataTable";
import { useDialog } from "@/components/dialog";
import { SCHEDULE_LABEL, SCHEDULE_TONE } from "@/components/financeTones";
import {
  Button,
  Card,
  colors,
  ErrorBanner,
  Field,
  Grid,
  KeyValue,
  Loading,
  Muted,
  Notice,
  NumberField,
  Pill,
  Row,
  Screen,
  Section,
  Select,
} from "@/components/ui";
import { useMe } from "@/lib/auth";
import {
  addMonths,
  fmtMonth,
  fyEnd,
  fyLabel,
  fyOf,
  isFinanceDesk,
  isReviewer,
  kindLabel,
  KINDS,
  lineLabel,
  LINES,
  mn,
  monthOf,
  MOVE_REASONS,
  PATTERNS,
  thisMonth,
  type Allocation,
  type InvoiceKind,
  type InvoiceLine,
  type LineChange,
  type SecuredProject,
  type Variation,
} from "@/lib/finance";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/format";
import { useLoad, usePeople } from "@/lib/hooks";
import { rpc, supabase } from "@/lib/supabase";

type Draft = {
  key: string;
  id?: string;
  kind: InvoiceKind;
  description: string;
  trigger_note: string;
  amount: number | null;
  month: string | null;
};
type LogRow = {
  id: number;
  action: string;
  note: string | null;
  by_user: string | null;
  at: string;
};
let seq = 0;

const lineStatus = (
  l: InvoiceLine,
  fy: number,
): { label: string; tone: string } => {
  if (Number(l.remaining) <= 0.5)
    return { label: "Invoiced", tone: colors.green };
  if (l.pending_change_id)
    return {
      label: `Awaiting SM Projects → ${fmtMonth(l.pending_month)}`,
      tone: colors.red,
    };
  if (l.forecast_month < thisMonth())
    return {
      label:
        Number(l.invoiced) > 0 ? "Part invoiced – balance slipped" : "Slipped",
      tone: colors.red,
    };
  if (Number(l.invoiced) > 0)
    return { label: "Part invoiced", tone: colors.amber };
  if (l.forecast_month > fyEnd(fy))
    return { label: "Next FY", tone: colors.grey };
  if (l.moves > 0) return { label: `Moved ${l.moves}×`, tone: colors.amber };
  return { label: "Planned", tone: colors.blue };
};

/** One secured project: details, the invoice schedule (several invoices), date changes with reasons, invoicing received. */
export default function SecuredDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [orderValue, setOrderValue] = useState<number | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    data,
    error: loadErr,
    reload,
  } = useLoad(async () => {
    const [s, l, a, lg, vr] = await Promise.all([
      supabase.from("secured_projects").select("*").eq("id", id).single(),
      supabase
        .from("invoice_line_status")
        .select("*")
        .eq("secured_id", id)
        .order("seq"),
      supabase
        .from("invoice_allocations")
        .select("*")
        .eq("secured_id", id)
        .order("month"),
      supabase
        .from("secured_log")
        .select("*")
        .eq("secured_id", id)
        .order("at", { ascending: false }),
      supabase
        .from("secured_variations")
        .select("*")
        .eq("secured_id", id)
        .order("requested_at"),
    ]);
    if (s.error) throw new Error(s.error.message);
    const lines = (l.data ?? []) as InvoiceLine[];
    const { data: ch } = lines.length
      ? await supabase
          .from("invoice_line_changes")
          .select("*")
          .in(
            "line_id",
            lines.map((x) => x.id),
          )
          .order("requested_at", { ascending: false })
      : { data: [] };
    return {
      s: s.data as SecuredProject,
      lines,
      allocs: (a.data ?? []) as Allocation[],
      changes: (ch ?? []) as LineChange[],
      log: (lg.data ?? []) as LogRow[],
      variations: (vr.data ?? []) as Variation[],
    };
  }, [id]);
  if (!data)
    return (
      <Screen>
        {loadErr ? <ErrorBanner message={loadErr} /> : <Loading />}
      </Screen>
    );
  const { s, lines } = data;
  const fy = fyOf(s.won_on > thisMonth() ? s.won_on : thisMonth());
  const owner = s.sales_person_id === me.id;
  const desk = isFinanceDesk(me.role);
  const reviewer = isReviewer(me.role);
  const canEdit = (owner || desk) && s.status === "open";
  const editable = canEdit && (s.schedule_status !== "approved" || desk);
  const lineOf = (lid: string | null) => lines.find((x) => x.id === lid);

  const startEdit = () => {
    setOrderValue(s.order_value == null ? null : Number(s.order_value));
    setLine(s.business_line);
    setDraft(
      lines.map((l) => ({
        key: l.id,
        id: l.id,
        kind: l.kind,
        description: l.description ?? "",
        trigger_note: l.trigger_note ?? "",
        amount: Number(l.amount),
        month: l.forecast_month,
      })),
    );
  };
  const editing = draft != null;
  const total =
    (draft ?? []).reduce((a, d) => a + (d.amount ?? 0), 0) +
    Number(s.billed_before);
  const ov = orderValue ?? Number(s.order_value ?? 0);
  const monthOptions = Array.from({ length: 48 }, (_, i) =>
    addMonths(monthOf(s.won_on), i - 6),
  ).map((m) => ({ value: m, label: fmtMonth(m) }));

  const applyPattern = async () => {
    if (!ov) return setError("Enter the order value first");
    const r = await dialog.prompt({
      title: "Use a ready-made pattern",
      message:
        "The invoices are filled from the order value and the won month. Adjust them afterwards.",
      fields: [
        {
          key: "p",
          label: "Pattern",
          type: "select",
          required: true,
          options: [
            ...PATTERNS.map((p) => ({ value: p.key, label: p.label })),
            {
              value: "ipc",
              label: "Work done – monthly IPC bills (choose months)",
            },
          ],
        },
      ],
    });
    if (!r) return;
    if (r.p === "ipc") return ipcPattern();
    const p = PATTERNS.find((x) => x.key === r.p)!;
    const rest = ov - Number(s.billed_before);
    const parts = p.parts.map((x) => Math.round((rest * x.pct) / 100));
    parts[parts.length - 1] += rest - parts.reduce((a, b) => a + b, 0);
    setDraft(
      p.parts.map((x, i) => ({
        key: `p${++seq}`,
        kind: x.kind,
        description: x.description,
        trigger_note: "",
        amount: parts[i],
        month: addMonths(monthOf(s.won_on), x.after),
      })),
    );
  };

  // Work-done project: advance, equal monthly IPC (interim payment certificate) bills, retention release
  const ipcPattern = async () => {
    const r = await dialog.prompt({
      title: "Work done – monthly IPC bills",
      message:
        "The balance after the advance and retention is split equally over the IPC months. Adjust the amounts afterwards.",
      fields: [
        {
          key: "start",
          label: "First IPC month",
          type: "select",
          required: true,
          options: monthOptions,
          initial: addMonths(monthOf(s.won_on), 1),
        },
        {
          key: "n",
          label: "Number of IPC bills",
          required: true,
          initial: "6",
        },
        { key: "adv", label: "Advance % (0 if none)", initial: "0" },
        { key: "ret", label: "Retention % (0 if none)", initial: "5" },
        {
          key: "after",
          label: "Retention released – months after the last IPC",
          initial: "12",
        },
      ],
    });
    if (!r) return;
    const n = Math.round(Number(r.n));
    const adv = Number(r.adv || 0);
    const ret = Number(r.ret || 0);
    const after = Math.round(Number(r.after || 0));
    if (!(n >= 1 && n <= 60)) return setError("Enter 1 to 60 IPC bills");
    if (!(adv >= 0 && ret >= 0 && adv + ret < 100 && after >= 0))
      return setError("Check the advance and retention %");
    const rest = ov - Number(s.billed_before);
    const advAmt = Math.round((rest * adv) / 100);
    const retAmt = Math.round((rest * ret) / 100);
    const each = Math.round((rest - advAmt - retAmt) / n);
    const out: Draft[] = [];
    if (advAmt)
      out.push({
        key: `p${++seq}`,
        kind: "advance",
        description: `Advance ${adv}%`,
        trigger_note: "Advance guarantee / PO",
        amount: advAmt,
        month: monthOf(s.won_on),
      });
    for (let i = 0; i < n; i++) {
      out.push({
        key: `p${++seq}`,
        kind: "progress",
        description: `IPC ${i + 1}`,
        trigger_note: "Work done – certified by the consultant",
        amount: each,
        month: addMonths(r.start, i),
      });
    }
    out[out.length - 1].amount = rest - advAmt - retAmt - each * (n - 1);
    if (retAmt)
      out.push({
        key: `p${++seq}`,
        kind: "retention",
        description: `Retention ${ret}%`,
        trigger_note: "End of defects liability period",
        amount: retAmt,
        month: addMonths(r.start, n - 1 + after),
      });
    setDraft(out);
  };

  const saveSchedule = async (submit: boolean) => {
    setError(null);
    const list = draft ?? [];
    const bad = list.findIndex((d) => !d.amount || d.amount <= 0 || !d.month);
    if (bad >= 0)
      return setError(`Invoice ${bad + 1}: enter the amount and month`);
    if (submit && !line) return setError("Choose the business line");
    if (submit && Math.abs(total - ov) > 1)
      return setError(
        `The invoices add up to ${fmtMoney(total)} – they must equal the order value ${fmtMoney(ov)}`,
      );
    await dialog.run(
      async () => {
        await rpc("save_invoice_schedule", {
          p_secured: s.id,
          p_data:
            s.schedule_status === "approved"
              ? {}
              : {
                  business_line: line,
                  order_value: orderValue == null ? "" : String(orderValue),
                },
          p_lines: list.map((d) => ({
            id: d.id ?? "",
            kind: d.kind,
            description: d.description,
            trigger_note: d.trigger_note,
            amount: String(d.amount),
            month: d.month,
          })),
          p_submit: submit,
        });
        setDraft(null);
        await reload();
      },
      s.schedule_status === "approved"
        ? "Schedule changed"
        : submit
          ? reviewer
            ? "Schedule approved"
            : "Sent to SM Projects for review"
          : "Draft saved",
    );
  };

  const review = async (approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? "Approve the invoice schedule" : "Return the schedule",
      message: approve
        ? "The months become the original plan; the this-year part counts as the sales person’s secured value."
        : "Say what to change.",
      fields: [
        {
          key: "note",
          label: approve ? "Note (optional)" : "Reason",
          type: "multiline",
          required: !approve,
        },
      ],
      confirmLabel: approve ? "Approve" : "Return",
    });
    if (!r) return;
    await dialog.run(
      async () => {
        await rpc("review_invoice_schedule", {
          p_secured: s.id,
          p_approve: approve,
          p_note: r.note || null,
        });
        await reload();
      },
      approve ? "Approved" : "Returned to the sales person",
    );
  };

  const move = async (l: InvoiceLine) => {
    const r = await dialog.prompt({
      title: `Move “${l.description ?? kindLabel(l.kind)}”`,
      message: `Now planned for ${fmtMonth(l.forecast_month)} (original ${fmtMonth(l.original_month)}). Moves of an invoice due this month or out of the financial year need SM Projects.`,
      fields: [
        {
          key: "month",
          label: "New month",
          type: "select",
          required: true,
          options: monthOptions.filter((o) => o.value !== l.forecast_month),
        },
        {
          key: "reason",
          label: "Reason",
          type: "select",
          required: true,
          options: MOVE_REASONS.map((x) => ({ value: x, label: x })),
        },
        { key: "note", label: "Details", type: "multiline" },
      ],
      confirmLabel: "Move",
    });
    if (!r) return;
    await dialog.run(async () => {
      const res = await rpc<string>("move_invoice_line", {
        p_line: l.id,
        p_month: r.month,
        p_reason: r.reason,
        p_note: r.note || null,
      });
      await reload();
      if (res === "pending") dialog.toast("Sent to SM Projects for approval");
    }, "Done");
  };

  const decideMove = async (changeId: number, approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? "Approve the date change" : "Do not approve",
      fields: [
        {
          key: "note",
          label: approve ? "Note (optional)" : "Reason",
          type: "multiline",
          required: !approve,
        },
      ],
      confirmLabel: approve ? "Approve" : "Reject",
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc("decide_invoice_move", {
        p_change: changeId,
        p_approve: approve,
        p_note: r.note || null,
      });
      await reload();
    }, "Done");
  };

  const editDetails = async () => {
    const { data: sales } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("role", ["asm_building", "asm_infra"])
      .eq("active", true)
      .order("full_name");
    const r = await dialog.prompt({
      title: "Project details",
      fields: [
        {
          key: "wbs",
          label: "WBS (SAP project code)",
          initial: s.wbs ?? "",
          hint: "e.g. LS-000176 – invoicing in the OR file is matched by it",
        },
        { key: "po_no", label: "PO / contract no.", initial: s.po_no ?? "" },
        { key: "customer", label: "Customer", initial: s.customer ?? "" },
        {
          key: "business_line",
          label: "Business line",
          type: "select",
          initial: s.business_line ?? undefined,
          options: LINES.map((x) => ({ value: x.value, label: x.label })),
        },
        ...(desk
          ? [
              {
                key: "sales_person_id",
                label: "Sales person",
                type: "select" as const,
                initial: s.sales_person_id ?? undefined,
                options: (sales ?? []).map((x) => ({
                  value: x.id,
                  label: x.full_name,
                })),
              },
            ]
          : []),
        {
          key: "notes",
          label: "Notes",
          type: "multiline",
          initial: s.notes ?? "",
        },
      ],
    });
    if (!r) return;
    const patch: Record<string, string> = {
      wbs: r.wbs,
      po_no: r.po_no,
      customer: r.customer,
      notes: r.notes,
    };
    if (r.business_line) patch.business_line = r.business_line;
    if (desk && r.sales_person_id && r.sales_person_id !== s.sales_person_id)
      patch.sales_person_id = r.sales_person_id;
    await dialog.run(async () => {
      await rpc("set_secured_details", { p_secured: s.id, p_data: patch });
      await reload();
    }, "Saved");
  };

  const reassign = async (a: Allocation) => {
    const r = await dialog.prompt({
      title: `Re-assign ${fmtMoney(a.amount)} (${fmtMonth(a.month)})`,
      fields: [
        {
          key: "line",
          label: "Invoice",
          type: "select",
          required: true,
          options: [
            {
              value: "none",
              label: "Not against an invoice (extra / credit note)",
            },
            ...lines.map((l) => ({
              value: l.id,
              label: `${l.description ?? kindLabel(l.kind)} · ${fmtMonth(l.forecast_month)}`,
            })),
          ],
        },
      ],
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc("reassign_allocation", {
        p_alloc: a.id,
        p_line: r.line === "none" ? null : r.line,
      });
      await reload();
    }, "Re-assigned");
  };

  const closeProject = async () => {
    const r = await dialog.prompt({
      title: "Close or cancel this secured project",
      fields: [
        {
          key: "status",
          label: "Action",
          type: "select",
          required: true,
          options: [
            { value: "closed", label: "Close – all done" },
            { value: "cancelled", label: "Cancel – order cancelled" },
          ],
        },
        { key: "note", label: "Reason", type: "multiline", required: true },
      ],
      danger: true,
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc("close_secured_project", {
        p_secured: s.id,
        p_status: r.status,
        p_note: r.note,
      });
      await reload();
    }, "Done");
  };

  const pendingVar = data.variations.find((v) => v.status === "pending");
  const varNet = data.variations
    .filter((v) => v.status === "approved")
    .reduce((a, v) => a + Number(v.amount), 0);
  const addVariation = async () => {
    const r = await dialog.prompt({
      title: "Variation",
      message: reviewer
        ? "Recorded straight away. An addition becomes a new invoice; an omission comes off the last invoices still to bill."
        : "Goes to SM Projects for approval. An addition becomes a new invoice; an omission comes off the last invoices still to bill.",
      fields: [
        {
          key: "t",
          label: "Type",
          type: "select",
          required: true,
          options: [
            { value: "+", label: "Addition (+)" },
            { value: "-", label: "Omission (−)" },
          ],
        },
        { key: "a", label: "Amount (LKR)", required: true },
        { key: "vo", label: "Variation order (VO) no." },
        {
          key: "m",
          label: "Month it will be invoiced (additions)",
          type: "select",
          options: monthOptions,
          initial: thisMonth(),
        },
        { key: "r", label: "Reason", type: "multiline", required: true },
      ],
    });
    if (!r) return;
    const amt = Number(String(r.a).replace(/,/g, ""));
    if (!(amt > 0)) return setError("Enter the amount");
    await dialog.run(
      async () => {
        const res = await rpc<string>("request_variation", {
          p_secured: s.id,
          p_data: {
            vo_no: r.vo || null,
            amount: r.t === "-" ? -amt : amt,
            month: r.t === "-" ? null : r.m,
            reason: r.r,
          },
        });
        await reload();
        return res;
      },
      reviewer ? "Variation recorded" : "Sent to SM Projects",
    );
  };
  const decideVariation = async (v: Variation, approve: boolean) => {
    const r = await dialog.prompt({
      title: approve ? "Approve the variation" : "Do not approve",
      fields: [
        {
          key: "n",
          label: approve ? "Note" : "Reason",
          type: "multiline",
          required: !approve,
        },
      ],
    });
    if (!r) return;
    await dialog.run(
      async () => {
        await rpc("decide_variation", {
          p_id: v.id,
          p_approve: approve,
          p_note: r.n || null,
        });
        await reload();
      },
      approve ? "Approved – schedule updated" : "Not approved",
    );
  };
  const finalAccount = async () => {
    const open = lines.reduce(
      (a, l) => a + Math.max(Number(l.remaining), 0),
      0,
    );
    const extra = data.allocs
      .filter((a) => !a.line_id)
      .reduce((a, x) => a + Number(x.amount), 0);
    const r = await dialog.prompt({
      title: "Close the final account",
      message: `Invoiced so far ${fmtMoney(invoicedAll + Number(s.billed_before))}. ${open > 0.5 ? `${fmtMoney(open)} not invoiced is cleared as a final-account omission. ` : ""}${extra > 0.5 ? `${fmtMoney(extra)} invoiced above the schedule is recorded as a final-account addition. ` : ""}The project then closes as fully invoiced.`,
      fields: [
        {
          key: "n",
          label: "Final bill no. / agreed final value / note",
          type: "multiline",
          required: true,
        },
      ],
      confirmLabel: "Close final account",
      danger: true,
    });
    if (!r) return;
    await dialog.run(async () => {
      await rpc("close_final_account", { p_secured: s.id, p_note: r.n });
      await reload();
    }, "Final account closed");
  };

  const invoicedAll = data.allocs.reduce((a, x) => a + Number(x.amount), 0);
  const credit = lines
    .filter(
      (l) =>
        l.original_month >= `${fyOf(s.won_on)}-04-01` &&
        l.original_month <= fyEnd(fyOf(s.won_on)),
    )
    .reduce((a, l) => a + Number(l.amount), 0);

  return (
    <Screen maxWidth={1150}>
      <Stack.Screen options={{ title: s.project_name }} />
      <ErrorBanner message={error ?? loadErr} />
      <Card>
        <Row wrap gap={6}>
          <Pill
            label={SCHEDULE_LABEL[s.schedule_status]}
            tone={SCHEDULE_TONE[s.schedule_status]}
          />
          {s.source === "opening" ? (
            <Pill label="Opening list (won before the system)" />
          ) : (
            <Pill label="Won in the system" tone={colors.green} />
          )}
          {s.source === "won" && !s.budget_id ? (
            <Pill label="Unbudgeted win" tone={colors.blue} />
          ) : null}
          {s.status !== "open" ? (
            <Pill
              label={s.status === "closed" ? "Closed" : "Cancelled"}
              tone={colors.grey}
            />
          ) : null}
        </Row>
        <Grid min={200}>
          <KeyValue label="Customer" value={s.customer ?? "—"} />
          <KeyValue label="Business line" value={lineLabel(s.business_line)} />
          <KeyValue
            label="Sales person"
            value={people[s.sales_person_id ?? ""]?.full_name ?? "—"}
          />
          <KeyValue label="Won (PO date)" value={fmtDate(s.won_on)} />
          {s.schedule_status === "approved" ? (
            <KeyValue
              label="Original value"
              value={fmtMoney(s.original_value ?? s.order_value)}
            />
          ) : null}
          {varNet ? (
            <KeyValue
              label="Variations"
              value={`${varNet > 0 ? "+" : "−"} ${fmtMoney(Math.abs(varNet))}`}
            />
          ) : null}
          <KeyValue
            label={
              s.final_at
                ? "Final value"
                : varNet
                  ? "Revised value"
                  : "Order value"
            }
            value={fmtMoney(s.order_value)}
          />
          <KeyValue
            label="WBS"
            value={s.wbs ?? "Not set – Operations adds it"}
          />
          <KeyValue label="PO / contract no." value={s.po_no ?? "—"} />
          {Number(s.billed_before) ? (
            <KeyValue
              label="Invoiced before the system"
              value={fmtMoney(s.billed_before)}
            />
          ) : null}
          <KeyValue
            label="Invoiced (OR uploads)"
            value={fmtMoney(invoicedAll)}
          />
          {s.source === "won" && s.schedule_status === "approved" ? (
            <KeyValue
              label={`Secured value counted (${fyLabel(fyOf(s.won_on))})`}
              value={fmtMoney(credit)}
            />
          ) : null}
        </Grid>
        {s.review_note && s.schedule_status === "missing" ? (
          <Notice
            tone={colors.red}
          >{`Returned by SM Projects: ${s.review_note}`}</Notice>
        ) : null}
        {s.notes ? <Muted>{s.notes}</Muted> : null}
        <Row wrap gap={8}>
          {canEdit ? (
            <Button
              small
              variant="secondary"
              title="Edit details"
              onPress={editDetails}
            />
          ) : null}
          {s.project_id ? (
            <Button
              small
              variant="ghost"
              title="Open project"
              onPress={() => router.push(`/projects/${s.project_id}`)}
            />
          ) : null}
          {desk ? (
            <Button
              small
              variant="ghost"
              title={s.status === "open" ? "Close / cancel" : "Re-open"}
              onPress={
                s.status === "open"
                  ? closeProject
                  : () =>
                      dialog.run(async () => {
                        await rpc("close_secured_project", {
                          p_secured: s.id,
                          p_status: "open",
                          p_note: "Re-opened",
                        });
                        await reload();
                      })
              }
            />
          ) : null}
        </Row>
      </Card>

      {s.schedule_status === "review" && reviewer ? (
        <Notice tone={colors.amber}>
          Check the invoices below and approve, or return them with a reason.
        </Notice>
      ) : null}

      <Section
        title="Invoice schedule"
        right={
          !editing && editable ? (
            <Button
              small
              variant={
                s.schedule_status === "approved" ? "secondary" : "primary"
              }
              title={
                s.schedule_status === "approved"
                  ? "Adjust schedule"
                  : lines.length
                    ? "Edit schedule"
                    : "Enter schedule"
              }
              onPress={startEdit}
            />
          ) : undefined
        }
      >
        {editing ? (
          <Card>
            {s.schedule_status !== "approved" ? (
              <Grid min={240}>
                <Select
                  label="Business line"
                  required
                  value={line}
                  onChange={setLine}
                  options={LINES.map((x) => ({
                    value: x.value,
                    label: x.label,
                  }))}
                />
                <NumberField
                  label="Order value"
                  suffix="LKR"
                  required
                  value={orderValue}
                  onChange={setOrderValue}
                />
              </Grid>
            ) : (
              <Notice>
                The schedule is approved: use this only to split or correct
                invoices – the order value follows the total. Record a change in
                the contract value with “Add variation”. Months move with
                “Move”.
              </Notice>
            )}
            {draft!.map((d, i) => {
              const set = (patch: Partial<Draft>) =>
                setDraft(
                  draft!.map((x) => (x.key === d.key ? { ...x, ...patch } : x)),
                );
              const locked = !!d.id && s.schedule_status === "approved";
              return (
                <View
                  key={d.key}
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: colors.line,
                    paddingTop: 8,
                    gap: 4,
                  }}
                >
                  <Row
                    style={{
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "700", color: colors.ink }}>
                      Invoice {i + 1}
                    </Text>
                    {!lineOf(d.id ?? null)?.invoiced ? (
                      <Button
                        small
                        variant="ghost"
                        title="Remove"
                        onPress={() =>
                          setDraft(draft!.filter((x) => x.key !== d.key))
                        }
                      />
                    ) : null}
                  </Row>
                  <Grid min={200}>
                    <Select
                      label="Type"
                      value={d.kind}
                      onChange={(v) => set({ kind: v as InvoiceKind })}
                      options={KINDS.map((k) => ({
                        value: k.value,
                        label: k.label,
                      }))}
                    />
                    <Field
                      label="Description"
                      value={d.description}
                      onChangeText={(v) => set({ description: v })}
                      hint="e.g. Advance 20%, RA bill 2"
                    />
                    <NumberField
                      label="Amount"
                      suffix="LKR"
                      required
                      value={d.amount}
                      onChange={(v) => set({ amount: v })}
                    />
                    {locked ? (
                      <KeyValue
                        label="Month"
                        value={`${fmtMonth(d.month)} (use Move)`}
                      />
                    ) : (
                      <Select
                        label="Month"
                        required
                        value={d.month}
                        onChange={(v) => set({ month: v })}
                        options={monthOptions}
                      />
                    )}
                  </Grid>
                  <Field
                    label="When it can be billed (trigger)"
                    value={d.trigger_note}
                    onChangeText={(v) => set({ trigger_note: v })}
                    hint="e.g. PO signed, goods delivered, T&C certificate"
                  />
                </View>
              );
            })}
            <Row wrap gap={8}>
              <Button
                small
                variant="secondary"
                title="+ Invoice"
                onPress={() =>
                  setDraft([
                    ...draft!,
                    {
                      key: `n${++seq}`,
                      kind:
                        s.schedule_status === "approved"
                          ? "variation"
                          : "other",
                      description: "",
                      trigger_note: "",
                      amount: null,
                      month: thisMonth(),
                    },
                  ])
                }
              />
              {s.schedule_status !== "approved" ? (
                <Button
                  small
                  variant="secondary"
                  title="Use a pattern"
                  onPress={applyPattern}
                />
              ) : null}
            </Row>
            <Text
              style={{
                fontWeight: "600",
                color:
                  Math.abs(total - ov) > 1 && s.schedule_status !== "approved"
                    ? colors.red
                    : colors.green,
              }}
            >
              Total {fmtMoney(total)}
              {Number(s.billed_before)
                ? ` (incl. ${fmtMoney(s.billed_before)} invoiced before)`
                : ""}{" "}
              · order value {fmtMoney(ov)}
            </Text>
            <Row wrap gap={8}>
              {s.schedule_status === "approved" ? (
                <Button
                  title="Save changes"
                  onPress={() => saveSchedule(false)}
                />
              ) : (
                <>
                  <Button
                    title={
                      reviewer ? "Save and approve" : "Send to SM Projects"
                    }
                    onPress={() => saveSchedule(true)}
                  />
                  <Button
                    variant="secondary"
                    title="Save draft"
                    onPress={() => saveSchedule(false)}
                  />
                </>
              )}
              <Button
                variant="ghost"
                title="Cancel"
                onPress={() => setDraft(null)}
              />
            </Row>
          </Card>
        ) : (
          <>
            <DataTable
              rows={lines}
              keyOf={(l) => l.id}
              emptyTitle={
                owner ? "Enter the invoice schedule" : "No invoice schedule yet"
              }
              edge={(l) => lineStatus(l, fy).tone}
              footer={[
                "",
                "Total",
                mn(
                  lines.reduce((a, l) => a + Number(l.amount), 0),
                  2,
                ),
                "",
                "",
                "",
                mn(
                  lines.reduce((a, l) => a + Number(l.invoiced), 0),
                  2,
                ),
                "",
                "",
              ]}
              columns={[
                { h: "#", w: 32, v: (l) => String(l.seq) },
                {
                  h: "Invoice",
                  w: 200,
                  v: (l) => (
                    <View>
                      <Text
                        style={{
                          fontWeight: "700",
                          color: colors.ink,
                          fontSize: 13,
                        }}
                      >
                        {l.description || kindLabel(l.kind)}
                      </Text>
                      <Muted>{l.trigger_note ?? kindLabel(l.kind)}</Muted>
                    </View>
                  ),
                },
                {
                  h: "Amount (Mn)",
                  w: 92,
                  right: true,
                  v: (l) => mn(l.amount, 2),
                },
                { h: "Original", w: 82, v: (l) => fmtMonth(l.original_month) },
                {
                  h: "Forecast",
                  w: 82,
                  v: (l) => fmtMonth(l.forecast_month),
                  tone: (l) =>
                    l.forecast_month !== l.original_month
                      ? colors.amber
                      : undefined,
                },
                { h: "Moves", w: 52, right: true, v: (l) => String(l.moves) },
                {
                  h: "Invoiced (Mn)",
                  w: 92,
                  right: true,
                  v: (l) => mn(l.invoiced, 2),
                },
                {
                  h: "Status",
                  w: 205,
                  v: (l) => (
                    <Pill
                      label={lineStatus(l, fy).label}
                      tone={lineStatus(l, fy).tone}
                    />
                  ),
                },
                {
                  h: "",
                  w: 165,
                  v: (l) =>
                    l.pending_change_id && reviewer ? (
                      <Row gap={4}>
                        <Button
                          small
                          title="Approve"
                          onPress={() => decideMove(l.pending_change_id!, true)}
                        />
                        <Button
                          small
                          variant="secondary"
                          title="Reject"
                          onPress={() =>
                            decideMove(l.pending_change_id!, false)
                          }
                        />
                      </Row>
                    ) : canEdit &&
                      s.schedule_status === "approved" &&
                      Number(l.remaining) > 0.5 &&
                      !l.pending_change_id ? (
                      <Button
                        small
                        variant="secondary"
                        title="Move"
                        onPress={() => move(l)}
                      />
                    ) : null,
                },
              ]}
            />
            {s.schedule_status === "review" && reviewer ? (
              <Row gap={8}>
                <Button title="Approve schedule" onPress={() => review(true)} />
                <Button
                  variant="secondary"
                  title="Return"
                  onPress={() => review(false)}
                />
              </Row>
            ) : null}
            {s.schedule_status === "missing" && owner && lines.length ? (
              <Notice tone={colors.amber}>
                Draft saved – send it to SM Projects when ready.
              </Notice>
            ) : null}
          </>
        )}
      </Section>

      {s.schedule_status === "approved" ? (
        <Section
          title="Variations and final account"
          right={
            canEdit && s.schedule_status === "approved" && !pendingVar ? (
              <Button small title="Add variation" onPress={addVariation} />
            ) : undefined
          }
        >
          <DataTable
            rows={data.variations}
            keyOf={(v) => v.id}
            emptyTitle={
              s.schedule_status === "approved"
                ? "No variations – the project value is the original order value"
                : "Variations are recorded once the schedule is approved"
            }
            edge={(v) =>
              v.status === "pending"
                ? colors.amber
                : v.status === "rejected"
                  ? colors.grey
                  : v.amount > 0
                    ? colors.green
                    : colors.red
            }
            footer={[
              "",
              "",
              "Net approved",
              `${varNet >= 0 ? "+" : "−"}${mn(Math.abs(varNet), 2)}`,
              "",
              "",
              "",
            ]}
            columns={[
              { h: "Date", w: 100, v: (v) => fmtDate(v.requested_at) },
              {
                h: "VO no.",
                w: 90,
                v: (v) =>
                  v.kind === "final_account"
                    ? "Final account"
                    : (v.vo_no ?? "—"),
              },
              { h: "Reason", w: 260, v: (v) => v.reason },
              {
                h: "Amount (Mn)",
                w: 100,
                right: true,
                v: (v) =>
                  `${v.amount > 0 ? "+" : "−"}${mn(Math.abs(v.amount), 2)}`,
                tone: (v) => (v.amount < 0 ? colors.red : colors.green),
              },
              {
                h: "Invoice month",
                w: 100,
                v: (v) => (v.month ? fmtMonth(v.month) : ""),
              },
              {
                h: "By",
                w: 130,
                v: (v) => people[v.requested_by ?? ""]?.full_name ?? "—",
              },
              {
                h: "Approval",
                w: 210,
                v: (v) =>
                  v.status === "pending" && reviewer ? (
                    <Row gap={4}>
                      <Button
                        small
                        title="Approve"
                        onPress={() => decideVariation(v, true)}
                      />
                      <Button
                        small
                        variant="secondary"
                        title="Reject"
                        onPress={() => decideVariation(v, false)}
                      />
                    </Row>
                  ) : (
                    <Pill
                      label={
                        v.status === "pending"
                          ? "Waiting – SM Projects"
                          : v.status === "approved"
                            ? "Approved"
                            : `Not approved${v.decision_note ? ` – ${v.decision_note}` : ""}`
                      }
                      tone={
                        v.status === "pending"
                          ? colors.amber
                          : v.status === "approved"
                            ? colors.green
                            : colors.grey
                      }
                    />
                  ),
              },
            ]}
          />
          <Muted>
            Variations (+ additions / − omissions) change the project value; SM
            Projects approves them. When the last bill is issued, Operations or
            SM Projects close the final account: any balance not invoiced is
            cleared and any extra invoicing is recorded, so the final value
            equals what was invoiced.
          </Muted>
          {desk && s.status === "open" && s.schedule_status === "approved" ? (
            <Row>
              <Button
                small
                variant="secondary"
                title="Close final account"
                onPress={finalAccount}
              />
            </Row>
          ) : null}
        </Section>
      ) : null}

      {data.changes.length ? (
        <Section title="Date changes">
          <DataTable
            rows={data.changes}
            keyOf={(c) => String(c.id)}
            columns={[
              { h: "When", w: 140, v: (c) => fmtDateTime(c.requested_at) },
              {
                h: "Invoice",
                w: 180,
                v: (c) =>
                  lineOf(c.line_id)?.description ??
                  kindLabel(lineOf(c.line_id)?.kind),
              },
              {
                h: "From → to",
                w: 170,
                v: (c) => `${fmtMonth(c.from_month)} → ${fmtMonth(c.to_month)}`,
              },
              {
                h: "Reason",
                w: 260,
                v: (c) => [c.reason, c.note].filter(Boolean).join(" – "),
              },
              {
                h: "By",
                w: 140,
                v: (c) => people[c.requested_by ?? ""]?.full_name ?? "—",
              },
              {
                h: "Approval",
                w: 200,
                v: (c) => (
                  <Pill
                    label={
                      c.status === "pending"
                        ? "Waiting – SM Projects"
                        : c.status === "recorded"
                          ? "Recorded"
                          : `${c.status === "approved" ? "Approved" : "Not approved"}${c.decision_note ? ` – ${c.decision_note}` : ""}`
                    }
                    tone={
                      c.status === "pending"
                        ? colors.amber
                        : c.status === "rejected"
                          ? colors.red
                          : c.status === "approved"
                            ? colors.green
                            : colors.grey
                    }
                  />
                ),
              },
            ]}
          />
        </Section>
      ) : null}

      <Section title="Invoicing received (from the OR file)">
        <DataTable
          rows={data.allocs}
          keyOf={(a) => String(a.id)}
          emptyTitle={
            s.wbs
              ? "Nothing invoiced on this WBS yet"
              : "Add the WBS so invoicing in the OR file can be matched"
          }
          columns={[
            { h: "Month", w: 100, v: (a) => fmtMonth(a.month) },
            {
              h: "Amount",
              w: 150,
              right: true,
              v: (a) => fmtMoney(a.amount),
              tone: (a) => (Number(a.amount) < 0 ? colors.red : undefined),
            },
            {
              h: "Against invoice",
              w: 240,
              v: (a) =>
                a.line_id
                  ? (lineOf(a.line_id)?.description ??
                    kindLabel(lineOf(a.line_id)?.kind))
                  : "Not against an invoice (extra / credit note)",
            },
            {
              h: "",
              w: 140,
              v: (a) => (a.manual ? <Pill label="Re-assigned" /> : null),
            },
            {
              h: "",
              w: 120,
              v: (a) =>
                desk ? (
                  <Button
                    small
                    variant="ghost"
                    title="Re-assign"
                    onPress={() => reassign(a)}
                  />
                ) : null,
            },
          ]}
        />
        <Muted>
          Each month’s invoicing on the WBS is matched to the invoices oldest
          first. Operations can re-assign an amount matched to the wrong
          invoice.
        </Muted>
      </Section>

      <Section title="History">
        <Card>
          {data.log.map((g) => (
            <Text key={g.id} style={{ color: colors.text }}>
              {fmtDateTime(g.at)} ·{" "}
              {people[g.by_user ?? ""]?.full_name ?? "System"} ·{" "}
              {g.note ?? g.action}
            </Text>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}
