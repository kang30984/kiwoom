import { US } from '../markets.js';

/**
 * 미국 증시 데모 데이터. API 키 없이 화면을 확인하기 위한 것으로
 * 실제 시세와 무관합니다.
 */

const UNIVERSE = [
  { symbol: 'AAPL',  name: 'Apple Inc.',                  base: 232.4 },
  { symbol: 'MSFT',  name: 'Microsoft Corporation',       base: 441.8 },
  { symbol: 'NVDA',  name: 'NVIDIA Corporation',          base: 128.6 },
  { symbol: 'AMZN',  name: 'Amazon.com, Inc.',            base: 198.2 },
  { symbol: 'GOOGL', name: 'Alphabet Inc.',               base: 176.9 },
  { symbol: 'META',  name: 'Meta Platforms, Inc.',        base: 585.3 },
  { symbol: 'TSLA',  name: 'Tesla, Inc.',                 base: 248.7 },
  { symbol: 'AMD',   name: 'Advanced Micro Devices, Inc.', base: 152.4 },
  { symbol: 'SPY',   name: 'SPDR S&P 500 ETF Trust',      base: 583.1 },
  { symbol: 'QQQ',   name: 'Invesco QQQ Trust',           base: 502.6 },
];

const snap = (p) => US.snapTick(p, 'nearest');
const state = new Map();

function seedOf(symbol) {
  const known = UNIVERSE.find((s) => s.symbol === symbol);
  if (known) return known;
  const sum = [...symbol].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return { symbol, name: `${symbol} (demo)`, base: snap(20 + (sum % 380)) };
}

function stateOf(symbol) {
  const key = symbol.toUpperCase();
  if (!state.has(key)) {
    const seed = seedOf(key);
    const prevClose = snap(seed.base);
    const price = snap(prevClose * (1 + (Math.random() - 0.5) * 0.03));
    state.set(key, {
      ...seed,
      prevClose,
      price,
      open: snap(prevClose * (1 + (Math.random() - 0.5) * 0.01)),
      high: price,
      low: price,
      volume: Math.floor(2_000_000 + Math.random() * 60_000_000),
    });
  }
  return state.get(key);
}

function toQuote(s) {
  const change = Number((s.price - s.prevClose).toFixed(4));
  return {
    market: 'US',
    currency: 'USD',
    code: s.symbol,
    name: s.name,
    price: s.price,
    change,
    changeRate: Number(((change / s.prevClose) * 100).toFixed(2)),
    volume: s.volume,
    open: s.open,
    high: s.high,
    low: s.low,
    delayed: true,
  };
}

export function usDemoQuote(symbol) {
  return toQuote(stateOf(symbol));
}

export function usDemoSearch(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return UNIVERSE
    .filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    .map((s) => ({ code: s.symbol, name: s.name, market: 'US', exchange: 'DEMO' }))
    .slice(0, 12);
}

/** 일봉/주봉/월봉. 미국은 가격제한폭이 없어 되돌림만 걸어둡니다. */
export function usDemoCandles(symbol, type, countOverride) {
  const s = stateOf(symbol);
  const count = Number(countOverride) > 0
    ? Math.min(Number(countOverride), 3_000)
    : ({ week: 156, month: 72 }[type] ?? 261);

  const shockScale = { day: 0.026, week: 0.06, month: 0.12 }[type] ?? 0.026;
  const wickScale = { day: 0.008, week: 0.02, month: 0.045 }[type] ?? 0.008;
  const iterations = type === 'day' ? Math.ceil((count * 7) / 5) : count;

  const candles = [];
  const cursor = new Date();
  let close = s.base;

  for (let i = iterations; i > 0; i -= 1) {
    const at = new Date(cursor);
    if (type === 'week') {
      at.setDate(at.getDate() - i * 7);
      at.setDate(at.getDate() - ((at.getDay() + 6) % 7));
    } else if (type === 'month') {
      at.setDate(1);
      at.setMonth(at.getMonth() - i);
    } else {
      at.setDate(at.getDate() - i);
      if (at.getDay() === 0 || at.getDay() === 6) continue;
    }

    const open = close;
    const revert = -((close - s.base) / s.base) * 0.1;
    close = Math.max(0.01, snap(open * (1 + revert + (Math.random() - 0.5) * shockScale)));
    const wick = Math.max(open, close) * (0.001 + Math.random() * wickScale);

    const pad = (n) => String(n).padStart(2, '0');
    candles.push({
      time: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
      open: snap(open),
      high: snap(Math.max(open, close) + wick),
      low: Math.max(0.01, snap(Math.min(open, close) - wick)),
      close,
      volume: Math.floor(1_000_000 + Math.random() * 40_000_000),
    });
  }

  return candles;
}
