import type { ScheduleDependency } from '../types';
import { parseDate, toIsoDate } from './date';

export type Schedulable = { id: string; startDate: string; endDate: string };

const dayMs = 86_400_000;

function holidaySet(holidays: string[]) {
  return new Set(holidays);
}

export function isWorkingDay(date: Date, holidays: string[] = []) {
  const day = date.getDay();
  return day !== 0 && day !== 6 && !holidaySet(holidays).has(toIsoDate(date));
}

export function addWorkingDays(date: Date, amount: number, holidays: string[] = []) {
  const result = new Date(date);
  const direction = amount < 0 ? -1 : 1;
  let remaining = Math.abs(Math.trunc(amount));
  while (remaining > 0) {
    result.setDate(result.getDate() + direction);
    if (isWorkingDay(result, holidays)) remaining -= 1;
  }
  return result;
}

export function workingDuration(start: Date, end: Date, holidays: string[] = []) {
  let cursor = new Date(start);
  let count = 0;
  while (cursor <= end) {
    if (isWorkingDay(cursor, holidays)) count += 1;
    cursor = new Date(cursor.getTime() + dayMs);
  }
  return Math.max(1, count);
}

export function normalizeDependency(value: Partial<ScheduleDependency> & Pick<ScheduleDependency, 'from' | 'to'>): ScheduleDependency {
  const validTypes = new Set(['FS', 'SS', 'FF', 'SF']);
  return {
    from: value.from,
    to: value.to,
    type: validTypes.has(String(value.type)) ? value.type! : 'FS',
    lagDays: Number.isFinite(Number(value.lagDays)) ? Math.trunc(Number(value.lagDays)) : 0
  };
}

export function normalizeOwnedDependencies(unit: { id: string; predecessors?: string[]; dependencies?: ScheduleDependency[] }) {
  if (unit.dependencies?.length) return unit.dependencies.map(normalizeDependency);
  return (unit.predecessors ?? []).map(from => normalizeDependency({ from, to: unit.id }));
}

export function createsDependencyCycle(dependencies: ScheduleDependency[], candidate: ScheduleDependency) {
  if (candidate.from === candidate.to) return true;
  const edges = [...dependencies.filter(item => !(item.from === candidate.from && item.to === candidate.to)), candidate];
  const reaches = (from: string, target: string, visited = new Set<string>()): boolean => {
    if (from === target) return true;
    if (visited.has(from)) return false;
    visited.add(from);
    return edges.filter(item => item.from === from).some(item => reaches(item.to, target, visited));
  };
  return reaches(candidate.to, candidate.from);
}

function impliedStart(predecessor: Schedulable, successor: Schedulable, dependency: ScheduleDependency, holidays: string[]) {
  const duration = workingDuration(parseDate(successor.startDate), parseDate(successor.endDate), holidays);
  if (dependency.type === 'FS') {
    const next = addWorkingDays(parseDate(predecessor.endDate), 1, holidays);
    return addWorkingDays(next, dependency.lagDays, holidays);
  }
  if (dependency.type === 'SS') return addWorkingDays(parseDate(predecessor.startDate), dependency.lagDays, holidays);
  const anchor = dependency.type === 'FF' ? parseDate(predecessor.endDate) : parseDate(predecessor.startDate);
  const requiredEnd = addWorkingDays(anchor, dependency.lagDays, holidays);
  return addWorkingDays(requiredEnd, -(duration - 1), holidays);
}

export function rescheduleTasks<T extends Schedulable>(tasks: T[], dependencies: ScheduleDependency[], holidays: string[] = []): T[] {
  const next = tasks.map(task => ({ ...task }));
  for (let pass = 0; pass < next.length; pass += 1) {
    let changed = false;
    for (const successor of next) {
      const constraints = dependencies.filter(item => item.to === successor.id).map(item => {
        const predecessor = next.find(task => task.id === item.from);
        return predecessor ? impliedStart(predecessor, successor, item, holidays) : null;
      }).filter((date): date is Date => Boolean(date));
      if (!constraints.length) continue;
      const start = new Date(Math.max(...constraints.map(date => date.getTime())));
      const duration = workingDuration(parseDate(successor.startDate), parseDate(successor.endDate), holidays);
      const end = addWorkingDays(start, duration - 1, holidays);
      if (successor.startDate !== toIsoDate(start) || successor.endDate !== toIsoDate(end)) {
        successor.startDate = toIsoDate(start);
        successor.endDate = toIsoDate(end);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return next;
}
