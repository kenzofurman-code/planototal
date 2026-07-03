import { supabase } from './supabase';

export type AppUser = { id: string; email: string };
export type ProjectAccess = { userId: string; projectKey: string };

export async function loadAccessAdminData() {
  if (!supabase) return { users: [], projects: [], access: [] };
  const [users, projects, access] = await Promise.all([
    supabase.from('app_users').select('id,email').order('email'),
    supabase.from('projects').select('project_key,name').order('name'),
    supabase.from('user_project_access').select('user_id,project_key')
  ]);
  if (users.error) throw users.error;
  if (projects.error) throw projects.error;
  if (access.error) throw access.error;
  return {
    users: (users.data ?? []) as AppUser[],
    projects: (projects.data ?? []) as Array<{ project_key: string; name: string }>,
    access: (access.data ?? []).map((row) => ({ userId: row.user_id, projectKey: row.project_key })) as ProjectAccess[]
  };
}

export async function setProjectAccess(userId: string, projectKey: string, enabled: boolean) {
  if (!supabase) return;
  if (enabled) {
    const { error } = await supabase.from('user_project_access').upsert(
      { user_id: userId, project_key: projectKey },
      { onConflict: 'user_id,project_key' }
    );
    if (error) throw error;
  } else {
    const { error } = await supabase.from('user_project_access').delete().eq('user_id', userId).eq('project_key', projectKey);
    if (error) throw error;
  }
}

