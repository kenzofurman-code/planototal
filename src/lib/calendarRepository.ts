import { supabase } from './supabase';
import type { CalendarEvent } from '../types';

export async function saveCalendarEvents(projectKey: string, events: CalendarEvent[]) {
  if (!supabase) return;
  const rows = events.map((event) => ({
    id: event.id,
    project_key: projectKey,
    project_id: event.projectId ?? null,
    date: event.date,
    title: event.title,
    kind: event.kind,
    color: event.color,
    applies_to_all: event.appliesToAll ?? false,
    project_ids: event.projectIds ?? [],
    updated_at: new Date().toISOString()
  }));
  const { error } = await supabase.from('calendar_events').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}
