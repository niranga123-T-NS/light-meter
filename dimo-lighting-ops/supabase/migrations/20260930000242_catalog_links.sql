-- Catalogues and data sheets by link: the manufacturer's PDF link is kept and the app shows it in a viewer (the server reads it
-- on demand and keeps nothing), so the files do not use the storage space. A file uploaded from a computer is still stored;
-- a stored copy of a file that came from a link can be removed and the link kept. IES files stay stored (DLux reads them).

alter table public.catalog_files alter column storage_path drop not null;
alter table public.catalog_files alter column file_name drop not null;
alter table public.catalog_files drop constraint if exists catalog_files_has_file;
alter table public.catalog_files add constraint catalog_files_has_file check (storage_path is not null or source_url is not null);
