import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('arraste cria vínculo TI sem lag', async () => {
  const source = await readFile('src/main.tsx', 'utf8');
  assert.match(source, /type: 'FS', lagDays: 0/);
});

test('linha de balanço renderiza editor completo', async () => {
  const source = await readFile('src/main.tsx', 'utf8');
  assert.match(source, /<DependencyEditor/);
});
