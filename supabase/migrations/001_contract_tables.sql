-- Enable pgvector extension
create extension if not exists vector;

-- ── Clauses table ─────────────────────────────────────────────────────────────
-- Stores lawyer-vetted clause templates with vector embeddings for similarity search
create table if not exists clauses (
  id            uuid primary key default gen_random_uuid(),
  contract_type text not null,   -- 'service_agreement' | 'nda' | 'sla' | 'employment' | 'partnership' | 'lease'
  clause_type   text not null,   -- 'payment' | 'ip' | 'termination' | 'confidentiality' | 'scope' | etc.
  jurisdiction  text,            -- 'AU' | 'US' | 'UK' | null (generic)
  content       text not null,
  embedding     vector(1536),    -- OpenAI text-embedding-3-small dimensions
  created_at    timestamptz default now()
);

create index if not exists clauses_contract_type_idx on clauses(contract_type);
create index if not exists clauses_embedding_idx on clauses using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Similarity search function
create or replace function match_clauses(
  query_embedding   vector(1536),
  contract_type_filter text,
  match_threshold   float default 0.5,
  match_count       int   default 12
)
returns table (
  id          uuid,
  clause_type text,
  content     text,
  similarity  float
)
language sql stable
as $$
  select
    id,
    clause_type,
    content,
    1 - (embedding <=> query_embedding) as similarity
  from clauses
  where
    contract_type = contract_type_filter
    and 1 - (embedding <=> query_embedding) > match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- ── Contracts table ───────────────────────────────────────────────────────────
create table if not exists contracts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,            -- null until auth is added
  prompt        text not null,
  intent        jsonb,
  content       text,
  risk_analysis jsonb,
  status        text default 'draft',  -- 'draft' | 'sent' | 'signed'
  created_at    timestamptz default now()
);

create index if not exists contracts_user_id_idx on contracts(user_id);
create index if not exists contracts_status_idx on contracts(status);
