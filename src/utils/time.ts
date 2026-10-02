export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const randomBetween = (min: number, max: number): number =>
  min + Math.random() * Math.max(0, max - min);

const DAY_MS = 86_400_000;

export function parseIsoDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Data inválida: ${date}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export const formatIsoDate = (utcMs: number): string => new Date(utcMs).toISOString().slice(0, 10);

export const addDays = (date: string, days: number): string =>
  formatIsoDate(parseIsoDate(date) + days * DAY_MS);

export const diffDays = (a: string, b: string): number =>
  Math.round((parseIsoDate(b) - parseIsoDate(a)) / DAY_MS);

/** `2026-10-15` -> `15/10/2026` */
export function formatDateBr(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d ?? ''}/${m ?? ''}/${y ?? ''}`;
}

/** Minutos entre dois horários locais `YYYY-MM-DDTHH:mm` (válido quando no mesmo fuso). */
export function minutesBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}:00Z`) - Date.parse(`${from}:00Z`)) / 60_000);
}

/** 100 -> `1h40`, 45 -> `45min`, 120 -> `2h` */
export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}
