import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LastAlert, PriceStats } from '../core/decision.js';
import type { FlightOffer } from '../types.js';

/** Identifica "um voo numa data": rota + ida + volta ('' para só ida). */
export interface DateKey {
  routeId: string;
  departureDate: string;
  returnDate: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS price_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id       TEXT    NOT NULL,
  departure_date TEXT    NOT NULL,
  return_date    TEXT    NOT NULL DEFAULT '',
  price          REAL    NOT NULL,
  currency       TEXT    NOT NULL,
  airlines       TEXT    NOT NULL,
  flight_numbers TEXT    NOT NULL DEFAULT '',
  stops          INTEGER NOT NULL,
  duration_min   INTEGER NOT NULL,
  provider       TEXT    NOT NULL,
  link           TEXT    NOT NULL,
  checked_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_price_history_key
  ON price_history (route_id, departure_date, return_date, checked_at);

CREATE TABLE IF NOT EXISTS alerts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  route_id       TEXT    NOT NULL,
  departure_date TEXT    NOT NULL,
  return_date    TEXT    NOT NULL DEFAULT '',
  price          REAL    NOT NULL,
  reasons        TEXT    NOT NULL,
  sent_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_key
  ON alerts (route_id, departure_date, return_date, sent_at);
`;

export class Repository {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  /** Grava o menor preço encontrado numa checagem. */
  recordPrice(key: DateKey, offer: FlightOffer, checkedAt: number): void {
    const outbound = offer.itineraries[0];
    this.db
      .prepare(
        `INSERT INTO price_history
           (route_id, departure_date, return_date, price, currency, airlines, flight_numbers,
            stops, duration_min, provider, link, checked_at)
         VALUES (@routeId, @departureDate, @returnDate, @price, @currency, @airlines, @flightNumbers,
                 @stops, @durationMin, @provider, @link, @checkedAt)`,
      )
      .run({
        ...key,
        price: offer.price,
        currency: offer.currency,
        airlines: offer.airlines.join(','),
        flightNumbers: (outbound?.segments ?? [])
          .map((s) => s.flightNumber)
          .filter(Boolean)
          .join(','),
        stops: outbound?.layovers.length ?? 0,
        durationMin: outbound?.durationMinutes ?? 0,
        provider: offer.provider,
        link: offer.link,
        checkedAt,
      });
  }

  /** Média dos preços registrados desde `since` (ms). */
  priceStats(key: DateKey, since: number): PriceStats {
    const row = this.db
      .prepare(
        `SELECT AVG(price) AS average, COUNT(*) AS samples FROM price_history
         WHERE route_id = @routeId AND departure_date = @departureDate
           AND return_date = @returnDate AND checked_at >= @since`,
      )
      .get({ ...key, since }) as { average: number | null; samples: number };
    return { average: row.average, samples: row.samples };
  }

  lastAlert(key: DateKey): LastAlert | null {
    const row = this.db
      .prepare(
        `SELECT price, sent_at AS sentAt FROM alerts
         WHERE route_id = @routeId AND departure_date = @departureDate AND return_date = @returnDate
         ORDER BY sent_at DESC, id DESC LIMIT 1`,
      )
      .get(key) as LastAlert | undefined;
    return row ?? null;
  }

  recordAlert(key: DateKey, price: number, reasons: string[], sentAt: number): void {
    this.db
      .prepare(
        `INSERT INTO alerts (route_id, departure_date, return_date, price, reasons, sent_at)
         VALUES (@routeId, @departureDate, @returnDate, @price, @reasons, @sentAt)`,
      )
      .run({ ...key, price, reasons: reasons.join(','), sentAt });
  }

  /** Remove histórico anterior a `before` (ms). Retorna linhas removidas. */
  prune(before: number): number {
    const prices = this.db.prepare('DELETE FROM price_history WHERE checked_at < ?').run(before);
    const alerts = this.db.prepare('DELETE FROM alerts WHERE sent_at < ?').run(before);
    return prices.changes + alerts.changes;
  }

  close(): void {
    this.db.close();
  }
}
