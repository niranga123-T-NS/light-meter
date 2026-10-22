-- Foreign orders: DP (documents against payment) as a payment term besides TT and LC

alter table public.fo_orders drop constraint if exists fo_orders_payment_check;
alter table public.fo_orders add constraint fo_orders_payment_check check (payment in ('TT', 'LC', 'DP'));

do $$
declare def text; before text;
begin
  def := pg_get_functiondef('public.fo_save_order(uuid, jsonb)'::regprocedure);
  before := def;
  def := replace(def, 'in (''TT'', ''LC''), ''Payment: TT or LC''', 'in (''TT'', ''LC'', ''DP''), ''Payment: TT, LC or DP''');
  perform app.require(def <> before, 'fo_save_order: payment check not found');
  execute def;
end $$;

select app.fix_function_owners();
