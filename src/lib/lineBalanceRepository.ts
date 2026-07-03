import { supabase } from './supabase';
import type { ScheduleDependency, Task } from '../types';

export type LineBalanceVersion = {
  id: string;
  name: string;
  createdAt: string;
  kind: 'scenario' | 'baseline' | 'planned';
  tasks: Task[];
};

export type LineBalanceSettings = {
  zoom: number;
  editMode: boolean;
  dependencyMode: boolean;
  showDeps: boolean;
  snapWeek: boolean;
  monthFormat: 'index' | 'numeric';
  weekFormat: 'short' | 'numeric' | 'day';
  groupLines: Record<string, number>;
  familyLane: Record<string, number>;
  packageLanes: Record<string, number>;
  packageColors: Record<string, string>;
  groupOrder: string[];
  lotOrder: Record<string, string[]>;
};

export async function loadLineBalanceData(projectKey: string) {
  if (!supabase) return null;
  const [versionsRes, depsRes, settingsRes] = await Promise.all([
    supabase.from('line_balance_versions').select('payload').eq('project_key', projectKey).maybeSingle(),
    supabase.from('schedule_dependencies').select('*').eq('project_key', projectKey),
    supabase.from('line_balance_settings').select('*').eq('project_key', projectKey).maybeSingle()
  ]);
  if (versionsRes.error) throw versionsRes.error;
  if (depsRes.error) throw depsRes.error;
  if (settingsRes.error) throw settingsRes.error;
  return {
    versions: (versionsRes.data?.payload as LineBalanceVersion[] | undefined) ?? null,
    dependencies: (depsRes.data ?? []).map((row) => ({
      from: row.from_task_id,
      to: row.to_task_id,
      type: row.type as ScheduleDependency['type']
    })),
    settings: (settingsRes.data?.payload as Partial<LineBalanceSettings> | undefined) ?? null
  };
}

export async function saveLineBalanceData(
  projectKey: string,
  payload: {
    versions: LineBalanceVersion[];
    dependencies: ScheduleDependency[];
    settings: LineBalanceSettings;
  }
) {
  if (!supabase) return;
  const now = new Date().toISOString();
  const [versionsRes, depsRes, settingsRes] = await Promise.all([
    supabase.from('line_balance_versions').upsert(
      { project_key: projectKey, payload: payload.versions, updated_at: now },
      { onConflict: 'project_key' }
    ),
    supabase.from('schedule_dependencies').delete().eq('project_key', projectKey),
    supabase.from('line_balance_settings').upsert(
      { project_key: projectKey, payload: payload.settings, updated_at: now },
      { onConflict: 'project_key' }
    )
  ]);
  if (versionsRes.error) throw versionsRes.error;
  if (depsRes.error) throw depsRes.error;
  if (settingsRes.error) throw settingsRes.error;
  if (payload.dependencies.length) {
    const insertRes = await supabase.from('schedule_dependencies').insert(
      payload.dependencies.map((dependency) => ({
        project_key: projectKey,
        from_task_id: dependency.from,
        to_task_id: dependency.to,
        type: dependency.type,
        lag_days: 0
      }))
    );
    if (insertRes.error) throw insertRes.error;
  }
}
