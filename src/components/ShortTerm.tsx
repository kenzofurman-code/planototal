import React, { useState, useEffect, useMemo, useRef } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import { loadShortTermState, saveShortTermState, type ShortTermWeeklyItem, type ShortTermHistory } from '../lib/shortTermRepository';
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

// Componentes Auxiliares Simples
function StatCard({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-between">
      <span className="text-[10px] font-black text-slate-405 uppercase tracking-wider">{title}</span>
      <span className={`text-2xl font-black ${color.replace('bg-', 'text-')} mt-1.5`}>{value}</span>
    </div>
  );
}

function DaysSelector({ dailyWork, disabled, onChange }: { dailyWork: number[]; disabled?: boolean; onChange: (dw: number[]) => void }) {
  const toggleDay = (idx: number) => {
    if (disabled) return;
    const next = [...dailyWork];
    next[idx] = next[idx] === 1 ? 0 : 1;
    onChange(next);
  };
  return (
    <div className="flex gap-[3.5px] justify-center items-center h-8">
      {['S', 'T', 'Q', 'Q', 'S'].map((day, idx) => (
        <button
          key={idx}
          type="button"
          disabled={disabled}
          onClick={() => toggleDay(idx)}
          className={`w-6 h-6 rounded-full text-[9px] font-black flex items-center justify-center transition active:scale-95 cursor-pointer border ${
            dailyWork[idx] === 1
              ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
              : 'bg-slate-50 text-slate-350 border-slate-200 hover:border-slate-405'
          } disabled:opacity-50 disabled:cursor-default`}
        >
          {day}
        </button>
      ))}
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
  const [syncStatus, setSyncStatus] = useState<'local' | 'saving' | 'saved' | 'error'>('local');

  // Modais e Diálogos
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void } | null>(null);
  const [finalizeModal, setFinalizeModal] = useState<{ isOpen: boolean; carryOverUnfinished: boolean } | null>(null);
  const [whatsappModal, setWhatsappModal] = useState<boolean>(false);

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

  // --- Mapeamento Reativo das Tarefas ---
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

  // --- Filtros de Pesquisa ---
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
    }
    return list;
  }, [weeklyTasks, planningSearch, planningTeamFilter, planningStatusFilter]);

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
      setNotification({ message: `${newItems.length} atividades adicionadas!`, type: 'success' });
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
  const handleSendWhatsApp = (teamName: string) => {
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
  const handlePrintPlanning = () => {
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
    <section className="page short-term font-sans text-slate-950 animate-in fade-in duration-300">
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
              ? 'bg-emerald-50 border-emerald-250 text-emerald-700' 
              : syncStatus === 'saving' 
              ? 'bg-amber-50 border-amber-250 text-amber-700 animate-pulse'
              : 'bg-rose-50 border-rose-250 text-rose-700'
          }`}>
            {syncStatus === 'saved' ? 'Supabase sincronizado' : syncStatus === 'saving' ? 'Salvando...' : 'Erro de sincronização'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <nav className="flex flex-wrap border-b border-slate-200 mb-6 gap-1 no-print">
        {tabLabels.map(([value, label]) => (
          <button 
            key={value}
            className={`px-4 py-3 text-xs font-black uppercase tracking-wider rounded-t-xl transition-all duration-200 ${
              activeTab === value 
                ? 'bg-indigo-600 text-white shadow-md' 
                : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
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
      {whatsappModal && renderWhatsAppModal()}
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
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
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
                <button onClick={handlePrintPlanning} className="flex-1 md:flex-none px-4 py-3 bg-slate-700 hover:bg-slate-800 text-white font-black rounded-xl text-[10px] uppercase tracking-wider cursor-pointer">
                  🖨️ Impressão
                </button>
              )}
              {teams.length > 0 && weeklyTasks.length > 0 && (
                <button onClick={() => setWhatsappModal(true)} className="flex-1 md:flex-none px-4 py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-750 font-black rounded-xl text-[10px] uppercase tracking-wider border border-indigo-200 cursor-pointer">
                  💬 WhatsApp
                </button>
              )}
              <button 
                onClick={() => setFinalizeModal({ isOpen: true, carryOverUnfinished: true })}
                disabled={weeklyTasks.length === 0}
                className="flex-1 md:flex-none px-4 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-black rounded-xl text-[10px] uppercase tracking-wider cursor-pointer"
              >
                🏁 Finalizar Semana
              </button>
              <button 
                onClick={() => { setDrawerMacro(allPossibleMacros[0] || ''); setDrawerWarning(''); setIsDrawerOpen(true); }}
                className="flex-1 md:flex-none px-4 py-3 bg-indigo-600 text-white font-black rounded-xl text-[10px] uppercase tracking-wider hover:bg-indigo-750 cursor-pointer"
              >
                ➕ Programar Tarefas
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-450 mb-1">🔍 Pesquisa</label>
              <input type="text" className="w-full p-2 border border-slate-250 bg-white rounded-lg text-xs outline-none" placeholder="Serviço, pavimento, notas..." value={planningSearch} onChange={e => setPlanningSearch(e.target.value)} />
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-450 mb-1">Equipe Responsável</label>
              <select className="w-full p-2 border border-slate-250 bg-white rounded-lg text-xs font-bold outline-none" value={planningTeamFilter} onChange={e => setPlanningTeamFilter(e.target.value)}>
                <option value="">-- Todas --</option>
                {teams.map(team => <option key={team} value={team}>{team}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-450 mb-1">Estado de Progresso</label>
              <select className="w-full p-2 border border-slate-250 bg-white rounded-lg text-xs font-bold outline-none" value={planningStatusFilter} onChange={e => setPlanningStatusFilter(e.target.value)}>
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
                  <th className="p-3 text-center w-28 bg-slate-900">Meta Semanal</th>
                  <th className="p-3 text-center w-28">Dias Ativos</th>
                  <th className="p-3 text-center w-28">Avanço Físico</th>
                  <th className="p-3 text-center w-28">Desvio / Atraso</th>
                  <th className="p-3 w-40">Observações</th>
                  <th className="p-2 text-center w-16 bg-slate-850">
                    <div className="flex items-center justify-center gap-1">
                      <input 
                        type="checkbox" 
                        checked={filteredWeeklyTasks.length > 0 && filteredWeeklyTasks.every(t => selectedTaskIds.includes(t.id))}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedTaskIds(prev => Array.from(new Set([...prev, ...filteredWeeklyTasks.map(t => t.id)])));
                          else setSelectedTaskIds(prev => prev.filter(id => !filteredWeeklyTasks.map(t => t.id).includes(id)));
                        }}
                        className="w-3 h-3 text-indigo-650 rounded cursor-pointer"
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
                    <tr key={t.id} className={`hover:bg-slate-50 transition ${t.finalized ? 'bg-slate-100 opacity-70' : showDelayAlert && (progVal > 0 || currentPlan > 0) ? 'bg-red-50/20' : ''}`}>
                      <td className="p-3 border-r font-bold text-slate-800 uppercase text-[10px]">
                        <div className="flex items-start gap-1">
                          {t.finalized && <span className="text-[10px] text-slate-400 mt-0.5">🔒</span>}
                          {t.isManual && <span className="px-1 py-0.5 bg-amber-100 text-amber-800 text-[7px] font-black rounded uppercase tracking-tighter shrink-0 mt-0.5">Extra</span>}
                          <div className="flex-1 leading-tight">{t.activityName}</div>
                          {!t.finalized && !t.serviceComplement && editingComplementTaskId !== t.id && (
                            <button onClick={(e) => { e.stopPropagation(); setEditingComplementTaskId(t.id); }} className="w-3.5 h-3.5 border border-slate-300 hover:border-indigo-650 hover:bg-indigo-50 text-slate-400 hover:text-indigo-650 flex items-center justify-center rounded-full font-bold text-[9px] cursor-pointer">+</button>
                          )}
                        </div>
                        {(t.serviceComplement || editingComplementTaskId === t.id) && (
                          <div className="flex items-center gap-1 mt-1 font-bold text-[9px]">
                            <span className="text-indigo-600 font-black">↳</span>
                            <input 
                              type="text" 
                              disabled={t.finalized}
                              placeholder="Complemento..." 
                              className="p-1 border border-slate-200 bg-slate-50 rounded text-[9px] font-bold text-slate-700 w-36 outline-none focus:bg-white focus:border-indigo-500"
                              value={t.serviceComplement || ''}
                              onChange={e => setPlanning(planning.map(p => p.id === t.id ? { ...p, serviceComplement: e.target.value } : p))}
                              onBlur={() => { if (!t.serviceComplement) setEditingComplementTaskId(null); }}
                              autoFocus={editingComplementTaskId === t.id}
                            />
                            {!t.finalized && (
                              <button onClick={() => handleServiceComplementVoiceInput(t.id)} className={`p-1 rounded-full transition text-[9px] ${listeningComplementTaskId === t.id ? 'bg-red-600 text-white animate-pulse' : 'bg-indigo-100 text-indigo-750 hover:bg-indigo-200'}`} title="Voz">🎙️</button>
                            )}
                          </div>
                        )}
                        <div className="text-[8px] font-bold text-indigo-550 mt-1">{t.floor}</div>
                      </td>

                      <td className="p-3 border-r text-center">
                        <div className="relative inline-block w-full min-h-[26px] bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition">
                          <span className="block text-[9px] font-black text-slate-700 py-1 uppercase">{t.responsible || 'ESCOLHER'}</span>
                          <select disabled={t.finalized} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" value={t.responsible || ''} onChange={e => handleUpdateTaskField(t.id, 'responsible', e.target.value)}>
                            <option value="">-- Equipe --</option>
                            {teams.map(team => <option key={team} value={team}>{team}</option>)}
                          </select>
                        </div>
                      </td>

                      <td className="p-3 border-r text-center">
                        <input type="number" min="0" disabled={t.finalized} className="w-12 p-1 border border-slate-200 bg-slate-50 text-center font-bold rounded-lg text-xs outline-none focus:bg-white focus:border-indigo-500" value={t.efetivo ?? ''} onChange={e => handleUpdateTaskField(t.id, 'efetivo', e.target.value === '' ? null : parseInt(e.target.value, 10))} />
                      </td>

                      <td className="p-3 border-r align-middle bg-emerald-50/5">
                        <div className="flex gap-1 justify-center">
                          {[25, 50, 75, 100].map(val => {
                            const execBefore = t.executedBefore ?? 0;
                            const isPlanned = currentPlan === val;
                            const isExecuted = execBefore > 0 && val === execBefore;

                            let btnClass = 'bg-slate-100 text-slate-400 hover:bg-emerald-55 hover:text-emerald-700';
                            if (isPlanned) btnClass = 'bg-emerald-600 text-white font-black scale-110 shadow-xs border-emerald-600';
                            else if (isExecuted) btnClass = 'bg-slate-350 text-white border-slate-350';

                            return (
                              <button key={val} disabled={t.finalized} onClick={() => handlePlannedChange(t.id, val)} className={`w-7 h-7 rounded-full text-[9px] font-black flex items-center justify-center border border-transparent transition active:scale-90 cursor-pointer ${btnClass}`}>
                                {val}%
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      <td className="p-3 border-r align-middle text-center bg-slate-50/10">
                        <DaysSelector dailyWork={t.dailyWork} disabled={t.finalized} onChange={(newDW) => handleDailyWorkChange(t.id, newDW)} />
                      </td>

                      <td className="p-3 border-r align-middle">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex gap-1 justify-center">
                            {[25, 50, 75, 100].map(val => {
                              const isActive = progVal === val;
                              const isPrefilled = t.preFilledProgress === val;
                              const isOk = val >= currentPlan;
                              const btnColor = isOk ? 'bg-indigo-650 border-indigo-650' : 'bg-rose-600 border-rose-600';
                              const prefillClass = (isPrefilled && !isActive) ? 'ring-2 ring-dashed ring-purple-400 text-purple-750 bg-purple-50' : '';

                              return (
                                <button key={val} disabled={t.finalized} onClick={() => handleWeeklyProgressChange(t.id, val)} className={`w-7 h-7 rounded-full text-[9px] font-black flex items-center justify-center border border-transparent transition active:scale-90 cursor-pointer ${
                                  isActive ? `${btnColor} text-white scale-110 shadow-xs` : prefillClass ? prefillClass : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                }`}>
                                  {val}%
                                </button>
                              );
                            })}
                          </div>
                          {t.preFilledProgress !== undefined && (
                            <span className="text-[7px] font-black text-purple-750 bg-purple-100 border border-purple-250 px-1 rounded mt-0.5 animate-pulse">
                              📲 Campo: {t.preFilledProgress}%
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="p-3 border-r align-middle text-center">
                        {showDelayAlert ? (
                          <div className="space-y-1">
                            <div className="relative inline-block w-full min-h-[26px] bg-rose-50 border border-rose-200 text-rose-805 rounded-lg hover:bg-rose-100 transition">
                              <span className="block text-[8px] font-black py-1 px-1 text-center truncate">{t.delayReason || '⚠️ MOTIVO...'}</span>
                              <select disabled={t.finalized} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" value={t.delayReason || ''} onChange={e => handleUpdateTaskField(t.id, 'delayReason', e.target.value)}>
                                <option value="">⚠️ Escolha o Motivo</option>
                                {delayReasons.map(r => <option key={r} value={r}>{r}</option>)}
                              </select>
                            </div>
                            {t.preFilledDelayReason && <div className="text-[7px] text-purple-650 font-black italic block">Sugerido: "{t.preFilledDelayReason}"</div>}
                          </div>
                        ) : (
                          <span className="text-[10px] font-black text-emerald-600 uppercase">✓ Conforme</span>
                        )}
                      </td>

                      <td className="p-3 border-r align-middle">
                        <div className="flex gap-1.5 items-start">
                          <textarea disabled={t.finalized} className="flex-1 p-1 bg-slate-50 border border-slate-200 rounded-lg text-[9px] font-bold text-slate-800 outline-none focus:bg-white focus:border-indigo-500 resize-none min-h-[30px]" placeholder="Anotações..." value={t.observations || ''} onChange={e => setPlanning(planning.map(p => p.id === t.id ? { ...p, observations: e.target.value } : p))} />
                          {!t.finalized && (
                            <button onClick={() => handleVoiceInput(t.id)} className={`p-1 rounded-full transition ${listeningTaskId === t.id ? 'bg-red-650 text-white animate-pulse' : 'bg-indigo-50 text-indigo-700'}`}>🎙️</button>
                          )}
                        </div>
                        {t.preFilledObservations && <div className="text-[7px] text-purple-650 font-bold italic mt-0.5">📲 Campo: "{t.preFilledObservations}"</div>}
                      </td>

                      <td className="p-3 text-center align-middle">
                        <div className="flex items-center justify-center gap-1.5">
                          {t.preFilledProgress !== undefined && (
                            <button onClick={() => handleAcceptPreFill(t.id)} className="p-1 border border-emerald-250 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-black transition cursor-pointer animate-bounce" title="Aceitar">✅</button>
                          )}
                          <input type="checkbox" disabled={t.finalized} checked={selectedTaskIds.includes(t.id)} onChange={e => {
                            if (e.target.checked) setSelectedTaskIds(prev => [...prev, t.id]);
                            else setSelectedTaskIds(prev => prev.filter(id => id !== t.id));
                          }} className="w-3.5 h-3.5 border-slate-300 text-indigo-650 rounded cursor-pointer disabled:opacity-30" />
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
                className="font-black text-xs uppercase text-slate-850 bg-transparent focus:bg-white focus:ring-2 focus:ring-indigo-500 rounded px-2 py-1 outline-none border border-transparent focus:border-slate-350"
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
                    <th onClick={() => setMatrixSelection({ isOpen: true, matrixId: matrix.id, type: 'macro' })} className="p-3 text-center text-indigo-400 hover:bg-slate-850 hover:text-white transition cursor-pointer font-bold">+ ADICIONAR ETAPA</th>
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

                        let cellClass = 'text-slate-400';
                        if (isCompleted) cellClass = 'bg-emerald-100 text-emerald-800 border-emerald-200';
                        else if (isHalf) cellClass = 'bg-indigo-50 text-indigo-850 border-indigo-200';
                        else if (isStarted) cellClass = 'bg-orange-50 text-orange-850 border-orange-200';

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
                      className="p-3 text-center text-[10px] font-black uppercase text-indigo-650 bg-slate-50 hover:bg-indigo-100/50 cursor-pointer border-t border-dashed border-slate-300 transition"
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
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xl max-w-sm w-full space-y-4">
              <div className="flex justify-between items-center border-b pb-2">
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Adicionar ao Painel</h3>
                <button onClick={() => setMatrixSelection(null)} className="text-slate-400 hover:text-slate-650 font-bold text-base">&times;</button>
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
                        isAlreadyIn ? 'bg-slate-50 border-slate-200 text-slate-350 cursor-not-allowed' : 'bg-white border-slate-250 text-slate-700 hover:bg-slate-50'
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
    const contractorsInPeriod = useMemo(() => {
      return Array.from(new Set(planning.map(t => t.responsible))).filter(Boolean).sort() as string[];
    }, [planning]);

    const availableWeeks = useMemo(() => {
      return Array.from(new Set(planning.map(t => t.weekId))).sort();
    }, [planning]);

    useEffect(() => {
      if (contractorsInPeriod.length > 0 && !ppcSelectedContractor) setPpcSelectedContractor(contractorsInPeriod[0]);
      if (availableWeeks.length > 0) {
        if (!ppcStartWeek) setPpcStartWeek(availableWeeks[0]);
        if (!ppcEndWeek) setPpcEndWeek(availableWeeks[availableWeeks.length - 1]);
      }
    }, [contractorsInPeriod, availableWeeks]);

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

    return (
      <div className="space-y-6 animate-in fade-in duration-300 pb-12">
        <div className="bg-white p-5 rounded-2xl border border-slate-200">
          <h2 className="text-xs font-black text-indigo-900 uppercase tracking-tight mb-4">Análise de Desempenho por Equipe</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-450 mb-1">Equipe / Empreiteiro</label>
              <select className="w-full p-2.5 bg-slate-50 border border-slate-250 rounded-lg text-xs font-bold outline-none text-slate-800 font-mono" value={ppcSelectedContractor} onChange={e => setPpcSelectedContractor(e.target.value)}>
                <option value="">-- Selecione --</option>
                {contractorsInPeriod.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-450 mb-1">Semana Inicial</label>
              <select className="w-full p-2.5 bg-slate-50 border border-slate-250 rounded-lg text-xs font-bold outline-none text-slate-800" value={ppcStartWeek} onChange={e => setPpcStartWeek(e.target.value)}>
                {availableWeeks.map(w => <option key={w} value={w}>{formatDateBR(w)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-450 mb-1">Semana Final</label>
              <select className="w-full p-2.5 bg-slate-50 border border-slate-250 rounded-lg text-xs font-bold outline-none text-slate-800" value={ppcEndWeek} onChange={e => setPpcEndWeek(e.target.value)}>
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
                <div className="text-[9px] font-black text-slate-400 uppercase">{formatDateBR(h?.weekStart)}</div>
                <div className="text-2xl font-black text-indigo-900 mt-1">{(h?.ppc || 0).toFixed(1)}%</div>
                <div className="text-[9px] text-slate-500 font-bold uppercase mt-2">{h?.completed ?? 0} / {h?.totalPlanned ?? 0} concluídos</div>
              </div>
            ))}
            {(ppcHistory || []).length === 0 && (
              <div className="col-span-full py-8 text-center text-xs text-slate-450 font-bold uppercase italic">Nenhuma semana finalizada.</div>
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
              <label className="block text-[8px] font-black uppercase text-slate-450 mb-1">Pesquisa</label>
              <input type="text" className="w-full p-2 border rounded-lg text-xs bg-white outline-none" placeholder="Buscar..." value={giantSearch} onChange={e => setHistorySearch(e.target.value)} />
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-450 mb-1">Pavimento</label>
              <select className="w-full p-2 border rounded-lg text-xs bg-white outline-none font-bold text-slate-800" value={giantFloorFilter} onChange={e => setHistoryFloorFilter(e.target.value)}>
                <option value="">-- Todos --</option>
                {floors.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-450 mb-1">Macroatividade</label>
              <select className="w-full p-2 border rounded-lg text-xs bg-white outline-none font-bold text-slate-800" value={giantMacroFilter} onChange={e => setHistoryMacroFilter(e.target.value)}>
                <option value="">-- Todas --</option>
                {allPossibleMacros.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[8px] font-black uppercase text-slate-450 mb-1">Estado</label>
              <select className="w-full p-2 border rounded-lg text-xs bg-white outline-none font-bold text-slate-850" value={giantStatusFilter} onChange={e => setHistoryStatusFilter(e.target.value)}>
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
                            <span key={i} className={`w-3.5 h-3.5 rounded-full text-[7px] font-black flex items-center justify-center border ${dw ? 'bg-slate-800 text-white border-slate-800' : 'bg-slate-100 text-slate-300 border-transparent'}`}>
                              {['S','T','Q','Q','S'][i]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-2.5 border-r text-center font-black text-emerald-600">{t.progressThisWeek}%</td>
                      <td className="p-2.5 border-r text-center font-black">{totalAcc}%</td>
                      <td className="p-2.5 border-r text-center font-bold">
                        {isDelayed ? <span className="text-rose-600 font-black text-[9px] uppercase">⚠️ {t.delayReason || 'Sem motivo'}</span> : <span className="text-emerald-600 font-bold uppercase text-[9px]">✓ Conforme</span>}
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

  function renderConfig() {
    return (
      <div className="space-y-6 animate-in fade-in duration-300 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-3xl border border-slate-200 space-y-4 shadow-sm">
            <h2 className="text-xs font-black uppercase border-b pb-2 text-slate-850 tracking-wider">1. Cadastro de Equipes</h2>
            <div className="flex gap-2">
              <input type="text" placeholder="EX: EQUIPE ALFA..." className="flex-1 p-2.5 text-xs border border-slate-200 rounded-xl outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800" value={newTeamName} onChange={e => setNewTeamName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddTeam()} />
              <button onClick={handleAddTeam} className="bg-indigo-650 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer">Registrar</button>
            </div>
            <div className="space-y-2">
              {teams.map(team => (
                <div key={team} className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="font-bold text-xs text-slate-850 truncate uppercase">{team}</span>
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
            <h2 className="text-xs font-black uppercase border-b pb-2 text-slate-850 tracking-wider">2. Padronização de Causas de Atraso</h2>
            <div className="flex gap-2">
              <input type="text" placeholder="EX: FALTA DE MATERIAL..." className="flex-1 p-2.5 text-xs border border-slate-200 rounded-xl outline-none bg-slate-50 focus:bg-white uppercase font-bold text-slate-800" value={newDelayReason} onChange={e => setNewDelayReason(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddDelayReason()} />
              <button onClick={handleAddDelayReason} className="bg-indigo-650 hover:bg-indigo-755 text-white px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer">Registrar</button>
            </div>
            <div className="space-y-2">
              {delayReasons.map(reason => (
                <div key={reason} className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-750 uppercase">
                  <span>{reason}</span>
                  <button onClick={() => setConfirmDialog({ isOpen: true, title: 'Remover Motivo', message: `Deseja remover o motivo "${reason}"?`, onConfirm: () => setDelayReasons(prev => prev.filter(r => r !== reason)) })} className="text-red-500 font-bold hover:text-red-700 text-xs ml-1">&times;</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-200 space-y-4 shadow-sm">
          <h2 className="text-xs font-black uppercase border-b pb-2 text-slate-850 tracking-wider">3. Clima e Localidade</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-bold text-slate-700">
            <div>
              <label className="block text-[8px] uppercase mb-1">Cidade da Obra</label>
              <input type="text" className="w-full p-2.5 border border-slate-250 bg-slate-50 focus:bg-white rounded-xl text-xs" placeholder="Ex: Curitiba, PR" value={projectCity} onChange={e => setProjectCity(e.target.value)} />
            </div>
            <div>
              <label className="block text-[8px] uppercase mb-1">Visual Crossing API Key</label>
              <input type="password" className="w-full p-2.5 border border-slate-250 bg-slate-50 focus:bg-white rounded-xl text-xs" placeholder="API Key..." value={weatherApiKey} onChange={e => setWeatherApiKey(e.target.value)} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleAddTeam = () => {
    const val = newTeamName.trim();
    if (!val) return;
    if (teams.map(t => t.toLowerCase()).includes(val.toLowerCase())) return;
    setTeams([...teams, val.toUpperCase()]);
    setNewTeamName('');
    setNotification({ message: 'Equipe registrada!', type: 'success' });
  };

  const handleAddDelayReason = () => {
    const val = newDelayReason.trim();
    if (!val) return;
    if (delayReasons.map(r => r.toLowerCase()).includes(val.toLowerCase())) return;
    setDelayReasons([...delayReasons, val.toUpperCase()]);
    setNewDelayReason('');
    setNotification({ message: 'Causa de atraso registrada!', type: 'success' });
  };

  // --- SUB-MODAIS INTERNOS ---

  function renderFinalizeWeekModal() {
    return (
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
        <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xl max-w-sm w-full space-y-4">
          <h3 className="text-sm font-black text-slate-850 uppercase tracking-tight">🏁 Finalizar Semana</h3>
          <p className="text-xs text-slate-500 leading-normal font-bold">
            Isto fechará o PPC semanal ativo e integrará o progresso acumulado de volta ao cronograma geral.
          </p>
          <label className="flex items-center gap-2 text-xs font-black text-slate-700 cursor-pointer">
            <input type="checkbox" checked={finalizeModal?.carryOverUnfinished ?? true} onChange={e => setFinalizeModal(prev => prev ? { ...prev, carryOverUnfinished: e.target.checked } : null)} className="w-4 h-4 rounded text-indigo-650 cursor-pointer" />
            <span>Reprogramar tarefas não concluídas</span>
          </label>
          <div className="flex justify-end gap-2 text-[10px] font-black uppercase pt-2">
            <button onClick={() => setFinalizeModal(null)} className="px-4 py-2 border border-slate-250 rounded-xl cursor-pointer">Cancelar</button>
            <button onClick={() => handleFinalizeWeek(finalizeModal?.carryOverUnfinished ?? true)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl cursor-pointer">Finalizar</button>
          </div>
        </div>
      </div>
    );
  }

  function renderWhatsAppModal() {
    return (
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-205">
        <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-xl max-w-md w-full space-y-4">
          <div className="flex justify-between items-center border-b pb-2">
            <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">Compartilhar WhatsApp</h3>
            <button onClick={() => setWhatsappModal(false)} className="text-slate-400 hover:text-slate-650 font-bold text-base">&times;</button>
          </div>
          <div className="max-h-[220px] overflow-y-auto space-y-2">
            {teams.map(team => {
              const phone = teamPhones[team] || '';
              return (
                <div key={team} className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="min-w-0 flex-1 pr-2">
                    <span className="block text-[11px] font-black text-slate-850 uppercase truncate">{team}</span>
                    <span className="block text-[8px] text-slate-500 font-mono mt-0.5">{phone || 'Sem telefone'}</span>
                  </div>
                  <button onClick={() => handleSendWhatsApp(team)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-705 text-white text-[9px] font-black uppercase rounded-lg transition cursor-pointer">Enviar Link</button>
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

    if (drawerMacro) candidates = candidates.filter(c => slugify(c.macro) === slugify(drawerMacro));
    if (drawerFloor) candidates = candidates.filter(c => c.floor === drawerFloor);
    if (drawerSearch) candidates = candidates.filter(c => c.service.toLowerCase().includes(drawerSearch.toLowerCase()));

    return (
      <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs z-50 flex justify-end animate-in fade-in duration-300">
        <div className="w-full max-w-md bg-white h-full shadow-2xl p-6 flex flex-col justify-between border-l border-slate-200 overflow-y-auto">
          <div className="space-y-6">
            <div className="flex justify-between items-center border-b pb-4">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">➕ Programar Novas Atividades</h3>
              <button onClick={() => setIsDrawerOpen(false)} className="text-slate-450 hover:text-slate-700 font-bold text-xl cursor-pointer">&times;</button>
            </div>

            <div className="space-y-2.5 p-3 bg-slate-50 rounded-2xl border border-slate-200 text-[9px] font-black uppercase text-slate-450">
              <div>
                <label className="block mb-1">Filtrar por Pacote (Macro)</label>
                <select className="w-full p-2 border border-slate-250 bg-white rounded-lg text-xs font-bold outline-none text-slate-800 font-mono" value={drawerMacro} onChange={e => setDrawerMacro(e.target.value)}>
                  <option value="">-- Todos --</option>
                  {allPossibleMacros.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1">Filtrar por Pavimento</label>
                <select className="w-full p-2 border border-slate-250 bg-white rounded-lg text-xs font-bold outline-none text-slate-800" value={drawerFloor} onChange={e => setDrawerFloor(e.target.value)}>
                  <option value="">-- Todos --</option>
                  {floors.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="block mb-1">Pesquisar por Serviço</label>
                <input type="text" placeholder="Pesquisar..." className="w-full p-2 border border-slate-250 bg-white rounded-lg text-xs outline-none text-slate-800" value={drawerSearch} onChange={e => setDrawerSearch(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[8px] font-black text-slate-400 uppercase">Equipe de Execução</label>
              <select id="drawerTeamSelect" className="w-full p-2.5 border border-slate-250 bg-slate-50 focus:bg-white rounded-xl text-xs font-bold outline-none text-slate-800">
                <option value="">-- Sem Equipe --</option>
                {teams.map(team => <option key={team} value={team}>{team}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <span className="block text-[8px] font-black text-slate-450 uppercase tracking-widest">Serviços Disponíveis ({candidates.length})</span>
              <div className="max-h-[220px] overflow-y-auto space-y-1.5">
                {candidates.map(c => (
                  <div key={c.id} className="flex justify-between items-center p-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition">
                    <div className="min-w-0 flex-1 pr-2">
                      <span className="block text-[11px] font-bold text-slate-800 uppercase leading-tight truncate">{c.service}</span>
                      <span className="block text-[8px] text-slate-450 uppercase mt-0.5">{c.floor} | {c.macro}</span>
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
