import { supabase } from './supabase';

export async function loadBudgetRevisionName(projectKey: string) {
  if (!supabase) return 'Orçamento vigente';
  const { data, error } = await supabase.from('budget_revisions').select('name').eq('project_key', projectKey).maybeSingle();
  if (error) throw error;
  return data?.name ?? 'Orçamento vigente';
}

export async function saveBudgetRevisionName(projectKey: string, name: string) {
  if (!supabase) return;
  const { error } = await supabase.from('budget_revisions').upsert(
    { project_key: projectKey, name: name.trim() || 'Orçamento vigente', updated_at: new Date().toISOString() },
    { onConflict: 'project_key' }
  );
  if (error) throw error;
}
