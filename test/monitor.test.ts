import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/config/index.js';
import { parseRoutes } from '../src/config/routes.js';
import { Monitor } from '../src/core/monitor.js';
import { Repository } from '../src/db/repository.js';
import { formatAlert, type AlertMessage } from '../src/notify/format.js';
import { ProviderError, type FlightOffer, type FlightProvider } from '../src/types.js';
import { FallbackProvider } from '../src/providers/chain.js';
import { buildItinerary } from '../src/utils/itinerary.js';

const log = pino({ level: 'silent' });
const HOUR = 3_600_000;

const offer = (price: number, airline = 'LA'): FlightOffer => ({
  provider: 'fake',
  price,
  currency: 'BRL',
  airlines: [airline],
  link: 'https://www.google.com/travel/flights?tfs=a&b=c',
  itineraries: [
    buildItinerary(
      [
        { from: 'GRU', to: 'MAD', departure: '2026-10-15T22:05', arrival: '2026-10-16T13:00', airline, durationMinutes: 600 },
        { from: 'MAD', to: 'BCN', departure: '2026-10-16T14:40', arrival: '2026-10-16T16:00', airline, durationMinutes: 80 },
      ],
      1000,
    ),
  ],
});

const config = (): AppConfig => ({
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
  maxSearchesPerRoute: 10,
  rules: { cooldownHours: 12, dropPercent: 15, dropWindowDays: 7, dropMinSamples: 3 },
  routes: parseRoutes([
    { id: 'r1', fromAirport: 'GRU', toAirport: 'BCN', departureDateRange: ['2026-10-15'], returnDateRange: ['2026-10-28'], maxPrice: 3500 },
  ]),
});

function setup(offersFor: () => FlightOffer[]) {
  let now = Date.parse('2026-10-02T12:00:00Z');
  const provider: FlightProvider = { name: 'fake', search: () => Promise.resolve(offersFor()) };
  const send = vi.fn<(a: AlertMessage) => Promise<void>>().mockResolvedValue(undefined);
  const repo = new Repository(':memory:');
  const monitor = new Monitor(config(), provider, repo, { send }, log, () => now, () => Promise.resolve());
  return { monitor, send, repo, advance: (ms: number) => (now += ms) };
}

describe('Monitor', () => {
  it('alerta abaixo do teto, aplica cooldown e reenvia se o preço cair', async () => {
    let price = 3400;
    const { monitor, send, advance } = setup(() => [offer(price)]);

    expect((await monitor.runCycle()).alerts).toBe(1);
    advance(3 * HOUR);
    expect((await monitor.runCycle()).alerts).toBe(0); // mesmo preço dentro de 12h
    price = 3300;
    advance(3 * HOUR);
    expect((await monitor.runCycle()).alerts).toBe(1); // caiu ainda mais
    price = 3300;
    advance(13 * HOUR);
    expect((await monitor.runCycle()).alerts).toBe(1); // cooldown expirou
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('dispara por queda de 15% vs média mesmo acima do teto', async () => {
    let price = 5000;
    const { monitor, send, advance } = setup(() => [offer(price)]);
    for (let i = 0; i < 3; i++) {
      await monitor.runCycle();
      advance(3 * HOUR);
    }
    expect(send).not.toHaveBeenCalled();
    price = 4200; // 16% abaixo de 5000
    await monitor.runCycle();
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].reasons).toEqual(['price-drop']);
  });

  it('ignora companhias fora de targetAirlines', async () => {
    const { monitor, send } = setup(() => [offer(1000, 'IB'), offer(3000, 'LA')]);
    await monitor.runCycle();
    expect(send.mock.calls[0]?.[0].offer.price).toBe(3000);
  });

  it('não registra o alerta quando o envio falha (tenta de novo no próximo ciclo)', async () => {
    const { monitor, send, advance } = setup(() => [offer(3000)]);
    send.mockRejectedValueOnce(new Error('telegram fora'));
    expect((await monitor.runCycle()).failures).toBe(1);
    advance(HOUR);
    expect((await monitor.runCycle()).alerts).toBe(1);
  });
});

describe('FallbackProvider', () => {
  it('usa o próximo provedor quando o primeiro falha, mas não quando retorna vazio', async () => {
    const failing: FlightProvider = { name: 'a', search: () => Promise.reject(new ProviderError('a', 'bloqueado')) };
    const ok: FlightProvider = { name: 'b', search: () => Promise.resolve([offer(1)]) };
    const empty: FlightProvider = { name: 'c', search: () => Promise.resolve([]) };
    const q = { from: 'GRU', to: 'BCN', departureDate: '2026-10-15', airlines: [], currency: 'BRL', adults: 1 };

    expect(await new FallbackProvider([failing, ok], log).search(q)).toHaveLength(1);
    expect(await new FallbackProvider([empty, ok], log).search(q)).toHaveLength(0);
    await expect(new FallbackProvider([failing], log).search(q)).rejects.toThrow(/todos os provedores/);
  });
});

describe('formatAlert', () => {
  it('gera a mensagem no formato esperado', () => {
    const text = formatAlert({
      routeId: 'r1', from: 'GRU', to: 'BCN', departureDate: '2026-10-15', returnDate: '2026-10-28',
      offer: offer(3450), maxPrice: 3500, reasons: ['below-max-price'], dropPercent: null, averagePrice: null,
    });
    expect(text).toContain('✈️ <b>Alerta de Passagem LATAM: [GRU] -&gt; [BCN]</b>');
    expect(text).toContain('💰 <b>Preço:</b> R$ 3.450');
    expect(text).toContain('📅 <b>Datas:</b> 15/10/2026 a 28/10/2026');
    expect(text).toContain('1 parada em MAD (1h40)');
    expect(text).toContain('<a href="https://www.google.com/travel/flights?tfs=a&amp;b=c">');
  });
});
