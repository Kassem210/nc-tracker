-- NC-Tracker: Datenbank einrichten
-- In Supabase: SQL Editor -> New query -> alles einfügen -> Run.
-- Direkter Tabellenzugriff ist gesperrt; die App nutzt nur die Funktionen unten.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key,
  secret_hash text not null,
  name text not null check (char_length(name) between 1 and 40),
  scale text not null default 'noten' check (scale in ('noten', 'punkte')),
  subjects jsonb not null default '[]'::jsonb,
  nc numeric(3,2),
  show_grades boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.groups (
  code text primary key,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  group_code text references public.groups(code) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_code, profile_id)
);

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.memberships enable row level security;
-- Keine Policies = kein direkter Zugriff. Alles läuft über die Funktionen.

create or replace function public._hash(p text) returns text
language sql immutable as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;

create or replace function public._check(p_id uuid, p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = p_id and secret_hash = _hash(p_secret)) then
    raise exception 'Profil nicht gefunden oder falscher Schlüssel';
  end if;
end $$;

-- Profil anlegen oder speichern
create or replace function public.save_profile(
  p_id uuid, p_secret text, p_name text, p_scale text,
  p_subjects jsonb, p_nc numeric, p_show boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(p_secret) < 20 then raise exception 'Schlüssel zu kurz'; end if;
  if pg_column_size(p_subjects) > 60000 then raise exception 'Zu viele Daten'; end if;
  if exists (select 1 from profiles where id = p_id) then
    perform _check(p_id, p_secret);
    update profiles set name = trim(p_name), scale = p_scale, subjects = p_subjects,
      nc = p_nc, show_grades = p_show, updated_at = now()
    where id = p_id;
  else
    insert into profiles (id, secret_hash, name, scale, subjects, nc, show_grades)
    values (p_id, _hash(p_secret), trim(p_name), p_scale, p_subjects, p_nc, p_show);
  end if;
end $$;

create or replace function public.load_profile(p_id uuid, p_secret text)
returns table (name text, scale text, subjects jsonb, show_grades boolean)
language plpgsql security definer set search_path = public as $$
begin
  perform _check(p_id, p_secret);
  return query select p.name, p.scale, p.subjects, p.show_grades from profiles p where p.id = p_id;
end $$;

create or replace function public.create_group(p_id uuid, p_secret text, p_name text)
returns text
language plpgsql security definer set search_path = public as $$
declare c text;
begin
  perform _check(p_id, p_secret);
  loop
    c := upper(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=0O1Il', ''), 1, 6));
    exit when length(c) = 6 and not exists (select 1 from groups where code = c);
  end loop;
  insert into groups (code, name) values (c, trim(p_name));
  insert into memberships (group_code, profile_id) values (c, p_id);
  return c;
end $$;

create or replace function public.join_group(p_id uuid, p_secret text, p_code text)
returns text
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  perform _check(p_id, p_secret);
  select name into n from groups where code = upper(trim(p_code));
  if n is null then raise exception 'Gruppe nicht gefunden'; end if;
  insert into memberships (group_code, profile_id) values (upper(trim(p_code)), p_id)
  on conflict do nothing;
  return n;
end $$;

create or replace function public.leave_group(p_id uuid, p_secret text, p_code text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _check(p_id, p_secret);
  delete from memberships where group_code = upper(p_code) and profile_id = p_id;
end $$;

create or replace function public.my_groups(p_id uuid, p_secret text)
returns table (code text, name text, members bigint)
language plpgsql security definer set search_path = public as $$
begin
  perform _check(p_id, p_secret);
  return query
    select g.code, g.name, (select count(*) from memberships m2 where m2.group_code = g.code)
    from groups g join memberships m on m.group_code = g.code
    where m.profile_id = p_id order by m.joined_at;
end $$;

-- Rangliste: nur für Mitglieder der Gruppe sichtbar
create or replace function public.leaderboard(p_id uuid, p_secret text, p_code text)
returns table (id uuid, name text, nc numeric, subjects jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform _check(p_id, p_secret);
  if not exists (select 1 from memberships where group_code = upper(p_code) and profile_id = p_id) then
    raise exception 'Du bist nicht in dieser Gruppe';
  end if;
  return query
    select p.id, p.name, p.nc,
      case when p.show_grades or p.id = p_id then p.subjects else '[]'::jsonb end,
      p.updated_at
    from profiles p join memberships m on m.profile_id = p.id
    where m.group_code = upper(p_code)
    order by p.nc asc nulls last;
end $$;

revoke all on function public._check(uuid, text) from public, anon, authenticated;
grant execute on function public.save_profile, public.load_profile, public.create_group,
  public.join_group, public.leave_group, public.my_groups, public.leaderboard to anon, authenticated;
