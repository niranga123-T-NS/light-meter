-- Edge Functions run as service_role. Triggers on profiles (and other tables) call helpers in the
-- internal "app" schema, so service_role needs the same access as signed-in users.
grant usage on schema app to service_role;
grant execute on all functions in schema app to service_role;
grant select, insert, update, delete on all tables in schema app to service_role;
alter default privileges in schema app grant execute on functions to service_role;
alter default privileges in schema app grant select, insert, update, delete on tables to service_role;
