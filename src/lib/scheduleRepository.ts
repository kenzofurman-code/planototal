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
    status: 'planejado',
    source: 'import',
    updated_at: new Date().toISOString()
  }));
  const { error } = await supabase.from('schedule_tasks').upsert(rows, { onConflict: 'project_key,external_id' });
  if (error) throw error;
}
