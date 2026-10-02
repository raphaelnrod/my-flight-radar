import type { FlightOffer, SearchQuery, Segment } from '../../types.js';
import { buildItinerary, uniqueAirlines } from '../../utils/itinerary.js';

type Json = unknown;

const at = (value: Json, ...path: number[]): Json => {
  let current = value;
  for (const index of path) {
    if (!Array.isArray(current)) return undefined;
    current = current[index] as Json;
  }
  return current;
};
const num = (value: Json): number | undefined => (typeof value === 'number' ? value : undefined);
const str = (value: Json): string | undefined => (typeof value === 'string' ? value : undefined);
const arr = (value: Json): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

const pad = (n: number): string => String(n).padStart(2, '0');

/** Google omite zeros: `[8]` = 08:00, `[null, 5]` = 00:05. */
function hourMinute(value: Json): [number, number] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return [num(value[0]) ?? 0, num(value[1]) ?? 0];
}

function ymd(value: Json): string | undefined {
  const y = num(at(value, 0));
  const m = num(at(value, 1));
  const d = num(at(value, 2));
  return y !== undefined && m !== undefined && d !== undefined ? `${y}-${pad(m)}-${pad(d)}` : undefined;
}

/** Extrai o JSON do callback `ds:1` embutido no HTML do Google Flights. */
export function extractPayload(html: string): Json {
  const script = /<script[^>]*class="ds:1"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  const body = script ?? /AF_initDataCallback\(\{key: 'ds:1'[\s\S]*?\}\);/.exec(html)?.[0];
  if (!body) throw new Error('bloco ds:1 não encontrado no HTML');
  const start = body.indexOf('data:');
  const end = body.lastIndexOf(', sideChannel');
  if (start === -1 || end === -1 || end <= start) throw new Error('formato inesperado do bloco ds:1');
  return JSON.parse(body.slice(start + 5, end)) as Json;
}

function parseSegment(raw: Json, fallbackDate: string): Segment | undefined {
  const from = str(at(raw, 3));
  const to = str(at(raw, 6));
  const dep = hourMinute(at(raw, 8));
  const arr = hourMinute(at(raw, 10));
  if (!from || !to || !dep || !arr) return undefined;

  const depDate = ymd(at(raw, 20)) ?? fallbackDate;
  const arrDate = ymd(at(raw, 21)) ?? depDate;
  const airline = str(at(raw, 22, 0));
  const flightNumber = str(at(raw, 22, 1));
  return {
    from,
    to,
    departure: `${depDate}T${pad(dep[0])}:${pad(dep[1])}`,
    arrival: `${arrDate}T${pad(arr[0])}:${pad(arr[1])}`,
    airline: airline ?? '??',
    ...(airline && flightNumber && { flightNumber: `${airline}${flightNumber}` }),
    durationMinutes: num(at(raw, 11)) ?? 0,
  };
}

/**
 * Converte o payload bruto em ofertas. Estrutura (observada, sujeita a mudanças do Google):
 *   payload[2][0] e payload[3][0] = listas de itens; item[0] = voo; item[1][0][1] = preço.
 *   voo[2] = trechos; voo[9] = duração total (min).
 */
export function parseOffers(payload: Json, query: SearchQuery, link: string): FlightOffer[] {
  const items = [...arr(at(payload, 2, 0)), ...arr(at(payload, 3, 0))];
  const offers: FlightOffer[] = [];

  for (const item of items) {
    const price = num(at(item, 1, 0, 1));
    if (price === undefined || price <= 0) continue;

    // Datas ausentes: encadeia a partir da data de ida, avançando dia ao voltar no tempo.
    const segments: Segment[] = [];
    for (const raw of arr(at(item, 0, 2))) {
      const previous = segments[segments.length - 1];
      const segment = parseSegment(raw, previous?.arrival.slice(0, 10) ?? query.departureDate);
      if (segment) segments.push(segment);
    }
    if (segments.length === 0) continue;

    const itinerary = buildItinerary(segments, num(at(item, 0, 9)));
    offers.push({
      provider: 'google-flights',
      price,
      currency: query.currency,
      itineraries: [itinerary],
      airlines: uniqueAirlines([itinerary]),
      link,
    });
  }
  return offers;
}
