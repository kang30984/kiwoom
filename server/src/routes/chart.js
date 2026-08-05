import { Router } from 'express';
import { TR, CHART_YEARS } from '../config.js';
import { callTr, num, firstArray, normalizeCode } from '../kiwoomRest.js';
import { config } from '../config.js';
import { demoCandles } from '../demoFeed.js';

export const chartRouter = Router();

export { normalizeCandles };

const pad = (n) => String(n).padStart(2, '0');

function today() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** n년 전 날짜를 'YYYY-MM-DD' 로 */
function yearsAgo(n) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 기간(년) → 대략 몇 개의 봉이 필요한지. 데모 생성용입니다.
 * 실전 모드에서는 from 날짜로 잘라내므로 이 값이 쓰이지 않습니다.
 * 일봉은 공휴일을 빼지 않고 주 5일 기준(연 261일)으로 잡습니다 —
 * 데모 생성기가 주말만 건너뛰기 때문입니다.
 */
function candlesFor(type, years) {
  const perYear = { day: 261, week: 52, month: 12 }[type];
  return perYear ? Math.ceil(perYear * years) : undefined;
}

/** 'YYYYMMDD' 또는 'YYYYMMDDHHmmss' → ISO 문자열 */
function toIso(raw) {
  const s = String(raw ?? '');
  if (s.length < 8) return null;
  const date = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (s.length >= 12) return `${date}T${s.slice(8, 10)}:${s.slice(10, 12)}:00`;
  return date;
}

/**
 * 캔들을 시간 오름차순으로 정렬하고 중복 시각을 제거합니다.
 *
 * lightweight-charts 는 시간이 엄격히 증가하고 중복이 없어야 정상 동작합니다.
 * 어긋나면 시간축 라벨이 뒤엉켜 표시됩니다.
 *
 * 페이징으로 여러 번 받아 이어 붙이면 두 가지가 깨질 수 있습니다.
 *   1) 페이지가 겹쳐 같은 날짜가 두 번 들어온다
 *   2) 다음 페이지가 항상 더 과거라는 가정이 틀린다
 * 그래서 병합 후 한 번 정규화합니다.
 */
function normalizeCandles(candles) {
  const byTime = new Map();
  for (const c of candles) {
    if (c?.time) byTime.set(c.time, c);   // 같은 시각은 나중 값으로 덮습니다
  }
  return [...byTime.values()].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

function toCandles(rows) {
  return rows
    .map((r) => ({
      time: toIso(r.dt ?? r.cntr_tm ?? r.trde_dt),
      open: Math.abs(num(r.open_pric) ?? 0),
      high: Math.abs(num(r.high_pric) ?? 0),
      low: Math.abs(num(r.low_pric) ?? 0),
      close: Math.abs(num(r.cur_prc) ?? num(r.clos_pric) ?? 0),
      volume: Math.abs(num(r.trde_qty) ?? 0),
    }))
    .filter((c) => c.time && c.close > 0)
    .sort((a, b) => (a.time < b.time ? -1 : 1)); // 키움은 최신순 → 오름차순으로 뒤집기
}

/**
 * 캔들 조회. 차트 라우트와 매매계획 라우트가 함께 씁니다.
 * @returns {Promise<Array>} 오름차순 캔들
 */
const CHART_TR = {
  minute: TR.MINUTE_CHART,
  day: TR.DAILY_CHART,
  week: TR.WEEKLY_CHART,
  month: TR.MONTHLY_CHART,
};

/**
 * 캔들 조회. 차트 라우트와 매매계획 라우트가 함께 씁니다.
 * @param {object} opts
 * @param {string} [opts.from]  'YYYY-MM-DD'. 이 날짜까지 받아오고 그 이전은 잘라냅니다.
 * @param {number} [opts.pages] cont-yn 페이징 최대 횟수
 * @param {number} [opts.count] 데모 모드에서 생성할 봉 개수
 */
export async function fetchCandles(code, type = 'day', opts = {}) {
  if (config.demo) return normalizeCandles(demoCandles(code, type, opts.count));

  const from = opts.from ?? null;
  const maxPages = Math.min(Number(opts.pages ?? 1), 20);
  const tr = CHART_TR[type] ?? TR.DAILY_CHART;
  const body = type === 'minute'
    ? { stk_cd: code, tic_scope: String(opts.tick ?? '1'), upd_stkpc_tp: '1' }
    : { stk_cd: code, base_dt: String(opts.baseDate ?? today()), upd_stkpc_tp: '1' };

  let candles = [];
  let paging = {};

  for (let page = 0; page < maxPages; page += 1) {
    const { data, contYn, nextKey } = await callTr(tr, body, paging);
    // 키움은 최신순으로 주고, 다음 페이지는 더 과거입니다 → 앞에 붙입니다.
    candles = [...toCandles(firstArray(data)), ...candles];

    // 목표 시작일까지 확보했으면 더 부르지 않습니다 (호출 한도 절약)
    if (from && candles.length > 0 && candles[0].time.slice(0, 10) <= from) break;
    if (contYn !== 'Y' || !nextKey) break;
    paging = { contYn: 'Y', nextKey };
  }

  const ordered = normalizeCandles(candles);
  return from ? ordered.filter((c) => c.time.slice(0, 10) >= from) : ordered;
}

/**
 * GET /api/chart/005930?type=day
 * GET /api/chart/005930?type=minute&tick=5
 */
chartRouter.get('/chart/:code', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    const requested = String(req.query.type ?? 'day');
    // 모르는 타입을 조용히 day 로 바꾸면, 봉 종류를 추가하다 CHART_TR 등록을
    // 빠뜨렸을 때 '년봉' 탭에 일봉이 그려지는 것을 알아챌 수 없습니다.
    if (!Object.keys(CHART_TR).includes(requested)) {
      return res.status(400).json({
        error: `알 수 없는 차트 종류 '${requested}'`,
        detail: `사용 가능: ${Object.keys(CHART_TR).join(', ')}`,
      });
    }
    const type = requested;
    // 기본 조회 기간. ?years=5 로 덮어쓸 수 있습니다.
    const years = Number(req.query.years) > 0
      ? Number(req.query.years)
      : CHART_YEARS[type];

    const from = years ? yearsAgo(years) : undefined;

    const candles = await fetchCandles(code, type, {
      from,
      // 3년치를 채우려면 여러 페이지가 필요합니다
      pages: req.query.pages ?? (from ? 10 : 1),
      tick: req.query.tick,
      baseDate: req.query.baseDate,
      count: candlesFor(type, years),
    });

    res.json({ code, type, years: years ?? null, from: from ?? null, candles });
  } catch (err) { next(err); }
});
