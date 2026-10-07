/** Intervalo de datas (inclusivo) ou lista de datas específicas, em YYYY-MM-DD. */
export type DateSpec = string[] | { from: string; to: string; stepDays: number };

/** Como a rota com volta por outro aeroporto/cidade é pesquisada. */
export type TicketMode = 'both' | 'separate' | 'single';

export interface RouteConfig {
  id: string;
  /** Origem(ns) da ida: aeroportos ou códigos de cidade. */
  fromAirport: string[];
  /** Destino(s) da ida (porta de entrada): aeroportos ou códigos de cidade. */
  toAirport: string[];
  /**
   * Origem(ns) da volta (porta de saída). Padrão = `toAirport`.
   * A rota é "multidestinos" quando há mais de um aeroporto em algum lado ou quando a volta
   * difere do inverso da ida.
   */
  returnFromAirport?: string[];
  /** Destino(s) da volta. Padrão = `fromAirport` (pode voltar para qualquer um deles). */
  returnToAirport?: string[];
  /** Também pesquisa a combinação invertida (ida para `returnFromAirport`, volta saindo de `toAirport`). */
  includeReverse: boolean;
  /**
   * Também aceita entrar e sair pela mesma cidade de destino (ex.: ida e volta por BCN),
   * além das combinações entre `toAirport` e `returnFromAirport`.
   */
  allowSameEntryExit: boolean;
  /** `separate` = dois bilhetes só ida; `single` = um bilhete multidestinos; `both` = os dois. */
  ticketMode: TicketMode;
  /** Sobrescreve MAX_SEARCHES_PER_ROUTE para esta rota. */
  maxSearches?: number;
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
  /**
   * Origem/destino da volta quando diferentes de `to`/`from` (bilhete multidestinos).
   * Só têm efeito junto com `returnDate`.
   */
  returnFrom?: string;
  returnTo?: string;
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
  /** Quando a oferta combina bilhetes comprados separadamente (ida e volta), cada um deles. */
  tickets?: FlightOffer[];
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
