import { router, Stack, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { useDialog } from "@/components/dialog";
import { DocSlot } from "@/components/exec/DocSlot";
import { certTone } from "@/components/exec/CertRows";
import {
  Button,
  Card,
  colors,
  ErrorBanner,
  KeyValue,
  ListRow,
  Loading,
  Muted,
  Notice,
  Pill,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { useMe } from "@/lib/auth";
import { CERT_STATUS, certTitle, isJm, type SubCert } from "@/lib/execution";
import { listAttachments, openAttachment } from "@/lib/files";
import { fmtDate, fmtDateTime, fmtMoney, todayISO } from "@/lib/format";
import { useLoad, usePeople } from "@/lib/hooks";
import { rpc, supabase } from "@/lib/supabase";
import type { Attachment } from "@/lib/types";

type CertVar = {
  id: string;
  variation_id: string;
  var_code: string;
  var_title: string;
};

// How far a certificate has come (a return sits at the stage it is corrected in)
const RANK: Record<SubCert["status"], number> = {
  jm_requested: 0,
  jm_scheduled: 1,
  jm_returned: 1,
  jm_ae: 2,
  jm_see: 3,
  draft: 4,
  returned: 4,
  ae_review: 5,
  prepared: 6,
  verified: 7,
  approved: 8,
  paid: 9,
  cancelled: -1,
};
const STEPS: { from: number; label: string; ae?: "jm" | "ipc" }[] = [
  { from: 1, label: "JM confirmed" },
  { from: 3, label: "JM checked by AE", ae: "jm" },
  { from: 4, label: "JM approved" },
  { from: 5, label: "IPC submitted" },
  { from: 6, label: "AE checked", ae: "ipc" },
  { from: 7, label: "IPA approved = IPC" },
  { from: 8, label: "SM Projects approved" },
  { from: 9, label: "Paid" },
];

/** One subcontractor payment certificate (IPC): the IPC and measurement sheets, the AE check, the SEE approval, then the invoice. */
export default function SubCertPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useMe();
  const people = usePeople();
  const dialog = useDialog();
  const { data, error, reload } = useLoad(async () => {
    const [c, f, v, cv] = await Promise.all([
      supabase
        .from("sub_certs")
        .select("*, exec_projects(code, name)")
        .eq("id", id)
        .single(),
      listAttachments("sub_cert", [id]),
      supabase
        .from("sub_invoices")
        .select("id, code, invoice_no, status")
        .eq("sub_cert_id", id)
        .neq("status", "cancelled"),
      supabase
        .from("sub_cert_variations")
        .select("*")
        .eq("sub_cert_id", id)
        .order("var_code"),
    ]);
    if (c.error) throw new Error(c.error.message);
    const vars = (cv.data ?? []) as CertVar[];
    return {
      vars,
      varFiles: vars.length
        ? ((await listAttachments(
            "sub_cert_var",
            vars.map((x) => x.id),
          )) as Attachment[])
        : [],
      c: c.data as SubCert & {
        exec_projects: { code: string | null; name: string } | null;
      },
      files: f as Attachment[],
      invoices: (v.data ?? []) as {
        id: string;
        code: string;
        invoice_no: string;
        status: string;
      }[],
    };
  }, [id]);
  if (!data)
    return (
      <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>
    );
  const { c, files, invoices, vars, varFiles } = data;
  const preparer =
    c.prepared_by === me.id || me.role === "senior_elec_engineer";
  const editable =
    preparer && (c.status === "draft" || c.status === "returned");
  const reviewer =
    (c.status === "ae_review" && me.role === "assistant_engineer") ||
    (c.status === "prepared" && me.role === "senior_elec_engineer");
  const later =
    (c.status === "verified" && me.role === "sm_projects") ||
    (c.status === "approved" && me.role === "operations_exec");
  const marked = files.filter(
    (x) => x.kind === "ipc_markup" || x.kind === "jm_markup",
  );
  const jm = isJm(c.status);
  const rank = RANK[c.status];
  const jmEditable =
    preparer && (c.status === "jm_scheduled" || c.status === "jm_returned");
  const jmReviewer =
    (c.status === "jm_ae" && me.role === "assistant_engineer") ||
    (c.status === "jm_see" && me.role === "senior_elec_engineer");
  const canSchedule =
    (c.status === "jm_requested" || c.status === "jm_scheduled") &&
    (me.role === "assistant_engineer" || me.role === "senior_elec_engineer");
  const jmReady = files.some((x) => x.kind === "jm_sheet");
  const ready =
    files.some((x) => x.kind === "ipc_draft") &&
    files.some((x) => x.kind === "ipc_measure") &&
    vars.every((x) => varFiles.some((f) => f.entity_id === x.id));
  const canRecord =
    (c.status === "verified" ||
      c.status === "approved" ||
      c.status === "paid") &&
    (c.prepared_by === me.id ||
      me.role === "assistant_engineer" ||
      me.role === "senior_elec_engineer" ||
      me.role === "sub_supervisor");
  const run = (fn: string, args: Record<string, unknown>, ok: string) =>
    dialog.run(async () => {
      await rpc(fn, args);
      await reload();
    }, ok);

  const schedule = async () => {
    const r = await dialog.prompt({
      title: "Confirm the joint measurement",
      message: c.jm_scope ?? undefined,
      fields: [
        {
          key: "d",
          label: "Date",
          type: "date",
          required: true,
          initial: c.jm_date ?? c.jm_requested_date ?? todayISO(),
        },
        { key: "n", label: "Note (time, who attends)", type: "multiline" },
      ],
      confirmLabel: "Confirm",
    });
    if (r)
      await run(
        "schedule_joint_measurement",
        { p_id: c.id, p_date: r.d, p_note: r.n || null },
        "Confirmed – the subcontractor is told",
      );
  };
  const decideJm = async (ok: boolean) => {
    const r = await dialog.prompt({
      title: ok
        ? c.status === "jm_ae"
          ? "Checked – goes to the Senior Electrical Engineer"
          : "Approve the joint measurement – the IPC can then be prepared"
        : "Return with comments",
      message: ok
        ? c.status === "jm_see"
          ? "The red-marked copies are removed once you approve."
          : undefined
        : marked.length
          ? "Your marked-up copy goes with it."
          : "Tip: mark your comments in red on the sheets first (✎ Mark up), then return.",
      fields: [
        {
          key: "n",
          label: ok ? "Note (optional)" : "Reason",
          type: "multiline",
          required: !ok,
        },
      ],
      confirmLabel: ok ? "Approve" : "Return",
      danger: !ok,
    });
    if (r)
      await run(
        "decide_joint_measurement",
        { p_id: c.id, p_ok: ok, p_note: r.n || null },
        ok ? "Saved" : "Returned – the subcontractor is told",
      );
  };
  const edit = async () => {
    const r = await dialog.prompt({
      title: "Certificate figures",
      fields: [
        {
          key: "subcontractor",
          label: "Subcontractor",
          initial: c.subcontractor,
          required: true,
        },
        { key: "period", label: "Period", initial: c.period, required: true },
        {
          key: "gross",
          label: "Gross value of work done to date (LKR)",
          initial: String(c.gross),
          required: true,
        },
        {
          key: "previous",
          label: "Previously certified (LKR)",
          initial: String(c.previous),
        },
        {
          key: "retention_pct",
          label: "Retention %",
          initial: String(c.retention_pct),
        },
        {
          key: "deductions",
          label: "Other deductions (LKR)",
          initial: String(c.deductions),
        },
        {
          key: "note",
          label: "Note",
          type: "multiline",
          initial: c.note ?? "",
        },
      ],
      confirmLabel: "Save",
    });
    if (r) await run("update_sub_cert", { p_id: c.id, p: r }, "Saved");
  };
  const decide = async (ok: boolean) => {
    const pay = c.status === "approved";
    const r = await dialog.prompt({
      title: pay
        ? "Record the payment"
        : ok
          ? c.status === "ae_review"
            ? "Checked – goes to the Senior Electrical Engineer"
            : c.status === "prepared"
              ? "Interim Payment Approval (IPA) – the invoice can then be recorded"
              : "Approve"
          : "Return with comments",
      message: ok
        ? `${c.code} · net ${fmtMoney(c.net, "LKR")}`
        : marked.length
          ? "Your marked-up copy goes with it."
          : "Tip: mark your comments in red on the IPC or the sheets first (✎ Mark up), then return.",
      fields: [
        {
          key: "n",
          label: pay
            ? "Payment reference (cheque / transfer)"
            : ok
              ? "Note (optional)"
              : "Reason",
          type: pay ? undefined : "multiline",
          required: pay || !ok,
        },
      ],
      confirmLabel: pay ? "Paid" : ok ? "Approve" : "Return",
      danger: !ok,
    });
    if (r)
      await run(
        "advance_sub_cert",
        { p_id: c.id, p_ok: ok, p_note: r.n || null },
        ok ? "Saved" : "Returned – the preparer is told",
      );
  };

  return (
    <Screen maxWidth={900} onRefresh={reload}>
      <Stack.Screen options={{ title: c.code }} />
      <Card>
        <Row
          wrap
          style={{ justifyContent: "space-between", alignItems: "center" }}
        >
          <Text
            style={{ fontSize: 18, fontWeight: "700", color: colors.ink }}
          >{certTitle(c)}</Text>
          <Pill
            label={CERT_STATUS[c.status]}
            tone={certTone(c.status)}
            solid={c.status === "verified" || c.status === "returned"}
          />
        </Row>
        <Muted>{`${c.exec_projects?.code ?? ""} ${c.exec_projects?.name ?? ""}`}</Muted>
        <Row wrap gap={6} style={{ marginTop: 8 }}>
          {STEPS.filter(
            (s) =>
              !s.ae ||
              (s.ae === "jm"
                ? c.jm_ae_by || c.status === "jm_ae"
                : c.ae_by || c.status === "ae_review"),
          ).map((s) => (
            <Pill
              key={s.label}
              label={`${rank >= s.from ? "✓ " : ""}${s.label}`}
              tone={rank >= s.from ? colors.green : colors.grey}
            />
          ))}
        </Row>
        {jm ? (
          <Row wrap gap={16} style={{ marginTop: 8 }}>
            <KeyValue
              label="Proposed date"
              value={fmtDate(c.jm_requested_date)}
            />
            <KeyValue
              label="Joint measurement"
              value={
                c.jm_date
                  ? `${fmtDate(c.jm_date)}${c.jm_note ? ` · ${c.jm_note}` : ""}`
                  : "Not confirmed yet"
              }
            />
            <KeyValue
              label="Requested by"
              value={people[c.prepared_by]?.full_name ?? "—"}
            />
          </Row>
        ) : null}
        {c.jm_scope ? <Muted>{`Scope: ${c.jm_scope}`}</Muted> : null}
        {!jm ? (
          <Row wrap gap={16} style={{ marginTop: 8 }}>
            <KeyValue label="Gross to date" value={fmtMoney(c.gross, "LKR")} />
            <KeyValue
              label="Previously certified"
              value={fmtMoney(c.previous, "LKR")}
            />
            <KeyValue label="Retention" value={`${c.retention_pct}%`} />
            <KeyValue
              label="Deductions"
              value={fmtMoney(c.deductions, "LKR")}
            />
            <KeyValue label="Net" value={fmtMoney(c.net, "LKR")} />
            <KeyValue
              label="Prepared by"
              value={`${people[c.prepared_by]?.full_name ?? "—"}${c.revision ? ` · revision ${c.revision}` : ""}`}
            />
          </Row>
        ) : null}
        {c.note ? <Muted>{c.note}</Muted> : null}
        {editable ? (
          <Row style={{ marginTop: 8 }}>
            <Button
              small
              variant="secondary"
              title="Edit figures"
              onPress={edit}
            />
          </Row>
        ) : null}
      </Card>

      {c.status === "jm_requested" ? (
        <Notice tone={colors.amber}>
          Joint measurement requested – waiting for the Assistant Engineer / SEE
          to confirm the date. The upload buttons open after that.
        </Notice>
      ) : c.status === "jm_scheduled" ? (
        <Notice
          tone={colors.blue}
        >{`Joint measurement on ${fmtDate(c.jm_date)}. After it is done, upload the joint measurement sheets and submit them for approval (AE, then SEE). The IPC uploads open once they are approved.`}</Notice>
      ) : c.status === "jm_ae" || c.status === "jm_see" ? (
        <Notice
          tone={colors.amber}
        >{`Joint measurement sheets ${c.status === "jm_ae" ? "with the Assistant Engineer to check, then the Senior Electrical Engineer" : "with the Senior Electrical Engineer"} – submitted ${fmtDateTime(c.jm_submitted_at)}. The IPC uploads open once they are approved.`}</Notice>
      ) : c.status === "jm_returned" ? (
        <Notice
          tone={colors.red}
        >{`Joint measurement sheets returned: ${c.return_note ?? ""}\nSee the comments marked in red below, correct the sheets and submit again.`}</Notice>
      ) : c.status === "draft" ? (
        <Notice tone={colors.blue}>
          Joint measurement approved. Enter the IPC figures (Edit figures), attach the IPC and the measurement sheets, then submit for Interim
          Payment Approval (IPA). Until IPA it shows “IPA pending”; once approved it becomes the IPC and the invoice can be submitted.
        </Notice>
      ) : c.status === "ae_review" || c.status === "prepared" ? (
        <Notice tone={colors.amber}>
          {`IPA pending (Interim Payment Approval) – ${c.status === "ae_review" ? "with the Assistant Engineer to check, then the Senior Electrical Engineer" : "with the Senior Electrical Engineer"}. Submitted ${fmtDateTime(c.submitted_at)}. The SEE may comment / edit in red; once approved it becomes the IPC and the invoice can be submitted.`}
        </Notice>
      ) : c.status === "returned" ? (
        <Notice
          tone={colors.red}
        >{`Returned: ${c.return_note ?? ""}\nSee the comments marked in red below, correct the IPC / sheets and submit again.`}</Notice>
      ) : c.status === "verified" ||
        c.status === "approved" ||
        c.status === "paid" ? (
        <Notice tone={colors.green}>
          {`IPA approved by the Senior Electrical Engineer${c.verified_at ? ` on ${fmtDateTime(c.verified_at)}` : ""} – this is now the approved IPC (the documents below with the SEE's comments / edits in red). Submit the invoice according to this IPC.`}
        </Notice>
      ) : null}

      <DocSlot
        title="Joint measurement sheets"
        entity="sub_cert"
        entityId={c.id}
        kind="jm_sheet"
        files={files}
        canAdd={jmEditable}
        canMarkUp={jmReviewer}
        required={jmEditable}
        markupKind="jm_markup"
        onChange={reload}
      />

      {jm ? (
        <Card style={{ opacity: 0.6 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }}>
            🔒 IPC, measurement sheets and variations
          </Text>
          <Muted>
            Enabled once the joint measurement sheets are approved by the Senior
            Electrical Engineer.
          </Muted>
        </Card>
      ) : (
        <>
          <DocSlot
            title="IPC (payment certificate)"
            entity="sub_cert"
            entityId={c.id}
            kind="ipc_draft"
            files={files}
            canAdd={editable}
            canMarkUp={reviewer}
            required={editable}
            onChange={reload}
          />
          <DocSlot
            title="Measurement sheets"
            entity="sub_cert"
            entityId={c.id}
            kind="ipc_measure"
            files={files}
            canAdd={editable}
            canMarkUp={reviewer}
            required={editable}
            onChange={reload}
          />

          {vars.map((x) => (
            <DocSlot
              key={x.id}
              title={`Variation ${x.var_code} – ${x.var_title} (IPC / measurement sheets)`}
              entity="sub_cert_var"
              entityId={x.id}
              kind="ipc_var"
              files={varFiles}
              canAdd={editable}
              canMarkUp={reviewer}
              required={editable}
              markupEntity="sub_cert"
              markupId={c.id}
              onChange={reload}
            />
          ))}
        </>
      )}

      {marked.length ? (
        <Section title={c.status === "verified" || c.status === "approved" || c.status === "paid" ? "IPC – SEE's comments / edits" : "Comments marked on the copy"}>
          <Card
            style={{
              padding: 0,
              overflow: "hidden",
              borderColor: colors.red,
              borderWidth: 1,
            }}
          >
            {marked.map((f) => (
              <ListRow
                key={f.id}
                highlight={colors.red}
                title={
                  <Text style={{ color: colors.red, fontWeight: "700" }}>
                    {f.file_name}
                  </Text>
                }
                subtitle={`${people[f.uploaded_by]?.full_name ?? ""} · ${fmtDateTime(f.uploaded_at)}`}
                right={
                  <Button
                    small
                    variant="secondary"
                    title="Open"
                    onPress={() => dialog.run(() => openAttachment(f))}
                  />
                }
              />
            ))}
          </Card>
        </Section>
      ) : null}

      <Row wrap gap={8}>
        {canSchedule ? (
          <Button
            title={
              c.status === "jm_scheduled"
                ? "Change JM date"
                : "Confirm joint measurement"
            }
            variant={c.status === "jm_scheduled" ? "secondary" : undefined}
            onPress={schedule}
          />
        ) : null}
        {jmEditable ? (
          <Button
            title={
              c.status === "jm_returned"
                ? "Submit JM sheets again"
                : "Submit JM sheets for approval"
            }
            disabled={!jmReady}
            onPress={() =>
              run(
                "submit_joint_measurement",
                { p_id: c.id },
                "Submitted for approval",
              )
            }
          />
        ) : null}
        {jmReviewer ? (
          <Button
            title={
              c.status === "jm_ae"
                ? "Checked – send to the SEE"
                : "Approve joint measurement"
            }
            onPress={() => decideJm(true)}
          />
        ) : null}
        {jmReviewer ? (
          <Button
            variant="danger"
            title="Return with comments"
            onPress={() => decideJm(false)}
          />
        ) : null}
        {(editable ||
          jmEditable ||
          (c.status === "jm_requested" && preparer)) &&
        c.status !== "draft" &&
        c.status !== "returned" ? (
          <Button
            variant="ghost"
            title="Withdraw"
            onPress={async () => {
              if (
                await dialog.confirm("Withdraw this request?", undefined, {
                  confirmLabel: "Withdraw",
                  danger: true,
                })
              )
                await run("cancel_sub_cert", { p_id: c.id }, "Withdrawn");
            }}
          />
        ) : null}
        {editable ? (
          <Button
            title={
              c.status === "returned" ? "Submit again" : "Submit for approval"
            }
            disabled={!ready}
            onPress={async () => {
              if (
                await dialog.confirm(
                  "Submit the IPC?",
                  "It goes for checking and approval. You will be told here when it is approved and the invoice can be recorded.",
                  { confirmLabel: "Submit" },
                )
              )
                await run(
                  "submit_sub_cert",
                  { p_id: c.id },
                  "Submitted for approval",
                );
            }}
          />
        ) : null}
        {editable ? (
          <Button
            variant="ghost"
            title="Withdraw"
            onPress={async () => {
              if (
                await dialog.confirm("Withdraw this certificate?", undefined, {
                  confirmLabel: "Withdraw",
                  danger: true,
                })
              )
                await run("cancel_sub_cert", { p_id: c.id }, "Withdrawn");
            }}
          />
        ) : null}
        {reviewer ? (
          <Button
            title={
              c.status === "ae_review"
                ? "Checked – send to the SEE"
                : "Approve – IPA"
            }
            onPress={() => decide(true)}
          />
        ) : null}
        {reviewer ? (
          <Button
            variant="danger"
            title="Return with comments"
            onPress={() => decide(false)}
          />
        ) : null}
        {later ? (
          <Button
            title={c.status === "approved" ? "Record payment" : "Approve"}
            onPress={() => decide(true)}
          />
        ) : null}
        {later && c.status === "verified" ? (
          <Button
            variant="danger"
            title="Return"
            onPress={() => decide(false)}
          />
        ) : null}
        {canRecord ? (
          <Button
            title="+ Record invoice"
            onPress={() =>
              router.push({
                pathname: "/execution/sub-invoice/new",
                params: { project: c.exec_project_id, cert: c.id },
              })
            }
          />
        ) : null}
      </Row>
      {editable && !ready ? (
        <Muted>
          Attach the IPC and the measurement sheets (PDF or photos) to submit.
        </Muted>
      ) : null}

      {invoices.length ? (
        <Section title="Invoices against this IPC">
          <Card style={{ padding: 0, overflow: "hidden" }}>
            {invoices.map((v) => (
              <ListRow
                key={v.id}
                title={`${v.code} · invoice ${v.invoice_no}`}
                onPress={() => router.push(`/execution/sub-invoice/${v.id}`)}
              />
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
