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

export async function uploadProjectImage(projectId: string, file: File) {
  if (!supabase) throw new Error('Supabase não está configurado.');
  if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');
  if (file.size > 5 * 1024 * 1024) throw new Error('A imagem deve ter no máximo 5 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${projectId}/cover-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from('project-images').upload(path, file, { cacheControl: '3600', upsert: true });
  if (error) throw error;
  return supabase.storage.from('project-images').getPublicUrl(path).data.publicUrl;
}
