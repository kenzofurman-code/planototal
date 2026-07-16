import React, { useState, useEffect } from 'react';
import { loadShortTermState, saveShortTermState, type ShortTermWeeklyItem } from '../lib/shortTermRepository';

// Utilitário de data idêntico
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

interface ShortTermTeamScreenProps {
  projectId: string;
  teamName: string;
  weekStartDate: string;
}

export function ShortTermTeamScreen({ projectId, teamName, weekStartDate }: ShortTermTeamScreenProps) {
  // --- Estados de dados ---
  const [planning, setPlanning] = useState<ShortTermWeeklyItem[]>([]);
  const [teams, setTeams] = useState<string[]>([]);
  const [delayReasons, setDelayReasons] = useState<string[]>([]);
  const [ppcHistory, setPpcHistory] = useState<any[]>([]);
  const [teamPhones, setTeamPhones] = useState<{ [teamName: string]: string }>({});
  const [projectCity, setProjectCity] = useState<string>('Curitiba, PR');
  const [weatherApiKey, setWeatherApiKey] = useState<string>('');
  const [matrices, setMatrices] = useState<any[]>([]);
  const [accessControl, setAccessControl] = useState<any>({ users: [], projectAccess: {}, logs: [] });

  const [loading, setLoading] = useState<boolean>(true);
  const [submitSuccess, setSubmitSuccess] = useState<boolean>(false);

  // Armazena os valores imputados da equipe antes de submeter
  const [teamInputs, setTeamInputs] = useState<{
    [taskId: string]: {
      progress: number;
      delayReason: string;
      observations: string;
    };
  }>({});

  const [listeningTaskId, setListeningTaskId] = useState<string | null>(null);
  const [micConnectingTaskId, setMicConnectingTaskId] = useState<string | null>(null);

  // --- CARREGAMENTO INICIAL ---
  useEffect(() => {
    setLoading(true);
    void loadShortTermState(projectId)
      .then((state) => {
        if (state) {
          setPlanning(state.weekly ?? []);
          setTeams(state.teams ?? []);
          setDelayReasons(state.reasons ?? []);
          setPpcHistory(state.history ?? []);
          setTeamPhones(state.teamPhones ?? {});
          setProjectCity(state.projectCity ?? 'Curitiba, PR');
          setWeatherApiKey(state.weatherApiKey ?? '');
          setMatrices(state.matrices ?? []);
          setAccessControl(state.accessControl ?? { users: [], projectAccess: {}, logs: [] });

          // Inicializa os inputs com os dados atuais da semana
          const initialInputs: typeof teamInputs = {};
          const currentWeekTasks = (state.weekly ?? []).filter(t => t.weekId === weekStartDate && t.responsible === teamName);
          currentWeekTasks.forEach(t => {
            initialInputs[t.id] = {
              progress: t.preFilledProgress !== undefined ? t.preFilledProgress : t.progressThisWeek,
              delayReason: t.preFilledDelayReason !== undefined ? t.preFilledDelayReason : t.delayReason,
              observations: t.preFilledObservations !== undefined ? t.preFilledObservations : (t.observations || '')
            };
          });
          setTeamInputs(initialInputs);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading short term state in team screen:', err);
        setLoading(false);
      });
  }, [projectId, teamName, weekStartDate]);

  // --- Beep de áudio ---
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

  // --- Ditado por voz ---
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
      const currentInput = teamInputs[taskId] || { progress: 0, delayReason: '', observations: '' };
      setTeamInputs({
        ...teamInputs,
        [taskId]: {
          ...currentInput,
          observations: currentInput.observations ? `${currentInput.observations} ${text}` : text
        }
      });
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

  const handleProgressChange = (taskId: string, progress: number) => {
    const currentInput = teamInputs[taskId] || { progress: 0, delayReason: '', observations: '' };
    const taskObj = planning.find(t => t.id === taskId);
    const planned = taskObj?.plannedThisWeek ?? 100;
    const carryReason = progress >= planned ? '' : currentInput.delayReason;

    setTeamInputs({
      ...teamInputs,
      [taskId]: {
        ...currentInput,
        progress,
        delayReason: carryReason
      }
    });
  };

  const handleFieldChange = (taskId: string, field: 'delayReason' | 'observations', val: string) => {
    const currentInput = teamInputs[taskId] || { progress: 0, delayReason: '', observations: '' };
    setTeamInputs({
      ...teamInputs,
      [taskId]: {
        ...currentInput,
        [field]: val
      }
    });
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const updatedPlanning = planning.map(t => {
        if (t.weekId === weekStartDate && t.responsible === teamName) {
          const input = teamInputs[t.id] || { progress: 0, delayReason: '', observations: '' };
          return {
            ...t,
            preFilledProgress: input.progress,
            preFilledDelayReason: input.progress < (t.plannedThisWeek ?? 100) ? input.delayReason : '',
            preFilledObservations: input.observations,
            preFilledAt: new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR')
          };
        }
        return t;
      });

      const stateToSave = {
        weekly: updatedPlanning,
        teams,
        reasons: delayReasons,
        history: ppcHistory,
        teamPhones,
        projectCity,
        weatherApiKey,
        matrices,
        accessControl
      };

      await saveShortTermState(projectId, stateToSave);
      setSubmitSuccess(true);
    } catch (err: any) {
      console.error(err);
      alert('Erro ao enviar dados: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- RENDERS ---

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-4">
        <div className="flex gap-2 mb-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-3 h-3 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <p className="text-xs uppercase font-black tracking-widest text-slate-400">Carregando painel de campo...</p>
      </div>
    );
  }

  if (submitSuccess) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center p-6 text-center space-y-6">
        <div className="w-20 h-20 bg-emerald-500/20 border border-emerald-500 rounded-full flex items-center justify-center text-4xl shadow-xl animate-bounce">
          🎉
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-black uppercase tracking-tight text-white">Relatório Enviado com sucesso!</h2>
          <p className="text-xs text-slate-400 font-bold uppercase leading-relaxed max-w-xs">
            Obrigado, equipe da {teamName}! Seu progresso foi enviado ao engenheiro para consolidação.
          </p>
        </div>
        <p className="text-[10px] text-slate-500 font-mono">Pode fechar esta janela agora.</p>
      </div>
    );
  }

  const teamTasksList = planning.filter(t => t.weekId === weekStartDate && t.responsible === teamName);

  return (
    <div className="short-team-screen min-h-screen bg-slate-950 font-sans text-slate-100 pb-16">
      {/* Header */}
      <header className="bg-slate-900 border-b border-slate-800 p-4 sticky top-0 z-20 flex flex-col justify-between gap-1.5 shadow-md">
        <div>
          <span className="px-2 py-0.5 bg-indigo-900/50 border border-indigo-700 text-indigo-300 rounded text-[8px] font-black uppercase tracking-widest">
            Apontamento de Campo
          </span>
          <h1 className="text-base font-black text-white uppercase tracking-tight mt-1">{teamName}</h1>
        </div>
        <div className="text-[10px] font-bold text-slate-400 uppercase font-mono">
          📅 {formatWeekId(weekStartDate)}
        </div>
      </header>

      {/* Cards de Tarefas */}
      <main className="p-4 space-y-4 max-w-md mx-auto">
        {teamTasksList.map((t) => {
          const input = teamInputs[t.id] || { progress: 0, delayReason: '', observations: '' };
          const planned = t.plannedThisWeek ?? 100;
          const isDelayed = input.progress < planned;

          return (
            <div key={t.id} className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg space-y-4">
              <div className="space-y-1">
                <span className="px-2 py-0.5 bg-slate-800 border border-slate-700 text-slate-400 text-[8px] font-black rounded uppercase tracking-wider">
                  {t.floor}
                </span>
                <h3 className="text-sm font-black text-white uppercase leading-snug">{t.activityName}</h3>
                {t.serviceComplement && (
                  <span className="text-[9px] font-black text-indigo-400 uppercase tracking-wide block">
                    ↳ {t.serviceComplement}
                  </span>
                )}
              </div>

              {/* Seletor de Avanço */}
              <div className="space-y-1.5">
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wide">
                  Meta Planejada: <span className="text-white">{planned}%</span> | Avanço Realizado:
                </label>
                <div className="grid grid-cols-5 gap-1.5 font-bold text-slate-700">
                  {[0, 25, 50, 75, 100].map(val => {
                    const isActive = input.progress === val;
                    const isOk = val >= planned;
                    const btnColor = isOk ? 'team-progress-ok' : 'team-progress-delay';

                    return (
                      <button
                        key={val}
                        onClick={() => handleProgressChange(t.id, val)}
                        className={`py-2 rounded-xl text-xs font-black transition active:scale-95 cursor-pointer border ${
                          isActive 
                            ? `${btnColor} text-white shadow-md scale-105` 
                            : 'team-progress-idle'
                        }`}
                      >
                        {val}%
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Justificativa de Atraso */}
              {isDelayed && (
                <div className="space-y-1">
                  <label className="block text-[9px] font-black text-red-400 uppercase tracking-wide">
                    ⚠️ Motivo do Atraso/Desvio:
                  </label>
                  <div className="relative inline-block w-full min-h-[36px] bg-slate-950 border border-slate-800 rounded-xl hover:border-slate-700 transition">
                    <span className="block text-xs font-black py-2.5 px-3 uppercase text-rose-400 truncate">
                      {input.delayReason || 'Selecione o motivo...'}
                    </span>
                    <select
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      value={input.delayReason}
                      onChange={e => handleFieldChange(t.id, 'delayReason', e.target.value)}
                    >
                      <option value="">⚠️ Escolha o Motivo</option>
                      {delayReasons.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {/* Observações de Campo */}
              <div className="space-y-1">
                <label className="block text-[9px] font-black text-slate-400 uppercase tracking-wide">
                  Notas de Campo / Observações:
                </label>
                <div className="flex gap-2 items-start">
                  <textarea
                    rows={2}
                    placeholder="Descreva problemas, faltas ou observações..."
                    className="flex-1 p-3 bg-slate-950 border border-slate-800 text-slate-200 rounded-xl text-xs outline-none focus:border-indigo-500 resize-none font-bold placeholder-slate-600"
                    value={input.observations}
                    onChange={e => handleFieldChange(t.id, 'observations', e.target.value)}
                  />
                  <button
                    onClick={() => handleVoiceInput(t.id)}
                    className={`p-3.5 rounded-full transition active:scale-95 text-sm shrink-0 shadow-lg ${
                      listeningTaskId === t.id 
                        ? 'bg-red-600 text-white animate-pulse'
                        : 'bg-indigo-900/50 text-indigo-300 border border-indigo-700'
                    }`}
                    title="Gravar observação por voz"
                  >
                    🎙️
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {teamTasksList.length === 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center text-slate-500 italic text-xs font-bold uppercase py-12">
            Nenhuma tarefa planejada para você nesta semana.
          </div>
        )}

        {teamTasksList.length > 0 && (
          <button
            onClick={handleSubmit}
            className="team-submit w-full py-3.5 text-white font-black uppercase text-xs tracking-wider rounded-xl shadow-lg transition active:scale-95 cursor-pointer"
          >
            Enviar Apontamentos
          </button>
        )}
      </main>
    </div>
  );
}
