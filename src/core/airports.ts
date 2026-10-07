/**
 * Códigos IATA de cidade (metropolitanos) e seus aeroportos com voos comerciais relevantes.
 * Usados nas rotas multidestinos: cada aeroporto vira uma busca própria.
 */
export const CITY_AIRPORTS: Record<string, string[]> = {
  LON: ['LHR', 'LGW', 'STN', 'LTN', 'LCY'],
  PAR: ['CDG', 'ORY'],
  MIL: ['MXP', 'LIN', 'BGY'],
  ROM: ['FCO', 'CIA'],
  STO: ['ARN', 'BMA'],
  NYC: ['JFK', 'EWR', 'LGA'],
  WAS: ['IAD', 'DCA', 'BWI'],
  CHI: ['ORD', 'MDW'],
  YTO: ['YYZ', 'YTZ'],
  TYO: ['NRT', 'HND'],
  SAO: ['GRU', 'CGH', 'VCP'],
  RIO: ['GIG', 'SDU'],
  BHZ: ['CNF', 'PLU'],
  BUE: ['EZE', 'AEP'],
};

/** Expande códigos de cidade em aeroportos (sem duplicatas, mantendo a ordem). */
export function expandAirports(codes: string[]): string[] {
  return [...new Set(codes.flatMap((code) => CITY_AIRPORTS[code] ?? [code]))];
}
