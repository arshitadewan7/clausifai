-- Migration: 003_contract_versions.sql
-- Adds version control for all contracts (generated, uploaded, proofread)

create table public.contract_versions (
  id uuid not null default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  version_number integer not null default 1,
  label text null,
  content text not null,
  source text not null default 'uploaded', -- 'generated' | 'uploaded' | 'proofread'
  fix_changelog jsonb null, -- only populated for 'proofread' source
  -- fix_changelog shape: [{ span, suggestion, type, severity }]
  created_at timestamp with time zone null default now(),
  constraint contract_versions_pkey primary key (id),
  constraint contract_versions_source_check check (source in ('generated', 'uploaded', 'proofread'))
) tablespace pg_default;

create index if not exists contract_versions_contract_id_idx
  on public.contract_versions using btree (contract_id) tablespace pg_default;

create index if not exists contract_versions_created_at_idx
  on public.contract_versions using btree (created_at desc) tablespace pg_default;