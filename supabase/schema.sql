create extension if not exists "uuid-ossp";

create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  project_key text unique,
  name text not null,
  image_url text,
  address text,
  area numeric,
  company text,
  status text default 'ativo',
  start_date date,
  planned_end_date date,
  active_schedule_version_id uuid,
  baseline_schedule_version_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table projects add column if not exists city text;
alter table projects add column if not exists state text;
alter table projects add column if not exists ibge_code text;

alter table projects enable row level security;
drop policy if exists "authenticated_projects_select" on projects;
create policy "authenticated_projects_select" on projects for select to authenticated using (true);
drop policy if exists "authenticated_projects_insert" on projects;
create policy "authenticated_projects_insert" on projects for insert to authenticated with check (true);
drop policy if exists "authenticated_projects_update" on projects;
create policy "authenticated_projects_update" on projects for update to authenticated using (true) with check (true);
drop policy if exists "public_projects_access" on projects;
create policy "public_projects_access" on projects for all to anon using (true) with check (true);

create table if not exists schedule_imports (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  file_name text not null,
  file_url text,
  file_type text,
  imported_at timestamptz default now(),
  detected_columns jsonb default '[]'::jsonb,
  mapping_config jsonb default '{}'::jsonb,
  row_count integer default 0,
  status text default 'importado'
);

create table if not exists schedule_versions (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  import_id uuid references schedule_imports(id) on delete set null,
  name text not null,
  type text default 'active',
  version_number integer default 0,
  source_version_id uuid references schedule_versions(id) on delete set null,
  is_active boolean default false,
  is_baseline boolean default false,
  created_at timestamptz default now(),
  notes text
);

create table if not exists lots (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  parent_lot_id uuid references lots(id) on delete cascade,
  name text not null,
  lot_type text,
  lot_order integer default 0,
  area numeric,
  weight_within_parent numeric default 100,
  active boolean default true
);

create table if not exists package_families (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  default_color text,
  default_lane integer default 1,
  active boolean default true
);

create table if not exists packages (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  short_name text,
  package_family_id uuid references package_families(id) on delete set null,
  color text,
  default_lane integer default 1,
  package_order integer default 0,
  procurement_type text default 'none',
  lead_time_days integer default 0,
  active boolean default true
);

create table if not exists schedule_tasks (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  project_key text,
  version_id uuid references schedule_versions(id) on delete cascade,
  external_id text,
  lot_mother text,
  lot text,
  package_name text,
  package_family text,
  service_name text,
  start_date date not null,
  end_date date not null,
  duration_days integer,
  quantity numeric,
  unit text,
  progress_percent numeric default 0,
  responsible_name text,
  team_name text,
  cost_estimated numeric,
  budget_code text,
  procurement_required boolean default false,
  status text default 'planejado',
  source text default 'import',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table schedule_tasks enable row level security;
drop policy if exists "authenticated_schedule_tasks_select" on schedule_tasks;
create policy "authenticated_schedule_tasks_select" on schedule_tasks for select to authenticated using (true);
drop policy if exists "authenticated_schedule_tasks_insert" on schedule_tasks;
create policy "authenticated_schedule_tasks_insert" on schedule_tasks for insert to authenticated with check (true);
drop policy if exists "authenticated_schedule_tasks_update" on schedule_tasks;
create policy "authenticated_schedule_tasks_update" on schedule_tasks for update to authenticated using (true) with check (true);
drop policy if exists "public_schedule_tasks_access" on schedule_tasks;
create policy "public_schedule_tasks_access" on schedule_tasks for all to anon using (true) with check (true);

create table if not exists line_balance_settings (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  project_key text unique,
  version_id uuid references schedule_versions(id) on delete cascade,
  project_start_date date,
  default_zoom integer default 3,
  group_line_count jsonb default '{}'::jsonb,
  package_lane_map jsonb default '{}'::jsonb,
  package_family_lane_map jsonb default '{}'::jsonb,
  package_color_map jsonb default '{}'::jsonb,
  lot_order jsonb default '[]'::jsonb,
  show_milestones boolean default true,
  show_baseline boolean default true,
  show_dependencies boolean default true
);

alter table line_balance_settings enable row level security;
drop policy if exists "authenticated_line_balance_settings_select" on line_balance_settings;
create policy "authenticated_line_balance_settings_select" on line_balance_settings for select to authenticated using (true);
drop policy if exists "authenticated_line_balance_settings_insert" on line_balance_settings;
create policy "authenticated_line_balance_settings_insert" on line_balance_settings for insert to authenticated with check (true);
drop policy if exists "authenticated_line_balance_settings_update" on line_balance_settings;
create policy "authenticated_line_balance_settings_update" on line_balance_settings for update to authenticated using (true) with check (true);
drop policy if exists "public_line_balance_settings_access" on line_balance_settings;
create policy "public_line_balance_settings_access" on line_balance_settings for all to anon using (true) with check (true);

create table if not exists milestones (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  version_id uuid references schedule_versions(id) on delete cascade,
  name text not null,
  date date not null,
  color text default '#b91c1c',
  show_on_line_balance boolean default true,
  description text
);

create table if not exists calendar_events (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  project_key text,
  date date not null,
  title text not null,
  kind text not null,
  color text not null,
  applies_to_all boolean default false,
  project_ids jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table calendar_events enable row level security;
drop policy if exists "authenticated_calendar_events_select" on calendar_events;
create policy "authenticated_calendar_events_select" on calendar_events for select to authenticated using (true);
drop policy if exists "authenticated_calendar_events_insert" on calendar_events;
create policy "authenticated_calendar_events_insert" on calendar_events for insert to authenticated with check (true);
drop policy if exists "authenticated_calendar_events_update" on calendar_events;
create policy "authenticated_calendar_events_update" on calendar_events for update to authenticated using (true) with check (true);
drop policy if exists "public_calendar_events_access" on calendar_events;
create policy "public_calendar_events_access" on calendar_events for all to anon using (true) with check (true);

create table if not exists schedule_dependencies (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  project_key text,
  version_id uuid references schedule_versions(id) on delete cascade,
  from_task_id uuid,
  to_task_id uuid,
  type text default 'FS',
  lag_days integer default 0,
  created_at timestamptz default now()
);

alter table schedule_dependencies enable row level security;
drop policy if exists "authenticated_schedule_dependencies_select" on schedule_dependencies;
create policy "authenticated_schedule_dependencies_select" on schedule_dependencies for select to authenticated using (true);
drop policy if exists "authenticated_schedule_dependencies_insert" on schedule_dependencies;
create policy "authenticated_schedule_dependencies_insert" on schedule_dependencies for insert to authenticated with check (true);
drop policy if exists "authenticated_schedule_dependencies_update" on schedule_dependencies;
create policy "authenticated_schedule_dependencies_update" on schedule_dependencies for update to authenticated using (true) with check (true);
drop policy if exists "public_schedule_dependencies_access" on schedule_dependencies;
create policy "public_schedule_dependencies_access" on schedule_dependencies for all to anon using (true) with check (true);

create table if not exists line_balance_versions (
  project_key text primary key,
  payload jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table line_balance_versions enable row level security;
drop policy if exists "authenticated_line_balance_versions_select" on line_balance_versions;
create policy "authenticated_line_balance_versions_select" on line_balance_versions for select to authenticated using (true);
drop policy if exists "authenticated_line_balance_versions_insert" on line_balance_versions;
create policy "authenticated_line_balance_versions_insert" on line_balance_versions for insert to authenticated with check (true);
drop policy if exists "authenticated_line_balance_versions_update" on line_balance_versions;
create policy "authenticated_line_balance_versions_update" on line_balance_versions for update to authenticated using (true) with check (true);
drop policy if exists "public_line_balance_versions_access" on line_balance_versions;
create policy "public_line_balance_versions_access" on line_balance_versions for all to anon using (true) with check (true);

create table if not exists medium_plan_tasks (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  parent_schedule_task_id uuid,
  lot_path jsonb default '[]'::jsonb,
  package_name text,
  start_date date,
  end_date date,
  quantity numeric,
  productivity numeric,
  weight_within_parent numeric default 100,
  progress_percent numeric default 0
);

create table if not exists medium_plan_snapshots (
  project_key text primary key,
  payload jsonb not null default '[]'::jsonb,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table medium_plan_snapshots enable row level security;

drop policy if exists "authenticated_medium_plan_snapshots_select" on medium_plan_snapshots;
create policy "authenticated_medium_plan_snapshots_select" on medium_plan_snapshots
  for select to authenticated using (true);

drop policy if exists "authenticated_medium_plan_snapshots_insert" on medium_plan_snapshots;
create policy "authenticated_medium_plan_snapshots_insert" on medium_plan_snapshots
  for insert to authenticated with check (true);

drop policy if exists "authenticated_medium_plan_snapshots_update" on medium_plan_snapshots;
create policy "authenticated_medium_plan_snapshots_update" on medium_plan_snapshots
  for update to authenticated using (true) with check (true);
drop policy if exists "public_medium_plan_snapshots_access" on medium_plan_snapshots;
create policy "public_medium_plan_snapshots_access" on medium_plan_snapshots
  for all to anon using (true) with check (true);

create table if not exists medium_plan_windows (
  project_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table medium_plan_windows enable row level security;

drop policy if exists "authenticated_medium_plan_windows_select" on medium_plan_windows;
create policy "authenticated_medium_plan_windows_select" on medium_plan_windows
  for select to authenticated using (true);

drop policy if exists "authenticated_medium_plan_windows_insert" on medium_plan_windows;
create policy "authenticated_medium_plan_windows_insert" on medium_plan_windows
  for insert to authenticated with check (true);

drop policy if exists "authenticated_medium_plan_windows_update" on medium_plan_windows;
create policy "authenticated_medium_plan_windows_update" on medium_plan_windows
  for update to authenticated using (true) with check (true);
drop policy if exists "public_medium_plan_windows_access" on medium_plan_windows;
create policy "public_medium_plan_windows_access" on medium_plan_windows
  for all to anon using (true) with check (true);

create table if not exists microservice_templates (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  package_family text not null,
  name text not null,
  active boolean default true
);

create table if not exists microservice_items (
  id uuid primary key default uuid_generate_v4(),
  template_id uuid references microservice_templates(id) on delete cascade,
  name text not null,
  weight_percent numeric not null,
  unit text,
  payment_criterion text,
  item_order integer default 0
);

create table if not exists weekly_plan_items (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  schedule_task_id uuid,
  medium_plan_task_id uuid,
  package_name text,
  microservice_name text,
  planned_quantity numeric,
  measured_quantity numeric,
  planned_percent numeric,
  measured_percent numeric,
  team_name text,
  failure_reason text,
  notes text
);

create table if not exists procurement_requirements (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  schedule_task_id uuid,
  package_name text,
  package_family text,
  budget_code text,
  item_code text,
  item_description text not null,
  required_quantity numeric not null default 0,
  unit text,
  estimated_unit_cost numeric,
  estimated_total_cost numeric,
  required_date date,
  lead_time_days integer default 0,
  deadline_to_request date,
  deadline_to_order date,
  source text default 'schedule'
);

create table if not exists procurement_external_lines (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  source_sheet text,
  budget_code text,
  request_number text,
  item_code text,
  item_description text,
  requested_quantity numeric default 0,
  converted_quantity numeric default 0,
  unit text,
  request_total_value numeric,
  required_date date,
  quote_number text,
  purchase_order_number text,
  supplier text,
  contract_number text,
  request_status text,
  order_status text,
  approval_status text
);

create table if not exists procurement_cards (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  item_code text,
  item_description text not null,
  package_name text,
  package_family text,
  required_quantity numeric default 0,
  requested_quantity numeric default 0,
  quoted_quantity numeric default 0,
  ordered_quantity numeric default 0,
  contracted_quantity numeric default 0,
  delivered_quantity numeric default 0,
  missing_quantity numeric default 0,
  coverage_percent numeric default 0,
  current_stage text default 'A programar',
  real_status text default 'Pendente',
  required_date date
);

create table if not exists budget_items (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  budget_code text,
  description text not null,
  quantity numeric,
  unit text,
  unit_cost numeric,
  total_cost numeric,
  cost_group text,
  contract_id text
);

create table if not exists financial_forecast (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  period date not null,
  planned_value numeric default 0,
  forecast_value numeric default 0,
  measured_value numeric default 0,
  accumulated_planned numeric default 0,
  accumulated_forecast numeric default 0,
  accumulated_measured numeric default 0
);

create table if not exists change_log (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid references projects(id) on delete cascade,
  module text not null,
  entity_type text not null,
  entity_id uuid,
  version_id uuid,
  field text,
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz default now(),
  reason text,
  source text default 'user'
);

create table if not exists short_term_state (
  project_key text primary key,
  payload jsonb not null default '{"weekly":[],"teams":[],"reasons":[],"history":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table short_term_state enable row level security;

drop policy if exists "authenticated_short_term_select" on short_term_state;
create policy "authenticated_short_term_select" on short_term_state
  for select to authenticated using (true);

drop policy if exists "authenticated_short_term_insert" on short_term_state;
create policy "authenticated_short_term_insert" on short_term_state
  for insert to authenticated with check (true);

drop policy if exists "authenticated_short_term_update" on short_term_state;
create policy "authenticated_short_term_update" on short_term_state
  for update to authenticated using (true) with check (true);

drop policy if exists "public_short_term_state_access" on short_term_state;
create policy "public_short_term_state_access" on short_term_state
  for all to anon using (true) with check (true);

create index if not exists idx_schedule_tasks_project on schedule_tasks(project_id, version_id);
create unique index if not exists idx_schedule_tasks_project_external on schedule_tasks(project_key, external_id);
create index if not exists idx_procurement_cards_project on procurement_cards(project_id);
create index if not exists idx_change_log_project on change_log(project_id, changed_at desc);
