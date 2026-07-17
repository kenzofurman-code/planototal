import { useMemo, useState } from 'react';
import type { DependencyType, ScheduleDependency } from '../types';

type Item = { id: string; label: string };
type Props = { ownerId: string; items: Item[]; dependencies: ScheduleDependency[]; onChange: (next: ScheduleDependency[]) => string | void };
const labels: Record<DependencyType, string> = { FS: 'TI', SS: 'II', FF: 'TT', SF: 'IT' };

export function DependencyEditor({ ownerId, items, dependencies, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState<'predecessor' | 'successor'>('predecessor');
  const [error, setError] = useState('');
  const related = dependencies.filter(item => item.from === ownerId || item.to === ownerId);
  const available = useMemo(() => items.filter(item => item.id !== ownerId && item.label.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).slice(0, 8), [items, ownerId, query]);
  const apply = (next: ScheduleDependency[]) => setError(onChange(next) || '');
  const rows = (kind: 'predecessor' | 'successor') => related.filter(item => kind === 'predecessor' ? item.to === ownerId : item.from === ownerId);
  return <div className="dependency-editor">
    {(['predecessor', 'successor'] as const).map(kind => <section key={kind}>
      <h5>{kind === 'predecessor' ? 'Predecessoras' : 'Sucessoras'}</h5>
      {rows(kind).map(dep => {
        const otherId = kind === 'predecessor' ? dep.from : dep.to;
        return <div className="dependency-row" key={`${dep.from}-${dep.to}`}>
          <span title={items.find(item => item.id === otherId)?.label}>{items.find(item => item.id === otherId)?.label ?? otherId}</span>
          <select aria-label="Tipo de vínculo" value={dep.type} onChange={event => apply(dependencies.map(item => item === dep ? { ...item, type: event.target.value as DependencyType } : item))}>
            {(Object.keys(labels) as DependencyType[]).map(type => <option key={type} value={type}>{labels[type]}</option>)}
          </select>
          <div className="lag-counter"><button onClick={() => apply(dependencies.map(item => item === dep ? { ...item, lagDays: item.lagDays - 1 } : item))}>−</button><input aria-label="LAG em dias úteis" type="number" step="1" value={dep.lagDays} onChange={event => apply(dependencies.map(item => item === dep ? { ...item, lagDays: Math.trunc(Number(event.target.value) || 0) } : item))}/><button onClick={() => apply(dependencies.map(item => item === dep ? { ...item, lagDays: item.lagDays + 1 } : item))}>+</button></div>
          <small>dias úteis</small><button className="dep-remove" onClick={() => apply(dependencies.filter(item => item !== dep))}>×</button>
        </div>;
      })}
      {!rows(kind).length && <p>Nenhuma.</p>}
    </section>)}
    <div className="dependency-add">
      <select value={direction} onChange={event => setDirection(event.target.value as typeof direction)}><option value="predecessor">Adicionar predecessora</option><option value="successor">Adicionar sucessora</option></select>
      <input placeholder="Pesquisar atividade..." value={query} onChange={event => setQuery(event.target.value)} />
      {query && <div>{available.map(item => <button key={item.id} onClick={() => { const dep = direction === 'predecessor' ? { from: item.id, to: ownerId, type: 'FS' as const, lagDays: 0 } : { from: ownerId, to: item.id, type: 'FS' as const, lagDays: 0 }; apply([...dependencies, dep]); setQuery(''); }}>{item.label}</button>)}</div>}
    </div>
    {error && <p className="dependency-error" role="alert">{error}</p>}
  </div>;
}
