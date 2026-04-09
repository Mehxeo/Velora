create table if not exists public.velora_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.velora_user_state enable row level security;

create policy "Users can read own state"
on public.velora_user_state
for select
using (auth.uid() = user_id);

create policy "Users can upsert own state"
on public.velora_user_state
for insert
with check (auth.uid() = user_id);

create policy "Users can update own state"
on public.velora_user_state
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- ─── Shared Conversations ───────────────────────────────────────────────────

create table if not exists public.shared_conversations (
  id uuid primary key default gen_random_uuid(),
  conversation jsonb not null,
  created_at timestamptz not null default now(),
  shared_by_email text
);

alter table public.shared_conversations enable row level security;

create policy "Anyone can read shared conversations"
on public.shared_conversations
for select
using (true);

create policy "Anyone can create shared conversations"
on public.shared_conversations
for insert
with check (true);
