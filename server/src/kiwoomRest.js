import { config } from './config.js';
import { getToken, invalidateToken } from './kiwoomAuth.js';

/* ── 호출 간격 제한 (키움 초당 호출 한도 회피) ───────────────── */
let queue = Promise.resolve();
let lastAt = 0;

function throttle() {
  queue = queue.then(async () => {
    const wait = config.minRequestGapMs - (Date.now() - lastAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  });
  return queue;
}

/**
 * TR 호출. 401이면 토큰을 버리고 한 번 재시도합니다.
 * @param {{path:string, apiId:string}} tr
 * @param {object} body
 * @param {{contYn?:string, nextKey?:string}} paging
 */
export async function callTr(tr, body = {}, paging = {}, _retried = false) {
  await throttle();
  const token = await getToken();

  const res = await fetch(`${config.restBase}${tr.path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      authorization: `Bearer ${token}`,
      'api-id': tr.apiId,
      'cont-yn': paging.contYn ?? 'N',
      'next-key': paging.nextKey ?? '',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401 && !_retried) {
    invalidateToken();
    return callTr(tr, body, paging, true);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.return_msg ?? `키움 API 오류 (${res.status})`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  // return_code가 0이 아니면 키움 레벨 실패
  if (data.return_code !== undefined && Number(data.return_code) !== 0) {
    const err = new Error(data.return_msg ?? '키움 API가 실패를 반환했습니다.');
    err.status = 400;
    err.payload = data;
    throw err;
  }

  return {
    data,
    contYn: res.headers.get('cont-yn') ?? 'N',
    nextKey: res.headers.get('next-key') ?? '',
  };
}

/* ── 응답 파싱 헬퍼 ─────────────────────────────────────────── */

/**
 * 종목코드 정규화.
 * 키움은 거래소 구분 접미사를 붙여 줍니다 — 233740_AL, 005930_NX, 005930_KR.
 * (AL 통합 / NX 넥스트레이드 / KR 한국거래소)
 * 이걸 그대로 쓰면 시세 조회가 빈 값을 돌려줍니다. 국내 종목코드는 6자리입니다.
 */
export function normalizeCode(raw) {
  let s = String(raw ?? '').trim().toUpperCase();
  s = s.split('_')[0];                    // 233740_AL -> 233740
  s = s.replace(/[^0-9A-Z]/g, '');
  if (s.length > 6) {
    // 밑줄 없이 붙는 경우: 233740AL -> 233740
    const m = /^([0-9A-Z]{6})(AL|NX|KR)$/.exec(s);
    s = m ? m[1] : s.slice(0, 6);
  }
  return s;
}

/**
 * 키움 숫자 필드는 "+1,200" / "-500" / "74300" 처럼 부호와 콤마가 섞여 옵니다.
 */
export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const cleaned = String(v).replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** 호가 잔량 등은 부호 없는 절대값이 필요할 때가 있습니다. */
export function abs(v) {
  const n = num(v);
  return n === null ? null : Math.abs(n);
}

/**
 * TR마다 배열이 담긴 키 이름이 다릅니다(stk_dt_pole_chart_qry 등).
 * 응답에서 첫 번째 배열 값을 찾아 반환합니다 — 문서상 키 이름이 바뀌어도 동작합니다.
 */
export function firstArray(data) {
  for (const value of Object.values(data ?? {})) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

/**
 * 호가 응답에서 매도/매수 10단계를 추출합니다.
 * sel_3th_pre_bid(가격) / sel_3th_pre_req(잔량) 형태의 키를 정규식으로 훑습니다.
 * 필드명이 다르면 이 정규식만 조정하세요.
 */
export function parseOrderbook(data) {
  const ask = new Map(); // 매도
  const bid = new Map(); // 매수

  for (const [key, raw] of Object.entries(data ?? {})) {
    const m = /^(sel|buy)_(\d+)(?:th)?_.*?(bid|req)/.exec(key);
    if (!m) continue;
    const [, side, levelStr, kind] = m;
    const level = Number(levelStr);
    const target = side === 'sel' ? ask : bid;
    const row = target.get(level) ?? { level, price: null, qty: null };
    if (kind === 'bid') row.price = abs(raw);
    else row.qty = abs(raw);
    target.set(level, row);
  }

  const sort = (map) => [...map.values()]
    .filter((r) => r.price)
    .sort((a, b) => a.level - b.level);

  return { ask: sort(ask), bid: sort(bid) };
}
