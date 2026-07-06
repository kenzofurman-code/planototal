import { supabase } from './supabase';

export type BudgetType = 'contractor' | 'financing';
export type BudgetItem = {
  id: string;
  level: string;
  code: string;
  description: string;
  material: number;
  labor: number;
  total: number;
};
export type BudgetRevision = {
  projectKey: string;
  type: BudgetType;
  name: string;
  versionId?: string;
  versionNumber?: number;
  items: BudgetItem[];
  allocations: BudgetAllocation[];
};
export type DivisionType = 'manual' | 'equal' | 'duration' | 'quantity' | 'area' | 'percentage' | 'inherited';
export type BudgetAllocation = {
  id?: string;
  budgetId: string;
  taskId: string;
  parentTaskId?: string;
  packageName?: string;
  serviceName?: string;
  lotName?: string;
  divisionType: DivisionType;
  weight: number;
  value: number;
  inheritedFromId?: string;
};
export type FinancialLotArea = { lotMother: string; lotName: string; projectionArea: number };

export async function loadBudgets(projectKey: string): Promise<BudgetRevision[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('financial_budgets').select('project_key,type,name,active_version_id,items,allocations').eq('project_key', projectKey);
  if (error) throw error;
  const activeIds = (data ?? []).map((row) => row.active_version_id).filter(Boolean);
  const { data: versions, error: versionsError } = await supabase.from('financial_budget_versions').select('id,version_number').in('id', activeIds.length ? activeIds : ['00000000-0000-0000-0000-000000000000']);
  if (versionsError) throw versionsError;
  const { data: itemRows, error: itemsError } = await supabase.from('financial_budget_items').select('*').in('version_id', activeIds.length ? activeIds : ['00000000-0000-0000-0000-000000000000']);
  if (itemsError) throw itemsError;
  const { data: allocationRows, error: allocationsError } = await supabase.from('financial_budget_allocations').select('*').eq('project_key', projectKey);
  if (allocationsError) throw allocationsError;
  return (data ?? []).map((row) => {
    const normalizedItems = (itemRows ?? []).filter((item) => item.version_id === row.active_version_id).map((item) => ({
      id: item.id, level: item.level ?? '', code: item.code, description: item.description,
      material: Number(item.material_cost), labor: Number(item.labor_cost), total: Number(item.total_cost)
    }));
    const activeItemIds = new Set(normalizedItems.map((item) => item.id));
    const normalizedAllocations = (allocationRows ?? []).filter((item) =>
      item.version_id === row.active_version_id && activeItemIds.has(item.budget_item_id)
    ).map((item) => ({
      id: item.id, budgetId: item.budget_item_id, taskId: item.schedule_task_external_id,
      parentTaskId: item.parent_schedule_task_external_id ?? undefined, packageName: item.package_name ?? undefined,
      serviceName: item.service_name ?? undefined, lotName: item.lot_name ?? undefined,
      divisionType: item.division_type as DivisionType, weight: Number(item.item_weight_percent),
      value: Number(item.allocated_cost), inheritedFromId: item.inherited_from_allocation_id ?? undefined
    }));
    const fallbackItems = Array.isArray(row.items) ? row.items as BudgetItem[] : [];
    const fallbackAllocations = Array.isArray(row.allocations) ? row.allocations as BudgetAllocation[] : [];
    return {
      projectKey: row.project_key,
      type: row.type as BudgetType,
      name: row.name,
      versionId: row.active_version_id ?? undefined,
      versionNumber: versions?.find((version) => version.id === row.active_version_id)?.version_number,
      items: normalizedItems.length ? normalizedItems : fallbackItems,
      allocations: normalizedItems.length ? normalizedAllocations : fallbackAllocations
    };
  });
}

export async function saveBudget(revision: BudgetRevision) {
  if (!supabase) return;
  let versionId = revision.versionId;
  const creatingVersion = !versionId;
  if (!versionId) {
    const { data: last } = await supabase.from('financial_budget_versions').select('version_number')
      .eq('project_key', revision.projectKey).eq('budget_type', revision.type)
      .order('version_number', { ascending: false }).limit(1).maybeSingle();
    await supabase.from('financial_budget_versions').update({
      status: 'archived', archived_at: new Date().toISOString()
    }).eq('project_key', revision.projectKey).eq('budget_type', revision.type).eq('status', 'active');
    const created = await supabase.from('financial_budget_versions').insert({
      project_key: revision.projectKey, budget_type: revision.type,
      version_number: (last?.version_number ?? 0) + 1, name: revision.name,
      status: 'active', activated_at: new Date().toISOString()
    }).select('id').single();
    if (created.error) throw created.error;
    versionId = created.data.id;
    revision.versionId = versionId;
    revision.versionNumber = (last?.version_number ?? 0) + 1;
  }
  if (creatingVersion) {
    const replacementIds = new Map<string, string>();
    revision.items = revision.items.map((item) => {
      const id = crypto.randomUUID();
      replacementIds.set(item.id, id);
      return { ...item, id };
    });
    revision.allocations = revision.allocations.map((allocation) => ({
      ...allocation,
      id: undefined,
      budgetId: replacementIds.get(allocation.budgetId) ?? allocation.budgetId,
      inheritedFromId: undefined
    }));
  }
  const { error } = await supabase.from('financial_budgets').upsert({
    project_key: revision.projectKey,
    type: revision.type,
    name: revision.name.trim() || (revision.type === 'contractor' ? 'Orçamento da construtora' : 'Orçamento de financiamento'),
    items: revision.items,
    allocations: revision.allocations, active_version_id: versionId,
    updated_at: new Date().toISOString()
  }, { onConflict: 'project_key,type' });
  if (error) throw error;
  const removed = await supabase.from('financial_budget_items').delete().eq('version_id', versionId);
  if (removed.error) throw removed.error;
  if (!revision.items.length) return;
  const itemResult = await supabase.from('financial_budget_items').insert(revision.items.map((item) => ({
    id: item.id, version_id: versionId, project_key: revision.projectKey, budget_type: revision.type, level: item.level,
    code: item.code, description: item.description, material_cost: item.material,
    labor_cost: item.labor, total_cost: item.total, updated_at: new Date().toISOString()
  })));
  if (itemResult.error) throw itemResult.error;
  if (revision.allocations.length) {
    const allocationRows = revision.allocations.map((item) => {
      const id = item.id ?? crypto.randomUUID();
      item.id = id;
      return {
        id, version_id: versionId, project_key: revision.projectKey, budget_type: revision.type,
        budget_item_id: item.budgetId, schedule_task_external_id: item.taskId,
        parent_schedule_task_external_id: item.parentTaskId ?? null, package_name: item.packageName ?? null,
        service_name: item.serviceName ?? null, lot_name: item.lotName ?? null,
        division_type: item.divisionType, item_weight_percent: item.weight, allocated_cost: item.value,
        inherited_from_allocation_id: item.inheritedFromId ?? null, updated_at: new Date().toISOString()
      };
    });
    const allocationResult = await supabase.from('financial_budget_allocations').insert(allocationRows);
    if (allocationResult.error) throw allocationResult.error;
  }
}

export async function saveBudgetAllocations(revision: BudgetRevision) {
  if (!supabase) return;
  if (!revision.versionId) throw new Error('O orçamento ativo não possui uma versão válida para receber os vínculos.');

  const removed = await supabase.from('financial_budget_allocations').delete().eq('version_id', revision.versionId);
  if (removed.error) throw removed.error;

  if (revision.allocations.length) {
    const rows = revision.allocations.map((item) => {
      const id = item.id ?? crypto.randomUUID();
      item.id = id;
      return {
        id,
        version_id: revision.versionId,
        project_key: revision.projectKey,
        budget_type: revision.type,
        budget_item_id: item.budgetId,
        schedule_task_external_id: item.taskId,
        parent_schedule_task_external_id: item.parentTaskId ?? null,
        package_name: item.packageName ?? null,
        service_name: item.serviceName ?? null,
        lot_name: item.lotName ?? null,
        division_type: item.divisionType,
        item_weight_percent: item.weight,
        allocated_cost: item.value,
        inherited_from_allocation_id: item.inheritedFromId ?? null,
        updated_at: new Date().toISOString()
      };
    });
    const inserted = await supabase.from('financial_budget_allocations').insert(rows);
    if (inserted.error) throw inserted.error;
  }

  const updated = await supabase.from('financial_budgets').update({
    allocations: revision.allocations,
    updated_at: new Date().toISOString()
  }).eq('project_key', revision.projectKey).eq('type', revision.type);
  if (updated.error) throw updated.error;
}

export async function loadFinancialLotAreas(projectKey: string): Promise<FinancialLotArea[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('financial_lot_areas').select('lot_mother,lot_name,projection_area').eq('project_key', projectKey);
  if (error) throw error;
  return (data ?? []).map((row) => ({ lotMother: row.lot_mother, lotName: row.lot_name, projectionArea: Number(row.projection_area) }));
}

export async function saveFinancialLotAreas(projectKey: string, areas: FinancialLotArea[]) {
  if (!supabase) return;
  const removed = await supabase.from('financial_lot_areas').delete().eq('project_key', projectKey);
  if (removed.error) throw removed.error;
  if (!areas.length) return;
  const { error } = await supabase.from('financial_lot_areas').insert(areas.map((area) => ({
    project_key: projectKey, lot_mother: area.lotMother, lot_name: area.lotName,
    projection_area: area.projectionArea, updated_at: new Date().toISOString()
  })));
  if (error) throw error;
}

export async function deleteBudget(projectKey: string, type: BudgetType) {
  if (!supabase) return;
  const { error } = await supabase.from('financial_budgets').delete().eq('project_key', projectKey).eq('type', type);
  if (error) throw error;
}

export function inheritedAllocation(parent: BudgetAllocation, childTaskId: string, childCount: number): BudgetAllocation {
  const divisor = Math.max(1, childCount);
  return {
    budgetId: parent.budgetId, taskId: childTaskId, parentTaskId: parent.taskId,
    packageName: parent.packageName, serviceName: parent.serviceName, lotName: parent.lotName,
    divisionType: 'inherited', weight: parent.weight / divisor, value: parent.value / divisor,
    inheritedFromId: parent.id
  };
}

// Compatibilidade temporária com a tela legada mantida no arquivo principal.
export async function loadBudgetRevisionName(projectKey: string) {
  return (await loadBudgets(projectKey)).find((budget) => budget.type === 'contractor')?.name ?? 'Orçamento da construtora';
}

export async function saveBudgetRevisionName(projectKey: string, name: string) {
  const existing = (await loadBudgets(projectKey)).find((budget) => budget.type === 'contractor');
  if (existing) await saveBudget({ ...existing, name });
}
