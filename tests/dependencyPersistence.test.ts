import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOwnedDependencies } from '../src/lib/dependencySchedule';

test('normaliza predecessora legada como FS sem lag', () => {
  assert.deepEqual(normalizeOwnedDependencies({ id: 'b', predecessors: ['a'] }), [
    { from: 'a', to: 'b', type: 'FS', lagDays: 0 }
  ]);
});

test('preserva dependência estruturada do médio prazo', () => {
  assert.deepEqual(normalizeOwnedDependencies({ id: 'b', dependencies: [{ from: 'a', to: 'b', type: 'SS', lagDays: -2 }] }), [
    { from: 'a', to: 'b', type: 'SS', lagDays: -2 }
  ]);
});
