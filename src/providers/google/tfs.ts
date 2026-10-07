import type { SearchQuery } from '../../types.js';
import { isMultiCity, returnLeg } from '../../utils/query.js';

/**
 * Codificador mínimo do protobuf usado no parâmetro `tfs` do Google Flights.
 * Esquema (engenharia reversa, mesmo usado por projetos como fast-flights):
 *   Info        { repeated FlightData data = 3; repeated Passenger passengers = 8; Seat seat = 9; Trip trip = 19 }
 *   Trip        { ROUND_TRIP = 1; ONE_WAY = 2; MULTI_CITY = 3 }
 *   FlightData  { string date = 2; int32 max_stops = 5; repeated string airlines = 6;
 *                 Airport from_airport = 13; Airport to_airport = 14 }
 *   Airport     { string airport = 2 }
 */
const WIRE_VARINT = 0;
const WIRE_LEN = 2;
const SEAT_ECONOMY = 1;
const PASSENGER_ADULT = 1;
const TRIP_ROUND = 1;
const TRIP_ONE_WAY = 2;
const TRIP_MULTI_CITY = 3;

function varint(value: number): number[] {
  const out: number[] = [];
  let n = value;
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}

const tag = (field: number, wire: number): number[] => varint((field << 3) | wire);

const lenField = (field: number, payload: number[]): number[] => [
  ...tag(field, WIRE_LEN),
  ...varint(payload.length),
  ...payload,
];

const stringField = (field: number, value: string): number[] =>
  lenField(field, [...Buffer.from(value, 'utf8')]);

const varintField = (field: number, value: number): number[] => [...tag(field, WIRE_VARINT), ...varint(value)];

function flightData(date: string, from: string, to: string, airlines: string[]): number[] {
  return [
    ...stringField(2, date),
    ...airlines.flatMap((code) => stringField(6, code)),
    ...lenField(13, stringField(2, from)),
    ...lenField(14, stringField(2, to)),
  ];
}

export function encodeTfs(query: SearchQuery): string {
  const legs = [lenField(3, flightData(query.departureDate, query.from, query.to, query.airlines))];
  if (query.returnDate) {
    const back = returnLeg(query);
    legs.push(lenField(3, flightData(query.returnDate, back.from, back.to, query.airlines)));
  }
  const trip = !query.returnDate ? TRIP_ONE_WAY : isMultiCity(query) ? TRIP_MULTI_CITY : TRIP_ROUND;
  const passengers = Array.from({ length: query.adults }, () => PASSENGER_ADULT);
  const bytes = [
    ...legs.flat(),
    ...lenField(8, passengers), // repeated enum => packed
    ...varintField(9, SEAT_ECONOMY),
    ...varintField(19, trip),
  ];
  return Buffer.from(bytes).toString('base64');
}

export function googleFlightsUrl(query: SearchQuery): string {
  const params = new URLSearchParams({
    tfs: encodeTfs(query),
    hl: 'pt-BR',
    gl: 'BR',
    curr: query.currency,
  });
  return `https://www.google.com/travel/flights?${params.toString()}`;
}
