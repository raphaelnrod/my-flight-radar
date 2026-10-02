import type { Itinerary, FlightOffer } from '../types.js';
import { formatDateBr, formatDuration } from '../utils/time.js';

export const AIRLINE_NAMES: Record<string, string> = {
  LA: 'LATAM',
  JJ: 'LATAM',
  IB: 'Iberia',
  UX: 'Air Europa',
  AF: 'Air France',
  KL: 'KLM',
  TP: 'TAP Air Portugal',
  AZ: 'ITA Airways',
  LH: 'Lufthansa',
  BA: 'British Airways',
  AD: 'Azul',
  G3: 'GOL',
  AA: 'American Airlines',
  UA: 'United',
  DL: 'Delta',
  AV: 'Avianca',
  CM: 'Copa Airlines',
  EK: 'Emirates',
  QR: 'Qatar Airways',
  TK: 'Turkish Airlines',
};

export const airlineName = (code: string): string => AIRLINE_NAMES[code] ?? code;

export interface AlertMessage {
  routeId: string;
  from: string;
  to: string;
  departureDate: string;
  returnDate?: string;
  offer: FlightOffer;
  maxPrice: number;
  reasons: ('below-max-price' | 'price-drop')[];
  dropPercent: number | null;
  averagePrice: number | null;
}

export const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const formatBrl = (value: number): string =>
  `R$ ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(value))}`;

export function describeStops(itinerary: Itinerary): string {
  const { layovers, durationMinutes } = itinerary;
  const total = formatDuration(durationMinutes);
  if (layovers.length === 0) return `Direto (${total})`;
  const places = layovers.map((l) => `${l.airport} (${formatDuration(l.durationMinutes)})`).join(', ');
  const noun = layovers.length === 1 ? 'parada' : 'paradas';
  return `${layovers.length} ${noun} em ${places} · total ${total}`;
}

const formatDateTime = (isoLocal: string): string => `${formatDateBr(isoLocal.slice(0, 10)).slice(0, 5)} ${isoLocal.slice(11, 16)}`;

/** Mensagem em HTML do Telegram (parse_mode=HTML). */
export function formatAlert(alert: AlertMessage): string {
  const { offer } = alert;
  const outbound = offer.itineraries[0];
  const inbound = offer.itineraries[1];
  const airlines = offer.airlines.map(airlineName).join(' + ');

  const dates = alert.returnDate
    ? `${formatDateBr(alert.departureDate)} a ${formatDateBr(alert.returnDate)}`
    : formatDateBr(alert.departureDate);

  const lines = [
    `✈️ <b>Alerta de Passagem ${escapeHtml(airlines)}: [${alert.from}] -&gt; [${alert.to}]</b>`,
    `💰 <b>Preço:</b> ${formatBrl(offer.price)}`,
    `📅 <b>Datas:</b> ${dates}`,
  ];

  if (outbound) {
    const label = inbound ? 'Ida: ' : '';
    let stops = `${label}${describeStops(outbound)}`;
    if (inbound) stops += ` | Volta: ${describeStops(inbound)}`;
    lines.push(`⏱️ <b>Duração / Escalas:</b> ${escapeHtml(stops)}`);

    const first = outbound.segments[0];
    const last = outbound.segments[outbound.segments.length - 1];
    if (first && last) {
      lines.push(`🛫 <b>Horários:</b> ${formatDateTime(first.departure)} → ${formatDateTime(last.arrival)}`);
    }
  }

  const why: string[] = [];
  if (alert.reasons.includes('below-max-price')) why.push(`abaixo do teto de ${formatBrl(alert.maxPrice)}`);
  if (alert.reasons.includes('price-drop') && alert.dropPercent !== null && alert.averagePrice !== null) {
    why.push(`${alert.dropPercent.toFixed(0)}% abaixo da média recente (${formatBrl(alert.averagePrice)})`);
  }
  if (why.length > 0) lines.push(`📉 ${escapeHtml(why.join(' · '))}`);

  lines.push(`🔗 <a href="${escapeHtml(offer.link)}">Ver no Google Flights / Link de Compra</a>`);
  return lines.join('\n');
}
