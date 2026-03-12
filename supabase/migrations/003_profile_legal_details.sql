-- ── Additional legal identity fields for profiles ────────────────────────────
alter table profiles
  add column if not exists phone text,
  add column if not exists street_address text,
  add column if not exists city text,
  add column if not exists postcode text,
  add column if not exists acn text,
  add column if not exists signatory_name text,
  add column if not exists signatory_title text,
  add column if not exists email text;

-- ── Update contracts table to include dispute_resolution ─────────────────────
alter table contracts
  add column if not exists dispute_resolution text default 'courts';
