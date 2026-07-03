import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { loadAccessAdminData, setProjectAccess, type AppUser, type ProjectAccess } from '../lib/accessRepository';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export function AuthGate({ children }: { children: (userId: string) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [admin, setAdmin] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChecking(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (checking) return <div className="auth-shell"><p>Verificando acesso...</p></div>;
  if (admin) return <AdminScreen onExit={() => { setAdmin(false); setAdminOpen(false); }} />;
  if (session) return <>{children(session.user.id)}</>;

  async function submit() {
    setMessage('');
    if (!supabase) {
      setMessage('Supabase não configurado.');
      return;
    }
    const result = mode === 'login'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (result.error) setMessage(result.error.message);
    else if (mode === 'signup' && !result.data.session) setMessage('Cadastro realizado. Confirme o e-mail para entrar.');
  }

  async function resetPassword() {
    setMessage('');
    if (!supabase) return setMessage('Supabase não configurado.');
    if (!email.trim()) return setMessage('Informe seu e-mail para recuperar a senha.');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin
    });
    setMessage(error ? error.message : 'Enviamos as instruções de recuperação para o seu e-mail.');
  }

  return (
    <main className="auth-shell">
      <button className="admin-entry" onClick={() => setAdminOpen(true)}>Admin</button>
      <section className="auth-card">
        <div className="auth-brand">Plano Total</div>
        <h1>{mode === 'login' ? 'Acessar sua conta' : 'Criar sua conta'}</h1>
        <p>Entre com seu e-mail e senha para acessar suas obras.</p>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label>E-mail<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Senha<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {mode === 'login' && <button className="forgot-password" type="button" onClick={() => void resetPassword()}>Esqueci minha senha</button>}
          {message && <p className="form-error">{message}</p>}
          <button className="primary" type="submit">{mode === 'login' ? 'Entrar' : 'Cadastrar'}</button>
        </form>
        <p className="auth-register-prompt">
          {mode === 'login' ? 'Ainda não tem uma conta? ' : 'Já tem uma conta? '}
          <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }}>
            {mode === 'login' ? 'Crie agora mesmo!' : 'Entre agora!'}
          </button>
        </p>
        <button className="auth-switch auth-switch-old" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }}>
          {mode === 'login' ? 'Ainda não tenho cadastro' : 'Já tenho cadastro'}
        </button>
      </section>
      {adminOpen && (
        <div className="auth-modal-backdrop">
          <form className="auth-modal" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            if (form.get('user') === 'admin' && form.get('password') === 'admin') setAdmin(true);
            else setMessage('Usuário ou senha de administrador inválidos.');
          }}>
            <button type="button" className="drawer-close" onClick={() => setAdminOpen(false)}>×</button>
            <h2>Acesso administrativo</h2>
            <label>Usuário<input name="user" required /></label>
            <label>Senha<input name="password" type="password" required /></label>
            {message && <p className="form-error">{message}</p>}
            <button className="primary" type="submit">Entrar como admin</button>
          </form>
        </div>
      )}
    </main>
  );
}

function AdminScreen({ onExit }: { onExit: () => void }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [projects, setProjects] = useState<Array<{ project_key: string; name: string }>>([]);
  const [access, setAccess] = useState<ProjectAccess[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadAccessAdminData().then((data) => {
      setUsers(data.users);
      setProjects(data.projects);
      setAccess(data.access);
    }).catch((caught) => setError((caught as { message?: string }).message ?? 'Falha ao carregar o painel.'));
  }, []);

  return (
    <main className="admin-page">
      <header><div><h1>Administração</h1><p>Vincule usuários às obras disponíveis.</p></div><button onClick={onExit}>Sair do admin</button></header>
      {error && <p className="form-error">{error}</p>}
      <section className="card">
        <h2>Usuários e obras</h2>
        {!users.length && <p>Nenhum usuário cadastrado ainda.</p>}
        {users.map((user) => (
          <div className="admin-user" key={user.id}>
            <strong>{user.email}</strong>
            <div>
              {projects.map((project) => {
                const checked = access.some((item) => item.userId === user.id && item.projectKey === project.project_key);
                return <label key={project.project_key}><input type="checkbox" checked={checked} onChange={async (event) => {
                  const enabled = event.target.checked;
                  await setProjectAccess(user.id, project.project_key, enabled);
                  setAccess((current) => enabled
                    ? [...current, { userId: user.id, projectKey: project.project_key }]
                    : current.filter((item) => item.userId !== user.id || item.projectKey !== project.project_key));
                }} />{project.name}</label>;
              })}
            </div>
          </div>
        ))}
      </section>
      <section className="card"><h2>Obras</h2>{projects.map((project) => <p key={project.project_key}>{project.name}</p>)}</section>
    </main>
  );
}
