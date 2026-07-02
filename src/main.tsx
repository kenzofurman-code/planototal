import React, { useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import * as XLSX from 'xlsx';
import {
  BarChart3,
  Building2,
  CalendarRange,
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
import type { Page, Project, ScheduleDependency, Task } from './types';
import './styles.css';

const pages: Array<{ key: Page; label: string; icon: React.ReactNode }> = [
  { key: 'projects', label: 'Projetos', icon: <Home /> },
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
const zoomPx: Record<number, number> = { 1: 2.2, 2: 3.2, 3: 4.8, 4: 7.2, 5: 10.5 };

function App() {
  const [collapsed, setCollapsed] = useState(true);
  const [page, setPage] = useState<Page>('projects');
  const [project, setProject] = useState<Project>(projects[0]);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);

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

        {page === 'projects' && <Projects selected={project} onSelect={(p) => { setProject(p); setPage('dashboard'); }} />}
        {page === 'dashboard' && <Dashboard tasks={tasks} />}
        {page === 'schedule' && <Schedule tasks={tasks} />}
        {page === 'line' && <LineBalance tasks={tasks} setTasks={setTasks} />}
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

function Projects({ selected, onSelect }: { selected: Project; onSelect: (p: Project) => void }) {
  return (
    <section className="page">
      <PageHeader title="Projetos" subtitle="Selecione uma obra para abrir o planejamento integrado.">
        <button className="primary">Novo projeto</button>
      </PageHeader>
      <div className="project-grid">
        {projects.map((p) => (
          <article className={`project-card ${selected.id === p.id ? 'selected' : ''}`} key={p.id}>
            <img src={p.imageUrl} />
            <div>
              <span className="pill">{p.status}</span>
              <h2>{p.name}</h2>
              <p>{p.address}</p>
              <small>{p.area.toLocaleString('pt-BR')} m² · {p.startDate} até {p.plannedEndDate}</small>
              <button onClick={() => onSelect(p)}>Selecionar</button>
            </div>
          </article>
        ))}
      </div>
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

function LineBalance({ tasks, setTasks }: { tasks: Task[]; setTasks: (tasks: Task[]) => void }) {
  const [zoom, setZoom] = useState(3);
  const [editMode, setEditMode] = useState(true);
  const [dependencyMode, setDependencyMode] = useState(true);
  const [showDeps, setShowDeps] = useState(true);
  const [snapWeek, setSnapWeek] = useState(false);
  const [dependencies, setDependencies] = useState<ScheduleDependency[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dateFormat, setDateFormat] = useState<'numeric' | 'short'>('numeric');
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
        <button className="chart-settings-button" title="Configurações do cronograma" onClick={() => setSettingsOpen(true)}><Settings size={18} /></button>
        <aside className={`chart-drawer settings-drawer ${settingsOpen ? 'open' : ''}`}>
          <button className="drawer-close" onClick={() => setSettingsOpen(false)}>×</button>
          <h3>Configurações</h3>
          <label>Zoom<input type="range" min={1} max={5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
          <h4>Linhas por lote-mãe</h4>
          {groups.map((g) => <label key={g}>{g}<select value={groupLines[g] ?? 3} onChange={(e) => setGroupLines({ ...groupLines, [g]: Number(e.target.value) })}><option value={1}>1 linha</option><option value={2}>2 linhas</option><option value={3}>3 linhas</option><option value={4}>4 linhas</option></select></label>)}
          <h4>Linha por família</h4>
          {families.map((f) => <label key={f}>{f}<select value={familyLane[f] ?? 1} onChange={(e) => setFamilyLane({ ...familyLane, [f]: Number(e.target.value) })}><option value={1}>Linha 1</option><option value={2}>Linha 2</option><option value={3}>Linha 3</option><option value={4}>Linha 4</option></select></label>)}
          <h4>Cabeçalho de datas</h4>
          <label>Formato<select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as 'numeric' | 'short')}><option value="numeric">DD/MM</option><option value="short">DD MMM</option></select></label>
          <h4>Dependências criadas</h4>
          <div className="dep-list">{dependencies.length ? dependencies.map((d) => <div key={`${d.from}-${d.to}`}>{tasks.find((t) => t.id === d.from)?.packageName} → {tasks.find((t) => t.id === d.to)?.packageName} ({d.type}) <button className="dep-remove" onClick={() => setDependencies(dependencies.filter((item) => item !== d))}>×</button></div>) : 'Nenhuma dependência.'}</div>
        </aside>
        <div className="chart-scroll">
          <div className="lot-labels" style={{ height }}>
            <div className="lot-label-header">Lotes</div>
            {labelRows.map((row) => <div key={row.key} className={`lot-label ${row.type}`} style={{ top: row.top, height: row.height }}>{row.label}</div>)}
          </div>
          <svg ref={svgRef} width={width} height={height} onPointerMove={onMove} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
            <rect x={0} y={0} width={width} height={90} fill="#fafafa" />
            {Array.from({ length: diffDays(projectStart, chartEnd) + 1 }).map((_, i) => {
              const date = addDays(projectStart, i);
              const x = xFor(date);
              return <g key={`day-${i}`}><line x1={x} x2={x} y1={66} y2={height} stroke={date.getDay() === 0 ? '#cbd5e1' : '#eef0f4'} /><text x={x + 2} y={84} fontSize={9} fill="#64748b">{dayNames[date.getDay()]}</text></g>;
            })}
            {Array.from({ length: 75 }).map((_, i) => {
              const d = addDays(projectStart, i * 7);
              const weekEnd = addDays(d, 6);
              const x = xFor(d);
              const format = (date: Date) => date.toLocaleDateString('pt-BR', dateFormat === 'numeric' ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: 'short' });
              return <g key={i}><line x1={x} x2={x} y1={38} y2={height} stroke="#d9dde6" /><text x={x + 3} y={59} fontSize={10}>{format(d)}–{format(weekEnd)}</text></g>;
            })}
            {Array.from({ length: 18 }).map((_, i) => {
              const date = new Date(projectStart.getFullYear(), projectStart.getMonth() + i, 1);
              return <g key={`month-${i}`}><line x1={xFor(date)} x2={xFor(date)} y1={0} y2={height} stroke="#aeb4c2" /><text x={xFor(date) + 4} y={24} fontSize={12} fontWeight={700}>{date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</text></g>;
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
        <aside className={`chart-drawer task-drawer ${selectedTask ? 'open' : ''}`}>
          <button className="drawer-close" onClick={() => setSelectedTask(null)}>×</button>
          {selectedTask && <><h3>{selectedTask.packageName}</h3><dl><dt>Lote-mãe</dt><dd>{selectedTask.lotMother}</dd><dt>Lote</dt><dd>{selectedTask.lot}</dd><dt>Família</dt><dd>{selectedTask.packageFamily}</dd><dt>Início</dt><dd>{selectedTask.startDate}</dd><dt>Fim</dt><dd>{selectedTask.endDate}</dd><dt>Duração</dt><dd>{diffDays(parseDate(selectedTask.startDate), parseDate(selectedTask.endDate)) + 1} dias</dd><dt>Progresso</dt><dd>{selectedTask.progress}%</dd><dt>Quantidade</dt><dd>{selectedTask.quantity ?? '—'} {selectedTask.unit ?? ''}</dd><dt>Custo</dt><dd>{selectedTask.cost?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) ?? '—'}</dd><dt>Microserviços</dt><dd>{microservices[selectedTask.packageFamily] ?? 'Não cadastrados'}</dd></dl></>}
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
