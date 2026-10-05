import type { FlightOffer, Itinerary, Segment } from '../types.js';
import { formatDateBr, formatDuration } from '../utils/time.js';

export const AIRLINE_NAMES: Record<string, string> = {
  // Brasil e América do Sul
  LA: 'LATAM Airlines',
  JJ: 'LATAM Airlines',
  LU: 'LATAM Airlines',
  G3: 'GOL',
  AD: 'Azul',
  '2Z': 'Voepass',
  AR: 'Aerolíneas Argentinas',
  AV: 'Avianca',
  CM: 'Copa Airlines',
  H2: 'Sky Airline',
  JA: 'JetSMART',
  // Europa
  IB: 'Iberia',
  I2: 'Iberia Express',
  UX: 'Air Europa',
  VY: 'Vueling',
  TP: 'TAP Air Portugal',
  AF: 'Air France',
  KL: 'KLM',
  LH: 'Lufthansa',
  LX: 'SWISS',
  OS: 'Austrian',
  SN: 'Brussels Airlines',
  BA: 'British Airways',
  VS: 'Virgin Atlantic',
  AZ: 'ITA Airways',
  EI: 'Aer Lingus',
  SK: 'SAS',
  AY: 'Finnair',
  LO: 'LOT Polish',
  TK: 'Turkish Airlines',
  FR: 'Ryanair',
  U2: 'easyJet',
  // América do Norte
  AA: 'American Airlines',
  UA: 'United Airlines',
  DL: 'Delta Air Lines',
  AC: 'Air Canada',
  AM: 'Aeroméxico',
  B6: 'JetBlue',
  // Oriente Médio, África e Ásia
  EK: 'Emirates',
  QR: 'Qatar Airways',
  EY: 'Etihad',
  ET: 'Ethiopian Airlines',
  SA: 'South African Airways',
  AT: 'Royal Air Maroc',
  SQ: 'Singapore Airlines',
  CX: 'Cathay Pacific',
  NH: 'ANA',
  JL: 'Japan Airlines',
  KE: 'Korean Air',
  AI: 'Air India',
  QF: 'Qantas',
};

/** Nome legível: tabela local, depois o nome informado pelo provedor, por fim a sigla. */
export function airlineLabel(code: string, segments: Segment[] = []): string {
  return (
    AIRLINE_NAMES[code] ?? segments.find((s) => s.airline === code && s.airlineName)?.airlineName ?? code
  );
}

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

/** `3450` -> `R$ 3.450` (sem depender de ICU). */
const formatBrl = (value: number): string =>
  `R$ ${Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** `2026-10-15` -> `qui, 15/10/2026` */
function formatDay(date: string): string {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';
  return `${weekday}, ${formatDateBr(date)}`;
}

const timeOf = (isoLocal: string): string => isoLocal.slice(11, 16);

/** `(+1)` quando a chegada ocorre em outro dia que a saída. */
function dayShift(from: string, to: string): string {
  const days = Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  return days > 0 ? ` (+${days})` : '';
}

function describeStops(itinerary: Itinerary): string {
  const count = itinerary.layovers.length;
  if (count === 0) return 'Direto';
  return `${count} ${count === 1 ? 'parada' : 'paradas'}`;
}

function formatItinerary(label: string, icon: string, itinerary: Itinerary): string[] {
  const first = itinerary.segments[0];
  const last = itinerary.segments[itinerary.segments.length - 1];
  if (!first || !last) return [];

  const names = [...new Set(itinerary.segments.map((s) => airlineLabel(s.airline, itinerary.segments)))];
  const flight = itinerary.segments.length === 1 && first.flightNumber ? ` · ${escapeHtml(first.flightNumber)}` : '';
  const lines = [
    `${icon} <b>${label}</b> · ${formatDay(first.departure.slice(0, 10))}`,
    `🕐 Saída <b>${timeOf(first.departure)}</b> → Chegada <b>${timeOf(last.arrival)}</b>${dayShift(first.departure, last.arrival)}`,
    `⏱ ${formatDuration(itinerary.durationMinutes)} no total · ${describeStops(itinerary)}`,
    `🏢 ${escapeHtml(names.join(' + '))}${flight}`,
  ];

  if (itinerary.segments.length === 1) return lines;

  lines.push('');
  itinerary.segments.forEach((segment, i) => {
    const number = segment.flightNumber ? ` · ${escapeHtml(segment.flightNumber)}` : '';
    lines.push(
      `   <b>${segment.from}</b> ${timeOf(segment.departure)} → <b>${segment.to}</b> ${timeOf(segment.arrival)}${dayShift(segment.departure, segment.arrival)}${number}`,
    );
    const layover = itinerary.layovers[i];
    if (layover) lines.push(`   ⏳ Conexão em ${layover.airport}: ${formatDuration(layover.durationMinutes)}`);
  });
  return lines;
}

/** Mensagem em HTML do Telegram (parse_mode=HTML). */
export function formatAlert(alert: AlertMessage): string {
  const { offer } = alert;
  const [outbound, inbound] = offer.itineraries;
  const allSegments = offer.itineraries.flatMap((i) => i.segments);
  const airlines = offer.airlines.map((code) => airlineLabel(code, allSegments)).join(' + ');

  const blocks: string[][] = [
    [
      `✈️ <b>${alert.from} → ${alert.to}</b>`,
      `<b>${escapeHtml(airlines)}</b>`,
    ],
    [`💰 <b>${formatBrl(offer.price)}</b> ${alert.returnDate ? '· ida e volta' : '· somente ida'}`],
  ];

  if (outbound) blocks.push(formatItinerary('IDA', '🛫', outbound));

  if (inbound) {
    blocks.push(formatItinerary('VOLTA', '🛬', inbound));
  } else if (alert.returnDate) {
    // Nem todo provedor detalha o voo de volta numa busca de ida e volta.
    blocks.push([
      `🛬 <b>VOLTA</b> · ${formatDay(alert.returnDate)}`,
      '<i>Horários da volta não informados por esta fonte — veja no Google Flights.</i>',
    ]);
  }

  if (alert.reasons.includes('price-drop') && alert.dropPercent !== null && alert.averagePrice !== null) {
    blocks.push([
      `📉 <b>${alert.dropPercent.toFixed(0)}% mais barato</b> que a média recente (${formatBrl(alert.averagePrice)})`,
    ]);
  }

  blocks.push([`🔗 <a href="${escapeHtml(offer.link)}">Ver no Google Flights</a>`]);

  return blocks.map((lines) => lines.join('\n')).join('\n\n');
}
