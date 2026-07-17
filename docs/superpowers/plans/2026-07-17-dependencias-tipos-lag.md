# Dependências com tipos e LAG — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir criar, editar, excluir e recalcular dependências FS, SS, FF e SF com LAG positivo ou negativo em dias úteis na Linha de Balanço e no Médio Prazo.

**Architecture:** Extrair regras de calendário, validação de grafo e reagendamento para um módulo TypeScript puro e testável. Linha de Balanço e Médio Prazo usarão o mesmo `ScheduleDependency`, mantendo adaptadores de compatibilidade para listas legadas de predecessoras.

**Tech Stack:** React 18, TypeScript 5.6, Vite 5, Supabase, Node test runner com `tsx`.

## Global Constraints

- Tipos disponíveis: `FS`, `SS`, `FF` e `SF`.
- Arraste e vínculos legados usam `FS` com `lagDays: 0`.
- LAG aceita inteiros positivos, negativos e zero.
- Todo deslocamento ignora fins de semana e feriados da obra.
- Auto-vínculos, duplicidades e ciclos são inválidos.
- Alterações válidas recalculam e propagam imediatamente pela cadeia.

---

### Task 1: Motor compartilhado de dependências

**Files:**
- Modify: `package.json`
- Modify: `src/types.ts`
- Create: `src/lib/dependencySchedule.ts`
- Create: `tests/dependencySchedule.test.ts`

**Interfaces:**
- Produces: `DependencyType`, `ScheduleDependency`, `normalizeDependency`, `createsDependencyCycle`, `rescheduleTasks`, `addWorkingDays`, `workingDuration`.
- Consumes: objetos com `id`, `startDate` e `endDate`, além de datas ISO de feriados.

- [ ] **Step 1: Add the TypeScript test runner**

```json
"scripts": {
  "test": "tsx --test tests/**/*.test.ts"
}
```

Run: `npm install --save-dev tsx`
Expected: `tsx` registrado em `devDependencies` e lockfile atualizado.

- [ ] **Step 2: Write failing calendar and relationship tests**

```ts
test('FS zero starts on the next working day', () => {
  const result = rescheduleTasks(tasks, [{ from: 'a', to: 'b', type: 'FS', lagDays: 0 }], ['2026-07-20']);
  assert.equal(result.find(task => task.id === 'b')?.startDate, '2026-07-21');
});

test('supports SS, FF and SF with negative and positive lag', () => {
  assert.deepEqual(
    ['SS', 'FF', 'SF'].map(type => rescheduleTasks(tasks, [{ from: 'a', to: 'b', type, lagDays: -1 }], []).find(task => task.id === 'b')),
    expectedTasks
  );
});

test('rejects a dependency that closes a cycle', () => {
  assert.equal(createsDependencyCycle([{ from: 'a', to: 'b', type: 'FS', lagDays: 0 }], { from: 'b', to: 'a', type: 'FS', lagDays: 0 }), true);
});
```

Run: `npm test`
Expected: FAIL porque `dependencySchedule.ts` ainda não existe.

- [ ] **Step 3: Implement the canonical model and engine**

```ts
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export type ScheduleDependency = { from: string; to: string; type: DependencyType; lagDays: number };

export function normalizeDependency(value: Partial<ScheduleDependency> & Pick<ScheduleDependency, 'from' | 'to'>): ScheduleDependency {
  return { from: value.from, to: value.to, type: value.type ?? 'FS', lagDays: Number.isFinite(value.lagDays) ? Math.trunc(value.lagDays!) : 0 };
}
```

Implementar `addWorkingDays`, `workingDuration`, as quatro âncoras de vínculo, escolha da restrição mais tardia, preservação da duração útil e propagação topológica. `FS + 0` usa o primeiro dia útil posterior ao término; os demais tipos usam a data âncora deslocada pelo LAG.

- [ ] **Step 4: Run the engine tests**

Run: `npm test`
Expected: todos os testes do motor aprovados.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/types.ts src/lib/dependencySchedule.ts tests/dependencySchedule.test.ts
git commit -m "feat: adiciona motor de dependencias com lag"
```

### Task 2: Persistência e migração

**Files:**
- Modify: `src/lib/lineBalanceRepository.ts`
- Modify: `src/lib/mediumPlanRepository.ts`
- Create: `tests/dependencyPersistence.test.ts`

**Interfaces:**
- Consumes: `ScheduleDependency` e `normalizeDependency` da Task 1.
- Produces: leitura/gravação de `type` e `lag_days`; `MediumWindowUnit.dependencies` normalizado.

- [ ] **Step 1: Write failing normalization tests**

```ts
test('normalizes legacy predecessor ids as FS zero', () => {
  assert.deepEqual(normalizeMediumUnitDependencies({ id: 'b', predecessors: ['a'] }), [
    { from: 'a', to: 'b', type: 'FS', lagDays: 0 }
  ]);
});

test('keeps structured medium dependencies', () => {
  assert.deepEqual(normalizeMediumUnitDependencies({ id: 'b', dependencies: [{ from: 'a', to: 'b', type: 'SS', lagDays: -2 }] })[0]?.type, 'SS');
});
```

Run: `npm test`
Expected: FAIL porque o normalizador ainda não existe.

- [ ] **Step 2: Persist line-balance lag**

```ts
dependencies: (depsRes.data ?? []).map(row => normalizeDependency({
  from: row.from_task_id,
  to: row.to_task_id,
  type: row.type,
  lagDays: row.lag_days
}))
```

Na gravação, usar `type: dependency.type` e `lag_days: dependency.lagDays`.

- [ ] **Step 3: Migrate medium-window state**

```ts
export type MediumWindowUnit = {
  id: string;
  // demais campos existentes
  predecessors?: string[];
  dependencies?: ScheduleDependency[];
};
```

Ao carregar, popular `dependencies` a partir do formato estruturado ou de `predecessors`; ao salvar/publicar, manter `predecessors` derivado para consumidores legados.

- [ ] **Step 4: Verify persistence tests**

Run: `npm test`
Expected: testes de motor e persistência aprovados.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lineBalanceRepository.ts src/lib/mediumPlanRepository.ts tests/dependencyPersistence.test.ts
git commit -m "feat: persiste tipos e lag das dependencias"
```

### Task 3: Editor da Linha de Balanço

**Files:**
- Modify: `src/main.tsx:1323-2330`
- Modify: `src/styles.css:124-140`
- Create: `src/components/DependencyEditor.tsx`
- Create: `tests/dependencyEditor.test.ts`

**Interfaces:**
- Consumes: `ScheduleDependency`, `createsDependencyCycle` e `rescheduleTasks`.
- Produces: `DependencyEditor` com inclusão, edição, exclusão e mensagens de validação.

- [ ] **Step 1: Write failing source integration tests**

```ts
test('drag creates FS with zero lag', async () => {
  const source = await readFile('src/main.tsx', 'utf8');
  assert.match(source, /type: 'FS', lagDays: 0/);
});

test('line balance renders the dependency editor', async () => {
  const source = await readFile('src/main.tsx', 'utf8');
  assert.match(source, /<DependencyEditor/);
});
```

Run: `npm test`
Expected: FAIL na integração do editor e no `lagDays` do arraste.

- [ ] **Step 2: Build the reusable editor**

```tsx
<DependencyEditor
  ownerId={selectedTask.id}
  items={tasks.map(task => ({ id: task.id, label: `${task.packageName} · ${task.lot}` }))}
  dependencies={dependencies}
  onChange={applyDependencies}
/>
```

O componente renderiza listas de predecessoras e sucessoras, pesquisa para adicionar, seletor `TI/II/TT/IT`, contador inteiro com `−/+`, texto “dias úteis” e exclusão.

- [ ] **Step 3: Integrate validation and rescheduling**

Criar `applyDependencies(next)` que valida auto-vínculo, duplicidade e ciclo antes de chamar `setDependencies(next)` e `setTasks(rescheduleTasks(tasks, next, holidayDates))`. Substituir o bloco “Dependências FS” do drawer pelo editor.

- [ ] **Step 4: Keep drag defaults canonical**

```ts
const dependency: ScheduleDependency = { from: drag.id, to: drag.target, type: 'FS', lagDays: 0 };
```

- [ ] **Step 5: Verify Line Balance**

Run: `npm test && npm run build`
Expected: testes aprovados e build com código 0.

- [ ] **Step 6: Commit**

```bash
git add src/main.tsx src/styles.css src/components/DependencyEditor.tsx tests/dependencyEditor.test.ts
git commit -m "feat: edita dependencias na linha de balanco"
```

### Task 4: Editor por unidade no Médio Prazo

**Files:**
- Modify: `src/main.tsx:2370-3720`
- Modify: `src/styles.css:309-323`
- Modify: `tests/dependencyEditor.test.ts`

**Interfaces:**
- Consumes: `DependencyEditor`, o motor compartilhado e feriados filtrados da obra.
- Produces: dependências estruturadas por sublote/unidade com propagação e compatibilidade legada.

- [ ] **Step 1: Write failing medium integration tests**

```ts
test('medium plan receives work-calendar holidays', async () => {
  const source = await readFile('src/main.tsx', 'utf8');
  assert.match(source, /<MediumPlan[^>]+holidays=/s);
});

test('medium unit drawer renders one dependency editor per unit', async () => {
  const source = await readFile('src/main.tsx', 'utf8');
  assert.match(source, /ownerId=\{unit\.id\}/);
});
```

Run: `npm test`
Expected: FAIL porque o Médio Prazo ainda usa apenas `predecessors`.

- [ ] **Step 2: Pass the work calendar to MediumPlan**

Adicionar `holidays: CalendarEvent[]` às props e passar os feriados globais/aplicáveis à obra, com a mesma filtragem usada pela Linha de Balanço.

- [ ] **Step 3: Replace unit predecessor lists with canonical dependencies**

Derivar o grafo completo de `units[*].dependencies`; arraste adiciona `{ from: source.id, to: target.id, type: 'FS', lagDays: 0 }`. Clonagem, abertura de lote, remoção e publicação remapeiam/removem relações estruturadas e derivam `predecessors` quando necessário.

- [ ] **Step 4: Render and apply the unit editor**

```tsx
<DependencyEditor
  ownerId={unit.id}
  items={unitOptions}
  dependencies={allUnitDependencies}
  onChange={applyUnitDependencies}
/>
```

Cada cartão de unidade no drawer recebe seu editor. `applyUnitDependencies` valida o grafo, redistribui as relações por unidade e chama o motor com as datas das unidades e os feriados.

- [ ] **Step 5: Verify all behavior**

Run: `npm test && npm run build`
Expected: suíte completa aprovada e build com código 0.

- [ ] **Step 6: Commit**

```bash
git add src/main.tsx src/styles.css tests/dependencyEditor.test.ts
git commit -m "feat: edita dependencias por unidade no medio prazo"
```

### Task 5: Verification and documentation consistency

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the dependency controls**

Adicionar ao README que Linha de Balanço e Médio Prazo suportam TI, II, TT e IT, LAG positivo/negativo em dias úteis e edição pelos drawers.

- [ ] **Step 2: Run fresh verification**

Run: `npm test && npm run build && git diff --check`
Expected: zero testes falhando, build concluído e nenhum erro de whitespace.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: documenta vinculos e lag do cronograma"
```
