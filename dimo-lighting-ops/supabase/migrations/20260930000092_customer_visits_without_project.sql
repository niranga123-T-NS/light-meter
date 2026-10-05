-- Customer-level visits have no project yet: new leads, customer introductions, relationship visits and company
-- presentations can be recorded against the customer alone (tag 'networking' = project not needed).
-- (seed.sql carries the same tags, so a later seed keeps them.)
update public.master_lists set tags = array(select distinct unnest(tags || array['networking']))
 where list_name = 'visit_objective'
   and value in ('New Lead Identification', 'New Customer Introduction', 'Existing Customer Relationship', 'Corporate / Capability Presentation');
