import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { 
  BarChart3, 
  Building2, 
  Calendar, 
  Download, 
  RefreshCw, 
  SlidersHorizontal 
} from 'lucide-react';
import type { Task } from '../types';
import { loadBudgets, type BudgetRevision, type BudgetItem } from '../lib/budgetRepository';
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

  // --- CONTROLES DA TELA (COM VALORES PADRÃO REQUISITADOS) ---
  const [eapSource, setEapSource] = useState<EapSource>('budget');
  const [selectedLevel, setSelectedLevel] = useState<string>('3'); // PADRÃO: Nível 3
  const [viewUnit, setViewUnit] = useState<ViewUnit>('percent');   // PADRÃO: %
  const [accumulationMode, setAccumulationMode] = useState<AccumulationMode>('monthly'); // PADRÃO: Mensal

  // CAMADAS PADRÃO: Apenas Previsto marcado por padrão
  const [showBase, setShowBase] = useState<boolean>(false);
  const [showPlanned, setShowPlanned] = useState<boolean>(true);
  const [showActual, setShowActual] = useState<boolean>(false);

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
      if (prog > prev) map.set(rootId, Math.max(prev, Math.min(100, prog)));
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

  // Map O(1) de alocações do orçamento ativo por budgetId
  const allocationsByBudgetId = useMemo(() => {
    const map = new Map<string, typeof activeBudget.allocations>();
    if (activeBudget?.allocations) {
      for (const a of activeBudget.allocations) {
        let list = map.get(a.budgetId);
        if (!list) {
          list = [];
          map.set(a.budgetId, list);
        }
        list.push(a);
      }
    }
    return map;
  }, [activeBudget]);

  // --- MONTAGEM DAS LINHAS DA EAP ---
  const rawEapRows = useMemo<EapRowData[]>(() => {
    if (monthCols.length === 0) return [];

    if (eapSource === 'budget' && activeBudget && activeBudget.items.length > 0) {
      // --- MODO EAP DE ORÇAMENTO COMPLETO (EXIBE 100% DOS ITENS) ---
      const items = activeBudget.items;
      const tasksMap = new Map(tasks.map(t => [t.id, t]));

      // 1. Processa itens folha e itens agrupadores com suporte ao Nível 5 (Atividades Vinculadas)
      const allRows: EapRowData[] = [];
      const itemRowsMap = new Map<string, EapRowData>();
      const itemN5ChildrenMap = new Map<string, EapRowData[]>();

      // Primeiro passo: cria as linhas Nível 5 para cada item de orçamento vinculado
      items.forEach(item => {
        const itemAllocations = allocationsByBudgetId.get(item.id) || [];
        const n5Children: EapRowData[] = [];

        if (itemAllocations.length > 0) {
          itemAllocations.forEach((alloc, allocIdx) => {
            const task = tasksMap.get(alloc.taskId);
            if (!task) return;

            const tStart = parseDateLocal(task.startDate);
            const tEnd = parseDateLocal(task.endDate);
            const taskVal = alloc.value || 0;

            const stProgress = shortTermProgressMap.get(task.id);
            const realProgress = stProgress !== undefined ? stProgress : (task.progress || 0);

            const totalTaskDays = Math.max(1, Math.ceil((tEnd.getTime() - tStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);

            const baseMonthly: Record<string, number> = {};
            const plannedMonthly: Record<string, number> = {};
            const actualMonthly: Record<string, number> = {};

            monthCols.forEach(col => {
              baseMonthly[col.key] = 0;
              plannedMonthly[col.key] = 0;
              actualMonthly[col.key] = 0;
            });

            monthCols.forEach(col => {
              const overlapStart = Math.max(tStart.getTime(), col.startDate.getTime());
              const overlapEnd = Math.min(tEnd.getTime(), col.endDate.getTime());

              if (overlapStart <= overlapEnd) {
                const daysInMonth = Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
                const ratio = Math.min(1, daysInMonth / totalTaskDays);

                baseMonthly[col.key] += taskVal * ratio;
                plannedMonthly[col.key] += taskVal * ratio;
                actualMonthly[col.key] += (taskVal * ratio) * (realProgress / 100);
              }
            });

            const n5Row: EapRowData = {
              id: `n5_${item.id}_${task.id}`,
              code: `${item.code || '0'}.${allocIdx + 1}`,
              description: `⤷ ${task.packageName} - ${task.service || task.lotMother} (${task.lot})`,
              level: 5,
              startDate: tStart.toISOString().slice(0, 10),
              endDate: tEnd.toISOString().slice(0, 10),
              totalValue: taskVal,
              baseMonthly,
              plannedMonthly,
              actualMonthly
            };

            n5Children.push(n5Row);
          });
        }

        itemN5ChildrenMap.set(item.id, n5Children);
      });

      // Segundo passo: constrói a linha de cada item do orçamento
      items.forEach(item => {
        const n5Children = itemN5ChildrenMap.get(item.id) || [];

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

        if (n5Children.length > 0) {
          // Agrega os valores SomarProduto das atividades de Nível 5 filhas
          n5Children.forEach(child => {
            const cStart = parseDateLocal(child.startDate).getTime();
            const cEnd = parseDateLocal(child.endDate).getTime();

            if (cStart < startMs) startMs = cStart;
            if (cEnd > endMs) endMs = cEnd;

            monthCols.forEach(col => {
              baseMonthly[col.key] += child.baseMonthly[col.key] || 0;
              plannedMonthly[col.key] += child.plannedMonthly[col.key] || 0;
              actualMonthly[col.key] += child.actualMonthly[col.key] || 0;
            });
          });
        } else {
          // Item sem vínculos: distribuição uniforme na vigência da obra
          const firstCol = monthCols[0];
          const lastCol = monthCols[monthCols.length - 1];
          startMs = firstCol.startDate.getTime();
          endMs = lastCol.endDate.getTime();

          const monthlyShare = totalValue / Math.max(1, monthCols.length);
          monthCols.forEach(col => {
            baseMonthly[col.key] = monthlyShare;
            plannedMonthly[col.key] = monthlyShare;
            actualMonthly[col.key] = 0;
          });
        }

        const sDateStr = startMs !== Infinity ? new Date(startMs).toISOString().slice(0, 10) : monthCols[0].startDate.toISOString().slice(0, 10);
        const eDateStr = endMs !== -Infinity ? new Date(endMs).toISOString().slice(0, 10) : monthCols[monthCols.length - 1].endDate.toISOString().slice(0, 10);

        const codeParts = item.code ? item.code.split('.').filter(Boolean) : [];
        const levelNum = item.level ? Number(item.level) : Math.max(1, codeParts.length);

        const itemRow: EapRowData = {
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

        itemRowsMap.set(item.id, itemRow);
        allRows.push(itemRow);
        allRows.push(...n5Children);
      });

      return allRows.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

    } else {
      // --- MODO EAP DE PLANEJAMENTO (LOTE MÃE -> MACROSERVIÇO -> LOTE -> SERVIÇO) ---
      const rows: EapRowData[] = [];

      // Agrupamento hierárquico
      // Nível 1: Lote Mãe (lotMother)
      // Nível 2: Macroserviço (packageName) dentro do Lote Mãe
      // Nível 3: Lote / Pavimento (lot)
      // Nível 4: Serviço (service)

      // Identifica Lotes Mãe únicos
      const lotMothers = Array.from(new Set(tasks.map(t => t.lotMother || 'SEM GRUPO'))).sort();

      lotMothers.forEach((lmName, lmIdx) => {
        const lmTasks = tasks.filter(t => (t.lotMother || 'SEM GRUPO') === lmName);
        const lmCode = String(lmIdx + 1).padStart(2, '0');

        // Nível 1: Lote MÃE
        const lmBase: Record<string, number> = {};
        const lmPlanned: Record<string, number> = {};
        const lmActual: Record<string, number> = {};
        monthCols.forEach(col => { lmBase[col.key] = 0; lmPlanned[col.key] = 0; lmActual[col.key] = 0; });
        let lmStartMs = Infinity;
        let lmEndMs = -Infinity;
        let lmTotalVal = 0;

        // Encontra Macroserviços dentro deste Lote Mãe
        const packageNames = Array.from(new Set(lmTasks.map(t => t.packageName || 'OUTROS'))).sort();

        packageNames.forEach((pkgName, pkgIdx) => {
          const pkgTasks = lmTasks.filter(t => (t.packageName || 'OUTROS') === pkgName);
          const pkgCode = `${lmCode}.${String(pkgIdx + 1).padStart(2, '0')}`;

          // Nível 2: Macroserviço
          const pkgBase: Record<string, number> = {};
          const pkgPlanned: Record<string, number> = {};
          const pkgActual: Record<string, number> = {};
          monthCols.forEach(col => { pkgBase[col.key] = 0; pkgPlanned[col.key] = 0; pkgActual[col.key] = 0; });
          let pkgStartMs = Infinity;
          let pkgEndMs = -Infinity;
          let pkgTotalVal = 0;

          // Encontra Lotes/Pavimentos dentro deste Macroserviço
          const lots = Array.from(new Set(pkgTasks.map(t => t.lot || 'SEM LOTE'))).sort();

          lots.forEach((lotName, lotIdx) => {
            const lotTasks = pkgTasks.filter(t => (t.lot || 'SEM LOTE') === lotName);
            const lotCode = `${pkgCode}.${String(lotIdx + 1).padStart(2, '0')}`;

            // Nível 3: Lote / Pavimento
            const lotBase: Record<string, number> = {};
            const lotPlanned: Record<string, number> = {};
            const lotActual: Record<string, number> = {};
            monthCols.forEach(col => { lotBase[col.key] = 0; lotPlanned[col.key] = 0; lotActual[col.key] = 0; });
            let lotStartMs = Infinity;
            let lotEndMs = -Infinity;
            let lotTotalVal = 0;

            lotTasks.forEach(task => {
              const tStart = parseDateLocal(task.startDate);
              const tEnd = parseDateLocal(task.endDate);

              if (tStart.getTime() < lotStartMs) lotStartMs = tStart.getTime();
              if (tEnd.getTime() > lotEndMs) lotEndMs = tEnd.getTime();

              const taskVal = task.cost || 0;
              lotTotalVal += taskVal;

              const stProgress = shortTermProgressMap.get(task.id);
              const realProgress = stProgress !== undefined ? stProgress : (task.progress || 0);

              const totalTaskDays = Math.max(1, Math.ceil((tEnd.getTime() - tStart.getTime()) / (1000 * 60 * 60 * 24)) + 1);

              monthCols.forEach(col => {
                const overlapStart = Math.max(tStart.getTime(), col.startDate.getTime());
                const overlapEnd = Math.min(tEnd.getTime(), col.endDate.getTime());

                if (overlapStart <= overlapEnd) {
                  const daysInMonth = Math.ceil((overlapEnd - overlapStart) / (1000 * 60 * 60 * 24)) + 1;
                  const ratio = Math.min(1, daysInMonth / totalTaskDays);

                  const bVal = taskVal * ratio;
                  const pVal = taskVal * ratio;
                  const aVal = (taskVal * ratio) * (realProgress / 100);

                  lotBase[col.key] += bVal;
                  lotPlanned[col.key] += pVal;
                  lotActual[col.key] += aVal;

                  pkgBase[col.key] += bVal;
                  pkgPlanned[col.key] += pVal;
                  pkgActual[col.key] += aVal;

                  lmBase[col.key] += bVal;
                  lmPlanned[col.key] += pVal;
                  lmActual[col.key] += aVal;
                }
              });
            });

            if (lotStartMs < pkgStartMs) pkgStartMs = lotStartMs;
            if (lotEndMs > pkgEndMs) pkgEndMs = lotEndMs;
            pkgTotalVal += lotTotalVal;

            // Adiciona Nível 3 (Lote / Pavimento)
            rows.push({
              id: `n3_${lotCode}`,
              code: lotCode,
              description: `${lotName} (${pkgName})`,
              level: 3,
              startDate: lotStartMs !== Infinity ? new Date(lotStartMs).toISOString().slice(0, 10) : monthCols[0].startDate.toISOString().slice(0, 10),
              endDate: lotEndMs !== -Infinity ? new Date(lotEndMs).toISOString().slice(0, 10) : monthCols[monthCols.length - 1].endDate.toISOString().slice(0, 10),
              totalValue: lotTotalVal,
              baseMonthly: lotBase,
              plannedMonthly: lotPlanned,
              actualMonthly: lotActual
            });
          });

          if (pkgStartMs < lmStartMs) lmStartMs = pkgStartMs;
          if (pkgEndMs > lmEndMs) lmEndMs = pkgEndMs;
          lmTotalVal += pkgTotalVal;

          // Adiciona Nível 2 (Macroserviço)
          rows.push({
            id: `n2_${pkgCode}`,
            code: pkgCode,
            description: `${pkgName} [${lmName}]`,
            level: 2,
            startDate: pkgStartMs !== Infinity ? new Date(pkgStartMs).toISOString().slice(0, 10) : monthCols[0].startDate.toISOString().slice(0, 10),
            endDate: pkgEndMs !== -Infinity ? new Date(pkgEndMs).toISOString().slice(0, 10) : monthCols[monthCols.length - 1].endDate.toISOString().slice(0, 10),
            totalValue: pkgTotalVal,
            baseMonthly: pkgBase,
            plannedMonthly: pkgPlanned,
            actualMonthly: pkgActual
          });
        });

        // Adiciona Nível 1 (Lote Mãe)
        rows.push({
          id: `n1_${lmCode}`,
          code: lmCode,
          description: lmName,
          level: 1,
          startDate: lmStartMs !== Infinity ? new Date(lmStartMs).toISOString().slice(0, 10) : monthCols[0].startDate.toISOString().slice(0, 10),
          endDate: lmEndMs !== -Infinity ? new Date(lmEndMs).toISOString().slice(0, 10) : monthCols[monthCols.length - 1].endDate.toISOString().slice(0, 10),
          totalValue: lmTotalVal,
          baseMonthly: lmBase,
          plannedMonthly: lmPlanned,
          actualMonthly: lmActual
        });
      });

      return rows.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    }
  }, [eapSource, activeBudget, tasks, monthCols, shortTermProgressMap]);

  // --- FILTRAGEM DE NÍVEL E BUSCA ---
  const filteredEapRows = useMemo(() => {
    let rows = [...rawEapRows];

    // Filtro por Nível de EAP
    if (selectedLevel !== 'all') {
      const lvl = Number(selectedLevel);
      if (lvl === 5) {
        // Nível 5 exibe a EAP completa com o detalhamento por atividade
        rows = rows.filter(r => r.level <= 5);
      } else {
        // Níveis 1 a 4 exibem isoladamente apenas aquele nível específico
        rows = rows.filter(r => r.level === lvl);
      }
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
          line.push(viewUnit === 'percent' ? (row.totalValue > 0 ? (val / row.totalValue) * 100 : 0) : val);
        }
        if (showPlanned) {
          const val = row.plannedDisp[col.key] || 0;
          line.push(viewUnit === 'percent' ? (row.totalValue > 0 ? (val / row.totalValue) * 100 : 0) : val);
        }
        if (showActual) {
          const val = row.actualDisp[col.key] || 0;
          line.push(viewUnit === 'percent' ? (row.totalValue > 0 ? (val / row.totalValue) * 100 : 0) : val);
        }
      });

      exportRows.push(line);
    });

    const ws = XLSX.utils.aoa_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Físico-Financeiro');
    XLSX.writeFile(wb, `Cronograma_Fisico_Financeiro_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // Helper de estilos visuais por Nível da EAP (Cores exatas especificadas)
  const getLevelBgClass = (level: number) => {
    switch (level) {
      case 1:
        return 'bg-[#000000] text-white font-black hover:bg-slate-900';
      case 2:
        return 'bg-[#1A665B] text-white font-bold hover:bg-[#145249]';
      case 3:
        return 'bg-[#A3C6B8] text-slate-900 font-bold hover:bg-[#92b8a9]';
      case 4:
        return 'bg-[#E6E2DA] text-slate-900 font-semibold hover:bg-[#d8d3c9]';
      case 5:
      default:
        return 'bg-white text-slate-800 font-medium hover:bg-slate-50';
    }
  };

  // Helper de renderização de célula para cada LINHA DA TABELA (Calcula % em relação à linha -> soma = 100%)
  const renderRowCellValue = (val: number, rowTotal: number) => {
    if (viewUnit === 'percent') {
      const pct = rowTotal > 0 ? (val / rowTotal) * 100 : 0;
      return formatPercent(pct);
    }
    return formatCurrency(val);
  };

  // Helper de renderização para o RODAPÉ DO PROJETO (Calcula % em relação ao total do projeto -> soma = 100%)
  const renderFooterCellValue = (val: number) => {
    if (viewUnit === 'percent') {
      const pct = grandTotalValue > 0 ? (val / grandTotalValue) * 100 : 0;
      return formatPercent(pct);
    }
    return formatCurrency(val);
  };

  return (
    <div className="p-4 md:p-6 bg-slate-50 h-[calc(100vh-64px)] overflow-hidden flex flex-col gap-4">
      {/* CABEÇALHO DO MÓDULO */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-5 rounded-3xl border border-slate-200 shadow-xs shrink-0">
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
            Análise temporal da evolução física e financeira por EAP com colunas congeladas e filtros dinâmicos.
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
      <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-xs space-y-3 shrink-0">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
          <SlidersHorizontal size={15} className="text-indigo-600" />
          <h2 className="text-xs font-black text-slate-800 uppercase tracking-wider">
            Controles e Parâmetros de Exibição
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
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

          {/* 2. Nível da EAP (PADRÃO: Nível 3) */}
          <div>
            <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">2. Nível da EAP</label>
            <select
              value={selectedLevel}
              onChange={e => setSelectedLevel(e.target.value)}
              className="w-full p-2 border border-slate-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-slate-800 outline-none"
            >
              <option value="all">Todos os Níveis</option>
              <option value="1">Nível 1 (Lote Mãe / Totalizador)</option>
              <option value="2">Nível 2 (Macroserviço / Subgrupo)</option>
              <option value="3">Nível 3 (Lote / Pavimento)</option>
              <option value="4">Nível 4 (Serviços Detalhados)</option>
              <option value="5">Nível 5 (Atividades Vinculadas)</option>
            </select>
          </div>

          {/* 3. Unidade (PADRÃO: %) */}
          <div>
            <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">3. Exibir em</label>
            <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-bold">
              <button
                onClick={() => setViewUnit('percent')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  viewUnit === 'percent' ? 'bg-white text-indigo-700 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                % (Porcentagem)
              </button>
              <button
                onClick={() => setViewUnit('currency')}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  viewUnit === 'currency' ? 'bg-white text-indigo-700 shadow-xs font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                R$ (Valores)
              </button>
            </div>
          </div>

          {/* 4. Modo de Acúmulo (PADRÃO: Mensal) */}
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

        {/* CHECKBOXES DE CAMADAS VISUAIS (PADRÃO: Apenas Previsto marcado) */}
        <div className="flex flex-wrap items-center gap-5 pt-2 border-t border-slate-100 text-xs font-black uppercase">
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

      {/* GRADE DA TABELA DE CRONOGRAMA FÍSICO-FINANCEIRO COM COLUNAS CONGELADAS (STICKY LEFT) */}
      <div className="flex-1 min-h-0 bg-white rounded-3xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
        <div className="p-3 bg-slate-900 text-white flex justify-between items-center text-xs font-black uppercase tracking-wider shrink-0">
          <div className="flex items-center gap-2">
            <Calendar size={15} className="text-indigo-400" />
            <span>
              Matriz Físico-Financeira ({eapSource === 'budget' ? 'EAP Orçamento' : 'EAP Planejamento'}) - {monthCols.length} Meses
            </span>
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            Total do Projeto: {formatCurrency(grandTotalValue)}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto relative max-w-full">
          <table className="w-full text-xs text-left border-collapse min-w-max">
            <thead className="bg-slate-800 text-white uppercase text-[9px] tracking-wider sticky top-0 z-30 shadow-xs">
              <tr>
                {/* COLUNAS INICIAIS CONGELADAS DA ESQUERDA (STICKY) */}
                <th className="p-3 w-24 sticky left-0 bg-slate-800 z-30 border-r border-slate-700 font-black">
                  Código EAP
                </th>
                <th className="p-3 w-64 sticky left-[96px] bg-slate-800 z-30 border-r border-slate-700 font-black">
                  Atividade / Descrição
                </th>
                <th className="p-3 w-24 text-center sticky left-[352px] bg-slate-800 z-30 border-r border-slate-700 font-black">
                  Início
                </th>
                <th className="p-3 w-24 text-center sticky left-[448px] bg-slate-800 z-30 border-r border-slate-700 font-black">
                  Término
                </th>
                <th className="p-3 w-32 text-right sticky left-[544px] bg-slate-850 z-30 border-r-2 border-slate-600 shadow-md font-black">
                  Valor Total
                </th>

                {/* COLUNAS DOS MESES DA OBRA (RÉGUA DE MESES COM SCROLL) */}
                {monthCols.map(col => (
                  <th key={col.key} className="p-3 text-center border-r border-slate-700 min-w-[135px] font-black">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-200 font-medium">
              {displayEapRows.map((row, idx) => {
                const levelBgClass = getLevelBgClass(row.level);
                return (
                  <tr key={row.id || idx} className={`${levelBgClass} transition group`}>
                    {/* COLUNAS CONGELADAS NAS LINHAS */}
                    <td className={`p-2.5 sticky left-0 ${levelBgClass} z-20 border-r border-slate-200 font-mono font-bold text-slate-800`}>
                      {row.code}
                    </td>
                    <td className={`p-2.5 sticky left-[96px] ${levelBgClass} z-20 border-r border-slate-200 font-bold uppercase text-[11px] leading-tight truncate max-w-[256px]`} title={row.description}>
                      {row.description}
                    </td>
                    <td className={`p-2.5 sticky left-[352px] ${levelBgClass} z-20 border-r border-slate-200 text-center font-mono text-[10px]`}>
                      {formatDateBR(row.startDate)}
                    </td>
                    <td className={`p-2.5 sticky left-[448px] ${levelBgClass} z-20 border-r border-slate-200 text-center font-mono text-[10px]`}>
                      {formatDateBR(row.endDate)}
                    </td>
                    <td className={`p-2.5 sticky left-[544px] ${levelBgClass} z-20 border-r-2 border-slate-300 shadow-md text-right font-black`}>
                      {formatCurrency(row.totalValue)}
                    </td>

                    {/* COLUNAS MENSAIS DA LINHA */}
                    {monthCols.map(col => {
                      const bVal = row.baseDisp[col.key] || 0;
                      const pVal = row.plannedDisp[col.key] || 0;
                      const aVal = row.actualDisp[col.key] || 0;

                      const isN5Active = row.level === 5 && ((showPlanned && pVal > 0) || (showBase && bVal > 0) || (showActual && aVal > 0));
                      const cellBgClass = isN5Active ? 'bg-[#E0F2FE] text-sky-950 font-bold' : '';

                      return (
                        <td key={col.key} className={`p-2 border-r border-slate-200 align-top text-right text-[10px] space-y-1 font-mono ${cellBgClass}`}>
                          {showBase && (
                            <div className="flex justify-between items-center text-slate-500 font-semibold border-b border-slate-100 pb-0.5" title="Base">
                              <span className="text-[8px] font-black text-slate-400 uppercase">B:</span>
                              <span>{renderRowCellValue(bVal, row.totalValue)}</span>
                            </div>
                          )}
                          {showPlanned && (
                            <div className="flex justify-between items-center text-indigo-700 font-bold" title="Previsto">
                              <span className="text-[8px] font-black text-indigo-400 uppercase">P:</span>
                              <span>{renderRowCellValue(pVal, row.totalValue)}</span>
                            </div>
                          )}
                          {showActual && (
                            <div className="flex justify-between items-center text-emerald-700 font-bold border-t border-slate-100 pt-0.5" title="Realizado">
                              <span className="text-[8px] font-black text-emerald-500 uppercase">R:</span>
                              <span>{renderRowCellValue(aVal, row.totalValue)}</span>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>

            {/* RODAPÉ COM TOTALIZADORES GERAIS */}
            <tfoot className="bg-slate-900 text-white font-black uppercase text-[10px] sticky bottom-0 z-30 shadow-lg">
              <tr>
                <td className="p-3 sticky left-0 bg-slate-900 z-30 border-r border-slate-700">TOTAL</td>
                <td className="p-3 sticky left-[96px] bg-slate-900 z-30 border-r border-slate-700">CONSOLIDADO DA OBRA</td>
                <td className="p-3 sticky left-[352px] bg-slate-900 z-30 border-r border-slate-700 text-center">-</td>
                <td className="p-3 sticky left-[448px] bg-slate-900 z-30 border-r border-slate-700 text-center">-</td>
                <td className="p-3 sticky left-[544px] bg-slate-950 z-30 border-r-2 border-slate-600 shadow-md text-right font-black text-emerald-400">
                  {formatCurrency(grandTotalValue)}
                </td>

                {monthCols.map(col => {
                  const bTot = grandTotalsByMonth.baseTotal[col.key] || 0;
                  const pTot = grandTotalsByMonth.plannedTotal[col.key] || 0;
                  const aTot = grandTotalsByMonth.actualTotal[col.key] || 0;

                  return (
                    <td key={col.key} className="p-2 border-r border-slate-800 align-top text-right text-[10px] space-y-1 font-mono">
                      {showBase && (
                        <div className="flex justify-between items-center text-slate-400 font-semibold" title="Base Total">
                          <span className="text-[8px] font-black text-slate-500">B:</span>
                          <span>{renderFooterCellValue(bTot)}</span>
                        </div>
                      )}
                      {showPlanned && (
                        <div className="flex justify-between items-center text-indigo-300 font-bold" title="Previsto Total">
                          <span className="text-[8px] font-black text-indigo-400">P:</span>
                          <span>{renderFooterCellValue(pTot)}</span>
                        </div>
                      )}
                      {showActual && (
                        <div className="flex justify-between items-center text-emerald-400 font-bold" title="Realizado Total">
                          <span className="text-[8px] font-black text-emerald-500">R:</span>
                          <span>{renderFooterCellValue(aTot)}</span>
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
