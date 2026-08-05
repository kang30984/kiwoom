import { usDemoQuote, usDemoCandles, usDemoSearch } from './demoUs.js';
import { createGate, TTL } from './gate.js';

/**
 * 미국 시세 공급자 어댑터.
 *
 * 무료 API의 요금제·한도는 자주 바뀌므로 공급자를 갈아끼울 수 있게 분리했습니다.
 * 새 공급자를 붙일 때 아래 세 함수만 같은 모양으로 구현하면 됩니다.
 *   search(query) -> [{ code, name, exchange }]
 *   quote(symbol) -> { code, name, price, change, changeRate, volume, open, high, low }
 *   candles(symbol, type, count) -> [{ time, open, high, low, close, volume }]
 *
 * .env 의 US_PROVIDER 로 선택합니다. 기본값은 demo (키 불필요).
 */

const BASE = 'https://api.twelvedata.com';

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const INTERVAL = { day: '1day', week: '1week', month: '1month' };

async function tdFetch(path, params, apiKey) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('apikey', apiKey);

  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));

  // Twelve Data 는 오류도 200 으로 주고 body.status 에 표시합니다
  if (body?.status === 'error' || body?.code >= 400) {
    const raw = body.message ?? `미국 시세 요청 실패 (${res.status})`;
    // 한도 초과는 원문이 길고 영어라 알아보기 어렵습니다
    const overLimit = /API credits|rate limit|too many requests/i.test(raw);
    const err = new Error(overLimit
      ? '미국 시세 호출 한도를 넘었습니다. 잠시 후 자동으로 다시 시도됩니다.'
      : raw);
    err.status = overLimit ? 429 : 502;
    err.overLimit = overLimit;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`미국 시세 요청 실패 (${res.status})`);
    err.status = 502;
    throw err;
  }
  return body;
}

function twelveData(apiKey) {
  return {
    id: 'twelvedata',
    delayed: true,

    async search(query) {
      const body = await tdFetch('/symbol_search', { symbol: query, outputsize: 20 }, apiKey);
      const rows = Array.isArray(body?.data) ? body.data : [];
      return rows
        // 미국 거래소만 남깁니다
        .filter((r) => ['United States', 'US'].includes(r.country) || ['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'BATS'].includes(r.exchange))
        .slice(0, 12)
        .map((r) => ({
          code: String(r.symbol ?? '').toUpperCase(),
          name: r.instrument_name ?? r.symbol,
          exchange: r.exchange ?? '',
          market: 'US',
        }))
        .filter((r) => r.code);
    },

    async quote(symbol) {
      const q = await tdFetch('/quote', { symbol }, apiKey);
      const price = num(q.close) ?? num(q.price);
      const prevClose = num(q.previous_close);
      const change = num(q.change) ?? (price !== null && prevClose !== null ? price - prevClose : null);
      return {
        market: 'US',
        currency: 'USD',
        code: String(q.symbol ?? symbol).toUpperCase(),
        name: q.name ?? symbol,
        price,
        change,
        changeRate: num(q.percent_change),
        volume: num(q.volume),
        open: num(q.open),
        high: num(q.high),
        low: num(q.low),
        prevClose,
        delayed: true,
      };
    },

    async candles(symbol, type, count) {
      const body = await tdFetch('/time_series', {
        symbol,
        interval: INTERVAL[type] ?? '1day',
        outputsize: Math.min(Number(count) || 261, 5000),
        order: 'ASC',
      }, apiKey);

      const rows = Array.isArray(body?.values) ? body.values : [];
      return rows
        .map((r) => ({
          time: String(r.datetime ?? '').slice(0, 10),
          open: num(r.open),
          high: num(r.high),
          low: num(r.low),
          close: num(r.close),
          volume: num(r.volume) ?? 0,
        }))
        .filter((c) => c.time && c.close !== null)
        .sort((a, b) => (a.time < b.time ? -1 : 1));
    },
  };
}

const demoProvider = {
  id: 'demo',
  delayed: true,
  async search(query) { return usDemoSearch(query); },
  async quote(symbol) { return usDemoQuote(symbol); },
  async candles(symbol, type, count) { return usDemoCandles(symbol, type, count); },
};

/**
 * 캐시·호출제한을 씌운 래퍼.
 * 데모는 외부 호출이 없으므로 감싸지 않습니다.
 */
function withGate(provider, perMinute) {
  const gate = createGate({ perMinute });

  const guard = async (key, ttl, fn) => {
    try {
      return await gate.run(key, ttl, fn);
    } catch (err) {
      // 한도 초과라면 만료된 캐시라도 보여주는 편이 빈 화면보다 낫습니다
      const stale = gate.stale(key);
      if (stale && err.overLimit) {
        console.warn(`[us] 한도 초과 — 캐시된 값으로 응답 (${key})`);
        return stale;
      }
      throw err;
    }
  };

  return {
    id: provider.id,
    delayed: provider.delayed,
    stats: gate.stats,
    search: (q) => guard(`s:${q.toLowerCase()}`, TTL.search, () => provider.search(q)),
    quote: (sym) => guard(`q:${sym}`, TTL.quote, () => provider.quote(sym)),
    candles: (sym, type, count) => guard(
      `c:${sym}:${type}:${count}`, TTL.candles, () => provider.candles(sym, type, count),
    ),
  };
}

let cached = null;

export function usProvider() {
  if (cached) return cached;

  const name = String(process.env.US_PROVIDER ?? 'demo').toLowerCase();
  const key = process.env.US_API_KEY ?? '';
  const perMinute = Number(process.env.US_RATE_PER_MIN ?? 8);

  if (name === 'twelvedata') {
    if (!key) {
      console.warn('[us] US_PROVIDER=twelvedata 인데 US_API_KEY 가 없습니다. 데모로 대체합니다.');
      cached = demoProvider;
    } else {
      console.log(`[us] 공급자: twelvedata (15분 지연, 분당 ${perMinute}회 제한)`);
      cached = withGate(twelveData(key), perMinute);
    }
  } else {
    if (name !== 'demo') {
      console.warn(`[us] 알 수 없는 US_PROVIDER "${name}". 데모로 대체합니다.`);
    }
    cached = demoProvider;
  }

  return cached;
}

/** 티커 정규화. 미국은 문자·점·하이픈이 들어갑니다 (BRK.B, RDS-A) */
export function normalizeSymbol(raw) {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
}
