import type { ProcurementCard, Project, Task } from './types';

export const projects: Project[] = [
  {
    id: 'nizza',
    name: 'Nizza Residencial',
    imageUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200&auto=format&fit=crop',
    address: 'Curitiba - PR',
    area: 18500,
    status: 'ativo',
    startDate: '2025-08-01',
    plannedEndDate: '2026-11-30',
  },
  {
    id: 'demo-2',
    name: 'Obra Exemplo',
    imageUrl: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?q=80&w=1200&auto=format&fit=crop',
    address: 'São Paulo - SP',
    area: 9200,
    status: 'planejamento',
    startDate: '2026-01-05',
    plannedEndDate: '2027-02-20',
  },
];

export const tasks: Task[] = [
  { id: 't7-est', lotMother: 'TORRE-PAVIMENTOS', lot: '7º Pav tipo', packageName: 'ESTRUTURA', packageFamily: 'ESTRUTURA', startDate: '2025-09-01', endDate: '2025-09-15', progress: 100, color: '#264653', cost: 50000 },
  { id: 't7-alv', lotMother: 'TORRE-PAVIMENTOS', lot: '7º Pav tipo', packageName: 'ALVENARIA', packageFamily: 'ALVENARIA', startDate: '2025-11-11', endDate: '2025-11-24', progress: 60, color: '#f97316', quantity: 850, unit: 'm²', cost: 120000 },
  { id: 't7-ins', lotMother: 'TORRE-PAVIMENTOS', lot: '7º Pav tipo', packageName: 'INSTALAÇÕES 1', packageFamily: 'INSTALAÇÕES', startDate: '2025-12-08', endDate: '2025-12-19', progress: 20, color: '#0f766e' },
  { id: 't7-emb', lotMother: 'TORRE-PAVIMENTOS', lot: '7º Pav tipo', packageName: 'EMBOÇO/GL', packageFamily: 'REVESTIMENTO', startDate: '2026-01-12', endDate: '2026-01-23', progress: 0, color: '#3b7a78' },

  { id: 't6-est', lotMother: 'TORRE-PAVIMENTOS', lot: '6º Pav tipo', packageName: 'ESTRUTURA', packageFamily: 'ESTRUTURA', startDate: '2025-08-18', endDate: '2025-08-29', progress: 100, color: '#264653' },
  { id: 't6-alv', lotMother: 'TORRE-PAVIMENTOS', lot: '6º Pav tipo', packageName: 'ALVENARIA', packageFamily: 'ALVENARIA', startDate: '2025-10-28', endDate: '2025-11-10', progress: 80, color: '#f97316' },
  { id: 't6-ins', lotMother: 'TORRE-PAVIMENTOS', lot: '6º Pav tipo', packageName: 'INSTALAÇÕES 1', packageFamily: 'INSTALAÇÕES', startDate: '2025-11-24', endDate: '2025-12-05', progress: 40, color: '#0f766e' },

  { id: 'fd-bal', lotMother: 'FACHADA', lot: 'Fachada D', packageName: 'BALANCIM', packageFamily: 'FACHADA', startDate: '2026-01-06', endDate: '2026-01-19', progress: 0, color: '#6b7280' },
  { id: 'fd-emb', lotMother: 'FACHADA', lot: 'Fachada D', packageName: 'EMBOÇO EXT.', packageFamily: 'FACHADA', startDate: '2026-02-10', endDate: '2026-03-18', progress: 0, color: '#3b7a78' },
  { id: 'fd-esq', lotMother: 'FACHADA', lot: 'Fachada D', packageName: 'ESQUADRIAS', packageFamily: 'ESQUADRIAS', startDate: '2026-06-10', endDate: '2026-07-03', progress: 0, color: '#2563eb' },
];

export const procurement: ProcurementCard[] = [
  { id: 'pc1', stage: 'Pedido emitido', status: 'Parcial', item: 'Cimento CP-II', code: 'CIM-001', required: 1000, ordered: 50, contracted: 0, delivered: 0, unit: 'sc', coverage: 5 },
  { id: 'pc2', stage: 'Contrato emitido', status: 'Completo contratado', item: 'Esquadrias torre', code: 'ESQ-001', required: 1, ordered: 1, contracted: 1, delivered: 0, unit: 'vb', coverage: 100 },
  { id: 'pc3', stage: 'A solicitar', status: 'Pendente', item: 'Revestimento cerâmico', code: 'REV-010', required: 2500, ordered: 0, contracted: 0, delivered: 0, unit: 'm²', coverage: 0 },
];
