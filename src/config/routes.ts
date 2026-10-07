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

/** Um código ou lista de códigos, normalizado para lista sem duplicatas. */
const airportList = z
  .union([iataCode, z.array(iataCode).min(1)])
  .transform((value) => (Array.isArray(value) ? [...new Set(value)] : [value]));

const overlaps = (a: string[], b: string[]): boolean => a.some((code) => b.includes(code));

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
    fromAirport: airportList,
    toAirport: airportList,
    returnFromAirport: airportList.optional(),
    returnToAirport: airportList.optional(),
    includeReverse: z.boolean().default(false),
    allowSameEntryExit: z.boolean().default(false),
    ticketMode: z.enum(['both', 'separate', 'single']).default('both'),
    maxSearches: z.number().int().positive().optional(),
    targetAirlines: z.array(airlineCode).default(['LA']),
    departureDateRange: dateSpec,
    returnDateRange: dateSpec.optional(),
    minStayDays: z.number().int().nonnegative().optional(),
    maxStayDays: z.number().int().positive().optional(),
    maxPrice: z.number().positive(),
    active: z.boolean().default(true),
  })
  .refine((route) => !overlaps(route.fromAirport, route.toAirport), 'origem e destino da ida em comum')
  .refine(
    (route) => !overlaps(route.returnFromAirport ?? route.toAirport, route.returnToAirport ?? route.fromAirport),
    'origem e destino da volta em comum',
  )
  .refine(
    (route) =>
      route.returnDateRange !== undefined ||
      (route.returnFromAirport === undefined &&
        route.returnToAirport === undefined &&
        route.fromAirport.length === 1 &&
        route.toAirport.length === 1),
    'listas de aeroportos, returnFromAirport e returnToAirport exigem returnDateRange',
  );

const routesSchema = z
  .array(routeSchema)
  .refine((routes) => new Set(routes.map((r) => r.id)).size === routes.length, 'ids de rota duplicados');

/**
 * Rota pesquisada trecho a trecho: vários aeroportos em algum lado ou volta por aeroportos
 * diferentes do inverso da ida. Caso contrário, é a busca simples de ida e volta (ou só ida).
 */
export const isMultiDestination = (route: RouteConfig): boolean =>
  route.returnFromAirport !== undefined ||
  route.returnToAirport !== undefined ||
  route.fromAirport.length > 1 ||
  route.toAirport.length > 1;

export function parseRoutes(raw: unknown): RouteConfig[] {
  const result = routesSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Configuração de rotas inválida:\n${z.prettifyError(result.error)}`);
  }
  // O parse do zod não preserva a distinção "ausente" vs "undefined" exigida por
  // exactOptionalPropertyTypes; removemos chaves undefined explicitamente.
  return result.data.map((route) => {
    const { returnDateRange, minStayDays, maxStayDays, returnFromAirport, returnToAirport, maxSearches, ...rest } =
      route;
    return {
      ...rest,
      ...(returnFromAirport !== undefined && { returnFromAirport }),
      ...(returnToAirport !== undefined && { returnToAirport }),
      ...(maxSearches !== undefined && { maxSearches }),
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
