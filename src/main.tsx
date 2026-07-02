import React, { useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import * as XLSX from 'xlsx';
import {
  BarChart3,
  Building2,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  FileSpreadsheet,
  Home,
  KanbanSquare,
  LineChart,
  Menu,
  Settings,
} from 'lucide-react';
import { projects, procurement, tasks as initialTasks } from './demoData';
import { addDays, diffDays, parseDate, toIsoDate } from './lib/date';
import { isSupabaseConfigured } from './lib/supabase';
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
  { key: 'settings', label: 'Configurações', icon: <Settings /> },
];

const projectStart = parseDate('2025-08-01');
const chartEnd = parseDate('2026-12-01');
const zoomPx: Record<number, number> = { 1: 4.8, 2: 6.5, 3: 8.5, 4: 11, 5: 14, 6: 18, 7: 24 };

function App() {
  const [collapsed, setCollapsed] = useState(true);
  const [page, setPage] = useState<Page>('projects');
  const [projectList, setProjectList] = useState<Project[]>(projects);
  const [project, setProject] = useState<Project>(projects[0]);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);

  return (
    <div className="app">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <button className="menu-button" onClick={() => setCollapsed(!collapsed)}><Menu /></button>
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
          <b className="pill">{isSupabaseConfigured ? 'Supabase conectado' : 'Modo demo local'}</b>
        </header>

        {page === 'projects' && <Projects projects={projectList} selected={project} onUpdate={(updated) => { setProjectList(projectList.map((item) => item.id === updated.id ? updated : item)); if (project.id === updated.id) setProject(updated); }} onCalendar={() => setPage('globalCalendar')} onSelect={(p) => { setProject(p); setPage('dashboard'); }} />}
        {page === 'globalCalendar' && <AnnualCalendar projects={projectList} title="Calendário geral" subtitle="Feriados nacionais e datas compartilhadas entre todas as obras." events={calendarEvents.filter((event) => !event.projectId)} onChange={(events) => setCalendarEvents([...calendarEvents.filter((event) => event.projectId), ...events])} />}
        {page === 'workCalendar' && <AnnualCalendar projects={projectList} projectId={project.id} title={`Calendário · ${project.name}`} subtitle="Rotinas, feriados e datas importantes desta obra." events={calendarEvents.filter((event) => event.projectId === project.id || (!event.projectId && (event.appliesToAll || event.projectIds?.includes(project.id))))} onChange={(events) => setCalendarEvents([...calendarEvents.filter((event) => event.projectId !== project.id && event.projectId), ...calendarEvents.filter((event) => !event.projectId), ...events.filter((event) => event.projectId === project.id)])} />}
        {page === 'dashboard' && <Dashboard tasks={tasks} />}
        {page === 'schedule' && <Schedule tasks={tasks} />}
        {page === 'line' && <LineBalance tasks={tasks} setTasks={setTasks} holidays={calendarEvents.filter((event) => event.kind === 'holiday' && (event.projectId === project.id || (!event.projectId && (event.appliesToAll || event.projectIds?.includes(project.id)))))} />}
        {page === 'procurement' && <Procurement />}
        {page === 'medium' && <MediumPlan />}
        {page === 'short' && <ShortTerm />}
        {page === 'financial' && <Financial tasks={tasks} />}
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

function Projects({ projects: items, selected, onSelect, onCalendar, onUpdate }: { projects: Project[]; selected: Project; onSelect: (p: Project) => void; onCalendar: () => void; onUpdate: (p: Project) => void }) {
  const [editing, setEditing] = useState<Project | null>(null);
  const cityOptions = [
    { city: 'Curitiba', state: 'PR', ibge: '4106902' },
    { city: 'São Paulo', state: 'SP', ibge: '3550308' },
    { city: 'Rio de Janeiro', state: 'RJ', ibge: '3304557' },
    { city: 'Belo Horizonte', state: 'MG', ibge: '3106200' },
    { city: 'Florianópolis', state: 'SC', ibge: '4205407' },
    { city: 'Porto Alegre', state: 'RS', ibge: '4314902' },
  ];
  return (
    <section className="page">
      <PageHeader title="Projetos" subtitle="Selecione uma obra para abrir o planejamento integrado.">
        <button onClick={onCalendar}><CalendarRange size={17} /> Calendário</button>
        <button className="primary">Novo projeto</button>
      </PageHeader>
      <div className="project-grid">
        {items.map((p) => (
          <article className={`project-card ${selected.id === p.id ? 'selected' : ''}`} key={p.id}>
            <img src={p.imageUrl} />
            <div>
              <span className="pill">{p.status}</span>
              <h2>{p.name}</h2>
              <p>{p.address}</p>
              <small>{p.area.toLocaleString('pt-BR')} m² · {p.startDate} até {p.plannedEndDate}</small>
              <button onClick={() => onSelect(p)}>Selecionar</button>
              <button onClick={() => setEditing({ ...p, city: p.city ?? p.address.split(' - ')[0], state: p.state ?? p.address.split(' - ')[1] })}>Editar projeto</button>
            </div>
          </article>
        ))}
      </div>
      <aside className={`calendar-drawer ${editing ? 'open' : ''}`}>
        <button className="drawer-close" onClick={() => setEditing(null)}>×</button>
        {editing && <form onSubmit={(event) => { event.preventDefault(); onUpdate({ ...editing, address: `${editing.city ?? ''} - ${editing.state ?? ''}` }); setEditing(null); }}>
          <h3>Editar projeto</h3>
          <label>Nome<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
          <label>Cidade<input list="project-cities" value={editing.city ?? ''} onChange={(e) => { const match = cityOptions.find((item) => item.city === e.target.value); setEditing({ ...editing, city: e.target.value, state: match?.state ?? editing.state, ibgeCode: match?.ibge ?? editing.ibgeCode }); }} /></label>
          <datalist id="project-cities">{cityOptions.map((item) => <option key={item.ibge} value={item.city}>{item.state}</option>)}</datalist>
          <label>UF<input maxLength={2} value={editing.state ?? ''} onChange={(e) => setEditing({ ...editing, state: e.target.value.toUpperCase() })} /></label>
          <label>Código IBGE<input value={editing.ibgeCode ?? ''} onChange={(e) => setEditing({ ...editing, ibgeCode: e.target.value })} /></label>
          <label>Área (m²)<input type="number" value={editing.area} onChange={(e) => setEditing({ ...editing, area: Number(e.target.value) })} /></label>
          <label>Início<input type="date" value={editing.startDate} onChange={(e) => setEditing({ ...editing, startDate: e.target.value })} /></label>
          <label>Término previsto<input type="date" value={editing.plannedEndDate} onChange={(e) => setEditing({ ...editing, plannedEndDate: e.target.value })} /></label>
          <button className="primary" type="submit">Salvar projeto</button>
        </form>}
      </aside>
    </section>
  );
}

function AnnualCalendar({ title, subtitle, events, onChange, projects: projectOptions, projectId }: { title: string; subtitle: string; events: CalendarEvent[]; onChange: (events: CalendarEvent[]) => void; projects: Project[]; projectId?: string }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState({ date: `${year}-01-01`, title: '', kind: 'holiday' as CalendarEvent['kind'], color: '#ef4444', appliesToAll: true, projectIds: [] as string[] });
  const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  function openDate(date?: string) {
    setDraft({ date: date ?? `${year}-01-01`, title: '', kind: 'holiday', color: '#ef4444', appliesToAll: true, projectIds: [] });
    setDrawerOpen(true);
  }
  function saveEvent(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return;
    onChange([...events, { id: crypto.randomUUID(), ...draft, projectId }]);
    setDrawerOpen(false);
  }

  return <section className="page calendar-page">
    <PageHeader title={title} subtitle={subtitle}>
      <button onClick={() => openDate()}>Cadastrar data</button>
    </PageHeader>
    <div className="calendar-year-nav">
      <button aria-label="Ano anterior" onClick={() => setYear(year - 1)}><ChevronLeft /></button>
      <h2>{year}</h2>
      <button aria-label="Próximo ano" onClick={() => setYear(year + 1)}><ChevronRight /></button>
    </div>
    <div className="year-calendar">
      {Array.from({ length: 12 }).map((_, month) => {
        const firstDay = new Date(year, month, 1).getDay();
        const days = new Date(year, month + 1, 0).getDate();
        return <article className="calendar-month" key={month}>
          <h3>{new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'long' })}</h3>
          <div className="calendar-weekdays">{weekdays.map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
          <div className="calendar-days">
            {Array.from({ length: firstDay }).map((_, index) => <span className="calendar-day empty" key={`empty-${index}`} />)}
            {Array.from({ length: days }).map((_, index) => {
              const day = index + 1;
              const date = toIsoDate(new Date(year, month, day));
              const dayEvents = events.filter((item) => item.date === date);
              const weekend = [0, 6].includes(new Date(year, month, day).getDay());
              return <button className={`calendar-day ${weekend ? 'weekend' : 'workday'}`} key={day} onClick={() => openDate(date)}>
                <b>{day}</b>
                {dayEvents.map((item) => {
                  const scope = item.projectId ? projectOptions.find((project) => project.id === item.projectId)?.name : item.appliesToAll ? 'Todas as obras' : projectOptions.filter((project) => item.projectIds?.includes(project.id)).map((project) => project.name).join(', ');
                  return <i key={item.id} title={`${item.title} · ${scope || 'Calendário geral'}`} style={{ background: item.color }} />;
                })}
              </button>;
            })}
          </div>
        </article>;
      })}
    </div>
    <aside className={`calendar-drawer ${drawerOpen ? 'open' : ''}`}>
      <button className="drawer-close" onClick={() => setDrawerOpen(false)}>×</button>
      <h3>Nova marcação</h3>
      <form onSubmit={saveEvent}>
        <label>Data<input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
        <label>Descrição<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Nome do feriado ou rotina" /></label>
        <label>Tipo<select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as CalendarEvent['kind'] })}><option value="holiday">Feriado</option><option value="routine">Rotina</option><option value="important">Data importante</option></select></label>
        <label>Cor<input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} /></label>
        {!projectId && <><label className="calendar-check"><input type="checkbox" checked={draft.appliesToAll} onChange={(e) => setDraft({ ...draft, appliesToAll: e.target.checked })} /> Aplicar a todas as obras</label>{!draft.appliesToAll && <fieldset><legend>Obras aplicáveis</legend>{projectOptions.map((project) => <label className="calendar-check" key={project.id}><input type="checkbox" checked={draft.projectIds.includes(project.id)} onChange={(e) => setDraft({ ...draft, projectIds: e.target.checked ? [...draft.projectIds, project.id] : draft.projectIds.filter((id) => id !== project.id) })} /> {project.name}</label>)}</fieldset>}</>}
        <button className="primary" type="submit">Salvar marcação</button>
      </form>
      <h4>Marcações deste calendário</h4>
      <div className="calendar-event-list">{events.filter((item) => item.date.startsWith(String(year))).map((item) => <div key={item.id}><i style={{ background: item.color }} /><span><b>{item.title}</b><small>{parseDate(item.date).toLocaleDateString('pt-BR')}</small></span><button onClick={() => onChange(events.filter((event) => event.id !== item.id))}>×</button></div>)}</div>
    </aside>
  </section>;
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
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function Schedule({ tasks }: { tasks: Task[] }) {
  async function readFile(file: File) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer);
    alert(`Arquivo lido: ${file.name}\nAbas detectadas: ${workbook.SheetNames.join(', ')}\nPróximo passo: mapear colunas para o schema.`);
  }

  return (
    <section className="page">
      <PageHeader title="Cronograma / Importação / Versões" subtitle="Importação, tabela e linha de base.">
        <label className="file-button">Importar XLSX/CSV<input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} /></label>
        <button>Criar cópia</button>
        <button>Linha de base</button>
      </PageHeader>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Lote-mãe</th><th>Lote</th><th>Pacote</th><th>Início</th><th>Fim</th><th>Avanço</th></tr></thead>
          <tbody>{tasks.map((t) => <tr key={t.id}><td>{t.lotMother}</td><td>{t.lot}</td><td>{t.packageName}</td><td>{t.startDate}</td><td>{t.endDate}</td><td>{t.progress}%</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function LineBalance({ tasks, setTasks, holidays }: { tasks: Task[]; setTasks: (tasks: Task[]) => void; holidays: CalendarEvent[] }) {
  const [zoom, setZoom] = useState(3);
  const [editMode, setEditMode] = useState(true);
  const [dependencyMode, setDependencyMode] = useState(true);
  const [showDeps, setShowDeps] = useState(true);
  const [snapWeek, setSnapWeek] = useState(false);
  const [dependencies, setDependencies] = useState<ScheduleDependency[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [monthFormat, setMonthFormat] = useState<'index' | 'numeric'>('numeric');
  const [weekFormat, setWeekFormat] = useState<'short' | 'numeric' | 'day'>('day');
  const [versions, setVersions] = useState<Array<{ id: string; name: string; createdAt: string; kind: 'scenario' | 'baseline' | 'planned'; tasks: Task[] }>>([
    { id: 'v00', name: 'Cronograma inicial · V00', createdAt: new Date().toISOString(), kind: 'scenario', tasks: initialTasks.map((task) => ({ ...task })) },
  ]);
  const [selectedVersionId, setSelectedVersionId] = useState('v00');
  const [groupLines, setGroupLines] = useState<Record<string, number>>({ 'TORRE-PAVIMENTOS': 3, FACHADA: 3 });
  const [familyLane, setFamilyLane] = useState<Record<string, number>>({ ESTRUTURA: 1, ALVENARIA: 1, INSTALAÇÕES: 2, REVESTIMENTO: 3, FACHADA: 2, ESQUADRIAS: 3 });
  const [drag, setDrag] = useState<null | { id: string; mode: 'pending' | 'move' | 'resize' | 'link'; startX: number; startY: number; start: string; end: string; target?: string }>(null);
  const [linkPoint, setLinkPoint] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const longPressRef = useRef<number | null>(null);

  const groups = Array.from(new Set(tasks.map((t) => t.lotMother)));
  const families = Array.from(new Set(tasks.map((t) => t.packageFamily)));

  const rows = useMemo(() => {
    const result: Array<{ type: 'group' | 'lot'; key: string; label: string; tasks: Task[]; height: number; group?: string }> = [];
    for (const g of groups) {
      result.push({ type: 'group', key: g, label: g, tasks: [], height: 30 });
      const lots = Array.from(new Set(tasks.filter((t) => t.lotMother === g).map((t) => t.lot)));
      for (const lot of lots) {
        result.push({ type: 'lot', key: `${g}-${lot}`, label: lot, tasks: tasks.filter((t) => t.lotMother === g && t.lot === lot), height: 12 + (groupLines[g] ?? 3) * 26, group: g });
      }
    }
    return result;
  }, [tasks, groupLines]);

  const width = Math.max(1300, diffDays(projectStart, chartEnd) * zoomPx[zoom] + 160);
  const height = 90 + rows.reduce((s, r) => s + r.height, 0) + 40;

  function xFor(d: Date) { return diffDays(projectStart, d) * zoomPx[zoom]; }
  function pointerX(event: React.PointerEvent) { return event.clientX - (svgRef.current?.getBoundingClientRect().left ?? 0); }
  function pointerY(event: React.PointerEvent) { return event.clientY - (svgRef.current?.getBoundingClientRect().top ?? 0); }
  function updateTask(id: string, patch: Partial<Task>) {
    const next = tasks.map((task) => task.id === id ? { ...task, ...patch } : { ...task });
    const propagate = (fromId: string, visited = new Set<string>()) => {
      if (visited.has(fromId)) return;
      visited.add(fromId);
      const predecessor = next.find((task) => task.id === fromId);
      if (!predecessor) return;
      dependencies.filter((dependency) => dependency.from === fromId).forEach((dependency) => {
        const successor = next.find((task) => task.id === dependency.to);
        if (!successor) return;
        const duration = diffDays(parseDate(successor.startDate), parseDate(successor.endDate));
        const requiredStart = addDays(parseDate(predecessor.endDate), 1);
        successor.startDate = toIsoDate(requiredStart);
        successor.endDate = toIsoDate(addDays(requiredStart, duration));
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
    setDrag({ id: task.id, mode, startX: pointerX(event), startY: pointerY(event), start: task.startDate, end: task.endDate });
    if (mode === 'pending' && dependencyMode) {
      clearLongPress();
      longPressRef.current = window.setTimeout(() => {
        setDrag((current) => current?.id === task.id && current.mode === 'pending' ? { ...current, mode: 'link' } : current);
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
      const target = document.elementsFromPoint(event.clientX, event.clientY)
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
      updateTask(task.id, { startDate: toIsoDate(newStart), endDate: toIsoDate(addDays(newStart, duration)) });
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
          const start = addDays(parseDate(predecessor.endDate), 1);
          setTasks(tasks.map((task) => task.id === successor.id ? { ...task, startDate: toIsoDate(start), endDate: toIsoDate(addDays(start, duration)) } : task));
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
    REVESTIMENTO: 'Preparação · Aplicação · Acabamento',
  };
  const selectedVersion = versions.find((version) => version.id === selectedVersionId);
  function saveVersion(kind: 'scenario' | 'baseline' | 'planned') {
    const labels = { scenario: 'Cenário', baseline: 'Linha de base', planned: 'Previsto' };
    const next = { id: crypto.randomUUID(), name: `${labels[kind]} · V${String(versions.length).padStart(2, '0')}`, createdAt: new Date().toISOString(), kind, tasks: tasks.map((task) => ({ ...task })) };
    setVersions([...versions, next]);
    setSelectedVersionId(next.id);
  }
  function openVersion() {
    if (selectedVersion) setTasks(selectedVersion.tasks.map((task) => ({ ...task })));
  }
  function changeVersionKind(kind: 'baseline' | 'planned') {
    if (!selectedVersion) return;
    setVersions(versions.map((version) => version.id === selectedVersion.id ? { ...version, kind } : version));
  }
  function deleteVersion() {
    if (!selectedVersion || versions.length === 1) return;
    const remaining = versions.filter((version) => version.id !== selectedVersion.id);
    setVersions(remaining);
    setSelectedVersionId(remaining[0].id);
  }
  return (
    <section className="page">
      <PageHeader title="Linha de balanço" subtitle="Visualização e edição do cronograma." />
      <div className="line-toolbar">
        <label><input type="checkbox" checked={editMode} onChange={(e) => setEditMode(e.target.checked)} /> modo edição</label>
        <label><input type="checkbox" checked={dependencyMode} onChange={(e) => setDependencyMode(e.target.checked)} /> dependências por arraste vertical</label>
        <label><input type="checkbox" checked={showDeps} onChange={(e) => setShowDeps(e.target.checked)} /> mostrar dependências</label>
        <label><input type="checkbox" checked={snapWeek} onChange={(e) => setSnapWeek(e.target.checked)} /> encaixar por semana</label>
      </div>
      {drag?.mode === 'link' && <div className="link-mode-banner show">Modo vínculo: arraste até a sucessora</div>}
      <div className="line-shell">
        <button className="chart-settings-button" title="Configurações do cronograma" onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedTask(null); setSettingsOpen(true); }}><Settings size={18} /></button>
        <aside className={`chart-drawer settings-drawer settings-panel ${settingsOpen ? 'open' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
          <div className="chart-drawer-head"><div><small>Linha de balanço</small><h3>Configurações</h3></div><button className="drawer-close" onClick={() => setSettingsOpen(false)}>×</button></div>
          <div className="chart-drawer-body">
          <label>Zoom<input type="range" min={1} max={7} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
          <h4>Linhas por lote-mãe</h4>
          {groups.map((g) => <label key={g}>{g}<select value={groupLines[g] ?? 3} onChange={(e) => setGroupLines({ ...groupLines, [g]: Number(e.target.value) })}><option value={1}>1 linha</option><option value={2}>2 linhas</option><option value={3}>3 linhas</option><option value={4}>4 linhas</option></select></label>)}
          <h4>Linha por família</h4>
          {families.map((f) => <label key={f}>{f}<select value={familyLane[f] ?? 1} onChange={(e) => setFamilyLane({ ...familyLane, [f]: Number(e.target.value) })}><option value={1}>Linha 1</option><option value={2}>Linha 2</option><option value={3}>Linha 3</option><option value={4}>Linha 4</option></select></label>)}
          <h4>Cabeçalho de datas</h4>
          <label>Nível superior<select value={monthFormat} onChange={(e) => setMonthFormat(e.target.value as 'index' | 'numeric')}><option value="index">M1, M2… desde o início</option><option value="numeric">MM/AA</option></select></label>
          <label>Segundo nível<select value={weekFormat} onChange={(e) => setWeekFormat(e.target.value as 'short' | 'numeric' | 'day')}><option value="short">DD/MMM</option><option value="numeric">DD/MM</option><option value="day">Somente DD</option></select></label>
          <div className="version-panel">
            <div className="version-panel-title"><div><small>Cronograma</small><h4>Histórico de versões</h4></div><button title="Criar cenário" onClick={() => saveVersion('scenario')}>＋</button></div>
            <label>Versão<select value={selectedVersionId} onChange={(e) => setSelectedVersionId(e.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}</select></label>
            {selectedVersion && <div className="version-card"><span className={`version-kind ${selectedVersion.kind}`}>{selectedVersion.kind === 'baseline' ? 'Linha de base' : selectedVersion.kind === 'planned' ? 'Previsto' : 'Simulação'}</span><strong>{selectedVersion.name}</strong><small>{new Date(selectedVersion.createdAt).toLocaleString('pt-BR')}</small></div>}
            <div className="version-actions"><button onClick={openVersion}>Abrir versão</button><button onClick={() => changeVersionKind('baseline')}>Salvar como linha de base</button><button onClick={() => changeVersionKind('planned')}>Salvar como previsto</button><button className="danger" disabled={versions.length === 1} onClick={deleteVersion}>Excluir</button></div>
          </div>
          </div>
        </aside>
        <div className="chart-scroll">
          <div className="lot-labels" style={{ height }}>
            <div className="lot-label-header">Lotes</div>
            {labelRows.map((row) => <div key={row.key} className={`lot-label ${row.type}`} style={{ top: row.top, height: row.height }}>{row.label}</div>)}
          </div>
          <svg ref={svgRef} width={width} height={height} onPointerDown={closeDrawersOnEmpty} onPointerMove={onMove} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            <rect x={0} y={0} width={width} height={90} fill="#fafafa" />
            {Array.from({ length: diffDays(projectStart, chartEnd) + 1 }).map((_, index) => {
              const date = addDays(projectStart, index);
              const iso = toIsoDate(date);
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const holiday = holidays.find((event) => event.date === iso);
              if (!isWeekend && !holiday) return null;
              return <rect key={`off-${iso}`} x={xFor(date)} y={0} width={zoomPx[zoom]} height={height} fill={holiday ? '#e2e8f0' : '#f1f5f9'}><title>{holiday?.title ?? 'Final de semana'}</title></rect>;
            })}
            {Array.from({ length: diffDays(projectStart, chartEnd) + 1 }).map((_, i) => {
              const date = addDays(projectStart, i);
              const x = xFor(date);
              return <g key={`day-${i}`}><line x1={x} x2={x} y1={66} y2={height} stroke={date.getDay() === 0 ? '#cbd5e1' : '#eef0f4'} /><text x={x + 2} y={84} fontSize={9} fill="#64748b">{dayNames[date.getDay()]}</text></g>;
            })}
            {Array.from({ length: 75 }).map((_, i) => {
              const d = addDays(projectStart, i * 7);
              const weekEnd = addDays(d, 6);
              const x = xFor(d);
              const format = (date: Date) => {
                if (weekFormat === 'day') return date.toLocaleDateString('pt-BR', { day: '2-digit' });
                return date.toLocaleDateString('pt-BR', weekFormat === 'numeric' ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: 'short' });
              };
              return <g key={i}><line x1={x} x2={x} y1={38} y2={height} stroke="#d9dde6" /><text x={x + 3} y={59} fontSize={10}>{format(d)}–{format(weekEnd)}</text></g>;
            })}
            {Array.from({ length: 18 }).map((_, i) => {
              const date = new Date(projectStart.getFullYear(), projectStart.getMonth() + i, 1);
              const label = monthFormat === 'index' ? `M${i + 1}` : date.toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' });
              return <g key={`month-${i}`}><line x1={xFor(date)} x2={xFor(date)} y1={0} y2={height} stroke="#aeb4c2" /><text x={xFor(date) + 4} y={24} fontSize={12} fontWeight={700}>{label}</text></g>;
            })}
            {['2025-09-01', '2026-01-12', '2026-06-10'].map((date, i) => {
              const x = xFor(parseDate(date));
              return <g key={date}><line x1={x} x2={x} y1={90} y2={height} stroke="#b91c1c" strokeDasharray="4 4" /><text x={x + 8} y={150} transform={`rotate(-90 ${x + 8} 150)`} fontSize={11} fill="#b91c1c">{['INÍCIO', 'ACAB.', 'ESQ.'][i]}</text></g>;
            })}
            {rows.map((row) => {
              const currentY = y;
              y += row.height;
              if (row.type === 'group') return <g key={row.key}><rect x={0} y={currentY} width={width} height={row.height} fill="#eef2ff" opacity=".65" /></g>;
              return <g key={row.key}><line x1={0} x2={width} y1={currentY + row.height} y2={currentY + row.height} stroke="#e5e7eb" />{row.tasks.map((t) => {
                const lane = familyLane[t.packageFamily] ?? 1;
                const x = xFor(parseDate(t.startDate));
                const barW = Math.max(10, (diffDays(parseDate(t.startDate), parseDate(t.endDate)) + 1) * zoomPx[zoom]);
                const barY = currentY + 8 + (lane - 1) * 26;
                taskLayout.set(t.id, { x, y: barY, width: barW, height: 18 });
                return <g key={t.id} data-task-id={t.id} onClick={() => setSelectedTask(t)}><title>{t.packageName} · {microservices[t.packageFamily] ?? 'Microserviços não cadastrados'}</title><rect className={`task-bar ${drag?.target === t.id ? 'target-highlight' : ''}`} x={x} y={barY} width={barW} height={18} rx={4} fill={t.color} onPointerDown={(e) => beginDrag(e, t, 'pending')} /><rect className="resize-handle" x={x + barW - 9} y={barY} width={9} height={18} fill="#fff" opacity={0.25} onPointerDown={(e) => beginDrag(e, t, 'resize')} /><text pointerEvents="none" x={x + 5} y={barY + 13} fontSize={10} fontWeight={700} fill="#fff">{t.packageName}</text><rect pointerEvents="none" x={x} y={barY + 14} width={barW * t.progress / 100} height={4} fill="#fff" opacity={0.55} /></g>;
              })}</g>;
            })}
            {showDeps && dependencies.map((dependency) => {
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
            {drag?.mode === 'link' && linkPoint && (() => {
              const from = taskLayout.get(drag.id);
              if (!from) return null;
              return <path className="dependency-preview" d={`M ${from.x + from.width} ${from.y + from.height / 2} C ${from.x + from.width + 40} ${from.y + from.height / 2}, ${linkPoint.x - 40} ${linkPoint.y}, ${linkPoint.x} ${linkPoint.y}`} />;
            })()}
          </svg>
        </div>
        <aside className={`chart-drawer task-drawer ${selectedTask ? 'open' : ''}`} onPointerDown={(event) => event.stopPropagation()}>
          {selectedTask && <><div className="chart-drawer-head"><div><small>{selectedTask.packageFamily}</small><h3>{selectedTask.packageName}</h3><span>{selectedTask.lot}</span></div><button className="drawer-close" onClick={() => setSelectedTask(null)}>×</button></div><div className="chart-drawer-body"><div className="task-progress"><span>Progresso da atividade</span><strong>{selectedTask.progress}%</strong><i><b style={{ width: `${selectedTask.progress}%`, background: selectedTask.color }} /></i></div><dl><dt>Lote-mãe</dt><dd>{selectedTask.lotMother}</dd><dt>Lote</dt><dd>{selectedTask.lot}</dd><dt>Início</dt><dd>{parseDate(selectedTask.startDate).toLocaleDateString('pt-BR')}</dd><dt>Fim</dt><dd>{parseDate(selectedTask.endDate).toLocaleDateString('pt-BR')}</dd><dt>Duração</dt><dd>{diffDays(parseDate(selectedTask.startDate), parseDate(selectedTask.endDate)) + 1} dias</dd><dt>Quantidade</dt><dd>{selectedTask.quantity ?? '—'} {selectedTask.unit ?? ''}</dd><dt>Custo</dt><dd>{selectedTask.cost?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) ?? '—'}</dd></dl><div className="drawer-section"><h4>Microserviços</h4><p>{microservices[selectedTask.packageFamily] ?? 'Não cadastrados'}</p></div><div className="drawer-section"><h4>Dependências FS</h4><div className="dep-list">{dependencies.filter((dependency) => dependency.from === selectedTask.id || dependency.to === selectedTask.id).map((dependency) => <div key={`${dependency.from}-${dependency.to}`}><span>{tasks.find((task) => task.id === dependency.from)?.packageName} → {tasks.find((task) => task.id === dependency.to)?.packageName}</span><button className="dep-remove" onClick={() => setDependencies(dependencies.filter((item) => item !== dependency))}>×</button></div>)}{!dependencies.some((dependency) => dependency.from === selectedTask.id || dependency.to === selectedTask.id) && 'Nenhuma dependência.'}</div></div></div></>}
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
      <div className="kanban">{stages.map((stage) => <div className="kanban-col" key={stage}><h3>{stage}</h3>{procurement.filter((p) => p.stage === stage).map((p) => <article className={`buy-card ${p.coverage < 100 ? 'warning' : 'ok'}`} key={p.id}><strong>{p.item}</strong><span>{p.code}</span><div className="bar"><i style={{ width: `${p.coverage}%` }} /></div><small>Cobertura {p.coverage}% · pedido {p.ordered}/{p.required} {p.unit}</small><b>{p.status}</b></article>)}</div>)}</div>
    </section>
  );
}

function MediumPlan() {
  const weeks = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'];
  return (
    <section className="page">
      <PageHeader title="Médio prazo" subtitle="Abertura de lotes, ponderação e matriz semanal." />
      <div className="card table-wrap"><table><thead><tr><th>Lote aberto</th><th>Peso</th>{weeks.map((w) => <th key={w}>{w}</th>)}</tr></thead><tbody>{['Balancim 1', 'Balancim 2', 'Balancim 3'].map((lot, i) => <tr key={lot}><td>FACHADA / Fachada A / {lot}</td><td>{[30, 40, 30][i]}%</td>{weeks.map((w, wi) => <td key={w}>{wi >= i && wi <= i + 3 ? <span className="tag">{['BAL', 'EMB', 'IMP', 'TEX'][wi - i]}</span> : null}</td>)}</tr>)}</tbody></table></div>
    </section>
  );
}

function ShortTerm() {
  const marking = 100 * 0.2;
  const wall = 50 * 0.8;
  return <section className="page"><PageHeader title="Curto prazo" subtitle="Microserviços ponderados e medição." /><div className="metric-grid"><Metric label="Marcação 20% x 100%" value="20%" /><Metric label="Elevação 80% x 50%" value="40%" /><Metric label="Pacote consolidado" value={`${marking + wall}%`} /></div></section>;
}

function Financial({ tasks }: { tasks: Task[] }) {
  const total = tasks.reduce((s, t) => s + (t.cost ?? 0), 0);
  const done = tasks.reduce((s, t) => s + (t.cost ?? 0) * t.progress / 100, 0);
  return <section className="page"><PageHeader title="Físico-financeiro" subtitle="Avanço físico x valor." /><div className="metric-grid"><Metric label="Valor vinculado demo" value={total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} /><Metric label="Valor realizado demo" value={done.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} /></div></section>;
}

function SettingsPage() {
  return <section className="page"><PageHeader title="Configurações" subtitle="Parâmetros do sistema." /><div className="card"><p>Supabase: <strong>{isSupabaseConfigured ? 'configurado' : 'não configurado / modo demo'}</strong></p><p>Próximas configurações: data zero, calendário, feriados, famílias de pacote, tolerância de compras e templates de microserviços.</p></div></section>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
