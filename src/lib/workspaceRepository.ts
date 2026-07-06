import { supabase } from './supabase';
import type { CalendarEvent, Project, Task } from '../types';

export type WorkspaceSnapshot = {
  projects: Project[];
  tasks: Task[];
  calendarEvents: CalendarEvent[];
};

function mapProject(row: Record<string, any>): Project {
  return {
    id: row.project_key ?? row.id,
    name: row.name,
    imageUrl: row.image_url ?? '',
    address: row.address ?? '',
    area: Number(row.area ?? 0),
    status: row.status ?? 'ativo',
    startDate: row.start_date ?? '',
    plannedEndDate: row.planned_end_date ?? '',
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    ibgeCode: row.ibge_code ?? undefined
  };
}

function mapTask(row: Record<string, any>): Task {
  return {
    id: row.external_id ?? row.id,
    lotMother: row.lot_mother ?? '',
    lot: row.lot ?? '',
    packageName: row.package_name ?? '',
    packageFamily: row.package_family ?? '',
    startDate: row.start_date ?? '',
    endDate: row.end_date ?? '',
    progress: Number(row.progress_percent ?? 0),
    color: row.color ?? '#4f46e5',
    quantity: row.quantity ?? undefined,
    unit: row.unit ?? undefined,
    cost: row.cost_estimated ?? undefined,
    service: row.service_name ?? undefined,
    services: Array.isArray(row.services) ? row.services : undefined,
    duration: row.duration_days ?? undefined,
    responsible: row.responsible_name ?? undefined,
    predecessors: Array.isArray(row.predecessors) ? row.predecessors : undefined,
    successors: Array.isArray(row.successors) ? row.successors : undefined,
    lane: row.lane ?? undefined
  };
}

function restoreTaskColors(rows: Array<Record<string, any>>): Task[] {
  const palette = ['#4f46e5', '#f97316', '#0f766e', '#a855f7', '#2563eb', '#ca8a04', '#dc2626', '#059669', '#7c3aed', '#475569'];
  const packageIndexes = new Map<string, Map<string, number>>();
  return rows.map((row) => {
    const task = mapTask(row);
    if (row.color) return task;
    if (!packageIndexes.has(task.lotMother)) packageIndexes.set(task.lotMother, new Map());
    const group = packageIndexes.get(task.lotMother)!;
    if (!group.has(task.packageName)) group.set(task.packageName, group.size);
    const index = group.get(task.packageName)!;
    return { ...task, color: palette[index % palette.length], lane: task.lane ?? (index % 3) + 1 };
  });
}

function mapCalendarEvent(row: Record<string, any>): CalendarEvent {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    date: row.date,
    title: row.title,
    kind: row.kind,
    color: row.color,
    appliesToAll: row.applies_to_all ?? false,
    projectIds: Array.isArray(row.project_ids) ? row.project_ids : []
  };
}

async function loadAllScheduleTaskRows(projectKeys: string[]) {
  if (!supabase || !projectKeys.length) return [] as Array<Record<string, any>>;
  const pageSize = 1000;
  const rows: Array<Record<string, any>> = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from('schedule_tasks')
      .select('*')
      .in('project_key', projectKeys)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      throw new Error(`schedule_tasks: ${error.message}${error.hint ? ` (${error.hint})` : ''} [${error.code}]`);
    }
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }
  return rows;
}

export async function loadWorkspace(userId: string): Promise<WorkspaceSnapshot | null> {
  if (!supabase) return null;
  const accessRes = await supabase.from('user_project_access').select('project_key').eq('user_id', userId);
  if (accessRes.error) {
    throw new Error(`user_project_access: ${accessRes.error.message}${accessRes.error.hint ? ` (${accessRes.error.hint})` : ''} [${accessRes.error.code}]`);
  }
  const allowed = new Set((accessRes.data ?? []).map((row) => row.project_key));
  const [projectsRes, calendarRes, taskRows] = await Promise.all([
    supabase.from('projects').select('*').order('created_at', { ascending: true }),
    supabase.from('calendar_events').select('*').order('created_at', { ascending: true }),
    loadAllScheduleTaskRows(Array.from(allowed))
  ]);
  if (projectsRes.error) {
    throw new Error(`projects: ${projectsRes.error.message}${projectsRes.error.hint ? ` (${projectsRes.error.hint})` : ''} [${projectsRes.error.code}]`);
  }
  if (calendarRes.error) {
    throw new Error(`calendar_events: ${calendarRes.error.message}${calendarRes.error.hint ? ` (${calendarRes.error.hint})` : ''} [${calendarRes.error.code}]`);
  }
  return {
    projects: (projectsRes.data ?? []).filter((row) => allowed.has(row.project_key)).map(mapProject),
    tasks: restoreTaskColors(taskRows),
    calendarEvents: (calendarRes.data ?? []).filter((row) => !row.project_key || allowed.has(row.project_key)).map(mapCalendarEvent)
  };
}
