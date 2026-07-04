-- Halwani Food Service CRM - Cloud Backend
-- Run this once in Supabase SQL Editor before deploying the web app.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  employee_code text unique,
  full_name text not null default '',
  role text not null default 'salesperson' check (role in (
    'admin','head_of_food_service','national_manager','regional_manager','supervisor','salesperson'
  )),
  region text,
  branch text,
  manager_id uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text unique not null,
  name text not null,
  branch text,
  city text,
  area text,
  channel text,
  sub_channel text,
  contact_name text,
  mobile text,
  salesperson_id uuid references public.profiles(id) on delete set null,
  status text not null default 'active' check (status in ('active','inactive','approved','pending')),
  approval_code text,
  gross_sales_ytd numeric(14,2) not null default 0,
  monthly_average_gross_sales numeric(14,2) not null default 0,
  gps_lat double precision,
  gps_lng double precision,
  gps_radius_m integer not null default 20 check (gps_radius_m between 5 and 500),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique,
  brand text,
  category text,
  name text not null,
  pack_size text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.journey_plans (
  id uuid primary key default gen_random_uuid(),
  plan_month date not null,
  salesperson_id uuid not null references public.profiles(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  visit_date date not null,
  visit_time time,
  branch text,
  city text,
  area text,
  notes text,
  source text not null default 'import' check (source in ('import','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(plan_month, salesperson_id, customer_id, visit_date, visit_time)
);

create table if not exists public.collection_targets (
  id uuid primary key default gen_random_uuid(),
  target_month date not null,
  salesperson_id uuid not null references public.profiles(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  collection_target_sar numeric(14,2) not null default 0,
  sales_target_sar numeric(14,2) not null default 0,
  due_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(target_month, salesperson_id, customer_id)
);

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  salesperson_id uuid not null references public.profiles(id) on delete restrict,
  journey_plan_id uuid references public.journey_plans(id) on delete set null,
  status text not null default 'active' check (status in ('active','closed','cancelled')),
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  check_in_lat double precision not null,
  check_in_lng double precision not null,
  check_in_accuracy_m numeric(10,2),
  check_in_distance_m numeric(10,2) not null,
  check_out_lat double precision,
  check_out_lng double precision,
  check_out_accuracy_m numeric(10,2),
  check_out_distance_m numeric(10,2),
  contact_met text,
  visit_objective text,
  customer_interest integer check (customer_interest between 1 and 5),
  result text,
  notes text,
  next_action text,
  follow_up_date date,
  expected_order_sar numeric(14,2) not null default 0,
  short_visit_flag boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.visit_locations (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  salesperson_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m numeric(10,2),
  recorded_at timestamptz not null default now()
);

create table if not exists public.visit_products (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  outcome text not null default 'discussed' check (outcome in ('discussed','sampled','requested','rejected','sold')),
  notes text,
  unique(visit_id, product_id, outcome)
);

create table if not exists public.competition_updates (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.visits(id) on delete cascade,
  competitor_brand text not null,
  competitor_price_sar numeric(14,2),
  promotion text,
  strengths text,
  weaknesses text,
  update_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references public.visits(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  action_type text not null,
  details text,
  due_date date,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_receipts (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid references public.visits(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete restrict,
  salesperson_id uuid not null references public.profiles(id) on delete restrict,
  receipt_date date not null default current_date,
  amount_sar numeric(14,2) not null check (amount_sar > 0),
  payment_status text not null default 'received' check (payment_status in ('received','promised','partial','rejected')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists customers_salesperson_idx on public.customers(salesperson_id);
create index if not exists journey_plans_salesperson_date_idx on public.journey_plans(salesperson_id, visit_date);
create index if not exists collection_targets_salesperson_month_idx on public.collection_targets(salesperson_id, target_month);
create index if not exists visits_salesperson_checkin_idx on public.visits(salesperson_id, check_in_at desc);
create index if not exists visits_status_idx on public.visits(status);
create index if not exists visit_locations_visit_recorded_idx on public.visit_locations(visit_id, recorded_at desc);
create index if not exists actions_owner_status_idx on public.actions(owner_id, status, due_date);
create index if not exists receipts_salesperson_date_idx on public.collection_receipts(salesperson_id, receipt_date);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.current_role()
returns text
language sql
stable
security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_leadership()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(public.current_role() in ('admin','head_of_food_service','national_manager'), false);
$$;

create or replace function public.is_import_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(public.current_role() in ('admin','head_of_food_service'), false);
$$;

create or replace function public.can_manage_user(target_user uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select
    public.is_leadership()
    or exists (
      select 1
      from public.profiles manager
      join public.profiles target on target.id = target_user
      where manager.id = auth.uid()
        and manager.role in ('regional_manager','supervisor')
        and manager.region is not null
        and manager.region = target.region
    );
$$;

create or replace function public.can_access_customer(target_customer uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.customers c
    where c.id = target_customer
      and (c.salesperson_id = auth.uid() or public.can_manage_user(c.salesperson_id))
  );
$$;

create or replace function public.can_access_visit(target_visit uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.visits v
    where v.id = target_visit
      and (v.salesperson_id = auth.uid() or public.can_manage_user(v.salesperson_id))
  );
$$;

create or replace function public.haversine_m(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
)
returns numeric
language sql
immutable
as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2))
    * power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

create or replace function public.start_verified_visit(
  p_customer_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric default null,
  p_journey_plan_id uuid default null
)
returns table(visit_id uuid, distance_m numeric, checked_in_at timestamptz)
language plpgsql
security definer set search_path = public
as $$
declare
  c public.customers%rowtype;
  d numeric;
  v uuid;
begin
  if auth.uid() is null then
    raise exception 'You must sign in first.';
  end if;

  select * into c from public.customers where id = p_customer_id;
  if not found then
    raise exception 'Customer not found.';
  end if;

  if not public.can_access_customer(p_customer_id) then
    raise exception 'You cannot start a visit for this customer.';
  end if;

  if c.gps_lat is null or c.gps_lng is null then
    raise exception 'Customer GPS is not registered. Ask your manager to set the account location.';
  end if;

  if exists (
    select 1 from public.visits
    where salesperson_id = auth.uid() and status = 'active'
  ) then
    raise exception 'Close your active visit before starting a new one.';
  end if;

  d := round(public.haversine_m(c.gps_lat, c.gps_lng, p_lat, p_lng), 1);
  if d > coalesce(c.gps_radius_m, 20) then
    raise exception 'You are % metres from the account. You must be within % metres to check in.', d, coalesce(c.gps_radius_m, 20);
  end if;

  insert into public.visits (
    customer_id, salesperson_id, journey_plan_id, status,
    check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m
  ) values (
    p_customer_id, auth.uid(), p_journey_plan_id, 'active',
    p_lat, p_lng, p_accuracy_m, d
  ) returning id into v;

  insert into public.visit_locations (visit_id, salesperson_id, latitude, longitude, accuracy_m)
  values (v, auth.uid(), p_lat, p_lng, p_accuracy_m);

  update public.profiles set last_seen_at = now() where id = auth.uid();

  return query select v, d, now();
end;
$$;

create or replace function public.record_visit_location(
  p_visit_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not exists (
    select 1 from public.visits
    where id = p_visit_id and salesperson_id = auth.uid() and status = 'active'
  ) then
    raise exception 'Active visit not found.';
  end if;

  insert into public.visit_locations (visit_id, salesperson_id, latitude, longitude, accuracy_m)
  values (p_visit_id, auth.uid(), p_lat, p_lng, p_accuracy_m);

  update public.profiles set last_seen_at = now() where id = auth.uid();
end;
$$;

create or replace function public.close_verified_visit(
  p_visit_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m numeric default null
)
returns table(distance_m numeric, checked_out_at timestamptz, duration_seconds integer)
language plpgsql
security definer set search_path = public
as $$
declare
  v public.visits%rowtype;
  c public.customers%rowtype;
  d numeric;
  secs integer;
begin
  select * into v from public.visits where id = p_visit_id;
  if not found or v.salesperson_id <> auth.uid() then
    raise exception 'Visit not found.';
  end if;
  if v.status <> 'active' then
    raise exception 'This visit is already closed.';
  end if;

  select * into c from public.customers where id = v.customer_id;
  d := round(public.haversine_m(c.gps_lat, c.gps_lng, p_lat, p_lng), 1);
  if d > coalesce(c.gps_radius_m, 20) then
    raise exception 'You are % metres from the account. You must be within % metres to close the visit.', d, coalesce(c.gps_radius_m, 20);
  end if;

  secs := extract(epoch from (now() - v.check_in_at))::integer;
  update public.visits
  set status = 'closed',
      check_out_at = now(),
      check_out_lat = p_lat,
      check_out_lng = p_lng,
      check_out_accuracy_m = p_accuracy_m,
      check_out_distance_m = d,
      short_visit_flag = secs < 120
  where id = p_visit_id;

  insert into public.visit_locations (visit_id, salesperson_id, latitude, longitude, accuracy_m)
  values (p_visit_id, auth.uid(), p_lat, p_lng, p_accuracy_m);

  update public.profiles set last_seen_at = now() where id = auth.uid();

  return query select d, now(), secs;
end;
$$;

create or replace function public.touch_presence()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set last_seen_at = now() where id = auth.uid();
end;
$$;

-- Keep update timestamps fresh.
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at before update on public.customers for each row execute procedure public.set_updated_at();
drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products for each row execute procedure public.set_updated_at();
drop trigger if exists journey_plans_set_updated_at on public.journey_plans;
create trigger journey_plans_set_updated_at before update on public.journey_plans for each row execute procedure public.set_updated_at();
drop trigger if exists collection_targets_set_updated_at on public.collection_targets;
create trigger collection_targets_set_updated_at before update on public.collection_targets for each row execute procedure public.set_updated_at();
drop trigger if exists visits_set_updated_at on public.visits;
create trigger visits_set_updated_at before update on public.visits for each row execute procedure public.set_updated_at();
drop trigger if exists actions_set_updated_at on public.actions;
create trigger actions_set_updated_at before update on public.actions for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.journey_plans enable row level security;
alter table public.collection_targets enable row level security;
alter table public.visits enable row level security;
alter table public.visit_locations enable row level security;
alter table public.visit_products enable row level security;
alter table public.competition_updates enable row level security;
alter table public.actions enable row level security;
alter table public.collection_receipts enable row level security;

-- Profiles
create policy "profiles_select" on public.profiles for select using (
  id = auth.uid() or public.is_leadership() or public.can_manage_user(id)
);
create policy "profiles_update_self" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Customers
create policy "customers_select" on public.customers for select using (
  salesperson_id = auth.uid() or public.is_leadership() or public.can_manage_user(salesperson_id)
);
create policy "customers_insert" on public.customers for insert with check (
  public.is_import_admin() or (salesperson_id = auth.uid() and approval_code is not null)
);
create policy "customers_update" on public.customers for update using (
  public.is_import_admin() or salesperson_id = auth.uid() or public.can_manage_user(salesperson_id)
) with check (
  public.is_import_admin() or salesperson_id = auth.uid() or public.can_manage_user(salesperson_id)
);

-- Products
create policy "products_authenticated_read" on public.products for select using (auth.uid() is not null);
create policy "products_admin_write" on public.products for all using (public.is_import_admin()) with check (public.is_import_admin());

-- Journey plans
create policy "journey_select" on public.journey_plans for select using (
  salesperson_id = auth.uid() or public.is_leadership() or public.can_manage_user(salesperson_id)
);
create policy "journey_write" on public.journey_plans for all using (public.is_import_admin() or salesperson_id = auth.uid()) with check (public.is_import_admin() or salesperson_id = auth.uid());

-- Collection targets
create policy "collection_targets_select" on public.collection_targets for select using (
  salesperson_id = auth.uid() or public.is_leadership() or public.can_manage_user(salesperson_id)
);
create policy "collection_targets_write" on public.collection_targets for all using (public.is_import_admin()) with check (public.is_import_admin());

-- Visits and live visit locations
create policy "visits_select" on public.visits for select using (
  salesperson_id = auth.uid() or public.is_leadership() or public.can_manage_user(salesperson_id)
);
create policy "visits_update_owner" on public.visits for update using (salesperson_id = auth.uid()) with check (salesperson_id = auth.uid());
create policy "locations_select" on public.visit_locations for select using (
  salesperson_id = auth.uid() or public.is_leadership() or public.can_manage_user(salesperson_id)
);

-- Related visit information
create policy "visit_products_select" on public.visit_products for select using (public.can_access_visit(visit_id));
create policy "visit_products_write" on public.visit_products for all using (public.can_access_visit(visit_id)) with check (public.can_access_visit(visit_id));
create policy "competition_select" on public.competition_updates for select using (public.can_access_visit(visit_id));
create policy "competition_write" on public.competition_updates for all using (public.can_access_visit(visit_id)) with check (public.can_access_visit(visit_id));

-- Actions
create policy "actions_select" on public.actions for select using (
  owner_id = auth.uid() or created_by = auth.uid() or public.is_leadership() or public.can_manage_user(owner_id)
);
create policy "actions_insert" on public.actions for insert with check (
  created_by = auth.uid() and (owner_id = auth.uid() or public.is_leadership() or public.can_manage_user(owner_id))
);
create policy "actions_update" on public.actions for update using (
  owner_id = auth.uid() or created_by = auth.uid() or public.is_leadership() or public.can_manage_user(owner_id)
) with check (
  owner_id = auth.uid() or created_by = auth.uid() or public.is_leadership() or public.can_manage_user(owner_id)
);

-- Receipts
create policy "receipts_select" on public.collection_receipts for select using (
  salesperson_id = auth.uid() or public.is_leadership() or public.can_manage_user(salesperson_id)
);
create policy "receipts_insert" on public.collection_receipts for insert with check (salesperson_id = auth.uid());

-- Realtime is used by the manager dashboard for active visits and location updates.
alter publication supabase_realtime add table public.visits;
alter publication supabase_realtime add table public.visit_locations;
alter publication supabase_realtime add table public.collection_receipts;
alter publication supabase_realtime add table public.actions;

-- First owner setup after creating your user in Supabase Auth:
-- update public.profiles
-- set full_name = 'Ghassan Baker', role = 'head_of_food_service', region = 'KSA', employee_code = 'GUS001'
-- where email = 'your-email@halwani.com';

-- Prevent a user from promoting themselves through the browser client.
create or replace function public.prevent_profile_privilege_escalation()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() = old.id and (
    new.role is distinct from old.role
    or new.employee_code is distinct from old.employee_code
    or new.manager_id is distinct from old.manager_id
    or new.region is distinct from old.region
    or new.is_active is distinct from old.is_active
  ) then
    raise exception 'Profile role and reporting fields can only be changed by an administrator.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_privilege_escalation on public.profiles;
create trigger profiles_prevent_privilege_escalation
before update on public.profiles
for each row execute procedure public.prevent_profile_privilege_escalation();
