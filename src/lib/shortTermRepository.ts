import { supabase } from './supabase';

export type ShortTermWeeklyItem = {
  id: string;
  taskId: string;
  weekStart: string;
  planned: number;
  measured: number;
  team: string;
  reason: string;
  notes: string;
};

export type ShortTermHistory = {
  week: string;
  ppc: number;
  planned: number;
  completed: number;
};

export type ShortTermState = {
  weekly: ShortTermWeeklyItem[];
  teams: string[];
  reasons: string[];
  history: ShortTermHistory[];
};

export async function loadShortTermState(projectId: string): Promise<ShortTermState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('short_term_state').select('payload').eq('project_key', projectId).maybeSingle();
  if (error) throw error;
  return (data?.payload as ShortTermState | undefined) ?? null;
}

export async function saveShortTermState(projectId: string, state: ShortTermState) {
  if (!supabase) return;
  const { error } = await supabase.from('short_term_state').upsert({
    project_key: projectId,
    payload: state,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_key' });
  if (error) throw error;
}
