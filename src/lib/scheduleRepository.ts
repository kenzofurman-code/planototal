import { supabase } from './supabase';
import type { Task } from '../types';

export async function saveScheduleTasks(projectKey: string, tasks: Task[]) {
  if (!supabase) return;
  const rows = tasks.map((task) => ({
    project_key: projectKey,
    external_id: task.id,
    lot_mother: task.lotMother,
    lot: task.lot,
    package_name: task.packageName,
    package_family: task.packageFamily,
    service_name: task.service ?? null,
    start_date: task.startDate,
    end_date: task.endDate,
    duration_days: task.duration ?? null,
    quantity: task.quantity ?? null,
    unit: task.unit ?? null,
    progress_percent: task.progress,
    responsible_name: task.responsible ?? null,
    team_name: null,
    cost_estimated: task.cost ?? null,
    color: task.color,
    services: task.services ?? [],
    predecessors: task.predecessors ?? [],
    successors: task.successors ?? [],
    lane: task.lane ?? null,
    status: 'planejado',
    source: 'import',
    updated_at: new Date().toISOString()
  }));
  const { error } = await supabase.from('schedule_tasks').upsert(rows, { onConflict: 'project_key,external_id' });
  if (error) throw error;
}

export async function deleteProjectBudget(projectKey: string) {
  if (!supabase) return;
  const tasksResult = await supabase.from('schedule_tasks').update({
    cost_estimated: null,
    updated_at: new Date().toISOString()
  }).eq('project_key', projectKey);
  if (tasksResult.error) throw tasksResult.error;

  const projectResult = await supabase.from('projects').select('id').eq('project_key', projectKey).maybeSingle();
  if (projectResult.error) throw projectResult.error;
  if (projectResult.data?.id) {
    const budgetResult = await supabase.from('budget_items').delete().eq('project_id', projectResult.data.id);
    if (budgetResult.error) throw budgetResult.error;
  }
}
