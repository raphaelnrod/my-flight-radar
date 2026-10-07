import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config/index.js';
import { parseRoutes } from '../src/config/routes.js';
import { Monitor } from '../src/core/monitor.js';
import { buildMultiDestinationPlan, buildVariants, legKey, pickBest } from '../src/core/multi-destination.js';
import { Repository } from '../src/db/repository.js';
import { formatAlert, type AlertMessage } from '../src/notify/format.js';
import type { FlightOffer, FlightProvider, RouteConfig, SearchQuery } from '../src/types.js';
import { buildItinerary } from '../src/utils/itinerary.js';

const route = (extra: object = {}): RouteConfig =>
  parseRoutes([
    {
      id: 'europa',
      fromAirport: 'GRU',
      toAirport: 'BCN',
      returnFromAirport: 'LHR',
      targetAirlines: [],
      departureDateRange: ['2027-08-01', '2027-08-02'],
      returnDateRange: ['2027-08-15', '2027-08-16'],
      maxPrice: 5000,
      ...extra,
    },
  ])[0] as RouteConfig;

const oneWay = (from: string, to: string, date: string, price: number, airline = 'LA'): FlightOffer => {
  const itinerary = buildItinerary([
    { from, to, departure: `${date}T10:00`, arrival: `${date}T20:00`, airline, flightNumber: `${airline}1`, durationMinutes: 600 },
  ]);
  return { provider: 'fake', price, currency: 'BRL', itineraries: [itinerary], airlines: [airline], link: `https://g/${from}${to}${date}` };
};

describe('rotas multidestinos: configuração', () => {
  it('mantém o modo ida e volta pela mesma rota quando não há returnFromAirport', () => {
    const [r] = parseRoutes([{ id: 'a', fromAirport: 'GRU', toAirport: 'BCN', departureDateRange: ['2027-08-01'], maxPrice: 1 }]);
    expect(r).toMatchObject({ includeReverse: false, ticketMode: 'both' });
    expect(r?.returnFromAirport).toBeUndefined();
  });

  it('aceita aeroporto único, lista ou cidade e exige datas de volta', () => {
    expect(route().returnFromAirport).toEqual(['LHR']);
    expect(route({ returnFromAirport: ['lhr', 'lgw'] }).returnFromAirport).toEqual(['LHR', 'LGW']);
    expect(() => route({ returnDateRange: undefined })).toThrow(/returnDateRange/);
    expect(() => route({ returnFromAirport: 'GRU' })).toThrow(/volta iguais/);
  });

  it('gera a variante inversa e expande códigos de cidade', () => {
    const variants = buildVariants(route({ returnFromAirport: 'LON', includeReverse: true }));
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({ outFrom: ['GRU'], outTo: ['BCN'], inTo: ['GRU'], reversed: false });
    expect(variants[0]?.inFrom).toContain('LGW');
    expect(variants[1]).toMatchObject({ outTo: variants[0]?.inFrom, inFrom: ['BCN'], reversed: true });
  });
});

describe('rotas multidestinos: plano de buscas', () => {
  it('pesquisa cada trecho só ida uma vez e avalia todas as combinações de datas', () => {
    const plan = buildMultiDestinationPlan(route({ ticketMode: 'separate', includeReverse: true }), '2027-01-01', 30);
    // ida: GRU>BCN e GRU>LHR em 2 datas; volta: LHR>GRU e BCN>GRU em 2 datas
    expect(plan.legs.map(legKey).sort()).toEqual(
      [
        'GRU>BCN@2027-08-01', 'GRU>BCN@2027-08-02', 'GRU>LHR@2027-08-01', 'GRU>LHR@2027-08-02',
        'LHR>GRU@2027-08-15', 'LHR>GRU@2027-08-16', 'BCN>GRU@2027-08-15', 'BCN>GRU@2027-08-16',
      ].sort(),
    );
    expect(plan.tickets).toHaveLength(0);
    expect(plan.datePairs).toHaveLength(4);
  });

  it('divide o orçamento entre bilhetes separados e multidestinos', () => {
    const plan = buildMultiDestinationPlan(route(), '2027-01-01', 8);
    expect(plan.legs.length).toBeLessThanOrEqual(4);
    expect(plan.tickets.length).toBeLessThanOrEqual(4);
    expect(plan.tickets.length).toBeGreaterThan(0);
    expect(plan.tickets[0]).toMatchObject({ from: 'GRU', to: 'BCN', returnFrom: 'LHR', returnTo: 'GRU' });
  });

  it('respeita o limite de buscas', () => {
    const r = route({
      departureDateRange: { from: '2027-08-01', to: '2027-08-10' },
      returnDateRange: { from: '2027-08-15', to: '2027-08-25' },
      includeReverse: true,
    });
    const plan = buildMultiDestinationPlan(r, '2027-01-01', 20);
    expect(plan.legs.length + plan.tickets.length).toBeLessThanOrEqual(20);
    expect(plan.datePairs.length).toBeGreaterThan(0);
  });
});

describe('rotas multidestinos: melhor combinação', () => {
  it('escolhe a variante mais barata entre bilhetes separados e multidestinos', () => {
    const plan = buildMultiDestinationPlan(route({ includeReverse: true }), '2027-01-01', 100);
    const dates = { departureDate: '2027-08-01', returnDate: '2027-08-15' };
    const legs = new Map<string, FlightOffer>([
      [legKey({ from: 'GRU', to: 'BCN', date: dates.departureDate }), oneWay('GRU', 'BCN', dates.departureDate, 3000)],
      [legKey({ from: 'LHR', to: 'GRU', date: dates.returnDate }), oneWay('LHR', 'GRU', dates.returnDate, 2500)],
      [legKey({ from: 'GRU', to: 'LHR', date: dates.departureDate }), oneWay('GRU', 'LHR', dates.departureDate, 2000)],
      [legKey({ from: 'BCN', to: 'GRU', date: dates.returnDate }), oneWay('BCN', 'GRU', dates.returnDate, 2100)],
    ]);

    const best = pickBest(plan, dates, legs, new Map());
    expect(best).toMatchObject({ from: 'GRU', to: 'LHR', returnFrom: 'BCN', returnTo: 'GRU' });
    expect(best?.offer.price).toBe(4100);
    expect(best?.offer.tickets).toHaveLength(2);
    expect(best?.offer.itineraries).toHaveLength(2);

    const single = plan.tickets.find((t) => t.departureDate === dates.departureDate && t.returnDate === dates.returnDate && t.to === 'BCN');
    expect(single).toBeDefined();
    const tickets = new Map([[`GRU>BCN@2027-08-01|LHR>GRU@2027-08-15`, oneWay('GRU', 'BCN', dates.departureDate, 3900)]]);
    expect(pickBest(plan, dates, legs, tickets)).toMatchObject({ to: 'BCN', returnFrom: 'LHR', offer: { price: 3900 } });
  });
});

describe('rotas multidestinos: ciclo completo', () => {
  const config = (r: RouteConfig): AppConfig => ({
    telegram: {},
    dryRun: true,
    schedule: { cron: '0 */3 * * *', timezone: 'UTC', runOnStart: false },
    dbPath: ':memory:',
    historyRetentionDays: 90,
    log: { level: 'silent', pretty: false },
    currency: 'BRL',
    adults: 1,
    providers: ['google-flights'],
    serpApi: {},
    amadeus: { environment: 'test' },
    requestDelayMs: { min: 0, max: 0 },
    maxSearchesPerRoute: 30,
    rules: { cooldownHours: 12, dropPercent: 15, dropWindowDays: 7, dropMinSamples: 3 },
    routes: [r],
  });

  it('pesquisa os trechos, combina e alerta uma vez por par de datas', async () => {
    const r = route({
      departureDateRange: ['2027-08-01'],
      returnDateRange: ['2027-08-15'],
      includeReverse: true,
      maxPrice: 4500,
    });
    const queries: SearchQuery[] = [];
    const prices: Record<string, number> = { 'GRU>BCN': 3000, 'LHR>GRU': 2500, 'GRU>LHR': 2000, 'BCN>GRU': 2100 };
    const provider: FlightProvider = {
      name: 'fake',
      search: (q) => {
        queries.push(q);
        if (q.returnDate) return Promise.resolve([oneWay(q.from, q.to, q.departureDate, 6000)]);
        return Promise.resolve([oneWay(q.from, q.to, q.departureDate, prices[`${q.from}>${q.to}`] ?? 9999)]);
      },
    };
    const send = vi.fn<(a: AlertMessage) => Promise<void>>().mockResolvedValue(undefined);
    const monitor = new Monitor(config(r), provider, new Repository(':memory:'), { send }, pino({ level: 'silent' }), () => Date.parse('2027-01-01T12:00:00Z'), () => Promise.resolve());

    const summary = await monitor.runCycle();
    expect(summary).toMatchObject({ failures: 0, alerts: 1 });
    expect(queries.filter((q) => !q.returnDate)).toHaveLength(4);
    expect(queries.filter((q) => q.returnFrom !== undefined)).toHaveLength(2);
    const alert = send.mock.calls[0]?.[0];
    expect(alert).toMatchObject({ from: 'GRU', to: 'LHR', returnFrom: 'BCN', returnTo: 'GRU', offer: { price: 4100 } });

    const text = formatAlert(alert as AlertMessage);
    expect(text).toContain('✈️ <b>GRU → LHR</b>  ·  <b>BCN → GRU</b>');
    expect(text).toContain('💰 <b>R$ 4.100</b> · ida + volta (2 bilhetes)');
    expect(text).toContain('Ida R$ 2.000 · Volta R$ 2.100');
    expect(text).toContain('🛫 <b>IDA</b> · GRU → LHR · dom, 01/08/2027');
    expect(text).toContain('🛬 <b>VOLTA</b> · BCN → GRU · dom, 15/08/2027');
    expect(text).toContain('Ver ida no Google Flights');
    expect(text).toContain('Ver volta no Google Flights');
  });
});
