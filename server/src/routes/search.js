import { Router } from 'express';
import { searchStocks, masterStatus, getMaster } from '../stockMaster.js';

export const searchRouter = Router();

/** GET /api/search?q=삼성 — 종목명 또는 코드로 검색 */
searchRouter.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ query: q, items: [], masterEmpty: false });

    const { items, masterEmpty } = await searchStocks(q, Math.min(Number(req.query.limit ?? 12), 30));
    res.json({ query: q, items, masterEmpty });
  } catch (err) { next(err); }
});

/** GET /api/master — 캐시 상태 확인 (디버깅용) */
searchRouter.get('/master', async (_req, res, next) => {
  try {
    await getMaster();
    res.json(masterStatus());
  } catch (err) { next(err); }
});
