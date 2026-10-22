-- Reiseplan: Tabelle für Reisen pro Benutzer
-- Einmal im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen.

create table if not exists public.trips (
  user_id    uuid        not null references auth.users(id) on delete cascade default auth.uid(),
  id         text        not null,
  data       jsonb       not null,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.trips enable row level security;

-- Jeder sieht und ändert nur seine eigenen Reisen
drop policy if exists "eigene Reisen lesen" on public.trips;
drop policy if exists "eigene Reisen anlegen" on public.trips;
drop policy if exists "eigene Reisen ändern" on public.trips;
drop policy if exists "eigene Reisen löschen" on public.trips;
create policy "eigene Reisen lesen"   on public.trips for select using (auth.uid() = user_id);
create policy "eigene Reisen anlegen" on public.trips for insert with check (auth.uid() = user_id);
create policy "eigene Reisen ändern"  on public.trips for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "eigene Reisen löschen" on public.trips for delete using (auth.uid() = user_id);

-- Live-Abgleich zwischen Geräten
do $$ begin
  alter publication supabase_realtime add table public.trips;
exception when duplicate_object then null; end $$;
