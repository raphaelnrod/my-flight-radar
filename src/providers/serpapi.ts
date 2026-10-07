import { z } from 'zod';
import { ProviderError, type FlightOffer, type FlightProvider, type SearchQuery, type Segment } from '../types.js';
import { fetchWithRetry } from '../utils/http.js';
import { buildItinerary, uniqueAirlines } from '../utils/itinerary.js';
import { isMultiCity, returnLeg } from '../utils/query.js';
import { googleFlightsUrl } from './google/tfs.js';

const airport = z.object({ id: z.string(), time: z.string() });
const flightSchema = z.object({
  departure_airport: airport,
  arrival_airport: airport,
  duration: z.number().optional(),
  flight_number: z.string().optional(),
  airline: z.string().optional(),
});
const optionSchema = z.object({
  flights: z.array(flightSchema).min(1),
  total_duration: z.number().optional(),
  price: z.number().optional(),
});
const responseSchema = z.object({
  error: z.string().optional(),
  best_flights: z.array(optionSchema).default([]),
  other_flights: z.array(optionSchema).default([]),
});

/** "2026-10-15 22:05" -> "2026-10-15T22:05" */
const toIsoLocal = (time: string): string => time.replace(' ', 'T').slice(0, 16);

/** Fallback pago: SerpApi (engine google_flights). */
export class SerpApiProvider implements FlightProvider {
  readonly name = 'serpapi';

  constructor(private readonly apiKey: string) {}

  async search(query: SearchQuery): Promise<FlightOffer[]> {
    const params = new URLSearchParams({
      engine: 'google_flights',
      currency: query.currency,
      hl: 'pt',
      gl: 'br',
      adults: String(query.adults),
      api_key: this.apiKey,
    });
    if (query.returnDate && isMultiCity(query)) {
      // type=3: multidestinos; o preço retornado é o do bilhete completo.
      const back = returnLeg(query);
      params.set('type', '3');
      params.set(
        'multi_city_json',
        JSON.stringify([
          { departure_id: query.from, arrival_id: query.to, date: query.departureDate },
          { departure_id: back.from, arrival_id: back.to, date: query.returnDate },
        ]),
      );
    } else {
      params.set('type', query.returnDate ? '1' : '2');
      params.set('departure_id', query.from);
      params.set('arrival_id', query.to);
      params.set('outbound_date', query.departureDate);
      if (query.returnDate) params.set('return_date', query.returnDate);
    }
    if (query.airlines.length > 0) params.set('include_airlines', query.airlines.join(','));

    const response = await fetchWithRetry(`https://serpapi.com/search.json?${params.toString()}`).catch(
      (error: unknown) => {
        throw new ProviderError(this.name, 'falha de rede', { cause: error });
      },
    );
    const json: unknown = await response.json().catch(() => null);
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) throw new ProviderError(this.name, `resposta inválida (HTTP ${response.status})`);
    if (parsed.data.error) {
      // "hasn't returned any results" significa resultado vazio, não falha.
      if (/hasn't returned any results/i.test(parsed.data.error)) return [];
      throw new ProviderError(this.name, parsed.data.error);
    }

    const link = googleFlightsUrl(query);
    const offers: FlightOffer[] = [];
    for (const option of [...parsed.data.best_flights, ...parsed.data.other_flights]) {
      if (option.price === undefined) continue;
      const segments: Segment[] = option.flights.map((f) => {
        const [code, number] = f.flight_number?.split(' ') ?? [];
        return {
          from: f.departure_airport.id,
          to: f.arrival_airport.id,
          departure: toIsoLocal(f.departure_airport.time),
          arrival: toIsoLocal(f.arrival_airport.time),
          airline: code ?? '??',
          ...(f.airline && { airlineName: f.airline }),
          ...(code && number && { flightNumber: `${code}${number}` }),
          durationMinutes: f.duration ?? 0,
        };
      });
      const itinerary = buildItinerary(segments, option.total_duration);
      offers.push({
        provider: this.name,
        price: option.price,
        currency: query.currency,
        itineraries: [itinerary],
        airlines: uniqueAirlines([itinerary]),
        link,
      });
    }
    return offers;
  }
}
