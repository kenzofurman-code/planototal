import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  BarChart3, 
  Building2, 
  Calendar, 
  CheckSquare, 
  Download, 
  Filter, 
  Layers, 
  PieChart, 
  RefreshCw, 
  SlidersHorizontal 
} from 'lucide-react';
import type { Task } from '../types';
import { loadBudgets, type BudgetRevision, type BudgetItem, type BudgetAllocation } from '../lib/budgetRepository';
import { loadShortTermState, type ShortTermWeeklyItem } from '../lib/shortTermRepository';

interface ChronoFinancialProps {
  projectKey: string;
  tasks: Task[];
}

type EapSource = 'budget' | 'schedule';
type ViewUnit = 'currency' | 'percent';
type AccumulationMode = 'monthly' | 'accumulated';

interface MonthCol {
  key: string;       // YYYY-MM
  label: string;     // MMM/YY
  year: number;
  month: number;     // 0-11
  startDate: Date;
  endDate: Date;
}

interface EapRowData {
  id: string;
  code: string;
  description: string;
  level: number; // 1, 2, 3, 4
  startDate: string;
  endDate: string;
  totalValue: number;
  // Valores brutos mensais (não acumulados) em R$
  baseMonthly: Record<string, number>;
  plannedMonthly: Record<string, number>;
  actualMonthly: Record<string, number>;
}

const parseDateLocal = (str: string | undefined): Date => {
  if (!str) return new Date();
  const [yyyy, mm, dd] = str.slice(0, 10).split('-');
  if (!yyyy || !mm || !dd) return new Date(str);
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0);
};

const formatDateBR = (str: string | undefined): string => {
  if (!str) return '-';
  const [yyyy, mm, dd] = str.slice(0, 10).split('-');
  if (!yyyy || !mm || !dd) return str;
  return `${dd}/${mm}/${yyyy}`;
};

const formatCurrency = (val: number): string => {
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

const formatPercent = (val: number): string => {
  return `${val.toFixed(2)}%`;
};

export function ChronoFinancial({ projectKey, tasks }: ChronoFinancialProps) {
  // --- ESTADOS DE DADOS ---
  const [loading, setLoading] = useState<boolean>(true);
  const [budgets, setBudgets] = useState<BudgetRevision[]>([]);
  const [shortTermWeekly, setShortTermWeekly] = useState<ShortTermWeeklyItem[]>([]);

  // --- CONTROLES DA TELA ---
  const [eapSource, setEapSource] = useState<EapSource>('budget');
  const [selectedLevel, setSelectedLevel] = useState<string>('all'); // 'all', '1', '2', '3', '4'
  const [viewUnit, setViewUnit] = useState<ViewUnit>('currency');
  const [accumulationMode, setAccumulationMode] = useState<AccumulationMode>('monthly');

  // Checkboxes de camadas
  const [showBase, setShowBase] = useState<boolean>(true);
  const [showPlanned, setShowPlanned] = useState<boolean>(true);
  const [showActual, setShowActual] = useState<boolean>(true);

  // Busca textual na EAP
  const [searchFilter, setSearchFilter] = useState<string>('');

  // --- CARREGAMENTO INICIAL DO SUPABASE ---
  const loadData = async () => {
    setLoading(true);
    try {
      const [budgetData, shortTermData] = await Promise.all([
        loadBudgets(projectKey).catch(() => []),
        loadShortTermState(projectKey).catch(() => null)
      ]);
      setBudgets(budgetData);
      setShortTermWeekly(shortTermData?.weekly ?? []);
    } catch (err) {
      console.error('Erro ao carregar dados do cronograma físico-financeiro:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [projectKey]);

  // Orçamento ativo da construtora
  const activeBudget = useMemo(() => {
    return budgets.find(b => b.type === 'contractor') || budgets[0] || null;
  }, [budgets]);

  // Mapa de progresso do curto prazo por ID da tarefa original
  const shortTermProgressMap = useMemo(() => {
    const map = new Map<string, number>();
    shortTermWeekly.forEach(item => {
      if (!item.activityId) return;
      const rootId = item.activityId.split('_')[0];
      const prog = (item.executedBefore ?? 0) + (item.progressThisWeek ?? 0);
      const prev = map.get(rootId) || 0;
      if (prog > prev) map.get(rootId);
      map.set(rootId, Math.max(prev, Math.min(100, prog)));
    });
    return map;
  }, [shortTermWeekly]);

  // --- CÁLCULO DA GRADE DE MESES DA OBRA ---
  const monthCols = useMemo<MonthCol[]>(() => {
    let minD = new Date();
    let maxD = new Date();

    if (tasks.length > 0) {
      const startDates = tasks.map(t => parseDateLocal(t.startDate).getTime()).filter(t => !isNaN(t));
      const endDates = tasks.map(t => parseDateLocal(t.endDate).getTime()).filter(t => !isNaN(t));
      if (startDates.length) minD = new Date(Math.min(...startDates));
      if (endDates.length) maxD = new Date(Math.max(...endDates));
    }

    // Normaliza para o dia 1 do mês inicial e último dia do mês final
    const startYear = minD.getFullYear();
    const startMonth = minD.getMonth();
    const endYear = maxD.getFullYear();
    const endMonth = maxD.getMonth();

    const cols: MonthCol[] = [];
    const cur = new Date(startYear, startMonth, 1);
    const endLimit = new Date(endYear, endMonth + 1, 0);

    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    while (cur <= endLimit) {
      const y = cur.getFullYear();
      const m = cur.getMonth();
      const key = `${y}-${String(m + 1).padStart(2, '0')}`;
      const label = `${monthNames[m]}/${String(y).slice(2)}`;
      const sDate = new Date(y, m, 1);
      const eDate = new Date(y, m + 1, 0, 23, 59, 59);

      cols.push({
        key,
        label,
        year: y,
        month: m,
        startDate: sDate,
        endDate: eDate
      });

      cur.setMonth(cur.getMonth() + 1);
    }

    return cols;
  }, [tasks]);

  // --- MONTAGEM DAS LINHAS DA EAP ---
  const rawEapRows = useMemo<EapRowData[]>(() => {
    if (monthCols.length === 0) return [];

    if (eapSource === 'budget' && activeBudget && activeBudget.items.length > 0) {
      // --- MODO EAP DE ORÇAMENTO ---
      const items = activeBudget.items;
      const allocations = activeBudget.allocations;
      const tasksMap = new Map(tasks.map(t => [t.id, t]));

      return items.map(item => {
        // Encontra alocações deste item do orçamento
        const itemAllocations = allocations.filter(a => a.budgetId === item.id);
        
        let startMs = Infinity;
        let endMs = -Infinity;
        
        const baseMonthly: Record<string, number> = {};
        const plannedMonthly: Record<string, number> = {};
        const actualMonthly: Record<string, number> = {};

        monthCols.forEach(col => {
          baseMonthly[col.key] = 0;
          plannedMonthly[col.key] = 0;
          actualMonthly[col.key] = 0;
        });

        const totalValue = item.total || 0;

        if (itemAllocations.length > 0) {
          // Item possui vínculos com tarefas do cronograma
          itemAllocations.forEach(alloc => {
            const task = tasksMap.get(alloc.taskId);
            const taskVal = alloc.value || 0;
            if (!task) return;

            const tStart = parseDateLocal(task.startDate);
            const tEnd = parseDateLocal(task.endDate);

            if (tStart.getTime() < startMs) startMs = tStart.getTime();
            if (tEnd.getTime() > endMs) endMs = tEnd.getTime();

            // Progresso real da tarefa (Mestre ou Curto Prazo)
            const stProgress = shortTermProgressMap.get(task.id);
            const realProgress = stProgress !== undefined ? stProgress : (task.progress || 0);

            // Distribuição temporal da tarefa nos meses
            const totalTaskDays = Math.max(1, Math.ceil((tEnd.getTime() - tStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);

            monthCols.forEach(col => {
              // Calcula sobreposição de dias da tarefa neste mês
              const overlapStart = Math.max(tStart.getTime(), col.startDate.getTime());
              const overlapEnd = Math.min(tEnd.getTime(), col.endDate.getTime());

              if (overlapStart <= overlapEnd) {
                const daysInMonth = Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
                const ratio = Math.min(1, daysInMonth / totalTaskDays);

                baseMonthly[col.key] += taskVal * ratio;
                plannedMonthly[col.key] += taskVal * ratio;

                // Realizado proporcional ao progresso da tarefa
                actualMonthly[col.key] += (taskVal * ratio) * (realProgress / 100);
              }
            });
          });
        } else {
          // Item livre do orçamento (sem vínculos diretos) -> distribui uniformemente do início ao fim da obra
          const firstCol = monthCols[0];
          const lastCol = monthCols[monthCols.length - 1];
          startMs = firstCol.startDate.getTime();
          endMs = lastCol.endDate.getTime();

          const monthlyShare = totalValue / monthCols.length;
          monthCols.forEach(col => {
            baseMonthly[col.key] = monthlyShare;
            plannedMonthly[col.key] = monthlyShare;
            actualMonthly[col.key] = 0; // Sem progresso realizado medido
          });
        }

        const sDateStr = startMs !== Infinity ? new Date(startMs).toISOString().slice(0, 10) : monthCols[0].startDate.toISOString().slice(0, 10);
        const eDateStr = endMs !== -Infinity ? new Date(endMs).toISOString().slice(0, 10) : monthCols[monthCols.length - 1].endDate.toISOString().slice(0, 10);

        // Nível EAP (ex: "01" -> 1, "01.01" -> 2, "01.01.01" -> 3)
        const codeParts = item.code ? item.code.split('.').filter(Boolean) : [];
        const levelNum = item.level ? Number(item.level) : Math.max(1, codeParts.length);

        return {
          id: item.id,
          code: item.code || '-',
          description: item.description,
          level: levelNum,
          startDate: sDateStr,
          endDate: eDateStr,
          totalValue,
          baseMonthly,
          plannedMonthly,
          actualMonthly
        };
      });

    } else {
      // --- MODO EAP DE PLANEJAMENTO (CRONOGRAMA) ---
      return tasks.map(task => {
        const tStart = parseDateLocal(task.startDate);
        const tEnd = parseDateLocal(task.endDate);

        const totalValue = task.cost || 0;
        const stProgress = shortTermProgressMap.get(task.id);
        const realProgress = stProgress !== undefined ? stProgress : (task.progress || 0);

        const baseMonthly: Record<string, number> = {};
        const plannedMonthly: Record<string, number> = {};
        const actualMonthly: Record<string, number> = {};

        monthCols.forEach(col => {
          baseMonthly[col.key] = 0;
          plannedMonthly[col.key] = 0;
          actualMonthly[col.key] = 0;
        });

        const totalTaskDays = Math.max(1, Math.ceil((tEnd.getTime() - tStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);

        monthCols.forEach(col => {
          const overlapStart = Math.max(tStart.getTime(), col.startDate.getTime());
          const overlapEnd = Math.min(tEnd.getTime(), col.endDate.getTime());

          if (overlapStart <= overlapEnd) {
            const daysInMonth = Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
            const ratio = Math.min(1, daysInMonth / totalTaskDays);

            baseMonthly[col.key] = totalValue * ratio;
            plannedMonthly[col.key] = totalValue * ratio;
            actualMonthly[col.key] = (totalValue * ratio) * (realProgress / 100);
          }
        });

        const codeStr = `${task.lotMother} › ${task.lot}`;

        return {
          id: task.id,
          code: codeStr,
          description: `${task.packageName} - ${task.service || task.packageName}`,
          level: 3,
          startDate: task.startDate,
          endDate: task.endDate,
          totalValue,
          baseMonthly,
          plannedMonthly,
          actualMonthly
        };
      });
    }
  }, [eapSource, activeBudget, tasks, monthCols, shortTermProgressMap]);

  // --- FILTRAGEM DE NÍVEL E BUSCA ---
  const filteredEapRows = useMemo(() => {
    let rows = [...rawEapRows];

    // Filtro por Nível de EAP
    if (selectedLevel !== 'all') {
      const lvl = Number(selectedLevel);
      rows = rows.filter(r => r.level === lvl);
    }

    // Busca por texto
    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase().trim();
      rows = rows.filter(r => 
        r.code.toLowerCase().includes(q) || 
        r.description.toLowerCase().includes(q)
      );
    }

    return rows;
  }, [rawEapRows, selectedLevel, searchFilter]);

  // --- VALOR TOTAL GERAL DO PROJETO DA EAP SELECIONADA ---
  const grandTotalValue = useMemo(() => {
    return filteredEapRows.reduce((sum, r) => sum + r.totalValue, 0);
  }, [filteredEapRows]);

  // --- CÁLCULO DE VALORES MENSIAIS & ACUMULADOS CONSOLIDADOS ---
  // Transforma cada linha de EAP para os valores acumulados ou mensais conforme filtro
  const displayEapRows = useMemo(() => {
    return filteredEapRows.map(row => {
      const baseDisp: Record<string, number> = {};
      const plannedDisp: Record<string, number> = {};
      const actualDisp: Record<string, number> = {};

      let accBase = 0;
      let accPlanned = 0;
      let accActual = 0;

      monthCols.forEach(col => {
        const b = row.baseMonthly[col.key] || 0;
        const p = row.plannedMonthly[col.key] || 0;
        const a = row.actualMonthly[col.key] || 0;

        accBase += b;
        accPlanned += p;
        accActual += a;

        if (accumulationMode === 'accumulated') {
          baseDisp[col.key] = accBase;
          plannedDisp[col.key] = accPlanned;
          actualDisp[col.key] = accActual;
        } else {
          baseDisp[col.key] = b;
          plannedDisp[col.key] = p;
          actualDisp[col.key] = a;
        }
      });

      return {
        ...row,
        baseDisp,
        plannedDisp,
        actualDisp
      };
    });
  }, [filteredEapRows, monthCols, accumulationMode]);

  // --- TOTALIZADORES DO RODAPÉ (POR MÊS) ---
  const grandTotalsByMonth = useMemo(() => {
    const baseTotal: Record<string, number> = {};
    const plannedTotal: Record<string, number> = {};
    const actualTotal: Record<string, number> = {};

    monthCols.forEach(col => {
      baseTotal[col.key] = 0;
      plannedTotal[col.key] = 0;
      actualTotal[col.key] = 0;
    });

    displayEapRows.forEach(row => {
      monthCols.forEach(col => {
        baseTotal[col.key] += row.baseDisp[col.key] || 0;
        plannedTotal[col.key] += row.plannedDisp[col.key] || 0;
        actualTotal[col.key] += row.actualDisp[col.key] || 0;
      });
    });

    return { baseTotal, plannedTotal, actualTotal };
  }, [displayEapRows, monthCols]);

  // --- EXPORTAÇÃO PARA EXCEL ---
  const handleExportExcel = () => {
    if (displayEapRows.length === 0) return;

    const headers = ['Código EAP', 'Atividade / Descrição', 'Início', 'Término', 'Valor Total (R$)'];
    monthCols.forEach(col => {
      if (showBase) headers.push(`${col.label} (Base)`);
      if (showPlanned) headers.push(`${col.label} (Previsto)`);
      if (showActual) headers.push(`${col.label} (Realizado)`);
    });

    const exportRows: any[][] = [headers];

    displayEapRows.forEach(row => {
      const line: any[] = [
        row.code,
        row.description,
        formatDateBR(row.startDate),
        formatDateBR(row.endDate),
        row.totalValue
      ];

      monthCols.forEach(col => {
        if (showBase) {
          const val = row.baseDisp[col.key] || 0;
          line.push(viewUnit === 'percent' ? (grandTotalValue > 0 ? (val / grandTotalValue) * 100 : 0) : val);
        }
        if (showPlanned) {
          const val = row.plannedDisp[col.key] || 0;
          line.push(viewUnit === 'percent' ? (grandTotalValue > 0 ? (val / grandTotalValue) * 100 : 0) : val);
        }
        if (showActual) {
          const val = row.actualDisp[col.key] || 0;
          line.push(viewUnit === 'percent' ? (grandTotalValue > 0 ? (val / grandTotalValue) * 100 : 0) : val);
        }
      });

      exportRows.push(line);
    });

    const ws = XLSX.utils.aoa_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Físico-Financeiro');
    XLSX.writeFile(wb, `Cronograma_Fisico_Financeiro_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Helper de renderização do valor de cada célula (R$ ou %)
  const renderCellValue = (val: number) => {
    if (viewUnit === 'percent') {
      const pct = grandTotalValue > 0 ? (val / grandTotalValue) * 100 : 0;
      return formatPercent(pct);
    }
    return formatCurrency(val);
  };

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      {/* CABEÇALHO DO MÓDULO */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 font-black text-[9px] uppercase rounded-lg tracking-wider">
              Planejamento Financeiro
            </span>
            {loading && <span className="text-xs text-slate-400 font-bold animate-pulse">Sincronizando...</span>}
          </div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight mt-1">
            Cronograma Físico-Financeiro
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Análise temporal da evolução física e financeira por EAP com integração em tempo real.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadData()}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition cursor-pointer"
            title="Atualizar dados"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={handleExportExcel}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-xs transition flex items-center gap-2 cursor-pointer active:scale-95"
          >
            <Download size={15} /> Exportar Excel
          </button>
        </div>
      </div>

      {/* PAINEL DE FILTROS E OPÇÕES DE VISUALIZAÇÃO */}
      <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <SlidersHorizontal size={16} className="text-indigo-600" />
          <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider">
            Controles e Parâmetros de Exibição
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {/* 1. Escolha de EAP */}
          <div>
            <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">1. Estrutura EAP</label>
            <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-bold">
              <button
                onClick={() => setEapSource('budget')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  eapSource === 'budget' ? 'bg-white text-indigo-700 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Orçamento
              </button>
              <button
                onClick={() => setEapSource('schedule')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  eapSource === 'schedule' ? 'bg-white text-indigo-700 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Planejamento
              </button>
            </div>
          </div>

          {/* 2. Nível da EAP */}
          <div>
            <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">2. Nível da EAP</label>
            <select
              value={selectedLevel}
              onChange={e => setSelectedLevel(e.target.value)}
              className="w-full p-2 border border-slate-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-slate-800 outline-none"
            >
              <option value="all">Todos os Níveis</option>
              <option value="1">Nível 1 (Macro / Totalizadores)</option>
              <option value="2">Nível 2 (Grupos / Subgrupos)</option>
              <option value="3">Nível 3 (Pacotes / Etapas)</option>
              <option value="4">Nível 4 (Serviços Detalhados)</option>
            </select>
          </div>

          {/* 3. Unidade (% ou R$) */}
          <div>
            <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">3. Exibir em</label>
            <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-bold">
              <button
                onClick={() => setViewUnit('currency')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  viewUnit === 'currency' ? 'bg-white text-indigo-700 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                R$ (Valores)
              </button>
              <button
                onClick={() => setViewUnit('percent')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  viewUnit === 'percent' ? 'bg-white text-indigo-700 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                % (Porcentagem)
              </button>
            </div>
          </div>

          {/* 4. Modo de Acúmulo */}
          <div>
            <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">4. Visão Temporal</label>
            <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-bold">
              <button
                onClick={() => setAccumulationMode('monthly')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  accumulationMode === 'monthly' ? 'bg-white text-indigo-700 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Mensal
              </button>
              <button
                onClick={() => setAccumulationMode('accumulated')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  accumulationMode === 'accumulated' ? 'bg-white text-indigo-700 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Acumulado
              </button>
            </div>
          </div>

          {/* 5. Pesquisa Textual */}
          <div>
            <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">5. Filtrar EAP</label>
            <input
              type="text"
              placeholder="Pesquisar código ou descrição..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="w-full p-2 border border-slate-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-slate-800 outline-none"
            />
          </div>
        </div>

        {/* CHECKBOXES DE CAMADAS VISUAIS (Base, Previsto, Realizado) */}
        <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-slate-100 text-xs font-black uppercase">
          <span className="text-[10px] text-slate-400 tracking-wider">Camadas Visíveis:</span>

          <label className="flex items-center gap-2 cursor-pointer select-none text-slate-700">
            <input
              type="checkbox"
              checked={showBase}
              onChange={e => setShowBase(e.target.checked)}
              className="w-4 h-4 rounded text-slate-600 focus:ring-slate-500 cursor-pointer"
            />
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-500 inline-block" />
              Base (Baseline)
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none text-indigo-700">
            <input
              type="checkbox"
              checked={showPlanned}
              onChange={e => setShowPlanned(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 inline-block" />
              Previsto (Cronograma)
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer select-none text-emerald-700">
            <input
              type="checkbox"
              checked={showActual}
              onChange={e => setShowActual(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
              Realizado (Medições)
            </span>
          </label>
        </div>
      </div>

      {/* GRADE DA TABELA DE CRONOGRAMA FÍSICO-FINANCEIRO */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 bg-slate-900 text-white flex justify-between items-center text-xs font-black uppercase tracking-wider">
          <div className="flex items-center gap-2">
            <Calendar size={16} className="text-indigo-400" />
            <span>
              Matriz Físico-Financeira ({eapSource === 'budget' ? 'EAP Orçamento' : 'EAP Planejamento'}) - {monthCols.length} Meses
            </span>
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            Total do Projeto: {formatCurrency(grandTotalValue)}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-800 text-white uppercase text-[9px] tracking-wider sticky top-0 z-10">
              <tr>
                <th className="p-3 w-32 border-r border-slate-700 font-black">Código EAP</th>
                <th className="p-3 min-w-[220px] border-r border-slate-700 font-black">Atividade / Descrição</th>
                <th className="p-3 w-24 text-center border-r border-slate-700 font-black">Início</th>
                <th className="p-3 w-24 text-center border-r border-slate-700 font-black">Término</th>
                <th className="p-3 w-32 text-right border-r border-slate-700 font-black bg-slate-850">Valor Total</th>

                {/* Colunas mensais dinâmicas */}
                {monthCols.map(col => (
                  <th key={col.key} className="p-3 text-center border-r border-slate-700 min-w-[130px] font-black">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
              {displayEapRows.map((row, idx) => (
                <tr key={row.id || idx} className="hover:bg-slate-50 transition">
                  <td className="p-3 border-r border-slate-200 font-mono font-bold text-slate-700">
                    {row.code}
                  </td>
                  <td className="p-3 border-r border-slate-200 font-bold uppercase text-[11px] leading-tight">
                    {row.description}
                  </td>
                  <td className="p-3 border-r border-slate-200 text-center font-mono text-[10px]">
                    {formatDateBR(row.startDate)}
                  </td>
                  <td className="p-3 border-r border-slate-200 text-center font-mono text-[10px]">
                    {formatDateBR(row.endDate)}
                  </td>
                  <td className="p-3 border-r border-slate-200 text-right font-black text-slate-900 bg-slate-50/50">
                    {formatCurrency(row.totalValue)}
                  </td>

                  {/* Colunas por mês */}
                  {monthCols.map(col => {
                    const bVal = row.baseDisp[col.key] || 0;
                    const pVal = row.plannedDisp[col.key] || 0;
                    const aVal = row.actualDisp[col.key] || 0;

                    return (
                      <td key={col.key} className="p-2 border-r border-slate-200 align-top text-right text-[10px] space-y-1 font-mono">
                        {showBase && (
                          <div className="flex justify-between items-center text-slate-500 font-semibold border-b border-slate-100 pb-0.5" title="Base">
                            <span className="text-[8px] font-black text-slate-400 uppercase">B:</span>
                            <span>{renderCellValue(bVal)}</span>
                          </div>
                        )}
                        {showPlanned && (
                          <div className="flex justify-between items-center text-indigo-700 font-bold border-b border-indigo-50 pb-0.5" title="Previsto">
                            <span className="text-[8px] font-black text-indigo-500 uppercase">P:</span>
                            <span>{renderCellValue(pVal)}</span>
                          </div>
                        )}
                        {showActual && (
                          <div className="flex justify-between items-center text-emerald-700 font-black" title="Realizado">
                            <span className="text-[8px] font-black text-emerald-600 uppercase">R:</span>
                            <span>{renderCellValue(aVal)}</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {displayEapRows.length === 0 && (
                <tr>
                  <td colSpan={5 + monthCols.length} className="p-8 text-center text-slate-400 italic font-bold">
                    Nenhum item de EAP encontrado com os filtros selecionados.
                  </td>
                </tr>
              )}
            </tbody>

            {/* RODAPÉ DE TOTALIZAÇÃO GERAL */}
            <tfoot className="bg-slate-900 text-white uppercase font-black text-[10px] border-t-2 border-slate-700">
              <tr>
                <td colSpan={4} className="p-3 text-right tracking-wider">
                  TOTALIZADOR DO PROJETO ({accumulationMode === 'accumulated' ? 'ACUMULADO' : 'MENSAL'}):
                </td>
                <td className="p-3 text-right bg-slate-950 text-emerald-400 font-black text-xs font-mono">
                  {formatCurrency(grandTotalValue)}
                </td>

                {monthCols.map(col => {
                  const bTot = grandTotalsByMonth.baseTotal[col.key] || 0;
                  const pTot = grandTotalsByMonth.plannedTotal[col.key] || 0;
                  const aTot = grandTotalsByMonth.actualTotal[col.key] || 0;

                  return (
                    <td key={col.key} className="p-2 border-r border-slate-700 text-right space-y-1 font-mono">
                      {showBase && (
                        <div className="flex justify-between items-center text-slate-300">
                          <span className="text-[7px] text-slate-400">BASE:</span>
                          <span>{renderCellValue(bTot)}</span>
                        </div>
                      )}
                      {showPlanned && (
                        <div className="flex justify-between items-center text-indigo-300">
                          <span className="text-[7px] text-indigo-400">PREV:</span>
                          <span>{renderCellValue(pTot)}</span>
                        </div>
                      )}
                      {showActual && (
                        <div className="flex justify-between items-center text-emerald-400">
                          <span className="text-[7px] text-emerald-500">REAL:</span>
                          <span>{renderCellValue(aTot)}</span>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
