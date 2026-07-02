export type Page =
  | 'projects'
  | 'dashboard'
  | 'schedule'
  | 'line'
  | 'procurement'
  | 'medium'
  | 'short'
  | 'financial'
  | 'settings';

export type Project = {
  id: string;
  name: string;
  imageUrl: string;
  address: string;
  area: number;
  status: string;
  startDate: string;
  plannedEndDate: string;
};

export type Task = {
  id: string;
  lotMother: string;
  lot: string;
  packageName: string;
  packageFamily: string;
  startDate: string;
  endDate: string;
  progress: number;
  color: string;
  quantity?: number;
  unit?: string;
  cost?: number;
};

export type ProcurementCard = {
  id: string;
  stage: string;
  status: string;
  item: string;
  code: string;
  required: number;
  ordered: number;
  contracted: number;
  delivered: number;
  unit: string;
  coverage: number;
};
