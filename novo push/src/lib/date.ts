export function parseDate(value: string) {
  return new Date(`${value}T00:00:00`);
}

export function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function diffDays(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatBr(value: string) {
  return parseDate(value).toLocaleDateString('pt-BR');
}
