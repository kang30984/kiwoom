import { Router } from 'express';
import { usProvider, normalizeSymbol } from '../us/provider.js';
import { US } from '../markets.js';
import { computePlan } from '../analysis.js';
import { normalizeCandles } from './chart.js';

export const usRouter = Router();

const pad = (n) => String(n).padStart(2, '0');

function yearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 국내와 같은 기본 기간: 일 1년 · 주 3년 · 월 6년 */
const YEARS = { day: 1, week: 3, month: 6 };
const PER_YEAR = { day: 261, week: 52, month: 12 };

/** GET /api/us/provider — 어느 공급자가 붙어 있는지 */
usRouter.get('/us/provider', (_req, res) => {
  const p = usProvider();
  res.json({ provider: p.id, delayed: p.delayed, ...(p.stats ? p.stats() : {}) });
});

/** GET /api/us/search?q=apple */
usRouter.get('/us/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ query: q, items: [] });
    const items = await usProvider().search(q);
    res.json({ query: q, items });
  } catch (err) { next(err); }
});

/** GET /api/us/quote/AAPL */
usRouter.get('/us/quote/:symbol', async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return res.status(400).json({ error: '티커가 비어 있습니다.' });
    res.json(await usProvider().quote(symbol));
  } catch (err) { next(err); }
});

/** GET /api/us/chart/AAPL?type=day */
usRouter.get('/us/chart/:symbol', async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    const requested = String(req.query.type ?? 'day');
    const allowed = ['day', 'week', 'month'];
    if (!allowed.includes(requested)) {
      return res.status(400).json({
        error: `알 수 없는 차트 종류 '${requested}'`,
        detail: `사용 가능: ${allowed.join(', ')} (미국 탭은 무료 티어 제약으로 분봉이 없습니다)`,
      });
    }
    const type = requested;

    const years = Number(req.query.years) > 0 ? Number(req.query.years) : YEARS[type];
    const from = yearsAgo(years);
    const count = Math.ceil(PER_YEAR[type] * years);

    const all = normalizeCandles(await usProvider().candles(symbol, type, count));
    const candles = all.filter((c) => c.time >= from);

    res.json({ code: symbol, market: 'US', type, years, from, candles });
  } catch (err) { next(err); }
});

/** GET /api/us/plan/AAPL?capital=...&riskPct=...&atrMult=... */
usRouter.get('/us/plan/:symbol', async (req, res, next) => {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    const q = req.query;

    const quote = await usProvider().quote(symbol);
    if (!quote.price) {
      return res.status(422).json({ error: '현재가를 가져오지 못해 계산할 수 없습니다.' });
    }

    const prevClose = quote.prevClose ?? (quote.price - (quote.change ?? 0));
    // 차트(일봉 1년 = 261봉)와 같은 크기로 요청해 캐시를 공유합니다.
    // 크기를 다르게 하면 캐시 키가 갈려 호출이 두 배가 됩니다.
    const candles = normalizeCandles(await usProvider().candles(symbol, 'day', PER_YEAR.day * YEARS.day));

    const plan = computePlan({
      candles,
      price: quote.price,
      prevClose,
      market: US,
      params: {
        atrMult: q.atrMult,
        capital: q.capital,
        riskPct: q.riskPct,
        avgCost: q.avgCost,
        heldQty: q.heldQty,
        costs: {
          ...(q.buyFeePct !== undefined ? { buyFeePct: Number(q.buyFeePct) } : {}),
          ...(q.sellFeePct !== undefined ? { sellFeePct: Number(q.sellFeePct) } : {}),
          ...(q.sellTaxPct !== undefined ? { sellTaxPct: Number(q.sellTaxPct) } : {}),
        },
      },
    });

    res.json({ code: symbol, name: quote.name, candleCount: candles.length, ...plan });
  } catch (err) { next(err); }
});
