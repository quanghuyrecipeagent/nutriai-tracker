-- SPROUT grocery budget tracker — Supabase schema
-- Run this in your Supabase project's SQL editor (a NEW project,
-- separate from your macro tracker, is recommended).

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text default '',
  amount numeric not null default 0,
  category text not null default 'other',
  purchase_date date not null,       -- local calendar date, YYYY-MM-DD
  purchase_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists purchases_user_date_idx on purchases(user_id, purchase_date);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,               -- 'YYYY-MM'
  amount numeric not null default 0,
  label text default '',
  created_at timestamptz not null default now(),
  unique(user_id, month)
);

alter table purchases enable row level security;
alter table budgets enable row level security;

create policy "purchases_select_own" on purchases for select using (auth.uid() = user_id);
create policy "purchases_insert_own" on purchases for insert with check (auth.uid() = user_id);
create policy "purchases_update_own" on purchases for update using (auth.uid() = user_id);
create policy "purchases_delete_own" on purchases for delete using (auth.uid() = user_id);

create policy "budgets_select_own" on budgets for select using (auth.uid() = user_id);
create policy "budgets_insert_own" on budgets for insert with check (auth.uid() = user_id);
create policy "budgets_update_own" on budgets for update using (auth.uid() = user_id);
create policy "budgets_delete_own" on budgets for delete using (auth.uid() = user_id);
