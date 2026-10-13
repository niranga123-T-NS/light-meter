import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, DateField, ErrorBanner, Field, Loading, Muted, Row, Screen, Section, Select } from '@/components/ui';
import { todayIso, type Handover } from '@/lib/foreignOrders';
import { useLoad, usePeople } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

type Exec = { id: string; project_id: string | null; code: string | null; name: string; client_name: string | null; site_address: string | null };
type Won = { id: string; code: string | null; project_name: string; customer: string | null; sales_person_id: string | null; project_id: string | null; won_on: string; status: string };
type Ho = Handover & { exec_project_id: string | null; secured_id: string | null };
const NONE = 'none';

/** New or edited import request (Ops), from the Estimation Manager's e-mail. Picking the execution project fills in the project and the client. */
export default function HandoverForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data, error } = useLoad(async () => {
    const [e, w, h] = await Promise.all([
      supabase.from('exec_projects').select('id, project_id, code, name, client_name, site_address').order('name'),
      supabase.from('secured_projects').select('id, code, project_name, customer, sales_person_id, project_id, won_on, status').neq('status', 'cancelled').order('won_on', { ascending: false }),
      id ? supabase.from('fo_handovers').select('*').eq('id', id).single() : Promise.resolve({ data: null, error: null }),
    ]);
    if (h.error) throw new Error(h.error.message);
    return { execs: (e.data ?? []) as Exec[], won: (w.data ?? []) as Won[], h: (h.data ?? null) as Ho | null };
  }, [id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  return <Form execs={data.execs} won={data.won} h={data.h} />;
}

function Form({ execs, won, h }: { execs: Exec[]; won: Won[]; h: Ho | null }) {
  const dialog = useDialog();
  const people = usePeople();
  const [exec, setExec] = useState(h ? (h.secured_id ? `s:${h.secured_id}` : h.exec_project_id ? `e:${h.exec_project_id}` : NONE) : '');
  const [name, setName] = useState(h?.project_name ?? '');
  const [client, setClient] = useState(h?.client ?? '');
  const [sales, setSales] = useState(h?.sales_person_id ?? '');
  const [received, setReceived] = useState<string | null>(h?.received_on ?? todayIso());
  const [pi, setPi] = useState(h?.pi_ref ?? '');
  const [clientNew, setClientNew] = useState(h?.client_new ? 'no' : 'yes');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState(h?.notes ?? '');
  const salesOptions = Object.values(people)
    .filter((p) => p.active !== false && (p.role === 'asm_building' || p.role === 'asm_infra'))
    .map((p) => ({ value: p.id, label: p.full_name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const pick = (v: string) => {
    setExec(v);
    if (v.startsWith('s:')) {
      const w = won.find((x) => x.id === v.slice(2));
      if (!w) return;
      setName(w.project_name);
      if (w.customer) setClient(w.customer);
      if (w.sales_person_id) setSales(w.sales_person_id);
      const e = w.project_id ? execs.find((x) => x.project_id === w.project_id) : null;
      if (!h && e?.site_address && !location) setLocation(e.site_address);
    } else if (v.startsWith('e:')) {
      const e = execs.find((x) => x.id === v.slice(2));
      if (!e) return;
      setName(e.name);
      if (e.client_name) setClient(e.client_name);
      if (!h && e.site_address && !location) setLocation(e.site_address);
    }
  };
  const save = () =>
    dialog.run(async () => {
      if (!exec) throw new Error('Choose the won order or execution project, or "Not in the list"');
      const hid = (await rpc('fo_save_handover', {
        p_id: h?.id ?? null,
        p: {
          secured_id: exec.startsWith('s:') ? exec.slice(2) : '',
          exec_project_id: exec.startsWith('e:') ? exec.slice(2) : '',
          project_name: name,
          client,
          sales_person_id: sales,
          received_on: received ?? '',
          pi_ref: pi,
          client_new: clientNew === 'no',
          delivery_location: location,
          notes,
        },
      })) as string;
      router.replace(`/orders/foreign/ho/${hid}`);
    }, 'Saved');

  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: h ? `Edit ${h.code}` : 'New import request' }} />
      <TestingBanner what="Foreign orders" always />
      <Muted>From the Estimation Manager’s import request e-mail (PI and costing). Split it into import orders on the next page.</Muted>
      <Card style={{ gap: 4 }}>
        <Select
          label="Project"
          required
          searchable
          value={exec}
          onChange={pick}
          options={[
            ...won.map((w) => ({ value: `s:${w.id}`, label: `${w.project_name}${w.customer ? ` – ${w.customer}` : ''}`, hint: w.code ?? undefined, group: 'Won orders (Secured)' })),
            ...execs.map((e) => ({ value: `e:${e.id}`, label: e.name, hint: e.code ?? undefined, group: 'Execution projects' })),
            { value: NONE, label: '— Not in the list – type it below —', group: 'Other' },
          ]}
          hint="A won order fills in the project, client and sales person (supply-only orders too). An execution project also links the project’s SEE."
        />
        <Field label="Project name" required value={name} onChangeText={setName} />
        <Field label="Client" required value={client} onChangeText={setClient} />
        <Select label="Sales person" required searchable value={sales} onChange={setSales} options={salesOptions} />
      </Card>
      <Section title="Import request">
        <Card style={{ gap: 4 }}>
          <DateField label="Import request received on" required value={received} onChange={setReceived} />
          <Field label="PI no." value={pi} onChangeText={setPi} />
          <Select label="Client registered in SAP?" value={clientNew} onChange={setClientNew} options={[{ value: 'yes', label: 'Yes – already in SAP' }, { value: 'no', label: 'No – request the details from Sales' }]} />
          {h ? null : (
            <Field label="Final delivery location" required value={location} onChangeText={setLocation} hint="Changed later only with SM Projects and SM Estimation approval" />
          )}
          <Field label="Notes" multiline value={notes} onChangeText={setNotes} />
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" title="Cancel" onPress={() => router.back()} />
        <Button title={h ? 'Save' : 'Create import request'} onPress={save} />
      </Row>
    </Screen>
  );
}
