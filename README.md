# flight-radar

Monitor autônomo de passagens aéreas com alertas no Telegram, sem custo de operação
(o provedor padrão consulta o Google Flights diretamente; SerpApi/Amadeus são fallbacks opcionais).

```
cron (3h) → Monitor → FlightProvider (Google Flights → SerpApi → Amadeus)
                         ├─ filtra companhias (targetAirlines)
                         ├─ SQLite: histórico de preços + alertas enviados
                         ├─ decide(): preço < maxPrice  OU  queda ≥15% vs. média de 7 dias
                         │            + cooldown de 12h (reenvia só se o preço cair mais)
                         └─ Telegram (HTML)
```

## Início rápido

Requer **Node.js 22 ou superior** (veja `.nvmrc`). Em Ubuntu: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`.
Se o `npm ci` tentar compilar o `better-sqlite3` (aparece `node-gyp rebuild`), instale as ferramentas: `sudo apt-get install -y build-essential python3`.
Em Linux com glibc antiga (ex.: Ubuntu 20.04) o binário pré-compilado pode falhar com `GLIBC_2.xx not found`; nesse caso force a compilação: `npm_config_build_from_source=true npm ci`. O `better-sqlite3` está fixado na 11.1.2 porque versões mais novas exigem `-std=c++20` (g++ ≥ 10) para compilar.

```bash
npm ci
cp .env.example .env          # preencha TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID
$EDITOR config/routes.json    # defina suas rotas
npm run dev:once              # um ciclo (use DRY_RUN=true para não enviar nada)
npm run build && npm start    # modo agendado
```

## Rotas (`config/routes.json`)

| campo | descrição |
|---|---|
| `id` | identificador único |
| `fromAirport` / `toAirport` | IATA de aeroporto ou cidade (`GRU`, `SAO`, `BCN`) ou lista (`["GRU", "GIG", "VCP"]`) |
| `targetAirlines` | companhias permitidas (padrão `["LA"]`). Uma oferta só é aceita se **todos** os trechos forem dessas companhias; `[]` = qualquer |
| `departureDateRange` | `{ "from", "to", "stepDays"? }` ou lista `["2026-10-15", ...]` |
| `returnDateRange` | idem, opcional (omitido = só ida) |
| `minStayDays` / `maxStayDays` | opcionais; filtram combinações ida/volta |
| `maxPrice` | teto em BRL que dispara o alerta |
| `active` | liga/desliga a rota |
| `maxSearches` | opcional; sobrescreve `MAX_SEARCHES_PER_ROUTE` só para esta rota |
| `returnFromAirport` | opcional; origem da volta, se diferente do destino da ida: `"LHR"`, `["LHR", "LGW"]` ou cidade `"LON"` |
| `returnToAirport` | opcional; destino(s) da volta. Padrão = os mesmos de `fromAirport` (volta para qualquer um deles) |
| `includeReverse` | `true` = também pesquisa a rota invertida (ver abaixo). Padrão `false` |
| `allowSameEntryExit` | `true` = também aceita entrar e sair da viagem pela mesma cidade de destino. Padrão `false` |
| `ticketMode` | `both` (padrão), `separate` (dois bilhetes só ida) ou `single` (um bilhete multidestinos) |

Cada combinação ida×volta é uma busca; `MAX_SEARCHES_PER_ROUTE` (padrão 30) limita o total por ciclo
(amostragem uniforme), e `REQUEST_DELAY_*` espaça as requisições.

### Vários aeroportos e ida/volta por cidades diferentes (multidestinos)

Com um único aeroporto de cada lado e sem `returnFromAirport`/`returnToAirport`, nada muda: ida e volta
pela mesma rota. Com listas de aeroportos ou volta por outra cidade, a rota é pesquisada trecho a trecho e,
para cada par de datas, vale a combinação mais barata. Exemplo de eurotrip, saindo de GRU, GIG ou VCP, entrando
por Barcelona e saindo por Londres (ou o contrário) e voltando para qualquer um dos três:

```json
{
  "id": "eurotrip-ago-2027",
  "fromAirport": ["GRU", "GIG", "VCP"],
  "toAirport": "BCN",
  "returnFromAirport": ["LHR", "LGW"],
  "includeReverse": true,
  "ticketMode": "separate",
  "targetAirlines": [],
  "departureDateRange": { "from": "2027-08-01", "to": "2027-08-05" },
  "returnDateRange": { "from": "2027-08-18", "to": "2027-08-22" },
  "minStayDays": 14,
  "maxStayDays": 20,
  "maxSearches": 90,
  "maxPrice": 6000
}
```

- **Origem e volta no Brasil**: `fromAirport` aceita lista; a volta pode chegar em qualquer um deles
  (ex.: sai de GRU e volta para GIG). Para restringir, informe `returnToAirport`.
- **Entrada e saída do destino**: a ida chega em `toAirport` e a volta sai de `returnFromAirport`.
  `includeReverse: true` também pesquisa o contrário (entra por LHR/LGW, sai por BCN).
  Entrar e sair pela mesma cidade só é considerado com `allowSameEntryExit: true`
  (ou quando `returnFromAirport` é omitido: busca aberta com os mesmos destinos na entrada e na saída).
- **Duas estratégias de preço** (`ticketMode`):
  - `separate`: busca cada trecho como só ida e soma a ida mais barata com a volta mais barata (2 bilhetes).
    Cada trecho é pesquisado uma vez por data e todas as combinações de datas válidas são avaliadas.
  - `single`: busca o bilhete multidestinos (um só bilhete com os dois trechos). Às vezes sai mais barato,
    mas custa uma busca por par de datas × combinação de aeroportos (no exemplo acima, 36 por par de datas).
  - `both` (padrão): os trechos só ida têm prioridade; o que sobrar de `maxSearches` vai para multidestinos.
- As regras de alerta, o cooldown e o histórico funcionam como nas outras rotas, por par de datas.
- Códigos de cidade (`LON`, `PAR`, `MIL`, `ROM`, `NYC`, `SAO`, `RIO`, `BUE`, …) viram um aeroporto cada,
  e cada aeroporto é mais busca. Listar só os aeroportos que interessam economiza buscas.
- Quantas buscas no exemplo: 9 trechos só ida por data (3 origens × 3 destinos de cada lado).
  Com 5 datas de ida e 5 de volta, são 90 buscas para cobrir os 23 pares de datas válidos.
- Ao converter uma rota existente para multidestinos, troque o `id` para não misturar o histórico de preços.

## Regras de alerta

1. Preço mínimo da checagem `< maxPrice`, **ou**
2. preço ≥ 15% abaixo da média das coletas dos últimos 7 dias para a mesma rota/data
   (exige `DROP_MIN_SAMPLES`, padrão 3, coletas na janela, para evitar ruído).
3. **Cooldown**: mesmo alerta (rota+datas) não é reenviado em 12h, a menos que o preço seja menor
   que o do último alerta. Se o envio ao Telegram falhar, o alerta não é registrado e será tentado no ciclo seguinte.

Todos os parâmetros estão em `.env.example`.

## Provedores

`PROVIDERS=google-flights,serpapi,amadeus` define a ordem; o próximo só é usado quando o anterior **falha**
(bloqueio, erro de rede, formato inesperado) — resultado vazio é tratado como legítimo. Para adicionar uma fonte,
implemente `FlightProvider` (`src/types.ts`) e registre em `src/providers/index.ts`.

> ⚠️ O provedor Google Flights não usa API oficial: faz GET na página de resultados (parâmetro `tfs` em protobuf,
> rotação de User-Agent/Accept-Language) e lê o payload `ds:1`. O formato é interno do Google e pode mudar,
> e IPs de datacenter podem receber captcha. O parser é coberto por testes com fixture sintética, **não** foi
> validado contra respostas reais do Google neste repositório (o ambiente de desenvolvimento não tinha acesso).
> Por isso o fallback (SerpApi tem plano gratuito limitado; Amadeus tem sandbox) é recomendado. Rode `npm run dev:once`
> com `DRY_RUN=true` na sua máquina/servidor para confirmar antes de depender dele.

## Deploy

**Docker**
```bash
cp .env.example .env && $EDITOR .env
docker compose up -d --build
docker compose logs -f
```
O banco fica no volume `flight-radar-data`; `config/routes.json` é montado do host (reinicie após editar).

**Systemd**: veja o passo a passo no cabeçalho de `deploy/flight-radar.service`.

## Desenvolvimento

```bash
npm run typecheck && npm run lint && npm test
```
TypeScript `strict` (+ `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint `strictTypeChecked`,
logs JSON estruturados via pino (`LOG_PRETTY=true` para leitura humana em dev).
