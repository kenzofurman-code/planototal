import { supabase } from './supabase';

export type ShortTermWeeklyItem = {
  id: string;
  weekId: string;
  activityId: string;
  activityName: string;
  floor: string;
  sectionId: string;
  responsible: string;
  efetivo: number | null;
  plannedThisWeek: number;
  progressThisWeek: number;
  executedBefore: number;
  dailyWork: number[];
  delayReason: string;
  observations: string;
  finalized: boolean;
  isManual: boolean;
  serviceComplement?: string;
  preFilledProgress?: number;
  preFilledDelayReason?: string;
  preFilledObservations?: string;
  preFilledAt?: string;
  lastUpdatedBy?: string;
};

export type ShortTermHistory = {
  weekStart: string;
  ppc: number;
  completed: number;
  totalPlanned: number;
};

export type ShortTermState = {
  weekly: ShortTermWeeklyItem[];
  teams: string[];
  reasons: string[];
  history: ShortTermHistory[];
  teamPhones?: { [teamName: string]: string };
  projectCity?: string;
  weatherApiKey?: string;
  matrices?: Array<{
    id: string;
    name: string;
    macros: string[];
    floors: string[];
  }>;
  accessControl?: {
    users: string[];
    projectAccess: { [projectId: string]: string[] };
    logs: { username: string; timestamp: string }[];
  };
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
