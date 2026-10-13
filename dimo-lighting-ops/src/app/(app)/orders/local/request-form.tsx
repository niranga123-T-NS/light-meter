import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useDialog } from '@/components/dialog';
import { rpc } from '@/components/foreign/actions';
import { TestingBanner } from '@/components/Testing';
import { Button, Card, colors, DateField, ErrorBanner, Field, Loading, Muted, Notice, Row, Screen, Section, Select } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { todayIso } from '@/lib/foreignOrders';
import { useLoad, usePeople } from '@/lib/hooks';
import { LO_KEEPER, type LoRequest } from '@/lib/localOrders';
import { supabase } from '@/lib/supabase';

type Exec = { id: string; code: string | null; name: string; client_name: string | null; site_address: string | null; see_id: string | null };
type Won = { id: string; code: string | null; project_name: string; customer: string | null; sales_person_id: string | null };
type Mr = { id: string; code: string | null; purpose: string | null; required_date: string; exec_project_id: string };
const NONE = 'none';

/** New or edited local request: from the SEE (execution project, or a site material request the store cannot cover), Sales (supply project) or Ops. */
export default function LocalRequestForm() {
  const { id, mr } = useLocalSearchParams<{ id?: string; mr?: string }>();
  const me = useMe();
  const { data, error } = useLoad(async () => {
    const [e, w, r, m] = await Promise.all([
      supabase.from('exec_projects').select('id, code, name, client_name, site_address, see_id').eq('status', 'active').order('name'),
      supabase.from('secured_projects').select('id, code, project_name, customer, sales_person_id').neq('status', 'cancelled').order('won_on', { ascending: false }),
      id ? supabase.from('lo_requests').select('*').eq('id', id).single() : Promise.resolve({ data: null, error: null }),
      mr ? supabase.from('material_requests').select('id, code, purpose, required_date, exec_project_id').eq('id', mr).single() : Promise.resolve({ data: null, error: null }),
    ]);
    if (r.error) throw new Error(r.error.message);
    let execs = (e.data ?? []) as Exec[];
    let won = (w.data ?? []) as Won[];
    // the SEE raises requests for their own projects; Sales for their supply projects
    if (me.role === 'senior_elec_engineer') { execs = execs.filter((x) => x.see_id === me.id); won = []; }
    if (me.role === 'asm_building' || me.role === 'asm_infra') { execs = []; won = won.filter((x) => x.sales_person_id === me.id); }
    return { execs, won, r: (r.data ?? null) as LoRequest | null, mr: (m.data ?? null) as Mr | null };
  }, [id, mr, me.id]);
  if (!data) return <Screen>{error ? <ErrorBanner message={error} /> : <Loading />}</Screen>;
  return <Form {...data} />;
}

function Form({ execs, won, r, mr }: { execs: Exec[]; won: Won[]; r: LoRequest | null; mr: Mr | null }) {
  const dialog = useDialog();
  const me = useMe();
  const people = usePeople();
  const keeper = LO_KEEPER.includes(me.role);
  const [proj, setProj] = useState(r ? (r.exec_project_id ? `e:${r.exec_project_id}` : r.secured_id ? `s:${r.secured_id}` : NONE) : mr ? `e:${mr.exec_project_id}` : execs.length === 1 ? `e:${execs[0].id}` : '');
  const [name, setName] = useState(r?.project_name ?? '');
  const [client, setClient] = useState(r?.client ?? '');
  const [sales, setSales] = useState(r?.sales_person_id ?? '');
  const [title, setTitle] = useState(r?.title ?? '');
  const [kind, setKind] = useState<string>(r?.kind ?? 'material');
  const [details, setDetails] = useState(r?.details ?? '');
  const [quantity, setQuantity] = useState(r?.quantity ?? '');
  const [specs, setSpecs] = useState(r?.specs ?? '');
  const [required, setRequired] = useState<string | null>(r?.required_on ?? mr?.required_date ?? null);
  const [location, setLocation] = useState(r?.delivery_location ?? (execs.length === 1 ? execs[0].site_address ?? '' : ''));
  const [received, setReceived] = useState<string | null>(r?.received_on ?? todayIso());
  const [notes, setNotes] = useState(r?.notes ?? '');
  const salesOptions = Object.values(people)
    .filter((p) => p.active !== false && (p.role === 'asm_building' || p.role === 'asm_infra'))
    .map((p) => ({ value: p.id, label: p.full_name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const pick = (v: string) => {
    setProj(v);
    if (v.startsWith('e:')) {
      const e = execs.find((x) => x.id === v.slice(2));
      if (e?.site_address && !location) setLocation(e.site_address);
    } else if (v.startsWith('s:')) {
      const w = won.find((x) => x.id === v.slice(2));
      if (w) { setName(w.project_name); if (w.customer) setClient(w.customer); if (w.sales_person_id) setSales(w.sales_person_id); }
    }
  };
  const save = () =>
    dialog.run(async () => {
      if (!proj && !mr) throw new Error('Choose the project');
      const rid = (await rpc('lo_save_request', {
        p_id: r?.id ?? null,
        p: {
          mr_id: !r && mr ? mr.id : '',
          exec_project_id: proj.startsWith('e:') ? proj.slice(2) : '',
          secured_id: proj.startsWith('s:') ? proj.slice(2) : '',
          project_name: proj === NONE || proj.startsWith('s:') ? name : '',
          client: proj === NONE || proj.startsWith('s:') ? client : '',
          sales_person_id: sales,
          title,
          kind,
          details,
          quantity,
          specs,
          required_on: required ?? '',
          delivery_location: location,
          received_on: keeper ? received ?? '' : '',
          notes,
        },
      })) as string;
      router.replace(`/orders/local/r/${rid}`);
    }, r?.status === 'returned' ? 'Sent again to Operations' : 'Saved');

  const exec = proj.startsWith('e:');
  return (
    <Screen maxWidth={760}>
      <Stack.Screen options={{ title: r ? `Edit ${r.code}` : 'New local request' }} />
      <TestingBanner what="Local orders" always />
      {r?.status === 'returned' ? <Notice tone={colors.amber}>{`Returned by Operations: ${r.return_reason ?? ''} – complete it and save to send it again.`}</Notice> : null}
      <Muted>
        Materials or services to buy locally. Operations checks the technical details, quantity and specifications, raises the PR and follows it to delivery and payment.
      </Muted>
      {mr && !r ? <Notice tone={colors.blue}>{`From site material request ${mr.code ?? ''}${mr.purpose ? ` – ${mr.purpose}` : ''}: its items are copied as the quantity.`}</Notice> : null}
      <Card style={{ gap: 4 }}>
        {mr && !r ? null : (
          <Select
            label="Project"
            required
            searchable
            value={proj}
            onChange={pick}
            options={[
              ...execs.map((e) => ({ value: `e:${e.id}`, label: e.name, hint: e.code ?? undefined, group: 'Execution projects' })),
              ...won.map((w) => ({ value: `s:${w.id}`, label: `${w.project_name}${w.customer ? ` – ${w.customer}` : ''}`, hint: w.code ?? undefined, group: 'Supply projects (won orders)' })),
              ...(keeper ? [{ value: NONE, label: '— Not in the list – type it below —', group: 'Other' }] : []),
            ]}
          />
        )}
        {!exec && proj ? (
          <>
            <Field label="Project name" required value={name} onChangeText={setName} />
            <Field label="Client" value={client} onChangeText={setClient} />
            <Select label="Sales person" searchable value={sales} onChange={setSales} options={salesOptions} />
          </>
        ) : null}
      </Card>
      <Section title="What is needed">
        <Card style={{ gap: 4 }}>
          <Field label="Short title" required value={title} onChangeText={setTitle} placeholder={mr ? 'Taken from the material request if left empty' : 'e.g. Cable trays and pole erection'} />
          {mr && !r ? null : (
            <Select label="Material or service" required value={kind} onChange={setKind} options={[{ value: 'material', label: 'Material' }, { value: 'service', label: 'Service' }, { value: 'both', label: 'Material and service' }]} />
          )}
          <Field label="Technical details" multiline value={details} onChangeText={setDetails} hint="Operations checks these before raising the PR" />
          <Field label="Quantity" multiline value={quantity} onChangeText={setQuantity} placeholder={mr ? 'Copied from the material request if left empty' : 'e.g. 120 m trays, 12 poles'} />
          <Field label="Specifications" multiline value={specs} onChangeText={setSpecs} placeholder="e.g. 300 mm hot-dip galvanised; 8 m octagonal poles" />
          <DateField label="Required by" value={required} onChange={setRequired} />
          <Field label="Delivery / work location" required value={location} onChangeText={setLocation} />
          {keeper && !r ? <DateField label="Request received on" value={received} onChange={setReceived} /> : null}
          <Field label="Notes" multiline value={notes} onChangeText={setNotes} />
        </Card>
      </Section>
      <Row gap={8} style={{ justifyContent: 'flex-end' }}>
        <Button variant="ghost" title="Cancel" onPress={() => router.back()} />
        <Button title={r ? (r.status === 'returned' ? 'Save and send again' : 'Save') : 'Send to Operations'} onPress={save} />
      </Row>
    </Screen>
  );
}
