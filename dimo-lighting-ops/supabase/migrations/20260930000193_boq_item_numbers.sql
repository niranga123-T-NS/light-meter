-- BOQ item numbers read from Excel formulas carried floating-point noise ("1.2000000000000002"): store them as written ("1.2").
-- The upload now cleans them; this fixes the BOQs already uploaded.
update public.exec_boq_items
   set item_no = regexp_replace(round(item_no::numeric, 6)::text, '\.?0+$', '')
 where item_no ~ '^\d+\.\d{8,}$';
