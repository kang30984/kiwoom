import { Router } from 'express';
import { TR } from '../config.js';
import { callTr, num, normalizeCode } from '../kiwoomRest.js';
import { config } from '../config.js';
import { demoQuote } from '../demoFeed.js';
import { fetchCandles } from './chart.js';
import { computePlan } from '../analysis.js';

export const planRouter = Router();

/**
 * GET /api/plan/005930?capital=10000000&riskPct=1&atrMult=2
 *   &avgCost=70000&heldQty=10&buyFeePct=0.015&sellFeePct=0.015&sellTaxPct=0.18
 *
 * 방향(매수/매도) 판단은 하지 않습니다. 현재가와 변동성에서
 * 손절폭·수량·손익분기만 계산해 돌려줍니다.
 */
planRouter.get('/plan/:code', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    const q = req.query;

    // 현재가와 전일종가
    let price;
    let prevClose;
    let name;

    if (config.demo) {
      const snap = demoQuote(code);
      price = snap.price;
      prevClose = snap.price - snap.change;
      name = snap.name;
    } else {
      const { data } = await callTr(TR.STOCK_INFO, { stk_cd: code });
      price = Math.abs(num(data.cur_prc) ?? 0);
      prevClose = price - (num(data.pred_pre) ?? 0);
      name = data.stk_nm ?? code;
    }

    if (!price) {
      return res.status(422).json({ error: '현재가를 가져오지 못해 계산할 수 없습니다.' });
    }

    // ATR(14) 과 최근 20일 스윙에만 쓰므로 짧게 받습니다.
    // 차트처럼 3년치를 받으면 호출만 늘고 계산 결과는 같습니다.
    const candles = await fetchCandles(code, 'day', { pages: 1, count: 120 });

    const plan = computePlan({
      candles,
      price,
      prevClose,
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

    res.json({ code, name, candleCount: candles.length, ...plan });
  } catch (err) { next(err); }
});
