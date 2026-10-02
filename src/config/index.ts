import 'dotenv/config';
import { z } from 'zod';
import type { RouteConfig } from '../types.js';
import { loadRoutes } from './routes.js';

export const PROVIDER_NAMES = ['google-flights', 'serpapi', 'amadeus'] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

const optionalString = z.string().trim().min(1).optional();

const envSchema = z
  .object({
    TELEGRAM_BOT_TOKEN: optionalString,
    TELEGRAM_CHAT_ID: optionalString,
    DRY_RUN: z.stringbool().default(false),

    CRON_SCHEDULE: z.string().default('0 */3 * * *'),
    TIMEZONE: z.string().default('America/Sao_Paulo'),
    RUN_ON_START: z.stringbool().default(true),

    ROUTES_FILE: z.string().default('config/routes.json'),
    DB_PATH: z.string().default('data/flight-radar.db'),
    HISTORY_RETENTION_DAYS: z.coerce.number().int().positive().default(90),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: z.stringbool().default(false),

    CURRENCY: z.string().length(3).default('BRL'),
    ADULTS: z.coerce.number().int().min(1).max(9).default(1),

    /** Ordem de tentativa; o primeiro é o principal e os demais são fallback. */
    PROVIDERS: z
      .string()
      .default('google-flights')
      .transform((value) => value.split(',').map((s) => s.trim()).filter(Boolean))
      .pipe(z.array(z.enum(PROVIDER_NAMES)).min(1)),
    SERPAPI_KEY: optionalString,
    AMADEUS_CLIENT_ID: optionalString,
    AMADEUS_CLIENT_SECRET: optionalString,
    AMADEUS_ENV: z.enum(['test', 'production']).default('test'),

    REQUEST_DELAY_MIN_MS: z.coerce.number().int().nonnegative().default(2000),
    REQUEST_DELAY_MAX_MS: z.coerce.number().int().nonnegative().default(6000),
    MAX_SEARCHES_PER_ROUTE: z.coerce.number().int().positive().default(30),

    COOLDOWN_HOURS: z.coerce.number().positive().default(12),
    DROP_PERCENT: z.coerce.number().positive().max(100).default(15),
    DROP_WINDOW_DAYS: z.coerce.number().positive().default(7),
    /** Mínimo de coletas no período para a regra de queda ser considerada. */
    DROP_MIN_SAMPLES: z.coerce.number().int().positive().default(3),
  })
  .superRefine((env, ctx) => {
    const need = (ok: boolean, path: string, message: string): void => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    if (!env.DRY_RUN) {
      need(!!env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN', 'obrigatório (ou use DRY_RUN=true)');
      need(!!env.TELEGRAM_CHAT_ID, 'TELEGRAM_CHAT_ID', 'obrigatório (ou use DRY_RUN=true)');
    }
    if (env.PROVIDERS.includes('serpapi')) {
      need(!!env.SERPAPI_KEY, 'SERPAPI_KEY', 'obrigatório quando PROVIDERS inclui serpapi');
    }
    if (env.PROVIDERS.includes('amadeus')) {
      need(!!env.AMADEUS_CLIENT_ID, 'AMADEUS_CLIENT_ID', 'obrigatório quando PROVIDERS inclui amadeus');
      need(!!env.AMADEUS_CLIENT_SECRET, 'AMADEUS_CLIENT_SECRET', 'obrigatório quando PROVIDERS inclui amadeus');
    }
    need(
      env.REQUEST_DELAY_MIN_MS <= env.REQUEST_DELAY_MAX_MS,
      'REQUEST_DELAY_MIN_MS',
      'deve ser <= REQUEST_DELAY_MAX_MS',
    );
  });

export interface AppConfig {
  telegram: { botToken?: string; chatId?: string };
  dryRun: boolean;
  schedule: { cron: string; timezone: string; runOnStart: boolean };
  dbPath: string;
  historyRetentionDays: number;
  log: { level: string; pretty: boolean };
  currency: string;
  adults: number;
  providers: ProviderName[];
  serpApi: { apiKey?: string };
  amadeus: { clientId?: string; clientSecret?: string; environment: 'test' | 'production' };
  requestDelayMs: { min: number; max: number };
  maxSearchesPerRoute: number;
  rules: { cooldownHours: number; dropPercent: number; dropWindowDays: number; dropMinSamples: number };
  routes: RouteConfig[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  return {
    telegram: {
      ...(e.TELEGRAM_BOT_TOKEN && { botToken: e.TELEGRAM_BOT_TOKEN }),
      ...(e.TELEGRAM_CHAT_ID && { chatId: e.TELEGRAM_CHAT_ID }),
    },
    dryRun: e.DRY_RUN,
    schedule: { cron: e.CRON_SCHEDULE, timezone: e.TIMEZONE, runOnStart: e.RUN_ON_START },
    dbPath: e.DB_PATH,
    historyRetentionDays: e.HISTORY_RETENTION_DAYS,
    log: { level: e.LOG_LEVEL, pretty: e.LOG_PRETTY },
    currency: e.CURRENCY.toUpperCase(),
    adults: e.ADULTS,
    providers: e.PROVIDERS,
    serpApi: { ...(e.SERPAPI_KEY && { apiKey: e.SERPAPI_KEY }) },
    amadeus: {
      ...(e.AMADEUS_CLIENT_ID && { clientId: e.AMADEUS_CLIENT_ID }),
      ...(e.AMADEUS_CLIENT_SECRET && { clientSecret: e.AMADEUS_CLIENT_SECRET }),
      environment: e.AMADEUS_ENV,
    },
    requestDelayMs: { min: e.REQUEST_DELAY_MIN_MS, max: e.REQUEST_DELAY_MAX_MS },
    maxSearchesPerRoute: e.MAX_SEARCHES_PER_ROUTE,
    rules: {
      cooldownHours: e.COOLDOWN_HOURS,
      dropPercent: e.DROP_PERCENT,
      dropWindowDays: e.DROP_WINDOW_DAYS,
      dropMinSamples: e.DROP_MIN_SAMPLES,
    },
    routes: loadRoutes(e.ROUTES_FILE),
  };
}
