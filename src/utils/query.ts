import type { SearchQuery } from '../types.js';

/** Aeroportos da volta: os informados ou o inverso da ida. */
export const returnLeg = (query: SearchQuery): { from: string; to: string } => ({
  from: query.returnFrom ?? query.to,
  to: query.returnTo ?? query.from,
});

/** Ida e volta por aeroportos diferentes num único bilhete (multidestinos / open-jaw). */
export function isMultiCity(query: SearchQuery): boolean {
  if (!query.returnDate) return false;
  const back = returnLeg(query);
  return back.from !== query.to || back.to !== query.from;
}
