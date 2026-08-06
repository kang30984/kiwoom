import { Router } from 'express';
import { TR } from '../config.js';
import { callTr, num, firstArray, normalizeCode } from '../kiwoomRest.js';
import { config } from '../config.js';
import { krGate, KR_TTL } from '../cache.js';
import { demoRank } from '../demoFeed.js';

export const rankRouter = Router();

/**
 * GET /api/rank/volume?market=000
 * GET /api/rank/change?market=000&sort=1
 * market: 000 전체 / 001 코스피 / 101 코스닥
 */
rankRouter.get('/rank/:kind', async (req, res, next) => {
  try {
    const kind = req.params.kind === 'change' ? 'change' : 'volume';
    const market = String(req.query.market ?? '000');

    if (config.demo) return res.json({ kind, market, items: demoRank(kind) });

    const tr = kind === 'change' ? TR.CHANGE_RANK : TR.VOLUME_RANK;
    const body = kind === 'change'
      ? {
          mrkt_tp: market,
          sort_tp: String(req.query.sort ?? '1'), // 1 상승률 / 3 하락률
          trde_qty_cnd: '0000',
          stk_cnd: '0',
          crd_cnd: '0',
          updown_incls: '1',
          pric_cnd: '0',
          trde_prica_cnd: '0',
          stex_tp: '3',
        }
      : {
          mrkt_tp: market,
          sort_tp: '1',
          mang_stk_incls: '0',
          crd_tp: '0',
          trde_qty_tp: '0',
          pric_tp: '0',
          trde_prica_tp: '0',
          mrkt_open_tp: '0',
          stex_tp: '3',
        };

    // 순위는 모든 사용자가 같은 값을 봅니다. 30초 캐시로 키움 호출을 아낍니다
    // (README 의 '다음으로 붙일 만한 것' 항목 — Redis 없이 인메모리로 충분).
    const items = await krGate.run(`rank:${kind}:${market}`, KR_TTL.rank, async () => {
      const { data } = await callTr(tr, body);

      return firstArray(data).slice(0, 30).map((r, i) => ({
        rank: i + 1,
        code: normalizeCode(r.stk_cd),
        name: r.stk_nm ?? '',
        price: Math.abs(num(r.cur_prc) ?? 0),
        change: num(r.pred_pre) ?? 0,
        changeRate: num(r.flu_rt) ?? 0,
        volume: Math.abs(num(r.trde_qty) ?? 0),
      })).filter((x) => x.code);
    });

    res.json({ kind, market, items });
  } catch (err) { next(err); }
});
