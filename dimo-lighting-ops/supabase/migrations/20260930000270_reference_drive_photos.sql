-- Project references: photos from Google Drive as well as uploads.
--  * A photo is either an uploaded file in the "references" bucket (ref/<reference id>/<file>) or a Google Drive file shared
--    "Anyone with the link", kept as gdrive:<file id> and shown straight from Drive (no Drive login or API key needed).
--  * Up to 12 photos a reference (was 4); the first is the cover.
--  * album_url: an optional link to the full photo album (a Google Drive folder), opened from the reference page.

alter table public.project_references drop constraint if exists project_references_photos_check;
alter table public.project_references add constraint project_references_photos_check check (coalesce(array_length(photos, 1), 0) <= 12);

create or replace function app.reference_photos_ok(p text[]) returns boolean
language sql immutable as $$ select coalesce(bool_and(x ~ '^ref/[0-9a-f-]{36}/[^/]+$' or x ~ '^gdrive:[A-Za-z0-9_-]{20,80}$'), true) from unnest(p) x $$;
alter table public.project_references drop constraint if exists project_references_photo_kinds;
alter table public.project_references add constraint project_references_photo_kinds check (app.reference_photos_ok(photos));

alter table public.project_references add column if not exists album_url text;
alter table public.project_references drop constraint if exists project_references_album_url;
alter table public.project_references add constraint project_references_album_url check (album_url is null or (album_url ~ '^https://' and length(album_url) <= 500));

select app.fix_function_owners();
