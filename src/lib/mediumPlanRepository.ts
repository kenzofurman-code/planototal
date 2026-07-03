import { supabase } from './supabase';
import type { Task } from '../types';

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
