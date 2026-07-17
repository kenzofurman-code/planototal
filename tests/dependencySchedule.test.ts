import assert from 'node:assert/strict';
import test from 'node:test';
import { createsDependencyCycle, rescheduleTasks } from '../src/lib/dependencySchedule';

const base = [
  { id: 'a', startDate: '2026-07-13', endDate: '2026-07-17' },
  { id: 'b', startDate: '2026-07-13', endDate: '2026-07-15' }
];

test('FS zero começa no próximo dia útil e ignora feriado', () => {
  const result = rescheduleTasks(base, [{ from: 'a', to: 'b', type: 'FS', lagDays: 0 }], ['2026-07-20']);
  assert.deepEqual(result.find(item => item.id === 'b'), { id: 'b', startDate: '2026-07-21', endDate: '2026-07-23' });
});

test('calcula SS, FF e SF preservando a duração útil', () => {
  const ss = rescheduleTasks(base, [{ from: 'a', to: 'b', type: 'SS', lagDays: 2 }], []);
  const ff = rescheduleTasks(base, [{ from: 'a', to: 'b', type: 'FF', lagDays: -1 }], []);
  const sf = rescheduleTasks(base, [{ from: 'a', to: 'b', type: 'SF', lagDays: 1 }], []);
  assert.deepEqual(ss.find(item => item.id === 'b'), { id: 'b', startDate: '2026-07-15', endDate: '2026-07-17' });
  assert.deepEqual(ff.find(item => item.id === 'b'), { id: 'b', startDate: '2026-07-14', endDate: '2026-07-16' });
  assert.deepEqual(sf.find(item => item.id === 'b'), { id: 'b', startDate: '2026-07-10', endDate: '2026-07-14' });
});

test('detecta ciclo antes de adicionar o vínculo', () => {
  assert.equal(createsDependencyCycle([{ from: 'a', to: 'b', type: 'FS', lagDays: 0 }], { from: 'b', to: 'a', type: 'FS', lagDays: 0 }), true);
});
