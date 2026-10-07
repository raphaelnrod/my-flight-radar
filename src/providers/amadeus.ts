import { z } from 'zod';
import { ProviderError, type FlightOffer, type FlightProvider, type SearchQuery, type Segment } from '../types.js';
import { fetchWithRetry } from '../utils/http.js';
import { buildItinerary, uniqueAirlines } from '../utils/itinerary.js';
import { isMultiCity, returnLeg } from '../utils/query.js';
import { googleFlightsUrl } from './google/tfs.js';

const segmentSchema = z.object({
  departure: z.object({ iataCode: z.string(), at: z.string() }),
  arrival: z.object({ iataCode: z.string(), at: z.string() }),
  carrierCode: z.string(),
  number: z.string(),
  duration: z.string().optional(),
});
const offerSchema = z.object({
  price: z.object({ grandTotal: z.string() }),
  itineraries: z.array(z.object({ duration: z.string(), segments: z.array(segmentSchema).min(1) })).min(1),
});
const offersResponse = z.object({ data: z.array(offerSchema) });
const tokenResponse = z.object({ access_token: z.string(), expires_in: z.number() });

/** ISO-8601 duration (PT12H30M / P1DT2H) -> minutos. */
export function isoDurationToMinutes(value: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** Fallback: Amadeus Self-Service (flight-offers-search). */
export class AmadeusProvider implements FlightProvider {
  readonly name = 'amadeus';
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly environment: 'test' | 'production',
  ) {}

  private get baseUrl(): string {
    return this.environment === 'production' ? 'https://api.amadeus.com' : 'https://test.api.amadeus.com';
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const response = await fetchWithRetry(`${this.baseUrl}/v1/security/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    const parsed = tokenResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new ProviderError(this.name, `falha de autenticação (HTTP ${response.status})`);
    this.token = { value: parsed.data.access_token, expiresAt: Date.now() + parsed.data.expires_in * 1000 };
    return this.token.value;
  }

  async search(query: SearchQuery): Promise<FlightOffer[]> {
    const response = isMultiCity(query) ? await this.searchMultiCity(query) : await this.searchSimple(query);
    if (response.status === 401) this.token = null;
    const parsed = offersResponse.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new ProviderError(this.name, `resposta inválida (HTTP ${response.status})`);

    const link = googleFlightsUrl(query);
    return parsed.data.data.map((offer) => {
      const itineraries = offer.itineraries.map((it) => {
        const segments: Segment[] = it.segments.map((s) => ({
          from: s.departure.iataCode,
          to: s.arrival.iataCode,
          departure: s.departure.at.slice(0, 16),
          arrival: s.arrival.at.slice(0, 16),
          airline: s.carrierCode,
          flightNumber: `${s.carrierCode}${s.number}`,
          durationMinutes: s.duration ? isoDurationToMinutes(s.duration) : 0,
        }));
        return buildItinerary(segments, isoDurationToMinutes(it.duration));
      });
      return {
        provider: this.name,
        price: Number(offer.price.grandTotal),
        currency: query.currency,
        itineraries,
        airlines: uniqueAirlines(itineraries),
        link,
      };
    });
  }

  private async searchSimple(query: SearchQuery): Promise<Response> {
    const params = new URLSearchParams({
      originLocationCode: query.from,
      destinationLocationCode: query.to,
      departureDate: query.departureDate,
      adults: String(query.adults),
      currencyCode: query.currency,
      max: '30',
    });
    if (query.returnDate) params.set('returnDate', query.returnDate);
    if (query.airlines.length > 0) params.set('includedAirlineCodes', query.airlines.join(','));

    return fetchWithRetry(`${this.baseUrl}/v2/shopping/flight-offers?${params.toString()}`, {
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
    }).catch((error: unknown) => {
      throw new ProviderError(this.name, 'falha de rede', { cause: error });
    });
  }

  /** Multidestinos só existe na versão POST da API. */
  private async searchMultiCity(query: SearchQuery): Promise<Response> {
    const back = returnLeg(query);
    const body = {
      currencyCode: query.currency,
      originDestinations: [
        { id: '1', originLocationCode: query.from, destinationLocationCode: query.to, departureDateTimeRange: { date: query.departureDate } },
        { id: '2', originLocationCode: back.from, destinationLocationCode: back.to, departureDateTimeRange: { date: query.returnDate } },
      ],
      travelers: Array.from({ length: query.adults }, (_, i) => ({ id: String(i + 1), travelerType: 'ADULT' })),
      sources: ['GDS'],
      searchCriteria: {
        maxFlightOffers: 30,
        ...(query.airlines.length > 0 && {
          flightFilters: { carrierRestrictions: { includedCarrierCodes: query.airlines } },
        }),
      },
    };
    return fetchWithRetry(`${this.baseUrl}/v2/shopping/flight-offers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((error: unknown) => {
      throw new ProviderError(this.name, 'falha de rede', { cause: error });
    });
  }
}
