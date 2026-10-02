import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { RouteConfig } from '../types.js';
import { formatIsoDate, parseIsoDate } from '../utils/time.js';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato YYYY-MM-DD')
  .refine((value) => formatIsoDate(parseIsoDate(value)) === value, 'data inexistente');

const iataCode = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'código IATA de 3 letras')
  .transform((value) => value.toUpperCase());

const airlineCode = z
  .string()
  .regex(/^[A-Za-z0-9]{2}$/, 'código IATA de companhia (2 caracteres)')
  .transform((value) => value.toUpperCase());

const dateSpec = z.union([
  z.array(isoDate).min(1),
  z
    .object({
      from: isoDate,
      to: isoDate,
      stepDays: z.number().int().positive().default(1),
    })
    .refine((range) => range.from <= range.to, 'from deve ser <= to'),
]);

const routeSchema = z
  .object({
    id: z.string().min(1),
    fromAirport: iataCode,
    toAirport: iataCode,
    targetAirlines: z.array(airlineCode).default(['LA']),
    departureDateRange: dateSpec,
    returnDateRange: dateSpec.optional(),
    minStayDays: z.number().int().nonnegative().optional(),
    maxStayDays: z.number().int().positive().optional(),
    maxPrice: z.number().positive(),
    active: z.boolean().default(true),
  })
  .refine((route) => route.fromAirport !== route.toAirport, 'origem e destino iguais');

const routesSchema = z
  .array(routeSchema)
  .refine((routes) => new Set(routes.map((r) => r.id)).size === routes.length, 'ids de rota duplicados');

export function parseRoutes(raw: unknown): RouteConfig[] {
  const result = routesSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Configuração de rotas inválida:\n${z.prettifyError(result.error)}`);
  }
  // O parse do zod não preserva a distinção "ausente" vs "undefined" exigida por
  // exactOptionalPropertyTypes; removemos chaves undefined explicitamente.
  return result.data.map((route) => {
    const { returnDateRange, minStayDays, maxStayDays, ...rest } = route;
    return {
      ...rest,
      ...(returnDateRange !== undefined && { returnDateRange }),
      ...(minStayDays !== undefined && { minStayDays }),
      ...(maxStayDays !== undefined && { maxStayDays }),
    };
  });
}

export function loadRoutes(file: string): RouteConfig[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Não foi possível ler ${file}: ${(error as Error).message}`, { cause: error });
  }
  return parseRoutes(raw);
}
