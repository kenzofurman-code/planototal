import { supabase } from './supabase';
import type { Project } from '../types';

export async function saveProject(project: Project) {
  if (!supabase) return;
  const { error } = await supabase.from('projects').upsert({
    project_key: project.id,
    name: project.name,
    image_url: project.imageUrl,
    address: project.address,
    area: project.area,
    status: project.status,
    start_date: project.startDate,
    planned_end_date: project.plannedEndDate,
    city: project.city ?? null,
    state: project.state ?? null,
    ibge_code: project.ibgeCode ?? null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'project_key' });
  if (error) throw error;
}
