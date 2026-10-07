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
export function sample<T>(items: T[], max: number): T[] {
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
  if (route.returnDateRange) return sample(datePairs(route, today), maxSearches);
  const departures = expandDateSpec(route.departureDateRange).filter((d) => d > today);
  return sample(
    departures.map((departureDate) => ({ departureDate })),
    maxSearches,
  );
}

/** Todas as combinações ida/volta futuras que respeitam a estadia mínima/máxima. */
export function datePairs(route: RouteConfig, today: string): Required<SearchDates>[] {
  if (!route.returnDateRange) return [];
  const departures = expandDateSpec(route.departureDateRange).filter((d) => d > today);
  const returns = expandDateSpec(route.returnDateRange);
  const pairs: Required<SearchDates>[] = [];
  for (const departureDate of departures) {
    for (const returnDate of returns) {
      if (isValidStay(route, departureDate, returnDate)) pairs.push({ departureDate, returnDate });
    }
  }
  return pairs;
}

export function isValidStay(route: RouteConfig, departureDate: string, returnDate: string): boolean {
  const stay = diffDays(departureDate, returnDate);
  if (stay <= 0) return false;
  if (route.minStayDays !== undefined && stay < route.minStayDays) return false;
  return route.maxStayDays === undefined || stay <= route.maxStayDays;
}
