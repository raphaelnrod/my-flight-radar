import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmadeusProvider, isoDurationToMinutes } from '../src/providers/amadeus.js';
import { extractPayload, parseOffers } from '../src/providers/google/parser.js';
import { encodeTfs } from '../src/providers/google/tfs.js';
import { SerpApiProvider } from '../src/providers/serpapi.js';
import type { SearchQuery } from '../src/types.js';

const query: SearchQuery = {
  from: 'GRU',
  to: 'BCN',
  departureDate: '2026-10-15',
  returnDate: '2026-10-28',
  airlines: ['LA'],
  currency: 'BRL',
  adults: 1,
};

afterEach(() => vi.unstubAllGlobals());

const stubFetch = (...bodies: unknown[]): void => {
  const fn = vi.fn();
  for (const body of bodies) fn.mockResolvedValueOnce(Response.json(body));
  vi.stubGlobal('fetch', fn);
};

describe('google flights', () => {
  it('codifica o tfs em protobuf válido', () => {
    const bytes = Buffer.from(encodeTfs(query), 'base64');
    expect(bytes[0]).toBe(0x1a); // field 3, LEN
    const text = bytes.toString('latin1');
    for (const s of ['2026-10-15', '2026-10-28', 'GRU', 'BCN', 'LA']) expect(text).toContain(s);
    // campo 19 (trip) varint: tag 0x98 0x01, valor 1 (ida e volta)
    expect([...bytes.subarray(-3)]).toEqual([0x98, 0x01, 0x01]);
  });

  it('codifica busca multidestinos (volta por outro aeroporto) com trip=3', () => {
    const bytes = Buffer.from(encodeTfs({ ...query, returnFrom: 'LHR' }), 'base64');
    const text = bytes.toString('latin1');
    for (const s of ['BCN', 'LHR', '2026-10-28']) expect(text).toContain(s);
    expect([...bytes.subarray(-3)]).toEqual([0x98, 0x01, 0x03]);
    const oneWay = Buffer.from(encodeTfs({ ...query, departureDate: '2026-10-15', returnDate: '' }), 'base64');
    expect([...oneWay.subarray(-3)]).toEqual([0x98, 0x01, 0x02]);
  });

  it('extrai e interpreta o payload ds:1 (voo com conexão em MAD)', () => {
    const seg = (from: string, to: string, dep: unknown[], arr: unknown[], mins: number, d1: number[], d2: number[], no: string) => {
      const s: unknown[] = new Array(23).fill(null);
      s[3] = from; s[6] = to; s[8] = dep; s[10] = arr; s[11] = mins; s[20] = d1; s[21] = d2; s[22] = ['LA', no, null, 'LATAM'];
      return s;
    };
    const flight: unknown[] = new Array(10).fill(null);
    flight[2] = [
      seg('GRU', 'MAD', [22, 5], [13], 600, [2026, 10, 15], [2026, 10, 16], '8084'),
      seg('MAD', 'BCN', [14, 40], [16], 80, [2026, 10, 16], [2026, 10, 16], '8085'),
    ];
    flight[9] = 1000;
    const payload = [null, null, [[[flight, [[null, 3450]]]]], [[]]];
    const html = `<html><script class="ds:1" nonce="x">AF_initDataCallback({key: 'ds:1', hash: '2', data:${JSON.stringify(payload)}, sideChannel: {}});</script></html>`;

    const [offer] = parseOffers(extractPayload(html), query, 'https://link');
    expect(offer).toBeDefined();
    expect(offer?.price).toBe(3450);
    expect(offer?.airlines).toEqual(['LA']);
    const it0 = offer?.itineraries[0];
    expect(it0?.layovers).toEqual([{ airport: 'MAD', durationMinutes: 100 }]);
    expect(it0?.durationMinutes).toBe(1000);
    expect(it0?.segments[0]?.departure).toBe('2026-10-15T22:05');
    expect(it0?.segments[1]?.arrival).toBe('2026-10-16T16:00');
  });

  it('falha de forma explícita quando o HTML não tem o payload', () => {
    expect(() => extractPayload('<html>captcha</html>')).toThrow(/ds:1/);
  });
});

describe('serpapi', () => {
  it('normaliza best_flights e other_flights', async () => {
    stubFetch({
      best_flights: [
        {
          price: 3200,
          total_duration: 900,
          flights: [
            { departure_airport: { id: 'GRU', time: '2026-10-15 22:05' }, arrival_airport: { id: 'MAD', time: '2026-10-16 13:00' }, duration: 600, flight_number: 'LA 8084' },
            { departure_airport: { id: 'MAD', time: '2026-10-16 14:40' }, arrival_airport: { id: 'BCN', time: '2026-10-16 16:00' }, duration: 80, flight_number: 'LA 8085' },
          ],
        },
      ],
      other_flights: [],
    });
    const offers = await new SerpApiProvider('k').search(query);
    expect(offers).toHaveLength(1);
    expect(offers[0]?.price).toBe(3200);
    expect(offers[0]?.itineraries[0]?.layovers).toEqual([{ airport: 'MAD', durationMinutes: 100 }]);
    expect(offers[0]?.itineraries[0]?.segments[0]?.flightNumber).toBe('LA8084');
  });

  it('usa type=3 com multi_city_json em buscas multidestinos', async () => {
    stubFetch({ best_flights: [], other_flights: [] });
    await new SerpApiProvider('k').search({ ...query, returnFrom: 'LHR' });
    const url = new URL(String((vi.mocked(fetch).mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('type')).toBe('3');
    expect(JSON.parse(url.searchParams.get('multi_city_json') ?? '')).toEqual([
      { departure_id: 'GRU', arrival_id: 'BCN', date: '2026-10-15' },
      { departure_id: 'LHR', arrival_id: 'GRU', date: '2026-10-28' },
    ]);
  });

  it('trata "sem resultados" como lista vazia e demais erros como falha', async () => {
    stubFetch({ error: "Google Flights hasn't returned any results for this query." });
    await expect(new SerpApiProvider('k').search(query)).resolves.toEqual([]);
    stubFetch({ error: 'Invalid API key.' });
    await expect(new SerpApiProvider('k').search(query)).rejects.toThrow(/Invalid API key/);
  });
});

describe('amadeus', () => {
  it('autentica e normaliza ofertas', async () => {
    stubFetch(
      { access_token: 'tok', expires_in: 1799 },
      {
        data: [
          {
            price: { grandTotal: '3100.50' },
            itineraries: [
              {
                duration: 'PT15H',
                segments: [
                  { departure: { iataCode: 'GRU', at: '2026-10-15T22:05:00' }, arrival: { iataCode: 'MAD', at: '2026-10-16T13:00:00' }, carrierCode: 'IB', number: '6830', duration: 'PT10H55M' },
                  { departure: { iataCode: 'MAD', at: '2026-10-16T14:40:00' }, arrival: { iataCode: 'BCN', at: '2026-10-16T16:00:00' }, carrierCode: 'IB', number: '3000', duration: 'PT1H20M' },
                ],
              },
            ],
          },
        ],
      },
    );
    const [offer] = await new AmadeusProvider('id', 'secret', 'test').search({ ...query, airlines: ['IB'] });
    expect(offer?.price).toBe(3100.5);
    expect(offer?.airlines).toEqual(['IB']);
    expect(offer?.itineraries[0]?.durationMinutes).toBe(900);
    expect(offer?.itineraries[0]?.layovers[0]).toEqual({ airport: 'MAD', durationMinutes: 100 });
  });

  it('converte durações ISO-8601', () => {
    expect(isoDurationToMinutes('PT12H30M')).toBe(750);
    expect(isoDurationToMinutes('P1DT2H')).toBe(1560);
  });
});
