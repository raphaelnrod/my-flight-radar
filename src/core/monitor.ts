import type { Logger } from 'pino';
import type { AppConfig } from '../config/index.js';
import type { DateKey, Repository } from '../db/repository.js';
import type { AlertMessage } from '../notify/format.js';
import type { Notifier } from '../notify/telegram.js';
import type { FlightOffer, FlightProvider, RouteConfig, SearchQuery } from '../types.js';
import { isMultiDestination } from '../config/routes.js';
import { formatIsoDate, randomBetween, sleep } from '../utils/time.js';
import { buildSearchDates, type SearchDates } from './dates.js';
import { decide } from './decision.js';
import {
  buildMultiDestinationPlan,
  legKey,
  pickBest,
  ticketKey,
  type MultiDestinationPlan,
} from './multi-destination.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface CycleSummary {
  searches: number;
  failures: number;
  alerts: number;
}

/** Mantém apenas ofertas cujos trechos sejam todos de companhias permitidas (lista vazia = qualquer). */
export function filterByAirlines(offers: FlightOffer[], allowed: string[]): FlightOffer[] {
  if (allowed.length === 0) return offers;
  return offers.filter((offer) => offer.airlines.length > 0 && offer.airlines.every((a) => allowed.includes(a)));
}

export function cheapest(offers: FlightOffer[]): FlightOffer | undefined {
  return offers.reduce<FlightOffer | undefined>((best, o) => (!best || o.price < best.price ? o : best), undefined);
}

/** Aeroportos efetivamente usados na oferta (exibidos no alerta). */
interface RouteView {
  from: string;
  to: string;
  returnFrom?: string;
  returnTo?: string;
}

export class Monitor {
  private running = false;
  private firstRequest = true;

  constructor(
    private readonly config: AppConfig,
    private readonly provider: FlightProvider,
    private readonly repo: Repository,
    private readonly notifier: Notifier,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
    private readonly delay: (ms: number) => Promise<void> = sleep,
  ) {}

  /** Executa um ciclo completo; ignora chamadas concorrentes. */
  async runCycle(): Promise<CycleSummary> {
    const summary: CycleSummary = { searches: 0, failures: 0, alerts: 0 };
    if (this.running) {
      this.log.warn('ciclo anterior ainda em execução; ignorando');
      return summary;
    }
    this.running = true;
    const started = this.now();
    this.log.info('iniciando ciclo de monitoramento');
    this.firstRequest = true;
    try {
      for (const route of this.config.routes.filter((r) => r.active)) {
        const today = formatIsoDate(this.now());
        const maxSearches = route.maxSearches ?? this.config.maxSearchesPerRoute;
        if (isMultiDestination(route)) {
          await this.runMultiDestination(route, today, maxSearches, summary);
        } else {
          await this.runSameRoute(route, today, maxSearches, summary);
        }
      }
      const removed = this.repo.prune(this.now() - this.config.historyRetentionDays * DAY_MS);
      if (removed > 0) this.log.debug({ removed }, 'histórico antigo removido');
    } finally {
      this.running = false;
    }
    this.log.info({ ...summary, durationMs: this.now() - started }, 'ciclo finalizado');
    return summary;
  }

  /** Pausa aleatória entre requisições (exceto antes da primeira do ciclo). */
  private async throttle(): Promise<void> {
    if (!this.firstRequest) {
      await this.delay(randomBetween(this.config.requestDelayMs.min, this.config.requestDelayMs.max));
    }
    this.firstRequest = false;
  }

  private async searchCheapest(route: RouteConfig, query: SearchQuery): Promise<FlightOffer | undefined> {
    await this.throttle();
    return cheapest(filterByAirlines(await this.provider.search(query), route.targetAirlines));
  }

  private baseQuery(route: RouteConfig): Pick<SearchQuery, 'airlines' | 'currency' | 'adults'> {
    return { airlines: route.targetAirlines, currency: this.config.currency, adults: this.config.adults };
  }

  /** Ida e volta pela mesma rota (ou só ida): uma busca por combinação de datas. */
  private async runSameRoute(route: RouteConfig, today: string, maxSearches: number, summary: CycleSummary) {
    const dates = buildSearchDates(route, today, maxSearches);
    this.log.info({ routeId: route.id, searches: dates.length }, 'processando rota');
    for (const date of dates) {
      summary.searches++;
      try {
        const query: SearchQuery = {
          ...this.baseQuery(route),
          from: route.fromAirport,
          to: route.toAirport,
          departureDate: date.departureDate,
          ...(date.returnDate !== undefined && { returnDate: date.returnDate }),
        };
        const best = await this.searchCheapest(route, query);
        if (!best) {
          this.log.info({ routeId: route.id, ...date }, 'nenhuma oferta das companhias alvo');
          continue;
        }
        if (await this.evaluate(route, date, best, { from: route.fromAirport, to: route.toAirport })) summary.alerts++;
      } catch (error) {
        summary.failures++;
        this.log.error({ routeId: route.id, ...date, err: (error as Error).message }, 'falha ao verificar data');
      }
    }
  }

  /** Volta por outro aeroporto/cidade: pesquisa os trechos e avalia a melhor combinação por par de datas. */
  private async runMultiDestination(route: RouteConfig, today: string, maxSearches: number, summary: CycleSummary) {
    const plan = buildMultiDestinationPlan(route, today, maxSearches);
    this.log.info(
      {
        routeId: route.id,
        searches: plan.legs.length + plan.tickets.length,
        oneWaySearches: plan.legs.length,
        multiCitySearches: plan.tickets.length,
        datePairs: plan.datePairs.length,
        variants: plan.variants.length,
      },
      'processando rota multidestinos',
    );
    const { legResults, ticketResults } = await this.searchPlan(route, plan, summary);

    for (const dates of plan.datePairs) {
      const best = pickBest(plan, dates, legResults, ticketResults);
      if (!best) {
        this.log.info({ routeId: route.id, ...dates }, 'nenhuma combinação disponível');
        continue;
      }
      try {
        const { offer, ...view } = best;
        if (await this.evaluate(route, dates, offer, view)) summary.alerts++;
      } catch (error) {
        summary.failures++;
        this.log.error({ routeId: route.id, ...dates, err: (error as Error).message }, 'falha ao avaliar datas');
      }
    }
  }

  private async searchPlan(route: RouteConfig, plan: MultiDestinationPlan, summary: CycleSummary) {
    const legResults = new Map<string, FlightOffer>();
    const ticketResults = new Map<string, FlightOffer>();

    const run = async (key: string, query: SearchQuery, into: Map<string, FlightOffer>): Promise<void> => {
      summary.searches++;
      try {
        const best = await this.searchCheapest(route, query);
        if (best) into.set(key, best);
        this.log.debug({ routeId: route.id, search: key, price: best?.price }, 'trecho pesquisado');
      } catch (error) {
        summary.failures++;
        this.log.error({ routeId: route.id, search: key, err: (error as Error).message }, 'falha na busca');
      }
    };

    for (const leg of plan.legs) {
      await run(legKey(leg), { ...this.baseQuery(route), from: leg.from, to: leg.to, departureDate: leg.date }, legResults);
    }
    for (const ticket of plan.tickets) {
      await run(ticketKey(ticket), { ...this.baseQuery(route), ...ticket }, ticketResults);
    }
    return { legResults, ticketResults };
  }

  /** Registra o preço e notifica se as regras mandarem. Retorna true se um alerta foi enviado. */
  private async evaluate(route: RouteConfig, dates: SearchDates, best: FlightOffer, view: RouteView): Promise<boolean> {
    const ctx = {
      routeId: route.id,
      departureDate: dates.departureDate,
      returnDate: dates.returnDate,
      ...(view.returnFrom !== undefined && { airports: `${view.from}>${view.to} ${view.returnFrom}>${view.returnTo ?? ''}` }),
    };
    const key: DateKey = {
      routeId: route.id,
      departureDate: dates.departureDate,
      returnDate: dates.returnDate ?? '',
    };
    const now = this.now();
    // A média é calculada antes de gravar o preço atual, para não "diluir" a queda.
    const stats = this.repo.priceStats(key, now - this.config.rules.dropWindowDays * DAY_MS);
    const decision = decide({
      price: best.price,
      maxPrice: route.maxPrice,
      stats,
      lastAlert: this.repo.lastAlert(key),
      now,
      rules: this.config.rules,
    });
    this.repo.recordPrice(key, best, now);
    this.log.info(
      { ...ctx, price: best.price, airlines: best.airlines, provider: best.provider, ...decision },
      'menor preço registrado',
    );

    if (!decision.notify) return false;

    const alert: AlertMessage = {
      routeId: route.id,
      ...view,
      departureDate: dates.departureDate,
      ...(dates.returnDate !== undefined && { returnDate: dates.returnDate }),
      offer: best,
      maxPrice: route.maxPrice,
      reasons: decision.reasons,
      dropPercent: decision.dropPercent,
      averagePrice: stats.average,
    };
    // Se o envio falhar, o alerta não é registrado e será tentado no próximo ciclo.
    await this.notifier.send(alert);
    this.repo.recordAlert(key, best.price, decision.reasons, now);
    this.log.info({ ...ctx, price: best.price, reasons: decision.reasons }, 'alerta enviado');
    return true;
  }
}
