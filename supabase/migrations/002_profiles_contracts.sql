-- ── Profiles table ───────────────────────────────────────────────────────────
create table if not exists profiles (
  id uuid references auth.users primary key,
  full_name text,
  business_name text,
  country text default 'AU',
  abn text,
  gstin text,
  pan text,
  address text,
  jurisdiction text,
  entity_type text,
  industry text,
  onboarding_complete boolean default false,
  created_at timestamptz default now()
);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- ── Contracts table ───────────────────────────────────────────────────────────
create table if not exists contracts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users,
  contract_type text,
  jurisdiction text,
  country text,
  status text default 'draft',
  party_a jsonb,
  party_b jsonb,
  assembled_document text,
  fairness_score numeric,
  risk_flags jsonb,
  signing_token text unique default gen_random_uuid()::text,
  signing_expires_at timestamptz,
  sent_at timestamptz,
  opened_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz default now()
);

alter table contracts enable row level security;

create policy "Users can view own contracts"
  on contracts for select using (auth.uid() = user_id);

create policy "Users can insert own contracts"
  on contracts for insert with check (auth.uid() = user_id or user_id is null);

create policy "Anyone can view by signing token"
  on contracts for select using (signing_token is not null);
