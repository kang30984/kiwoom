import { Router } from 'express';
import { TR, config, FID_OVERRIDE } from '../config.js';
import { callTr, num, abs, net, firstArray, pickNum, pickStr, normalizeCode } from '../kiwoomRest.js';
import { krGate, KR_TTL } from '../cache.js';
import {
  demoStrength, demoStrengthTrend, demoProgram, demoProgramMarket,
} from '../demoFeed.js';

export const flowRouter = Router();

/**
 * 체결강도 · 프로그램 매매 동향.
 *
 * 두 기능의 성격이 다릅니다.
 *  - 체결강도는 종목별 틱 단위 스칼라입니다. 실시간(0B)으로도 들어오므로
 *    여기 REST 는 **초기값과 추이**용입니다. 화면은 스냅샷 → 실시간 덮어쓰기
 *    순서로 갱신합니다 (quote 와 같은 패턴).
 *  - 프로그램매매는 집계·지연 데이터라 실시간이 필요하지 않습니다.
 *    폴링(30~60초)으로 충분하고, 캐시 계층이 실제 호출을 막습니다.
 *
 * 모든 응답은 krGate 를 지나므로 여러 브라우저·탭이 같은 종목을 봐도
 * 키움 호출은 한 번입니다.
 */

/* ── 시간 표기 ─────────────────────────────────────────────── */

/** '093000' / '0930' / '20240115093000' → 'HH:MM' */
function toHhmm(raw) {
  const s = String(raw ?? '').replace(/[^0-9]/g, '');
  if (s.length >= 12) return `${s.slice(8, 10)}:${s.slice(10, 12)}`;
  if (s.length === 6) return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
  if (s.length === 4) return `${s.slice(0, 2)}:${s.slice(2, 4)}`;
  return null;
}

/** 'YYYYMMDD' → 'YYYY-MM-DD' */
function toDate(raw) {
  const s = String(raw ?? '').replace(/[^0-9]/g, '');
  if (s.length < 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const pad2 = (n) => String(n).padStart(2, '0');
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};


/**
 * ?debug=1 응답.
 *
 * NODE_ENV 를 건드리지 않고 원본 응답을 보기 위한 것입니다.
 * 필드명을 확정할 수 없는 TR 을 붙일 때는 이게 가장 빠릅니다 —
 * fields 에 컬럼 이름 목록이, parsed 에 지금 파서가 뽑아낸 값이 나오므로
 * 둘을 나란히 보고 어느 컬럼을 집어야 하는지 바로 판단할 수 있습니다.
 *
 * 게이트(캐시)를 우회합니다. 디버그 응답이 캐시에 남으면
 * 이후 일반 요청이 그 값을 받게 됩니다.
 */
function debugPayload(tr, data, unit, parse) {
  const arrayKeys = Object.keys(data ?? {}).filter((k) => Array.isArray(data[k]));
  const rows = firstArray(data);

  /* 컬럼 이름을 모든 행에서 합쳐 모읍니다.
     첫 행만 보면 부족합니다 — 순매수인 날과 순매도인 날에 채워지는 컬럼이
     다르면, 첫 행에 없는 컬럼이 정답일 수 있습니다. */
  const fields = [...new Set(rows.flatMap((r) => Object.keys(r ?? {})))];

  /* 파싱이 되는 행과 안 되는 행을 각각 하나씩 뽑습니다.
     ★ 안 되는 행이 가장 중요합니다. 그 행에 실제로 무슨 값이 들어있는지
     보면 어느 컬럼을 놓쳤는지 바로 드러납니다. */
  const withParse = rows.map((r) => ({ row: r, out: parse(r, unit) }));
  const ok = withParse.find((x) => x.out?.netQty !== null && x.out?.netQty !== undefined);
  const empty = withParse.find((x) => x.out?.netQty === null || x.out?.netQty === undefined);

  return {
    debug: true,
    apiId: tr.apiId,
    path: tr.path,
    returnCode: data?.return_code ?? null,
    arrayKeys,
    rowCount: rows.length,
    // ★ 실제 컬럼 이름 전체 목록
    fields,
    // ★ 값이 안 뽑히는 행 — 여기 있는 컬럼이 우리가 놓친 컬럼입니다
    emptyRow: empty ? { raw: empty.row, parsed: empty.out } : null,
    // 비교용: 값이 잘 뽑히는 행
    okRow: ok ? { raw: ok.row, parsed: ok.out } : null,
    sampleRows: rows.slice(0, 2),
    // 단건 응답 필드(배열 밖) — 여기 총계가 들어있는 TR 도 있습니다.
    topLevelFields: Object.fromEntries(
      Object.entries(data ?? {}).filter(([k, v]) => !Array.isArray(v) && !k.startsWith('return_')),
    ),
  };
}

/* ── 체결강도 ─────────────────────────────────────────────── */

/**
 * 체결강도 행 파싱.
 * 필드명을 확정할 수 없으므로 후보 + 정규식으로 훑습니다 (firstArray 와 같은 이유).
 * 체결강도는 비율이라 음수가 없으므로 abs 로 받습니다.
 */
function toStrengthRow(row) {
  return {
    time: toHhmm(pickStr(row, ['cntr_tm', 'tm', 'time'], /(^|_)tm$|time/i))
      ?? toDate(pickStr(row, ['dt', 'trde_dt'], /(^|_)dt$/i)),
    strength: pickNum(row, ['cntr_str', 'cntr_str_rt', 'str'], /cntr_?str/i, abs),
    volume: pickNum(row, ['trde_qty', 'acc_trde_qty'], /trde_qty/i, abs),
    price: pickNum(row, ['cur_prc'], /cur_prc/i, abs),
  };
}

/**
 * GET /api/strength/005930
 * GET /api/strength/005930?period=day
 *
 * → { code, strength, thin, trend: [{ time, strength, volume }], asOf }
 */
flowRouter.get('/strength/:code', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    const period = req.query.period === 'day' ? 'day' : 'time';

    if (config.demo) {
      const snap = demoStrength(code);
      return res.json({
        ...snap,
        period,
        trend: demoStrengthTrend(code),
        asOf: todayIso(),
        demo: true,
      });
    }

    const tr = period === 'day' ? TR.STRENGTH_DAY : TR.STRENGTH_TIME;
    const key = `str:${code}:${period}`;
    const ttl = period === 'day' ? KR_TTL.strengthTrend : KR_TTL.strength;

    if (String(req.query.debug) === '1') {
      const { data } = await callTr(tr, { stk_cd: code });
      return res.json(debugPayload(tr, data, 1, (r) => toStrengthRow(r)));
    }

    const payload = await krGate.run(key, ttl, async () => {
      const { data } = await callTr(tr, { stk_cd: code });
      const rows = firstArray(data).map(toStrengthRow).filter((r) => r.strength !== null);

      // 키움은 최신순으로 주는 편입니다. 화면은 시간 오름차순으로 그립니다.
      rows.sort((a, b) => (String(a.time) < String(b.time) ? -1 : 1));

      const latest = rows.at(-1) ?? null;
      const totalVol = rows.reduce((sum, r) => sum + (r.volume ?? 0), 0);

      return {
        code,
        period,
        // 실시간(0B)이 곧 덮어쓰므로 이 값은 초기 표시용입니다.
        strength: latest?.strength ?? null,
        buyVolume: null,   // 이 TR 은 매수/매도 체결량을 따로 주지 않습니다
        sellVolume: null,
        // 표본이 적으면 분모가 작아 값이 크게 튑니다 (장 초반).
        thin: rows.length > 0 && rows.length < 4,
        trend: rows,
        asOf: todayIso(),
        raw: process.env.NODE_ENV === 'development' ? data : undefined,
      };
    });

    res.json(payload);
  } catch (err) { next(err); }
});

/* ── 프로그램 매매 ────────────────────────────────────────── */

/**
 * 프로그램매매 행 파싱.
 *
 * 두 가지를 반드시 지켜야 합니다.
 *  1) **부호를 죽이지 않습니다.** net() 을 씁니다. abs() 를 쓰면 순매도가
 *     순매수로 뒤집혀 표시되고, 숫자가 그럴듯해서 눈으로 안 잡힙니다.
 *  2) **금액 단위를 정규화합니다.** 키움은 TR 마다 원/천원/백만원이 섞입니다.
 *     config.programAmountUnit 을 곱해 원으로 맞추고, 가정한 단위를
 *     응답에 함께 담아 화면에 표시합니다.
 */
function toProgramRow(row, unit) {
  /* 필드명은 ka90013(종목일별 프로그램매매추이) 실제 응답으로 확인했습니다.
     정규식 fallback 은 문서 개정 대비로 남겨둡니다. $ 를 붙여
     prm_netprps_qty_irds(증감)를 잘못 집지 않게 합니다. */
  const netQty = pickNum(row, ['prm_netprps_qty'], /netprps.*qty$/i, net);
  const rawAmount = pickNum(row, ['prm_netprps_amt'], /netprps.*amt$/i, net);

  // 이 TR 은 매수/매도를 따로 줍니다. 순매수의 검산 근거가 되고,
  // 화면에서 규모를 함께 보여줄 수 있습니다.
  const buyQty = pickNum(row, ['prm_buy_qty'], /buy.*qty$/i, abs);
  const sellQty = pickNum(row, ['prm_sell_qty'], /sell.*qty$/i, abs);
  const rawBuyAmt = pickNum(row, ['prm_buy_amt'], /buy.*amt$/i, abs);
  const rawSellAmt = pickNum(row, ['prm_sell_amt'], /sell.*amt$/i, abs);

  /* 매수 − 매도로 순매수를 유도합니다.
     순매수 컬럼을 못 읽었을 때의 안전망입니다 — 실제로 이 TR 은 음수를
     '--364464' 처럼 부호를 두 번 붙여 보내서 예전에 전부 null 이 됐습니다.
     num() 을 고쳤지만, 형식이 또 바뀌면 여기서 값을 살립니다. */
  const derivedQty = buyQty !== null && sellQty !== null ? buyQty - sellQty : null;
  const derivedAmt = rawBuyAmt !== null && rawSellAmt !== null ? rawBuyAmt - rawSellAmt : null;

  const finalQty = netQty ?? derivedQty;
  const finalAmtRaw = rawAmount ?? derivedAmt;

  // 차익 / 비차익. ka90013 은 주지 않으므로 null 이고 화면에서 숨습니다.
  // 다른 TR 로 바꿨을 때를 대비해 남겨둡니다.
  const arb = pickNum(row, ['arbt_netprps_qty', 'arbt_netprps_amt'], /(^|_)arbt_/i, net);
  const nonArb = pickNum(
    row,
    ['nabt_netprps_qty', 'non_arbt_netprps_qty', 'nabt_netprps_amt'],
    /(nabt|non_?arbt)/i,
    net,
  );

  return {
    date: toDate(pickStr(row, ['dt', 'trde_dt', 'stk_dt'], /(^|_)dt$/i)),
    time: toHhmm(pickStr(row, ['cntr_tm', 'tm'], /(^|_)tm$/i)),
    netQty: finalQty,
    netAmount: finalAmtRaw === null ? null : finalAmtRaw * unit,
    netAmountRaw: finalAmtRaw,
    // 순매수 컬럼을 직접 읽었는지, 매수−매도로 유도했는지.
    // 'derived' 가 뜨면 파싱이 어긋났다는 신호입니다.
    netSource: netQty !== null ? 'field' : derivedQty !== null ? 'derived' : null,
    buyQty,
    sellQty,
    buyAmount: rawBuyAmt === null ? null : rawBuyAmt * unit,
    sellAmount: rawSellAmt === null ? null : rawSellAmt * unit,
    arbitrageNetQty: arb,
    nonArbitrageNetQty: nonArb,
    // 프로그램 매매가 그날 거래량에서 차지하는 비중을 계산할 수 있게 함께 냅니다.
    totalVolume: pickNum(row, ['trde_qty'], /^trde_qty$/i, abs),
    price: pickNum(row, ['cur_prc'], /cur_prc/i, abs),
    // 이 행이 어느 거래소 기준인지. KRX 만인지 통합인지에 따라 값이 다릅니다.
    exchange: pickStr(row, ['stex_tp'], /stex/i),
  };
}

/** 빈 응답과 '0' 을 구분합니다. 0 으로 채우면 사용자는 중립으로 읽습니다. */
function hasAnyValue(rows) {
  return rows.some((r) => r.netQty !== null || r.netAmount !== null);
}

/**
 * GET /api/program/005930
 * → { code, rows, asOf, pending, amountUnit }
 */
flowRouter.get('/program/:code', async (req, res, next) => {
  try {
    const code = normalizeCode(req.params.code);
    const unit = config.programAmountUnit;

    if (config.demo) {
      if (String(req.query.debug) === '1') {
        return res.json({ debug: true, demo: true, note: '데모 모드입니다. 원본 응답이 없습니다. DEMO=false 로 실제 시세에 붙여야 raw 를 볼 수 있습니다.' });
      }
      const demo = config.demoFlowEmpty
        ? { code, rows: [], asOf: null, pending: true }
        : demoProgram(code);
      return res.json({ ...demo, amountUnit: 1, demo: true });
    }

    /* 거래소 범위를 반드시 명시합니다. 빼면 같은 날짜인데 호출마다 다른
       숫자가 올 수 있습니다 (KRX 만 vs 통합). 실제로 07-29·08-04 의
       순매수 부호가 뒤집혀 나온 원인으로 의심되는 부분입니다. */
    const body = { stk_cd: code };
    if (config.programExchange) body.stex_tp = config.programExchange;

    if (String(req.query.debug) === '1') {
      const { data } = await callTr(TR.PROGRAM_STOCK, body);
      return res.json({
        requestBody: body,
        ...debugPayload(TR.PROGRAM_STOCK, data, unit, toProgramRow),
      });
    }

    const payload = await krGate.run(`prg:${code}:${config.programExchange || 'any'}`, KR_TTL.program, async () => {
      const { data } = await callTr(TR.PROGRAM_STOCK, body);
      const rows = firstArray(data)
        .map((r) => toProgramRow(r, unit))
        .filter((r) => r.date || r.time);

      rows.sort((a, b) => (String(a.date ?? a.time) < String(b.date ?? b.time) ? -1 : 1));

      const asOf = rows.at(-1)?.date ?? null;

      /* 값이 실제로 들어 있는 마지막 행.
         프로그램매매가 없던 날은 필드가 비어 오므로 rows 끝이 null 일 수
         있습니다. 그걸 그대로 대표값으로 쓰면 표에는 데이터가 있는데
         큰 숫자만 '—' 로 보입니다. */
      const valued = rows.filter((r) => r.netQty !== null || r.netAmount !== null);
      const lastValuedDate = valued.at(-1)?.date ?? null;

      return {
        code,
        rows,
        asOf,
        // 화면 헤드라인이 쓸 날짜. asOf 와 다르면 최근 며칠은 값이 없다는 뜻입니다.
        lastValuedDate,
        // 오늘 행은 있는데 값이 비어 있는 상태 (장중이거나 집계 전).
        todayPending: asOf === todayIso() && lastValuedDate !== todayIso(),
        /**
         * 미집계 판정.
         * 프로그램매매는 장 마감 후 정정되고 휴장일에는 전일 값이 남습니다.
         * '오늘 0' 과 '오늘 미집계' 를 구분하지 못하면 사용자가 중립으로
         * 오독합니다. 그래서 기준일자를 함께 내려보내고 화면에 표시합니다.
         */
        pending: rows.length === 0 || !hasAnyValue(rows) || (asOf !== null && asOf < todayIso()),
        // 화면이 '금액 단위: 백만원 가정' 을 표시할 수 있게 그대로 내려줍니다.
        amountUnit: unit,
        // 요청한 범위와 실제로 온 범위. 다르면 숫자의 기준이 다릅니다.
        exchangeRequested: config.programExchange || null,
        exchange: rows.at(-1)?.exchange ?? null,
        raw: process.env.NODE_ENV === 'development' ? data : undefined,
      };
    });

    res.json(payload);
  } catch (err) { next(err); }
});

/**
 * GET /api/program-market?market=001
 * market: 001 코스피 / 101 코스닥
 *
 * 선택 종목과 무관한 시장 단위 데이터입니다. 지금 화면은 선택 종목 중심이라
 * 자리가 없어서 라우트만 먼저 열어 둡니다 (README 참고).
 */
flowRouter.get('/program-market', async (req, res, next) => {
  try {
    const market = String(req.query.market ?? '001');
    const unit = config.programAmountUnit;

    if (config.demo) {
      return res.json({ ...demoProgramMarket(market), amountUnit: 1, demo: true });
    }

    if (String(req.query.debug) === '1') {
      const { data } = await callTr(TR.PROGRAM_MARKET, { mrkt_tp: market, stex_tp: '3' });
      return res.json(debugPayload(TR.PROGRAM_MARKET, data, unit, toProgramRow));
    }

    const payload = await krGate.run(`prgm:${market}`, KR_TTL.programMarket, async () => {
      const { data } = await callTr(TR.PROGRAM_MARKET, { mrkt_tp: market, stex_tp: '3' });
      const rows = firstArray(data)
        .map((r) => toProgramRow(r, unit))
        .filter((r) => r.time || r.date);

      return {
        market,
        rows,
        asOf: rows.at(-1)?.date ?? todayIso(),
        pending: rows.length === 0 || !hasAnyValue(rows),
        amountUnit: unit,
        raw: process.env.NODE_ENV === 'development' ? data : undefined,
      };
    });

    res.json(payload);
  } catch (err) { next(err); }
});

/** GET /api/flow/stats — 캐시가 실제로 호출을 막고 있는지 확인용 */
flowRouter.get('/flow/stats', (_req, res) => {
  const flowTr = ['STRENGTH_TIME', 'STRENGTH_DAY', 'PROGRAM_STOCK', 'PROGRAM_MARKET'];
  const row = (name) => ({
    name,
    apiId: TR[name].apiId,
    path: TR[name].path,
    // '.env 로 지정' 인지 '코드 기본값' 인지를 구분해 보여줍니다.
    // 기본값은 문서와 대조되지 않은 추측값입니다.
    source: TR[name].unverified ? 'default(미검증)' : 'env',
  });

  res.json({
    demo: config.demo,
    // 데모 모드면 아래 api-id 는 전혀 쓰이지 않습니다.
    // 이걸 안 보여주면 값을 맞췄는지 아닌지 판단할 수 없습니다.
    trInUse: config.demo ? false : true,
    tr: flowTr.map(row),
    unverifiedCount: flowTr.filter((n) => TR[n].unverified).length,
    fid: {
      strength: FID_OVERRIDE.strength,
      source: FID_OVERRIDE.strengthVerified ? 'env' : 'default(미검증)',
    },
    amountUnit: config.programAmountUnit,
    gate: krGate.stats(),
  });
});

export { num };
