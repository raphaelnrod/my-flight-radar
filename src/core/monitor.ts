import type { Logger } from 'pino';
import type { AppConfig } from '../config/index.js';
import type { DateKey, Repository } from '../db/repository.js';
import type { AlertMessage } from '../notify/format.js';
import type { Notifier } from '../notify/telegram.js';
import type { FlightOffer, FlightProvider, RouteConfig, SearchQuery } from '../types.js';
import { formatIsoDate } from '../utils/time.js';
import { randomBetween, sleep } from '../utils/time.js';
import { buildSearchDates, type SearchDates } from './dates.js';
import { decide } from './decision.js';

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

export class Monitor {
  private running = false;

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
    try {
      let first = true;
      for (const route of this.config.routes.filter((r) => r.active)) {
        const today = formatIsoDate(this.now());
        const dates = buildSearchDates(route, today, this.config.maxSearchesPerRoute);
        this.log.info({ routeId: route.id, searches: dates.length }, 'processando rota');
        for (const date of dates) {
          if (!first) await this.delay(randomBetween(this.config.requestDelayMs.min, this.config.requestDelayMs.max));
          first = false;
          summary.searches++;
          try {
            if (await this.checkDate(route, date)) summary.alerts++;
          } catch (error) {
            summary.failures++;
            this.log.error({ routeId: route.id, ...date, err: (error as Error).message }, 'falha ao verificar data');
          }
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

  /** Retorna true se um alerta foi enviado. */
  private async checkDate(route: RouteConfig, dates: SearchDates): Promise<boolean> {
    const query: SearchQuery = {
      from: route.fromAirport,
      to: route.toAirport,
      departureDate: dates.departureDate,
      ...(dates.returnDate !== undefined && { returnDate: dates.returnDate }),
      airlines: route.targetAirlines,
      currency: this.config.currency,
      adults: this.config.adults,
    };
    const ctx = { routeId: route.id, departureDate: dates.departureDate, returnDate: dates.returnDate };

    const offers = filterByAirlines(await this.provider.search(query), route.targetAirlines);
    const best = cheapest(offers);
    if (!best) {
      this.log.info(ctx, 'nenhuma oferta das companhias alvo');
      return false;
    }

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
      from: route.fromAirport,
      to: route.toAirport,
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
