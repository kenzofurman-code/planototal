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

export async function loadWorkspace(userId: string): Promise<WorkspaceSnapshot | null> {
  if (!supabase) return null;
  const [projectsRes, tasksRes, calendarRes, accessRes] = await Promise.all([
    supabase.from('projects').select('*').order('created_at', { ascending: true }),
    supabase.from('schedule_tasks').select('*').order('created_at', { ascending: true }),
    supabase.from('calendar_events').select('*').order('created_at', { ascending: true }),
    supabase.from('user_project_access').select('project_key').eq('user_id', userId)
  ]);
  if (projectsRes.error) {
    throw new Error(`projects: ${projectsRes.error.message}${projectsRes.error.hint ? ` (${projectsRes.error.hint})` : ''} [${projectsRes.error.code}]`);
  }
  if (tasksRes.error) {
    throw new Error(`schedule_tasks: ${tasksRes.error.message}${tasksRes.error.hint ? ` (${tasksRes.error.hint})` : ''} [${tasksRes.error.code}]`);
  }
  if (calendarRes.error) {
    throw new Error(`calendar_events: ${calendarRes.error.message}${calendarRes.error.hint ? ` (${calendarRes.error.hint})` : ''} [${calendarRes.error.code}]`);
  }
  if (accessRes.error) {
    throw new Error(`user_project_access: ${accessRes.error.message}${accessRes.error.hint ? ` (${accessRes.error.hint})` : ''} [${accessRes.error.code}]`);
  }
  const allowed = new Set((accessRes.data ?? []).map((row) => row.project_key));
  return {
    projects: (projectsRes.data ?? []).filter((row) => allowed.has(row.project_key)).map(mapProject),
    tasks: (tasksRes.data ?? []).filter((row) => allowed.has(row.project_key)).map(mapTask),
    calendarEvents: (calendarRes.data ?? []).filter((row) => !row.project_key || allowed.has(row.project_key)).map(mapCalendarEvent)
  };
}
