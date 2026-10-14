-- The scheduled checks (flights, vessels, exchange rates, holidays) call their public functions with the project's public
-- key (role anon) and a shared secret. Those functions run as their owner, but the hosted API now refuses the call with
-- "permission denied for schema app" for anon. Usage of the schema gives anon nothing by itself: the app functions stay
-- closed to it (only the API's own schema, public, is reachable over the API).
grant usage on schema app to anon;
