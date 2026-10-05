/** Intervalo de datas (inclusivo) ou lista de datas específicas, em YYYY-MM-DD. */
export type DateSpec = string[] | { from: string; to: string; stepDays: number };

export interface RouteConfig {
  id: string;
  fromAirport: string;
  toAirport: string;
  /** Companhias permitidas (código IATA de 2 letras). Vazio = qualquer companhia. */
  targetAirlines: string[];
  departureDateRange: DateSpec;
  returnDateRange?: DateSpec;
  minStayDays?: number;
  maxStayDays?: number;
  /** Preço teto em BRL que dispara o alerta. */
  maxPrice: number;
  active: boolean;
}

export interface SearchQuery {
  from: string;
  to: string;
  /** YYYY-MM-DD */
  departureDate: string;
  returnDate?: string;
  airlines: string[];
  currency: string;
  adults: number;
}

export interface Segment {
  from: string;
  to: string;
  /** Horário local, `YYYY-MM-DDTHH:mm`. */
  departure: string;
  arrival: string;
  /** Código IATA da companhia. */
  airline: string;
  /** Nome da companhia informado pelo provedor, quando disponível. */
  airlineName?: string;
  flightNumber?: string;
  durationMinutes: number;
}

export interface Layover {
  airport: string;
  durationMinutes: number;
}

export interface Itinerary {
  segments: Segment[];
  durationMinutes: number;
  layovers: Layover[];
}

export interface FlightOffer {
  provider: string;
  /** Preço total (ida+volta quando aplicável). */
  price: number;
  currency: string;
  /** Primeiro item = ida; segundo (se houver) = volta. */
  itineraries: Itinerary[];
  /** Companhias distintas, na ordem em que aparecem. */
  airlines: string[];
  link: string;
}

export interface FlightProvider {
  readonly name: string;
  search(query: SearchQuery): Promise<FlightOffer[]>;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`[${provider}] ${message}`, options);
    this.name = 'ProviderError';
  }
}
