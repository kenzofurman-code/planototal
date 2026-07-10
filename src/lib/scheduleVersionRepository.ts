import { supabase } from './supabase';
import type { Task } from '../types';

export type SavedScheduleVersion = {
  id: string;
  name: string;
  tasks: Task[];
  isActive: boolean;
  isBaseline: boolean;
  createdAt: string;
};

export async function loadScheduleVersions(projectKey: string): Promise<SavedScheduleVersion[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('schedule_saved_versions').select('*').eq('project_key', projectKey).order('created_at');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, tasks: Array.isArray(row.tasks) ? row.tasks as Task[] : [],
    isActive: row.is_active, isBaseline: row.is_baseline, createdAt: row.created_at
  }));
}

export async function createScheduleVersion(projectKey: string, name: string, tasks: Task[], first: boolean) {
  if (!supabase) return;
  const { error } = await supabase.from('schedule_saved_versions').insert({
    project_key: projectKey, name, tasks, is_active: first, is_baseline: first
  });
  if (error) throw error;
}

export async function selectScheduleVersion(projectKey: string, id: string, field: 'is_active' | 'is_baseline') {
  if (!supabase) return;
  const cleared = await supabase.from('schedule_saved_versions').update({ [field]: false }).eq('project_key', projectKey);
  if (cleared.error) throw cleared.error;
  const selected = await supabase.from('schedule_saved_versions').update({ [field]: true }).eq('project_key', projectKey).eq('id', id);
  if (selected.error) throw selected.error;
}

export async function deleteScheduleVersion(projectKey: string, id: string) {
  if (!supabase) return;
  const { error } = await supabase.from('schedule_saved_versions').delete().eq('project_key', projectKey).eq('id', id);
  if (error) throw error;
}

export async function updateActiveScheduleVersion(projectKey: string, tasks: Task[]) {
  if (!supabase) return;
  const { error } = await supabase.from('schedule_saved_versions')
    .update({ tasks, updated_at: new Date().toISOString() }).eq('project_key', projectKey).eq('is_active', true);
  if (error) throw error;
}
