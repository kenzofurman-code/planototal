import { supabase } from './supabase';
import type { Task } from '../types';

export type MediumWindowUnit = {
  id: string;
  parentId?: string;
  name: string;
  weight: number;
  quantity: number;
  startDate: string;
  endDate: string;
  responsible: string;
  predecessors?: string[];
};

export type MediumWindowState = {
  analysisStart: string;
  windowData: {
    id: string;
    startDate: string;
    endDate: string;
    createdAt: string;
    tasks: Task[];
  } | null;
  units: Record<string, MediumWindowUnit[]>;
};

export async function loadPublishedMediumPlan(projectKey: string): Promise<Task[] | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('medium_plan_snapshots')
    .select('payload')
    .eq('project_key', projectKey)
    .maybeSingle();
  if (error) throw error;
  return (data?.payload as Task[] | undefined) ?? null;
}

export async function savePublishedMediumPlan(projectKey: string, tasks: Task[]) {
  if (!supabase) return;
  const { error } = await supabase.from('medium_plan_snapshots').upsert(
    {
      project_key: projectKey,
      payload: tasks,
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    { onConflict: 'project_key' }
  );
  if (error) throw error;
}

export async function loadMediumWindowState(projectKey: string): Promise<MediumWindowState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('medium_plan_windows')
    .select('payload')
    .eq('project_key', projectKey)
    .maybeSingle();
  if (error) throw error;
  return (data?.payload as MediumWindowState | undefined) ?? null;
}

export async function saveMediumWindowState(projectKey: string, state: MediumWindowState) {
  if (!supabase) return;
  const { error } = await supabase.from('medium_plan_windows').upsert(
    {
      project_key: projectKey,
      payload: state,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'project_key' }
  );
  if (error) throw error;
}
