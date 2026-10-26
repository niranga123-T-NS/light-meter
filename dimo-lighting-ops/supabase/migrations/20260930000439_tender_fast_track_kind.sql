-- Approval kind for the tender fast track (used by the next migration)
alter type public.approval_kind add value if not exists 'tender_fast_track';
