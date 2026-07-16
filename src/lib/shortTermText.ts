export type ShortTermTextTask = {
  activityName?: string;
  floor?: string;
  serviceComplement?: string;
  plannedThisWeek?: number;
  executedBefore?: number;
  executedBeforeRaw?: number;
};

type Gender = 'm' | 'f' | null;

const stripServicePrefix = (value: string | undefined) => {
  return String(value || 'servico')
    .replace(/^MO\s*[-:]?\s*/i, '')
    .trim();
};

const getFirstWord = (value: string) => {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)[0] || '';
};

const inferPortugueseGender = (value: string, exceptionMap: Record<string, 'm' | 'f'> = {}): Gender => {
  const text = String(value || '').trim().toLocaleLowerCase('pt-BR');
  const firstWord = getFirstWord(text);
  if (!firstWord) return null;
  if (exceptionMap[firstWord]) return exceptionMap[firstWord];

  if (/(cao|gem|dade|ura|aria|eira|icao|ao)$/.test(firstWord)) return 'f';
  if (/(mento|ico|oco|aco|iso|rro|rso|or|eiro|io|o)$/.test(firstWord)) return 'm';
  if (firstWord.endsWith('a')) return 'f';

  return null;
};

const SERVICE_GENDER_EXCEPTIONS: Record<string, 'm' | 'f'> = {
  alvenaria: 'f',
  armacao: 'f',
  cobertura: 'f',
  fachada: 'f',
  fiada: 'f',
  forma: 'f',
  impermeabilizacao: 'f',
  instalacao: 'f',
  laje: 'f',
  limpeza: 'f',
  pintura: 'f',
  parede: 'f',
  regularizacao: 'f',
  tubulacao: 'f',
  contrapiso: 'm',
  emboco: 'm',
  forro: 'm',
  gesso: 'm',
  piso: 'm',
  reboco: 'm',
  revestimento: 'm',
  servico: 'm'
};

const LOCATION_GENDER_EXCEPTIONS: Record<string, 'm' | 'f'> = {
  cobertura: 'f',
  fachada: 'f',
  garagem: 'f',
  periferia: 'f',
  torre: 'f',
  area: 'f',
  apto: 'm',
  apartamento: 'm',
  bloco: 'm',
  pavimento: 'm',
  subsolo: 'm',
  terreo: 'm'
};

const getServicePhrase = (service: string | undefined, complement = '') => {
  const cleanService = stripServicePrefix(service).toLocaleLowerCase('pt-BR');
  const gender = inferPortugueseGender(cleanService, SERVICE_GENDER_EXCEPTIONS);
  const suffix = complement ? ` ${complement}` : '';

  if (gender === 'f') return { direct: `a ${cleanService}${suffix}`, partitive: `da ${cleanService}${suffix}` };
  if (gender === 'm') return { direct: `o ${cleanService}${suffix}`, partitive: `do ${cleanService}${suffix}` };

  return { direct: `servico de ${cleanService}${suffix}`, partitive: `do servico de ${cleanService}${suffix}` };
};

const getLocationPhrase = (floor: string | undefined) => {
  const cleanFloor = String(floor || 'pavimento').trim();
  const normalizedFloor = cleanFloor
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (/^\d/.test(normalizedFloor) || /\bpav(imento)?\b/.test(normalizedFloor)) return `no ${cleanFloor}`;

  const gender = inferPortugueseGender(cleanFloor, LOCATION_GENDER_EXCEPTIONS);

  if (gender === 'f') return `na ${cleanFloor}`;
  if (gender === 'm') return `no ${cleanFloor}`;
  return `em ${cleanFloor}`;
};

export const getServiceTextSet = (task: ShortTermTextTask) => {
  const planned = Number(task?.plannedThisWeek ?? 100);
  const previous = Number(task?.executedBeforeRaw ?? task?.executedBefore ?? 0);
  const service = String(task?.activityName || 'servico').trim();
  const complement = task?.serviceComplement ? `(${task.serviceComplement})` : '';
  const floor = String(task?.floor || 'pavimento').trim();
  const servicePhrase = getServicePhrase(service, complement);
  const locationPhrase = getLocationPhrase(floor);
  const directText = `${servicePhrase.direct} ${locationPhrase}`;
  const partitiveText = `${servicePhrase.partitive} ${locationPhrase}`;

  if (planned >= 100) {
    return {
      whatsapp: `Finalizar ${directText}`,
      done: previous <= 0 ? 'Servico iniciado e finalizado!' : 'Servico finalizado!',
      pending: previous <= 0 ? 'Servico nao iniciado' : 'Ainda faltou um pouco'
    };
  }

  if (planned >= 75) {
    if (previous <= 0) {
      return {
        whatsapp: `Iniciar e fazer mais da metade ${partitiveText}`,
        done: 'Servico iniciado e em andamento!',
        pending: 'Servico nao iniciou'
      };
    }

    return {
      whatsapp: `Fazer mais da metade ${partitiveText}`,
      done: 'Mais da metade concluida',
      pending: 'Nao avancou'
    };
  }

  if (planned >= 50) {
    return {
      whatsapp: previous <= 0 ? `Iniciar e fazer metade ${partitiveText}` : `Fazer metade ${partitiveText}`,
      done: 'Terminamos metade',
      pending: previous <= 0 ? 'Servico nao iniciou' : 'Nao avancou'
    };
  }

  return {
    whatsapp: `Iniciar ${directText}`,
    done: 'Servico iniciado!',
    pending: 'Servico nao iniciado'
  };
};

export const getSimpleServiceInstruction = (task: ShortTermTextTask) => {
  return getServiceTextSet(task).whatsapp;
};

export const getFieldProgressOptions = (task: ShortTermTextTask) => {
  const { done, pending } = getServiceTextSet(task);
  return { done, pending };
};
