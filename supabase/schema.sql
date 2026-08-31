create extension if not exists pgcrypto;

-- Clean install only. If you already have data, do not run this file blindly.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nombre)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(coalesce(new.email,''),'@',1), 'Usuario'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  codigo_invitacion text not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  rol text not null default 'miembro' check (rol in ('miembro','admin')),
  joined_at timestamptz not null default now(),
  primary key(group_id,user_id)
);
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  nombre text not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  created_at timestamptz not null default now(),
  check(fecha_fin >= fecha_inicio)
);
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  dias_carrera_semana int not null default 0 check(dias_carrera_semana >= 0),
  dias_fuerza_semana int not null default 0 check(dias_fuerza_semana >= 0),
  created_at timestamptz not null default now(),
  unique(season_id,user_id)
);
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  tipo text not null check(tipo in ('carrera','fuerza')),
  fecha date not null,
  duracion_minutos int not null check(duracion_minutos > 0),
  captura_url text not null,
  estado text not null default 'pendiente' check(estado in ('pendiente','aprobado','rechazado')),
  motivo_rechazo text,
  validado_por uuid references public.profiles(id),
  validado_en timestamptz,
  created_at timestamptz not null default now(),
  check((tipo='carrera' and duracion_minutos>=40) or (tipo='fuerza' and duracion_minutos>=50))
);
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  fecha date not null default current_date,
  nota text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create table if not exists public.settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  season_id uuid not null references public.seasons(id),
  semana_inicio date not null,
  importe numeric(6,2) not null check(importe>=0),
  unique(settlement_id,user_id,season_id,semana_inicio)
);

create index if not exists idx_gm_user on public.group_members(user_id);
create index if not exists idx_seasons_group on public.seasons(group_id);
create index if not exists idx_workouts_user_date on public.workouts(user_id,fecha);
create index if not exists idx_workouts_season on public.workouts(season_id);

create or replace function public.is_group_member(gid uuid) returns boolean
language sql security definer stable set search_path=public as $$
 select exists(select 1 from public.group_members where group_id=gid and user_id=auth.uid());
$$;
create or replace function public.is_group_admin(gid uuid) returns boolean
language sql security definer stable set search_path=public as $$
 select exists(select 1 from public.group_members where group_id=gid and user_id=auth.uid() and rol='admin');
$$;
create or replace function public.season_group(sid uuid) returns uuid
language sql security definer stable set search_path=public as $$ select group_id from public.seasons where id=sid; $$;
create or replace function public.is_season_member(sid uuid) returns boolean
language sql security definer stable set search_path=public as $$ select public.is_group_member(public.season_group(sid)); $$;
create or replace function public.is_season_admin(sid uuid) returns boolean
language sql security definer stable set search_path=public as $$ select public.is_group_admin(public.season_group(sid)); $$;
create or replace function public.settlement_group(sid uuid) returns uuid
language sql security definer stable set search_path=public as $$ select group_id from public.settlements where id=sid; $$;

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.seasons enable row level security;
alter table public.challenges enable row level security;
alter table public.workouts enable row level security;
alter table public.settlements enable row level security;
alter table public.settlement_items enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated using(public.is_group_member(id));
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated with check(created_by=auth.uid());
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated using(public.is_group_admin(id)) with check(public.is_group_admin(id));

drop policy if exists gm_select on public.group_members;
create policy gm_select on public.group_members for select to authenticated using(public.is_group_member(group_id));
drop policy if exists gm_insert on public.group_members;
create policy gm_insert on public.group_members for insert to authenticated with check(public.is_group_admin(group_id) or user_id=auth.uid());
drop policy if exists gm_update on public.group_members;
create policy gm_update on public.group_members for update to authenticated using(public.is_group_admin(group_id)) with check(public.is_group_admin(group_id));
drop policy if exists gm_delete on public.group_members;
create policy gm_delete on public.group_members for delete to authenticated using(public.is_group_admin(group_id) or user_id=auth.uid());

drop policy if exists seasons_select on public.seasons;
create policy seasons_select on public.seasons for select to authenticated using(public.is_group_member(group_id));
drop policy if exists seasons_insert on public.seasons;
create policy seasons_insert on public.seasons for insert to authenticated with check(public.is_group_admin(group_id));
drop policy if exists seasons_update on public.seasons;
create policy seasons_update on public.seasons for update to authenticated using(public.is_group_admin(group_id)) with check(public.is_group_admin(group_id));

drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges for select to authenticated using(public.is_season_member(season_id));
drop policy if exists challenges_insert on public.challenges;
create policy challenges_insert on public.challenges for insert to authenticated with check(user_id=auth.uid() and public.is_season_member(season_id));
drop policy if exists challenges_update on public.challenges;
create policy challenges_update on public.challenges for update to authenticated using(user_id=auth.uid() and public.is_season_member(season_id)) with check(user_id=auth.uid() and public.is_season_member(season_id));

drop policy if exists workouts_select on public.workouts;
create policy workouts_select on public.workouts for select to authenticated using(public.is_season_member(season_id));
drop policy if exists workouts_insert on public.workouts;
create policy workouts_insert on public.workouts for insert to authenticated with check(user_id=auth.uid() and public.is_season_member(season_id));
drop policy if exists workouts_update_own on public.workouts;
create policy workouts_update_own on public.workouts for update to authenticated using(user_id=auth.uid() and estado='pendiente' and public.is_season_member(season_id)) with check(user_id=auth.uid() and public.is_season_member(season_id));
drop policy if exists workouts_update_admin on public.workouts;
create policy workouts_update_admin on public.workouts for update to authenticated using(public.is_season_admin(season_id)) with check(public.is_season_admin(season_id));
drop policy if exists workouts_delete on public.workouts;
create policy workouts_delete on public.workouts for delete to authenticated using(user_id=auth.uid() and estado='pendiente');

drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements for select to authenticated using(public.is_group_member(group_id));
drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements for insert to authenticated with check(created_by=auth.uid() and public.is_group_admin(group_id));
drop policy if exists settlements_update on public.settlements;
create policy settlements_update on public.settlements for update to authenticated using(public.is_group_admin(group_id)) with check(public.is_group_admin(group_id));
drop policy if exists settlements_delete on public.settlements;
create policy settlements_delete on public.settlements for delete to authenticated using(public.is_group_admin(group_id));

drop policy if exists settlement_items_select on public.settlement_items;
create policy settlement_items_select on public.settlement_items for select to authenticated using(public.is_group_member(public.settlement_group(settlement_id)));
drop policy if exists settlement_items_insert on public.settlement_items;
create policy settlement_items_insert on public.settlement_items for insert to authenticated with check(
  public.is_group_admin(public.settlement_group(settlement_id))
  and public.is_season_member(season_id)
  and public.season_group(season_id)=public.settlement_group(settlement_id)
);

-- Deuda: genera todas las semanas del trimestre y cuenta solo entrenamientos aprobados.
drop view if exists public.v_deuda_pendiente;
drop view if exists public.v_deuda_semanal;
create view public.v_deuda_semanal as
with weeks as (
  select c.season_id,c.user_id,gs::date as semana_inicio,
         c.dias_carrera_semana,c.dias_fuerza_semana
  from public.challenges c
  join public.seasons s on s.id=c.season_id
  cross join lateral generate_series(
    date_trunc('week', s.fecha_inicio::timestamp)::date,
    date_trunc('week', s.fecha_fin::timestamp)::date,
    interval '7 days') gs
), counts as (
 select w.season_id,w.user_id,w.semana_inicio,w.dias_carrera_semana,w.dias_fuerza_semana,
   count(*) filter(where wo.tipo='carrera' and wo.estado='aprobado') carreras,
   count(*) filter(where wo.tipo='fuerza' and wo.estado='aprobado') fuerza
 from weeks w left join public.workouts wo
 on wo.season_id=w.season_id and wo.user_id=w.user_id and date_trunc('week',wo.fecha::timestamp)::date=w.semana_inicio
 group by w.season_id,w.user_id,w.semana_inicio,w.dias_carrera_semana,w.dias_fuerza_semana
)
select season_id,user_id,semana_inicio,
 greatest(0,dias_carrera_semana-carreras) dias_carrera_fallados,
 greatest(0,dias_fuerza_semana-fuerza) dias_fuerza_fallados,
 greatest(0,dias_carrera_semana-carreras)+greatest(0,dias_fuerza_semana-fuerza) dias_totales_fallados,
 (greatest(0,dias_carrera_semana-carreras)+greatest(0,dias_fuerza_semana-fuerza))*5 importe_deuda
from counts;
create view public.v_deuda_pendiente as
select d.season_id,d.user_id,d.semana_inicio,d.importe_deuda,
 coalesce(sum(si.importe),0) importe_saldado,
 greatest(0,d.importe_deuda-coalesce(sum(si.importe),0)) importe_pendiente
from public.v_deuda_semanal d left join public.settlement_items si
on si.user_id=d.user_id and si.season_id=d.season_id and si.semana_inicio=d.semana_inicio
where d.importe_deuda>0
group by d.season_id,d.user_id,d.semana_inicio,d.importe_deuda;

grant select on public.v_deuda_semanal, public.v_deuda_pendiente to authenticated;

-- Storage: crea el bucket desde Dashboard > Storage > New bucket > capturas > Private.
-- Estas policies pueden ejecutarse después de crear el bucket.
drop policy if exists capturas_insert on storage.objects;
create policy capturas_insert on storage.objects for insert to authenticated
with check(bucket_id='capturas' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists capturas_select on storage.objects;
create policy capturas_select on storage.objects for select to authenticated
using(bucket_id='capturas' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists capturas_delete on storage.objects;
create policy capturas_delete on storage.objects for delete to authenticated
using(bucket_id='capturas' and (storage.foldername(name))[1]=auth.uid()::text);
