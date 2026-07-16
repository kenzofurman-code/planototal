import React, { useState, useEffect, useMemo, useRef } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadShortTermState, saveShortTermState, type ShortTermWeeklyItem, type ShortTermHistory, type ShortTermState } from '../lib/shortTermRepository';
import { getSimpleServiceInstruction } from '../lib/shortTermText';
import type { Task } from '../types';

// --- Utilitários de Data e Formatação ---
const slugify = (str: string): string => {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
};

const toLocalDateString = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const toISODate = (date: Date): string => {
  return toLocalDateString(date);
};

const parseISODateLocal = (str: string): Date => {
  const [yyyy, mm, dd] = str.split('-').map(Number);
  return new Date(yyyy, mm - 1, dd, 12, 0, 0);
};

const formatDateBR = (dateOrStr: Date | string): string => {
  if (typeof dateOrStr === 'string') {
    const [yyyy, mm, dd] = dateOrStr.split('-');
    return `${dd}/${mm}/${yyyy}`;
  }
  const dd = String(dateOrStr.getDate()).padStart(2, '0');
  const mm = String(dateOrStr.getMonth() + 1).padStart(2, '0');
  const yyyy = dateOrStr.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

const formatWeekId = (weekId: string): string => {
  if (!weekId) return '';
  const [yyyy, mm, dd] = weekId.split('-');
  return `SEMANA DE ${dd}/${mm}/${yyyy}`;
};

const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

const roundPercentValue = (value: number): number => {
  return Math.round(clampPercent(Number(value) || 0) * 1000) / 1000;
};

const roundDown25 = (value: number): number => {
  return Math.floor(roundPercentValue(value) / 25) * 25;
};

const getMacroTitle = (value: string): string => {
  return String(value || 'GERAL').replace(/[-_]+/g, ' ').toUpperCase();
};

const rootActivityId = (activityId: string): string => String(activityId || '').split(':')[0];

// Componentes Auxiliares Simples
function StatCard({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
      <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider">{title}</span>
      <span className={`text-2xl font-black ${color.replace('bg-', 'text-')} mt-1.5`}>{value}</span>
    </div>
  );
}

function DaysSelector({ dailyWork, disabled, onChange, currentWeekStart, weatherCache, projectCity }: { dailyWork: number[]; disabled?: boolean; onChange: (dw: number[]) => void; currentWeekStart: Date; weatherCache: any; projectCity: string }) {
  const normalizeDailyWork = (value?: number[]) => Array.from({ length: 5 }, (_, idx) => value?.[idx] === 1 ? 1 : 0);
  const [localDW, setLocalDW] = useState<number[]>(() => normalizeDailyWork(dailyWork));
  const localDWRef = useRef<number[]>(normalizeDailyWork(dailyWork));
  const isDragging = useRef(false);
  const dragValue = useRef(1);

  useEffect(() => {
    const normalized = normalizeDailyWork(dailyWork);
    localDWRef.current = normalized;
    setLocalDW(normalized);
  }, [dailyWork]);

  const stopDrag = () => {
    if (isDragging.current) {
      isDragging.current = false;
      onChange(localDWRef.current);
    }
    window.removeEventListener('pointerup', stopDrag);
    window.removeEventListener('pointercancel', stopDrag);
    window.removeEventListener('pointermove', handleWindowPointerMove);
    window.removeEventListener('touchend', stopDrag);
  };

  const startDrag = (idx: number) => {
    if (disabled) return;
    isDragging.current = true;
    const nextValue = localDWRef.current[idx] === 1 ? 0 : 1;
    dragValue.current = nextValue;
    const next = [...localDWRef.current];
    next[idx] = nextValue;
    localDWRef.current = next;
    setLocalDW(next);

    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('pointercancel', stopDrag);
    window.addEventListener('pointermove', handleWindowPointerMove, { passive: false });
    window.addEventListener('touchend', stopDrag);
  };

  const enterDrag = (idx: number) => {
    if (!isDragging.current || disabled) return;
    if (localDWRef.current[idx] === dragValue.current) return;
    const next = [...localDWRef.current];
    next[idx] = dragValue.current;
    localDWRef.current = next;
    setLocalDW(next);
  };

  const enterDragAtPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY);
    const dayButton = element?.closest('[data-day-index]') as HTMLElement | null;
    const idx = Number(dayButton?.dataset.dayIndex);
    if (Number.isInteger(idx)) enterDrag(idx);
  };

  const handleWindowPointerMove = (event: PointerEvent) => {
    if (!isDragging.current || disabled) return;
    event.preventDefault();
    enterDragAtPoint(event.clientX, event.clientY);
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging.current || disabled) return;
    if (event.cancelable) event.preventDefault();
    const touch = event.touches[0];
    enterDragAtPoint(touch.clientX, touch.clientY);
  };

  return (
    <div className="short-days-selector" onTouchMove={handleTouchMove}>
      {['S', 'T', 'Q', 'Q', 'S'].map((day, idx) => {
        const dayDate = addDays(currentWeekStart, idx);
        const dayStr = toISODate(dayDate);
        const weather = weatherCache[`${projectCity.trim().toLowerCase()}_${dayStr}`];
        const emoji = weather ? getWeatherEmoji(weather.icon) : '';
        const tooltip = weather ? `${weather.conditions} (${weather.tempMin.toFixed(0)}°C - ${weather.tempMax.toFixed(0)}°C)` : 'Sem clima';

        return (
          <div key={idx} className="short-day-wrap" title={tooltip}>
            <span className="short-day-weather">{emoji || '\u00a0'}</span>
            <button
              type="button"
              disabled={disabled}
              data-day-index={idx}
              onPointerDown={(event) => {
                event.preventDefault();
                try {
                  event.currentTarget.releasePointerCapture?.(event.pointerId);
                } catch {
                  // Some browsers do not expose implicit pointer capture for mouse input.
                }
                startDrag(idx);
              }}
              onPointerEnter={() => enterDrag(idx)}
              className={`short-day-button ${localDW[idx] === 1 ? 'short-day-active' : 'short-day-idle'}`}
            >
              {day}
            </button>
          </div>
        );
      })}
    </div>
  );
}

const getWeatherEmoji = (icon: string) => {
  if (icon.includes('rain') || icon.includes('snow')) return '🌧️';
  if (icon.includes('cloud')) return '☁️';
  if (icon.includes('wind')) return '💨';
  return '☀️';
};

const playBeep = (freq: number, duration: number) => {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration/1000);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration/1000);
  } catch (e) {
    console.warn('Audio Context failed:', e);
  }
};

interface ShortTermProps {
  tasks: Task[];
  projectId: string;
  setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
}

export function ShortTerm({ tasks, projectId, setTasks }: ShortTermProps) {
  // --- Estados Principais ---
  const [planning, setPlanning] = useState<ShortTermWeeklyItem[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [delayReasons, setDelayReasons] = useState<string[]>([]);
  const [ppcHistory, setPpcHistory] = useState<ShortTermHistory[]>([]);
  const [teamPhones, setTeamPhones] = useState<{ [teamName: string]: string }>({});
  const [projectCity, setProjectCity] = useState<string>('Curitiba, PR');
  const [weatherApiKey, setWeatherApiKey] = useState<string>('');
  const [matrices, setMatrices] = useState<any[]>([]);
  
  // Controle administrativo básico sem bloqueio de tela
  const [accessControl, setAccessControl] = useState<{
    users: string[];
    projectAccess: { [projectId: string]: string[] };
    logs: { username: string; timestamp: string }[];
  }>({ users: [], projectAccess: {}, logs: [] });

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [currentWeekStart, setCurrentWeekStart] = useState<Date>(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const mon = new Date(d.setDate(diff));
    mon.setHours(0, 0, 0, 0);
    return mon;
  });

  const [persistenceReady, setPersistenceReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<'local' | 'pending' | 'saving' | 'saved' | 'error'>('local');
  const saveTimeoutRef = useRef<number | null>(null);
  const pendingSaveStateRef = useRef<ShortTermState | null>(null);
  const skipNextAutosaveRef = useRef(false);

  // Modais e Diálogos
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void } | null>(null);
  const [finalizeModal, setFinalizeModal] = useState<{ isOpen: boolean; carryOverUnfinished: boolean } | null>(null);
  const [whatsappModal, setWhatsappModal] = useState<{ isOpen: boolean; teamName: string; text: string }>({ isOpen: false, teamName: '', text: '' });

  // Clima Cache
  const [weatherCache, setWeatherCache] = useState<{ [key: string]: { conditions: string; tempMin: number; tempMax: number; icon: string } }>({});
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);

  // Busca e Filtros
  const [cronoSearch, setCronoSearch] = useState('');
  const [cronoFloorFilter, setCronoFloorFilter] = useState('');
  const [cronoMacroFilter, setCronoMacroFilter] = useState('');
  const [cronoProgressFilter, setCronoProgressFilter] = useState('');
  
  const [planningSearch, setPlanningSearch] = useState('');
  const [planningTeamFilter, setPlanningTeamFilter] = useState('');
  const [planningStatusFilter, setPlanningStatusFilter] = useState('');

  const [giantSearch, setHistorySearch] = useState('');
  const [giantFloorFilter, setHistoryFloorFilter] = useState('');
  const [giantMacroFilter, setHistoryMacroFilter] = useState('');
  const [giantStatusFilter, setHistoryStatusFilter] = useState('');

  // Adicionar Atividades (Drawer lateral)
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [drawerMacro, setDrawerMacro] = useState<string>('');
  const [drawerFloor, setDrawerFloor] = useState<string>('');
  const [drawerFloors, setDrawerFloors] = useState<string[]>([]);
  const [drawerSelectedServices, setDrawerSelectedServices] = useState<string[]>([]);
  const [drawerResponsible, setDrawerResponsible] = useState<string>('');
  const [drawerSourceMode, setDrawerSourceMode] = useState<'medium' | 'previous-successors' | 'unfinished'>('medium');
  const [drawerMacroSearch, setDrawerMacroSearch] = useState<string>('');
  const [isDrawerMacroDropdownOpen, setIsDrawerMacroDropdownOpen] = useState<boolean>(false);
  const [drawerWarning, setDrawerWarning] = useState<string>('');
  const [drawerSearch, setDrawerSearch] = useState<string>('');

  const [extraActivityName, setExtraActivityName] = useState<string>('');
  const [extraActivityFloor, setExtraActivityFloor] = useState<string>('');
  const [extraActivityMacro, setExtraActivityMacro] = useState<string>('');
  const [extraActivityTeam, setExtraActivityTeam] = useState<string>('');

  // Seleções do visualizador matricial
  const [matrixSelection, setMatrixSelection] = useState<{ isOpen: boolean; matrixId: string; type: 'macro' | 'floor' } | null>(null);

  // Gravação por voz e complemento
  const [listeningTaskId, setListeningTaskId] = useState<string | null>(null);
  const [micConnectingTaskId, setMicConnectingTaskId] = useState<string | null>(null);
  const [listeningComplementTaskId, setListeningComplementTaskId] = useState<string | null>(null);
  const [micConnectingComplementTaskId, setMicConnectingComplementTaskId] = useState<string | null>(null);
  const [editingComplementTaskId, setEditingComplementTaskId] = useState<string | null>(null);

  // Cadastros e Configurações
  const [newTeamName, setNewTeamName] = useState<string>('');
  const [newDelayReason, setNewDelayReason] = useState<string>('');

  // Detalhamento PPC
  const [ppcSelectedContractor, setPpcSelectedContractor] = useState<string>('');
  const [ppcStartWeek, setPpcStartWeek] = useState<string>('');
  const [ppcEndWeek, setPpcEndWeek] = useState<string>('');

  // IA Insight cache
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  // Checkbox exclusão em lote
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  // Ref para detectar nova importação de cronograma
  const previousTasksSignature = useRef<string | null>(null);

  // --- Mapeamento Reativo das Tarefas ---
  const cronogramaInicial = useMemo(() => {
    return tasks.map(t => ({
      id: t.id,
      originalId: t.id.includes(':') ? t.id.split(':')[0] : t.id,
      macro: t.packageName || 'GERAL',
      floor: t.lot || 'GERAL',
      service: t.service || t.packageName || 'SERVIÇO',
      duration: t.duration || 1,
      start: t.startDate,
      startDate: t.startDate,
      endDate: t.endDate,
      end: new Date(t.endDate + 'T12:00:00'),
      progress: t.progress || 0,
      cost: t.cost || 0,
      responsible: t.responsible || '',
      predecessors: t.predecessors ?? [],
      successors: t.successors ?? [],
      replicationGroup: t.lotMother || '',
      isParent: false
    }));
  }, [tasks]);

  const floors = useMemo(() => {
    return Array.from(new Set(cronogramaInicial.map(c => c.floor))).sort();
  }, [cronogramaInicial]);

  const allPossibleMacros = useMemo(() => {
    return Array.from(new Set(cronogramaInicial.map(c => c.macro))).sort();
  }, [cronogramaInicial]);

  // --- Memoizations para Detalhamento PPC ---
  const contractorsInPeriod = useMemo(() => {
    return Array.from(new Set(planning.map(t => t.responsible))).filter(Boolean).sort() as string[];
  }, [planning]);

  const availableWeeks = useMemo(() => {
    return Array.from(new Set(planning.map(t => t.weekId))).sort();
  }, [planning]);

  useEffect(() => {
    if (contractorsInPeriod.length > 0 && !ppcSelectedContractor) {
      setPpcSelectedContractor(contractorsInPeriod[0]);
    }
    if (availableWeeks.length > 0) {
      if (!ppcStartWeek) setPpcStartWeek(availableWeeks[0]);
      if (!ppcEndWeek) setPpcEndWeek(availableWeeks[availableWeeks.length - 1]);
    }
  }, [contractorsInPeriod, availableWeeks, ppcSelectedContractor, ppcStartWeek, ppcEndWeek]);

  const contractorWeeklyPpcData = useMemo(() => {
    if (!ppcSelectedContractor || !ppcStartWeek || !ppcEndWeek) return [];
    const periodWeeks = availableWeeks.filter(w => w >= ppcStartWeek && w <= ppcEndWeek);

    return periodWeeks.map(wId => {
      const weekTasksList = planning.filter(t => t.weekId === wId && t.responsible === ppcSelectedContractor);
      const totalP = weekTasksList.length;
      if (totalP === 0) return { weekId: wId, startDateStr: formatDateBR(wId), ppc: null };
      const comp = weekTasksList.filter(t => t.progressThisWeek >= t.plannedThisWeek).length;
      return { weekId: wId, startDateStr: formatDateBR(wId), ppc: Math.round((comp / totalP) * 100) };
    });
  }, [planning, ppcSelectedContractor, ppcStartWeek, ppcEndWeek, availableWeeks]);

  const averagePpc = useMemo(() => {
    const valids = contractorWeeklyPpcData.filter(d => d.ppc !== null);
    if (valids.length === 0) return 0;
    return Math.round(valids.reduce((acc, d) => acc + (d.ppc || 0), 0) / valids.length);
  }, [contractorWeeklyPpcData]);

  const ppcEvolutionChart = useMemo(() => {
    const data = contractorWeeklyPpcData.filter(d => d.ppc !== null);
    if (data.length === 0) return null;
    const width = 500;
    const height = 220;
    const mLeft = 40;
    const chartW = width - mLeft - 20;
    const chartH = height - 40 - 20;
    const getY = (val: number) => height - 40 - (val / 100) * chartH;
    const xStep = data.length > 1 ? chartW / (data.length - 1) : chartW;
    
    const points = data.map((d, idx) => ({
      x: mLeft + idx * xStep,
      y: getY(d.ppc || 0),
      ppc: d.ppc,
      label: d.startDateStr.slice(0, 5)
    }));

    const pathD = points.length > 0 ? `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ') : '';
    return { width, height, mLeft, getY, validPoints: points, pathD };
  }, [contractorWeeklyPpcData]);

  const delayStatsContractor = useMemo(() => {
    if (!ppcSelectedContractor || !ppcStartWeek || !ppcEndWeek) return [];
    const counts: { [key: string]: number } = {};
    planning.forEach(t => {
      if (t.weekId >= ppcStartWeek && t.weekId <= ppcEndWeek && t.responsible === ppcSelectedContractor) {
        if (t.progressThisWeek < t.plannedThisWeek && t.delayReason) {
          counts[t.delayReason] = (counts[t.delayReason] || 0) + 1;
        }
      }
    });
    const list = Object.entries(counts).map(([reason, count]) => ({ reason, count }));
    list.sort((a, b) => b.count - a.count);
    const total = list.reduce((acc, i) => acc + i.count, 0);
    return list.map(item => ({ ...item, percent: total > 0 ? (item.count / total) * 100 : 0 }));
  }, [planning, ppcSelectedContractor, ppcStartWeek, ppcEndWeek]);

  // --- CARREGAMENTO DO SUPABASE ---
  useEffect(() => {
    let active = true;
    setPersistenceReady(false);
    setSyncStatus('saving');
    void loadShortTermState(projectId)
      .then((state) => {
        if (!active) return;
        if (state) {
          setPlanning(state.weekly ?? []);
          setTeams(state.teams?.length ? state.teams : ['Equipe própria', 'Empreiteiro A']);
          setDelayReasons(state.reasons?.length ? state.reasons : ['Clima', 'Material', 'Mão de obra', 'Projeto', 'Liberação']);
          setPpcHistory(state.history ?? []);
          setTeamPhones(state.teamPhones ?? {});
          setProjectCity(state.projectCity ?? 'Curitiba, PR');
          setWeatherApiKey(state.weatherApiKey ?? '');
          setMatrices(state.matrices ?? []);
          setAccessControl(state.accessControl ?? { users: [], projectAccess: {}, logs: [] });
        } else {
          setPlanning([]);
          setTeams(['Equipe própria', 'Empreiteiro A']);
          setDelayReasons(['Clima', 'Material', 'Mão de obra', 'Projeto', 'Liberação']);
          setPpcHistory([]);
          setTeamPhones({});
          setProjectCity('Curitiba, PR');
          setWeatherApiKey('');
          setMatrices([]);
          setAccessControl({ users: [], projectAccess: {}, logs: [] });
        }
        skipNextAutosaveRef.current = true;
        setSyncStatus(isSupabaseConfigured ? 'saved' : 'local');
        setPersistenceReady(true);
      })
      .catch((err) => {
        console.error('Error loading short term state:', err);
        if (active) {
          setSyncStatus('error');
          setPersistenceReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  // --- SALVAMENTO COM DEBOUNCE NO SUPABASE ---
  useEffect(() => {
    if (!persistenceReady || !isSupabaseConfigured) return;
    const stateToSave: ShortTermState = {
      weekly: planning,
      teams,
      reasons: delayReasons,
      history: ppcHistory,
      teamPhones,
      projectCity,
      weatherApiKey,
      matrices,
      accessControl
    };

    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      pendingSaveStateRef.current = null;
      return;
    }

    pendingSaveStateRef.current = stateToSave;
    setSyncStatus('pending');

    if (saveTimeoutRef.current !== null) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      const pendingState = pendingSaveStateRef.current;
      if (!pendingState) return;

      pendingSaveStateRef.current = null;
      saveTimeoutRef.current = null;
      setSyncStatus('saving');

      void saveShortTermState(projectId, pendingState)
        .then(() => setSyncStatus('saved'))
        .catch((err) => {
          console.error('Error saving short term state:', err);
          setSyncStatus('error');
        });
    }, 1500);

    return () => {
      if (saveTimeoutRef.current !== null) {
        window.clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [projectId, planning, teams, delayReasons, ppcHistory, teamPhones, projectCity, weatherApiKey, matrices, accessControl, persistenceReady]);

  // --- Registrar log silencioso ao entrar na obra ---
  useEffect(() => {
    if (!persistenceReady) return;
    const newLog = {
      username: 'Sistema (Acesso Direto)',
      timestamp: new Date().toISOString()
    };
    setAccessControl(prev => ({
      ...prev,
      logs: [newLog, ...(prev.logs || [])].slice(0, 100)
    }));
  }, [projectId, persistenceReady]);

  // --- Auto-popular planejamento semanal ao importar cronograma ---
  useEffect(() => {
    if (!persistenceReady) return;

    const currentSignature = tasks.map(t => t.id).sort().join(',');
    previousTasksSignature.current = currentSignature;

    // Se é o primeiro carregamento, apenas guarda a assinatura atual
    if (previousTasksSignature.current === null) {
      previousTasksSignature.current = currentSignature;
      return;
    }

    // Se a assinatura mudou (indica importação de cronograma)
    if (previousTasksSignature.current !== currentSignature) {
      previousTasksSignature.current = currentSignature;

      const weekId = toLocalDateString(currentWeekStart);
      const newItems: ShortTermWeeklyItem[] = [];

      tasks.forEach(t => {
        const progress = t.progress || 0;
        if (progress < 100) {
          const alreadyPlanned = planning.some(p => p.weekId === weekId && p.activityId === t.id);
          if (!alreadyPlanned) {
            const uniqueId = slugify(`${t.id}_${weekId}_sem-equipe`);
            newItems.push({
              id: uniqueId,
              weekId,
              activityId: t.id,
              activityName: t.service || t.packageName || 'SERVIÇO',
              floor: t.lot || 'GERAL',
              sectionId: t.packageName || 'GERAL',
              responsible: '',
              efetivo: null,
              plannedThisWeek: Math.max(100 - progress, 25),
              progressThisWeek: 0,
              executedBefore: progress,
              dailyWork: [0, 0, 0, 0, 0],
              delayReason: '',
              observations: '',
              finalized: false,
              isManual: false
            });
          }
        }
      });

      if (newItems.length > 0) {
        setPlanning(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const filteredNew = newItems.filter(n => !existingIds.has(n.id));
          return [...prev, ...filteredNew];
        });
        setNotification({ 
          message: `Importação: ${newItems.length} atividades não concluídas trazidas para o planejamento da semana.`, 
          type: 'success' 
        });
      }
    }
  }, [tasks, currentWeekStart, persistenceReady, planning]);

  // --- Lógica de Clima ---
  useEffect(() => {
    if (!projectCity) return;
    const weekDays = [0, 1, 2, 3, 4].map(idx => toISODate(addDays(currentWeekStart, idx)));
    const cacheMisses = weekDays.filter(d => !weatherCache[`${projectCity.trim().toLowerCase()}_${d}`]);
    if (cacheMisses.length === 0) return;

    if (!weatherApiKey) {
      const simulated: typeof weatherCache = {};
      weekDays.forEach((dayStr, idx) => {
        const seed = dayStr.split('-').reduce((acc, char) => acc + char.charCodeAt(0), 0) + idx;
        const tempMin = 12 + (seed % 8);
        const tempMax = 20 + (seed % 10);
        const conditions = seed % 3 === 0 ? 'Chuva' : seed % 4 === 0 ? 'Nublado' : 'Ensolarado';
        const icon = seed % 3 === 0 ? 'rain' : seed % 4 === 0 ? 'cloudy' : 'sunny';
        simulated[`${projectCity.trim().toLowerCase()}_${dayStr}`] = { conditions, tempMin, tempMax, icon };
      });
      setWeatherCache(prev => ({ ...prev, ...simulated }));
      return;
    }

    setWeatherLoading(true);
    const startStr = weekDays[0];
    const endStr = weekDays[weekDays.length - 1];
    const url = `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${encodeURIComponent(projectCity)}/${startStr}/${endStr}?unitGroup=metric&include=days&key=${weatherApiKey}&contentType=json`;

    fetch(url)
      .then(res => res.json())
      .then(data => {
        const fetched: typeof weatherCache = {};
        data.days?.forEach((day: any) => {
          fetched[`${projectCity.trim().toLowerCase()}_${day.datetime}`] = {
            conditions: day.conditions,
            tempMin: day.tempmin,
            tempMax: day.tempmax,
            icon: day.icon
          };
        });
        setWeatherCache(prev => ({ ...prev, ...fetched }));
        setWeatherLoading(false);
      })
      .catch(err => {
        console.error('Error fetching weather:', err);
        setWeatherLoading(false);
      });
  }, [projectCity, currentWeekStart, weatherApiKey]);

  // --- Ditado de Observações ---
  const handleVoiceInput = (taskId: string) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Seu navegador não suporta reconhecimento de voz.');
      return;
    }
    if (listeningTaskId === taskId) return;
    setMicConnectingTaskId(taskId);
    playBeep(800, 120);

    const rec = new SpeechRecognition();
    rec.lang = 'pt-BR';
    rec.interimResults = false;

    rec.onstart = () => {
      setMicConnectingTaskId(null);
      setListeningTaskId(taskId);
    };

    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setPlanning(prev => prev.map(t => {
        if (t.id === taskId) {
          const currentObs = t.observations || '';
          return { ...t, observations: currentObs ? `${currentObs} ${text}` : text, lastUpdatedBy: 'Sistema' };
        }
        return t;
      }));
    };

    rec.onerror = () => {
      setMicConnectingTaskId(null);
      setListeningTaskId(null);
    };

    rec.onend = () => {
      setListeningTaskId(null);
      setMicConnectingTaskId(null);
      playBeep(600, 180);
    };

    rec.start();
  };

  // --- Ditado de Complemento ---
  const handleServiceComplementVoiceInput = (taskId: string) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Seu navegador não suporta reconhecimento de voz.');
      return;
    }
    if (listeningComplementTaskId === taskId) return;
    setMicConnectingComplementTaskId(taskId);
    playBeep(800, 120);

    const rec = new SpeechRecognition();
    rec.lang = 'pt-BR';
    rec.interimResults = false;

    rec.onstart = () => {
      setMicConnectingComplementTaskId(null);
      setListeningComplementTaskId(taskId);
    };

    rec.onresult = (e: any) => {
      const text = e.results[0][0].transcript;
      setPlanning(prev => prev.map(t => {
        if (t.id === taskId) {
          const currentComp = t.serviceComplement || '';
          return { ...t, serviceComplement: currentComp ? `${currentComp} ${text}` : text, lastUpdatedBy: 'Sistema' };
        }
        return t;
      }));
    };

    rec.onerror = () => {
      setMicConnectingComplementTaskId(null);
      setListeningComplementTaskId(null);
    };

    rec.onend = () => {
      setListeningComplementTaskId(null);
      setMicConnectingComplementTaskId(null);
      playBeep(600, 180);
    };

    rec.start();
  };

  // --- Finalizar Semana ---
  const handleFinalizeWeek = async (carryOverUnfinished: boolean) => {
    const { percent, completedCount, totalPlannedCount } = currentWeekPpcStats;
    const weekId = toLocalDateString(currentWeekStart);

    const cleanHistory = ppcHistory.filter(h => h.weekStart !== weekId);
    const updatedHistory = [
      ...cleanHistory,
      {
        weekStart: weekId,
        ppc: percent,
        completed: completedCount,
        totalPlanned: totalPlannedCount
      }
    ];

    const nextWeekStart = toLocalDateString(addDays(currentWeekStart, 7));
    const carryOverTasks: ShortTermWeeklyItem[] = [];

    const updatedPlanning = planning.map(t => {
      if (t.weekId === weekId) {
        const finalProgress = Math.min(100, (t.executedBefore ?? 0) + (t.progressThisWeek ?? 0));
        const isCompleted = (t.progressThisWeek ?? 0) >= (t.plannedThisWeek ?? 100) || finalProgress >= 100;
        const alreadyCarried = planning.some(p => p.weekId === nextWeekStart && p.activityId === t.activityId && p.floor === t.floor);
        if (!isCompleted && carryOverUnfinished && !alreadyCarried) {
          carryOverTasks.push({
            id: slugify(`${t.activityId}_${nextWeekStart}_${t.responsible || 'extra'}`),
            weekId: nextWeekStart,
            activityId: t.activityId,
            activityName: t.activityName,
            floor: t.floor,
            sectionId: t.sectionId,
            responsible: t.responsible || '',
            efetivo: t.efetivo,
            plannedThisWeek: Math.max(0, 100 - finalProgress),
            progressThisWeek: 0,
            executedBefore: finalProgress,
            executedBeforeRaw: finalProgress,
            dailyWork: [0, 0, 0, 0, 0],
            delayReason: '',
            observations: 'Saldo reprogramado da semana anterior',
            finalized: false,
            isManual: t.isManual,
            isParent: t.isParent,
            finishDate: t.finishDate,
            predecessors: t.predecessors ?? [],
            successors: t.successors ?? [],
            originalId: t.originalId,
            replicationGroup: t.replicationGroup
          });
        }
        return { ...t, finalized: true };
      }
      return t;
    });

    const finalPlanningList = [...updatedPlanning, ...carryOverTasks];

    // Atualiza progresso no cronograma principal do Plano Total
    const updatedTasks = tasks.map(task => {
      const planningItems = planning.filter(p => p.weekId === weekId && p.activityId === task.id);
      if (planningItems.length > 0) {
        const totalProgressThisWeek = planningItems.reduce((acc, p) => acc + (p.progressThisWeek ?? 0), 0);
        const newProgress = Math.min(100, (task.progress || 0) + totalProgressThisWeek);
        return { ...task, progress: newProgress };
      }
      return task;
    });

    if (setTasks) {
      setTasks(updatedTasks);
    }

    setPlanning(finalPlanningList);
    setPpcHistory(updatedHistory);
    setFinalizeModal(null);
    setNotification({ message: 'Semana finalizada com sucesso e avanço integrado no cronograma principal!', type: 'success' });
  };

  // --- Função Inteligente de IA insight ---
  const handleAIAnalysis = async () => {
    const weekId = toLocalDateString(currentWeekStart);
    const activePlanning = planning.filter(t => t.weekId === weekId);
    if (activePlanning.length === 0) {
      setAiAnalysis('Nenhuma atividade planejada na semana para analisar.');
      return;
    }

    setAiLoading(true);
    try {
      const totalPlanned = activePlanning.length;
      const completed = activePlanning.filter(t => t.progressThisWeek >= t.plannedThisWeek).length;
      const computedPpc = ((completed / totalPlanned) * 100).toFixed(1);
      const delayStatsObj = activePlanning.filter(t => t.progressThisWeek < t.plannedThisWeek && t.delayReason);
      const topReason = delayStatsObj.length > 0 ? delayStatsObj[0].delayReason : 'Nenhum desvio crítico';

      const simulatedAnalysis = `## 📊 Análise de Produtividade Semanal (PPC: ${computedPpc}%)

Identificamos um volume total de **${totalPlanned} serviços planejados** para esta semana, dos quais **${completed} foram concluídos com êxito** segundo a meta estabelecida. 

## ⚠️ Gargalos e Motivos de Desvios Detectados
* O principal gargalo da semana foi classificado sob o motivo: **"${topReason}"**.
* Serviços localizados nos pavimentos mais altos demonstram ligeira queda de ritmo, sugerindo fadiga de transporte vertical ou problemas logísticos locais.

## 💡 Ações Recomendadas (Insights Gerenciais)
* **Readequação de Equipe:** Avalie realocar efetivo de atividades adiantadas para reforçar frentes de trabalho com desvio crítico.
* **Segurança e Logística:** Garantir a entrega antecipada de insumos na sexta-feira para evitar ociosidade na segunda-feira pela manhã.`;

      setTimeout(() => {
        setAiAnalysis(simulatedAnalysis);
        setAiLoading(false);
      }, 1200);

    } catch (err) {
      console.error(err);
      setAiAnalysis('Falha ao gerar análises inteligentes no momento.');
      setAiLoading(false);
    }
  };

  // --- Lógica de Estatísticas ---
  const currentWeekPpcStats = useMemo(() => {
    const weekId = toLocalDateString(currentWeekStart);
    const weekTasks = planning.filter(t => t.weekId === weekId);
    const activePlannedTasks = weekTasks.filter(t => (t.plannedThisWeek ?? 100) > 0);
    const totalPlannedCount = activePlannedTasks.length;
    const completedCount = activePlannedTasks.filter(t => (t.progressThisWeek ?? 0) >= (t.plannedThisWeek ?? 100)).length;
    const percent = totalPlannedCount > 0 ? (completedCount / totalPlannedCount) * 100 : 0;
    return { percent, completedCount, totalPlannedCount };
  }, [planning, currentWeekStart]);

  const weeklyTasks = useMemo(() => {
    const weekId = toLocalDateString(currentWeekStart);
    return planning.filter(t => t.weekId === weekId);
  }, [planning, currentWeekStart]);

  const ppcChartData = useMemo(() => {
    return (ppcHistory || []).slice(-8).map(h => ({
      weekStart: h.weekStart,
      ppc: h.ppc,
      completed: h.completed,
      totalPlanned: h.totalPlanned
    }));
  }, [ppcHistory]);

  const delayStats = useMemo(() => {
    const counts: { [key: string]: number } = {};
    planning.forEach(t => {
      if (t.progressThisWeek < t.plannedThisWeek && t.delayReason) {
        counts[t.delayReason] = (counts[t.delayReason] || 0) + 1;
      }
    });
    const list = Object.entries(counts).map(([reason, count]) => ({ reason, count }));
    list.sort((a, b) => b.count - a.count);
    const total = list.reduce((acc, i) => acc + i.count, 0);
    let running = 0;
    return list.slice(0, 5).map(item => {
      running += item.count;
      const percent = total > 0 ? (item.count / total) * 100 : 0;
      const cumulativePercent = total > 0 ? (running / total) * 100 : 0;
      return { ...item, percent, cumulativePercent };
    });
  }, [planning]);

  const currentWeekId = toLocalDateString(currentWeekStart);
  const previousWeekIdForDrawer = toLocalDateString(addDays(currentWeekStart, -7));

  const drawerCandidateActivities = useMemo(() => {
    const isParentMediumItem = (item: typeof cronogramaInicial[number]) => {
      return Boolean(item.isParent) || slugify(item.service || '') === slugify(item.macro || '');
    };
    const familyKey = (item: typeof cronogramaInicial[number]) => `${item.floor || ''}||${slugify(item.macro || '')}`;
    const familiesWithChildren = new Set(
      cronogramaInicial
        .filter(item => item && !isParentMediumItem(item))
        .map(item => familyKey(item))
    );
    const openMediumItems = cronogramaInicial.filter(item => (
      item &&
      (item.progress ?? 0) < 100 &&
      (!isParentMediumItem(item) || !familiesWithChildren.has(familyKey(item)))
    ));

    if (drawerSourceMode === 'unfinished') {
      return openMediumItems.filter(item => (item.progress ?? 0) > 0 && (item.progress ?? 0) < 100);
    }

    if (drawerSourceMode !== 'previous-successors') return openMediumItems;

    const previousActivityIds = new Set<string>();
    const successorIds = new Set<string>();
    planning
      .filter(task => task.weekId === previousWeekIdForDrawer && task.finalized)
      .forEach(task => {
        [task.activityId, rootActivityId(task.activityId)].forEach(id => {
          if (id) previousActivityIds.add(id);
        });
        const mediumItem = cronogramaInicial.find(item => item.id === task.activityId || item.originalId === rootActivityId(task.activityId));
        [...(task.successors ?? []), ...(mediumItem?.successors ?? [])].forEach(id => {
          const value = String(id || '').trim();
          if (value) {
            successorIds.add(value);
            successorIds.add(rootActivityId(value));
          }
        });
      });

    if (previousActivityIds.size === 0 && successorIds.size === 0) return [];

    return openMediumItems.filter(item => {
      const itemIds = [item.id, item.originalId, rootActivityId(item.id)].filter(Boolean).map(String);
      const directSuccessor = itemIds.some(id => successorIds.has(id));
      const predecessorReleased = (item.predecessors ?? []).some(id => {
        const value = String(id || '').trim();
        return previousActivityIds.has(value) || previousActivityIds.has(rootActivityId(value));
      });
      return directSuccessor || predecessorReleased;
    });
  }, [cronogramaInicial, drawerSourceMode, planning, previousWeekIdForDrawer]);

  const drawerMacroOptions = useMemo(() => (
    Array.from(new Set(drawerCandidateActivities.map(item => slugify(item.macro)).filter(Boolean)))
  ), [drawerCandidateActivities]);

  const filteredMacros = useMemo(() => {
    const query = drawerMacroSearch.trim().toLocaleLowerCase('pt-BR');
    if (!query) return drawerMacroOptions;
    return drawerMacroOptions.filter(macro => (
      getMacroTitle(macro).toLocaleLowerCase('pt-BR').includes(query) ||
      macro.toLocaleLowerCase('pt-BR').includes(query)
    ));
  }, [drawerMacroOptions, drawerMacroSearch]);

  const availableFloorsForMacro = useMemo(() => {
    if (drawerSourceMode === 'unfinished' || !drawerMacro) return [];
    return Array.from(new Set(
      drawerCandidateActivities
        .filter(item => slugify(item.macro) === drawerMacro)
        .map(item => item.floor)
        .filter(Boolean)
    ));
  }, [drawerCandidateActivities, drawerMacro, drawerSourceMode]);

  const availableServicesForMacroAndFloors = useMemo(() => {
    if (drawerSourceMode === 'unfinished') return drawerCandidateActivities;
    if (!drawerMacro || drawerFloors.length === 0) return [];
    return drawerCandidateActivities.filter(item =>
      slugify(item.macro) === drawerMacro &&
      drawerFloors.includes(item.floor)
    );
  }, [drawerCandidateActivities, drawerMacro, drawerFloors, drawerSourceMode]);

  useEffect(() => {
    setDrawerFloors([]);
    setDrawerSelectedServices([]);
    setDrawerWarning('');
    if (drawerMacro && !drawerMacroOptions.includes(drawerMacro)) setDrawerMacro('');
  }, [drawerSourceMode, drawerMacroOptions, drawerMacro]);

  const activityOrderMap = useMemo(() => {
    const byId = new Map<string, number>();
    const byComposite = new Map<string, number>();
    cronogramaInicial.forEach((item, index) => {
      byId.set(item.id, index);
      byId.set(rootActivityId(item.id), index);
      if (item.originalId) byId.set(item.originalId, index);
      byComposite.set(`${item.floor}||${slugify(item.macro)}||${item.service}`.toLocaleLowerCase('pt-BR'), index);
    });
    return { byId, byComposite };
  }, [cronogramaInicial]);

  // --- Filtros de Pesquisa ---
  const filteredWeeklyTasks = useMemo(() => {
    let list = [...weeklyTasks];
    if (planningSearch) {
      list = list.filter(t =>
        t.activityName.toLowerCase().includes(planningSearch.toLowerCase()) ||
        t.floor.toLowerCase().includes(planningSearch.toLowerCase()) ||
        (t.sectionId || '').toLowerCase().includes(planningSearch.toLowerCase()) ||
        (t.serviceComplement || '').toLowerCase().includes(planningSearch.toLowerCase()) ||
        (t.observations || '').toLowerCase().includes(planningSearch.toLowerCase())
      );
    }
    if (planningTeamFilter) {
      list = list.filter(t => t.responsible === planningTeamFilter);
    }
    if (planningStatusFilter) {
      if (planningStatusFilter === 'ok') list = list.filter(t => t.progressThisWeek >= t.plannedThisWeek);
      else if (planningStatusFilter === 'delayed') list = list.filter(t => t.progressThisWeek < t.plannedThisWeek);
    }
    return list.sort((a, b) => {
      const aComposite = `${a.floor}||${slugify(a.sectionId)}||${a.activityName}`.toLocaleLowerCase('pt-BR');
      const bComposite = `${b.floor}||${slugify(b.sectionId)}||${b.activityName}`.toLocaleLowerCase('pt-BR');
      const aOrder =
        activityOrderMap.byId.get(a.activityId) ??
        activityOrderMap.byId.get(rootActivityId(a.activityId)) ??
        activityOrderMap.byComposite.get(aComposite) ??
        Number.MAX_SAFE_INTEGER;
      const bOrder =
        activityOrderMap.byId.get(b.activityId) ??
        activityOrderMap.byId.get(rootActivityId(b.activityId)) ??
        activityOrderMap.byComposite.get(bComposite) ??
        Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.floor.localeCompare(b.floor, 'pt-BR') || a.activityName.localeCompare(b.activityName, 'pt-BR');
    });
  }, [weeklyTasks, planningSearch, planningTeamFilter, planningStatusFilter, activityOrderMap]);

  const filteredGiantPlanningTasks = useMemo(() => {
    let list = [...planning];
    if (giantSearch) {
      list = list.filter(t =>
        t.activityName.toLowerCase().includes(giantSearch.toLowerCase()) ||
        t.floor.toLowerCase().includes(giantSearch.toLowerCase()) ||
        (t.sectionId || '').toLowerCase().includes(giantSearch.toLowerCase()) ||
        (t.responsible || '').toLowerCase().includes(giantSearch.toLowerCase()) ||
        (t.observations || '').toLowerCase().includes(giantSearch.toLowerCase())
      );
    }
    if (giantFloorFilter) {
      list = list.filter(t => t.floor === giantFloorFilter);
    }
    if (giantMacroFilter) {
      list = list.filter(t => slugify(t.sectionId) === slugify(giantMacroFilter));
    }
    if (giantStatusFilter) {
      if (giantStatusFilter === 'finalized') list = list.filter(t => t.finalized);
      else if (giantStatusFilter === 'active') list = list.filter(t => !t.finalized);
    }
    return list;
  }, [planning, giantSearch, giantFloorFilter, giantMacroFilter, giantStatusFilter]);

  // Apontamento de Campo
  const handleAcceptPreFill = (taskId: string) => {
    setPlanning(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          progressThisWeek: t.preFilledProgress ?? t.progressThisWeek,
          delayReason: t.preFilledDelayReason ?? t.delayReason,
          observations: t.preFilledObservations 
            ? t.observations 
              ? `${t.observations} | Sugerido: ${t.preFilledObservations}` 
              : t.preFilledObservations
            : t.observations,
          preFilledProgress: undefined,
          preFilledDelayReason: undefined,
          preFilledObservations: undefined,
          preFilledAt: undefined
        };
      }
      return t;
    }));
  };

  // Funções de Update locais
  const handleUpdateTaskField = (taskId: string, field: string, val: any) => {
    setPlanning(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, [field]: val, lastUpdatedBy: 'Sistema' };
      }
      return t;
    }));
  };

  const handlePlannedChange = (taskId: string, val: number) => {
    setPlanning(prev => prev.map(t => {
      if (t.id === taskId) {
        const plannedVal = t.plannedThisWeek === val ? 0 : val;
        return { ...t, plannedThisWeek: plannedVal, lastUpdatedBy: 'Sistema' };
      }
      return t;
    }));
  };

  const handleWeeklyProgressChange = (taskId: string, val: number) => {
    setPlanning(prev => prev.map(t => {
      if (t.id === taskId) {
        const progVal = t.progressThisWeek === val ? 0 : val;
        const carryReason = progVal >= (t.plannedThisWeek ?? 100) ? '' : t.delayReason;
        return { ...t, progressThisWeek: progVal, delayReason: carryReason, lastUpdatedBy: 'Sistema' };
      }
      return t;
    }));
  };

  const handleDailyWorkChange = (taskId: string, newDW: number[]) => {
    setPlanning(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, dailyWork: newDW, lastUpdatedBy: 'Sistema' };
      }
      return t;
    }));
  };

  const handleBulkDelete = () => {
    if (selectedTaskIds.length === 0) return;
    setConfirmDialog({
      isOpen: true,
      title: 'Remover Atividades',
      message: `Deseja realmente remover as ${selectedTaskIds.length} atividades selecionadas desta semana?`,
      onConfirm: () => {
        setPlanning(prev => prev.filter(t => !selectedTaskIds.includes(t.id)));
        setSelectedTaskIds([]);
        setNotification({ message: 'Atividades removidas com sucesso!', type: 'success' });
      }
    });
  };

  // Adicionar Atividades
  const handleIncludeDrawerActivities = () => {
    if (drawerSourceMode !== 'unfinished' && (!drawerMacro || drawerFloors.length === 0)) {
      setNotification({ message: 'Selecione a macroatividade, os pavimentos e pelo menos um servico.', type: 'error' });
      return;
    }
    if (drawerSelectedServices.length === 0) {
      setNotification({ message: 'Selecione pelo menos um servico.', type: 'error' });
      return;
    }

    const newItems: ShortTermWeeklyItem[] = [];
    const duplicates: string[] = [];

    drawerSelectedServices.forEach(serviceId => {
      const match = drawerCandidateActivities.find(item => item.id === serviceId);
      if (!match) return;

      const alreadyPlanned = weeklyTasks.some(p => p.activityId === match.id && p.floor === match.floor && !p.finalized);
      if (alreadyPlanned) {
        duplicates.push(`${match.service} (${match.floor})`);
        return;
      }

      const executedBefore = roundDown25(match.progress || 0);
      const uniqueId = slugify(`${match.id}_${currentWeekId}_${drawerResponsible || match.responsible || 'sem-equipe'}`);

      newItems.push({
        id: uniqueId,
        weekId: currentWeekId,
        activityId: match.id,
        activityName: match.service,
        floor: match.floor,
        sectionId: match.macro,
        responsible: drawerResponsible || match.responsible || '',
        efetivo: null,
        plannedThisWeek: Math.max(25, 100 - executedBefore),
        progressThisWeek: 0,
        executedBefore,
        executedBeforeRaw: roundPercentValue(match.progress || 0),
        dailyWork: [0, 0, 0, 0, 0],
        delayReason: '',
        observations: '',
        finalized: false,
        isManual: false,
        isParent: match.isParent,
        finishDate: match.endDate,
        predecessors: match.predecessors ?? [],
        successors: match.successors ?? [],
        originalId: match.originalId,
        replicationGroup: match.replicationGroup
      });
    });

    if (duplicates.length > 0) {
      setDrawerWarning(`Ja incluidas nesta semana: ${duplicates.join('; ')}`);
    } else {
      setDrawerWarning('');
    }

    if (newItems.length > 0) {
      setPlanning(prev => [...prev, ...newItems]);
      setNotification({ message: `${newItems.length} atividades adicionadas!`, type: 'success' });
      if (duplicates.length === 0) {
        setDrawerSelectedServices([]);
        setIsDrawerOpen(false);
      }
    }
  };

  const handleAddTasksFromDrawer = (tasksList: Array<{ id: string; serviceName?: string; lot?: string; packageName?: string }>, teamName: string) => {
    const previousSelection = drawerSelectedServices;
    const previousResponsible = drawerResponsible;
    setDrawerSelectedServices(tasksList.map(item => item.id));
    setDrawerResponsible(teamName);
    window.setTimeout(() => {
      handleIncludeDrawerActivities();
      setDrawerSelectedServices(previousSelection);
      setDrawerResponsible(previousResponsible);
    }, 0);
  };

  const handleAddManualTask = () => {
    if (!extraActivityName.trim() || !extraActivityFloor.trim() || !extraActivityMacro.trim()) {
      setDrawerWarning('Preencha a atividade, o pavimento e o pacote.');
      return;
    }
    const weekId = toLocalDateString(currentWeekStart);
    const uniqueId = slugify(`manual_${slugify(extraActivityName)}_${weekId}_${extraActivityTeam || 'extra'}`);

    if (planning.some(p => p.id === uniqueId)) {
      setDrawerWarning('Esta atividade já foi planejada nesta semana.');
      return;
    }

    const newItem: ShortTermWeeklyItem = {
      id: uniqueId,
      weekId,
      activityId: `manual_${slugify(extraActivityName)}`,
      activityName: extraActivityName.trim().toUpperCase(),
      floor: extraActivityFloor.trim().toUpperCase(),
      sectionId: extraActivityMacro.trim().toUpperCase(),
      responsible: extraActivityTeam,
      efetivo: null,
      plannedThisWeek: 100,
      progressThisWeek: 0,
      executedBefore: 0,
      dailyWork: [0, 0, 0, 0, 0],
      delayReason: '',
      observations: '',
      finalized: false,
      isManual: true
    };

    setPlanning(prev => [...prev, newItem]);
    setExtraActivityName('');
    setExtraActivityFloor('');
    setExtraActivityMacro('');
    setExtraActivityTeam('');
    setDrawerWarning('');
    setIsDrawerOpen(false);
    setNotification({ message: 'Atividade extra programada!', type: 'success' });
  };

  // Matrizes Customizadas
  const handleCreateMatrix = () => {
    const newM = {
      id: `matrix_${Date.now()}`,
      name: `PAINEL VISUAL ${matrices.length + 1}`,
      macros: allPossibleMacros.slice(0, 4),
      floors: floors.slice(0, 4)
    };
    setMatrices(prev => [...prev, newM]);
  };

  const handleDeleteMatrix = (matrixId: string) => {
    setMatrices(prev => prev.filter(m => m.id !== matrixId));
  };

  const removeMatrixColumn = (matrixId: string, macroId: string) => {
    setMatrices(prev => prev.map(m => m.id === matrixId ? { ...m, macros: m.macros.filter((x: string) => x !== macroId) } : m));
  };

  const removeMatrixRow = (matrixId: string, floorId: string) => {
    setMatrices(prev => prev.map(m => m.id === matrixId ? { ...m, floors: m.floors.filter((x: string) => x !== floorId) } : m));
  };

  // Drag and drop do visualizador matricial
  const dragItem = useRef<{ matrixId: string; index: number } | null>(null);

  const handleDragColStart = (e: React.DragEvent, matrixId: string, index: number) => {
    dragItem.current = { matrixId, index };
  };

  const handleDropCol = (e: React.DragEvent, matrixId: string, targetIdx: number) => {
    if (!dragItem.current || dragItem.current.matrixId !== matrixId) return;
    const sourceIdx = dragItem.current.index;
    if (sourceIdx === targetIdx) return;
    setMatrices(prev => prev.map(m => {
      if (m.id === matrixId) {
        const next = [...m.macros];
        const [moved] = next.splice(sourceIdx, 1);
        next.splice(targetIdx, 0, moved);
        return { ...m, macros: next };
      }
      return m;
    }));
    dragItem.current = null;
  };

  const handleDragRowStart = (e: React.DragEvent, matrixId: string, index: number) => {
    dragItem.current = { matrixId, index };
  };

  const handleDropRow = (e: React.DragEvent, matrixId: string, targetIdx: number) => {
    if (!dragItem.current || dragItem.current.matrixId !== matrixId) return;
    const sourceIdx = dragItem.current.index;
    if (sourceIdx === targetIdx) return;
    setMatrices(prev => prev.map(m => {
      if (m.id === matrixId) {
        const next = [...m.floors];
        const [moved] = next.splice(sourceIdx, 1);
        next.splice(targetIdx, 0, moved);
        return { ...m, floors: next };
      }
      return m;
    }));
    dragItem.current = null;
  };

  const getPackageProgress = (floorName: string, macroName: string, itemsList: any[]) => {
    const filtered = itemsList.filter(it => it.floor === floorName && slugify(it.macro) === slugify(macroName));
    if (filtered.length === 0) return 0;
    const total = filtered.reduce((acc, it) => acc + (it.progress || 0), 0);
    return total / filtered.length;
  };

  const [tooltipState, setTooltipState] = useState<{ isOpen: boolean; x: number; y: number; content: string }>({ isOpen: false, x: 0, y: 0, content: '' });

  // Exportar CSV
  const handleExportCSV = () => {
    const listToExport = filteredGiantPlanningTasks;
    if (listToExport.length === 0) return;
    const headers = ['Semana ID', 'Pavimento', 'Macroatividade', 'Serviço', 'Equipe', 'Meta Planejada (%)', 'Progresso da Semana (%)', 'Progresso Acumulado (%)', 'Desvio/Atraso', 'Observações', 'Estado'];
    const rows = listToExport.map(t => {
      const executedB = Number(t?.executedBefore) || 0;
      const progressW = Number(t?.progressThisWeek) || 0;
      const totalAcc = Math.min(100, executedB + progressW);
      return [
        t.weekId,
        t.floor,
        t.sectionId,
        t.activityName,
        t.responsible || 'Sem alocação',
        `${t.plannedThisWeek}%`,
        `${t.progressThisWeek}%`,
        `${totalAcc}%`,
        t.progressThisWeek < t.plannedThisWeek ? t.delayReason || 'Sem motivo' : 'Conforme',
        t.observations || '',
        t.finalized ? 'Finalizado' : 'Ativo'
      ];
    });

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${val.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `PPC_Consolidado_Projeto_${projectId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Enviar WhatsApp
  const handleSendWhatsAppLegacy = (teamName: string) => {
    const phone = teamPhones[teamName] || '';
    if (!phone) {
      alert(`Cadastre o telefone da equipe ${teamName} nas configurações primeiro.`);
      return;
    }
    const weekId = toLocalDateString(currentWeekStart);
    const shareUrl = `${window.location.origin}${window.location.pathname}?mode=team&u=${projectId}&t=${encodeURIComponent(teamName)}&w=${weekId}`;

    const text = `Olá, equipe da *${teamName}*! 🚀\nSua lista de tarefas para a semana de *${formatDateBR(currentWeekStart)}*:\n\n` +
      weeklyTasks.filter(t => t.responsible === teamName).map((t, idx) => {
        return `${idx + 1}. *${t.activityName}* (${t.floor}) - Meta: *${t.plannedThisWeek}%*`;
      }).join('\n') +
      `\n\nPor favor, aponte seu avanço diário pelo celular:\n👉 ${shareUrl}`;

    window.open(`https://api.whatsapp.com/send?phone=${phone.replace(/\D/g, '')}&text=${encodeURIComponent(text)}`);
  };

  // Impressão
  const getWhatsappAvailableTeams = () => {
    const weekTeamNames = new Set(
      weeklyTasks
        .filter(t => t.responsible && !t.finalized)
        .map(t => String(t.responsible).trim())
        .filter(Boolean)
    );
    return teams.filter(team => weekTeamNames.has(String(team).trim()));
  };

  const generateWhatsappMessage = (teamName: string): string => {
    const weekId = toLocalDateString(currentWeekStart);
    const weekEndDate = addDays(currentWeekStart, 4);
    const shareUrl = `${window.location.origin}${window.location.pathname}?mode=team&u=${projectId}&t=${encodeURIComponent(teamName)}&w=${weekId}`;
    const teamTasks = weeklyTasks.filter(t => t.responsible === teamName && !t.finalized);
    const taskLines = teamTasks.length
      ? teamTasks.map(t => `- ${getSimpleServiceInstruction(t)}.`).join('\n')
      : 'Sem servicos planejados para esta semana.';

    return `Oi, equipe ${teamName}!\n\nServicos da semana (${formatDateBR(currentWeekStart)} a ${formatDateBR(weekEndDate)}):\n${taskLines}\n\nApontamento de campo: ${shareUrl}`;
  };

  const openWhatsappShareModal = () => {
    const availableTeams = getWhatsappAvailableTeams();
    if (availableTeams.length === 0) {
      setNotification({ message: 'Nenhuma equipe com atividades planejadas nesta semana.', type: 'error' });
      return;
    }
    const initialTeam = availableTeams[0];
    setWhatsappModal({ isOpen: true, teamName: initialTeam, text: generateWhatsappMessage(initialTeam) });
  };

  const handleSendWhatsApp = () => {
    const phone = teamPhones[whatsappModal.teamName] || '';
    const cleanPhone = phone.replace(/[^\d+]/g, '');
    const phoneParam = cleanPhone ? `phone=${cleanPhone}&` : '';
    window.open(`https://api.whatsapp.com/send?${phoneParam}text=${encodeURIComponent(whatsappModal.text)}`, '_blank');
    setWhatsappModal(prev => ({ ...prev, isOpen: false }));
  };

  const handlePrintPlanning = () => {
    const weekEndDate = addDays(currentWeekStart, 4);
    const dateRange = `${formatDateBR(currentWeekStart)} a ${formatDateBR(weekEndDate)}`;
    const tasksToPrint = filteredWeeklyTasks.length > 0 ? filteredWeeklyTasks : weeklyTasks;
    const dayLabels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
    const dayDates = [0, 1, 2, 3, 4].map(i => formatDateBR(addDays(currentWeekStart, i)).slice(0, 5));
    const dayWeathers = [0, 1, 2, 3, 4].map(i => {
      const dayDate = addDays(currentWeekStart, i);
      const dayStr = toISODate(dayDate);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const diffDays = Math.round((dayDate.getTime() - todayStart.getTime()) / 86400000);
      const weather = diffDays >= -15 && diffDays <= 15 ? weatherCache[`${projectCity.trim().toLowerCase()}_${dayStr}`] : null;
      return weather ? getWeatherEmoji(weather.icon) : '';
    });
    const rows = tasksToPrint.map(t => ({
      activityName: t.activityName || '',
      serviceInstruction: getSimpleServiceInstruction(t),
      serviceComplement: t.serviceComplement || '',
      floor: t.floor || '',
      sectionId: t.sectionId || '',
      responsible: t.responsible || '',
      efetivo: t.efetivo ?? '',
      executedBefore: roundPercentValue(t.executedBeforeRaw ?? t.executedBefore ?? 0),
      plannedThisWeek: t.plannedThisWeek ?? 100,
      progressThisWeek: t.progressThisWeek ?? 0,
      dailyWork: Array.isArray(t.dailyWork) ? t.dailyWork : [0, 0, 0, 0, 0],
      delayReason: t.delayReason || '',
      observations: t.observations || '',
      finalized: !!t.finalized,
      isManual: !!t.isManual
    }));
    const safeJson = (value: unknown) => (JSON.stringify(value) || 'null').replace(/</g, '\\u003c');
    const teamOptions = Array.from(new Set(rows.map(r => r.responsible).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Impressao - Planejamento Semanal</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#1e293b;background:#f8fafc}
@media print{body{background:#fff;font-size:9px}.no-print{display:none!important}.print-page{padding:8px 10px}thead th{background:#1e293b!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}tr.finalized td{background:#f1f5f9!important;color:#94a3b8!important}tr.delayed td{background:#fff1f2!important}tr.ok td{background:#f0fdf4!important}.badge,.day-chip.worked{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.print-page{max-width:1400px;margin:0 auto;padding:16px}.toolbar{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin-bottom:12px;display:flex;flex-wrap:wrap;align-items:center;gap:10px;box-shadow:0 1px 4px rgba(0,0,0,.07)}.toolbar-title{font-size:12px;font-weight:900;color:#1e293b;flex:1 0 100%;margin-bottom:4px}.col-toggles{display:flex;flex-wrap:wrap;gap:6px;flex:1}.col-toggle{display:flex;align-items:center;gap:4px;cursor:pointer;user-select:none;font-size:10.5px;font-weight:700;color:#475569;padding:3px 9px;border-radius:6px;border:1.5px solid #e2e8f0;background:#f8fafc}.col-toggle input{accent-color:#4f46e5}.col-toggle:has(input:checked){background:#eef2ff;border-color:#a5b4fc;color:#3730a3}.toolbar-actions{display:flex;gap:8px;margin-left:auto}.btn-print{padding:8px 20px;background:#1e293b;color:#fff;border:none;border-radius:8px;font-size:11px;font-weight:900;cursor:pointer}.btn-print:hover{background:#334155}.print-control{display:flex;align-items:center;gap:6px;background:#f8fafc;padding:3px 9px;border-radius:6px;border:1.5px solid #e2e8f0}.print-control-label{font-size:10px;font-weight:900;color:#475569;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}.print-input,.print-select{padding:2px 6px;border:1px solid #cbd5e1;border-radius:4px;font-size:10.5px;color:#1e293b;font-family:inherit;outline:none;background:#fff}.page-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid #1e293b}.page-header h1{font-size:14px;font-weight:900;color:#1e293b;text-transform:uppercase;letter-spacing:.05em}.page-header p{font-size:10px;color:#64748b;margin-top:2px;font-weight:600}.meta{text-align:right;font-size:9px;color:#64748b;font-weight:700}
table{width:100%;border-collapse:collapse;border:1px solid #cbd5e1;background:#fff}thead th{background:#1e293b;color:#fff;padding:6px 8px;text-align:left;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.05em;white-space:normal;vertical-align:bottom;border-right:1px solid #334155;cursor:pointer;user-select:none}thead th:hover,thead th.sorted{background:#312e81}tbody tr{border-bottom:1px solid #e2e8f0}tbody tr:nth-child(even) td{background:#fafafa}tbody tr.finalized td{background:#f8fafc!important;color:#94a3b8}tbody tr.delayed td{background:#fff7f7!important}tbody tr.ok td{background:#f0fdf4!important}td{padding:5px 8px;vertical-align:middle;border-right:1px solid #e2e8f0;font-size:10px}.act-name{font-weight:800;text-transform:uppercase;font-size:10px;line-height:1.3}.act-comp{font-size:8px;color:#64748b;margin-top:1px}.floor-cell{font-size:9px;font-weight:800;color:#4f46e5;text-transform:uppercase;white-space:normal;word-break:break-word}.badge{display:inline-block;padding:2px 6px;border-radius:999px;font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}.badge-green{background:#dcfce7;color:#15803d}.badge-red{background:#fee2e2;color:#b91c1c}.badge-blue{background:#dbeafe;color:#1d4ed8}.badge-gray{background:#f1f5f9;color:#475569}.badge-amber{background:#fef3c7;color:#b45309}.days-cell{display:flex;gap:3px;justify-content:center;flex-wrap:nowrap}.day-chip{display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:9px;font-weight:900;padding:3px 4px;border-radius:4px;min-width:36px;height:36px}.day-chip span:last-child{font-size:7px;font-weight:700;margin-top:1px}.day-chip.worked{background:#1e293b;color:#fff}.day-chip.off{background:#f1f5f9;color:#94a3b8}.empty-row td{text-align:center;color:#94a3b8;font-style:italic;padding:20px}.cn,.cb,.cp,.cpr,.cst,.ce{width:1%}tbody td.cn,tbody td.cb,tbody td.cp,tbody td.cpr,tbody td.cst,tbody td.ce{white-space:nowrap}.cs{min-width:200px;white-space:normal!important;word-break:break-word!important}.cf{width:140px}.ct{width:100px}.cd{width:220px}.cdr,.co{width:150px;white-space:normal!important;word-break:break-word!important}
</style>
</head>
<body>
<div class="print-page">
  <div class="toolbar no-print">
    <div class="toolbar-title">Configurar Impressao - selecione colunas, equipe e texto do servico:</div>
    <div class="col-toggles">
      <label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('cn',this.checked)"> #</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('cs',this.checked)"> Servico</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('cf',this.checked)"> Pavimento</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('ct',this.checked)"> Equipe</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('ce',this.checked)"> Efetivo</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('cb',this.checked)"> % Anterior</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('cp',this.checked)"> Meta</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('cd',this.checked)"> Dias</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('cpr',this.checked)"> Progresso</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('cdr',this.checked)"> Motivo</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('co',this.checked)"> Observacoes</label><label class="col-toggle"><input type="checkbox" checked onchange="toggleCol('cst',this.checked)"> Status</label>
    </div>
    <div class="print-control"><span class="print-control-label">Equipe:</span><select class="print-select" id="teamFilter" onchange="rt()"><option value="">Todas</option>${teamOptions.map(team => `<option value="${String(team).replace(/"/g, '&quot;')}">${team}</option>`).join('')}</select></div>
    <div class="print-control"><span class="print-control-label">Busca:</span><input class="print-input" type="text" id="searchFilter" placeholder="Buscar..." oninput="rt()" /></div>
    <div class="print-control"><span class="print-control-label">Texto:</span><select class="print-select" id="serviceTextMode" onchange="rt()"><option value="default">Servico + pavimento + meta</option><option value="whatsapp">Texto do WhatsApp</option></select></div>
    <div class="toolbar-actions"><button class="btn-print" onclick="window.print()">Imprimir / Salvar PDF</button></div>
  </div>
  <div class="page-header"><div><h1>${projectId}</h1><p>Planejamento Semanal &middot; ${dateRange} &middot; <span id="activity-count">${rows.length}</span> atividade(s)</p></div><div class="meta">Gerado em:<br/>${new Date().toLocaleString('pt-BR')}</div></div>
  <table id="pt"><thead><tr><th class="cn" onclick="st('num')">#</th><th class="cs" onclick="st('activityName')">Servico</th><th class="cf" onclick="st('floor')">Pavimento</th><th class="ct" onclick="st('responsible')">Equipe</th><th class="ce" onclick="st('efetivo')" style="text-align:center">Efetivo</th><th class="cb" onclick="st('executedBefore')" style="text-align:center">% Anterior</th><th class="cp" onclick="st('plannedThisWeek')" style="text-align:center">Meta</th><th class="cd">${[0,1,2,3,4].map(i => `<div style="display:inline-flex;flex-direction:column;align-items:center;min-width:36px;font-size:8px;font-weight:900"><span style="height:10px">${dayWeathers[i] || '&nbsp;'}</span><span>${dayLabels[i].charAt(0)}</span><span style="color:#94a3b8;font-size:6.5px">${dayDates[i]}</span></div>`).join('')}</th><th class="cpr" onclick="st('progressThisWeek')" style="text-align:center">Progresso</th><th class="cdr" onclick="st('delayReason')">Motivo</th><th class="co">Observacoes</th><th class="cst" onclick="st('status')" style="text-align:center">Status</th></tr></thead><tbody id="pb"></tbody></table>
  <div class="no-print" style="margin-top:8px;color:#94a3b8;font-size:10px;font-style:italic">Clique no cabecalho de qualquer coluna para ordenar.</div>
</div>
<script>
var allRows=${safeJson(rows)};var DL=${safeJson(dayLabels)};var DD=${safeJson(dayDates)};var sk=null,sd='asc',hiddenCols={};
function esc(s){return String(s||'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];});}
function gso(t){if(t.finalized)return 3;var p=t.progressThisWeek,pl=t.plannedThisWeek;if(p>=pl&&pl>0)return 0;if(p<pl&&pl>0&&p>0)return 1;return 2;}
function sv(t,k){if(k==='num')return 0;if(k==='status')return gso(t);var v=t[k];return typeof v==='number'?v:(v||'').toString().toLowerCase();}
function st(k){if(sk===k){sd=sd==='asc'?'desc':'asc';}else{sk=k;sd='asc';}rt();}
function rt(){var team=document.getElementById('teamFilter').value;var q=document.getElementById('searchFilter').value.toLowerCase().trim();var mode=document.getElementById('serviceTextMode').value;var rows=allRows.slice();if(team)rows=rows.filter(function(t){return (t.responsible||'')===team;});if(q)rows=rows.filter(function(t){return [t.activityName,t.serviceInstruction,t.floor,t.sectionId,t.responsible,t.observations].join(' ').toLowerCase().indexOf(q)!==-1;});if(sk){rows.sort(function(a,b){var va=sv(a,sk),vb=sv(b,sk);if(va<vb)return sd==='asc'?-1:1;if(va>vb)return sd==='asc'?1:-1;return 0;});}document.getElementById('activity-count').textContent=rows.length;var tb=document.getElementById('pb');if(!rows.length){tb.innerHTML='<tr class="empty-row"><td colspan="12">Nenhuma atividade encontrada com o filtro aplicado.</td></tr>';return;}tb.innerHTML=rows.map(function(t,i){var prog=t.progressThisWeek,planned=t.plannedThisWeek;var isOk=prog>=planned&&planned>0,isDel=prog<planned&&planned>0;var rc=t.finalized?'finalized':isOk?'ok':isDel?'delayed':'';var pb=prog===0?'<span class="badge badge-gray">0%</span>':isOk?'<span class="badge badge-green">'+prog+'%</span>':'<span class="badge badge-red">'+prog+'%</span>';var pl='<span class="badge badge-blue">'+planned+'%</span>';var before=t.executedBefore>0?'<span class="badge badge-gray">'+t.executedBefore+'%</span>':'<span style="color:#94a3b8">-</span>';var dh='<div class="days-cell">'+t.dailyWork.map(function(w,idx){return '<div class="day-chip '+(w?'worked':'off')+'"><span>'+DL[idx].charAt(0)+'</span><span>'+DD[idx]+'</span></div>';}).join('')+'</div>';var stt=t.finalized?'<span class="badge badge-gray">Finalizado</span>':isOk?'<span class="badge badge-green">Conforme</span>':isDel?'<span class="badge badge-red">Atrasado</span>':'<span class="badge badge-gray">Pendente</span>';var comp=t.serviceComplement?'<div class="act-comp">'+esc(t.serviceComplement)+'</div>':'';var extra=t.isManual?' <span class="badge badge-amber">Extra</span>':'';var serviceText=mode==='whatsapp'?t.serviceInstruction:(t.activityName+' - '+(t.floor||'-')+' - meta '+planned+'%');return '<tr class="'+rc+'"><td class="cn" style="color:#94a3b8;font-weight:900;text-align:center">'+(i+1)+'</td><td class="cs"><div class="act-name">'+esc(serviceText)+extra+'</div>'+comp+'</td><td class="cf"><span class="floor-cell">'+esc(t.floor||'-')+'</span></td><td class="ct" style="font-weight:700;white-space:nowrap">'+esc(t.responsible||'-')+'</td><td class="ce" style="text-align:center;font-weight:700">'+esc(t.efetivo!==''?t.efetivo:'-')+'</td><td class="cb" style="text-align:center">'+before+'</td><td class="cp" style="text-align:center">'+pl+'</td><td class="cd">'+dh+'</td><td class="cpr" style="text-align:center">'+pb+'</td><td class="cdr" style="font-size:9px;color:#b91c1c">'+(esc(t.delayReason)||'<span style="color:#94a3b8">-</span>')+'</td><td class="co" style="font-size:9px;color:#475569">'+(esc(t.observations)||'<span style="color:#94a3b8">-</span>')+'</td><td class="cst" style="text-align:center">'+stt+'</td></tr>';}).join('');Object.keys(hiddenCols).forEach(function(c){if(hiddenCols[c])document.querySelectorAll('tbody .'+c).forEach(function(e){e.style.display='none';});});}
function toggleCol(c,v){hiddenCols[c]=!v;document.querySelectorAll('.'+c).forEach(function(e){e.style.display=v?'':'none';});}
rt();
</script>
</body>
</html>`;

    const newWindow = window.open('', '_blank');
    if (!newWindow) return;
    newWindow.document.write(htmlContent);
    newWindow.document.close();
  };

  const handlePrintPlanningLegacy = () => {
    const weekId = toLocalDateString(currentWeekStart);
    const dataRows = weeklyTasks;
    const teamOptions = Array.from(new Set(dataRows.map(t => t.responsible || 'Sem alocação'))).sort();
    const newWindow = window.open('', '_blank');
    if (!newWindow) return;

    newWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Planejamento Semanal - ${projectId}</title>
        <meta charset="utf-8">
        <style>
          body { font-family: Inter, system-ui, sans-serif; background: #fff; color: #1e293b; margin: 20px; font-size: 11px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e2e8f0; pb: 10px; margin-bottom: 20px; }
          h1 { margin: 0; font-size: 16px; font-weight: 800; color: #1e1b4b; text-transform: uppercase; }
          h2 { margin: 5px 0 0; font-size: 11px; font-weight: 700; color: #4f46e5; text-transform: uppercase; }
          .controls { display: flex; gap: 15px; background: #f8fafc; padding: 12px 20px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 20px; align-items: center; }
          .controls label { font-weight: 800; font-size: 9px; text-transform: uppercase; color: #64748b; }
          .controls select, .controls input { font-size: 11px; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-weight: 700; outline: none; }
          table { w: 100%; border-collapse: collapse; border-spacing: 0; margin-bottom: 30px; }
          th { background: #1e293b; color: #fff; font-weight: 800; text-transform: uppercase; font-size: 9px; padding: 8px 10px; border: 1px solid #475569; text-align: left; }
          td { padding: 8px 10px; border: 1px solid #e2e8f0; font-weight: 500; }
          .font-bold { font-weight: 700; }
          .badge { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 5px; font-size: 8px; font-weight: 800; text-transform: uppercase; }
          .btn-print { background: #4f46e5; color: #fff; border: 0; padding: 8px 16px; font-weight: 800; font-size: 10px; text-transform: uppercase; border-radius: 8px; cursor: pointer; }
          @media print {
            .no-print { display: none !important; }
            body { margin: 0; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>Planejamento Físico Semanal</h1>
            <h2>${formatWeekId(weekId)}</h2>
          </div>
          <button class="btn-print no-print" onclick="window.print()">🖨️ Imprimir</button>
        </div>

        <div class="controls no-print">
          <div>
            <label>Filtrar por Equipe:</label>
            <select id="teamSelect" onchange="filterTable()">
              <option value="">-- Todas as Equipes --</option>
              ${teamOptions.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Busca:</label>
            <input type="text" id="searchInput" placeholder="Filtrar..." oninput="filterTable()" />
          </div>
        </div>

        <table id="planningTable">
          <thead>
            <tr>
              <th>Macroatividade</th>
              <th>Pavimento</th>
              <th>Serviço / Atividade</th>
              <th>Responsável / Equipe</th>
              <th style="text-align:center">Meta Planejada</th>
              <th style="text-align:center">Efetivo</th>
              <th>Observações</th>
            </tr>
          </thead>
          <tbody>
            ${dataRows.map(t => `
              <tr class="table-row" data-team="${t.responsible || 'Sem alocação'}" data-text="${t.activityName.toLowerCase()} ${t.floor.toLowerCase()} ${t.sectionId.toLowerCase()}">
                <td class="font-bold">${t.sectionId}</td>
                <td>${t.floor}</td>
                <td class="font-bold">${t.activityName} ${t.serviceComplement ? `<span class="badge">↳ ${t.serviceComplement}</span>` : ''}</td>
                <td class="font-bold">${t.responsible || 'Sem alocação'}</td>
                <td style="text-align:center" class="font-bold">${t.plannedThisWeek}%</td>
                <td style="text-align:center">${t.efetivo || '-'}</td>
                <td>${t.observations || ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <script>
          function filterTable() {
            const team = document.getElementById('teamSelect').value;
            const query = document.getElementById('searchInput').value.toLowerCase();
            const rows = document.querySelectorAll('.table-row');
            rows.forEach(row => {
              const rowTeam = row.getAttribute('data-team');
              const text = row.getAttribute('data-text');
              const matchesTeam = !team || rowTeam === team;
              const matchesQuery = !query || text.includes(query);
              row.style.display = (matchesTeam && matchesQuery) ? '' : 'none';
            });
          }
        </script>
      </body>
      </html>
    `);
    newWindow.document.close();
  };

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 3000);
    return () => clearTimeout(timer);
  }, [notification]);

  // --- RENDERIZADOR PRINCIPAL DO CURTO PRAZO ---
  const tabLabels: Array<[string, string]> = [
    ['dashboard', 'Painel'],
    ['planning', 'Planejamento semanal'],
    ['matrix', 'Matriz geral'],
    ['ppc', 'Detalhamento PPC'],
    ['history', 'Histórico andamento'],
    ['config', 'Configurações']
  ];

  return (
    <section className="page short-term font-sans text-slate-900 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-200 pb-4 mb-5 gap-3 no-print">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Planejamento de Curto Prazo</h1>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase">Obra Ativa:</span>
            <span className="text-[10px] font-black text-indigo-700 uppercase bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md flex items-center gap-1">
              🏢 {projectId}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1.5 text-[9px] font-black uppercase rounded-lg border transition ${
            syncStatus === 'saved' 
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800' 
              : syncStatus === 'saving' 
              ? 'bg-amber-50 border-amber-300 text-amber-800 animate-pulse'
              : syncStatus === 'pending'
              ? 'bg-indigo-50 border-indigo-300 text-indigo-800'
              : syncStatus === 'local'
              ? 'bg-slate-50 border-slate-300 text-slate-700'
              : 'bg-rose-50 border-rose-300 text-rose-800'
          }`}>
            {syncStatus === 'saved'
              ? 'Supabase sincronizado'
              : syncStatus === 'saving'
              ? 'Salvando...'
              : syncStatus === 'pending'
              ? 'Alteracoes pendentes'
              : syncStatus === 'local'
              ? 'Modo local'
              : 'Erro de sincronizacao'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <nav className="short-tabs short-tabs-compact no-print">
        {tabLabels.map(([value, label]) => (
          <button 
            key={value}
            className={activeTab === value ? 'active' : ''}
            onClick={() => setActiveTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Tab Contents */}
      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'planning' && renderPlanning()}
      {activeTab === 'matrix' && renderVisualization()}
      {activeTab === 'ppc' && renderDetalhamentoPpc()}
      {activeTab === 'history' && renderInfographic()}
      {activeTab === 'config' && renderConfig()}

      {/* Modais */}
      {finalizeModal?.isOpen && renderFinalizeWeekModal()}
      {whatsappModal.isOpen && renderWhatsAppModal()}
      {isDrawerOpen && renderDrawer()}

      {/* Diálogos Globais */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 animate-in slide-in-from-bottom-5 duration-300">
          <div className={`p-4 rounded-xl shadow-xl border text-xs font-black uppercase flex items-center gap-2 ${
            notification.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}>
            <span>{notification.type === 'success' ? '✓' : '⚠️'}</span>
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      {confirmDialog?.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-xl max-w-sm w-full space-y-4">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">{confirmDialog.title}</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-bold">{confirmDialog.message}</p>
            <div className="flex justify-end gap-2 text-[10px] font-black uppercase">
              <button onClick={() => setConfirmDialog(null)} className="px-4 py-2 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">Cancelar</button>
              <button 
                onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg cursor-pointer"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  // --- SUB-VIEWS DE ABAS ---

  function renderDashboard() {
    const overallActual = cronogramaInicial.length > 0
      ? cronogramaInicial.reduce((acc, c) => acc + (c.progress || 0), 0) / cronogramaInicial.length
      : 0;

    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <StatCard title="Avanço Físico Real" value={`${overallActual.toFixed(2)}%`} color="bg-emerald-600" />
          <StatCard title="Meta Semanal Ativa" value={`${weeklyTasks.length} Serviços`} color="bg-indigo-600" />
          <StatCard title="Média de PPC" value={ppcHistory.length > 0 ? `${(ppcHistory.reduce((a, b) => a + b.ppc, 0) / ppcHistory.length).toFixed(1)}%` : '0.0%'} color="bg-cyan-600" />
          <StatCard title="Equipes Registradas" value={`${teams.length} Grupos`} color="bg-slate-800" />
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-200 pb-4 gap-4">
            <div>
              <h2 className="text-base font-black text-slate-800 tracking-tight uppercase">Situação Geral do Planejamento</h2>
              <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-wider">Acompanhamento Semanal com análises e insights da IA</p>
            </div>
            <div className="flex items-center space-x-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
              <button onClick={() => setCurrentWeekStart(prev => addDays(prev, -7))} className="p-2 hover:bg-white rounded-lg shadow-xs transition text-slate-600">◀</button>
              <div className="text-center min-w-[160px]">
                <div className="text-[8px] uppercase font-black text-slate-400">Semana Ativa</div>
                <div className="text-xs font-black text-slate-700">
                  {formatDateBR(currentWeekStart)} - {formatDateBR(addDays(currentWeekStart, 4))}
                </div>
              </div>
              <button onClick={() => setCurrentWeekStart(prev => addDays(prev, 7))} className="p-2 hover:bg-white rounded-lg shadow-xs transition text-slate-600">▶</button>
            </div>
          </div>

          <div className="bg-slate-50/50 rounded-2xl border border-slate-200 overflow-hidden">
            <div className="p-4 flex justify-between items-center border-b border-slate-200 bg-white">
              <h3 className="text-xs font-black text-slate-800 tracking-tight uppercase">🧠 Análise Gerencial (AI Insight)</h3>
              {!aiLoading && (
                <button
                  onClick={handleAIAnalysis}
                  className="text-[9px] font-black uppercase text-indigo-700 hover:text-white bg-indigo-50 hover:bg-indigo-600 border border-indigo-200 hover:border-indigo-600 px-3 py-1.5 rounded-lg transition duration-200 shadow-xs active:scale-95 cursor-pointer"
                >
                  🔄 Gerar Análise
                </button>
              )}
            </div>

            <div className="p-5">
              {aiLoading ? (
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                  <div className="flex gap-1.5">
                    {[0,1,2].map(i => <div key={i} className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }}/>)}
                  </div>
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-wider">A processar insights com Gemini...</p>
                </div>
              ) : !aiAnalysis ? (
                <p className="text-slate-400 text-xs font-bold uppercase tracking-wider italic text-center py-6">
                  Clique no botão acima para gerar a análise em tempo real dos gargalos e desvios.
                </p>
              ) : (
                <div className="space-y-3 text-xs leading-relaxed text-slate-700 font-sans">
                  {aiAnalysis.split('\n').map((line, i) => {
                    if (!line.trim()) return <div key={i} className="h-1"/>;
                    if (line.startsWith('## ')) {
                      return (
                        <h4 key={i} className="text-slate-900 font-black text-xs uppercase tracking-wider mt-4 mb-1.5 flex items-center gap-2 border-b border-slate-200 pb-1">
                          {line.replace('## ', '')}
                        </h4>
                      );
                    }
                    if (line.startsWith('* ') || line.startsWith('- ')) {
                      return (
                        <div key={i} className="flex gap-2 text-slate-600 text-xs items-start font-medium">
                          <span className="text-indigo-500 mt-0.5 shrink-0 text-[10px]">■</span>
                          <span dangerouslySetInnerHTML={{ __html: line.replace(/^[-*]\s/, '').replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-900">$1</strong>') }}/>
                        </div>
                      );
                    }
                    return <p key={i} className="text-slate-600 text-xs" dangerouslySetInnerHTML={{ __html: line.replace(/\*\*(.*?)\*\*/g, '<strong class="text-slate-900">$1</strong>') }}/>;
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
            <h3 className="text-xs font-black uppercase text-indigo-900 tracking-wider mb-2">Evolução do PPC (%)</h3>
            <div className="relative flex-1 flex items-end gap-2 pb-6 px-2 min-h-[220px] mt-4">
              <div className="absolute left-0 right-0 bottom-6 top-0 pointer-events-none">
                <div className="absolute w-full border-t border-dashed border-emerald-400 z-0" style={{ bottom: '75%' }}>
                  <span className="absolute -top-4 left-0 text-[8px] font-black text-emerald-600 bg-white px-1 rounded">META 75%</span>
                </div>
              </div>
              {ppcChartData.length === 0 ? (
                <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs italic">Nenhum dado de PPC registrado.</div>
              ) : (
                ppcChartData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full z-10 group relative">
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-8 bg-slate-800 text-white text-[9px] px-2 py-1 rounded pointer-events-none whitespace-nowrap z-20 shadow-lg font-bold">
                      {d.ppc.toFixed(1)}% ({d.completed}/{d.totalPlanned})
                    </div>
                    <div 
                      className={`w-full max-w-[32px] rounded-t-md transition-all cursor-pointer ${
                        d.ppc >= 75 ? 'bg-indigo-500 hover:bg-indigo-400' : 'bg-rose-500 hover:bg-rose-400'
                      }`} 
                      style={{ height: `${Math.max(d.ppc, 4)}%` }}
                    ></div>
                    <span className="text-[8px] text-slate-500 mt-2 font-bold rotate-45 origin-top-left absolute -bottom-6 whitespace-nowrap">
                      {formatDateBR(d.weekStart).slice(0, 5)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
            <h3 className="text-xs font-black uppercase text-indigo-900 tracking-wider mb-2">Principais Causas de Atraso (Pareto)</h3>
            <div className="flex-1 flex flex-col justify-center mt-4">
              {delayStats.length === 0 ? (
                <div className="w-full flex items-center justify-center text-slate-400 text-xs italic h-full">Nenhum atraso com causa registrado.</div>
              ) : (
                <div className="space-y-4">
                  {delayStats.map((d, i) => (
                    <div key={i} className="relative">
                      <div className="flex justify-between text-[10px] font-bold mb-1">
                        <span className="text-slate-700 truncate uppercase" title={d.reason}>{d.reason}</span>
                        <span className="text-rose-600 font-black">{d.count} desvio(s) ({d.cumulativePercent.toFixed(0)}% acum.)</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                        <div className="bg-rose-500 h-full rounded-full transition-all" style={{ width: `${d.percent}%` }}></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderPlanning() {
    const weekId = toLocalDateString(currentWeekStart);

    return (
      <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-300 pb-12">
        <div className="bg-gradient-to-r from-indigo-900 to-slate-900 text-white p-6 rounded-3xl shadow-md flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="space-y-2">
            <span className="px-3 py-1 bg-indigo-800 text-[9px] font-black tracking-wider uppercase rounded-full text-indigo-300 border border-indigo-700">KPI Produtividade</span>
            <h2 className="text-lg font-black uppercase tracking-tight">PPC Semanal Ativo</h2>
            <p className="text-xs text-indigo-200">Percentual de Planos Concluídos ponderado de frentes ativas.</p>
          </div>
          <div className="bg-indigo-950/50 p-4 rounded-2xl border border-indigo-800 shadow-inner text-center shrink-0">
            <div className="text-4xl font-black text-emerald-400">{currentWeekPpcStats.percent.toFixed(1)}%</div>
            <div className="text-[9px] font-black text-indigo-300 uppercase tracking-wide mt-1">
              {currentWeekPpcStats.completedCount} de {currentWeekPpcStats.totalPlannedCount} Concluídos
            </div>
          </div>
        </div>

        <div className="bg-white p-4 rounded-3xl border border-slate-200">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-4">
            <div className="flex items-center space-x-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
              <button onClick={() => setCurrentWeekStart(prev => addDays(prev, -7))} className="p-2 hover:bg-white rounded-lg shadow-xs transition text-slate-600">◀</button>
              <div className="text-center min-w-[180px]">
                <div className="text-[8px] uppercase font-black text-slate-400">Semana Selecionada</div>
                <div className="text-xs font-black text-indigo-900">
                  {formatDateBR(currentWeekStart)} - {formatDateBR(addDays(currentWeekStart, 4))}
                </div>
              </div>
              <button onClick={() => setCurrentWeekStart(prev => addDays(prev, 7))} className="p-2 hover:bg-white rounded-lg shadow-xs transition text-slate-600">▶</button>
            </div>

            <div className="flex gap-2 w-full md:w-auto flex-wrap">
              {weeklyTasks.length > 0 && (
                <button onClick={handlePrintPlanning} className="short-action-button short-action-print flex-1 md:flex-none">
                  <span>🖨️</span> Impressão
                </button>
              )}
              {teams.length > 0 && weeklyTasks.length > 0 && (
                <button onClick={openWhatsappShareModal} className="short-action-button short-action-whatsapp flex-1 md:flex-none">
                  <span>💬</span> WhatsApp
                </button>
              )}
              <button 
                onClick={() => setFinalizeModal({ isOpen: true, carryOverUnfinished: true })}
                disabled={weeklyTasks.length === 0}
                className={`short-action-button flex-1 md:flex-none ${
                  weeklyTasks.length === 0
                    ? 'short-action-disabled'
                    : 'short-action-finalize'
                }`}
              >
                <span>🏁</span> Finalizar Semana
              </button>
              <button 
                onClick={() => {
                  setDrawerSourceMode('medium');
                  setDrawerMacro(drawerMacroOptions[0] || '');
                  setDrawerFloors([]);
                  setDrawerSelectedServices([]);
                  setDrawerResponsible('');
                  setDrawerWarning('');
                  setIsDrawerOpen(true);
                }}
                className="short-action-button short-action-add flex-1 md:flex-none"
              >
                <span>➕</span> Adicionar Atividades
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-600 mb-1">🔍 Pesquisa</label>
              <input type="text" className="w-full p-2 border border-slate-200 bg-white rounded-lg text-xs outline-none" placeholder="Serviço, pavimento, notas..." value={planningSearch} onChange={e => setPlanningSearch(e.target.value)} />
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-600 mb-1">Equipe Responsável</label>
              <select className="w-full p-2 border border-slate-200 bg-white rounded-lg text-xs font-bold outline-none" value={planningTeamFilter} onChange={e => setPlanningTeamFilter(e.target.value)}>
                <option value="">-- Todas --</option>
                {teams.map(team => <option key={team} value={team}>{team}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-600 mb-1">Estado de Progresso</label>
              <select className="w-full p-2 border border-slate-200 bg-white rounded-lg text-xs font-bold outline-none" value={planningStatusFilter} onChange={e => setPlanningStatusFilter(e.target.value)}>
                <option value="">-- Todos --</option>
                <option value="ok">✅ Conforme</option>
                <option value="delayed">⚠️ Com Atraso</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-800 text-white uppercase text-[8px] tracking-wider">
                <tr>
                  <th className="p-3 w-72">Serviço / Pavimento</th>
                  <th className="p-3 w-28 text-center">Equipe</th>
                  <th className="p-3 w-16 text-center">Efetivo</th>
                  <th className="p-3 text-center w-32 bg-slate-900">Meta Semanal</th>
                  <th className="p-3 text-center w-52 min-w-[210px]">Dias Ativos</th>
                  <th className="p-3 text-center w-32">Avanço Físico</th>
                  <th className="p-3 text-center w-28">Desvio / Atraso</th>
                  <th className="p-3 w-40">Observações</th>
                  <th className="p-2 text-center w-16 bg-slate-800">
                    <div className="flex items-center justify-center gap-1">
                      <input 
                        type="checkbox" 
                        checked={filteredWeeklyTasks.length > 0 && filteredWeeklyTasks.every(t => selectedTaskIds.includes(t.id))}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedTaskIds(prev => Array.from(new Set([...prev, ...filteredWeeklyTasks.map(t => t.id)])));
                          else setSelectedTaskIds(prev => prev.filter(id => !filteredWeeklyTasks.map(t => t.id).includes(id)));
                        }}
                        className="w-3 h-3 text-indigo-600 rounded cursor-pointer"
                      />
                      <button onClick={handleBulkDelete} disabled={selectedTaskIds.length === 0} className="text-red-400 hover:text-red-300 font-bold text-xs disabled:opacity-30">🗑️</button>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredWeeklyTasks.map(t => {
                  const currentPlan = t.plannedThisWeek ?? 100;
                  const progVal = t.progressThisWeek ?? 0;
                  const showDelayAlert = currentPlan > progVal;

                  return (
                    <tr key={t.id} className={`hover:bg-slate-50 transition ${t.finalized ? 'bg-slate-100/70 opacity-75' : showDelayAlert && (progVal > 0 || currentPlan > 0) ? 'bg-red-50/40' : ''}`}>
                      <td className="p-3 border-r font-bold text-slate-800 uppercase text-[10px]">
                        <div className="flex items-start gap-1">
                          {t.finalized && <span className="text-[10px] text-slate-400 mt-0.5">🔒</span>}
                          {t.isManual && <span className="px-1 py-0.5 bg-amber-100 text-amber-800 text-[7px] font-black rounded uppercase tracking-tighter shrink-0 mt-0.5">Extra</span>}
                          <div className="flex-1 leading-tight">{t.activityName}</div>
                          {!t.finalized && !t.serviceComplement && editingComplementTaskId !== t.id && (
                            <button onClick={(e) => { e.stopPropagation(); setEditingComplementTaskId(t.id); }} className="w-3.5 h-3.5 border border-slate-300 hover:border-indigo-600 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 flex items-center justify-center rounded-full font-bold text-[9px] cursor-pointer">+</button>
                          )}
                        </div>
                        {(t.serviceComplement || editingComplementTaskId === t.id) && (
                          <div className="flex items-center gap-1 mt-1 font-bold text-[9px]">
                            <span className="text-indigo-600 font-black">↳</span>
                            <input 
                              type="text" 
                              disabled={t.finalized}
                              placeholder="Complemento..." 
                              className="p-1 border border-slate-300 bg-slate-50 rounded text-[9px] font-bold text-slate-700 w-36 outline-none focus:bg-white focus:border-indigo-500"
                              value={t.serviceComplement || ''}
                              onChange={e => setPlanning(planning.map(p => p.id === t.id ? { ...p, serviceComplement: e.target.value } : p))}
                              onBlur={() => { if (!t.serviceComplement) setEditingComplementTaskId(null); }}
                              autoFocus={editingComplementTaskId === t.id}
                            />
                            {!t.finalized && (
                              <button onClick={() => handleServiceComplementVoiceInput(t.id)} className={`p-1 rounded-full transition text-[9px] ${listeningComplementTaskId === t.id ? 'bg-red-600 text-white animate-pulse' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'}`} title="Voz">🎙️</button>
                            )}
                          </div>
                        )}
                        <div className="flex justify-between items-center mt-1 text-[8px] font-bold">
                          <span className="text-indigo-500">{t.floor}</span>
                          {(t.executedBefore ?? 0) > 0 && (
                            <span className="text-slate-500 bg-slate-100 px-1 py-0.5 rounded border border-slate-200">
                              Realizado: <span className="text-slate-800 font-black">{t.executedBefore}%</span>
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="p-3 border-r text-center">
                        <div className="relative inline-block w-full min-h-[26px] bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 transition">
                          <span className="block text-[9px] font-black text-slate-700 py-1 uppercase">{t.responsible || 'ESCOLHER'}</span>
                          <select disabled={t.finalized} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" value={t.responsible || ''} onChange={e => handleUpdateTaskField(t.id, 'responsible', e.target.value)}>
                            <option value="">-- Equipe --</option>
                            {teams.map(team => <option key={team} value={team}>{team}</option>)}
                          </select>
                        </div>
                      </td>

                      <td className="p-3 border-r text-center">
                        <input type="number" min="0" disabled={t.finalized} className="w-12 p-1 border border-slate-300 bg-slate-50 text-center font-bold rounded-lg text-xs outline-none focus:bg-white focus:border-indigo-500" value={t.efetivo ?? ''} onChange={e => handleUpdateTaskField(t.id, 'efetivo', e.target.value === '' ? null : parseInt(e.target.value, 10))} />
                      </td>

                      <td className="p-3 border-r align-middle bg-emerald-50/30">
                        <div className="flex gap-1 justify-center">
                          {[25, 50, 75, 100].map(val => {
                            const execBefore = t.executedBeforeRaw ?? t.executedBefore ?? 0;
                            const execBeforeStep = roundDown25(execBefore);
                            const isPlanned = currentPlan === val;
                            const isExecuted = execBeforeStep > 0 && val === execBeforeStep;

                            let btnClass = 'short-percent-button short-percent-planned-default';
                            if (isPlanned) btnClass = 'short-percent-button short-percent-planned-active';
                            else if (isExecuted) btnClass = 'short-percent-button short-percent-executed';

                            return (
                              <button key={val} disabled={t.finalized} onClick={() => handlePlannedChange(t.id, val)} className={btnClass}>
                                {val}%
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      <td className="p-3 border-r align-middle text-center bg-slate-50/50 min-w-[210px]">
                        <DaysSelector dailyWork={t.dailyWork} disabled={t.finalized} onChange={(newDW) => handleDailyWorkChange(t.id, newDW)} currentWeekStart={currentWeekStart} weatherCache={weatherCache} projectCity={projectCity} />
                      </td>

                      <td className="p-3 border-r align-middle">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex gap-1 justify-center">
                            {[25, 50, 75, 100].map(val => {
                              const progressStep = roundDown25(progVal);
                              const prefilledStep = roundDown25(t.preFilledProgress ?? 0);
                              const isActive = progressStep > 0 && progressStep === val;
                              const isPrefilled = prefilledStep > 0 && prefilledStep === val;
                              const isOk = val >= currentPlan;
                              const activeClass = isOk ? 'short-percent-progress-ok' : 'short-percent-progress-delay';
                              const prefillClass = (isPrefilled && !isActive) ? 'short-percent-prefilled' : '';

                              return (
                                <button key={val} disabled={t.finalized} onClick={() => handleWeeklyProgressChange(t.id, val)} className={`short-percent-button ${
                                  isActive ? activeClass : prefillClass || 'short-percent-progress-default'
                                }`}>
                                  {val}%
                                </button>
                              );
                            })}
                          </div>
                          {t.preFilledProgress !== undefined && (
                            <span className="text-[7px] font-black text-purple-700 bg-purple-100 border border-purple-200 px-1 rounded mt-0.5 animate-pulse">
                              📲 Campo: {t.preFilledProgress}%
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="p-3 border-r align-middle text-center">
                        {showDelayAlert ? (
                          <div className="space-y-1">
                            <div className="relative inline-block w-full min-h-[26px] bg-red-100/80 border border-red-200 text-red-800 rounded-lg hover:bg-red-200/80 transition">
                              <span className="block text-[8px] font-black py-1 px-1 text-center truncate">{t.delayReason || '⚠️ MOTIVO...'}</span>
                              <select disabled={t.finalized} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" value={t.delayReason || ''} onChange={e => handleUpdateTaskField(t.id, 'delayReason', e.target.value)}>
                                <option value="">⚠️ Escolha o Motivo</option>
                                {delayReasons.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </div>
                            {t.preFilledDelayReason && <div className="text-[7px] text-purple-700 font-black italic block">Sugerido: "{t.preFilledDelayReason}"</div>}
                          </div>
                        ) : (
                          <span className="text-[10px] font-black text-emerald-600 uppercase">✓ Conforme</span>
                        )}
                      </td>

                      <td className="p-3 border-r align-middle">
                        <div className="flex gap-1.5 items-start">
                          <textarea disabled={t.finalized} className="flex-1 p-1 bg-slate-50 border border-slate-300 rounded-lg text-[9px] font-bold text-slate-800 outline-none focus:bg-white focus:border-indigo-500 resize-none min-h-[30px]" placeholder="Anotações..." value={t.observations || ''} onChange={e => setPlanning(planning.map(p => p.id === t.id ? { ...p, observations: e.target.value } : p))} />
                          {!t.finalized && (
                            <button onClick={() => handleVoiceInput(t.id)} className={`p-1 rounded-full transition ${listeningTaskId === t.id ? 'bg-red-600 text-white animate-pulse' : 'bg-indigo-50 text-indigo-700'}`}>🎙️</button>
                          )}
                        </div>
                        {t.preFilledObservations && <div className="text-[7px] text-purple-700 font-bold italic mt-0.5">📲 Campo: "{t.preFilledObservations}"</div>}
                      </td>

                      <td className="p-3 text-center align-middle">
                        <div className="flex items-center justify-center gap-1.5">
                          {t.preFilledProgress !== undefined && (
                            <button onClick={() => handleAcceptPreFill(t.id)} className="p-1 border border-emerald-300 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-black transition cursor-pointer animate-bounce" title="Aceitar">✅</button>
                          )}
                          <input type="checkbox" disabled={t.finalized} checked={selectedTaskIds.includes(t.id)} onChange={e => {
                            if (e.target.checked) setSelectedTaskIds(prev => [...prev, t.id]);
                            else setSelectedTaskIds(prev => prev.filter(id => id !== t.id));
                          }} className="w-3.5 h-3.5 border-slate-300 text-indigo-600 rounded cursor-pointer disabled:opacity-30" />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function renderVisualization() {
    return (
      <div className="space-y-6 animate-in fade-in duration-300 pb-12">
        <div className="flex justify-between items-center bg-white p-5 rounded-2xl border border-slate-200">
          <div>
            <h2 className="text-base font-black text-slate-800 uppercase tracking-tight">Painéis de Controle Visual (Matrizes)</h2>
            <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-wider">Configure matrizes de pavimentos vs etapas da obra. Reordene arrastando.</p>
          </div>
          <button onClick={handleCreateMatrix} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase rounded-xl text-[10px] cursor-pointer">+ Novo Painel</button>
        </div>

        {matrices.map(matrix => (
          <div key={matrix.id} className="bg-white rounded-3xl border border-slate-200 overflow-hidden">
            <div className="bg-slate-50 p-4 border-b border-slate-200 flex justify-between items-center">
              <input 
                type="text" 
                className="font-black text-xs uppercase text-slate-800 bg-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 rounded px-2 py-1 outline-none border border-transparent focus:border-slate-300"
                value={matrix.name}
                onChange={e => setMatrices(prev => prev.map(m => m.id === matrix.id ? { ...m, name: e.target.value.toUpperCase() } : m))}
                onBlur={() => setNotification({ message: 'Nome atualizado!', type: 'success' })}
              />
              <button onClick={() => setConfirmDialog({ isOpen: true, title: 'Excluir Painel', message: `Deseja remover o painel "${matrix.name}"?`, onConfirm: () => handleDeleteMatrix(matrix.id) })} className="text-red-500 font-black text-[9px] uppercase hover:underline cursor-pointer">Remover Painel</button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-slate-900 text-white uppercase text-[8px] tracking-wider">
                  <tr>
                    <th className="p-3 w-40 border-r border-slate-700">Pavimento</th>
                    {matrix.macros.map((mId: string, idx: number) => (
                      <th 
                        key={mId}
                        draggable
                        onDragStart={(e) => handleDragColStart(e, matrix.id, idx)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={(e) => handleDropCol(e, matrix.id, idx)}
                        className="p-3 text-center border-r border-slate-700 relative group cursor-grab active:cursor-grabbing hover:bg-slate-800 transition min-w-[130px] select-none"
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span className="text-slate-500">⋮⋮</span>
                          <span>{mId.length > 15 ? `${mId.slice(0,12)}...` : mId}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); removeMatrixColumn(matrix.id, mId); }} className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 text-red-400 font-bold">&times;</button>
                      </th>
                    ))}
                    <th onClick={() => setMatrixSelection({ isOpen: true, matrixId: matrix.id, type: 'macro' })} className="p-3 text-center text-indigo-400 hover:bg-slate-800 hover:text-white transition cursor-pointer font-bold">+ ADICIONAR ETAPA</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {matrix.floors.map((fId: string, idx: number) => (
                    <tr 
                      key={fId}
                      draggable
                      onDragStart={(e) => handleDragRowStart(e, matrix.id, idx)}
                      onDragOver={e => e.preventDefault()}
                      onDrop={(e) => handleDropRow(e, matrix.id, idx)}
                      className="hover:bg-slate-50 transition group"
                    >
                      <td className="p-3 font-bold text-slate-700 bg-slate-50 border-r border-slate-200 flex justify-between items-center cursor-grab active:cursor-grabbing select-none">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">⋮⋮</span>
                          <span>{fId}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); removeMatrixRow(matrix.id, fId); }} className="opacity-0 group-hover:opacity-100 text-red-500 font-bold">&times;</button>
                      </td>

                      {matrix.macros.map((mId: string) => {
                        const avg = getPackageProgress(fId, mId, cronogramaInicial);
                        const isCompleted = avg > 98.9;
                        const isHalf = avg > 50;
                        const isStarted = avg > 0;

                        let cellClass = 'text-slate-500';
                        if (isCompleted) cellClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                        else if (isHalf) cellClass = 'bg-indigo-50 text-indigo-800 border-indigo-200';
                        else if (isStarted) cellClass = 'bg-orange-50 text-orange-800 border-orange-200';

                        const relevant = cronogramaInicial.filter(c => c.floor === fId && slugify(c.macro) === slugify(mId));
                        const tooltip = relevant.map(r => `• ${r.service}: ${r.progress.toFixed(0)}%`).join('\n') || 'Nenhuma tarefa';

                        return (
                          <td 
                            key={mId}
                            className={`p-3 text-center font-black border-r border-slate-200 cursor-help ${cellClass}`}
                            onMouseEnter={e => setTooltipState({ isOpen: true, x: e.clientX + 10, y: e.clientY + 10, content: tooltip })}
                            onMouseLeave={() => setTooltipState(prev => ({ ...prev, isOpen: false }))}
                          >
                            {avg.toFixed(1)}%
                          </td>
                        );
                      })}
                      <td className="bg-slate-50/50"></td>
                    </tr>
                  ))}
                  <tr>
                    <td 
                      colSpan={matrix.macros.length + 2}
                      onClick={() => setMatrixSelection({ isOpen: true, matrixId: matrix.id, type: 'floor' })}
                      className="p-3 text-center text-[10px] font-black uppercase text-indigo-600 bg-slate-50 hover:bg-indigo-100/50 cursor-pointer border-t border-dashed border-slate-300 transition"
                    >
                      + Adicionar Pavimento
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {tooltipState.isOpen && (
          <div className="fixed bg-slate-900 text-white text-[10px] px-3 py-2 rounded-xl shadow-2xl z-50 pointer-events-none whitespace-pre border border-slate-700/80 font-bold max-w-sm" style={{ left: tooltipState.x, top: tooltipState.y }}>
            {tooltipState.content}
          </div>
        )}

        {matrixSelection?.isOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xl max-w-sm w-full space-y-4">
              <div className="flex justify-between items-center border-b pb-2">
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Adicionar ao Painel</h3>
                <button onClick={() => setMatrixSelection(null)} className="text-slate-400 hover:text-slate-600 font-bold text-base">&times;</button>
              </div>
              <div className="max-h-[220px] overflow-y-auto space-y-1.5">
                {(matrixSelection.type === 'macro' ? allPossibleMacros : floors).map(item => {
                  const currentM = matrices.find(m => m.id === matrixSelection.matrixId);
                  const isAlreadyIn = matrixSelection.type === 'macro' ? currentM?.macros.includes(item) : currentM?.floors.includes(item);

                  return (
                    <button
                      key={item}
                      disabled={isAlreadyIn}
                      onClick={() => {
                        setMatrices(prev => prev.map(m => {
                          if (m.id === matrixSelection.matrixId) {
                            return matrixSelection.type === 'macro' ? { ...m, macros: [...m.macros, item] } : { ...m, floors: [...m.floors, item] };
                          }
                          return m;
                        }));
                        setMatrixSelection(null);
                      }}
                      className={`w-full p-2.5 rounded-xl border text-left text-[10px] font-black uppercase transition flex justify-between items-center ${
                        isAlreadyIn ? 'short-selected cursor-not-allowed' : 'bg-white border-slate-200 text-slate-700 hover:bg-indigo-50 hover:border-indigo-300'
                      }`}
                    >
                      <span>{item}</span>
                      <span>{isAlreadyIn ? '✓ Incluído' : '+ Adicionar'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderDetalhamentoPpc() {
    return (
      <div className="space-y-6 animate-in fade-in duration-300 pb-12">
        <div className="bg-white p-5 rounded-2xl border border-slate-200">
          <h2 className="text-xs font-black text-indigo-900 uppercase tracking-tight mb-4">Análise de Desempenho por Equipe</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-600 mb-1">Equipe / Empreiteiro</label>
              <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none text-slate-800 font-mono" value={ppcSelectedContractor} onChange={e => setPpcSelectedContractor(e.target.value)}>
                <option value="">-- Selecione --</option>
                {contractorsInPeriod.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-600 mb-1">Semana Inicial</label>
              <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none text-slate-800" value={ppcStartWeek} onChange={e => setPpcStartWeek(e.target.value)}>
                {availableWeeks.map(w => <option key={w} value={w}>{formatDateBR(w)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-600 mb-1">Semana Final</label>
              <select className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none text-slate-800" value={ppcEndWeek} onChange={e => setPpcEndWeek(e.target.value)}>
                {availableWeeks.map(w => <option key={w} value={w}>{formatDateBR(w)}</option>)}
              </select>
            </div>
          </div>
        </div>

        {ppcSelectedContractor ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200">
              <h3 className="text-xs font-black uppercase text-slate-800 mb-4 border-b pb-2">Histórico de Metas</h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-indigo-900 text-white uppercase text-[8px] tracking-wider">
                    <tr>
                      <th className="p-2 text-center">Semana</th>
                      <th className="p-2 text-center">PPC</th>
                      <th className="p-2 text-center">Desempenho</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-bold text-slate-700">
                    {contractorWeeklyPpcData.map(row => (
                      <tr key={row.weekId}>
                        <td className="p-2 text-center font-mono text-[10px]">{row.startDateStr.slice(0,5)}</td>
                        <td className="p-2 text-center text-slate-900">{row.ppc !== null ? `${row.ppc}%` : '-'}</td>
                        <td className="p-2 text-center text-[9px]">{row.ppc !== null ? (row.ppc >= 80 ? '😁 EXCELENTE' : row.ppc >= 50 ? '😐 REGULAR' : '😡 CRÍTICO') : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-indigo-50 text-indigo-900 uppercase text-[10px] font-black">
                    <tr>
                      <td className="p-2.5 text-center">Média PPC</td>
                      <td className="p-2.5 text-center bg-indigo-200">{averagePpc}%</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="lg:col-span-7 space-y-6">
              {ppcEvolutionChart && (
                <div className="bg-white p-5 rounded-2xl border border-slate-200 flex flex-col">
                  <h3 className="text-xs font-black uppercase text-slate-800 mb-4 border-b pb-2">Gráfico de Evolução (%)</h3>
                  <svg viewBox={`0 0 ${ppcEvolutionChart.width} ${ppcEvolutionChart.height}`} className="w-full max-w-md mx-auto">
                    {[0, 25, 50, 75, 100].map(val => {
                      const y = ppcEvolutionChart.getY(val);
                      return (
                        <g key={val} className="opacity-30">
                          <line x1={ppcEvolutionChart.mLeft} y1={y} x2={ppcEvolutionChart.width - 20} y2={y} stroke="#cbd5e1" strokeWidth="1" />
                          <text x={ppcEvolutionChart.mLeft - 6} y={y + 3} textAnchor="end" className="text-[8px] font-bold fill-slate-500">{val}%</text>
                        </g>
                      );
                    })}
                    <line x1={ppcEvolutionChart.mLeft} y1={ppcEvolutionChart.height - 40} x2={ppcEvolutionChart.width - 20} y2={ppcEvolutionChart.height - 40} stroke="#94a3b8" />
                    <path d={ppcEvolutionChart.pathD} fill="none" stroke="#4f46e5" strokeWidth="2.5" />
                    {ppcEvolutionChart.validPoints.map((p, idx) => (
                      <g key={idx}>
                        <circle cx={p.x} cy={p.y} r="4.5" fill="#4f46e5" stroke="#fff" strokeWidth="1.5" />
                        <text x={p.x} y={p.y - 8} textAnchor="middle" className="text-[9px] font-black fill-slate-800">{p.ppc}%</text>
                        <text x={p.x} y={ppcEvolutionChart.height - 20} textAnchor="middle" className="text-[8px] font-black fill-slate-500 uppercase">{p.label}</text>
                      </g>
                    ))}
                  </svg>
                </div>
              )}

              <div className="bg-white p-5 rounded-2xl border border-slate-200">
                <h3 className="text-xs font-black uppercase text-slate-800 mb-4 border-b pb-2">Motivos de Desvios</h3>
                {delayStatsContractor.length === 0 ? (
                  <div className="py-6 text-center text-slate-400 italic text-xs">Nenhum desvio crítico apontado.</div>
                ) : (
                  <div className="space-y-3">
                    {delayStatsContractor.map((d, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex justify-between text-[10px] font-bold">
                          <span className="text-slate-700 uppercase">{d.reason}</span>
                          <span className="text-rose-600 font-black">{d.count} ocorrência(s)</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div className="bg-rose-500 h-full rounded-full" style={{ width: `${d.percent}%` }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="py-12 bg-white text-center rounded-3xl border border-slate-200 italic text-slate-400 text-xs font-bold uppercase">
            Escolha uma equipe nas opções acima para ver a análise de produtividade.
          </div>
        )}
      </div>
    );
  }

  function renderInfographic() {
    return (
      <div className="space-y-6 animate-in fade-in duration-300 pb-12">
        <div className="bg-white p-6 rounded-3xl border border-slate-200">
          <h3 className="text-xs font-black text-slate-800 uppercase mb-4 tracking-wider">Evolução Semanal de PPC da Obra</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {(ppcHistory || []).map((h, i) => (
              <div key={i} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col justify-between">
                <div className="text-[9px] font-black text-slate-500 uppercase">{formatDateBR(h?.weekStart)}</div>
                <div className="text-2xl font-black text-indigo-900 mt-1">{(h?.ppc || 0).toFixed(1)}%</div>
                <div className="text-[9px] text-slate-500 font-bold uppercase mt-2">{h?.completed ?? 0} / {h?.totalPlanned ?? 0} concluídos</div>
              </div>
            ))}
            {(ppcHistory || []).length === 0 && (
              <div className="col-span-full py-8 text-center text-xs text-slate-600 font-bold uppercase italic">Nenhuma semana finalizada.</div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200 space-y-4">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 border-b pb-4">
            <div>
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider">Histórico Geral de Planejamento</h3>
              <p className="text-[9px] text-slate-400 mt-1 uppercase font-bold tracking-wider">Mapeamento completo contendo todos os dados planejados e medidos</p>
            </div>
            <button onClick={handleExportCSV} className="px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider rounded-xl shadow-md flex items-center gap-1.5 transition active:scale-95 cursor-pointer">
              <span>📥</span> Exportar Planilha
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-600 mb-1">Pesquisa</label>
              <input type="text" className="w-full p-2 border rounded-lg text-xs bg-white outline-none" placeholder="Buscar..." value={giantSearch} onChange={e => setHistorySearch(e.target.value)} />
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-600 mb-1">Pavimento</label>
              <select className="w-full p-2 border rounded-lg text-xs bg-white outline-none font-bold text-slate-800" value={giantFloorFilter} onChange={e => setHistoryFloorFilter(e.target.value)}>
                <option value="">-- Todos --</option>
                {floors.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-600 mb-1">Macroatividade</label>
              <select className="w-full p-2 border rounded-lg text-xs bg-white outline-none font-bold text-slate-800" value={giantMacroFilter} onChange={e => setHistoryMacroFilter(e.target.value)}>
                <option value="">-- Todas --</option>
                {allPossibleMacros.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-600 mb-1">Estado</label>
              <select className="w-full p-2 border rounded-lg text-xs bg-white outline-none font-bold text-slate-800" value={giantStatusFilter} onChange={e => setHistoryStatusFilter(e.target.value)}>
                <option value="">-- Todos --</option>
                <option value="finalized">🔒 Finalizadas</option>
                <option value="active">🔓 Ativas</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-800 text-white uppercase text-[8px] tracking-wider">
                <tr>
                  <th className="p-3 border-r border-slate-700">Semana</th>
                  <th className="p-3 border-r border-slate-700">Pavimento</th>
                  <th className="p-3 border-r border-slate-700">Macroatividade</th>
                  <th className="p-3 border-r border-slate-700">Serviço</th>
                  <th className="p-3 border-r border-slate-700">Equipe</th>
                  <th className="p-3 border-r border-slate-700 text-center">Meta</th>
                  <th className="p-3 border-r border-slate-700 text-center">Dias Ativos</th>
                  <th className="p-3 border-r border-slate-700 text-center">Avanço</th>
                  <th className="p-3 border-r border-slate-700 text-center">Acumulado</th>
                  <th className="p-3 border-r border-slate-700 text-center">Desvio</th>
                  <th className="p-3 border-r border-slate-700">Notas</th>
                  <th className="p-3 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredGiantPlanningTasks.map((t, idx) => {
                  const execB = Number(t?.executedBefore) || 0;
                  const progW = Number(t?.progressThisWeek) || 0;
                  const totalAcc = Math.min(100, execB + progW);
                  const isDelayed = t.plannedThisWeek > t.progressThisWeek;

                  return (
                    <tr key={idx} className={`hover:bg-slate-50 transition ${t.finalized ? 'bg-slate-50 text-slate-400' : ''}`}>
                      <td className="p-2.5 border-r font-mono whitespace-nowrap">{formatDateBR(t.weekId).slice(0, 5)}</td>
                      <td className="p-2.5 border-r font-bold whitespace-nowrap">{t.floor}</td>
                      <td className="p-2.5 border-r uppercase font-medium">{t.sectionId}</td>
                      <td className="p-2.5 border-r font-black text-slate-800 uppercase">{t.activityName}</td>
                      <td className="p-2.5 border-r font-bold text-indigo-900 whitespace-nowrap uppercase">{t.responsible || 'Sem alocação'}</td>
                      <td className="p-2.5 border-r text-center font-black">{t.plannedThisWeek}%</td>
                      <td className="p-2.5 border-r text-center">
                        <div className="flex gap-[2px] justify-center">
                          {t.dailyWork.map((dw, i) => (
                            <span key={i} className={`w-3.5 h-3.5 rounded-full text-[7px] font-black flex items-center justify-center border ${dw ? 'bg-slate-800 text-white border-slate-800' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                              {['S','T','Q','Q','S'][i]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-2.5 border-r text-center font-black text-emerald-600">{t.progressThisWeek}%</td>
                      <td className="p-2.5 border-r text-center font-black">{totalAcc}%</td>
                      <td className="p-2.5 border-r text-center font-bold">
                        {isDelayed ? <span className="text-red-600 font-black text-[9px] uppercase">⚠️ {t.delayReason || 'Sem motivo'}</span> : <span className="text-emerald-600 font-bold uppercase text-[9px]">✓ Conforme</span>}
                      </td>
                      <td className="p-2.5 border-r italic text-[9px] max-w-xs truncate" title={t.observations}>{t.observations || '-'}</td>
                      <td className="p-2.5 text-center font-black text-[9px] uppercase">{t.finalized ? '🔒 Fechada' : '🔓 Ativa'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  function handleAddTeam() {
    const val = newTeamName.trim();
    if (!val) return;
    if (teams.map(t => t.toLowerCase()).includes(val.toLowerCase())) return;
    setTeams([...teams, val.toUpperCase()]);
    setNewTeamName('');
    setNotification({ message: 'Equipe registrada!', type: 'success' });
  }

  function handleAddDelayReason() {
    const val = newDelayReason.trim();
    if (!val) return;
    if (delayReasons.map(r => r.toLowerCase()).includes(val.toLowerCase())) return;
    setDelayReasons([...delayReasons, val.toUpperCase()]);
    setNewDelayReason('');
    setNotification({ message: 'Causa de atraso registrada!', type: 'success' });
  }

  function renderConfig() {
    return (
      <div className="space-y-6 animate-in fade-in duration-300 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 space-y-4 shadow-sm">
            <h2 className="text-xs font-black uppercase border-b pb-2 text-slate-800 tracking-wider">1. Cadastro de Equipes</h2>
            <div className="flex gap-2">
              <input type="text" placeholder="EX: EQUIPE ALFA..." className="flex-1 p-2.5 text-xs border border-slate-200 rounded-xl outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddTeam()} />
              <button onClick={handleAddTeam} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer">Registrar</button>
            </div>
            <div className="space-y-2">
              {teams.map(team => (
                <div key={team} className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="font-bold text-xs text-slate-800 truncate uppercase">{team}</span>
                  <div className="flex items-center gap-2 font-bold text-slate-700">
                    <span className="text-[9px] uppercase">Tel:</span>
                    <input type="text" placeholder="+55 11..." className="w-32 p-1 border border-slate-200 bg-white rounded-lg text-[10px] font-bold outline-none" value={teamPhones[team] || ''} onChange={e => setTeamPhones({ ...teamPhones, [team]: e.target.value })} />
                    <button onClick={() => setConfirmDialog({ isOpen: true, title: 'Remover Equipe', message: `Deseja realmente remover a equipe "${team}"?`, onConfirm: () => setTeams(prev => prev.filter(t => t !== team)) })} className="text-red-500 font-bold hover:text-red-700 text-xs ml-1">&times;</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 space-y-4 shadow-sm">
            <h2 className="text-xs font-black uppercase border-b pb-2 text-slate-800 tracking-wider">2. Padronização de Causas de Atraso</h2>
            <div className="flex gap-2">
              <input type="text" placeholder="EX: FALTA DE MATERIAL..." className="flex-1 p-2.5 text-xs border border-slate-200 rounded-xl outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800" value={newDelayReason} onChange={e => setNewDelayReason(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddDelayReason()} />
              <button onClick={handleAddDelayReason} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer">Registrar</button>
            </div>
            <div className="space-y-2">
              {delayReasons.map(reason => (
                <div key={reason} className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 uppercase">
                  <span>{reason}</span>
                  <button onClick={() => setConfirmDialog({ isOpen: true, title: 'Remover Motivo', message: `Deseja remover o motivo "${reason}"?`, onConfirm: () => setDelayReasons(prev => prev.filter(r => r !== reason)) })} className="text-red-500 font-bold hover:text-red-700 text-xs ml-1">&times;</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200 space-y-4 shadow-sm">
          <h2 className="text-xs font-black uppercase border-b pb-2 text-slate-800 tracking-wider">3. Clima e Localidade</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-bold text-slate-700">
            <div>
              <label className="block text-[8px] uppercase mb-1">Cidade da Obra</label>
              <input type="text" className="w-full p-2.5 border border-slate-200 bg-slate-50 focus:bg-white rounded-xl text-xs" placeholder="Ex: Curitiba, PR" value={projectCity} onChange={e => setProjectCity(e.target.value)} />
            </div>
            <div>
              <label className="block text-[8px] uppercase mb-1">Visual Crossing API Key</label>
              <input type="password" className="w-full p-2.5 border border-slate-200 bg-slate-50 focus:bg-white rounded-xl text-xs" placeholder="API Key..." value={weatherApiKey} onChange={e => setWeatherApiKey(e.target.value)} />
            </div>
          </div>
        </div>
      </div>
    );
  }



  // --- SUB-MODAIS INTERNOS ---

  function renderFinalizeWeekModal() {
    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xl max-w-sm w-full space-y-4">
          <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">🏁 Finalizar Semana</h3>
          <p className="text-xs text-slate-500 leading-normal font-bold">
            Isto fechará o PPC semanal ativo e integrará o progresso acumulado de volta ao cronograma geral.
          </p>
          <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer">
            <input type="checkbox" checked={finalizeModal?.carryOverUnfinished ?? true} onChange={e => setFinalizeModal(prev => prev ? { ...prev, carryOverUnfinished: e.target.checked } : null)} className="w-4 h-4 rounded text-indigo-600 cursor-pointer" />
            <span>Reprogramar tarefas não concluídas</span>
          </label>
          <div className="flex justify-end gap-2 text-[10px] font-black uppercase pt-2">
            <button onClick={() => setFinalizeModal(null)} className="px-4 py-2 border border-slate-200 rounded-xl cursor-pointer">Cancelar</button>
            <button onClick={() => handleFinalizeWeek(finalizeModal?.carryOverUnfinished ?? true)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl cursor-pointer">Finalizar</button>
          </div>
        </div>
      </div>
    );
  }

  function renderWhatsAppModal() {
    const availableTeams = getWhatsappAvailableTeams();

    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xl max-w-md w-full space-y-4">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Compartilhar WhatsApp</h3>
            <button onClick={() => setWhatsappModal(prev => ({ ...prev, isOpen: false }))} className="text-slate-400 hover:text-slate-600 font-bold text-base">&times;</button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">Equipe</label>
              <select
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold uppercase outline-none"
                value={whatsappModal.teamName}
                onChange={(event) => {
                  const teamName = event.target.value;
                  setWhatsappModal({ isOpen: true, teamName, text: generateWhatsappMessage(teamName) });
                }}
              >
                {availableTeams.map(team => <option key={team} value={team}>{team}</option>)}
              </select>
            </div>
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200">
              <div className="flex justify-between text-[9px] font-black uppercase text-slate-500">
                <span>Telefone cadastrado</span>
                <span className="text-indigo-700 font-mono">{teamPhones[whatsappModal.teamName] || 'Nao cadastrado'}</span>
              </div>
            </div>
            <div>
              <label className="block text-[9px] font-black uppercase text-slate-500 mb-1">Mensagem</label>
              <textarea
                rows={8}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-700 outline-none focus:bg-white focus:border-indigo-500 resize-none"
                value={whatsappModal.text}
                onChange={(event) => setWhatsappModal(prev => ({ ...prev, text: event.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button onClick={() => setWhatsappModal(prev => ({ ...prev, isOpen: false }))} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-black uppercase rounded-xl transition">Voltar</button>
              <button onClick={handleSendWhatsApp} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase rounded-xl transition">Enviar via WhatsApp</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderDrawer() {
    if (Date.now() >= 0) {
      const sourceOptions: Array<{ id: typeof drawerSourceMode; label: string; detail: string }> = [
        { id: 'medium', label: 'Medio prazo publicado', detail: 'Atividades publicadas pelo medio prazo.' },
        { id: 'previous-successors', label: 'Sucessoras liberadas', detail: `Base: semana ${formatDateBR(previousWeekIdForDrawer)}.` },
        { id: 'unfinished', label: 'Nao concluidas', detail: 'Atividades do medio prazo com avanco parcial.' }
      ];

      return (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity" onClick={() => setIsDrawerOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-screen max-w-md bg-white shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-300">
            <div className="p-5 bg-indigo-950 text-white flex justify-between items-center">
              <div>
                <h3 className="font-black text-sm uppercase tracking-wider">Adicionar Atividades</h3>
                <p className="text-[10px] text-indigo-300">Origem: medio prazo do Plano Total</p>
              </div>
              <button onClick={() => setIsDrawerOpen(false)} className="text-2xl font-bold hover:text-indigo-200">&times;</button>
            </div>

            <div className="flex-1 p-5 space-y-5 overflow-y-auto">
              {drawerWarning && <div className="bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold p-3 rounded-lg">{drawerWarning}</div>}

              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="block text-[10px] font-black uppercase text-slate-500">Origem das atividades</label>
                <div className="grid grid-cols-1 gap-2">
                  {sourceOptions.map(option => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setDrawerSourceMode(option.id)}
                      className={`w-full text-left p-3 rounded-xl border transition ${
                        drawerSourceMode === option.id
                          ? 'short-selected'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                      }`}
                    >
                      <span className="block text-[10px] font-black uppercase tracking-wider">{option.label}</span>
                      <span className={`block text-[9px] font-bold mt-0.5 ${drawerSourceMode === option.id ? 'text-indigo-100' : 'text-slate-400'}`}>{option.detail}</span>
                    </button>
                  ))}
                </div>
              </div>

              {drawerSourceMode !== 'unfinished' && (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex justify-between items-center gap-3">
                    <label className="block text-[10px] font-black uppercase text-indigo-600">1. Macroatividade</label>
                    {drawerMacro && <span className="text-[9px] font-bold text-slate-500 text-right truncate max-w-[210px]">{getMacroTitle(drawerMacro)}</span>}
                  </div>
                  {isDrawerMacroDropdownOpen && <div className="fixed inset-0 z-40" onClick={() => setIsDrawerMacroDropdownOpen(false)} />}
                  <div className="relative z-50">
                    <input
                      type="text"
                      placeholder="Buscar macroatividade..."
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs focus:bg-white outline-none"
                      value={isDrawerMacroDropdownOpen ? drawerMacroSearch : (drawerMacro ? getMacroTitle(drawerMacro) : '')}
                      onFocus={() => {
                        setDrawerMacroSearch('');
                        setIsDrawerMacroDropdownOpen(true);
                      }}
                      onChange={(event) => setDrawerMacroSearch(event.target.value)}
                    />
                    {isDrawerMacroDropdownOpen && (
                      <div className="absolute left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto z-50">
                        {filteredMacros.map(macro => (
                          <button
                            key={macro}
                            type="button"
                            onClick={() => {
                              setDrawerMacro(macro);
                              setDrawerFloors([]);
                              setDrawerSelectedServices([]);
                              setDrawerWarning('');
                              setIsDrawerMacroDropdownOpen(false);
                            }}
                            className="w-full text-left p-2.5 text-xs font-bold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition uppercase border-b border-slate-100 last:border-b-0"
                          >
                            {getMacroTitle(macro)}
                          </button>
                        ))}
                        {filteredMacros.length === 0 && (
                          <p className="p-3 text-xs text-slate-400 italic text-center font-bold">Nenhuma macroatividade encontrada.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {drawerSourceMode !== 'unfinished' && (
                <div className="space-y-2 rounded-xl border border-indigo-100 bg-white p-3">
                  <div className="flex justify-between items-center gap-2">
                    <label className="block text-[10px] font-black uppercase text-indigo-600">2. Pavimentos</label>
                    {availableFloorsForMacro.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setDrawerFloors(drawerFloors.length === availableFloorsForMacro.length ? [] : [...availableFloorsForMacro])}
                        className="text-[9px] font-bold text-indigo-700 hover:underline uppercase"
                      >
                        Todos
                      </button>
                    )}
                  </div>
                  <div className={`grid grid-cols-2 gap-2 ${!drawerMacro ? 'pointer-events-none opacity-50' : ''}`}>
                  {availableFloorsForMacro.map(floor => {
                    const isSelected = drawerFloors.includes(floor);
                    return (
                      <label
                        key={floor}
                        className={`flex items-center gap-2 p-2 rounded-lg border transition cursor-pointer ${
                          isSelected
                            ? 'short-selected'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 text-indigo-600 rounded"
                          checked={isSelected}
                          onChange={(event) => {
                            if (event.target.checked) setDrawerFloors([...drawerFloors, floor]);
                            else setDrawerFloors(drawerFloors.filter(item => item !== floor));
                          }}
                        />
                        <span className={`text-[10px] font-bold truncate ${isSelected ? 'text-white' : 'text-slate-700'}`}>{floor}</span>
                      </label>
                    );
                  })}
                    {drawerMacro && availableFloorsForMacro.length === 0 && <p className="text-[10px] text-slate-400 italic col-span-2">Nenhum pavimento para esta macro.</p>}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="block text-[10px] font-black uppercase text-indigo-600">{drawerSourceMode === 'unfinished' ? '1.' : '3.'} Servicos</label>
                  {availableServicesForMacroAndFloors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setDrawerSelectedServices(drawerSelectedServices.length === availableServicesForMacroAndFloors.length ? [] : availableServicesForMacroAndFloors.map(item => item.id))}
                      className="text-[9px] font-bold text-indigo-700 hover:underline uppercase"
                    >
                      Todos
                    </button>
                  )}
                </div>
                <div className="bg-slate-50 border rounded-xl p-3 h-[42vh] min-h-[260px] overflow-y-auto space-y-2">
                  {availableServicesForMacroAndFloors.map(item => {
                    const isSelected = drawerSelectedServices.includes(item.id);
                    return (
                    <label
                      key={item.id}
                      className={`flex items-center gap-3 p-2 rounded-lg border transition cursor-pointer ${
                        isSelected
                          ? 'short-selected'
                          : 'bg-white border-slate-200 text-slate-800 hover:border-indigo-300 hover:bg-indigo-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4 text-indigo-600 rounded"
                        checked={isSelected}
                        onChange={(event) => {
                          if (event.target.checked) setDrawerSelectedServices([...drawerSelectedServices, item.id]);
                          else setDrawerSelectedServices(drawerSelectedServices.filter(id => id !== item.id));
                        }}
                      />
                      <div className="min-w-0">
                        <p className={`text-xs font-bold truncate ${isSelected ? 'text-white' : 'text-slate-800'}`}>{item.service}</p>
                        <p className={`text-[9px] font-bold ${isSelected ? 'text-indigo-100' : 'text-slate-500'}`}>{item.floor} | {getMacroTitle(slugify(item.macro))} | {roundPercentValue(item.progress || 0)}%</p>
                      </div>
                    </label>
                    );
                  })}
                  {availableServicesForMacroAndFloors.length === 0 && (
                    <p className="p-4 text-[10px] text-slate-400 italic text-center font-bold">
                      {tasks.length === 0 ? 'Publique uma janela no medio prazo para liberar atividades no curto prazo.' : 'Nenhum servico disponivel para os filtros selecionados.'}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2 border-t pt-3">
                <label className="block text-[10px] font-black uppercase text-slate-400">{drawerSourceMode === 'unfinished' ? '2.' : '4.'} Atribuir equipe</label>
                <select className="w-full p-2.5 bg-slate-100 border rounded-lg text-xs font-bold uppercase cursor-pointer" value={drawerResponsible} onChange={event => setDrawerResponsible(event.target.value)}>
                  <option value="">-- Padrao da atividade --</option>
                  {teams.map(team => <option key={team} value={team}>{team}</option>)}
                </select>
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-3">
                <h4 className="text-[10px] font-black uppercase text-indigo-950 tracking-wider">Atividade extra nao prevista</h4>
                <div className="space-y-2.5 font-bold text-slate-700">
                  <input type="text" placeholder="SERVICO EXTRA..." className="w-full p-2.5 border border-slate-200 rounded-xl text-xs outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800" value={extraActivityName} onChange={e => setExtraActivityName(e.target.value)} />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" placeholder="PAVIMENTO..." className="w-full p-2.5 border border-slate-200 rounded-xl text-xs outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800" value={extraActivityFloor} onChange={e => setExtraActivityFloor(e.target.value)} />
                    <input type="text" placeholder="PACOTE..." className="w-full p-2.5 border border-slate-200 rounded-xl text-xs outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800" value={extraActivityMacro} onChange={e => setExtraActivityMacro(e.target.value)} />
                  </div>
                  <select className="w-full p-2.5 border border-slate-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold outline-none" value={extraActivityTeam} onChange={e => setExtraActivityTeam(e.target.value)}>
                    <option value="">-- Escolha a Equipe --</option>
                    {teams.map(team => <option key={team} value={team}>{team}</option>)}
                  </select>
                  <button onClick={handleAddManualTask} className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer">Programar Atividade Extra</button>
                </div>
              </div>
            </div>

            <div className="p-5 bg-slate-50 border-t sticky bottom-0">
              <button onClick={handleIncludeDrawerActivities} disabled={drawerSelectedServices.length === 0} className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black uppercase tracking-wider rounded-xl shadow-md transition active:scale-95">
                Confirmar Atividades ({drawerSelectedServices.length})
              </button>
            </div>
          </div>
        </div>
      );
    }

    const weekId = toLocalDateString(currentWeekStart);
    const plannedActivityIds = planning.filter(p => p.weekId === weekId).map(p => p.activityId);
    let candidates = cronogramaInicial.filter(c => !plannedActivityIds.includes(c.id));

    if (drawerMacro) candidates = candidates.filter(c => slugify(c.macro) === slugify(drawerMacro));
    if (drawerFloor) candidates = candidates.filter(c => c.floor === drawerFloor);
    if (drawerSearch) candidates = candidates.filter(c => c.service.toLowerCase().includes(drawerSearch.toLowerCase()));

    return (
      <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-300">
        <div className="w-full max-w-md bg-white h-full shadow-2xl p-6 flex flex-col justify-between border-l border-slate-200 overflow-y-auto">
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b pb-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">➕ Programar Novas Atividades</h3>
              <button onClick={() => setIsDrawerOpen(false)} className="text-slate-600 hover:text-slate-700 font-bold text-xl cursor-pointer">&times;</button>
            </div>

            <div className="space-y-2.5 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-[9px] font-black uppercase text-slate-600">
              <div>
                <label className="block mb-1">Filtrar por Pacote (Macro)</label>
                <select className="w-full p-2 border border-slate-200 bg-white rounded-lg text-xs font-bold outline-none text-slate-800 font-mono" value={drawerMacro} onChange={e => setDrawerMacro(e.target.value)}>
                  <option value="">-- Todos --</option>
                  {allPossibleMacros.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1">Filtrar por Pavimento</label>
                <select className="w-full p-2 border border-slate-200 bg-white rounded-lg text-xs font-bold outline-none text-slate-800" value={drawerFloor} onChange={e => setDrawerFloor(e.target.value)}>
                  <option value="">-- Todos --</option>
                  {floors.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1">Pesquisar por Serviço</label>
                <input type="text" placeholder="Pesquisar..." className="w-full p-2 border border-slate-200 bg-white rounded-lg text-xs outline-none text-slate-800" value={drawerSearch} onChange={e => setDrawerSearch(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[8px] font-black text-slate-400 uppercase">Equipe de Execução</label>
              <select id="drawerTeamSelect" className="w-full p-2.5 border border-slate-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold outline-none text-slate-800">
                <option value="">-- Sem Equipe --</option>
                {teams.map(team => <option key={team} value={team}>{team}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <span className="block text-[8px] font-black text-slate-600 uppercase tracking-widest">Serviços Disponíveis ({candidates.length})</span>
              <div className="max-h-[220px] overflow-y-auto space-y-1.5">
                {candidates.map(c => (
                  <div key={c.id} className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition">
                    <div className="min-w-0 flex-1 pr-2">
                      <span className="block text-[11px] font-bold text-slate-800 uppercase leading-tight truncate">{c.service}</span>
                      <span className="block text-[8px] text-slate-600 uppercase mt-0.5">{c.floor} | {c.macro}</span>
                    </div>
                    <button 
                      onClick={() => handleAddTasksFromDrawer([{ id: c.id, serviceName: c.service, lot: c.floor, packageName: c.macro }], (document.getElementById('drawerTeamSelect') as HTMLSelectElement).value)}
                      className="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[9px] font-black uppercase rounded-lg transition"
                    >
                      + Programar
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-200 my-4 pt-4 space-y-3">
              <h4 className="text-[10px] font-black uppercase text-indigo-950 tracking-wider">Atividade Extra Não Prevista</h4>
              {drawerWarning && <div className="text-[9px] font-black uppercase text-rose-600">{drawerWarning}</div>}
              <div className="space-y-2.5 font-bold text-slate-700">
                <input type="text" placeholder="SERVIÇO EXTRA..." className="w-full p-2.5 border border-slate-200 rounded-xl text-xs outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800" value={extraActivityName} onChange={e => setExtraActivityName(e.target.value)} />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" placeholder="PAVIMENTO..." className="w-full p-2.5 border border-slate-200 rounded-xl text-xs outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800" value={extraActivityFloor} onChange={e => setExtraActivityFloor(e.target.value)} />
                  <input type="text" placeholder="PACOTE..." className="w-full p-2.5 border border-slate-200 rounded-xl text-xs outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800" value={extraActivityMacro} onChange={e => setExtraActivityMacro(e.target.value)} />
                </div>
                <select className="w-full p-2.5 border border-slate-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold outline-none" value={extraActivityTeam} onChange={e => setExtraActivityTeam(e.target.value)}>
                  <option value="">-- Escolha a Equipe --</option>
                  {teams.map(team => <option key={team} value={team}>{team}</option>)}
                </select>
                <button onClick={handleAddManualTask} className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition cursor-pointer">Programar Atividade Extra</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
