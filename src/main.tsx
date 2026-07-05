import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import * as XLSX from 'xlsx';
import { BarChart3, Building2, CalendarRange, ChevronLeft, ChevronRight, CheckSquare, Download, FileSpreadsheet, Home, KanbanSquare, LineChart, Link2, ArrowLeftRight, Search, Menu, Settings, Trash2, MapPin, Ruler, ImagePlus, Users, CloudRain, Plus, Upload, Lock, Unlock } from 'lucide-react';
import { procurement } from './demoData';
import { addDays, diffDays, parseDate, toIsoDate } from './lib/date';
import { saveCalendarEvents } from './lib/calendarRepository';
import { loadLineBalanceData, saveLineBalanceData } from './lib/lineBalanceRepository';
import { saveProject, uploadProjectImage } from './lib/projectRepository';
import { deleteProjectBudget, saveScheduleTasks } from './lib/scheduleRepository';
import { deleteBudget as deleteSavedBudget, loadBudgetRevisionName, loadBudgets, loadFinancialLotAreas, saveBudget, saveBudgetAllocations, saveBudgetRevisionName, saveFinancialLotAreas, type BudgetItem, type BudgetRevision, type BudgetType } from './lib/budgetRepository';
import { createScheduleVersion, deleteScheduleVersion, loadScheduleVersions, selectScheduleVersion, updateActiveScheduleVersion, type SavedScheduleVersion } from './lib/scheduleVersionRepository';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { ShortTerm } from './components/ShortTerm';
import { ShortTermTeamScreen } from './components/ShortTermTeamScreen';
import { AuthGate } from './components/AuthGate';
import { setProjectAccess } from './lib/accessRepository';
import { loadMediumWindowState, loadPublishedMediumPlan, saveMediumWindowState, savePublishedMediumPlan } from './lib/mediumPlanRepository';
import { loadWorkspace } from './lib/workspaceRepository';
import { createClimateCity, deleteClimateCity, loadClimateCities, replaceClimateRecords, type ClimateCity, type ClimateImportRow } from './lib/climateRepository';
import type { CalendarEvent, Page, Project, ScheduleDependency, Task } from './types';
import './styles.css';

const pages: Array<{ key: Page; label: string; icon: React.ReactNode }> = [
  { key: 'projects', label: 'Projetos', icon: <Home /> },
  { key: 'workCalendar', label: 'Calendário da obra', icon: <CalendarRange /> },
  { key: 'dashboard', label: 'Dashboard', icon: <BarChart3 /> },
  { key: 'schedule', label: 'Cronograma', icon: <FileSpreadsheet /> },
  { key: 'line', label: 'Linha de balanço', icon: <Building2 /> },
  { key: 'procurement', label: 'Compras', icon: <KanbanSquare /> },
  { key: 'medium', label: 'Médio prazo', icon: <CalendarRange /> },
  { key: 'short', label: 'Curto prazo', icon: <CheckSquare /> },
  { key: 'financial', label: 'Físico-financeiro', icon: <LineChart /> },
  { key: 'settings', label: 'Configurações', icon: <Settings /> }
];

const projectStart = parseDate('2025-08-01');
const chartEnd = parseDate('2026-12-01');
const zoomPx: Record<number, number> = {
  1: 4.8,
  2: 6.5,
  3: 8.5,
  4: 11,
  5: 14,
  6: 18,
  7: 24
};

function App({ userId }: { userId: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const [page, setPage] = useState<Page>('projects');
  const [projectList, setProjectList] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [latestMediumTasks, setLatestMediumTasks] = useState<Task[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const [creatingFirstProject, setCreatingFirstProject] = useState(false);

  // Interceptação do modo WhatsApp / Apontamento de Equipe de Campo
  const urlParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const isTeamMode = urlParams.get('mode') === 'team';
  const urlTeamName = urlParams.get('t') || '';
  const urlWeekStartDate = urlParams.get('w') || '';

  const urlProjectId = urlParams.get('u') || '';

  if (isTeamMode) {
    return (
      <ShortTermTeamScreen 
        projectId={urlProjectId || (project ? project.id : '')} 
        teamName={urlTeamName} 
        weekStartDate={urlWeekStartDate} 
      />
    );
  }

  useEffect(() => {
    let active = true;
    setWorkspaceLoaded(false);
    setWorkspaceError('');
    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error('Tempo limite excedido ao conectar com o Supabase.')), 15000);
    });
    void Promise.race([loadWorkspace(userId), timeout])
      .then((workspace) => {
        if (!active) return;
        if (workspace?.projects?.length) {
          setProjectList(workspace.projects);
          setProject(workspace.projects[0]);
        } else {
          setProjectList([]);
          setProject(null);
        }
        setTasks(workspace?.tasks?.length ? workspace.tasks : []);
        setCalendarEvents(workspace?.calendarEvents ?? []);
        setWorkspaceLoaded(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setProjectList([]);
        setProject(null);
        setTasks([]);
        const supabaseError = error as { message?: string; details?: string; hint?: string; code?: string } | null;
        const detail = [
          supabaseError?.message,
          supabaseError?.details,
          supabaseError?.hint,
          supabaseError?.code ? `Código: ${supabaseError.code}` : ''
        ].filter(Boolean).join(' · ');
        setWorkspaceError(detail || 'Não foi possível carregar o workspace.');
        setWorkspaceLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [workspaceReload, userId]);

  useEffect(() => {
    if (!workspaceLoaded || !project) return;
    let active = true;
    void loadPublishedMediumPlan(project.id)
      .then((published) => {
        if (!active || !published?.length) return;
        setLatestMediumTasks(published);
      })
      .catch(() => {
        if (active) setLatestMediumTasks([]);
      });
    return () => {
      active = false;
    };
  }, [project, workspaceLoaded]);

  async function handleMediumPublish(published: Task[]) {
    if (!project) return;
    setLatestMediumTasks(published);
    try {
      await savePublishedMediumPlan(project.id, published);
    } catch {
      // Mantém o fluxo local mesmo se o snapshot persistido falhar.
    }
  }

  if (!workspaceLoaded) {
    return <div className="app"><main className="page"><p>Carregando workspace do Supabase...</p></main></div>;
  }

  async function handleCreateProject(created: Project) {
    setCreatingFirstProject(true);
    try {
      await saveProject(created);
      await setProjectAccess(userId, created.id, true);
      setProjectList((current) => [...current, created]);
      setProject(created);
      setPage('projects');
      setWorkspaceError('');
    } finally {
      setCreatingFirstProject(false);
    }
  }

  if (workspaceError || !project) {
    return (
      <div className="app">
        <main className="page">
          <section className="panel" style={{ maxWidth: 720, margin: '48px auto' }}>
            <h2>{workspaceError ? 'Não foi possível conectar ao Supabase' : 'Nenhum projeto encontrado'}</h2>
            {workspaceError ? (
              <>
                <p>{workspaceError}</p>
                <button className="primary" onClick={() => setWorkspaceReload((value) => value + 1)}>Tentar novamente</button>
              </>
            ) : (
              <>
                <p>A conexão está pronta. Cadastre a primeira obra para começar.</p>
                <ProjectForm onSubmit={handleCreateProject} submitting={creatingFirstProject} />
              </>
            )}
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <button className="menu-button" onClick={() => setCollapsed(!collapsed)}>
          <Menu />
        </button>
        {pages.map((item) => (
          <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => setPage(item.key)} title={item.label}>
            {item.icon}
            {!collapsed && <span>{item.label}</span>}
          </button>
        ))}
      </aside>

      <main>
        <header className="topbar">
          <div>
            <strong>{project.name}</strong>
            <span>{project.address}</span>
          </div>
          <div className="topbar-session">
            <b className="pill">{isSupabaseConfigured ? 'Supabase conectado' : 'Modo demo local'}</b>
            <button onClick={() => void supabase?.auth.signOut()}>Sair</button>
          </div>
        </header>

        {page === 'projects' && (
          <Projects
            projects={projectList}
            selected={project}
            onUpdate={(updated) => {
              setProjectList(projectList.map((item) => (item.id === updated.id ? updated : item)));
              if (project.id === updated.id) setProject(updated);
              void saveProject(updated);
            }}
            onCreate={handleCreateProject}
            onCalendar={() => setPage('globalCalendar')}
            onClimate={() => setPage('climate')}
            onSelect={(p) => {
              setProject(p);
              setPage('dashboard');
            }}
          />
        )}
        {page === 'climate' && <ClimateData onBack={() => setPage('projects')} />}
        {page === 'globalCalendar' && <AnnualCalendar projects={projectList} title="Calendário geral" subtitle="Feriados nacionais e datas compartilhadas entre todas as obras." events={calendarEvents.filter((event) => !event.projectId)} onChange={(events) => { const next = [...calendarEvents.filter((event) => event.projectId), ...events]; setCalendarEvents(next); void saveCalendarEvents('global', next); }} />}
        {page === 'workCalendar' && <AnnualCalendar projects={projectList} projectId={project.id} title={`Calendário · ${project.name}`} subtitle="Rotinas, feriados e datas importantes desta obra." events={calendarEvents.filter((event) => event.projectId === project.id || (!event.projectId && (event.appliesToAll || event.projectIds?.includes(project.id))))} onChange={(events) => { const next = [...calendarEvents.filter((event) => event.projectId !== project.id && event.projectId), ...calendarEvents.filter((event) => !event.projectId), ...events.filter((event) => event.projectId === project.id)]; setCalendarEvents(next); void saveCalendarEvents(project.id, next); }} />}
        {page === 'dashboard' && <Dashboard tasks={tasks} />}
        {page === 'schedule' && <Schedule projectKey={project.id} tasks={tasks} setTasks={setTasks} />}
        {page === 'line' && <LineBalance projectKey={project.id} projectStartDate={project.startDate} plannedEndDate={project.plannedEndDate} tasks={tasks} setTasks={setTasks} holidays={calendarEvents.filter((event) => event.kind === 'holiday' && (event.projectId === project.id || (!event.projectId && (event.appliesToAll || event.projectIds?.includes(project.id)))))} />}
        {page === 'procurement' && <Procurement />}
        {page === 'medium' && <MediumPlan tasks={tasks} projectId={project.id} onPublish={handleMediumPublish} />}
        {page === 'short' && <ShortTerm tasks={latestMediumTasks.length ? latestMediumTasks : tasks} projectId={project.id} />}
        {page === 'financial' && <Financial projectKey={project.id} tasks={tasks} setTasks={setTasks} />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

function PageHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}

function emptyProject(): Project {
  const today = new Date();
  const end = new Date(today);
  end.setFullYear(end.getFullYear() + 2);
  return {
    id: crypto.randomUUID(),
    name: '',
    imageUrl: '',
    address: '',
    area: 0,
    status: 'ativo',
    startDate: toIsoDate(today),
    plannedEndDate: toIsoDate(end),
    city: '',
    state: '',
    ibgeCode: ''
  };
}

function ProjectForm({ onSubmit, submitting = false }: { onSubmit: (project: Project) => void | Promise<void>; submitting?: boolean }) {
  const [draft, setDraft] = useState<Project>(emptyProject);
  const [error, setError] = useState('');
  return (
    <form className="project-form" onSubmit={async (event) => {
      event.preventDefault();
      setError('');
      try {
        await onSubmit({ ...draft, address: [draft.city, draft.state].filter(Boolean).join(' - ') });
      } catch (caught) {
        setError((caught as { message?: string })?.message ?? 'Não foi possível salvar o projeto.');
      }
    }}>
      <label>Nome da obra<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <div className="project-form-row">
        <label>Cidade<input required value={draft.city ?? ''} onChange={(event) => setDraft({ ...draft, city: event.target.value })} /></label>
        <label>UF<input required maxLength={2} value={draft.state ?? ''} onChange={(event) => setDraft({ ...draft, state: event.target.value.toUpperCase() })} /></label>
      </div>
      <div className="project-form-row">
        <label>Data de início<input required type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
        <label>Término previsto<input required type="date" value={draft.plannedEndDate} onChange={(event) => setDraft({ ...draft, plannedEndDate: event.target.value })} /></label>
      </div>
      <label>Área (m²)<input min="0" type="number" value={draft.area || ''} onChange={(event) => setDraft({ ...draft, area: Number(event.target.value) })} /></label>
      {error && <p className="form-error">{error}</p>}
      <button className="primary" type="submit" disabled={submitting}>{submitting ? 'Criando projeto...' : 'Criar projeto'}</button>
    </form>
  );
}

function Projects({ projects: items, selected, onSelect, onCalendar, onClimate, onUpdate, onCreate }: { projects: Project[]; selected: Project; onSelect: (p: Project) => void; onCalendar: () => void; onClimate: () => void; onUpdate: (p: Project) => void; onCreate: (p: Project) => void | Promise<void> }) {
  const [editing, setEditing] = useState<Project | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState('');
  const cityOptions = [
    { city: 'Curitiba', state: 'PR', ibge: '4106902' },
    { city: 'São Paulo', state: 'SP', ibge: '3550308' },
    { city: 'Rio de Janeiro', state: 'RJ', ibge: '3304557' },
    { city: 'Belo Horizonte', state: 'MG', ibge: '3106200' },
    { city: 'Florianópolis', state: 'SC', ibge: '4205407' },
    { city: 'Porto Alegre', state: 'RS', ibge: '4314902' }
  ];
  return (
    <section className="page">
      <PageHeader title="Meus projetos" subtitle="Selecione uma obra abaixo para acessar as medições e o planejamento.">
        <button onClick={onClimate}>
          <CloudRain size={17} /> Dados Clima
        </button>
        <button onClick={onCalendar}>
          <CalendarRange size={17} /> Calendário
        </button>
        <button className="primary" onClick={() => setEditing(emptyProject())}>Novo projeto</button>
      </PageHeader>
      <div className="project-grid">
        {items.map((p) => (
          <article className={`project-card ${selected.id === p.id ? 'selected' : ''}`} key={p.id}>
            <header className="project-card-header">
              <h2>{p.name}</h2>
              <span>Obra</span>
            </header>
            {p.imageUrl ? <img src={p.imageUrl} alt={`Foto da obra ${p.name}`} /> : (
              <div className="project-image-placeholder"><Building2 size={38} /><span>Adicione uma foto da obra</span></div>
            )}
            <div className="project-card-details">
              <p><Ruler size={17} /><strong>{p.area.toLocaleString('pt-BR')} m²</strong></p>
              <p><Users size={17} /><span>Equipe da obra</span></p>
              <p><MapPin size={17} /><span>{p.address || 'Endereço não informado'}</span></p>
            </div>
            <footer className="project-card-actions">
              <button className="primary project-select" onClick={() => onSelect(p)}>Selecionar</button>
              <button className="project-edit"
                onClick={() =>
                  setEditing({
                    ...p,
                    city: p.city ?? p.address.split(' - ')[0],
                    state: p.state ?? p.address.split(' - ')[1]
                  })
                }
              >
                Editar projeto
              </button>
            </footer>
          </article>
        ))}
      </div>
      <aside className={`calendar-drawer ${editing ? 'open' : ''}`}>
        <button className="drawer-close" onClick={() => setEditing(null)}>
          ×
        </button>
        {editing && (
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const saved = {
                ...editing,
                address: `${editing.city ?? ''} - ${editing.state ?? ''}`
              };
              if (items.some((item) => item.id === editing.id)) onUpdate(saved);
              else await onCreate(saved);
              setEditing(null);
            }}
          >
            <h3>{items.some((item) => item.id === editing.id) ? 'Editar projeto' : 'Novo projeto'}</h3>
            <label className="project-image-upload">
              Foto da obra
              <span className="project-upload-preview">
                {editing.imageUrl ? <img src={editing.imageUrl} alt="Prévia da obra" /> : <><ImagePlus size={28} />Escolher imagem</>}
              </span>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploadingImage} onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setImageError('');
                setUploadingImage(true);
                try {
                  const imageUrl = await uploadProjectImage(editing.id, file);
                  setEditing((current) => current ? { ...current, imageUrl } : current);
                } catch (caught) {
                  setImageError((caught as { message?: string })?.message ?? 'Não foi possível enviar a imagem.');
                } finally {
                  setUploadingImage(false);
                }
              }} />
              <small>{uploadingImage ? 'Enviando imagem...' : 'JPG, PNG ou WebP · máximo 5 MB'}</small>
              {imageError && <span className="form-error">{imageError}</span>}
            </label>
            <label>
              Nome
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </label>
            <label>
              Cidade
              <input
                list="project-cities"
                value={editing.city ?? ''}
                onChange={(e) => {
                  const match = cityOptions.find((item) => item.city === e.target.value);
                  setEditing({
                    ...editing,
                    city: e.target.value,
                    state: match?.state ?? editing.state,
                    ibgeCode: match?.ibge ?? editing.ibgeCode
                  });
                }}
              />
            </label>
            <datalist id="project-cities">
              {cityOptions.map((item) => (
                <option key={item.ibge} value={item.city}>
                  {item.state}
                </option>
              ))}
            </datalist>
            <label>
              UF
              <input
                maxLength={2}
                value={editing.state ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    state: e.target.value.toUpperCase()
                  })
                }
              />
            </label>
            <label>
              Código IBGE
              <input value={editing.ibgeCode ?? ''} onChange={(e) => setEditing({ ...editing, ibgeCode: e.target.value })} />
            </label>
            <label>
              Área (m²)
              <input type="number" value={editing.area} onChange={(e) => setEditing({ ...editing, area: Number(e.target.value) })} />
            </label>
            <label>
              Início
              <input type="date" value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} />
            </label>
            <label>
              Término previsto
              <input type="date" value={editing.plannedEndDate} onChange={(e) => setEditing({ ...editing, plannedEndDate: e.target.value })} />
            </label>
            <button className="primary" type="submit" disabled={uploadingImage}>
              {uploadingImage ? 'Aguarde o envio...' : 'Salvar projeto'}
            </button>
          </form>
        )}
      </aside>
    </section>
  );
}

function climateDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}` : null;
  }
  const text = String(value ?? '').trim();
  const br = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  const iso = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  return null;
}

function displayClimateDate(value: string | null) {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function ClimateData({ onBack }: { onBack: () => void }) {
  const [cities, setCities] = useState<ClimateCity[]>([]);
  const [cityName, setCityName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyCity, setBusyCity] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      setCities(await loadClimateCities());
      setError('');
    } catch (caught) {
      setError((caught as { message?: string })?.message ?? 'Não foi possível carregar os dados climáticos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function addCity(event: React.FormEvent) {
    event.preventDefault();
    if (!cityName.trim()) return;
    try {
      await createClimateCity(cityName);
      setCityName('');
      await refresh();
    } catch (caught) {
      setError((caught as { message?: string })?.message ?? 'Não foi possível adicionar a cidade.');
    }
  }

  async function importFile(city: ClimateCity, file: File) {
    setBusyCity(city.id);
    setError('');
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
      if (!rawRows.length) throw new Error('A planilha não contém registros.');
      const dateColumn = Object.keys(rawRows[0]).find((key) => key.trim().toLocaleLowerCase('pt-BR') === 'data');
      if (!dateColumn) throw new Error('A coluna "Data" não foi encontrada na primeira linha da planilha.');
      const rows: ClimateImportRow[] = rawRows.map((row) => ({
        observationDate: climateDate(row[dateColumn]),
        data: row
      })).filter((row): row is ClimateImportRow => Boolean(row.observationDate));
      if (!rows.length) throw new Error('Nenhuma data válida foi encontrada na coluna "Data".');
      await replaceClimateRecords(city.id, rows);
      await refresh();
    } catch (caught) {
      setError((caught as { message?: string })?.message ?? 'Não foi possível importar a planilha.');
    } finally {
      setBusyCity('');
    }
  }

  return (
    <section className="page climate-page">
      <PageHeader title="Dados Clima" subtitle="Cadastre cidades e mantenha o histórico climático importado por Excel.">
        <button onClick={onBack}><ChevronLeft size={17} /> Meus projetos</button>
      </PageHeader>
      <form className="climate-add" onSubmit={(event) => void addCity(event)}>
        <label>Nova cidade<input placeholder="Ex.: Curitiba" value={cityName} onChange={(event) => setCityName(event.target.value)} /></label>
        <button className="primary" type="submit" disabled={!cityName.trim()}><Plus size={17} /> Adicionar linha</button>
      </form>
      {error && <p className="form-error climate-error">{error}</p>}
      <div className="card climate-table-wrap">
        <table className="climate-table">
          <thead><tr><th>Cidade</th><th>Início Banco</th><th>Término Banco</th><th>Registros</th><th>Ações</th></tr></thead>
          <tbody>
            {cities.map((city) => (
              <tr key={city.id}>
                <td><strong>{city.name}</strong></td>
                <td>{displayClimateDate(city.startDate)}</td>
                <td>{displayClimateDate(city.endDate)}</td>
                <td>{city.recordCount.toLocaleString('pt-BR')}</td>
                <td className="climate-actions">
                  <label className={`file-button ${busyCity === city.id ? 'disabled' : ''}`}>
                    <Upload size={16} /> {busyCity === city.id ? 'Importando...' : 'Importar'}
                    <input type="file" accept=".xlsx,.xls,.csv" disabled={Boolean(busyCity)} onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importFile(city, file);
                      event.target.value = '';
                    }} />
                  </label>
                  <button className="danger-button" disabled={Boolean(busyCity)} onClick={async () => {
                    if (!window.confirm(`Excluir ${city.name} e todos os seus dados climáticos?`)) return;
                    try {
                      await deleteClimateCity(city.id);
                      await refresh();
                    } catch (caught) {
                      setError((caught as { message?: string })?.message ?? 'Não foi possível excluir a cidade.');
                    }
                  }}><Trash2 size={16} /> Excluir</button>
                </td>
              </tr>
            ))}
            {!loading && !cities.length && <tr><td colSpan={5} className="climate-empty">Nenhuma cidade cadastrada.</td></tr>}
            {loading && <tr><td colSpan={5} className="climate-empty">Carregando...</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AnnualCalendar({ title, subtitle, events, onChange, projects: projectOptions, projectId }: { title: string; subtitle: string; events: CalendarEvent[]; onChange: (events: CalendarEvent[]) => void; projects: Project[]; projectId?: string }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState({
    date: `${year}-01-01`,
    title: '',
    kind: 'holiday' as CalendarEvent['kind'],
    color: '#ef4444',
    appliesToAll: true,
    projectIds: [] as string[]
  });
  const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  function openDate(date?: string) {
    setDraft({
      date: date ?? `${year}-01-01`,
      title: '',
      kind: 'holiday',
      color: '#ef4444',
      appliesToAll: true,
      projectIds: []
    });
    setDrawerOpen(true);
  }
  function saveEvent(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return;
    onChange([...events, { id: crypto.randomUUID(), ...draft, projectId }]);
    setDrawerOpen(false);
  }

  return (
    <section className="page calendar-page">
      <PageHeader title={title} subtitle={subtitle}>
        <button onClick={() => openDate()}>Cadastrar data</button>
      </PageHeader>
      <div className="calendar-year-nav">
        <button aria-label="Ano anterior" onClick={() => setYear(year - 1)}>
          <ChevronLeft />
        </button>
        <h2>{year}</h2>
        <button aria-label="Próximo ano" onClick={() => setYear(year + 1)}>
          <ChevronRight />
        </button>
      </div>
      <div className="year-calendar">
        {Array.from({ length: 12 }).map((_, month) => {
          const firstDay = new Date(year, month, 1).getDay();
          const days = new Date(year, month + 1, 0).getDate();
          return (
            <article className="calendar-month" key={month}>
              <h3>
                {new Date(year, month, 1).toLocaleDateString('pt-BR', {
                  month: 'long'
                })}
              </h3>
              <div className="calendar-weekdays">
                {weekdays.map((day, index) => (
                  <span key={`${day}-${index}`}>{day}</span>
                ))}
              </div>
              <div className="calendar-days">
                {Array.from({ length: firstDay }).map((_, index) => (
                  <span className="calendar-day empty" key={`empty-${index}`} />
                ))}
                {Array.from({ length: days }).map((_, index) => {
                  const day = index + 1;
                  const date = toIsoDate(new Date(year, month, day));
                  const dayEvents = events.filter((item) => item.date === date);
                  const weekend = [0, 6].includes(new Date(year, month, day).getDay());
                  return (
                    <button className={`calendar-day ${weekend ? 'weekend' : 'workday'}`} key={day} onClick={() => openDate(date)}>
                      <b>{day}</b>
                      {dayEvents.map((item) => {
                        const scope = item.projectId
                          ? projectOptions.find((project) => project.id === item.projectId)?.name
                          : item.appliesToAll
                            ? 'Todas as obras'
                            : projectOptions
                                .filter((project) => item.projectIds?.includes(project.id))
                                .map((project) => project.name)
                                .join(', ');
                        return <i key={item.id} title={`${item.title} · ${scope || 'Calendário geral'}`} style={{ background: item.color }} />;
                      })}
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
      <aside className={`calendar-drawer ${drawerOpen ? 'open' : ''}`}>
        <button className="drawer-close" onClick={() => setDrawerOpen(false)}>
          ×
        </button>
        <h3>Nova marcação</h3>
        <form onSubmit={saveEvent}>
          <label>
            Data
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
          <label>
            Descrição
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Nome do feriado ou rotina" />
          </label>
          <label>
            Tipo
            <select
              value={draft.kind}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  kind: e.target.value as CalendarEvent['kind']
                })
              }
            >
              <option value="holiday">Feriado</option>
              <option value="routine">Rotina</option>
              <option value="important">Data importante</option>
            </select>
          </label>
          <label>
            Cor
            <input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} />
          </label>
          {!projectId && (
            <>
              <label className="calendar-check">
                <input type="checkbox" checked={draft.appliesToAll} onChange={(e) => setDraft({ ...draft, appliesToAll: e.target.checked })} /> Aplicar a todas as obras
              </label>
              {!draft.appliesToAll && (
                <fieldset>
                  <legend>Obras aplicáveis</legend>
                  {projectOptions.map((project) => (
                    <label className="calendar-check" key={project.id}>
                      <input
                        type="checkbox"
                        checked={draft.projectIds.includes(project.id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            projectIds: e.target.checked ? [...draft.projectIds, project.id] : draft.projectIds.filter((id) => id !== project.id)
                          })
                        }
                      />{' '}
                      {project.name}
                    </label>
                  ))}
                </fieldset>
              )}
            </>
          )}
          <button className="primary" type="submit">
            Salvar marcação
          </button>
        </form>
        <h4>Marcações deste calendário</h4>
        <div className="calendar-event-list">
          {events
            .filter((item) => item.date.startsWith(String(year)))
            .map((item) => (
              <div key={item.id}>
                <i style={{ background: item.color }} />
                <span>
                  <b>{item.title}</b>
                  <small>{parseDate(item.date).toLocaleDateString('pt-BR')}</small>
                </span>
                <button onClick={() => onChange(events.filter((event) => event.id !== item.id))}>×</button>
              </div>
            ))}
        </div>
      </aside>
    </section>
  );
}

function Dashboard({ tasks }: { tasks: Task[] }) {
  const progress = tasks.reduce((sum, t) => sum + t.progress, 0) / tasks.length;
  const pendingPurchases = procurement.filter((p) => p.coverage < 100).length;
  return (
    <section className="page">
      <PageHeader title="Dashboard" subtitle="Resumo executivo da obra." />
      <div className="metric-grid">
        <Metric label="Avanço médio" value={`${progress.toFixed(1)}%`} />
        <Metric label="Atividades longo prazo" value={String(tasks.length)} />
        <Metric label="Compras pendentes" value={String(pendingPurchases)} />
        <Metric label="Alvenaria curto prazo" value="60%" />
      </div>
      <div className="card flow">Longo prazo → Médio prazo → Curto prazo → Medição → Retroalimentação</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

type ImportField = 'id' | 'packageName' | 'service' | 'lot' | 'lotMother' | 'startDate' | 'endDate' | 'duration' | 'cost' | 'predecessors' | 'successors' | 'responsible' | 'progress';
const importFields: Array<{
  key: ImportField;
  label: string;
  required: boolean;
  aliases: string[];
}> = [
  { key: 'id', label: 'ID', required: true, aliases: ['id'] },
  {
    key: 'packageName',
    label: 'Pacote de trabalho',
    required: true,
    aliases: ['pacote de trabalho/tarefas', 'pacote de trabalho']
  },
  {
    key: 'service',
    label: 'Serviço',
    required: true,
    aliases: ['serviço', 'servico']
  },
  { key: 'lot', label: 'Lote', required: true, aliases: ['lote'] },
  {
    key: 'lotMother',
    label: 'Lote mãe',
    required: true,
    aliases: ['lote mãe', 'grupo de replicação']
  },
  {
    key: 'startDate',
    label: 'Data de início',
    required: true,
    aliases: ['data de início', 'data de inicio']
  },
  {
    key: 'endDate',
    label: 'Data de término',
    required: true,
    aliases: ['data de término', 'data de termino']
  },
  {
    key: 'duration',
    label: 'Duração',
    required: true,
    aliases: ['duração', 'duracao']
  },
  {
    key: 'cost',
    label: 'Custo vinculado importado',
    required: false,
    aliases: ['custo vinculado atual']
  },
  {
    key: 'predecessors',
    label: 'Predecessoras',
    required: false,
    aliases: ['predecessoras']
  },
  {
    key: 'successors',
    label: 'Sucessoras',
    required: false,
    aliases: ['sucessoras']
  },
  {
    key: 'responsible',
    label: 'Responsáveis',
    required: false,
    aliases: ['responsáveis', 'responsaveis']
  },
  {
    key: 'progress',
    label: 'Realizado',
    required: true,
    aliases: ['realizado']
  }
];

function Schedule({ projectKey, tasks, setTasks }: { projectKey: string; tasks: Task[]; setTasks: (tasks: Task[]) => void }) {
  const [importData, setImportData] = useState<{
    fileName: string;
    rows: unknown[][];
    headerRow: number;
  } | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [savedVersions, setSavedVersions] = useState<SavedScheduleVersion[]>([]);
  const [versionMessage, setVersionMessage] = useState('');

  async function refreshVersions() {
    try {
      setSavedVersions(await loadScheduleVersions(projectKey));
      setVersionMessage('');
    } catch (error) {
      setVersionMessage((error as Error).message);
    }
  }
  useEffect(() => { void refreshVersions(); }, [projectKey]);

  async function createCopy() {
    await createScheduleVersion(projectKey, `Cronograma V${String(savedVersions.length + 1).padStart(2, '0')}`, tasks, savedVersions.length === 0);
    await refreshVersions();
  }
  async function chooseVersion(version: SavedScheduleVersion, field: 'is_active' | 'is_baseline') {
    await selectScheduleVersion(projectKey, version.id, field);
    if (field === 'is_active') {
      const snapshot = version.tasks.map((task) => ({ ...task }));
      setTasks(snapshot);
      await saveScheduleTasks(projectKey, snapshot);
    }
    await refreshVersions();
  }
  async function removeVersion(version: SavedScheduleVersion) {
    if (!window.confirm(`Excluir "${version.name}"?`)) return;
    await deleteScheduleVersion(projectKey, version.id);
    await refreshVersions();
  }

  async function readFile(file: File) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false
    });
    const headerRow = 4;
    setImportData({ fileName: file.name, rows, headerRow });
    setMapping(detectMapping(rows[headerRow - 1] ?? []));
  }
  function detectMapping(headers: unknown[]) {
    const result: Partial<Record<ImportField, number>> = {};
    importFields.forEach((field) => {
      const index = headers.findIndex((header) => field.aliases.includes(String(header).trim().toLocaleLowerCase('pt-BR')));
      if (index >= 0) result[field.key] = index;
    });
    return result;
  }
  function updateHeaderRow(value: number) {
    if (!importData) return;
    const headerRow = Math.max(1, value);
    setImportData({ ...importData, headerRow });
    setMapping(detectMapping(importData.rows[headerRow - 1] ?? []));
  }
  function importSchedule() {
    if (!importData) return;
    const missing = importFields.filter((field) => field.required && mapping[field.key] === undefined);
    if (missing.length) return;
    const value = (row: unknown[], key: ImportField) => (mapping[key] === undefined ? '' : row[mapping[key]!]);
    const parseImportedDate = (input: unknown) => {
      const text = String(input ?? '').trim();
      const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : text.slice(0, 10);
    };
    const splitIds = (input: unknown) =>
      String(input ?? '')
        .split(/[;,]/)
        .map((item) =>
          item
            .trim()
            .replace(/\s*(FS|SS|FF|SF)\s*(?:[+-]\s*\d+\s*[a-z]*)?$/i, '')
            .trim()
        )
        .filter((item) => item && item !== '-');
    const parsed = importData.rows
      .slice(importData.headerRow)
      .map((row, index): Task | null => {
        const id = String(value(row, 'id')).trim();
        const startDate = parseImportedDate(value(row, 'startDate'));
        const endDate = parseImportedDate(value(row, 'endDate'));
        if (!id || !startDate || !endDate) return null;
        const rawCost = String(value(row, 'cost')).replace(/[^\d,.-]/g, '');
        const costText = rawCost.includes(',') ? rawCost.replace(/\./g, '').replace(',', '.') : rawCost;
        const service = String(value(row, 'service')).trim();
        return {
          id,
          packageName: String(value(row, 'packageName')).trim() || `Atividade ${index + 1}`,
          packageFamily: String(value(row, 'packageName')).trim().split(' ')[0] || 'OUTROS',
          service,
          services: service && service !== '-' ? [service] : [],
          lot: String(value(row, 'lot')).trim() || 'Sem lote',
          lotMother: String(value(row, 'lotMother')).trim() || 'SEM GRUPO',
          startDate,
          endDate,
          duration: Number(value(row, 'duration')) || undefined,
          cost: Number(costText) || undefined,
          predecessors: splitIds(value(row, 'predecessors')),
          successors: splitIds(value(row, 'successors')),
          responsible: String(value(row, 'responsible')).trim(),
          progress: Math.min(100, Math.max(0, Number(String(value(row, 'progress')).replace(',', '.')) || 0)),
          color: '#4f46e5'
        };
      })
      .filter((task): task is Task => task !== null);
    const parents: Task[] = [];
    const sourceToParent = new Map<string, string>();
    let currentParent: Task | null = null;
    parsed.forEach((task) => {
      const isParent = !task.service || task.service === '-';
      const sameContext = currentParent && currentParent.packageName === task.packageName && currentParent.lot === task.lot && currentParent.lotMother === task.lotMother;
      if (isParent) {
        currentParent = { ...task, service: undefined, services: [] };
        parents.push(currentParent);
        sourceToParent.set(task.id, currentParent.id);
      } else if (sameContext && currentParent) {
        currentParent.services = Array.from(new Set([...(currentParent.services ?? []), task.service!]));
        currentParent.predecessors = Array.from(new Set([...(currentParent.predecessors ?? []), ...(task.predecessors ?? [])]));
        currentParent.successors = Array.from(new Set([...(currentParent.successors ?? []), ...(task.successors ?? [])]));
        sourceToParent.set(task.id, currentParent.id);
      } else {
        currentParent = { ...task, services: [task.service!] };
        parents.push(currentParent);
        sourceToParent.set(task.id, currentParent.id);
      }
    });
    const consolidated = new Map<string, Task>();
    const parentToConsolidated = new Map<string, string>();
    parents.forEach((task) => {
      const key = `${task.lotMother}||${task.lot}||${task.packageName}`.toLocaleLowerCase('pt-BR');
      const existing = consolidated.get(key);
      if (!existing) {
        consolidated.set(key, {
          ...task,
          services: [...(task.services ?? [])]
        });
        parentToConsolidated.set(task.id, task.id);
        return;
      }
      parentToConsolidated.set(task.id, existing.id);
      existing.services = Array.from(new Set([...(existing.services ?? []), ...(task.services ?? [])]));
      if (parseDate(task.startDate) < parseDate(existing.startDate)) existing.startDate = task.startDate;
      if (parseDate(task.endDate) > parseDate(existing.endDate)) existing.endDate = task.endDate;
      existing.duration = diffDays(parseDate(existing.startDate), parseDate(existing.endDate)) + 1;
      existing.predecessors = Array.from(new Set([...(existing.predecessors ?? []), ...(task.predecessors ?? [])]));
      existing.successors = Array.from(new Set([...(existing.successors ?? []), ...(task.successors ?? [])]));
    });
    const resolveImportedId = (id: string) => parentToConsolidated.get(sourceToParent.get(id) ?? id) ?? sourceToParent.get(id) ?? id;
    consolidated.forEach((task) => {
      task.predecessors = Array.from(new Set((task.predecessors ?? []).map(resolveImportedId))).filter((id) => id !== task.id);
      task.successors = Array.from(new Set((task.successors ?? []).map(resolveImportedId))).filter((id) => id !== task.id);
    });
    const consolidatedById = new Map(Array.from(consolidated.values()).map((task) => [task.id, task]));
    consolidated.forEach((task) => {
      task.predecessors?.forEach((predecessorId) => {
        const predecessor = consolidatedById.get(predecessorId);
        if (predecessor) predecessor.successors = Array.from(new Set([...(predecessor.successors ?? []), task.id]));
      });
      task.successors?.forEach((successorId) => {
        const successor = consolidatedById.get(successorId);
        if (successor) successor.predecessors = Array.from(new Set([...(successor.predecessors ?? []), task.id]));
      });
    });
    const palette = ['#4f46e5', '#f97316', '#0f766e', '#a855f7', '#2563eb', '#ca8a04', '#dc2626', '#059669', '#7c3aed', '#475569'];
    const packageIndexes = new Map<string, Map<string, number>>();
    const imported = Array.from(consolidated.values()).map((task) => {
      if (!packageIndexes.has(task.lotMother)) packageIndexes.set(task.lotMother, new Map());
      const groupPackages = packageIndexes.get(task.lotMother)!;
      if (!groupPackages.has(task.packageName)) groupPackages.set(task.packageName, groupPackages.size);
      const index = groupPackages.get(task.packageName)!;
      return {
        ...task,
        color: palette[index % palette.length],
        lane: (index % 3) + 1
      };
    });
    setTasks(imported);
    void saveScheduleTasks(projectKey, imported);
    void createScheduleVersion(projectKey, `Cronograma V${String(savedVersions.length + 1).padStart(2, '0')}`, imported, savedVersions.length === 0).then(refreshVersions);
    setImportData(null);
  }

  return (
    <section className="page">
      <PageHeader title="Cronograma / Importação / Versões" subtitle="Importação, tabela e linha de base.">
        <label className="file-button">
          Importar XLSX/CSV
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
        </label>
        <button onClick={() => void createCopy()}>Criar cópia</button>
      </PageHeader>
      <div className="card">
        <h3>Versões salvas</h3>
        {versionMessage && <p className="form-error">{versionMessage}</p>}
        {!savedVersions.length && <p>Nenhuma versão salva.</p>}
        <div className="version-list">
          {savedVersions.map((version) => (
            <div className="version-row" key={version.id}>
              <div><strong>{version.name}</strong><small>{new Date(version.createdAt).toLocaleString('pt-BR')}</small></div>
              <div className="actions">
                <button className={version.isActive ? 'primary' : ''} onClick={() => void chooseVersion(version, 'is_active')}>
                  {version.isActive ? 'Versão ativa' : 'Definir ativa'}
                </button>
                <button className={version.isBaseline ? 'primary' : ''} onClick={() => void chooseVersion(version, 'is_baseline')}>
                  {version.isBaseline ? 'Linha de base' : 'Usar como linha de base'}
                </button>
                <button disabled={version.isActive} onClick={() => void removeVersion(version)}>Excluir</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Lote-mãe</th>
              <th>Lote</th>
              <th>Pacote</th>
              <th>Início</th>
              <th>Fim</th>
              <th>Avanço</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.lotMother}</td>
                <td>{t.lot}</td>
                <td>{t.packageName}</td>
                <td>{t.startDate}</td>
                <td>{t.endDate}</td>
                <td>{t.progress}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <aside className={`import-drawer ${importData ? 'open' : ''}`}>
        {importData && (
          <>
            <div className="chart-drawer-head">
              <div>
                <small>Importar cronograma</small>
                <h3>Associar colunas</h3>
                <span>{importData.fileName}</span>
              </div>
              <button className="drawer-close" onClick={() => setImportData(null)}>
                ×
              </button>
            </div>
            <div className="chart-drawer-body">
              <label className="import-header-row">
                Linha dos cabeçalhos
                <input type="number" min={1} value={importData.headerRow} onChange={(e) => updateHeaderRow(Number(e.target.value))} />
              </label>
              <p className="import-help">Confirme onde está cada informação. Campos com * são indispensáveis.</p>
              <div className="mapping-grid">
                {importFields.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    {field.required ? ' *' : ''}
                    <select
                      value={mapping[field.key] ?? ''}
                      onChange={(e) =>
                        setMapping({
                          ...mapping,
                          [field.key]: e.target.value === '' ? undefined : Number(e.target.value)
                        })
                      }
                    >
                      <option value="">Não importar</option>
                      {(importData.rows[importData.headerRow - 1] ?? []).map((header, index) => (
                        <option value={index} key={index}>
                          {XLSX.utils.encode_col(index)} · {String(header) || '(sem título)'}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="import-summary">
                <strong>{Math.max(0, importData.rows.length - importData.headerRow)} linhas encontradas</strong>
                <span>{importFields.filter((field) => field.required && mapping[field.key] === undefined).length ? 'Complete os campos obrigatórios.' : 'Mapeamento pronto para importar.'}</span>
              </div>
              <button className="primary import-confirm" disabled={importFields.some((field) => field.required && mapping[field.key] === undefined)} onClick={importSchedule}>
                Importar cronograma
              </button>
            </div>
          </>
        )}
      </aside>
    </section>
  );
}

function LineBalance({ projectKey, projectStartDate, plannedEndDate, tasks, setTasks, holidays }: { projectKey: string; projectStartDate: string; plannedEndDate: string; tasks: Task[]; setTasks: (tasks: Task[]) => void; holidays: CalendarEvent[] }) {
  const [zoom, setZoom] = useState(3);
  const [editMode, setEditMode] = useState(true);
  const [dependencyMode, setDependencyMode] = useState(true);
  const [showDeps, setShowDeps] = useState(true);
  const [snapWeek, setSnapWeek] = useState(false);
  const [allowDependencyGaps, setAllowDependencyGaps] = useState(true);
  const [dependencies, setDependencies] = useState<ScheduleDependency[]>(() =>
    tasks.flatMap((task) =>
      (task.predecessors ?? []).map((from) => ({
        from,
        to: task.id,
        type: 'FS' as const
      }))
    )
  );
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [monthFormat, setMonthFormat] = useState<'index' | 'numeric'>('numeric');
  const [weekFormat, setWeekFormat] = useState<'short' | 'numeric' | 'day'>('day');
  const [versions, setVersions] = useState<
    Array<{
      id: string;
      name: string;
      createdAt: string;
      kind: 'scenario' | 'baseline' | 'planned';
      tasks: Task[];
    }>
  >([
    {
      id: 'v00',
      name: 'Cronograma inicial · V00',
      createdAt: new Date().toISOString(),
      kind: 'scenario',
      tasks: tasks.map((task) => ({ ...task }))
    }
  ]);
  const [selectedVersionId, setSelectedVersionId] = useState('v00');
  const [groupLines, setGroupLines] = useState<Record<string, number>>({
    'TORRE-PAVIMENTOS': 3,
    FACHADA: 3
  });
  const [familyLane, setFamilyLane] = useState<Record<string, number>>({
    ESTRUTURA: 1,
    ALVENARIA: 1,
    INSTALAÇÕES: 2,
    REVESTIMENTO: 3,
    FACHADA: 2,
    ESQUADRIAS: 3
  });
  const [packageLanes, setPackageLanes] = useState<Record<string, number>>({});
  const [packageColors, setPackageColors] = useState<Record<string, string>>(() => Object.fromEntries(tasks.map((task) => [`${task.lotMother}||${task.packageName}`, task.color])));
  const [groupOrder, setGroupOrder] = useState<string[]>(() => Array.from(new Set(tasks.map((task) => task.lotMother))));
  const [lotOrder, setLotOrder] = useState<Record<string, string[]>>(() => Object.fromEntries(Array.from(new Set(tasks.map((task) => task.lotMother))).map((group) => [group, Array.from(new Set(tasks.filter((task) => task.lotMother === group).map((task) => task.lot)))])));
  const [ordering, setOrdering] = useState<{
    type: 'group' | 'lot';
    key: string;
    group?: string;
  } | null>(null);
  const [drag, setDrag] = useState<null | {
    id: string;
    mode: 'pending' | 'move' | 'resize' | 'link';
    startX: number;
    startY: number;
    start: string;
    end: string;
    target?: string;
  }>(null);
  const [linkPoint, setLinkPoint] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const longPressRef = useRef<number | null>(null);
  const lineBalanceReady = useRef(false);

  useEffect(() => {
    let cancelled = false;
    lineBalanceReady.current = false;
    if (!projectKey) return;
    void loadLineBalanceData(projectKey)
      .then((data) => {
        if (cancelled || !data) return;
        if (data.settings) {
          setZoom(data.settings.zoom ?? 3);
          setEditMode(data.settings.editMode ?? true);
          setDependencyMode(data.settings.dependencyMode ?? true);
          setShowDeps(data.settings.showDeps ?? true);
          setSnapWeek(data.settings.snapWeek ?? false);
          setAllowDependencyGaps(data.settings.allowDependencyGaps ?? true);
          setMonthFormat(data.settings.monthFormat ?? 'numeric');
          setWeekFormat(data.settings.weekFormat ?? 'day');
          setGroupLines((data.settings.groupLines as Record<string, number>) ?? {});
          setFamilyLane((data.settings.familyLane as Record<string, number>) ?? {});
          setPackageLanes((data.settings.packageLanes as Record<string, number>) ?? {});
          setPackageColors((data.settings.packageColors as Record<string, string>) ?? {});
          setGroupOrder((data.settings.groupOrder as string[]) ?? []);
          setLotOrder((data.settings.lotOrder as Record<string, string[]>) ?? {});
        }
        if (data.versions?.length) {
          setVersions(data.versions);
          setSelectedVersionId(data.versions[0].id);
        }
        const taskIds = new Set(tasks.map((task) => task.id));
        const importedDependencies: ScheduleDependency[] = tasks.flatMap((task) =>
          (task.predecessors ?? [])
            .filter((from) => taskIds.has(from) && from !== task.id)
            .map((from) => ({ from, to: task.id, type: 'FS' as const }))
        );
        const storedDependencies = (data.dependencies ?? []).filter(
          (dependency) => taskIds.has(dependency.from) && taskIds.has(dependency.to) && dependency.from !== dependency.to
        );
        const mergedDependencies = new Map<string, ScheduleDependency>();
        [...storedDependencies, ...importedDependencies].forEach((dependency) => {
          mergedDependencies.set(`${dependency.from}→${dependency.to}`, dependency);
        });
        setDependencies(Array.from(mergedDependencies.values()));
        lineBalanceReady.current = true;
      })
      .catch(() => {
        lineBalanceReady.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  useEffect(() => {
    if (!projectKey || !lineBalanceReady.current) return;
    void saveLineBalanceData(projectKey, {
      versions,
      dependencies,
      settings: {
        zoom,
        editMode,
        dependencyMode,
        showDeps,
        snapWeek,
        allowDependencyGaps,
        monthFormat,
        weekFormat,
        groupLines,
        familyLane,
        packageLanes,
        packageColors,
        groupOrder,
        lotOrder
      }
    });
  }, [
    projectKey,
    versions,
    dependencies,
    zoom,
    editMode,
    dependencyMode,
    showDeps,
    snapWeek,
    allowDependencyGaps,
    monthFormat,
    weekFormat,
    groupLines,
    familyLane,
    packageLanes,
    packageColors,
    groupOrder,
    lotOrder
  ]);

  useEffect(() => {
    if (!projectKey || !lineBalanceReady.current) return;
    const timer = window.setTimeout(() => {
      void Promise.all([saveScheduleTasks(projectKey, tasks), updateActiveScheduleVersion(projectKey, tasks)]);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [projectKey, tasks]);

  const taskGroups = Array.from(new Set(tasks.map((t) => t.lotMother)));
  const groups = [...groupOrder.filter((group) => taskGroups.includes(group)), ...taskGroups.filter((group) => !groupOrder.includes(group))];
  const families = Array.from(new Set(tasks.map((t) => t.packageFamily)));
  const packagesByGroup = groups.flatMap((group) =>
    Array.from(new Set(tasks.filter((task) => task.lotMother === group).map((task) => task.packageName))).map((packageName, index) => {
      const key = `${group}||${packageName}`;
      return {
        key,
        group,
        packageName,
        defaultLane: (index % (groupLines[group] ?? 3)) + 1,
        color: tasks.find((task) => task.lotMother === group && task.packageName === packageName)?.color ?? '#4f46e5'
      };
    })
  );

  const rows = useMemo(() => {
    const result: Array<{
      type: 'group' | 'lot';
      key: string;
      label: string;
      tasks: Task[];
      height: number;
      group?: string;
    }> = [];
    for (const g of groups) {
      result.push({ type: 'group', key: g, label: g, tasks: [], height: 30 });
      const taskLots = Array.from(new Set(tasks.filter((t) => t.lotMother === g).map((t) => t.lot)));
      const lots = [...(lotOrder[g] ?? []).filter((lot) => taskLots.includes(lot)), ...taskLots.filter((lot) => !(lotOrder[g] ?? []).includes(lot))];
      for (const lot of lots) {
        result.push({
          type: 'lot',
          key: `${g}-${lot}`,
          label: lot,
          tasks: tasks.filter((t) => t.lotMother === g && t.lot === lot),
          height: 12 + (groupLines[g] ?? 3) * 26,
          group: g
        });
      }
    }
    return result;
  }, [tasks, groupLines, groupOrder, lotOrder]);

  const validTaskStarts = tasks.map((task) => parseDate(task.startDate)).filter((date) => !Number.isNaN(date.getTime()));
  const validTaskEnds = tasks.map((task) => parseDate(task.endDate)).filter((date) => !Number.isNaN(date.getTime()));
  const configuredStart = parseDate(projectStartDate);
  const configuredEnd = parseDate(plannedEndDate);
  const projectStart = Number.isNaN(configuredStart.getTime())
    ? (validTaskStarts.length ? new Date(Math.min(...validTaskStarts.map((date) => date.getTime()))) : new Date())
    : configuredStart;
  const lastTaskEnd = validTaskEnds.length ? new Date(Math.max(...validTaskEnds.map((date) => date.getTime()))) : projectStart;
  const chartEnd = Number.isNaN(configuredEnd.getTime()) || configuredEnd < lastTaskEnd ? lastTaskEnd : configuredEnd;
  const chartDayCount = Math.max(1, diffDays(projectStart, chartEnd) + 1);
  const chartWeekCount = Math.ceil(chartDayCount / 7);
  const chartMonthCount = Math.max(1, (chartEnd.getFullYear() - projectStart.getFullYear()) * 12 + chartEnd.getMonth() - projectStart.getMonth() + 1);
  const width = Math.max(1300, chartDayCount * zoomPx[zoom] + 160);
  const height = 90 + rows.reduce((s, r) => s + r.height, 0) + 40;

  function xFor(d: Date) {
    return diffDays(projectStart, d) * zoomPx[zoom];
  }
  function pointerX(event: React.PointerEvent) {
    return event.clientX - (svgRef.current?.getBoundingClientRect().left ?? 0);
  }
  function pointerY(event: React.PointerEvent) {
    return event.clientY - (svgRef.current?.getBoundingClientRect().top ?? 0);
  }
  function updateTask(id: string, patch: Partial<Task>) {
    const next = tasks.map((task) => (task.id === id ? { ...task, ...patch } : { ...task }));
    const requiredStartFor = (taskId: string) => {
      const predecessorEnds = dependencies
        .filter((dependency) => dependency.to === taskId)
        .map((dependency) => next.find((task) => task.id === dependency.from))
        .filter((task): task is Task => Boolean(task))
        .map((task) => parseDate(task.endDate));
      if (!predecessorEnds.length) return null;
      return addDays(new Date(Math.max(...predecessorEnds.map((date) => date.getTime()))), 1);
    };
    const enforceTaskStart = (task: Task, useEarliestStart = false) => {
      const requiredStart = requiredStartFor(task.id);
      if (!requiredStart) return false;
      const currentStart = parseDate(task.startDate);
      if (currentStart >= requiredStart && (!useEarliestStart || currentStart.getTime() === requiredStart.getTime())) return false;
      const duration = diffDays(parseDate(task.startDate), parseDate(task.endDate));
      task.startDate = toIsoDate(requiredStart);
      task.endDate = toIsoDate(addDays(requiredStart, duration));
      return true;
    };
    const editedTask = next.find((task) => task.id === id);
    if (editedTask) enforceTaskStart(editedTask);
    const propagate = (fromId: string, visited = new Set<string>()) => {
      if (visited.has(fromId)) return;
      visited.add(fromId);
      dependencies
        .filter((dependency) => dependency.from === fromId)
        .forEach((dependency) => {
          const successor = next.find((task) => task.id === dependency.to);
          if (!successor) return;
          enforceTaskStart(successor, !allowDependencyGaps);
          propagate(successor.id, visited);
        });
    };
    propagate(id);
    setTasks(next);
  }
  function snapDate(date: Date) {
    return snapWeek ? addDays(projectStart, Math.round(diffDays(projectStart, date) / 7) * 7) : date;
  }
  function clearLongPress() {
    if (longPressRef.current !== null) window.clearTimeout(longPressRef.current);
    longPressRef.current = null;
  }
  function beginDrag(event: React.PointerEvent<SVGElement>, task: Task, mode: 'pending' | 'resize') {
    if (!editMode) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      id: task.id,
      mode,
      startX: pointerX(event),
      startY: pointerY(event),
      start: task.startDate,
      end: task.endDate
    });
    if (mode === 'pending' && dependencyMode) {
      clearLongPress();
      longPressRef.current = window.setTimeout(() => {
        setDrag((current) => (current?.id === task.id && current.mode === 'pending' ? { ...current, mode: 'link' } : current));
      }, 500);
    }
  }

  function onMove(event: React.PointerEvent) {
    if (!drag) return;
    const task = tasks.find((t) => t.id === drag.id);
    if (!task) return;
    const dx = pointerX(event) - drag.startX;
    const dy = pointerY(event) - drag.startY;
    if (drag.mode === 'pending') {
      if (Math.abs(dx) > 7 || Math.abs(dy) > 7) clearLongPress();
      if (dependencyMode && Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) + 4) setDrag({ ...drag, mode: 'link' });
      else if (Math.abs(dx) > 5) setDrag({ ...drag, mode: 'move' });
      return;
    }
    if (drag.mode === 'link') {
      const target =
        document
          .elementsFromPoint(event.clientX, event.clientY)
          .map((element) => element.closest('[data-task-id]')?.getAttribute('data-task-id'))
          .find((id) => id && id !== drag.id) ?? undefined;
      setDrag({ ...drag, target });
      setLinkPoint({ x: pointerX(event), y: pointerY(event) });
      return;
    }
    if (drag.mode === 'move') {
      const delta = Math.round(dx / zoomPx[zoom]);
      const duration = diffDays(parseDate(drag.start), parseDate(drag.end));
      const newStart = snapDate(addDays(parseDate(drag.start), delta));
      updateTask(task.id, {
        startDate: toIsoDate(newStart),
        endDate: toIsoDate(addDays(newStart, duration))
      });
    } else {
      const newEnd = snapDate(addDays(projectStart, Math.round(pointerX(event) / zoomPx[zoom])));
      if (newEnd >= parseDate(task.startDate)) updateTask(task.id, { endDate: toIsoDate(newEnd) });
    }
  }
  function finishDrag() {
    clearLongPress();
    if (drag?.mode === 'link' && drag.target) {
      const exists = dependencies.some((dependency) => dependency.from === drag.id && dependency.to === drag.target);
      const reaches = (from: string, target: string, visited = new Set<string>()): boolean => {
        if (from === target) return true;
        if (visited.has(from)) return false;
        visited.add(from);
        return dependencies.filter((dependency) => dependency.from === from).some((dependency) => reaches(dependency.to, target, visited));
      };
      if (!exists && !reaches(drag.target, drag.id)) {
        const nextDependencies: ScheduleDependency[] = [...dependencies, { from: drag.id, to: drag.target, type: 'FS' }];
        setDependencies(nextDependencies);
        const predecessor = tasks.find((task) => task.id === drag.id);
        const successor = tasks.find((task) => task.id === drag.target);
        if (predecessor && successor) {
          const duration = diffDays(parseDate(successor.startDate), parseDate(successor.endDate));
          const predecessorEnds = nextDependencies
            .filter((dependency) => dependency.to === successor.id)
            .map((dependency) => tasks.find((task) => task.id === dependency.from))
            .filter((task): task is Task => Boolean(task))
            .map((task) => parseDate(task.endDate).getTime());
          const start = addDays(new Date(Math.max(...predecessorEnds)), 1);
          setTasks(
            tasks.map((task) =>
              task.id === successor.id
                ? {
                    ...task,
                    startDate: toIsoDate(start),
                    endDate: toIsoDate(addDays(start, duration))
                  }
                : task
            )
          );
        }
      }
    }
    setDrag(null);
    setLinkPoint(null);
  }
  function closeDrawersOnEmpty(event: React.PointerEvent<SVGSVGElement>) {
    if ((event.target as Element).closest('[data-task-id]')) return;
    setSelectedTask(null);
    setSettingsOpen(false);
  }

  let y = 90;
  const taskLayout = new Map<string, { x: number; y: number; width: number; height: number }>();
  let labelY = 90;
  const labelRows = rows.map((row) => {
    const top = labelY;
    labelY += row.height;
    return { ...row, top };
  });
  const dayNames = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const microservices: Record<string, string> = {
    ALVENARIA: 'Marcação 20% · Elevação 80%',
    ESTRUTURA: 'Forma · Armação · Concretagem',
    INSTALAÇÕES: 'Infraestrutura · Passagem · Testes',
    REVESTIMENTO: 'Preparação · Aplicação · Acabamento'
  };
  const selectedVersion = versions.find((version) => version.id === selectedVersionId);
  function saveVersion(kind: 'scenario' | 'baseline' | 'planned') {
    const labels = {
      scenario: 'Cenário',
      baseline: 'Linha de base',
      planned: 'Previsto'
    };
    const next = {
      id: crypto.randomUUID(),
      name: `${labels[kind]} · V${String(versions.length).padStart(2, '0')}`,
      createdAt: new Date().toISOString(),
      kind,
      tasks: tasks.map((task) => ({ ...task }))
    };
    setVersions([...versions, next]);
    setSelectedVersionId(next.id);
  }
  function openVersion() {
    if (selectedVersion) setTasks(selectedVersion.tasks.map((task) => ({ ...task })));
  }
  function changeVersionKind(kind: 'baseline' | 'planned') {
    if (!selectedVersion) return;
    setVersions(versions.map((version) => (version.id === selectedVersion.id ? { ...version, kind } : version)));
  }
  function deleteVersion() {
    if (!selectedVersion || versions.length === 1) return;
    const remaining = versions.filter((version) => version.id !== selectedVersion.id);
    setVersions(remaining);
    setSelectedVersionId(remaining[0].id);
  }
  function reorderRow(target: { type: 'group' | 'lot'; key: string; group?: string }) {
    if (!ordering || ordering.type !== target.type || ordering.key === target.key) return;
    if (ordering.type === 'group') {
      const current = [...groups];
      const from = current.indexOf(ordering.key);
      const to = current.indexOf(target.key);
      current.splice(from, 1);
      current.splice(to, 0, ordering.key);
      setGroupOrder(current);
    } else if (ordering.group && ordering.group === target.group) {
      const taskLots = Array.from(new Set(tasks.filter((task) => task.lotMother === ordering.group).map((task) => task.lot)));
      const current = [...(lotOrder[ordering.group] ?? taskLots)];
      taskLots.forEach((lot) => {
        if (!current.includes(lot)) current.push(lot);
      });
      const from = current.indexOf(ordering.key);
      const to = current.indexOf(target.key);
      current.splice(from, 1);
      current.splice(to, 0, ordering.key);
      setLotOrder({ ...lotOrder, [ordering.group]: current });
    }
    setOrdering(null);
  }
  function sortLots(group: string, direction: 'asc' | 'desc') {
    const lots = Array.from(new Set(tasks.filter((task) => task.lotMother === group).map((task) => task.lot)));
    const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
    const sorted = [...lots].sort((left, right) => collator.compare(left, right) * (direction === 'asc' ? 1 : -1));
    setLotOrder({ ...lotOrder, [group]: sorted });
  }
  return (
    <section className="page">
      <PageHeader title="Linha de balanço" subtitle="Visualização e edição do cronograma." />
      <div className="line-toolbar">
        <label>
          <input type="checkbox" checked={editMode} onChange={(e) => setEditMode(e.target.checked)} /> modo edição
        </label>
        <label>
          <input type="checkbox" checked={dependencyMode} onChange={(e) => setDependencyMode(e.target.checked)} /> dependências por arraste vertical
        </label>
        <label>
          <input type="checkbox" checked={showDeps} onChange={(e) => setShowDeps(e.target.checked)} /> mostrar dependências
        </label>
        <label title="Desmarque para trazer a cadeia posterior para a menor data permitida">
          <input type="checkbox" checked={allowDependencyGaps} onChange={(e) => setAllowDependencyGaps(e.target.checked)} /> permitir folgas entre dependências
        </label>
        <label>
          <input type="checkbox" checked={snapWeek} onChange={(e) => setSnapWeek(e.target.checked)} /> encaixar por semana
        </label>
      </div>
      {drag?.mode === 'link' && <div className="link-mode-banner show">Modo vínculo: arraste até a sucessora</div>}
      <div className="line-shell">
        <button
          className="chart-settings-button"
          title="Configurações do cronograma"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            setSelectedTask(null);
            setSettingsOpen(true);
          }}
        >
          <Settings size={18} />
        </button>
        <aside className={`chart-drawer settings-drawer settings-panel ${settingsOpen ? 'open' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
          <div className="chart-drawer-head">
            <div>
              <small>Linha de balanço</small>
              <h3>Configurações</h3>
            </div>
            <button className="drawer-close" onClick={() => setSettingsOpen(false)}>
              ×
            </button>
          </div>
          <div className="chart-drawer-body">
            <label>
              Zoom
              <input type="range" min={1} max={7} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            </label>
            <h4>Linhas por lote-mãe</h4>
            {groups.map((g) => (
              <label key={g}>
                {g}
                <select
                  value={groupLines[g] ?? 3}
                  onChange={(e) =>
                    setGroupLines({
                      ...groupLines,
                      [g]: Number(e.target.value)
                    })
                  }
                >
                  <option value={1}>1 linha</option>
                  <option value={2}>2 linhas</option>
                  <option value={3}>3 linhas</option>
                  <option value={4}>4 linhas</option>
                </select>
              </label>
            ))}
            <h4>Cor e linha por pacote</h4>
            <div className="package-config-list">
              {packagesByGroup.map((item) => {
                const maxLines = groupLines[item.group] ?? 3;
                return (
                  <div className="package-config-row" key={item.key}>
                    <input
                      title="Cor do pacote"
                      type="color"
                      value={packageColors[item.key] ?? item.color}
                      onChange={(e) =>
                        setPackageColors({
                          ...packageColors,
                          [item.key]: e.target.value
                        })
                      }
                    />
                    <span title={`${item.group} · ${item.packageName}`}>{item.packageName}</span>
                    <select
                      value={Math.min(packageLanes[item.key] ?? item.defaultLane, maxLines)}
                      onChange={(e) =>
                        setPackageLanes({
                          ...packageLanes,
                          [item.key]: Number(e.target.value)
                        })
                      }
                    >
                      {Array.from({ length: maxLines }).map((_, index) => (
                        <option value={index + 1} key={index + 1}>
                          Linha {index + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <h4>Cabeçalho de datas</h4>
            <label>
              Nível superior
              <select value={monthFormat} onChange={(e) => setMonthFormat(e.target.value as 'index' | 'numeric')}>
                <option value="index">M1, M2… desde o início</option>
                <option value="numeric">MM/AA</option>
              </select>
            </label>
            <label>
              Segundo nível
              <select value={weekFormat} onChange={(e) => setWeekFormat(e.target.value as 'short' | 'numeric' | 'day')}>
                <option value="short">DD/MMM</option>
                <option value="numeric">DD/MM</option>
                <option value="day">Somente DD</option>
              </select>
            </label>
            <div className="version-panel">
              <div className="version-panel-title">
                <div>
                  <small>Cronograma</small>
                  <h4>Histórico de versões</h4>
                </div>
                <button title="Criar cenário" onClick={() => saveVersion('scenario')}>
                  ＋
                </button>
              </div>
              <label>
                Versão
                <select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)}>
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      {version.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedVersion && (
                <div className="version-card">
                  <span className={`version-kind ${selectedVersion.kind}`}>{selectedVersion.kind === 'baseline' ? 'Linha de base' : selectedVersion.kind === 'planned' ? 'Previsto' : 'Simulação'}</span>
                  <strong>{selectedVersion.name}</strong>
                  <small>{new Date(selectedVersion.createdAt).toLocaleString('pt-BR')}</small>
                </div>
              )}
              <div className="version-actions">
                <button onClick={openVersion}>Abrir versão</button>
                <button onClick={() => changeVersionKind('baseline')}>Salvar como linha de base</button>
                <button onClick={() => changeVersionKind('planned')}>Salvar como previsto</button>
                <button className="danger" disabled={versions.length === 1} onClick={deleteVersion}>
                  Excluir
                </button>
              </div>
            </div>
          </div>
        </aside>
        <div className="chart-scroll">
          <div className="lot-labels" style={{ height }}>
            <div className="lot-label-header">Lotes</div>
            {labelRows.map((row) => (
              <div
                key={row.key}
                draggable
                className={`lot-label ${row.type} ${ordering?.key === row.key ? 'ordering' : ''}`}
                style={{ top: row.top, height: row.height }}
                onDragStart={() =>
                  setOrdering({
                    type: row.type,
                    key: row.type === 'lot' ? row.label : row.key,
                    group: row.group
                  })
                }
                onDragOver={(event) => event.preventDefault()}
                onDrop={() =>
                  reorderRow({
                    type: row.type,
                    key: row.type === 'lot' ? row.label : row.key,
                    group: row.group
                  })
                }
                onDragEnd={() => setOrdering(null)}
              >
                <span className="drag-grip">⠿</span>
                <span className="lot-label-text">{row.label}</span>
                {row.type === 'group' && (
                  <span className="lot-sort-actions">
                    <button
                      title="Classificar lotes em ordem ascendente"
                      draggable={false}
                      onDragStart={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation();
                        sortLots(row.key, 'asc');
                      }}
                    >
                      ↑
                    </button>
                    <button
                      title="Classificar lotes em ordem descendente"
                      draggable={false}
                      onDragStart={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation();
                        sortLots(row.key, 'desc');
                      }}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="line-time-header-wrap" style={{ width }}>
          <svg className="line-time-header" width={width} height={90} aria-hidden="true">
            <rect x={0} y={0} width={width} height={90} fill="#fafafa" />
            {Array.from({ length: chartDayCount }).map((_, i) => {
              const date = addDays(projectStart, i);
              const x = xFor(date);
              return (
                <g key={`sticky-day-${i}`}>
                  <line x1={x} x2={x} y1={66} y2={90} stroke={date.getDay() === 0 ? '#cbd5e1' : '#eef0f4'} />
                  <text x={x + 2} y={84} fontSize={9} fill="#64748b">{dayNames[date.getDay()]}</text>
                </g>
              );
            })}
            {Array.from({ length: chartWeekCount }).map((_, i) => {
              const date = addDays(projectStart, i * 7);
              const weekEnd = addDays(date, 6);
              const format = (value: Date) => weekFormat === 'day'
                ? value.toLocaleDateString('pt-BR', { day: '2-digit' })
                : value.toLocaleDateString('pt-BR', weekFormat === 'numeric' ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: 'short' });
              return (
                <g key={`sticky-week-${i}`}>
                  <line x1={xFor(date)} x2={xFor(date)} y1={38} y2={90} stroke="#d9dde6" />
                  <text x={xFor(date) + 3} y={59} fontSize={10}>{format(date)}–{format(weekEnd)}</text>
                </g>
              );
            })}
            {Array.from({ length: chartMonthCount }).map((_, i) => {
              const date = new Date(projectStart.getFullYear(), projectStart.getMonth() + i, 1);
              const label = monthFormat === 'index' ? `M${i + 1}` : date.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' });
              return (
                <g key={`sticky-month-${i}`}>
                  <line x1={xFor(date)} x2={xFor(date)} y1={0} y2={90} stroke="#aeb4c2" />
                  <text x={xFor(date) + 4} y={24} fontSize={12} fontWeight={700}>{label}</text>
                </g>
              );
            })}
          </svg>
          </div>
          <svg ref={svgRef} width={width} height={height} onPointerDown={closeDrawersOnEmpty} onPointerMove={onMove} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            <rect x={0} y={0} width={width} height={90} fill="#fafafa" />
            {Array.from({ length: chartDayCount }).map((_, index) => {
              const date = addDays(projectStart, index);
              const iso = toIsoDate(date);
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const holiday = holidays.find((event) => event.date === iso);
              if (!isWeekend && !holiday) return null;
              return (
                <rect key={`off-${iso}`} x={xFor(date)} y={0} width={zoomPx[zoom]} height={height} fill={holiday ? '#e2e8f0' : '#f1f5f9'}>
                  <title>{holiday?.title ?? 'Final de semana'}</title>
                </rect>
              );
            })}
            {Array.from({ length: chartDayCount }).map((_, i) => {
              const date = addDays(projectStart, i);
              const x = xFor(date);
              return (
                <g key={`day-${i}`}>
                  <line x1={x} x2={x} y1={66} y2={height} stroke={date.getDay() === 0 ? '#cbd5e1' : '#eef0f4'} />
                  <text x={x + 2} y={84} fontSize={9} fill="#64748b">
                    {dayNames[date.getDay()]}
                  </text>
                </g>
              );
            })}
            {Array.from({ length: chartWeekCount }).map((_, i) => {
              const d = addDays(projectStart, i * 7);
              const weekEnd = addDays(d, 6);
              const x = xFor(d);
              const format = (date: Date) => {
                if (weekFormat === 'day') return date.toLocaleDateString('pt-BR', { day: '2-digit' });
                return date.toLocaleDateString('pt-BR', weekFormat === 'numeric' ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: 'short' });
              };
              return (
                <g key={i}>
                  <line x1={x} x2={x} y1={38} y2={height} stroke="#d9dde6" />
                  <text x={x + 3} y={59} fontSize={10}>
                    {format(d)}–{format(weekEnd)}
                  </text>
                </g>
              );
            })}
            {Array.from({ length: chartMonthCount }).map((_, i) => {
              const date = new Date(projectStart.getFullYear(), projectStart.getMonth() + i, 1);
              const label =
                monthFormat === 'index'
                  ? `M${i + 1}`
                  : date.toLocaleDateString('pt-BR', {
                      month: '2-digit',
                      year: '2-digit'
                    });
              return (
                <g key={`month-${i}`}>
                  <line x1={xFor(date)} x2={xFor(date)} y1={0} y2={height} stroke="#aeb4c2" />
                  <text x={xFor(date) + 4} y={24} fontSize={12} fontWeight={700}>
                    {label}
                  </text>
                </g>
              );
            })}
            {['2025-09-01', '2026-01-12', '2026-06-10'].map((date, i) => {
              const x = xFor(parseDate(date));
              return (
                <g key={date}>
                  <line x1={x} x2={x} y1={90} y2={height} stroke="#b91c1c" strokeDasharray="4 4" />
                  <text x={x + 8} y={150} transform={`rotate(-90 ${x + 8} 150)`} fontSize={11} fill="#b91c1c">
                    {['INÍCIO', 'ACAB.', 'ESQ.'][i]}
                  </text>
                </g>
              );
            })}
            {rows.map((row) => {
              const currentY = y;
              y += row.height;
              if (row.type === 'group')
                return (
                  <g key={row.key}>
                    <rect x={0} y={currentY} width={width} height={row.height} fill="#eef2ff" opacity=".65" />
                  </g>
                );
              return (
                <g key={row.key}>
                  <line x1={0} x2={width} y1={currentY + row.height} y2={currentY + row.height} stroke="#e5e7eb" />
                  {row.tasks.map((t) => {
                    const packageKey = `${t.lotMother}||${t.packageName}`;
                    const packageSetting = packagesByGroup.find((item) => item.key === packageKey);
                    const lane = Math.min(groupLines[t.lotMother] ?? 3, packageLanes[packageKey] ?? t.lane ?? packageSetting?.defaultLane ?? familyLane[t.packageFamily] ?? 1);
                    const x = xFor(parseDate(t.startDate));
                    const barW = Math.max(10, (diffDays(parseDate(t.startDate), parseDate(t.endDate)) + 1) * zoomPx[zoom]);
                    const barY = currentY + 8 + (lane - 1) * 26;
                    taskLayout.set(t.id, {
                      x,
                      y: barY,
                      width: barW,
                      height: 18
                    });
                    const serviceText = t.services?.length ? t.services.join(' · ') : (microservices[t.packageFamily] ?? 'Serviços não cadastrados');
                    const taskColor = packageColors[packageKey] ?? t.color;
                    return (
                      <g key={t.id} data-task-id={t.id} onClick={() => setSelectedTask(t)}>
                        <title>
                          {t.packageName} · {serviceText}
                        </title>
                        <rect className={`task-bar ${drag?.target === t.id ? 'target-highlight' : ''}`} x={x} y={barY} width={barW} height={18} rx={4} fill={taskColor} onPointerDown={(e) => beginDrag(e, t, 'pending')} />
                        <rect className="resize-handle" x={x + barW - 9} y={barY} width={9} height={18} fill="#fff" opacity={0.25} onPointerDown={(e) => beginDrag(e, t, 'resize')} />
                        <text pointerEvents="none" x={x + 5} y={barY + 13} fontSize={10} fontWeight={700} fill="#fff">
                          {t.packageName}
                        </text>
                        <rect pointerEvents="none" x={x} y={barY + 14} width={(barW * t.progress) / 100} height={4} fill="#fff" opacity={0.55} />
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {dependencies
              .filter((dependency) => showDeps || dependency.from === selectedTask?.id || dependency.to === selectedTask?.id)
              .map((dependency) => {
                const from = taskLayout.get(dependency.from);
                const to = taskLayout.get(dependency.to);
                if (!from || !to) return null;
                const startX = from.x + from.width;
                const startY = from.y + from.height / 2;
                const endX = to.x;
                const endY = to.y + to.height / 2;
                const middleX = Math.max(startX + 18, (startX + endX) / 2);
                return <path className="dependency-path" key={`${dependency.from}-${dependency.to}`} d={`M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`} />;
              })}
            {drag?.mode === 'link' &&
              linkPoint &&
              (() => {
                const from = taskLayout.get(drag.id);
                if (!from) return null;
                return <path className="dependency-preview" d={`M ${from.x + from.width} ${from.y + from.height / 2} C ${from.x + from.width + 40} ${from.y + from.height / 2}, ${linkPoint.x - 40} ${linkPoint.y}, ${linkPoint.x} ${linkPoint.y}`} />;
              })()}
          </svg>
        </div>
        <aside className={`chart-drawer task-drawer ${selectedTask ? 'open' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
          {selectedTask && (
            <>
              <div className="chart-drawer-head">
                <div>
                  <small>{selectedTask.packageFamily}</small>
                  <h3>{selectedTask.packageName}</h3>
                  <span>{selectedTask.lot}</span>
                </div>
                <button className="drawer-close" onClick={() => setSelectedTask(null)}>
                  ×
                </button>
              </div>
              <div className="chart-drawer-body">
                <div className="task-progress">
                  <span>Progresso da atividade</span>
                  <strong>{selectedTask.progress}%</strong>
                  <i>
                    <b
                      style={{
                        width: `${selectedTask.progress}%`,
                        background: selectedTask.color
                      }}
                    />
                  </i>
                </div>
                <dl>
                  <dt>Lote-mãe</dt>
                  <dd>{selectedTask.lotMother}</dd>
                  <dt>Lote</dt>
                  <dd>{selectedTask.lot}</dd>
                  <dt>Início</dt>
                  <dd>{parseDate(selectedTask.startDate).toLocaleDateString('pt-BR')}</dd>
                  <dt>Fim</dt>
                  <dd>{parseDate(selectedTask.endDate).toLocaleDateString('pt-BR')}</dd>
                  <dt>Duração</dt>
                  <dd>{diffDays(parseDate(selectedTask.startDate), parseDate(selectedTask.endDate)) + 1} dias</dd>
                  <dt>Quantidade</dt>
                  <dd>
                    {selectedTask.quantity ?? '—'} {selectedTask.unit ?? ''}
                  </dd>
                  <dt>Custo</dt>
                  <dd>
                    {selectedTask.cost?.toLocaleString('pt-BR', {
                      style: 'currency',
                      currency: 'BRL'
                    }) ?? '—'}
                  </dd>
                </dl>
                <div className="drawer-section">
                  <h4>Serviços inclusos</h4>
                  {selectedTask.services?.length ? (
                    <ul className="service-list">
                      {selectedTask.services.map((service) => (
                        <li key={service}>{service}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>{microservices[selectedTask.packageFamily] ?? 'Não cadastrados'}</p>
                  )}
                </div>
                <div className="drawer-section">
                  <h4>Dependências FS</h4>
                  <div className="dep-list">
                    {dependencies
                      .filter((dependency) => dependency.from === selectedTask.id || dependency.to === selectedTask.id)
                      .map((dependency) => (
                        <div key={`${dependency.from}-${dependency.to}`}>
                          <span>
                            {tasks.find((task) => task.id === dependency.from)?.packageName} → {tasks.find((task) => task.id === dependency.to)?.packageName}
                          </span>
                          <button className="dep-remove" onClick={() => setDependencies(dependencies.filter((item) => item !== dependency))}>
                            ×
                          </button>
                        </div>
                      ))}
                    {!dependencies.some((dependency) => dependency.from === selectedTask.id || dependency.to === selectedTask.id) && 'Nenhuma dependência.'}
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function Procurement() {
  const stages = ['A solicitar', 'Pedido emitido', 'Contrato emitido', 'Entregue'];
  return (
    <section className="page">
      <PageHeader title="Compras" subtitle="Kanban com cobertura por quantidade e etapa do processo.">
        <button>Importar requisições</button>
      </PageHeader>
      <div className="kanban">
        {stages.map((stage) => (
          <div className="kanban-col" key={stage}>
            <h3>{stage}</h3>
            {procurement
              .filter((p) => p.stage === stage)
              .map((p) => (
                <article className={`buy-card ${p.coverage < 100 ? 'warning' : 'ok'}`} key={p.id}>
                  <strong>{p.item}</strong>
                  <span>{p.code}</span>
                  <div className="bar">
                    <i style={{ width: `${p.coverage}%` }} />
                  </div>
                  <small>
                    Cobertura {p.coverage}% · pedido {p.ordered}/{p.required} {p.unit}
                  </small>
                  <b>{p.status}</b>
                </article>
              ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function MediumPlan({ tasks, projectId, onPublish }: { tasks: Task[]; projectId: string; onPublish: (tasks: Task[]) => void }) {
  type Unit = {
    id: string;
    parentId?: string;
    name: string;
    weight: number;
    quantity: number;
    startDate: string;
    endDate: string;
    responsible: string;
    predecessors?: string[];
  };
  type Window = {
    id: string;
    startDate: string;
    endDate: string;
    createdAt: string;
    tasks: Task[];
  };
  const [analysisStart, setAnalysisStart] = useState(() => tasks[0]?.startDate ?? toIsoDate(new Date()));
  const [windowData, setWindowData] = useState<Window | null>(null);
  const [units, setUnits] = useState<Record<string, Unit[]>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedMediumTaskIds, setSelectedMediumTaskIds] = useState<string[]>([]);
  const [newUnitName, setNewUnitName] = useState('');
  const [unitParentId, setUnitParentId] = useState<string | null>(null);
  const mediumLabelsRef = useRef<HTMLDivElement | null>(null);
  const mediumTimelineRef = useRef<HTMLDivElement | null>(null);
  const mediumTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const [mediumViewportWidth, setMediumViewportWidth] = useState(900);
  const [showMediumDependencies, setShowMediumDependencies] = useState(true);
  const [mediumOrdering, setMediumOrdering] = useState<string | null>(null);
  const [mediumDrag, setMediumDrag] = useState<null | {
    taskId: string;
    unitId: string;
    mode: 'pending' | 'move' | 'resize' | 'link';
    startX: number;
    startY: number;
    startDate: string;
    endDate: string;
    target?: string;
  }>(null);
  const [mediumLinkPoint, setMediumLinkPoint] = useState<{ x: number; y: number } | null>(null);
  const mediumLongPressRef = useRef<number | null>(null);
  const [mediumActivitySearch, setMediumActivitySearch] = useState('');
  const [mediumResponsibleSearch, setMediumResponsibleSearch] = useState('');
  const [mediumOnlyUnassigned, setMediumOnlyUnassigned] = useState(false);
  const [mediumZoom, setMediumZoom] = useState(1);
  const [mediumMotherSort, setMediumMotherSort] = useState<'import' | 'asc' | 'desc'>('import');
  const [mediumLotSort, setMediumLotSort] = useState<'import' | 'asc' | 'desc'>('import');
  const mediumPanRef = useRef<null | { x: number; y: number; left: number; top: number }>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [monthPickerStartYear, setMonthPickerStartYear] = useState(() => parseDate(tasks[0]?.startDate ?? toIsoDate(new Date())).getFullYear());
  const [mediumWindowReady, setMediumWindowReady] = useState(false);
  useEffect(() => {
    const element = mediumTimelineScrollRef.current;
    if (!element) return;
    const update = () => setMediumViewportWidth(Math.max(320, element.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [windowData]);
  useEffect(() => {
    let active = true;
    setMediumWindowReady(false);
    void loadMediumWindowState(projectId)
      .then((state) => {
        if (!active || !state) return;
        if (state.analysisStart) setAnalysisStart(state.analysisStart);
        if (state.windowData) setWindowData(state.windowData as Window);
        if (state.units) setUnits(state.units as Record<string, Unit[]>);
        if (active) setMediumWindowReady(true);
      })
      .catch(() => {
        if (active) setMediumWindowReady(true);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (!windowData) return;
    const published = windowData.tasks.flatMap((task) =>
      leafUnits(task.id).map((unit) => ({
        ...task,
        id: `${task.id}:${unit.id}`,
        lot: unit.name,
        startDate: unit.startDate,
        endDate: unit.endDate,
        duration: diffDays(parseDate(unit.startDate), parseDate(unit.endDate)) + 1,
        quantity: unit.quantity || task.quantity,
        responsible: unit.responsible || task.responsible,
        predecessors: (unit.predecessors ?? []).map((id) => {
          const owner = Object.entries(units).find(([, list]) => list.some((item) => item.id === id))?.[0];
          return owner ? `${owner}:${id}` : id;
        })
      }))
    );
    onPublish(published);
    if (!mediumWindowReady) return;
    void saveMediumWindowState(projectId, {
      analysisStart,
      windowData,
      units
    });
  }, [windowData, units, analysisStart, projectId, onPublish, mediumWindowReady]);
  useEffect(() => {
    if (!mediumWindowReady) return;
    void saveMediumWindowState(projectId, {
      analysisStart,
      windowData,
      units
    });
  }, [analysisStart, windowData, units, projectId, mediumWindowReady]);
  function threeMonthsAfter(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return toIsoDate(addDays(new Date(), 90));
    const date = parseDate(value);
    if (Number.isNaN(date.getTime())) return toIsoDate(addDays(new Date(), 90));
    date.setMonth(date.getMonth() + 3);
    return toIsoDate(date);
  }
  const analysisEnd = threeMonthsAfter(analysisStart);
  const previewTasks = tasks.filter((task) => task.startDate <= analysisEnd && task.endDate >= analysisStart);
  function createWindow() {
    const snapshot = previewTasks
      .map((task) => ({
        ...task,
        services: [...(task.services ?? [])]
      }))
      .sort((a, b) => `${a.lotMother}|${a.lot}|${a.packageName}`.localeCompare(`${b.lotMother}|${b.lot}|${b.packageName}`, 'pt-BR'));
    const windowSnapshot = {
      id: crypto.randomUUID(),
      startDate: analysisStart,
      endDate: analysisEnd,
      createdAt: new Date().toISOString(),
      tasks: snapshot
    };
    const rootIds = new Map(snapshot.map((task) => [task.id, crypto.randomUUID()]));
    const resolveTaskId = (reference: string) => {
      if (rootIds.has(reference)) return reference;
      const numeric = reference.match(/\d+/)?.[0];
      return snapshot.find((task) => task.id === numeric || task.id.match(/\d+/)?.[0] === numeric)?.id;
    };
    setUnits(
      Object.fromEntries(
        snapshot.map((task) => {
          const predecessorUnits = (task.predecessors ?? []).map(resolveTaskId).filter((id): id is string => Boolean(id)).map((id) => rootIds.get(id)!).filter(Boolean);
          return [
            task.id,
            [
              {
                id: rootIds.get(task.id)!,
                name: task.lot,
                weight: 100,
                quantity: task.quantity ?? 0,
                startDate: task.startDate,
                endDate: task.endDate,
                responsible: task.responsible ?? '',
                predecessors: predecessorUnits
              }
            ]
          ];
        })
      )
    );
    const unitSnapshot = Object.fromEntries(
      snapshot.map((task) => {
        const predecessorUnits = (task.predecessors ?? []).map(resolveTaskId).filter((id): id is string => Boolean(id)).map((id) => rootIds.get(id)!).filter(Boolean);
        return [
          task.id,
          [
            {
              id: rootIds.get(task.id)!,
              name: task.lot,
              weight: 100,
              quantity: task.quantity ?? 0,
              startDate: task.startDate,
              endDate: task.endDate,
              responsible: task.responsible ?? '',
              predecessors: predecessorUnits
            }
          ]
        ];
      })
    );
    setWindowData(windowSnapshot);
    setUnits(unitSnapshot);
    setSelectedTaskId(null);
    setSelectedMediumTaskIds([]);
    void saveMediumWindowState(projectId, {
      analysisStart,
      windowData: windowSnapshot,
      units: unitSnapshot
    });
  }
  function addUnit(task: Task) {
    if (!newUnitName.trim()) return;
    const current = units[task.id] ?? [];
    const parentId = current.some((unit) => unit.id === unitParentId) ? unitParentId! : current[0]?.id;
    const parent = current.find((unit) => unit.id === parentId);
    const next = [
      ...current,
      {
        id: crypto.randomUUID(),
        parentId,
        name: newUnitName.trim(),
        weight: 0,
        quantity: 0,
        startDate: parent?.startDate ?? task.startDate,
        endDate: parent?.endDate ?? task.endDate,
        responsible: parent?.responsible ?? task.responsible ?? '',
        predecessors: [...(parent?.predecessors ?? [])]
      }
    ];
    const siblings = next.filter((unit) => unit.parentId === parentId);
    const base = Math.floor(10000 / siblings.length) / 100;
    let siblingIndex = 0;
    const distributed = next.map((unit) =>
      unit.parentId === parentId
        ? {
            ...unit,
            weight: siblingIndex++ === siblings.length - 1 ? Number((100 - base * (siblings.length - 1)).toFixed(2)) : base
          }
        : unit
    );
    setUnits({ ...units, [task.id]: distributed });
    setNewUnitName('');
  }
  function updateUnit(taskId: string, unitId: string, patch: Partial<Unit>) {
    const next = Object.fromEntries(Object.entries(units).map(([owner, list]) => [owner, list.map((unit) => ({ ...unit }))]));
    const source = next[taskId]?.find((unit) => unit.id === unitId);
    if (!source) return;
    Object.assign(source, patch);
    const propagate = (sourceUnit: Unit, visited = new Set<string>()) => {
      if (visited.has(sourceUnit.id)) return;
      visited.add(sourceUnit.id);
      Object.values(next)
        .flat()
        .filter((unit) => (unit.predecessors ?? []).includes(sourceUnit.id))
        .forEach((successor) => {
          const duration = diffDays(parseDate(successor.startDate), parseDate(successor.endDate));
          const start = addDays(parseDate(sourceUnit.endDate), 1);
          successor.startDate = toIsoDate(start);
          successor.endDate = toIsoDate(addDays(start, duration));
          propagate(successor, visited);
        });
    };
    propagate(source);
    setUnits(next);
  }
  function removeUnit(taskId: string, unitId: string) {
    const source = units[taskId] ?? [];
    const removing = new Set([unitId]);
    let changed = true;
    while (changed) {
      changed = false;
      source.forEach((unit) => {
        if (unit.parentId && removing.has(unit.parentId) && !removing.has(unit.id)) {
          removing.add(unit.id);
          changed = true;
        }
      });
    }
    const removed = source.find((unit) => unit.id === unitId);
    const remaining = source.filter((unit) => !removing.has(unit.id));
    if (!remaining.length) return;
    const siblings = remaining.filter((unit) => unit.parentId === removed?.parentId);
    const base = siblings.length ? Math.floor(10000 / siblings.length) / 100 : 100;
    let index = 0;
    setUnits({
      ...units,
      [taskId]: remaining.map((unit) =>
        unit.parentId === removed?.parentId
          ? {
              ...unit,
              weight: index++ === siblings.length - 1 ? Number((100 - base * (siblings.length - 1)).toFixed(2)) : base
            }
          : unit
      )
    });
  }
  function addManualActivity() {
    if (!windowData) return;
    const packageName = window.prompt('Nome da nova atividade');
    if (!packageName?.trim()) return;
    const lot = window.prompt('Lote/local da atividade', 'Atividade extra')?.trim() || 'Atividade extra';
    const task: Task = {
      id: crypto.randomUUID(),
      packageName: packageName.trim(),
      packageFamily: 'EXTRA',
      lotMother: 'ATIVIDADES EXTRAS',
      lot,
      startDate: windowData.startDate,
      endDate: addDays(parseDate(windowData.startDate), 6).toISOString().slice(0, 10),
      progress: 0,
      color: '#7c3aed',
      predecessors: []
    };
    setWindowData({ ...windowData, tasks: [...windowData.tasks, task] });
    setUnits({
      ...units,
      [task.id]: [
        {
          id: crypto.randomUUID(),
          name: lot,
          weight: 100,
          quantity: 0,
          startDate: task.startDate,
          endDate: task.endDate,
          responsible: ''
        }
      ]
    });
    setSelectedTaskId(task.id);
    setSelectedMediumTaskIds([task.id]);
  }
  function reorderMediumTask(targetId: string) {
    if (!windowData || !mediumOrdering || mediumOrdering === targetId) return;
    const next = [...windowData.tasks];
    const from = next.findIndex((task) => task.id === mediumOrdering);
    const to = next.findIndex((task) => task.id === targetId);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setWindowData({ ...windowData, tasks: next });
    setMediumOrdering(null);
  }
  function mediumPointerX(event: React.PointerEvent) {
    return event.clientX - (mediumTimelineRef.current?.getBoundingClientRect().left ?? 0);
  }
  function mediumPointerY(event: React.PointerEvent) {
    return event.clientY - (mediumTimelineRef.current?.getBoundingClientRect().top ?? 0);
  }
  function startMediumPan(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('.medium-task-card,.medium-time-head')) return;
    mediumPanRef.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveMediumPan(event: React.PointerEvent<HTMLDivElement>) {
    if (!mediumPanRef.current) return;
    event.currentTarget.scrollLeft = mediumPanRef.current.left - (event.clientX - mediumPanRef.current.x);
    event.currentTarget.scrollTop = mediumPanRef.current.top - (event.clientY - mediumPanRef.current.y);
  }
  function finishMediumPan() {
    mediumPanRef.current = null;
  }
  function clearMediumLongPress() {
    if (mediumLongPressRef.current !== null) window.clearTimeout(mediumLongPressRef.current);
    mediumLongPressRef.current = null;
  }
  function beginMediumDrag(event: React.PointerEvent<HTMLElement>, taskId: string, unit: Unit, mode: 'pending' | 'resize') {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setMediumDrag({
      taskId,
      unitId: unit.id,
      mode,
      startX: mediumPointerX(event),
      startY: mediumPointerY(event),
      startDate: unit.startDate,
      endDate: unit.endDate
    });
    if (mode === 'pending') {
      clearMediumLongPress();
      mediumLongPressRef.current = window.setTimeout(() => {
        setMediumDrag((current) => (current?.taskId === taskId && current.mode === 'pending' ? { ...current, mode: 'link' } : current));
      }, 500);
    }
  }
  function moveMediumItem(event: React.PointerEvent) {
    if (!mediumDrag || !windowData) return;
    const dx = mediumPointerX(event) - mediumDrag.startX;
    const dy = mediumPointerY(event) - mediumDrag.startY;
    if (mediumDrag.mode === 'pending') {
      if (Math.abs(dx) > 7 || Math.abs(dy) > 7) clearMediumLongPress();
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) + 4) setMediumDrag({ ...mediumDrag, mode: 'link' });
      else if (Math.abs(dx) > 5) setMediumDrag({ ...mediumDrag, mode: 'move' });
      return;
    }
    if (mediumDrag.mode === 'link') {
      const target = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest('[data-medium-unit-id]')?.getAttribute('data-medium-unit-id'))
        .find((id) => id && id !== mediumDrag.unitId);
      setMediumDrag({ ...mediumDrag, target: target ?? undefined });
      setMediumLinkPoint({ x: mediumPointerX(event), y: mediumPointerY(event) });
      return;
    }
    const delta = Math.round(dx / dayWidth);
    if (mediumDrag.mode === 'move') {
      const duration = diffDays(parseDate(mediumDrag.startDate), parseDate(mediumDrag.endDate));
      const start = addDays(parseDate(mediumDrag.startDate), delta);
      updateUnit(mediumDrag.taskId, mediumDrag.unitId, {
        startDate: toIsoDate(start),
        endDate: toIsoDate(addDays(start, duration))
      });
    } else if (mediumDrag.mode === 'resize') {
      const end = addDays(parseDate(mediumDrag.endDate), delta);
      if (end >= parseDate(mediumDrag.startDate))
        updateUnit(mediumDrag.taskId, mediumDrag.unitId, {
          endDate: toIsoDate(end)
        });
    }
  }
  function finishMediumDrag() {
    clearMediumLongPress();
    if (mediumDrag?.mode === 'link' && mediumDrag.target) {
      const allUnits = Object.values(units).flat();
      const source = allUnits.find((unit) => unit.id === mediumDrag.unitId);
      const target = allUnits.find((unit) => unit.id === mediumDrag.target);
      const targetOwner = Object.entries(units).find(([, list]) => list.some((unit) => unit.id === target?.id))?.[0];
      if (source && target && targetOwner) {
        const duration = diffDays(parseDate(target.startDate), parseDate(target.endDate));
        const requiredStart = addDays(parseDate(source.endDate), 1);
        setUnits({
          ...units,
          [targetOwner]: units[targetOwner].map((unit) =>
            unit.id === target.id
              ? {
                  ...unit,
                  predecessors: Array.from(new Set([...(unit.predecessors ?? []), source.id])),
                  startDate: toIsoDate(requiredStart),
                  endDate: toIsoDate(addDays(requiredStart, duration))
                }
              : unit
          )
        });
      }
    }
    setMediumDrag(null);
    setMediumLinkPoint(null);
  }
  function selectMediumTask(event: React.MouseEvent, taskId: string) {
    const next = event.ctrlKey || event.metaKey ? (selectedMediumTaskIds.includes(taskId) ? selectedMediumTaskIds.filter((id) => id !== taskId) : [...selectedMediumTaskIds, taskId]) : [taskId];
    setSelectedMediumTaskIds(next);
    setSelectedTaskId(next[0] ?? null);
  }
  function deleteSelectedMediumTasks() {
    if (!windowData || !selectedMediumTaskIds.length) return;
    const deleting = new Set(selectedMediumTaskIds);
    setWindowData({
      ...windowData,
      tasks: windowData.tasks
        .filter((task) => !deleting.has(task.id))
        .map((task) => ({ ...task, predecessors: (task.predecessors ?? []).filter((id) => !deleting.has(id)), successors: (task.successors ?? []).filter((id) => !deleting.has(id)) }))
    });
    setUnits(Object.fromEntries(Object.entries(units).filter(([taskId]) => !deleting.has(taskId))));
    setSelectedMediumTaskIds([]);
    setSelectedTaskId(null);
  }
  const selectedTask = windowData?.tasks.find((task) => task.id === selectedTaskId);
  const activeUnitParentId = selectedTask ? ((units[selectedTask.id] ?? []).some((unit) => unit.id === unitParentId) ? unitParentId! : units[selectedTask.id]?.[0]?.id) : undefined;
  const activeSiblingWeight = selectedTask ? (units[selectedTask.id] ?? []).filter((unit) => unit.parentId === activeUnitParentId).reduce((sum, unit) => sum + unit.weight, 0) : 0;
  const windowDayCount = windowData ? diffDays(parseDate(windowData.startDate), parseDate(windowData.endDate)) + 1 : 90;
  const visibleDaysByZoom = mediumZoom === 1 ? windowDayCount : mediumZoom === 2 ? Math.min(60, windowDayCount) : Math.min(30, windowDayCount);
  const dayWidth = mediumViewportWidth / Math.max(1, visibleDaysByZoom);
  const timelineWidth = windowData ? windowDayCount * dayWidth : 0;
  function leafUnits(taskId: string) {
    const list = units[taskId] ?? [];
    const parents = new Set(list.map((unit) => unit.parentId).filter(Boolean));
    return list.filter((unit) => !parents.has(unit.id));
  }
  function unitPath(taskId: string, unit: Unit) {
    const list = units[taskId] ?? [];
    const path: Unit[] = [];
    let current: Unit | undefined = unit;
    while (current?.parentId) {
      path.unshift(current);
      current = list.find((item) => item.id === current?.parentId);
    }
    return path;
  }
  const visibleMediumTasks = (windowData?.tasks ?? []).filter((task) => {
    const activityText = `${task.packageName} ${task.service ?? ''} ${(task.services ?? []).join(' ')} ${task.lot} ${task.lotMother}`.toLocaleLowerCase('pt-BR');
    const responsibleNames = [task.responsible ?? '', ...(units[task.id] ?? []).map((unit) => unit.responsible)].filter(Boolean);
    const activityMatches = activityText.includes(mediumActivitySearch.trim().toLocaleLowerCase('pt-BR'));
    const responsibleMatches = responsibleNames.join(' ').toLocaleLowerCase('pt-BR').includes(mediumResponsibleSearch.trim().toLocaleLowerCase('pt-BR'));
    return activityMatches && responsibleMatches && (!mediumOnlyUnassigned || responsibleNames.length === 0);
  });
  const firstTaskByLot = new Map<string, string>();
  visibleMediumTasks.forEach((task) => {
    const key = `${task.lotMother}||${task.lot}`;
    if (!firstTaskByLot.has(key)) firstTaskByLot.set(key, task.id);
  });
  const maxSublotDepth = Math.max(0, ...visibleMediumTasks.flatMap((task) => leafUnits(task.id).map((unit) => unitPath(task.id, unit).length)), 0);
  const labelColumnWidth = 182 + maxSublotDepth * 145;
  const mediumLotGroups = Array.from(
    visibleMediumTasks.reduce((map, task) => {
      const key = `${task.lotMother}||${task.lot}`;
      const group = map.get(key) ?? { key, lotMother: task.lotMother, lot: task.lot, tasks: [] as Task[] };
      group.tasks.push(task);
      map.set(key, group);
      return map;
    }, new Map<string, { key: string; lotMother: string; lot: string; tasks: Task[] }>())
  )
    .map(([, group]) => group)
    .sort((a, b) => {
      const numericCompare = (left: string, right: string, direction: 'import' | 'asc' | 'desc') => {
        if (direction === 'import') return 0;
        const leftMatch = left.match(/\d+/)?.[0];
        const rightMatch = right.match(/\d+/)?.[0];
        const comparison = leftMatch && rightMatch ? Number(leftMatch) - Number(rightMatch) : left.localeCompare(right, 'pt-BR');
        return direction === 'asc' ? comparison : -comparison;
      };
      const mother = numericCompare(a.lotMother, b.lotMother, mediumMotherSort);
      return mother || numericCompare(a.lot, b.lot, mediumLotSort);
    });
  const mediumRowLayout = new Map<string, { top: number; height: number }>();
  const mediumUnitLayout = new Map<string, { x: number; y: number; width: number; height: number; lane: number; truncatedStart: boolean; truncatedEnd: boolean }>();
  const mediumUnitOwner = new Map<string, string>();
  Object.entries(units).forEach(([taskId, list]) => list.forEach((unit) => mediumUnitOwner.set(unit.id, taskId)));
  const mediumGroupLayout = new Map<string, { top: number; height: number; laneCount: number; cardHeight: number }>();
  const mediumWindowStart = windowData?.startDate ?? analysisStart;
  let mediumRowTop = 80;
  mediumLotGroups.forEach((group) => {
    const entries = group.tasks.flatMap((task) => leafUnits(task.id).map((unit) => ({ task, unit }))).sort((a, b) => a.unit.startDate.localeCompare(b.unit.startDate));
    const laneEnds: string[] = [];
    const positioned = entries.map((entry) => {
      let lane = laneEnds.findIndex((end) => end < entry.unit.startDate);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = entry.unit.endDate;
      return { ...entry, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);
    const height = 116;
    const cardHeight = Math.max(18, Math.min(50, (height - 10) / laneCount));
    mediumGroupLayout.set(group.key, { top: mediumRowTop, height, laneCount, cardHeight });
    group.tasks.forEach((task) => mediumRowLayout.set(task.id, { top: mediumRowTop, height }));
    positioned.forEach(({ unit, lane }) => {
      const clippedStart = unit.startDate < mediumWindowStart ? mediumWindowStart : unit.startDate;
      const windowEnd = windowData?.endDate ?? unit.endDate;
      const clippedEnd = unit.endDate > windowEnd ? windowEnd : unit.endDate;
      const visible = clippedStart <= clippedEnd;
      mediumUnitLayout.set(unit.id, {
        x: visible ? diffDays(parseDate(mediumWindowStart), parseDate(clippedStart)) * dayWidth : 0,
        y: mediumRowTop + 5 + lane * cardHeight + cardHeight / 2,
        width: visible ? (diffDays(parseDate(clippedStart), parseDate(clippedEnd)) + 1) * dayWidth : 0,
        height: cardHeight,
        lane,
        truncatedStart: unit.startDate < mediumWindowStart,
        truncatedEnd: unit.endDate > windowEnd
      });
    });
    mediumRowTop += height;
  });
  return (
    <section className="page medium-page">
      <PageHeader title="Médio prazo" subtitle="Janela independente de três meses para abertura e detalhamento dos lotes." />
      <div className="medium-filter card">
        <label>
          Início da análise
          <input type="date" value={analysisStart} onChange={(event) => { if (event.target.value) setAnalysisStart(event.target.value); }} />
        </label>
        <button
          onClick={() => {
            setMonthPickerStartYear(parseDate(analysisStart).getFullYear());
            setMonthPickerOpen(true);
          }}
        >
          <CalendarRange size={15} /> Selecionar mês
        </button>
        <div>
          <small>Período de três meses</small>
          <strong>
            {parseDate(analysisStart).toLocaleDateString('pt-BR')} a {parseDate(analysisEnd).toLocaleDateString('pt-BR')}
          </strong>
        </div>
        <div>
          <small>Atividades encontradas</small>
          <strong>{previewTasks.length}</strong>
        </div>
        {windowData && (
          <>
            <label className="medium-check">
              <input type="checkbox" checked={showMediumDependencies} onChange={(event) => setShowMediumDependencies(event.target.checked)} /> Dependências
            </label>
            <button onClick={addManualActivity}>＋ Atividade livre</button>
          </>
        )}
        <button className="primary" onClick={createWindow}>
          {windowData ? 'Criar nova janela' : 'Filtrar e criar janela'}
        </button>
      </div>
      {!windowData && (
        <div className="medium-empty card">
          <CalendarRange size={34} />
          <h3>Defina o período de análise</h3>
          <p>As atividades serão copiadas do longo prazo e permanecerão independentes de alterações posteriores na base.</p>
        </div>
      )}
      {windowData && (
        <>
          <div className="medium-window-info">
            <span className="pill">Janela congelada</span>
            <b>{visibleMediumTasks.length}/{windowData.tasks.length} atividades</b>
            <small>Criada em {new Date(windowData.createdAt).toLocaleString('pt-BR')}</small>
          </div>
          <div className="medium-search-bar card">
            <label>
              <Search size={15} />
              <input value={mediumActivitySearch} onChange={(event) => setMediumActivitySearch(event.target.value)} placeholder="Procurar atividade, serviço ou lote..." />
            </label>
            <label>
              <span>Equipe</span>
              <input value={mediumResponsibleSearch} onChange={(event) => setMediumResponsibleSearch(event.target.value)} placeholder="Filtrar por responsável..." />
            </label>
            <label className="medium-unassigned-filter">
              <input type="checkbox" checked={mediumOnlyUnassigned} onChange={(event) => setMediumOnlyUnassigned(event.target.checked)} />
              Sem responsável
            </label>
            {(mediumActivitySearch || mediumResponsibleSearch || mediumOnlyUnassigned) && (
              <button
                onClick={() => {
                  setMediumActivitySearch('');
                  setMediumResponsibleSearch('');
                  setMediumOnlyUnassigned(false);
                }}
              >
                Limpar filtros
              </button>
            )}
          </div>
          <div className="medium-view-controls">
            <label>
              Lotes-mãe
              <select value={mediumMotherSort} onChange={(event) => setMediumMotherSort(event.target.value as typeof mediumMotherSort)}>
                <option value="import">Ordem da janela</option>
                <option value="asc">Numérica crescente</option>
                <option value="desc">Numérica decrescente</option>
              </select>
            </label>
            <label>
              Lotes/pavimentos
              <select value={mediumLotSort} onChange={(event) => setMediumLotSort(event.target.value as typeof mediumLotSort)}>
                <option value="import">Ordem da janela</option>
                <option value="asc">Numérica crescente</option>
                <option value="desc">Numérica decrescente</option>
              </select>
            </label>
            <label>
              Zoom
              <input type="range" min="1" max="3" value={mediumZoom} onChange={(event) => setMediumZoom(Number(event.target.value))} />
            </label>
            <small>Arraste o fundo do cronograma para navegar.</small>
          </div>
          <div
            className="medium-timeline-shell"
            style={{
              gridTemplateColumns: `${labelColumnWidth}px minmax(0,1fr)`
            }}
            onPointerDown={(event) => {
              if (!(event.target as Element).closest('.medium-task-card,.medium-label-row,button,input,select')) {
                setSelectedTaskId(null);
                setSelectedMediumTaskIds([]);
              }
            }}
          >
            <div ref={mediumLabelsRef} className="medium-label-column">
              <div
                className="medium-label-head medium-location-grid"
                style={{
                  gridTemplateColumns: `32px 150px repeat(${maxSublotDepth},145px)`
                }}
              >
                <b title="Lote-mãe">LM</b>
                <b>Lote</b>
                {Array.from({ length: maxSublotDepth }).map((_, index) => (
                  <b key={index}>Sublote {index + 1}</b>
                ))}
              </div>
              {mediumLotGroups.map((group) => {
                const paths = group.tasks.flatMap((task) => leafUnits(task.id).map((unit) => unitPath(task.id, unit)));
                return (
                <div
                  draggable
                  className={`medium-label-row ${mediumOrdering === group.tasks[0].id ? 'ordering' : ''}`}
                  key={group.key}
                  style={{ height: mediumGroupLayout.get(group.key)?.height ?? 116 }}
                  onDragStart={() => setMediumOrdering(group.tasks[0].id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => reorderMediumTask(group.tasks[0].id)}
                  onDragEnd={() => setMediumOrdering(null)}
                >
                  <span className="medium-parent-mother">{group.lotMother}</span>
                  <span className="medium-parent-lot">⠿ {group.lot}</span>
                  <div className="medium-location-grid medium-location-line" style={{ gridTemplateColumns: `32px 150px repeat(${maxSublotDepth},145px)` }}>
                    <span />
                    <span />
                    {Array.from({ length: maxSublotDepth }).map((_, index) => (
                      <span key={index}>{Array.from(new Set(paths.map((path) => path[index]?.name).filter(Boolean))).join(', ') || '—'}</span>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      const ids = group.tasks.map((task) => task.id);
                      setSelectedMediumTaskIds(ids);
                      setSelectedTaskId(ids[0] ?? null);
                    }}
                  >
                    Abrir lote
                  </button>
                </div>
                );
              })}
            </div>
            <div
              ref={mediumTimelineScrollRef}
              className="medium-timeline-scroll"
              onPointerDown={startMediumPan}
              onPointerMove={moveMediumPan}
              onPointerUp={finishMediumPan}
              onPointerCancel={finishMediumPan}
              onScroll={(event) => {
                if (mediumLabelsRef.current) mediumLabelsRef.current.scrollTop = event.currentTarget.scrollTop;
              }}
            >
              <div ref={mediumTimelineRef} className="medium-timeline" style={{ width: timelineWidth, '--medium-day-width': `${dayWidth}px` } as React.CSSProperties} onPointerMove={moveMediumItem} onPointerUp={finishMediumDrag} onPointerCancel={finishMediumDrag}>
                <div className="medium-time-head">
                  <div className="medium-week-head">
                    {Array.from({ length: 14 }).map((_, index) => {
                      const date = addDays(parseDate(windowData.startDate), index * 7);
                      return (
                        <span key={index} style={{ left: index * 7 * dayWidth, width: 7 * dayWidth }}>
                          S{index + 1}-{date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '')}
                        </span>
                      );
                    })}
                  </div>
                  {Array.from({
                    length: diffDays(parseDate(windowData.startDate), parseDate(windowData.endDate)) + 1
                  }).map((_, index) => {
                    const date = addDays(parseDate(windowData.startDate), index);
                    const dayLetter = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][date.getDay()];
                    return (
                      <span className={date.getDay() === 0 || date.getDay() === 6 ? 'weekend' : ''} key={index} style={{ left: index * dayWidth, width: dayWidth }}>
                        <b>{dayLetter}</b>
                        <small>{date.getDate()}</small>
                      </span>
                    );
                  })}
                </div>
                {Array.from({
                  length: diffDays(parseDate(windowData.startDate), parseDate(windowData.endDate)) + 1
                }).map((_, index) => {
                  const date = addDays(parseDate(windowData.startDate), index);
                  return date.getDay() === 0 || date.getDay() === 6 ? (
                    <i
                      className="medium-weekend-column"
                      key={index}
                      style={{
                        left: index * dayWidth,
                        width: dayWidth,
                        height: mediumRowTop
                      }}
                    />
                  ) : null;
                })}
                {(showMediumDependencies || selectedMediumTaskIds.length > 0) && (
                  <svg className="medium-dependencies" width={timelineWidth} height={mediumRowTop}>
                    {windowData.tasks.flatMap((task) =>
                      (task.predecessors ?? []).map((fromId) => {
                        const fromTask = windowData.tasks.find((item) => item.id === fromId);
                        if (!showMediumDependencies && !selectedMediumTaskIds.includes(task.id) && !selectedMediumTaskIds.includes(fromTask?.id ?? '')) return null;
                        const fromRow = fromTask && mediumRowLayout.get(fromTask.id);
                        const toRow = mediumRowLayout.get(task.id);
                        const fromUnit = fromTask && leafUnits(fromTask.id)[0];
                        const toUnit = leafUnits(task.id)[0];
                        if (!fromRow || !toRow || !fromUnit || !toUnit) return null;
                        const sx = (diffDays(parseDate(windowData.startDate), parseDate(fromUnit.endDate)) + 1) * dayWidth;
                        const sy = fromRow.top + 34;
                        const ex = diffDays(parseDate(windowData.startDate), parseDate(toUnit.startDate)) * dayWidth;
                        const ey = toRow.top + 34;
                        const mx = Math.max(sx + 18, (sx + ex) / 2);
                        return <path key={`${fromId}-${task.id}`} d={`M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`} />;
                      })
                    )}
                    {Object.values(units)
                      .flat()
                      .flatMap((unit) =>
                        (unit.predecessors ?? []).map((fromId) => {
                          const fromOwner = mediumUnitOwner.get(fromId);
                          const toOwner = mediumUnitOwner.get(unit.id);
                          if (!showMediumDependencies && !selectedMediumTaskIds.includes(fromOwner ?? '') && !selectedMediumTaskIds.includes(toOwner ?? '')) return null;
                          const from = mediumUnitLayout.get(fromId);
                          const to = mediumUnitLayout.get(unit.id);
                          if (!from || !to) return null;
                          const sx = from.x + from.width;
                          const mx = Math.max(sx + 18, (sx + to.x) / 2);
                          return <path key={`unit-${fromId}-${unit.id}`} d={`M ${sx} ${from.y} C ${mx} ${from.y}, ${mx} ${to.y}, ${to.x} ${to.y}`} />;
                        })
                      )}
                  </svg>
                )}
                {mediumDrag?.mode === 'link' &&
                  mediumLinkPoint &&
                  (() => {
                    const source = mediumUnitLayout.get(mediumDrag.unitId);
                    if (!source) return null;
                    const sx = source.x + source.width;
                    const sy = source.y;
                    return (
                      <svg className="medium-dependencies medium-link-preview" width={timelineWidth} height={mediumRowTop}>
                        <path d={`M ${sx} ${sy} C ${sx + 40} ${sy}, ${mediumLinkPoint.x - 40} ${mediumLinkPoint.y}, ${mediumLinkPoint.x} ${mediumLinkPoint.y}`} />
                      </svg>
                    );
                  })()}
                {mediumLotGroups.map((group) => {
                  const groupLayout = mediumGroupLayout.get(group.key)!;
                  return (
                  <div className="medium-task-row" key={group.key} style={{ height: groupLayout.height }}>
                    {group.tasks.flatMap((task) =>
                      leafUnits(task.id).map((unit) => {
                      const layout = mediumUnitLayout.get(unit.id)!;
                      const x = Math.max(0, layout.x);
                      const width = layout.width;
                      if (width <= 0) return null;
                      return (
                        <button
                          className={`medium-task-card ${layout.height < 36 || width < 90 ? 'compact' : ''} ${layout.height < 24 || width < 55 ? 'tiny' : ''} ${layout.truncatedStart ? 'truncated-start' : ''} ${layout.truncatedEnd ? 'truncated-end' : ''} ${selectedMediumTaskIds.includes(task.id) ? 'selected' : ''} ${mediumDrag?.target === unit.id ? 'target' : ''}`}
                          data-medium-task-id={task.id}
                          data-medium-unit-id={unit.id}
                          key={unit.id}
                          style={{
                            left: x,
                            top: layout.y - groupLayout.top - layout.height / 2,
                            height: layout.height,
                            width,
                            borderColor: task.color
                          }}
                          onPointerDown={(event) => beginMediumDrag(event, task.id, unit, 'pending')}
                          onClick={(event) => selectMediumTask(event, task.id)}
                        >
                          <i style={{ background: task.color }} />
                          <strong>{task.packageName}</strong>
                          <span>{unit.responsible || task.responsible || 'Sem responsável'}</span>
                          <small>
                            {unit.name} · {unit.weight}% · {unit.quantity || '—'} {task.unit ?? ''}
                          </small>
                          <em title="Alterar duração" onPointerDown={(event) => beginMediumDrag(event, task.id, unit, 'resize')} />
                        </button>
                      );
                    }))}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
      {monthPickerOpen && (
        <div className="month-picker-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setMonthPickerOpen(false)}>
          <div className="month-picker-modal">
            <header>
              <button onClick={() => setMonthPickerStartYear(monthPickerStartYear - 2)}><ChevronLeft size={18} /></button>
              <div><small>Início da janela de análise</small><h3>Selecionar mês</h3></div>
              <button onClick={() => setMonthPickerStartYear(monthPickerStartYear + 2)}><ChevronRight size={18} /></button>
            </header>
            <div className="month-picker-years">
              {[monthPickerStartYear, monthPickerStartYear + 1].map((year) => (
                <section key={year}>
                  <h4>{year}</h4>
                  <div>
                    {Array.from({ length: 12 }).map((_, month) => {
                      const value = `${year}-${String(month + 1).padStart(2, '0')}-01`;
                      const active = analysisStart.slice(0, 7) === value.slice(0, 7);
                      return <button className={active ? 'active' : ''} key={month} onClick={() => { setAnalysisStart(value); setMonthPickerOpen(false); }}>{new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</button>;
                    })}
                  </div>
                </section>
              ))}
            </div>
            <footer><span>24 meses disponíveis</span><button onClick={() => setMonthPickerOpen(false)}>Cancelar</button></footer>
          </div>
        </div>
      )}
      <aside className={`calendar-drawer medium-drawer ${selectedMediumTaskIds.length ? 'open' : ''}`}>
        {selectedTask && (
          <>
            <div className="medium-selection-actions">
              <button title="Excluir atividades selecionadas" onClick={deleteSelectedMediumTasks}>
                <Trash2 size={17} />
              </button>
              <button
                className="drawer-close"
                onClick={() => {
                  setSelectedTaskId(null);
                  setSelectedMediumTaskIds([]);
                }}
              >
                ×
              </button>
            </div>
            <div className="medium-selected-list">
              {selectedMediumTaskIds.map((taskId) => {
                const task = windowData?.tasks.find((item) => item.id === taskId);
                return task ? (
                  <button className={task.id === selectedTask.id ? 'active' : ''} key={task.id} onClick={() => setSelectedTaskId(task.id)}>
                    <span>{task.packageName}</span>
                    <small>{task.lot}</small>
                  </button>
                ) : null;
              })}
            </div>
            <h3>Abrir local</h3>
            <p>
              <b>{selectedTask.packageName}</b>
              <br />
              {selectedTask.lotMother} · {selectedTask.lot}
            </p>
            <div className="medium-unit-add">
              <label>
                Abrir dentro de
                <select value={unitParentId ?? (units[selectedTask.id] ?? [])[0]?.id ?? ''} onChange={(event) => setUnitParentId(event.target.value)}>
                  {(units[selectedTask.id] ?? []).map((unit) => (
                    <option value={unit.id} key={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </label>
              <input value={newUnitName} onChange={(event) => setNewUnitName(event.target.value)} placeholder="Ex.: Balancim 1, Apto 101..." />
              <button className="primary" onClick={() => addUnit(selectedTask)}>
                Adicionar unidade
              </button>
            </div>
            <div className="medium-unit-list">
              {(units[selectedTask.id] ?? []).map((unit) => (
                <article key={unit.id}>
                  <header>
                    <input
                      value={unit.name}
                      onChange={(event) =>
                        updateUnit(selectedTask.id, unit.id, {
                          name: event.target.value
                        })
                      }
                    />
                    <button className="medium-open-unit" onClick={() => setUnitParentId(unit.id)}>
                      Abrir
                    </button>
                    <button disabled={(units[selectedTask.id] ?? []).length === 1} onClick={() => removeUnit(selectedTask.id, unit.id)}>
                      ×
                    </button>
                  </header>
                  <div>
                    <label>
                      Peso %
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step=".01"
                        value={unit.weight}
                        onChange={(event) =>
                          updateUnit(selectedTask.id, unit.id, {
                            weight: Number(event.target.value)
                          })
                        }
                      />
                    </label>
                    <label>
                      Quantidade
                      <input
                        type="number"
                        min="0"
                        value={unit.quantity}
                        onChange={(event) =>
                          updateUnit(selectedTask.id, unit.id, {
                            quantity: Number(event.target.value)
                          })
                        }
                      />
                    </label>
                    <label>
                      Início
                      <input
                        type="date"
                        value={unit.startDate}
                        onChange={(event) =>
                          updateUnit(selectedTask.id, unit.id, {
                            startDate: event.target.value
                          })
                        }
                      />
                    </label>
                    <label>
                      Fim
                      <input
                        type="date"
                        value={unit.endDate}
                        onChange={(event) =>
                          updateUnit(selectedTask.id, unit.id, {
                            endDate: event.target.value
                          })
                        }
                      />
                    </label>
                    <label className="wide">
                      Responsável
                      <input
                        value={unit.responsible}
                        onChange={(event) =>
                          updateUnit(selectedTask.id, unit.id, {
                            responsible: event.target.value
                          })
                        }
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
            <div className={`medium-weight-total ${activeSiblingWeight === 0 || Math.abs(activeSiblingWeight - 100) < 0.01 ? 'ok' : 'invalid'}`}>
              Soma dos pesos neste nível: <b>{activeSiblingWeight ? activeSiblingWeight.toFixed(2) : '100.00'}%</b>
            </div>
          </>
        )}
      </aside>
    </section>
  );
}

function LegacyFinancial({ projectKey, tasks, setTasks }: { projectKey: string; tasks: Task[]; setTasks: (tasks: Task[]) => void }) {
  const total = tasks.reduce((s, t) => s + (t.cost ?? 0), 0);
  const done = tasks.reduce((s, t) => s + ((t.cost ?? 0) * t.progress) / 100, 0);
  const [budgetItems, setBudgetItems] = useState(() => {
    const items = tasks
      .filter((task) => task.cost)
      .slice(0, 30)
      .map((task, index) => ({
        id: `budget-${task.id}`,
        code: `1.${index + 1}`,
        description: task.packageName,
        value: task.cost ?? 0
      }));
    if (!items.length) return [];
    return items.length
      ? items
      : [
          {
            id: 'budget-demo',
            code: '1.1',
            description: 'Orçamento ainda não importado',
            value: 500000
          }
        ];
  });
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [budgetRevisionName, setBudgetRevisionName] = useState('Orçamento vigente');
  const [editingBudgetName, setEditingBudgetName] = useState(false);
  const [activityIds, setActivityIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [mappingOpen, setMappingOpen] = useState(false);
  const [method, setMethod] = useState<'equal' | 'duration' | 'quantity' | 'manual'>('equal');
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [allocations, setAllocations] = useState<Array<{ budgetId: string; taskId: string; weight: number; value: number }>>([]);
  const selectedBudget = budgetItems.find((item) => item.id === budgetId);
  const selectedTasks = tasks.filter((task) => activityIds.includes(task.id));
  const linkedTasks = new Set(allocations.map((item) => item.taskId));
  const visibleTasks = tasks.filter((task) => `${task.packageName} ${task.lot} ${task.lotMother}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  useEffect(() => {
    void loadBudgetRevisionName(projectKey).then(setBudgetRevisionName);
  }, [projectKey]);
  async function persistBudgetName() {
    const name = budgetRevisionName.trim() || 'Orçamento vigente';
    setBudgetRevisionName(name);
    await saveBudgetRevisionName(projectKey, name);
    setEditingBudgetName(false);
  }
  function openMapping() {
    if (!selectedBudget || !selectedTasks.length) return;
    const basis = selectedTasks.map((task) => (method === 'duration' ? diffDays(parseDate(task.startDate), parseDate(task.endDate)) + 1 : method === 'quantity' ? (task.quantity ?? 0) : 1));
    const sum = basis.reduce((value, item) => value + item, 0) || selectedTasks.length;
    setWeights(Object.fromEntries(selectedTasks.map((task, index) => [task.id, method === 'manual' ? 0 : (basis[index] / sum) * 100])));
    setMappingOpen(true);
  }
  function redistribute(nextMethod: typeof method) {
    setMethod(nextMethod);
    const basis = selectedTasks.map((task) => (nextMethod === 'duration' ? diffDays(parseDate(task.startDate), parseDate(task.endDate)) + 1 : nextMethod === 'quantity' ? (task.quantity ?? 0) : 1));
    const sum = basis.reduce((value, item) => value + item, 0) || selectedTasks.length;
    setWeights(Object.fromEntries(selectedTasks.map((task, index) => [task.id, nextMethod === 'manual' ? (weights[task.id] ?? 0) : (basis[index] / sum) * 100])));
  }
  const weightTotal = selectedTasks.reduce((sum, task) => sum + (weights[task.id] ?? 0), 0);
  function saveMapping() {
    if (!selectedBudget || Math.abs(weightTotal - 100) > 0.05) return;
    const next = selectedTasks.map((task) => ({
      budgetId: selectedBudget.id,
      taskId: task.id,
      weight: weights[task.id],
      value: (selectedBudget.value * weights[task.id]) / 100
    }));
    setAllocations([...allocations.filter((item) => item.budgetId !== selectedBudget.id), ...next]);
    setActivityIds([]);
    setBudgetId(null);
    setMappingOpen(false);
  }
  async function deleteBudget() {
    if (!window.confirm('Excluir todo o orçamento desta obra? As atividades e datas do cronograma serão mantidas.')) return;
    await deleteProjectBudget(projectKey);
    setBudgetItems([]);
    setTasks(tasks.map((task) => ({ ...task, cost: undefined })));
    setAllocations([]);
    setBudgetId(null);
    setActivityIds([]);
  }
  return (
    <section className="page financial-mapping">
      <PageHeader title="Mapeamento físico-financeiro" subtitle="Vincule a EAP orçamentária às atividades do cronograma." />
      <div className="financial-delete-action">
        {editingBudgetName ? (
          <label className="budget-name-editor">
            Nome da revisão
            <input autoFocus value={budgetRevisionName} onChange={(event) => setBudgetRevisionName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void persistBudgetName()} />
            <button className="primary" onClick={() => void persistBudgetName()}>Salvar nome</button>
          </label>
        ) : (
          <button onClick={() => setEditingBudgetName(true)}>Editar nome: {budgetRevisionName}</button>
        )}
        <button className="danger-button" onClick={() => void deleteBudget()} disabled={!budgetItems.length}>
          <Trash2 size={16} /> Excluir orçamento
        </button>
      </div>
      <div className="metric-grid financial-metrics">
        <Metric label="Orçamento mapeável" value={budgetItems.reduce((sum, item) => sum + item.value, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} />
        <Metric label="Atividades" value={String(tasks.length)} />
        <Metric label="Vinculadas" value={`${linkedTasks.size}/${tasks.length}`} />
        <Metric
          label="Realizado"
          value={done.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL'
          })}
        />
      </div>
      <div className="mapping-shell">
        <div className="mapping-panel">
          <div className="mapping-panel-head">
            <small>ORIGEM FINANCEIRA</small>
            <h3>{budgetRevisionName}</h3>
            <span>{budgetItems.length} itens</span>
          </div>
          <div className="mapping-table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Código / descrição</th>
                  <th>Valor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {budgetItems.map((item) => {
                  const links = allocations.filter((allocation) => allocation.budgetId === item.id);
                  return (
                    <tr className={budgetId === item.id ? 'mapping-selected' : ''} key={item.id} onClick={() => setBudgetId(item.id)}>
                      <td>
                        <input type="radio" checked={budgetId === item.id} readOnly />
                      </td>
                      <td>
                        <small>{item.code}</small>
                        <strong>{item.description}</strong>
                      </td>
                      <td>
                        {item.value.toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL'
                        })}
                      </td>
                      <td>
                        <span className={links.length ? 'mapping-status linked' : 'mapping-status'}>{links.length ? 'Vinculado' : 'Livre'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mapping-panel">
          <div className="mapping-panel-head">
            <small>ORIGEM FÍSICA</small>
            <h3>Cronograma da obra</h3>
            <span>{visibleTasks.length} atividades</span>
          </div>
          <label className="mapping-search">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar atividade, lote ou grupo..." />
          </label>
          <div className="mapping-table-wrap">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Atividade</th>
                  <th>Lote</th>
                  <th>Prazo</th>
                  <th>Progresso</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleTasks.map((task) => (
                  <tr className={activityIds.includes(task.id) ? 'mapping-selected' : ''} key={task.id} onClick={() => setActivityIds(activityIds.includes(task.id) ? activityIds.filter((id) => id !== task.id) : [...activityIds, task.id])}>
                    <td>
                      <input type="checkbox" checked={activityIds.includes(task.id)} readOnly />
                    </td>
                    <td>
                      <small>{task.lotMother}</small>
                      <strong>{task.packageName}</strong>
                    </td>
                    <td>{task.lot}</td>
                    <td>{diffDays(parseDate(task.startDate), parseDate(task.endDate)) + 1}d</td>
                    <td>{task.progress}%</td>
                    <td>
                      <span className={linkedTasks.has(task.id) ? 'mapping-status linked' : 'mapping-status'}>{linkedTasks.has(task.id) ? 'Vinculada' : 'Livre'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="mapping-action">
        <Link2 size={18} />
        <div>
          <strong>
            {selectedBudget?.code ?? 'Selecione um item'} · {activityIds.length} atividade(s)
          </strong>
          <small>Escolha um item financeiro e uma ou mais atividades.</small>
        </div>
        <button className="primary" disabled={!budgetId || !activityIds.length} onClick={openMapping}>
          <ArrowLeftRight size={15} /> Vincular
        </button>
      </div>
      {mappingOpen && selectedBudget && (
        <div className="mapping-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setMappingOpen(false)}>
          <div className="mapping-modal">
            <div className="chart-drawer-head">
              <div>
                <small>{selectedBudget.code}</small>
                <h3>Vincular e ponderar</h3>
                <span>{selectedBudget.description}</span>
              </div>
              <button className="drawer-close" onClick={() => setMappingOpen(false)}>
                ×
              </button>
            </div>
            <div className="mapping-modal-body">
              <div className="mapping-methods">
                {(
                  [
                    ['equal', 'Igualitário'],
                    ['duration', 'Por duração'],
                    ['quantity', 'Por quantidade'],
                    ['manual', 'Manual']
                  ] as const
                ).map(([value, label]) => (
                  <button className={method === value ? 'active' : ''} onClick={() => redistribute(value)} key={value}>
                    {label}
                  </button>
                ))}
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Atividade / lote</th>
                    <th>Base física</th>
                    <th>Percentual</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTasks.map((task) => (
                    <tr key={task.id}>
                      <td>
                        <strong>{task.packageName}</strong>
                        <small>{task.lot}</small>
                      </td>
                      <td>{method === 'duration' ? `${diffDays(parseDate(task.startDate), parseDate(task.endDate)) + 1} dias` : method === 'quantity' ? `${task.quantity ?? 0} ${task.unit ?? ''}` : method === 'equal' ? 'Divisão igual' : 'Definição manual'}</td>
                      <td>
                        {method === 'manual' ? (
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step=".01"
                            value={(weights[task.id] ?? 0).toFixed(2)}
                            onChange={(event) =>
                              setWeights({
                                ...weights,
                                [task.id]: Number(event.target.value)
                              })
                            }
                          />
                        ) : (
                          <b>{(weights[task.id] ?? 0).toFixed(2)}%</b>
                        )}
                      </td>
                      <td>
                        {((selectedBudget.value * (weights[task.id] ?? 0)) / 100).toLocaleString('pt-BR', {
                          style: 'currency',
                          currency: 'BRL'
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <aside className="mapping-total">
                <span>Valor a distribuir</span>
                <strong>
                  {selectedBudget.value.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: 'BRL'
                  })}
                </strong>
                <p>
                  Soma dos pesos <b>{weightTotal.toFixed(2)}%</b>
                </p>
                <button disabled={Math.abs(weightTotal - 100) > 0.05} onClick={saveMapping}>
                  Confirmar vínculo
                </button>
              </aside>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

type BudgetImportField = 'level' | 'code' | 'description' | 'material' | 'labor' | 'total' | 'taskId' | 'packageName' | 'service' | 'lot' | 'part' | 'divisionType' | 'weight';
type BudgetImportMode = 'budget' | 'links' | 'budget-links';
const budgetImportFields: Array<{ key: BudgetImportField; label: string; required: boolean; aliases: string[] }> = [
  { key: 'level', label: 'Nível', required: false, aliases: ['nível', 'nivel'] },
  { key: 'code', label: 'Código', required: true, aliases: ['código', 'codigo'] },
  { key: 'description', label: 'Descrição', required: true, aliases: ['descrição', 'descricao'] },
  { key: 'material', label: 'Material (R$)', required: false, aliases: ['material (r$)', 'material'] },
  { key: 'labor', label: 'Mão de Obra (R$)', required: false, aliases: ['mão de obra (r$)', 'mao de obra (r$)', 'mão de obra'] },
  { key: 'total', label: 'Custo / Total (R$)', required: true, aliases: ['custo', 'custo (r$)', 'total (r$)', 'total'] },
  { key: 'taskId', label: 'ID da atividade', required: false, aliases: ['id da atividade', 'id atividade'] },
  { key: 'packageName', label: 'Pacote de trabalho/tarefas', required: false, aliases: ['pacote de trabalho/tarefas', 'pacote de trabalho', 'tarefas'] },
  { key: 'service', label: 'Serviço', required: false, aliases: ['serviço', 'servico'] },
  { key: 'lot', label: 'Lote', required: false, aliases: ['lote'] },
  { key: 'divisionType', label: 'Tipo de divisão', required: false, aliases: ['tipo de divisão', 'tipo de divisao'] },
  { key: 'weight', label: 'Peso (% Item)', required: false, aliases: ['peso (% item)', 'peso', 'peso item'] }
];
const linkImportFields: Array<{ key: BudgetImportField; label: string; required: boolean; aliases: string[] }> = [
  { key: 'level', label: 'Nível', required: false, aliases: ['nível', 'nivel'] },
  { key: 'code', label: 'Código', required: true, aliases: ['código', 'codigo'] },
  { key: 'description', label: 'Descrição', required: false, aliases: ['descrição', 'descricao'] },
  { key: 'total', label: 'Custo', required: false, aliases: ['custo', 'custo (r$)', 'total (r$)', 'total'] },
  { key: 'packageName', label: 'Pacote de trabalho/tarefas', required: false, aliases: ['pacote de trabalho/tarefas', 'pacote de trabalho', 'tarefas'] },
  { key: 'service', label: 'Serviço', required: false, aliases: ['serviço', 'servico'] },
  { key: 'lot', label: 'Lote', required: false, aliases: ['lote'] },
  { key: 'part', label: 'Parte', required: false, aliases: ['parte', 'grupo', 'lote mãe', 'lote mae'] },
  { key: 'weight', label: 'Peso (% Item)', required: false, aliases: ['peso (% item)', 'peso', 'peso item'] }
];

function Financial({ projectKey, tasks }: { projectKey: string; tasks: Task[]; setTasks: (tasks: Task[]) => void }) {
  const [budgets, setBudgets] = useState<BudgetRevision[]>([]);
  const [type, setType] = useState<BudgetType>('contractor');
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [activityIds, setActivityIds] = useState<string[]>([]);
  const [budgetSearch, setBudgetSearch] = useState('');
  const [activitySearch, setActivitySearch] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [message, setMessage] = useState('');
  const [importMode, setImportMode] = useState<BudgetImportMode>('budget');
  const [importData, setImportData] = useState<{ fileName: string; rows: unknown[][]; headerRow: number; type: BudgetType; mode: BudgetImportMode } | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<BudgetImportField, number>>>({});
  const [weightModalOpen, setWeightModalOpen] = useState(false);
  const [weightMethod, setWeightMethod] = useState<'duration' | 'quantity' | 'area' | 'percentage'>('duration');
  const [linkWeights, setLinkWeights] = useState<Record<string, number>>({});
  const [lockedWeights, setLockedWeights] = useState<Set<string>>(new Set());
  const [savingLinks, setSavingLinks] = useState(false);
  const [lotAreasOpen, setLotAreasOpen] = useState(false);
  const [lotAreas, setLotAreas] = useState<Record<string, number>>({});
  const [savingLotAreas, setSavingLotAreas] = useState(false);
  const current = budgets.find((budget) => budget.type === type);
  const items = current?.items ?? [];
  const allocations = current?.allocations ?? [];
  const selected = items.find((item) => item.id === budgetId);
  const linkedTasks = new Set(allocations.map((item) => item.taskId));
  const visibleItems = items.filter((item) => `${item.code} ${item.description}`.toLocaleLowerCase('pt-BR').includes(budgetSearch.toLocaleLowerCase('pt-BR')));
  const visibleTasks = tasks.filter((task) => `${task.packageName} ${task.service ?? ''} ${task.lot} ${task.lotMother}`.toLocaleLowerCase('pt-BR').includes(activitySearch.toLocaleLowerCase('pt-BR')));
  const allVisibleTasksSelected = visibleTasks.length > 0 && visibleTasks.every((task) => activityIds.includes(task.id));
  const displayedImportFields = importData?.mode === 'links' ? linkImportFields : budgetImportFields;

  function toggleVisibleTasks() {
    const visibleIds = new Set(visibleTasks.map((task) => task.id));
    setActivityIds((currentIds) => allVisibleTasksSelected
      ? currentIds.filter((id) => !visibleIds.has(id))
      : Array.from(new Set([...currentIds, ...visibleIds])));
  }

  useEffect(() => {
    loadBudgets(projectKey).then(setBudgets).catch((error) => setMessage((error as Error).message));
  }, [projectKey]);

  function detectBudgetMapping(headers: unknown[]) {
    const result: Partial<Record<BudgetImportField, number>> = {};
    budgetImportFields.forEach((field) => {
      const index = headers.findIndex((header) => field.aliases.includes(String(header).trim().toLocaleLowerCase('pt-BR')));
      if (index >= 0) result[field.key] = index;
    });
    return result;
  }
  async function readBudgetFile(file: File) {
    if (importMode === 'links' && !current) {
      setMessage('Importe um orçamento antes de importar somente os vínculos.');
      return;
    }
    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    const headerRow = 1;
    setImportData({ fileName: file.name, rows, headerRow, type, mode: importMode });
    setMapping(detectBudgetMapping(rows[0] ?? []));
  }
  const importFieldRequired = (field: typeof budgetImportFields[number], mode = importData?.mode) =>
    field.key === 'code' || (mode !== 'links' && field.required);
  function updateBudgetHeaderRow(value: number) {
    if (!importData) return;
    const headerRow = Math.max(1, value);
    setImportData({ ...importData, headerRow });
    setMapping(detectBudgetMapping(importData.rows[headerRow - 1] ?? []));
  }
  const money = (input: unknown) => {
    if (typeof input === 'number') return input;
    const clean = String(input ?? '').replace(/[^\d,.-]/g, '');
    return Number(clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean) || 0;
  };
  async function confirmImport() {
    if (!importData || displayedImportFields.some((field) => importFieldRequired(field, importData.mode) && mapping[field.key] === undefined)) return;
    const get = (row: unknown[], key: BudgetImportField) => mapping[key] === undefined ? '' : row[mapping[key]!];
    const sourceRows = importData.rows.slice(importData.headerRow);
    const old = budgets.find((budget) => budget.type === importData.type);
    if (importData.mode === 'links' && !old) return setMessage('Não há orçamento ativo para receber os vínculos.');
    const importedByCode = new Map<string, BudgetItem>();
    if (importData.mode === 'links') old!.items.forEach((item) => importedByCode.set(item.code, item));
    else sourceRows.forEach((row) => {
      const code = String(get(row, 'code')).trim();
      const description = String(get(row, 'description')).trim();
      if (!code || !description || importedByCode.has(code)) return;
      importedByCode.set(code, {
        id: crypto.randomUUID(), level: String(get(row, 'level')).trim(),
        code, description, material: money(get(row, 'material')),
        labor: money(get(row, 'labor')), total: money(get(row, 'total'))
      });
    });
    const imported = Array.from(importedByCode.values());
    if (!imported.length) return setMessage('Nenhum item válido foi encontrado.');
    const sameEap = old && old.items.length === imported.length && old.items.every((item, index) => item.code === imported[index]?.code);
    if (old && !sameEap && !window.confirm('A EAP está diferente. Esta será uma nova importação e todos os vínculos atuais deste orçamento serão perdidos. Continuar?')) return;
    // Cada versão possui seus próprios itens. Mesmo com EAP idêntica, reutilizar
    // o UUID da versão anterior violaria a chave primária e misturaria auditorias.
    const normalized = imported;
    const matchTask = (row: unknown[]) => {
      const explicitId = String(get(row, 'taskId')).trim();
      if (explicitId) return tasks.filter((task) => task.id === explicitId);
      const packageName = String(get(row, 'packageName')).trim().toLocaleLowerCase('pt-BR');
      const service = String(get(row, 'service')).trim().toLocaleLowerCase('pt-BR');
      const lot = String(get(row, 'lot')).trim().toLocaleLowerCase('pt-BR');
      const part = String(get(row, 'part')).trim().toLocaleLowerCase('pt-BR');
      if (!packageName && !service && !lot && !part) return [];
      return tasks.filter((task) =>
        (!packageName || task.packageName.toLocaleLowerCase('pt-BR') === packageName) &&
        (!service || (task.service ?? '').toLocaleLowerCase('pt-BR') === service) &&
        (!lot || task.lot.toLocaleLowerCase('pt-BR') === lot) &&
        (!part || task.lotMother.toLocaleLowerCase('pt-BR') === part)
      );
    };
    const ambiguous = sourceRows.filter((row) => matchTask(row).length > 1);
    if (ambiguous.length) return setMessage(`${ambiguous.length} linha(s) encontram mais de uma atividade. Confira Pacote, Serviço, Lote e Parte.`);
    const itemByCode = new Map(normalized.map((item) => [item.code, item]));
    const importedAllocations = sourceRows.flatMap((row) => {
      const task = matchTask(row)[0];
      const item = itemByCode.get(String(get(row, 'code')).trim());
      if (!task || !item) return [];
      const rawWeight = money(get(row, 'weight'));
      const weight = rawWeight || 100;
      const rawDivision = String(get(row, 'divisionType')).trim().toLocaleLowerCase('pt-BR');
      const divisionType = rawDivision.includes('dura') || rawDivision.includes('tempo') ? 'duration'
        : rawDivision.includes('quant') ? 'quantity'
        : rawDivision.includes('área') || rawDivision.includes('area') ? 'area'
        : rawDivision.includes('percent') || rawDivision.includes('%') ? 'percentage'
        : rawDivision.includes('igual') ? 'equal' : 'manual';
      return [{
        budgetId: item.id, taskId: task.id, packageName: task.packageName, serviceName: task.service,
        lotName: task.lot, divisionType: divisionType as 'manual' | 'equal' | 'duration' | 'quantity' | 'area' | 'percentage',
        weight, value: item.total * weight / 100
      }];
    });
    if (importData.mode === 'links' && !importedAllocations.length) return setMessage('Nenhum vínculo válido foi encontrado. Confira o código do item e a identificação da atividade.');
    const invalidWeights = normalized.filter((item) => {
      const links = importedAllocations.filter((allocation) => allocation.budgetId === item.id);
      if (!links.length) return false;
      return Math.abs(links.reduce((sum, allocation) => sum + allocation.weight, 0) - 100) > 0.05;
    });
    if (invalidWeights.length) return setMessage(`Os pesos não fecham 100% para: ${invalidWeights.map((item) => item.code).join(', ')}.`);
    const next: BudgetRevision = {
      projectKey,
      type: importData.type,
      name: old?.name ?? (importData.type === 'contractor' ? 'Orçamento da construtora' : 'Orçamento de financiamento'),
      versionId: importData.mode === 'links' ? old?.versionId : undefined,
      versionNumber: importData.mode === 'links' ? old?.versionNumber : undefined,
      items: normalized,
      allocations: importData.mode === 'budget' ? (sameEap ? old?.allocations ?? [] : []) : importedAllocations
    };
    try {
      if (importData.mode === 'links') await saveBudgetAllocations(next);
      else await saveBudget(next);
      setBudgets([...budgets.filter((budget) => budget.type !== next.type), next]);
      setType(next.type); setImportData(null); setBudgetId(null);
      setMessage(importData.mode === 'links' ? 'Vínculos importados com sucesso.' : importData.mode === 'budget-links' ? 'Orçamento e vínculos importados com sucesso.' : 'Orçamento importado com sucesso.');
    } catch (error) { setMessage((error as Error).message); }
  }
  async function persistName(name: string) {
    if (!current) return;
    const next = { ...current, name: name.trim() || current.name };
    try {
      await saveBudget(next);
      setBudgets(budgets.map((budget) => budget.type === type ? next : budget));
      setEditingName(false); setMessage('Nome salvo.');
    } catch (error) { setMessage(`Não foi possível salvar: ${(error as Error).message}`); }
  }
  async function removeBudget() {
    if (!current || !window.confirm(`Excluir "${current.name}" e todos os seus vínculos?`)) return;
    try {
      await deleteSavedBudget(projectKey, type);
      setBudgets(budgets.filter((budget) => budget.type !== type)); setBudgetId(null); setMessage('Orçamento excluído.');
    } catch (error) { setMessage((error as Error).message); }
  }
  function exportLinks() {
    if (!current || !allocations.length) return;
    const itemById = new Map(items.map((item) => [item.id, item]));
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const rows = allocations.map((allocation) => {
      const item = itemById.get(allocation.budgetId);
      const task = taskById.get(allocation.taskId);
      return {
        'Nível': item?.level ?? '',
        'Código': item?.code ?? '',
        'Descrição': item?.description ?? '',
        'Custo': item?.total ?? 0,
        'Pacote de trabalho/tarefas': allocation.packageName ?? task?.packageName ?? '',
        'Serviço': allocation.serviceName ?? task?.service ?? '',
        'Lote': allocation.lotName ?? task?.lot ?? '',
        'Parte': task?.lotMother ?? '',
        'Peso (% Item)': allocation.weight
      };
    });
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [
      { wch: 12 }, { wch: 18 }, { wch: 45 }, { wch: 16 }, { wch: 34 },
      { wch: 30 }, { wch: 24 }, { wch: 24 }, { wch: 16 }
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Vínculos');
    const safeName = current.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'orcamento';
    XLSX.writeFile(workbook, `vinculos-${safeName}.xlsx`);
    setMessage(`${rows.length} vínculo(s) exportado(s).`);
  }
  const groupedLots = Array.from(new Set(tasks.map((task) => task.lotMother))).sort((a, b) => a.localeCompare(b, 'pt-BR')).map((lotMother) => ({
    lotMother,
    lots: Array.from(new Set(tasks.filter((task) => task.lotMother === lotMother).map((task) => task.lot))).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  }));
  const lotAreaKey = (lotMother: string, lotName: string) => `${lotMother}\u001f${lotName}`;
  async function openLotAreas() {
    setLotAreasOpen(true);
    try {
      const saved = await loadFinancialLotAreas(projectKey);
      setLotAreas(Object.fromEntries(saved.map((area) => [lotAreaKey(area.lotMother, area.lotName), area.projectionArea])));
    } catch (error) { setMessage(`Não foi possível carregar as áreas: ${(error as Error).message}`); }
  }
  async function persistLotAreas() {
    try {
      setSavingLotAreas(true);
      await saveFinancialLotAreas(projectKey, groupedLots.flatMap((group) => group.lots.map((lotName) => ({
        lotMother: group.lotMother, lotName,
        projectionArea: Math.max(0, lotAreas[lotAreaKey(group.lotMother, lotName)] ?? 0)
      }))));
      setLotAreasOpen(false); setMessage('Áreas de projeção salvas.');
    } catch (error) { setMessage(`Não foi possível salvar as áreas: ${(error as Error).message}`); }
    finally { setSavingLotAreas(false); }
  }
  function taskBasis(task: Task, method: typeof weightMethod) {
    if (method === 'duration') return diffDays(parseDate(task.startDate), parseDate(task.endDate)) + 1;
    if (method === 'quantity') return task.quantity ?? 0;
    if (method === 'area') return /^(m2|m²|metro(s)? quadrado(s)?)$/i.test((task.unit ?? '').trim()) ? (task.quantity ?? 0) : 0;
    return 1;
  }
  function distributeWeights(method: typeof weightMethod, locks = lockedWeights, source = linkWeights) {
    const selectedTasks = tasks.filter((task) => activityIds.includes(task.id));
    const lockedTotal = selectedTasks.reduce((sum, task) => sum + (locks.has(task.id) ? (source[task.id] ?? 0) : 0), 0);
    const unlocked = selectedTasks.filter((task) => !locks.has(task.id));
    const remaining = Math.max(0, 100 - lockedTotal);
    const bases = unlocked.map((task) => method === 'percentage' ? 1 : taskBasis(task, method));
    const basisTotal = bases.reduce((sum, value) => sum + value, 0);
    const next = { ...source };
    unlocked.forEach((task, index) => { next[task.id] = basisTotal ? remaining * bases[index] / basisTotal : remaining / Math.max(1, unlocked.length); });
    setLinkWeights(next);
  }
  function openWeightModal() {
    const selectedTasks = tasks.filter((task) => activityIds.includes(task.id));
    const total = selectedTasks.reduce((sum, task) => sum + taskBasis(task, 'duration'), 0);
    setLinkWeights(Object.fromEntries(selectedTasks.map((task) => [task.id, total ? taskBasis(task, 'duration') * 100 / total : 100 / selectedTasks.length])));
    setLockedWeights(new Set()); setWeightMethod('duration'); setWeightModalOpen(true);
  }
  function changeManualWeight(taskId: string, value: number) {
    const next = { ...linkWeights, [taskId]: Math.max(0, Math.min(100, value)) };
    const locks = new Set(lockedWeights); locks.add(taskId);
    setLockedWeights(locks); distributeWeights('percentage', locks, next);
  }
  async function linkSelected() {
    if (!current || !selected || !activityIds.length || savingLinks) return;
    const next: BudgetRevision = {
      ...current,
      allocations: [
        ...allocations.filter((item) => item.budgetId !== selected.id),
        ...activityIds.map((taskId) => {
          const task = tasks.find((candidate) => candidate.id === taskId);
          return {
            budgetId: selected.id, taskId, packageName: task?.packageName,
            serviceName: task?.service, lotName: task?.lot, divisionType: weightMethod,
            weight: linkWeights[taskId] ?? 0, value: selected.total * (linkWeights[taskId] ?? 0) / 100
          };
        })
      ]
    };
    try {
      setSavingLinks(true);
      await saveBudgetAllocations(next);
      setBudgets(budgets.map((budget) => budget.type === type ? next : budget)); setActivityIds([]); setWeightModalOpen(false); setMessage('Vínculo salvo.');
    } catch (error) { setMessage(`Não foi possível salvar o vínculo: ${(error as Error).message}`); }
    finally { setSavingLinks(false); }
  }

  return (
    <section className="page financial-mapping">
      <PageHeader title="Mapeamento físico-financeiro" subtitle="Vincule os orçamentos de despesas e financiamento às atividades do cronograma." />
      <div className="financial-toolbar">
        <div className="mapping-methods">
          <button className={type === 'contractor' ? 'active' : ''} onClick={() => { setType('contractor'); setBudgetId(null); }}>Construtora · saídas</button>
          <button className={type === 'financing' ? 'active' : ''} onClick={() => { setType('financing'); setBudgetId(null); }}>Financiamento · entradas</button>
        </div>
        <select className="budget-import-mode" value={importMode} onChange={(event) => setImportMode(event.target.value as BudgetImportMode)} aria-label="Tipo de importação"><option value="budget">Importar orçamento</option><option value="links">Importar vínculos</option><option value="budget-links">Importar orçamento + vínculos</option></select>
        <label className="primary budget-upload"><Upload size={15} /> Selecionar arquivo<input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readBudgetFile(file); event.currentTarget.value = ''; }} /></label>
        <button type="button" disabled={!current || !allocations.length} onClick={exportLinks}><Download size={15} /> Exportar vínculos</button>
        <button type="button" disabled={!tasks.length} onClick={() => void openLotAreas()}><Settings size={15} /> Configurar pavimentos</button>
        <button className="danger-button" disabled={!current} onClick={() => void removeBudget()}><Trash2 size={15} /> Excluir</button>
      </div>
      {message && <p className="financial-message">{message}</p>}
      {!current ? <div className="card empty-state"><h3>Nenhum orçamento de {type === 'contractor' ? 'construtora' : 'financiamento'} importado</h3><p>Importe uma planilha para começar. Projetos novos permanecem sem orçamento até essa etapa.</p></div> : <>
        <div className="financial-delete-action">
          {editingName ? <label className="budget-name-editor">Nome <input autoFocus defaultValue={current.name} onKeyDown={(event) => { if (event.key === 'Enter') void persistName(event.currentTarget.value); }} /><button className="primary" onClick={(event) => { const input = event.currentTarget.parentElement?.querySelector('input'); if (input) void persistName(input.value); }}>Salvar nome</button></label> : <button onClick={() => setEditingName(true)}>Editar nome: {current.name}</button>}
        </div>
        <div className="metric-grid financial-metrics">
          <Metric label={type === 'contractor' ? 'Total de despesas' : 'Total de entradas'} value={items.reduce((sum, item) => sum + item.total, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} />
          <Metric label="Itens da EAP" value={String(items.length)} /><Metric label="Atividades vinculadas" value={`${linkedTasks.size}/${tasks.length}`} />
        </div>
        <div className="mapping-shell">
          <div className="mapping-panel"><div className="mapping-panel-head"><small>ORÇAMENTO</small><h3>{current.name}</h3><span>{visibleItems.length} itens</span></div>
            <label className="mapping-search"><Search size={15}/><input value={budgetSearch} onChange={(e) => setBudgetSearch(e.target.value)} placeholder="Buscar código ou descrição..." /></label>
            <div className="mapping-table-wrap"><table><thead><tr><th></th><th>Nível</th><th>Código / descrição</th><th>Total</th><th>Status</th></tr></thead><tbody>{visibleItems.map((item) => { const linked = allocations.some((link) => link.budgetId === item.id); return <tr key={item.id} className={budgetId === item.id ? 'mapping-selected' : ''} onClick={() => setBudgetId(item.id)}><td><input type="radio" checked={budgetId === item.id} readOnly /></td><td>{item.level}</td><td><small>{item.code}</small><strong>{item.description}</strong></td><td>{item.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td><td><span className={linked ? 'mapping-status linked' : 'mapping-status'}>{linked ? 'Vinculado' : 'Livre'}</span></td></tr>; })}</tbody></table></div>
          </div>
          <div className="mapping-panel"><div className="mapping-panel-head"><small>ORIGEM FÍSICA</small><h3>Cronograma da obra</h3><div className="mapping-panel-head-actions"><span>{visibleTasks.length} atividades</span><button type="button" disabled={!visibleTasks.length} onClick={toggleVisibleTasks}><CheckSquare size={15}/>{allVisibleTasksSelected ? 'Limpar seleção' : 'Selecionar todos'}</button></div></div>
            <div className="mapping-filter-actions"><label className="mapping-search"><Search size={15}/><input value={activitySearch} onChange={(e) => setActivitySearch(e.target.value)} placeholder="Buscar atividade, serviço, lote ou grupo..." /></label>{activityIds.length > 0 && <strong>{activityIds.length} selecionada(s)</strong>}</div>
            <div className="mapping-table-wrap"><table><thead><tr><th></th><th>Atividade</th><th>Lote</th><th>Prazo</th><th>Status</th></tr></thead><tbody>{visibleTasks.map((task) => <tr key={task.id} className={activityIds.includes(task.id) ? 'mapping-selected' : ''} onClick={() => setActivityIds((currentIds) => currentIds.includes(task.id) ? currentIds.filter((id) => id !== task.id) : [...currentIds, task.id])}><td><input type="checkbox" checked={activityIds.includes(task.id)} readOnly /></td><td><small>{task.service || task.lotMother}</small><strong>{task.packageName}</strong></td><td>{task.lot}</td><td>{diffDays(parseDate(task.startDate), parseDate(task.endDate)) + 1}d</td><td><span className={linkedTasks.has(task.id) ? 'mapping-status linked' : 'mapping-status'}>{linkedTasks.has(task.id) ? 'Vinculada' : 'Livre'}</span></td></tr>)}</tbody></table></div>
          </div>
        </div>
        <div className="mapping-action"><Link2 size={18}/><div><strong>{selected?.code ?? 'Selecione um item'} · {activityIds.length} atividade(s)</strong><small>Defina o critério de ponderação antes de confirmar.</small></div><button className="primary" disabled={!selected || !activityIds.length} onClick={openWeightModal}><ArrowLeftRight size={15}/> Vincular</button></div>
      </>}
      {weightModalOpen && selected && <div className="mapping-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setWeightModalOpen(false)}><div className="mapping-modal"><div className="chart-drawer-head"><div><small>{selected.code}</small><h3>Ponderar vínculo</h3><span>{selected.description}</span></div><button className="drawer-close" onClick={() => setWeightModalOpen(false)}>×</button></div><div className="mapping-modal-body">
        <div className="mapping-methods">{([['duration','Por tempo'],['quantity','Por quantidade'],['area','Por área'],['percentage','Percentual']] as const).map(([value,label]) => <button key={value} className={weightMethod === value ? 'active' : ''} onClick={() => { setWeightMethod(value); const locks = value === 'percentage' ? lockedWeights : new Set<string>(); setLockedWeights(locks); distributeWeights(value, locks); }}>{label}</button>)}</div>
        {weightMethod === 'area' && !tasks.some((task) => activityIds.includes(task.id) && taskBasis(task, 'area') > 0) && <p className="financial-message">As atividades selecionadas não possuem quantidade com unidade de área (m²).</p>}
        <table><thead><tr><th>Atividade / lote</th><th>Base</th><th>Peso</th><th>Valor</th></tr></thead><tbody>{tasks.filter((task) => activityIds.includes(task.id)).map((task) => <tr key={task.id}><td><small>{task.lot}</small><strong>{task.packageName}</strong></td><td>{weightMethod === 'duration' ? `${taskBasis(task, weightMethod)} dias` : weightMethod === 'area' ? `${taskBasis(task, weightMethod)} m²` : weightMethod === 'quantity' ? `${task.quantity ?? 0} ${task.unit ?? ''}` : 'Manual'}</td><td><div className="weight-lock-cell">{weightMethod === 'percentage' ? <input type="number" min="0" max="100" step=".01" value={(linkWeights[task.id] ?? 0).toFixed(2)} onChange={(e) => changeManualWeight(task.id, Number(e.target.value))}/> : <b>{(linkWeights[task.id] ?? 0).toFixed(2)}%</b>}{weightMethod === 'percentage' && <button title={lockedWeights.has(task.id) ? 'Destravar percentual' : 'Travar percentual'} onClick={() => { const locks = new Set(lockedWeights); lockedWeights.has(task.id) ? locks.delete(task.id) : locks.add(task.id); setLockedWeights(locks); distributeWeights('percentage', locks); }}>{lockedWeights.has(task.id) ? <Lock size={15}/> : <Unlock size={15}/>}</button>}</div></td><td>{(selected.total * (linkWeights[task.id] ?? 0) / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</td></tr>)}</tbody></table>
        <aside className="mapping-total"><span>Valor a distribuir</span><strong>{selected.total.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong><p>Soma dos pesos <b>{activityIds.reduce((sum,id) => sum + (linkWeights[id] ?? 0),0).toFixed(2)}%</b></p>{Math.abs(activityIds.reduce((sum,id) => sum + (linkWeights[id] ?? 0),0)-100) > .05 && <small>Para confirmar, a soma dos pesos deve ser 100%.</small>}<button type="button" disabled={savingLinks || Math.abs(activityIds.reduce((sum,id) => sum + (linkWeights[id] ?? 0),0)-100) > .05} onClick={() => void linkSelected()}>{savingLinks ? 'Salvando...' : 'Confirmar vínculo'}</button></aside>
      </div></div></div>}
      {lotAreasOpen && <div className="mapping-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setLotAreasOpen(false)}><div className="mapping-modal lot-areas-modal"><div className="chart-drawer-head"><div><small>CONFIGURAÇÃO FÍSICA</small><h3>Configurar pavimentos</h3><span>Informe a área de projeção de cada lote.</span></div><button className="drawer-close" onClick={() => setLotAreasOpen(false)}>×</button></div><div className="mapping-modal-body lot-areas-body">
        {groupedLots.map((group) => <section className="lot-area-group" key={group.lotMother}><h4>{group.lotMother}</h4>{group.lots.map((lotName) => <label key={lotName}><span>{lotName}</span><div><input type="number" min="0" step=".01" value={lotAreas[lotAreaKey(group.lotMother, lotName)] ?? ''} onChange={(event) => setLotAreas({ ...lotAreas, [lotAreaKey(group.lotMother, lotName)]: Math.max(0, Number(event.target.value)) })}/><small>m²</small></div></label>)}</section>)}
        <div className="lot-areas-actions"><button type="button" onClick={() => setLotAreasOpen(false)}>Cancelar</button><button type="button" className="primary" disabled={savingLotAreas} onClick={() => void persistLotAreas()}>{savingLotAreas ? 'Salvando...' : 'Salvar áreas'}</button></div>
      </div></div></div>}
      <aside className={`import-drawer ${importData ? 'open' : ''}`}>{importData && <><div className="chart-drawer-head"><div><small>IMPORTAÇÃO DE ORÇAMENTO</small><h3>Mapear colunas</h3><span>{importData.fileName}</span></div><button className="drawer-close" onClick={() => setImportData(null)}>×</button></div><div className="drawer-content">
        <label className="import-header-row">Conteúdo<select value={importData.mode} onChange={(e) => setImportData({ ...importData, mode: e.target.value as BudgetImportMode })}><option value="budget">Somente orçamento</option><option value="links">Somente vínculos</option><option value="budget-links">Orçamento e vínculos</option></select></label>
        <label className="import-header-row">Tipo de orçamento<select value={importData.type} onChange={(e) => setImportData({ ...importData, type: e.target.value as BudgetType })}><option value="contractor">Construtora (saída)</option><option value="financing">Financiamento (entrada)</option></select></label>
        <label className="import-header-row">Linha dos títulos<input type="number" min={1} value={importData.headerRow} onChange={(e) => updateBudgetHeaderRow(Number(e.target.value))}/></label><p className="import-help">Informe em qual coluna está cada informação. Os campos com * são obrigatórios.</p>
        <div className="mapping-grid">{displayedImportFields.map((field) => <label key={field.key}>{field.label}{importFieldRequired(field, importData.mode) ? ' *' : ''}<select value={mapping[field.key] ?? ''} onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value === '' ? undefined : Number(e.target.value) })}><option value="">Não importar</option>{(importData.rows[importData.headerRow - 1] ?? []).map((header, index) => <option key={index} value={index}>{String(header) || `Coluna ${index + 1}`}</option>)}</select></label>)}</div>
        <div className="import-summary"><strong>{Math.max(0, importData.rows.length - importData.headerRow)} linhas encontradas</strong><span>{displayedImportFields.some((field) => importFieldRequired(field, importData.mode) && mapping[field.key] === undefined) ? 'Complete os campos obrigatórios.' : 'Mapeamento pronto para importar.'}</span></div><button className="primary import-confirm" disabled={displayedImportFields.some((field) => importFieldRequired(field, importData.mode) && mapping[field.key] === undefined)} onClick={() => void confirmImport()}>Confirmar importação</button>
      </div></>}</aside>
    </section>
  );
}

function SettingsPage() {
  return (
    <section className="page">
      <PageHeader title="Configurações" subtitle="Parâmetros do sistema." />
      <div className="card">
        <p>
          Supabase: <strong>{isSupabaseConfigured ? 'configurado' : 'não configurado / modo demo'}</strong>
        </p>
        <p>Próximas configurações: data zero, calendário, feriados, famílias de pacote, tolerância de compras e templates de microserviços.</p>
      </div>
    </section>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AuthGate>{(userId) => <App userId={userId} />}</AuthGate>
);
