import { describe, expect, it } from 'vitest';
import { buildSearchDates, expandDateSpec } from '../src/core/dates.js';
import { parseRoutes } from '../src/config/routes.js';
import type { RouteConfig } from '../src/types.js';

const route = (extra: object = {}): RouteConfig =>
  parseRoutes([
    {
      id: 'r',
      fromAirport: 'gru',
      toAirport: 'bcn',
      departureDateRange: { from: '2026-10-15', to: '2026-10-17' },
      maxPrice: 3000,
      ...extra,
    },
  ])[0] as RouteConfig;

describe('datas', () => {
  it('expande intervalos com passo', () => {
    expect(expandDateSpec({ from: '2026-10-01', to: '2026-10-07', stepDays: 3 })).toEqual([
      '2026-10-01',
      '2026-10-04',
      '2026-10-07',
    ]);
  });

  it('normaliza IATA e aplica defaults', () => {
    const r = route();
    expect(r).toMatchObject({ fromAirport: 'GRU', toAirport: 'BCN', targetAirlines: ['LA'], active: true });
  });

  it('descarta datas passadas', () => {
    expect(buildSearchDates(route(), '2026-10-15', 10).map((d) => d.departureDate)).toEqual([
      '2026-10-16',
      '2026-10-17',
    ]);
  });

  it('aplica estadia mínima/máxima em ida e volta', () => {
    const r = route({
      returnDateRange: { from: '2026-10-25', to: '2026-10-30' },
      minStayDays: 10,
      maxStayDays: 12,
    });
    const combos = buildSearchDates(r, '2026-10-01', 100);
    expect(combos.length).toBeGreaterThan(0);
    for (const c of combos) {
      const stay = (Date.parse(c.returnDate as string) - Date.parse(c.departureDate)) / 86_400_000;
      expect(stay).toBeGreaterThanOrEqual(10);
      expect(stay).toBeLessThanOrEqual(12);
    }
  });

  it('limita o número de buscas preservando extremos', () => {
    const r = route({ departureDateRange: { from: '2026-11-01', to: '2026-11-30' } });
    const combos = buildSearchDates(r, '2026-10-01', 4);
    expect(combos).toHaveLength(4);
    expect(combos[0]?.departureDate).toBe('2026-11-01');
    expect(combos[3]?.departureDate).toBe('2026-11-30');
  });

  it('rejeita configuração inválida', () => {
    expect(() => parseRoutes([{ id: 'x' }])).toThrow(/inválida/);
    expect(() => route({ fromAirport: 'GRU', toAirport: 'GRU' })).toThrow();
  });
});
