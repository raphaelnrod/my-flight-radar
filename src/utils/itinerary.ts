import type { Itinerary, Segment } from '../types.js';
import { minutesBetween } from './time.js';

/** Monta um itinerário calculando as conexões a partir dos horários dos trechos. */
export function buildItinerary(segments: Segment[], durationMinutes?: number): Itinerary {
  const layovers = segments.slice(1).map((segment, i) => {
    const previous = segments[i];
    return {
      airport: segment.from,
      durationMinutes: previous ? Math.max(0, minutesBetween(previous.arrival, segment.departure)) : 0,
    };
  });
  const total =
    durationMinutes ??
    segments.reduce((sum, s) => sum + s.durationMinutes, 0) +
      layovers.reduce((sum, l) => sum + l.durationMinutes, 0);
  return { segments, durationMinutes: total, layovers };
}

export function uniqueAirlines(itineraries: Itinerary[]): string[] {
  const seen = new Set<string>();
  for (const itinerary of itineraries) {
    for (const segment of itinerary.segments) seen.add(segment.airline);
  }
  return [...seen];
}
