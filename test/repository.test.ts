import { describe, expect, it } from 'vitest';
import { Repository, type DateKey } from '../src/db/repository.js';
import { buildItinerary } from '../src/utils/itinerary.js';
import type { FlightOffer } from '../src/types.js';

const offer = (price: number): FlightOffer => ({
  provider: 't',
  price,
  currency: 'BRL',
  airlines: ['LA'],
  link: 'https://x',
  itineraries: [
    buildItinerary([
      { from: 'GRU', to: 'BCN', departure: '2026-10-15T22:00', arrival: '2026-10-16T14:00', airline: 'LA', flightNumber: 'LA8084', durationMinutes: 600 },
    ]),
  ],
});
const key: DateKey = { routeId: 'r', departureDate: '2026-10-15', returnDate: '' };

describe('Repository', () => {
  it('calcula média apenas dentro da janela e por chave', () => {
    const repo = new Repository(':memory:');
    const now = Date.now();
    repo.recordPrice(key, offer(4000), now - 10 * 86_400_000); // fora da janela
    repo.recordPrice(key, offer(5000), now - 2 * 86_400_000);
    repo.recordPrice(key, offer(6000), now - 1 * 86_400_000);
    repo.recordPrice({ ...key, departureDate: '2026-10-16' }, offer(1), now);
    const stats = repo.priceStats(key, now - 7 * 86_400_000);
    expect(stats).toEqual({ average: 5500, samples: 2 });
  });

  it('retorna o último alerta e faz prune', () => {
    const repo = new Repository(':memory:');
    expect(repo.lastAlert(key)).toBeNull();
    repo.recordAlert(key, 3000, ['below-max-price'], 1000);
    repo.recordAlert(key, 2900, ['price-drop'], 2000);
    expect(repo.lastAlert(key)).toEqual({ price: 2900, sentAt: 2000 });
    expect(repo.prune(1500)).toBe(1);
  });
});
