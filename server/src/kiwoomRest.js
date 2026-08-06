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
  let s = String(v).replace(/,/g, '').trim();
  if (s === '') return null;

  /**
   * **부호가 두 번 붙는 경우가 있습니다.**
   * 키움이 등락 방향 부호 문자를 앞에 덧붙이는데, 값 자체가 이미 음수면
   * 이렇게 옵니다 (ka90013 종목일별 프로그램매매에서 실제 확인).
   *
   *   prm_buy_qty     5469274
   *   prm_sell_qty    5833738
   *   prm_netprps_qty "--364464"   ← '-' + '-364464' = -364,464
   *
   * 예전에는 Number('--364464') 가 NaN 이라 null 을 돌려줬습니다.
   * 프로그램 순매수에서 이게 치명적이었습니다 — **순매도인 날이 통째로
   * 사라져서** 20거래일이 전부 순매수인 것처럼 보였습니다.
   *
   * 부호 뭉치에 '-' 가 하나라도 있으면 음수로 봅니다.
   * 홀짝으로 세면 안 됩니다 ('--364464' 는 마이너스 두 개지만 음수입니다).
   */
  let negative = false;
  const m = /^([+-]+)(.*)$/.exec(s);
  if (m) {
    negative = m[1].includes('-');
    s = m[2];
  }
  if (s === '') return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;

  const signed = negative ? -Math.abs(n) : n;
  // -0 을 0 으로 정규화합니다. Object.is(-0, 0) 이 false 라 비교가 어긋납니다.
  return signed === 0 ? 0 : signed;
}

/** 호가 잔량 등은 부호 없는 절대값이 필요할 때가 있습니다. */
export function abs(v) {
  const n = num(v);
  return n === null ? null : Math.abs(n);
}

/**
 * 순매수처럼 **부호가 의미의 전부인** 필드.
 *
 * 동작은 num() 과 같습니다. 이름을 따로 둔 이유는 실수를 막기 위해서입니다 —
 * 이 저장소는 가격·잔량에 Math.abs(num(...)) 패턴을 광범위하게 쓰는데,
 * 그걸 습관적으로 복사하면 순매도 -1,200억이 +1,200억으로 표시됩니다.
 * 화면에 그럴듯한 숫자가 나오므로 조용히 통과하는 종류의 버그입니다.
 * 순매수·순매도 계열에는 abs() 를 절대 쓰지 마세요.
 */
export const net = (v) => num(v);

/**
 * 후보 키를 순서대로 시도하고, 없으면 정규식으로 훑습니다.
 *
 * firstArray() 와 같은 이유로 필요합니다 — 프로그램매매·체결강도 TR 의
 * 필드명을 문서 없이 확정할 수 없고, 개정으로 바뀌기도 합니다.
 * 하나라도 맞으면 화면이 뜨고, 다 틀리면 null 이라 '미집계'로 표시됩니다.
 *
 * @param {object} row
 * @param {string[]} keys      우선 시도할 정확한 키 이름
 * @param {RegExp} [pattern]   못 찾았을 때 키 이름을 훑을 정규식
 * @param {(v:any)=>number|null} [parse] 기본 net (부호 유지)
 */
export function pickNum(row, keys, pattern, parse = net) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row[key] !== '') {
      const v = parse(row[key]);
      if (v !== null) return v;
    }
  }
  if (pattern) {
    for (const [key, raw] of Object.entries(row ?? {})) {
      if (!pattern.test(key)) continue;
      const v = parse(raw);
      if (v !== null) return v;
    }
  }
  return null;
}

/** 문자열 필드용 pickNum. 시간·일자 키가 TR 마다 다릅니다. */
export function pickStr(row, keys, pattern) {
  for (const key of keys) {
    const v = row?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  if (pattern) {
    for (const [key, raw] of Object.entries(row ?? {})) {
      if (pattern.test(key) && String(raw ?? '').trim() !== '') return String(raw).trim();
    }
  }
  return null;
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
