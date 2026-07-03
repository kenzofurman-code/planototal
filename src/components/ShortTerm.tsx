import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadShortTermState, saveShortTermState, type ShortTermWeeklyItem, type ShortTermHistory } from '../lib/shortTermRepository';
import type { Task } from '../types';

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

// --- Utilitários Locais de Data e Formatação ---
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

// Componente de Cards de estatísticas
function StatCard({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{title}</span>
      <span className={`text-2xl font-black ${color.replace('bg-', 'text-')} mt-1.5`}>{value}</span>
    </div>
  );
}

// Componente seletor de dias ativos
function DaysSelector({ dailyWork, disabled, onChange }: { dailyWork: number[]; disabled?: boolean; onChange: (dw: number[]) => void }) {
  const toggleDay = (idx: number) => {
    if (disabled) return;
    const next = [...dailyWork];
    next[idx] = next[idx] === 1 ? 0 : 1;
    onChange(next);
  };
  return (
    <div className="flex gap-[3px] justify-center items-center h-9">
      {['S', 'T', 'Q', 'Q', 'S'].map((day, idx) => (
        <button
          key={idx}
          type="button"
          disabled={disabled}
          onClick={() => toggleDay(idx)}
          className={`w-6 h-6 rounded-full text-[9px] font-black flex items-center justify-center transition active:scale-95 cursor-pointer border ${
            dailyWork[idx] === 1
              ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
              : 'bg-slate-50 text-slate-355 border-slate-200 hover:border-slate-400'
          } disabled:opacity-50 disabled:cursor-default`}
        >
          {day}
        </button>
      ))}
    </div>
  );
}

// Mock Clima
const getWeatherEmoji = (icon: string) => {
  if (icon.includes('rain') || icon.includes('snow')) return '🌧️';
  if (icon.includes('cloud')) return '☁️';
  if (icon.includes('wind')) return '💨';
  return '☀️';
};

interface ShortTermProps {
  tasks: Task[];
  projectId: string;
  setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
}

export function ShortTerm({ tasks, projectId, setTasks }: ShortTermProps) {
  // --- Estados Principais (Supabase Payload) ---
  const [planning, setPlanning] = useState<ShortTermWeeklyItem[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [delayReasons, setDelayReasons] = useState<string[]>([]);
  const [ppcHistory, setPpcHistory] = useState<ShortTermHistory[]>([]);
  const [teamPhones, setTeamPhones] = useState<{ [teamName: string]: string }>({});
  const [projectCity, setProjectCity] = useState<string>('Curitiba, PR');
  const [weatherApiKey, setWeatherApiKey] = useState<string>('');
  const [matrices, setMatrices] = useState<any[]>([]);
  const [accessControl, setAccessControl] = useState<{
    users: string[];
    projectAccess: { [projectId: string]: string[] };
    logs: { username: string; timestamp: string }[];
  }>({ users: [], projectAccess: {}, logs: [] });

  // --- Estados de Controle Local e Interface ---
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
  const [syncStatus, setSyncStatus] = useState<'local' | 'saving' | 'saved' | 'error'>('local');

  // Identificação do Operador Local
  const [plannerUsername, setPlannerUsername] = useState<string>(() => {
    return localStorage.getItem('planner_username') || '';
  });
  const [showAccessModal, setShowAccessModal] = useState<boolean>(false);
  const [accessUser, setAccessUser] = useState<string>('');
  const [accessPassword, setAccessPassword] = useState<string>('');
  const [isAccessAdmin, setIsAccessAdmin] = useState<boolean>(false);
  const [newAccessUser, setNewAccessUser] = useState<string>('');
  const hasLoggedSession = useRef<boolean>(false);

  // Modais e Diálogos
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void } | null>(null);
  const [finalizeModal, setFinalizeModal] = useState<{ isOpen: boolean; carryOverUnfinished: boolean } | null>(null);
  const [whatsappModal, setWhatsappModal] = useState<boolean>(false);

  // Clima Cache
  const [weatherCache, setWeatherCache] = useState<{ [key: string]: { conditions: string; tempMin: number; tempMax: number; icon: string } }>({});
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);

  // Busca e Filtros
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [cronoSearch, setCronoSearch] = useState('');
  const [cronoFloorFilter, setCronoFloorFilter] = useState('');
  const [cronoMacroFilter, setCronoMacroFilter] = useState('');
  const [cronoProgressFilter, setCronoProgressFilter] = useState('');
  const [cronoSortKey, setCronoSortKey] = useState('macro');
  const [cronoSortDir, setCronoSortDir] = useState<'asc' | 'desc'>('asc');

  const [planningSearch, setPlanningSearch] = useState('');
  const [planningTeamFilter, setPlanningTeamFilter] = useState('');
  const [planningStatusFilter, setPlanningStatusFilter] = useState('');
  const [planningSortKey, setPlanningSortKey] = useState('activityName');
  const [planningSortDir, setPlanningSortDir] = useState<'asc' | 'desc'>('asc');

  const [giantSearch, setHistorySearch] = useState('');
  const [giantFloorFilter, setHistoryFloorFilter] = useState('');
  const [giantMacroFilter, setHistoryMacroFilter] = useState('');
  const [giantStatusFilter, setHistoryStatusFilter] = useState('');
  const [giantSortKey, setGiantSortKey] = useState('weekId');
  const [giantSortDir, setGiantSortDir] = useState<'asc' | 'desc'>('desc');

  // Adicionar Atividades (Drawer lateral)
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [drawerMacro, setDrawerMacro] = useState<string>('');
  const [drawerFloor, setDrawerFloor] = useState<string>('');
  const [drawerWarning, setDrawerWarning] = useState<string>('');
  const [drawerSearch, setDrawerSearch] = useState<string>('');

  const [extraActivityName, setExtraActivityName] = useState<string>('');
  const [extraActivityFloor, setExtraActivityFloor] = useState<string>('');
  const [extraActivityMacro, setExtraActivityMacro] = useState<string>('');
  const [extraActivityTeam, setExtraActivityTeam] = useState<string>('');

  // Seleções do visualizador matricial
  const [matrixSelection, setMatrixSelection] = useState<{ isOpen: boolean; matrixId: string; type: 'macro' | 'floor' } | null>(null);

  // Gravação por voz
  const [listeningTaskId, setListeningTaskId] = useState<string | null>(null);
  const [micConnectingTaskId, setMicConnectingTaskId] = useState<string | null>(null);
  const [listeningComplementTaskId, setListeningComplementTaskId] = useState<string | null>(null);
  const [micConnectingComplementTaskId, setMicConnectingComplementTaskId] = useState<string | null>(null);
  const [editingComplementTaskId, setEditingComplementTaskId] = useState<string | null>(null);

  // Configurações e cadastros locais
  const [newFloorName, setNewFloorName] = useState<string>('');
  const [newPackageName, setNewPackageName] = useState<string>('');
  const [activeSection, setActiveSection] = useState<string>('');
  const [newItemName, setNewItemName] = useState<string>('');
  const [newTeamName, setNewTeamName] = useState<string>('');
  const [newDelayReason, setNewDelayReason] = useState<string>('');

  // Detalhamento PPC
  const [ppcSelectedContractor, setPpcSelectedContractor] = useState<string>('');
  const [ppcStartWeek, setPpcStartWeek] = useState<string>('');
  const [ppcEndWeek, setPpcEndWeek] = useState<string>('');

  // IA Insight cache
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  // Checkbox de exclusão em lote
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  // --- Mapeamento Reativo das Tarefas (Cronograma) ---
  const cronogramaInicial = useMemo(() => {
    return tasks.map(t => ({
      id: t.id,
      macro: t.packageName || 'GERAL',
      floor: t.lot || 'GERAL',
      service: t.service || t.packageName || 'SERVIÇO',
      duration: t.duration || 1,
      end: new Date(t.endDate + 'T12:00:00'),
      progress: t.progress || 0,
      cost: t.cost || 0
    }));
  }, [tasks]);

  const floors = useMemo(() => {
    return Array.from(new Set(cronogramaInicial.map(c => c.floor))).sort();
  }, [cronogramaInicial]);

  const allPossibleMacros = useMemo(() => {
    return Array.from(new Set(cronogramaInicial.map(c => c.macro))).sort();
  }, [cronogramaInicial]);

  // --- CARREGAMENTO INICIAL DO SUPABASE ---
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
    setSyncStatus('saving');
    const timer = window.setTimeout(() => {
      const stateToSave = {
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
      void saveShortTermState(projectId, stateToSave)
        .then(() => setSyncStatus('saved'))
        .catch((err) => {
          console.error('Error saving short term state:', err);
          setSyncStatus('error');
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [projectId, planning, teams, delayReasons, ppcHistory, teamPhones, projectCity, weatherApiKey, matrices, accessControl, persistenceReady]);

  // --- Efeito de Identificação Automática e Log de login ---
  useEffect(() => {
    if (!plannerUsername || teams.length === 0 || accessControl.users.length === 0) return;
    if (hasLoggedSession.current) return;
    
    hasLoggedSession.current = true;
    const trimmed = plannerUsername.trim();
    const isUserAdmin = trimmed.toLowerCase() === 'admin';
    const isAlreadyRegistered = accessControl.users.map(u => u.toLowerCase()).includes(trimmed.toLowerCase());

    let updatedUsers = [...accessControl.users];
    let updatedProjectAccess = { ...accessControl.projectAccess };

    if (!isUserAdmin && !isAlreadyRegistered) {
      updatedUsers.push(trimmed);
      const allProjIds = [projectId];
      allProjIds.forEach(pId => {
        const allowed = updatedProjectAccess[pId] || [];
        if (!allowed.map(u => u.toLowerCase()).includes(trimmed.toLowerCase())) {
          updatedProjectAccess[pId] = [...allowed, trimmed];
        }
      });
    }

    const newLog = {
      username: trimmed,
      timestamp: new Date().toISOString()
    };
    const updatedLogs = [newLog, ...(accessControl.logs || [])].slice(0, 100);

    const updated = {
      ...accessControl,
      users: updatedUsers,
      projectAccess: updatedProjectAccess,
      logs: updatedLogs
    };

    setAccessControl(updated);
  }, [plannerUsername, teams, accessControl.users, projectId]);

  // --- Função unificada para Login de Operador ---
  const handleOperatorLogin = (username: string) => {
    const trimmed = username.trim();
    if (!trimmed) return;
    localStorage.setItem('planner_username', trimmed);
    setPlannerUsername(trimmed);
    hasLoggedSession.current = true;

    const isUserAdmin = trimmed.toLowerCase() === 'admin';
    const isAlreadyRegistered = accessControl.users.map(u => u.toLowerCase()).includes(trimmed.toLowerCase());

    let updatedUsers = [...accessControl.users];
    let updatedProjectAccess = { ...accessControl.projectAccess };

    if (!isUserAdmin && !isAlreadyRegistered) {
      updatedUsers.push(trimmed);
      const allowed = updatedProjectAccess[projectId] || [];
      if (!allowed.map(u => u.toLowerCase()).includes(trimmed.toLowerCase())) {
        updatedProjectAccess[projectId] = [...allowed, trimmed];
      }
    }

    const newLog = {
      username: trimmed,
      timestamp: new Date().toISOString()
    };
    const updatedLogs = [newLog, ...(accessControl.logs || [])].slice(0, 100);

    setAccessControl({
      users: updatedUsers,
      projectAccess: updatedProjectAccess,
      logs: updatedLogs
    });
  };

  // --- Lógica de Clima (Visual Crossing Weather API) ---
  useEffect(() => {
    if (!projectCity) return;
    const weekDays = [0, 1, 2, 3, 4].map(idx => toISODate(addDays(currentWeekStart, idx)));
    const cacheMisses = weekDays.filter(d => !weatherCache[`${projectCity.trim().toLowerCase()}_${d}`]);
    if (cacheMisses.length === 0) return;

    if (!weatherApiKey) {
      // Simulação Determinística de Clima
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
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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
          return { ...t, observations: currentObs ? `${currentObs} ${text}` : text, lastUpdatedBy: plannerUsername || 'Sistema' };
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

  // --- Ditado de Complemento de Serviço ---
  const handleServiceComplementVoiceInput = (taskId: string) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
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
          return { ...t, serviceComplement: currentComp ? `${currentComp} ${text}` : text, lastUpdatedBy: plannerUsername || 'Sistema' };
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

  // --- Fechamento/Finalização de Semana ---
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
        const isCompleted = (t.progressThisWeek ?? 0) >= (t.plannedThisWeek ?? 100);
        if (!isCompleted && carryOverUnfinished) {
          carryOverTasks.push({
            id: slugify(`${t.activityId}_${nextWeekStart}_${t.responsible || 'extra'}`),
            weekId: nextWeekStart,
            activityId: t.activityId,
            activityName: t.activityName,
            floor: t.floor,
            sectionId: t.sectionId,
            responsible: t.responsible || '',
            efetivo: t.efetivo,
            plannedThisWeek: t.plannedThisWeek ?? 100,
            progressThisWeek: 0,
            executedBefore: Math.min(100, (t.executedBefore ?? 0) + (t.progressThisWeek ?? 0)),
            dailyWork: [0, 0, 0, 0, 0],
            delayReason: '',
            observations: '',
            finalized: false,
            isManual: t.isManual
          });
        }
        return { ...t, finalized: true };
      }
      return t;
    });

    const finalPlanningList = [...updatedPlanning, ...carryOverTasks];

    // Atualiza progresso acumulado de volta nas tarefas principais do Plano Total (setTasks)
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
    setNotification({ message: 'Semana finalizada com sucesso e progresso integrado no cronograma Geral!', type: 'success' });
  };

  // --- Função Inteligente de IA insight (Gemini) ---
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

  // --- Lógica de Estatísticas Gerais para Dashboard ---
  const currentWeekPpcStats = useMemo(() => {
    const weekId = toLocalDateString(currentWeekStart);
    const weekTasks = planning.filter(t => t.weekId === weekId);
    const totalPlannedCount = weekTasks.length;
    const completedCount = weekTasks.filter(t => (t.progressThisWeek ?? 0) >= (t.plannedThisWeek ?? 100)).length;
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

  // --- Relações e Filtros de Pesquisa ---
  const filteredCronograma = useMemo(() => {
    let list = [...cronogramaInicial];
    if (cronoSearch) {
      list = list.filter(c =>
        c.service.toLowerCase().includes(cronoSearch.toLowerCase()) ||
        c.macro.toLowerCase().includes(cronoSearch.toLowerCase())
      );
    }
    if (cronoFloorFilter) {
      list = list.filter(c => c.floor === cronoFloorFilter);
    }
    if (cronoMacroFilter) {
      list = list.filter(c => slugify(c.macro) === slugify(cronoMacroFilter));
    }
    if (cronoProgressFilter) {
      if (cronoProgressFilter === 'notstarted') list = list.filter(c => c.progress === 0);
      else if (cronoProgressFilter === 'inprogress') list = list.filter(c => c.progress > 0 && c.progress < 100);
      else if (cronoProgressFilter === 'done') list = list.filter(c => c.progress === 100);
    }
    list.sort((a: any, b: any) => {
      const aVal = a[cronoSortKey];
      const bVal = b[cronoSortKey];
      if (typeof aVal === 'string') {
        return cronoSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return cronoSortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [cronogramaInicial, cronoSearch, cronoFloorFilter, cronoMacroFilter, cronoProgressFilter, cronoSortKey, cronoSortDir]);

  const filteredWeeklyTasks = useMemo(() => {
    let list = [...weeklyTasks];
    if (planningSearch) {
      list = list.filter(t =>
        t.activityName.toLowerCase().includes(planningSearch.toLowerCase()) ||
        t.floor.toLowerCase().includes(planningSearch.toLowerCase()) ||
        t.sectionId.toLowerCase().includes(planningSearch.toLowerCase()) ||
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
      else if (planningStatusFilter === 'finalized') list = list.filter(t => t.finalized);
    }
    list.sort((a: any, b: any) => {
      const aVal = a[planningSortKey] || '';
      const bVal = b[planningSortKey] || '';
      if (typeof aVal === 'string') {
        return planningSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return planningSortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [weeklyTasks, planningSearch, planningTeamFilter, planningStatusFilter, planningSortKey, planningSortDir]);

  const filteredGiantPlanningTasks = useMemo(() => {
    let list = [...planning];
    if (giantSearch) {
      list = list.filter(t =>
        t.activityName.toLowerCase().includes(giantSearch.toLowerCase()) ||
        t.floor.toLowerCase().includes(giantSearch.toLowerCase()) ||
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
    list.sort((a: any, b: any) => {
      const aVal = a[giantSortKey] || '';
      const bVal = b[giantSortKey] || '';
      if (typeof aVal === 'string') {
        return giantSortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return giantSortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return list;
  }, [planning, giantSearch, giantFloorFilter, giantMacroFilter, giantStatusFilter, giantSortKey, giantSortDir]);

  // --- Função para aceitar apontamento vindo de campo ---
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

  // --- Funções Auxiliares de Atualização ---
  const handleUpdateTaskField = (taskId: string, field: string, val: any) => {
    setPlanning(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, [field]: val, lastUpdatedBy: plannerUsername || 'Sistema' };
      }
      return t;
    }));
  };

  const handlePlannedChange = (taskId: string, val: number) => {
    setPlanning(prev => prev.map(t => {
      if (t.id === taskId) {
        const plannedVal = t.plannedThisWeek === val ? 0 : val;
        return { ...t, plannedThisWeek: plannedVal, lastUpdatedBy: plannerUsername || 'Sistema' };
      }
      return t;
    }));
  };

  const handleWeeklyProgressChange = (taskId: string, val: number) => {
    setPlanning(prev => prev.map(t => {
      if (t.id === taskId) {
        const progVal = t.progressThisWeek === val ? 0 : val;
        const carryReason = progVal >= (t.plannedThisWeek ?? 100) ? '' : t.delayReason;
        return { ...t, progressThisWeek: progVal, delayReason: carryReason, lastUpdatedBy: plannerUsername || 'Sistema' };
      }
      return t;
    }));
  };

  const handleDailyWorkChange = (taskId: string, newDW: number[]) => {
    setPlanning(prev => prev.map(t => {
      if (t.id === taskId) {
        return { ...t, dailyWork: newDW, lastUpdatedBy: plannerUsername || 'Sistema' };
      }
      return t;
    }));
  };

  const handleBulkDelete = () => {
    if (selectedTaskIds.length === 0) return;
    triggerConfirm(
      'Remover Atividades',
      `Deseja realmente remover as ${selectedTaskIds.length} atividades selecionadas desta semana?`,
      () => {
        setPlanning(prev => prev.filter(t => !selectedTaskIds.includes(t.id)));
        setSelectedTaskIds([]);
        setNotification({ message: 'Atividades removidas com sucesso!', type: 'success' });
      }
    );
  };

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmDialog({ isOpen: true, title, message, onConfirm });
  };

  // --- Adicionar Atividades pelo Drawer ---
  const handleAddTasksFromDrawer = (tasksList: Array<{ id: string; serviceName: string; lot: string; packageName: string }>, teamName: string) => {
    const weekId = toLocalDateString(currentWeekStart);
    const newItems: ShortTermWeeklyItem[] = [];

    tasksList.forEach(t => {
      const uniqueId = slugify(`${t.id}_${weekId}_${teamName || 'extra'}`);
      if (planning.some(p => p.id === uniqueId)) return;

      newItems.push({
        id: uniqueId,
        weekId,
        activityId: t.id,
        activityName: t.serviceName,
        floor: t.lot,
        sectionId: t.packageName,
        responsible: teamName,
        efetivo: null,
        plannedThisWeek: 100,
        progressThisWeek: 0,
        executedBefore: 0,
        dailyWork: [0, 0, 0, 0, 0],
        delayReason: '',
        observations: '',
        finalized: false,
        isManual: false
      });
    });

    if (newItems.length > 0) {
      setPlanning(prev => [...prev, ...newItems]);
      setNotification({ message: `${newItems.length} atividades adicionadas com sucesso!`, type: 'success' });
    }
    setIsDrawerOpen(false);
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
    setNotification({ message: 'Atividade extra adicionada com sucesso!', type: 'success' });
  };

  // --- Lógica de Matriz Customizada ---
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

  const handleMatrixNameChange = (matrixId: string, value: string) => {
    setMatrices(prev => prev.map(m => m.id === matrixId ? { ...m, name: value.toUpperCase() } : m));
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

  const handleDragColOver = (e: React.DragEvent) => {
    e.preventDefault();
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

  const handleDragRowOver = (e: React.DragEvent) => {
    e.preventDefault();
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

  // Tooltip matricial
  const [tooltipState, setTooltipState] = useState<{ isOpen: boolean; x: number; y: number; content: string }>({ isOpen: false, x: 0, y: 0, content: '' });

  const showMatrixTooltip = (e: React.MouseEvent, content: string) => {
    setTooltipState({
      isOpen: true,
      x: e.clientX + 10,
      y: e.clientY + 10,
      content
    });
  };

  const hideMatrixTooltip = () => {
    setTooltipState(prev => ({ ...prev, isOpen: false }));
  };

  const saveMatrixName = () => {
    setNotification({ message: 'Nome do painel atualizado!', type: 'success' });
  };

  // --- Exportar CSV ---
  const handleExportCSV = () => {
    const listToExport = filteredGiantPlanningTasks;
    if (listToExport.length === 0) {
      alert('Nenhum dado para exportar.');
      return;
    }
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

  // --- Envio de WhatsApp ---
  const openWhatsappShareModal = () => {
    setWhatsappModal(true);
  };

  const handleSendWhatsApp = (teamName: string) => {
    const phone = teamPhones[teamName] || '';
    if (!phone) {
      alert(`Por favor, cadastre o telefone para a ${teamName} nas configurações primeiro.`);
      return;
    }
    const weekId = toLocalDateString(currentWeekStart);
    const appUrl = window.location.origin + window.location.pathname;
    const shareUrl = `${appUrl}?mode=team&u=${projectId}&t=${encodeURIComponent(teamName)}&w=${weekId}`;

    const text = `Olá, equipe da *${teamName}*! 🚀\nAqui está a sua lista de tarefas para a semana de *${formatDateBR(currentWeekStart)}*:\n\n` +
      weeklyTasks.filter(t => t.responsible === teamName).map((t, idx) => {
        return `${idx + 1}. *${t.activityName}* (${t.floor}) - Meta Planejada: *${t.plannedThisWeek}%*`;
      }).join('\n') +
      `\n\nPor favor, faça o apontamento do seu avanço diário acessando o link abaixo pelo celular:\n👉 ${shareUrl}`;

    window.open(`https://api.whatsapp.com/send?phone=${phone.replace(/\D/g, '')}&text=${encodeURIComponent(text)}`);
  };

  // --- RENDERIZAR TELA DE IMPRESSÃO ---
  const handlePrintPlanning = () => {
    const weekId = toLocalDateString(currentWeekStart);
    const appUrl = window.location.origin + window.location.pathname;
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
          .text-center { text-align: center; }
          .font-bold { font-weight: 700; }
          .badge { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 5px; font-size: 8px; font-weight: 800; text-transform: uppercase; }
          .btn-print { background: #4f46e5; color: #fff; border: 0; padding: 8px 16px; font-weight: 800; font-size: 10px; text-transform: uppercase; border-radius: 8px; cursor: pointer; }
          .btn-print:hover { background: #4338ca; }
          @media print {
            .no-print { display: none !important; }
            body { margin: 0; }
            table { page-break-inside: auto; }
            tr { page-break-inside: avoid; page-break-after: auto; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h1>Planejamento Físico Semanal</h1>
            <h2>${formatWeekId(weekId)}</h2>
          </div>
          <button class="btn-print no-print" onclick="window.print()">🖨️ Imprimir Planejamento</button>
        </div>

        <div class="controls no-print">
          <div>
            <label>Filtrar por Equipe Responsável:</label>
            <select id="teamSelect" onchange="filterTable()">
              <option value="">-- Todas as Equipes --</option>
              ${teamOptions.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Busca:</label>
            <input type="text" id="searchInput" placeholder="Digite para filtrar..." oninput="filterTable()" />
          </div>
        </div>

        <table id="planningTable">
          <thead>
            <tr>
              <th>Macroatividade</th>
              <th>Pavimento</th>
              <th>Serviço / Atividade</th>
              <th>Responsável / Equipe</th>
              <th class="text-center">Meta Planejada</th>
              <th class="text-center">Efetivo</th>
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
                <td class="text-center font-bold">${t.plannedThisWeek}%</td>
                <td class="text-center">${t.efetivo || '-'}</td>
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
              if (matchesTeam && matchesQuery) {
                row.style.display = '';
              } else {
                row.style.display = 'none';
              }
            });
          }
        </script>
      </body>
      </html>
    `);
    newWindow.document.close();
  };

  // --- Função para limpar notificações e diálogos ---
  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 3000);
    return () => clearTimeout(timer);
  }, [notification]);

  // --- Lógica de Controle de Acesso Admin ---
  const isSystemAdmin = (plannerUsername || '').toLowerCase() === 'admin' || isAccessAdmin;
  const isUserRegistered = accessControl.users.map(u => u.toLowerCase()).includes((plannerUsername || '').toLowerCase());
  const hasAccess = isSystemAdmin || !isUserRegistered || (accessControl.projectAccess[projectId] || []).map(u => u.toLowerCase()).includes((plannerUsername || '').toLowerCase());

  // Se o operador não estiver logado
  if (!plannerUsername) {
    return (
      <div className="min-h-[400px] bg-slate-900 font-sans text-slate-100 flex items-center justify-center p-4 relative overflow-hidden rounded-3xl">
        <div className="bg-slate-800/80 backdrop-blur-xl border border-slate-700/50 p-8 rounded-3xl shadow-2xl max-w-sm w-full space-y-6 relative z-10 text-center">
          <div className="space-y-2">
            <h2 className="text-xl font-black uppercase tracking-tight text-white">PLANEJAMENTO DE CURTO PRAZO</h2>
            <p className="text-[10px] text-indigo-300 uppercase tracking-widest font-bold">Identificação de Operador</p>
          </div>
          <div className="space-y-4">
            <div className="text-left space-y-1">
              <label className="block text-[9px] uppercase tracking-wider text-slate-400 font-black">Seu Nome / Função</label>
              <input
                type="text"
                placeholder="Ex: Kenzo, Engenharia, Planejador..."
                className="w-full p-3 bg-slate-900/50 border border-slate-700 rounded-xl text-xs font-bold text-white placeholder-slate-550 focus:ring-2 focus:ring-indigo-500 outline-none transition"
                id="username-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleOperatorLogin((e.target as HTMLInputElement).value);
                  }
                }}
              />
            </div>
            <button
              onClick={() => {
                const input = document.getElementById('username-input') as HTMLInputElement;
                if (input) handleOperatorLogin(input.value);
              }}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-xs tracking-wider rounded-xl shadow-lg transition active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
            >
              Entrar no Painel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Se o usuário não tiver acesso
  if (!hasAccess) {
    return (
      <div className="min-h-[400px] bg-slate-950 font-sans text-slate-100 flex items-center justify-center p-4 relative rounded-3xl">
        <div className="absolute top-4 right-4 z-20">
          <button 
            onClick={() => setShowAccessModal(true)}
            className="px-4 py-2 bg-indigo-650 hover:bg-indigo-700 text-white text-xs font-black uppercase rounded-xl transition shadow-md cursor-pointer"
          >
            🔐 Controle de Acesso
          </button>
        </div>
        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 p-8 rounded-3xl shadow-xl max-w-md text-center space-y-5">
          <span className="text-4xl">🔒</span>
          <h2 className="text-lg font-black uppercase tracking-tight text-white">Acesso Restrito</h2>
          <p className="text-xs text-slate-400 leading-relaxed font-bold">
            Você não tem permissão para visualizar o planejamento de curto prazo deste projeto. Contate o administrador do sistema para liberar seu acesso.
          </p>
          <button 
            onClick={() => {
              localStorage.removeItem('planner_username');
              setPlannerUsername('');
            }}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-black uppercase rounded-xl transition cursor-pointer"
          >
            Sair do Operador Atual
          </button>
        </div>
        {showAccessModal && renderAccessAdminModal()}
      </div>
    );
  }

  // --- FUNÇÕES DE LAYOUT DO MODAL ADMIN ---
  function renderAccessAdminModal() {
    return (
      <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-slate-850 p-6 rounded-3xl shadow-2xl max-w-2xl w-full space-y-6 max-h-[90vh] overflow-y-auto">
          <div className="flex justify-between items-start border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-black text-white uppercase tracking-tight">🔐 Painel Administrativo de Controle de Acesso</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Gerencie operadores e permissões de projetos</p>
            </div>
            <button 
              onClick={() => {
                setShowAccessModal(false);
                setIsAccessAdmin(false);
                setAccessUser('');
                setAccessPassword('');
              }}
              className="text-slate-400 hover:text-white font-black text-lg cursor-pointer"
            >
              &times;
            </button>
          </div>

          {!isAccessAdmin ? (
            <div className="space-y-4 max-w-sm mx-auto py-4">
              <div className="space-y-3 font-bold text-slate-700">
                <div>
                  <label className="block text-[9px] uppercase tracking-wider text-slate-400 font-black mb-1">Usuário Administrador</label>
                  <input 
                    type="text" 
                    className="w-full p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl text-xs font-bold text-white outline-none focus:ring-2 focus:ring-indigo-500" 
                    value={accessUser} 
                    onChange={e => setAccessUser(e.target.value)} 
                  />
                </div>
                <div>
                  <label className="block text-[9px] uppercase tracking-wider text-slate-400 font-black mb-1">Senha</label>
                  <input 
                    type="password" 
                    className="w-full p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl text-xs font-bold text-white outline-none focus:ring-2 focus:ring-indigo-500" 
                    value={accessPassword} 
                    onChange={e => setAccessPassword(e.target.value)} 
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        if (accessUser.toLowerCase() === 'admin' && accessPassword === 'admin') {
                          setIsAccessAdmin(true);
                        } else {
                          alert('Credenciais inválidas.');
                        }
                      }
                    }}
                  />
                </div>
              </div>
              <button 
                onClick={() => {
                  if (accessUser.toLowerCase() === 'admin' && accessPassword === 'admin') {
                    setIsAccessAdmin(true);
                  } else {
                    alert('Credenciais inválidas.');
                  }
                }}
                className="w-full py-2.5 bg-indigo-650 hover:bg-indigo-750 text-white font-black uppercase text-xs tracking-wider rounded-xl transition cursor-pointer"
              >
                Autenticar Admin
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="bg-slate-950/30 border border-slate-850 p-4 rounded-2xl space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-350">1. Cadastro de Operadores</h4>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    placeholder="Nome do operador..." 
                    className="flex-1 p-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-bold text-white outline-none focus:ring-2 focus:ring-indigo-500 uppercase"
                    value={newAccessUser}
                    onChange={e => setNewAccessUser(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const user = newAccessUser.trim();
                        if (!user) return;
                        if (accessControl.users.map(u => u.toLowerCase()).includes(user.toLowerCase())) {
                          alert('Usuário já cadastrado.');
                          return;
                        }
                        const updatedProjectAccess = { ...accessControl.projectAccess };
                        const allowed = updatedProjectAccess[projectId] || [];
                        if (!allowed.map(u => u.toLowerCase()).includes(user.toLowerCase())) {
                          updatedProjectAccess[projectId] = [...allowed, user];
                        }
                        setAccessControl({
                          users: [...accessControl.users, user],
                          projectAccess: updatedProjectAccess,
                          logs: accessControl.logs || []
                        });
                        setNewAccessUser('');
                      }
                    }}
                  />
                  <button 
                    onClick={() => {
                      const user = newAccessUser.trim();
                      if (!user) return;
                      if (accessControl.users.map(u => u.toLowerCase()).includes(user.toLowerCase())) {
                        alert('Usuário já cadastrado.');
                        return;
                      }
                      const updatedProjectAccess = { ...accessControl.projectAccess };
                      const allowed = updatedProjectAccess[projectId] || [];
                      if (!allowed.map(u => u.toLowerCase()).includes(user.toLowerCase())) {
                        updatedProjectAccess[projectId] = [...allowed, user];
                      }
                      setAccessControl({
                        users: [...accessControl.users, user],
                        projectAccess: updatedProjectAccess,
                        logs: accessControl.logs || []
                      });
                      setNewAccessUser('');
                    }}
                    className="px-4 bg-indigo-650 hover:bg-indigo-700 text-white text-xs font-black uppercase rounded-xl transition cursor-pointer"
                  >
                    Cadastrar
                  </button>
                </div>

                <div className="space-y-1.5 pt-1">
                  <span className="block text-[8px] text-slate-500 uppercase tracking-widest font-black">Usuários Cadastrados:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {accessControl.users.map(u => (
                      <span key={u} className="bg-slate-900 border border-slate-805 text-slate-300 font-bold text-[10px] px-2.5 py-1 rounded-xl flex items-center gap-1.5 hover:border-slate-700 transition">
                        <span>👤 {u}</span>
                        <button 
                          onClick={() => {
                            const updatedUsers = accessControl.users.filter(x => x !== u);
                            const updatedProjectAccess = { ...accessControl.projectAccess };
                            Object.keys(updatedProjectAccess).forEach(pId => {
                              updatedProjectAccess[pId] = (updatedProjectAccess[pId] || []).filter(x => x !== u);
                            });
                            setAccessControl({
                              users: updatedUsers,
                              projectAccess: updatedProjectAccess,
                              logs: accessControl.logs || []
                            });
                          }} 
                          className="text-slate-500 hover:text-red-400 font-black text-xs cursor-pointer"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    {accessControl.users.length === 0 && (
                      <span className="text-[10px] text-slate-550 italic uppercase font-bold">Nenhum usuário cadastrado.</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-350">2. Permissão de Acesso a esta Obra ({projectId})</h4>
                <p className="text-[9px] text-slate-550 uppercase tracking-tight font-bold">Clique no usuário para alternar a permissão de acesso.</p>
                <div className="flex flex-wrap gap-1.5">
                  {accessControl.users.map(u => {
                    const allowed = accessControl.projectAccess[projectId] || [];
                    const isAllowed = allowed.includes(u);
                    return (
                      <button
                        key={u}
                        onClick={() => {
                          let updatedAllowed: string[];
                          if (isAllowed) {
                            updatedAllowed = allowed.filter(x => x !== u);
                          } else {
                            updatedAllowed = [...allowed, u];
                          }
                          setAccessControl({
                            ...accessControl,
                            projectAccess: {
                              ...accessControl.projectAccess,
                              [projectId]: updatedAllowed
                            }
                          });
                        }}
                        className={`px-2.5 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wider transition cursor-pointer flex items-center gap-1 active:scale-95 ${
                          isAllowed 
                            ? 'bg-emerald-600 border border-emerald-500 text-white shadow-sm' 
                            : 'bg-slate-900 border border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <span>{isAllowed ? '✓' : '+'}</span>
                        <span>{u}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-955/40 border border-slate-850 p-4 rounded-2xl space-y-2.5">
                <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-350 flex justify-between items-center">
                  <span>3. Histórico de Acessos Recentes</span>
                  <button 
                    onClick={() => {
                      if (confirm('Deseja limpar todos os logs de acesso?')) {
                        setAccessControl({ ...accessControl, logs: [] });
                      }
                    }}
                    className="text-[8px] font-black uppercase text-rose-400 hover:text-rose-350 cursor-pointer"
                  >
                    Limpar Histórico
                  </button>
                </h4>
                <div className="max-h-[140px] overflow-y-auto pr-1 space-y-1.5 font-mono text-[9px] text-slate-400">
                  {(accessControl.logs || []).map((log, i) => (
                    <div key={i} className="flex justify-between items-center bg-slate-900/60 border border-slate-850 px-2.5 py-1.5 rounded-lg hover:border-slate-800 transition">
                      <span className="font-bold text-slate-300">👤 {log.username}</span>
                      <span className="text-slate-500 font-medium">{new Date(log.timestamp).toLocaleString('pt-BR')}</span>
                    </div>
                  ))}
                  {(accessControl.logs || []).length === 0 && (
                    <span className="text-[9px] text-slate-550 italic uppercase font-bold block py-2 text-center">Nenhum acesso registrado.</span>
                  )}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800 flex justify-end">
                <button 
                  onClick={() => {
                    setShowAccessModal(false);
                    setIsAccessAdmin(false);
                    setAccessUser('');
                    setAccessPassword('');
                  }} 
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-[10px] tracking-wider rounded-xl shadow-lg transition active:scale-98 cursor-pointer"
                >
                  Fechar Configurações
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- OUTROS SUB-MÉTO DOS INTERNOS DE INTERFACE ---

  function renderFinalizeWeekModal() {
    return (
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xl max-w-sm w-full space-y-4">
          <h3 className="text-sm font-black text-slate-850 uppercase tracking-tight">🏁 Finalização e Encerramento</h3>
          <p className="text-xs text-slate-500 leading-normal font-bold">
            Deseja fechar a semana atual? Isso consolidará o PPC histórico e integrará o progresso de volta ao cronograma geral.
          </p>
          <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer">
            <input 
              type="checkbox" 
              checked={finalizeModal?.carryOverUnfinished ?? true}
              onChange={(e) => setFinalizeModal(prev => prev ? { ...prev, carryOverUnfinished: e.target.checked } : null)}
              className="w-4 h-4 rounded text-indigo-650 focus:ring-indigo-500 cursor-pointer"
            />
            <span>Reprogramar tarefas não concluídas</span>
          </label>
          <div className="flex justify-end gap-2 text-[10px] font-black uppercase pt-2">
            <button onClick={() => setFinalizeModal(null)} className="px-4 py-2 border border-slate-200 rounded-xl cursor-pointer">Cancelar</button>
            <button onClick={() => handleFinalizeWeek(finalizeModal?.carryOverUnfinished ?? true)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl cursor-pointer">Finalizar Semana</button>
          </div>
        </div>
      </div>
    );
  }

  function renderWhatsAppModal() {
    return (
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-250 p-6 rounded-3xl shadow-xl max-w-md w-full space-y-4">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">💬 Compartilhar Link de Apontamento</h3>
            <button onClick={() => setWhatsappModal(false)} className="text-slate-400 hover:text-slate-655 font-bold text-base">&times;</button>
          </div>
          <p className="text-[10px] text-slate-400 font-bold leading-normal uppercase">
            Gere links diretos de WhatsApp direcionados para cada subempreiteiro preencher o relatório diário pelo celular.
          </p>
          <div className="max-h-[220px] overflow-y-auto pr-1 space-y-2">
            {teams.map(team => {
              const phone = teamPhones[team] || '';
              return (
                <div key={team} className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="min-w-0 flex-1 pr-2">
                    <span className="block text-[11px] font-black text-slate-850 uppercase truncate">{team}</span>
                    <span className="block text-[8px] text-slate-500 font-mono mt-0.5">{phone || 'Telefone não cadastrado'}</span>
                  </div>
                  <button 
                    onClick={() => handleSendWhatsApp(team)}
                    className="px-3 py-1.5 bg-indigo-650 hover:bg-indigo-700 text-white text-[9px] font-black uppercase rounded-lg transition active:scale-95 cursor-pointer"
                  >
                    Enviar Link
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  function renderDrawer() {
    const weekId = toLocalDateString(currentWeekStart);
    const plannedActivityIds = planning.filter(p => p.weekId === weekId).map(p => p.activityId);
    let candidates = cronogramaInicial.filter(c => !plannedActivityIds.includes(c.id));

    if (drawerMacro) {
      candidates = candidates.filter(c => slugify(c.macro) === slugify(drawerMacro));
    }
    if (drawerFloor) {
      candidates = candidates.filter(c => c.floor === drawerFloor);
    }
    if (drawerSearch) {
      candidates = candidates.filter(c => c.service.toLowerCase().includes(drawerSearch.toLowerCase()));
    }

    return (
      <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-50 flex justify-end">
        <div className="w-full max-w-md bg-white h-full shadow-2xl p-6 flex flex-col justify-between border-l border-slate-200 overflow-y-auto">
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b pb-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">➕ Programar Novas Atividades</h3>
              <button onClick={() => setIsDrawerOpen(false)} className="text-slate-450 hover:text-slate-700 font-bold text-xl cursor-pointer">&times;</button>
            </div>

            <div className="space-y-2.5 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-[9px] font-black uppercase text-slate-450">
              <div>
                <label className="block mb-1">Filtrar por Pacote (Macro)</label>
                <select 
                  className="w-full p-2 border border-slate-250 bg-white rounded-lg text-xs font-bold outline-none text-slate-800 font-mono"
                  value={drawerMacro}
                  onChange={e => setDrawerMacro(e.target.value)}
                >
                  <option value="">-- Todos os Pacotes --</option>
                  {allPossibleMacros.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1">Filtrar por Pavimento</label>
                <select 
                  className="w-full p-2 border border-slate-250 bg-white rounded-lg text-xs font-bold outline-none text-slate-800"
                  value={drawerFloor}
                  onChange={e => setDrawerFloor(e.target.value)}
                >
                  <option value="">-- Todos os Pavimentos --</option>
                  {floors.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1">Pesquisar por Serviço</label>
                <input 
                  type="text" 
                  placeholder="Nome do serviço..." 
                  className="w-full p-2 border border-slate-250 bg-white rounded-lg text-xs outline-none text-slate-800"
                  value={drawerSearch}
                  onChange={e => setDrawerSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[8px] font-black uppercase text-slate-400">Associar à Equipe de Execução</label>
              <select 
                id="drawerTeamSelect"
                className="w-full p-2.5 border border-slate-250 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold outline-none"
              >
                <option value="">-- Sem Alocação --</option>
                {teams.map(team => <option key={team} value={team}>{team}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <span className="block text-[8px] font-black text-slate-405 uppercase tracking-widest">Serviços Disponíveis ({candidates.length})</span>
              <div className="max-h-[220px] overflow-y-auto pr-1 space-y-1.5">
                {candidates.map(c => (
                  <div key={c.id} className="flex justify-between items-center p-2.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl">
                    <div className="min-w-0 flex-1 pr-2">
                      <span className="block text-[11px] font-bold text-slate-800 uppercase leading-tight truncate">{c.service}</span>
                      <span className="block text-[8px] text-slate-450 uppercase mt-0.5">{c.floor} | {c.macro}</span>
                    </div>
                    <button 
                      onClick={() => {
                        const teamSel = (document.getElementById('drawerTeamSelect') as HTMLSelectElement).value;
                        handleAddTasksFromDrawer([{ id: c.id, serviceName: c.service, lot: c.floor, packageName: c.macro }], teamSel);
                      }}
                      className="px-2.5 py-1.5 bg-indigo-650 hover:bg-indigo-755 text-white text-[9px] font-black uppercase rounded-lg transition"
                    >
                      + Puxar
                    </button>
                  </div>
                ))}
                {candidates.length === 0 && (
                  <div className="text-center py-6 text-slate-400 italic text-[10px] uppercase font-bold">Nenhum serviço disponível.</div>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 my-4 pt-4 space-y-3">
              <h4 className="text-[10px] font-black uppercase text-indigo-950 tracking-wider">Atividade Extra Não Prevista</h4>
              {drawerWarning && <div className="text-[9px] font-black uppercase text-rose-600">{drawerWarning}</div>}
              <div className="space-y-2.5 font-bold text-slate-700">
                <input 
                  type="text" 
                  placeholder="NOME DO SERVIÇO EXTRA..." 
                  className="w-full p-2.5 border border-slate-200 rounded-xl text-xs outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800 placeholder-slate-400"
                  value={extraActivityName}
                  onChange={e => setExtraActivityName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input 
                    type="text" 
                    placeholder="PAVIMENTO..." 
                    className="p-2.5 border border-slate-200 rounded-xl text-xs outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800 placeholder-slate-400"
                    value={extraActivityFloor}
                    onChange={e => setExtraActivityFloor(e.target.value)}
                  />
                  <input 
                    type="text" 
                    placeholder="PACOTE..." 
                    className="p-2.5 border border-slate-200 rounded-xl text-xs outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800 placeholder-slate-400"
                    value={extraActivityMacro}
                    onChange={e => setExtraActivityMacro(e.target.value)}
                  />
                </div>
                <select 
                  className="w-full p-2.5 border border-slate-200 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold outline-none"
                  value={extraActivityTeam}
                  onChange={e => setExtraActivityTeam(e.target.value)}
                >
                  <option value="">-- Escolha a Equipe --</option>
                  {teams.map(team => <option key={team} value={team}>{team}</option>)}
                </select>
                <button 
                  onClick={handleAddManualTask}
                  className="w-full py-2.5 bg-indigo-650 hover:bg-indigo-755 text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition shadow-sm cursor-pointer"
                >
                  Programar Serviço Extra
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
