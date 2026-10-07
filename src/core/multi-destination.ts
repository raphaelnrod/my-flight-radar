import type { FlightOffer, RouteConfig } from '../types.js';
import { uniqueAirlines } from '../utils/itinerary.js';
import { expandAirports } from './airports.js';
import { datePairs, sample, type SearchDates } from './dates.js';

/**
 * Rotas multidestinos (open-jaw): ida A → B e volta C → D, com B ≠ C e/ou D ≠ A.
 *
 * Duas estratégias, combináveis via `ticketMode`:
 *  - `separate`: buscas só ida independentes para cada trecho; o preço da viagem é a soma do
 *    trecho de ida mais barato com o de volta mais barato (dois bilhetes).
 *  - `single`: busca multidestinos (um único bilhete com os dois trechos), que às vezes sai
 *    bem mais barato que dois só ida.
 * Para cada par de datas fica a opção mais barata entre todas as variantes/aeroportos.
 */

export interface Variant {
  outFrom: string[];
  outTo: string[];
  inFrom: string[];
  inTo: string[];
  reversed: boolean;
}

export interface LegSearch {
  from: string;
  to: string;
  date: string;
}

export interface TicketSearch {
  from: string;
  to: string;
  returnFrom: string;
  returnTo: string;
  departureDate: string;
  returnDate: string;
}

export interface MultiDestinationPlan {
  variants: Variant[];
  /** Buscas só ida (bilhetes separados). */
  legs: LegSearch[];
  /** Buscas multidestinos (bilhete único). */
  tickets: TicketSearch[];
  /** Pares de datas avaliados ao final, cobertos por `legs` e/ou `tickets`. */
  datePairs: Required<SearchDates>[];
}

export interface Candidate {
  offer: FlightOffer;
  from: string;
  to: string;
  returnFrom: string;
  returnTo: string;
}

export const legKey = (leg: LegSearch): string => `${leg.from}>${leg.to}@${leg.date}`;

export const ticketKey = (t: TicketSearch): string =>
  `${t.from}>${t.to}@${t.departureDate}|${t.returnFrom}>${t.returnTo}@${t.returnDate}`;

const pairKey = (p: SearchDates): string => `${p.departureDate}|${p.returnDate ?? ''}`;

export function buildVariants(route: RouteConfig): Variant[] {
  const outFrom = expandAirports(route.fromAirport);
  const entry = expandAirports(route.toAirport);
  const exit = expandAirports(route.returnFromAirport ?? route.toAirport);
  const inTo = expandAirports(route.returnToAirport ?? route.fromAirport);

  const sameSets = entry.length === exit.length && entry.every((code) => exit.includes(code));
  if (sameSets) return [{ outFrom, outTo: entry, inFrom: exit, inTo, reversed: false }];

  // Busca aberta: qualquer cidade de destino na entrada e na saída, inclusive a mesma.
  if (route.allowSameEntryExit) {
    const all = expandAirports([...entry, ...exit]);
    return [{ outFrom, outTo: all, inFrom: all, inTo, reversed: false }];
  }

  const variants: Variant[] = [{ outFrom, outTo: entry, inFrom: exit, inTo, reversed: false }];
  if (route.includeReverse) variants.push({ outFrom, outTo: exit, inFrom: entry, inTo, reversed: true });
  return variants;
}

const pairsOf = (from: string[], to: string[]): [string, string][] =>
  from.flatMap((f) => to.filter((t) => t !== f).map((t): [string, string] => [f, t]));

function uniquePairs(pairs: [string, string][]): [string, string][] {
  const seen = new Map(pairs.map((p) => [p.join('>'), p]));
  return [...seen.values()];
}

/** Buscas só ida necessárias para cobrir os pares de datas informados. */
function legsFor(dates: Required<SearchDates>[], variants: Variant[]): LegSearch[] {
  const outPairs = uniquePairs(variants.flatMap((v) => pairsOf(v.outFrom, v.outTo)));
  const inPairs = uniquePairs(variants.flatMap((v) => pairsOf(v.inFrom, v.inTo)));
  const departures = [...new Set(dates.map((d) => d.departureDate))];
  const returns = [...new Set(dates.map((d) => d.returnDate))];
  return [
    ...departures.flatMap((date) => outPairs.map(([from, to]) => ({ from, to, date }))),
    ...returns.flatMap((date) => inPairs.map(([from, to]) => ({ from, to, date }))),
  ];
}

function ticketsFor(dates: Required<SearchDates>[], variants: Variant[]): TicketSearch[] {
  const tickets = new Map<string, TicketSearch>();
  for (const { departureDate, returnDate } of dates) {
    for (const v of variants) {
      for (const [from, to] of pairsOf(v.outFrom, v.outTo)) {
        for (const [returnFrom, returnTo] of pairsOf(v.inFrom, v.inTo)) {
          const ticket = { from, to, returnFrom, returnTo, departureDate, returnDate };
          tickets.set(ticketKey(ticket), ticket);
        }
      }
    }
  }
  return [...tickets.values()];
}

/**
 * Maior amostra uniforme de pares de datas cujo número de buscas cabe no orçamento.
 * Com `atLeastOne`, garante ao menos um par mesmo que ultrapasse o orçamento.
 */
function fitBudget<T>(
  pairs: Required<SearchDates>[],
  budget: number,
  searchesFor: (dates: Required<SearchDates>[]) => T[],
  atLeastOne: boolean,
): T[] {
  if (budget <= 0 || pairs.length === 0) return [];
  for (let k = pairs.length; k >= 1; k--) {
    const searches = searchesFor(sample(pairs, k));
    if (searches.length <= budget) return searches;
  }
  return atLeastOne ? searchesFor(sample(pairs, 1)) : [];
}

/**
 * Escolhe o que pesquisar neste ciclo. No modo `both`, os trechos só ida têm prioridade (cobrem
 * todas as combinações de datas com poucas buscas) e o que sobrar do limite vai para os bilhetes
 * multidestinos.
 */
export function buildMultiDestinationPlan(route: RouteConfig, today: string, maxSearches: number): MultiDestinationPlan {
  const variants = buildVariants(route);
  const allPairs = datePairs(route, today);

  const legs =
    route.ticketMode === 'single' ? [] : fitBudget(allPairs, maxSearches, (dates) => legsFor(dates, variants), true);
  const tickets =
    route.ticketMode === 'separate'
      ? []
      : fitBudget(allPairs, maxSearches - legs.length, (dates) => ticketsFor(dates, variants), route.ticketMode === 'single');

  // Com os trechos só ida pesquisados, qualquer combinação válida entre eles pode ser avaliada.
  const legDates = new Set(legs.map((l) => l.date));
  const ticketPairs = new Set(tickets.map((t) => pairKey(t)));
  const evaluated = allPairs.filter(
    (p) => (legDates.has(p.departureDate) && legDates.has(p.returnDate)) || ticketPairs.has(pairKey(p)),
  );

  return { variants, legs, tickets, datePairs: evaluated };
}

function cheapestLeg(
  results: Map<string, FlightOffer>,
  from: string[],
  to: string[],
  date: string,
): { offer: FlightOffer; from: string; to: string } | undefined {
  let best: { offer: FlightOffer; from: string; to: string } | undefined;
  for (const [f, t] of pairsOf(from, to)) {
    const offer = results.get(legKey({ from: f, to: t, date }));
    if (offer && (!best || offer.price < best.offer.price)) best = { offer, from: f, to: t };
  }
  return best;
}

/** Junta dois bilhetes só ida numa oferta de ida e volta. */
export function combineTickets(outbound: FlightOffer, inbound: FlightOffer): FlightOffer {
  const itineraries = [outbound.itineraries[0], inbound.itineraries[0]].filter((i) => i !== undefined);
  return {
    provider: outbound.provider === inbound.provider ? outbound.provider : `${outbound.provider}+${inbound.provider}`,
    price: outbound.price + inbound.price,
    currency: outbound.currency,
    itineraries,
    airlines: uniqueAirlines(itineraries),
    link: outbound.link,
    tickets: [outbound, inbound],
  };
}

/** Opção mais barata para um par de datas, entre bilhetes separados e multidestinos de todas as variantes. */
export function pickBest(
  plan: MultiDestinationPlan,
  dates: Required<SearchDates>,
  legResults: Map<string, FlightOffer>,
  ticketResults: Map<string, FlightOffer>,
): Candidate | undefined {
  const candidates: Candidate[] = [];

  for (const v of plan.variants) {
    const out = cheapestLeg(legResults, v.outFrom, v.outTo, dates.departureDate);
    const back = cheapestLeg(legResults, v.inFrom, v.inTo, dates.returnDate);
    if (out && back) {
      candidates.push({
        offer: combineTickets(out.offer, back.offer),
        from: out.from,
        to: out.to,
        returnFrom: back.from,
        returnTo: back.to,
      });
    }
  }

  for (const ticket of plan.tickets) {
    if (ticket.departureDate !== dates.departureDate || ticket.returnDate !== dates.returnDate) continue;
    const offer = ticketResults.get(ticketKey(ticket));
    if (offer) candidates.push({ offer, ...ticket });
  }

  return candidates.reduce<Candidate | undefined>(
    (best, c) => (!best || c.offer.price < best.offer.price ? c : best),
    undefined,
  );
}
