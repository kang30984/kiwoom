import { Router } from 'express';
import { TR } from '../config.js';
import { callTr, num, parseOrderbook, normalizeCode } from '../kiwoomRest.js';
import { config } from '../config.js';
import { demoQuote, demoOrderbook } from '../demoFeed.js';

export const quoteRouter = Router();

/** GET /api/quote/005930 — 현재가 스냅샷 */
quoteRouter.get('/quote/:code', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    if (config.demo) return res.json(demoQuote(code));

    const { data } = await callTr(TR.STOCK_INFO, { stk_cd: code });

    res.json({
      code,
      name: data.stk_nm ?? code,
      price: Math.abs(num(data.cur_prc) ?? 0),
      change: num(data.pred_pre) ?? 0,          // 전일대비
      changeRate: num(data.flu_rt) ?? 0,        // 등락률
      volume: num(data.trde_qty) ?? 0,
      open: Math.abs(num(data.open_pric) ?? 0),
      high: Math.abs(num(data.high_pric) ?? 0),
      low: Math.abs(num(data.low_pric) ?? 0),
      upperLimit: Math.abs(num(data.upl_pric) ?? 0),
      lowerLimit: Math.abs(num(data.lst_pric) ?? 0),
      marketCap: num(data.mac),
      per: num(data.per),
      raw: process.env.NODE_ENV === 'development' ? data : undefined,
    });
  } catch (err) { next(err); }
});

/** GET /api/orderbook/005930 — 호가 10단계 */
quoteRouter.get('/orderbook/:code', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    if (config.demo) return res.json(demoOrderbook(code));

    const { data } = await callTr(TR.ORDERBOOK, { stk_cd: code });
    const { ask, bid } = parseOrderbook(data);
    res.json({ code, ask, bid });
  } catch (err) { next(err); }
});
