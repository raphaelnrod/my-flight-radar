import type { DateSpec, RouteConfig } from '../types.js';
import { addDays, diffDays } from '../utils/time.js';

export interface SearchDates {
  departureDate: string;
  returnDate?: string;
}

export function expandDateSpec(spec: DateSpec): string[] {
  if (Array.isArray(spec)) return [...new Set(spec)].sort();
  const dates: string[] = [];
  for (let d = spec.from; d <= spec.to; d = addDays(d, spec.stepDays)) dates.push(d);
  return dates;
}

/** Reduz a lista a `max` itens espaçados uniformemente, preservando primeiro e último. */
function sample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  if (max === 1) return items.slice(0, 1);
  const picked: T[] = [];
  for (let i = 0; i < max; i++) {
    const item = items[Math.round((i * (items.length - 1)) / (max - 1))];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

/**
 * Gera as combinações ida/volta a pesquisar: descarta datas passadas, aplica a
 * estadia mínima/máxima e limita o total para não estourar o rate limit.
 */
export function buildSearchDates(route: RouteConfig, today: string, maxSearches: number): SearchDates[] {
  const departures = expandDateSpec(route.departureDateRange).filter((d) => d > today);
  const combos: SearchDates[] = [];

  if (!route.returnDateRange) {
    for (const departureDate of departures) combos.push({ departureDate });
    return sample(combos, maxSearches);
  }

  const returns = expandDateSpec(route.returnDateRange);
  for (const departureDate of departures) {
    for (const returnDate of returns) {
      const stay = diffDays(departureDate, returnDate);
      if (stay <= 0) continue;
      if (route.minStayDays !== undefined && stay < route.minStayDays) continue;
      if (route.maxStayDays !== undefined && stay > route.maxStayDays) continue;
      combos.push({ departureDate, returnDate });
    }
  }
  return sample(combos, maxSearches);
}
