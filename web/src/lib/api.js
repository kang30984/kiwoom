/** 호출 한도 큐 때문에 오래 걸릴 수 있지만, 무한정 기다리지는 않습니다. */
const TIMEOUT_MS = 25_000;

async function get(path, { timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(path, { signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error ?? `요청 실패 (${res.status})`);
      err.status = res.status;   // 429 는 호출 한도
      throw err;
    }
    return body;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('응답이 너무 늦습니다. 호출 한도 대기 중이거나 없는 종목일 수 있습니다.');
      e.status = 408;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 시장에 따라 국내(/api/...) 또는 미국(/api/us/...) 엔드포인트를 씁니다. */
const base = (market) => (market === 'US' ? '/api/us' : '/api');

export const api = {
  quote: (code, market) => get(`${base(market)}/quote/${code}`),
  /** 추가 전 확인용. 사용자가 버튼 앞에서 기다리므로 짧게 끊습니다. */
  verify: (code, market) => get(`${base(market)}/quote/${code}`, { timeout: 10_000 }),
  orderbook: (code) => get(`/api/orderbook/${code}`),   // 국내만
  chart: (code, type, tick, market) =>
    get(`${base(market)}/chart/${code}?type=${type}${type === 'minute' ? `&tick=${tick}` : ''}`),
  rank: (kind) => get(`/api/rank/${kind}`),             // 국내만
  /* 체결강도·프로그램매매는 키움 국내 TR 만 있습니다 (markets.js 의 hasFlow).
     폴링으로 부르므로 짧게 끊습니다 — 실패하면 다음 주기에 다시 시도합니다. */
  strength: (code, period = 'time') =>
    get(`/api/strength/${code}?period=${period}`, { timeout: 12_000 }),
  program: (code) => get(`/api/program/${code}`, { timeout: 12_000 }),
  programMarket: (market = '001') =>
    get(`/api/program-market?market=${market}`, { timeout: 12_000 }),
  search: (q, market) => get(`${base(market)}/search?q=${encodeURIComponent(q)}`),
  plan: (code, params, market) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== '' && v !== null && v !== undefined) q.set(k, String(v));
    }
    return get(`${base(market)}/plan/${code}?${q}`);
  },
  health: () => get('/api/health'),
  usProvider: () => get('/api/us/provider'),
};

/**
 * 종목코드 정규화. 서버의 normalizeCode 와 같은 규칙입니다.
 * 키움은 거래소 구분 접미사를 붙여 줍니다 (233740_AL, 005930_NX).
 * 이미 저장된 잘못된 코드를 씻어내는 데도 씁니다.
 */
export function normalizeCode(raw) {
  let s = String(raw ?? '').trim().toUpperCase();
  s = s.split('_')[0].replace(/[^0-9A-Z]/g, '');
  if (s.length > 6) {
    const m = /^([0-9A-Z]{6})(AL|NX|KR)$/.exec(s);
    s = m ? m[1] : s.slice(0, 6);
  }
  return s;
}

/* ── 표시 헬퍼 ──────────────────────────────────────── */

export const fmt = (n) => (n === null || n === undefined ? '—' : n.toLocaleString('ko-KR'));

export const fmtSigned = (n) =>
  n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('ko-KR')}`;

export const fmtRate = (n) =>
  n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;

/** 거래량은 만/억 단위로 줄여서 읽기 쉽게 */
export const fmtVolume = (n) => {
  if (n === null || n === undefined) return '—';
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}억`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;
  return n.toLocaleString('ko-KR');
};

/**
 * 등락 방향 → 클래스명.
 * 실제 색은 CSS 에서 시장별로 바뀝니다 (국내 상승 빨강 / 미국 상승 초록).
 */
export const dirClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');

/* ── 시장별 숫자 표시 ───────────────────────────────── */

const usd = (n, digits = 2) => n.toLocaleString('en-US', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});

/** 가격. 원화는 정수, 달러는 소수 둘째 자리. */
export const fmtPrice = (n, market) => {
  if (n === null || n === undefined) return '—';
  return market === 'US' ? usd(n) : n.toLocaleString('ko-KR');
};

export const fmtPriceSigned = (n, market) => {
  if (n === null || n === undefined) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${market === 'US' ? usd(Math.abs(n)) : Math.abs(n).toLocaleString('ko-KR')}`;
};

/** 금액(통화기호 포함) */
export const fmtMoney = (n, market) => {
  if (n === null || n === undefined) return '—';
  return market === 'US'
    ? `$${usd(n)}`
    : `${Math.round(n).toLocaleString('ko-KR')}원`;
};

/**
 * 큰 수를 읽기 쉬운 단위로 줄입니다.
 * 9,999,999,999,904,000 처럼 자릿수를 세야 하는 숫자를 그대로 보여주면
 * 화면에서 아무 의미도 전달되지 않습니다.
 */
const KR_UNITS = [[1e16, '경'], [1e12, '조'], [1e8, '억'], [1e4, '만']];
const US_UNITS = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];

export function fmtShort(n, market) {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  const locale = market === 'US' ? 'en-US' : 'ko-KR';

  for (const [size, label] of market === 'US' ? US_UNITS : KR_UNITS) {
    if (abs >= size) {
      const v = n / size;
      // 100 미만이면 소수 한 자리까지 (8.3억), 그 이상은 정수 (3,874조)
      const digits = Math.abs(v) < 100 ? 1 : 0;
      return `${Number(v.toFixed(digits)).toLocaleString(locale)}${label}`;
    }
  }
  return market === 'US' ? usd(n) : Math.round(n).toLocaleString('ko-KR');
}

/** 금액을 줄여서. 가격이 아니라 '합계 금액' 에만 씁니다. */
export const fmtMoneyShort = (n, market) => {
  if (n === null || n === undefined) return '—';
  return market === 'US' ? `$${fmtShort(n, market)}` : `${fmtShort(n, market)}원`;
};

/** 정확한 값. 줄인 표시 옆에 title 로 붙여 정밀도를 잃지 않게 합니다. */
export const fmtExact = (n, market) => {
  if (n === null || n === undefined) return '';
  return market === 'US'
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${Math.round(n).toLocaleString('ko-KR')}원`;
};

/** 수량. 만 단위를 넘으면 줄이고, 그 아래는 천 단위 구분만. */
export const fmtQty = (n, market) => {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1e4) return fmtShort(n, market);
  return n.toLocaleString(market === 'US' ? 'en-US' : 'ko-KR');
};

/**
 * 주식 수. 자릿수 구분이 없으면 43290043 처럼 읽을 수 없습니다.
 * 수량은 실제 주문에 쓰는 값이라 반올림하지 않고 정확히 보여줍니다.
 */
export const fmtShares = (n) => (n === null || n === undefined
  ? '—'
  : `${Math.round(n).toLocaleString('ko-KR')}주`);

/** 입력창용 — 숫자에 자릿수 구분을 넣습니다 */
export const groupDigits = (raw) => {
  const digits = String(raw ?? '').replace(/[^0-9.]/g, '');
  if (!digits) return '';
  const [int, ...rest] = digits.split('.');
  const grouped = int ? Number(int).toLocaleString('ko-KR') : '';
  return rest.length > 0 ? `${grouped}.${rest.join('')}` : grouped;
};

/** 자릿수 구분을 제거해 숫자로 */
export const ungroup = (text) => String(text ?? '').replace(/[^0-9.]/g, '');

/** 거래량. 국내는 만/억, 미국은 K/M/B. */
export const fmtVol = (n, market) => {
  if (n === null || n === undefined) return '—';
  if (market !== 'US') return fmtVolume(n);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString('en-US')}K`;
  return n.toLocaleString('en-US');
};

/* ── 수급(체결강도 · 프로그램매매) 표시 ─────────────────── */

/**
 * 체결강도.
 *
 * 색을 쓰지 않습니다. 이 화면의 규칙은 "색은 등락 방향에만" 이고,
 * 체결강도를 빨강/파랑으로 칠하면 그 규칙이 깨지는 동시에
 * 방향 신호가 됩니다 — 체결강도 120% 가 상승을 의미한다는 근거는 없습니다.
 * 누적 비율이라 후행하는 지표입니다.
 */
export const fmtStrength = (n) =>
  (n === null || n === undefined ? '—' : `${n.toFixed(n < 1000 ? 1 : 0)}%`);

/**
 * 순매수 수량·금액.
 *
 * 부호가 의미의 전부라 반드시 살립니다. 방향을 색이 아니라
 * '순매수' / '순매도' 라는 말로 표시합니다.
 */
export const netLabel = (n) => {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '보합';
  return n > 0 ? '순매수' : '순매도';
};

/** 순매수 금액 — 부호 유지 + 만/억 축약 */
export const fmtNetMoney = (n) => {
  if (n === null || n === undefined) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${fmtShort(Math.abs(n), 'KR')}원`;
};

/** 순매수 수량 — 부호 유지 + 만/억 축약 */
export const fmtNetQty = (n) => {
  if (n === null || n === undefined) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${fmtVolume(Math.abs(n))}주`;
};

/**
 * 방향이 없는 수량 (매수량·매도량·거래량).
 *
 * fmtNetQty 를 쓰면 '+547만주' 처럼 부호가 붙습니다. 순매수는 부호가
 * 의미의 전부지만, 매수·매도 각각은 항상 양수라서 부호를 붙이면
 * 순매수와 같은 종류의 값으로 오해합니다.
 */
export const fmtAbsQty = (n) => (n === null || n === undefined
  ? '—'
  : `${fmtVolume(Math.abs(n))}주`);

export const exactAbsQty = (n) => (n === null || n === undefined
  ? ''
  : `${Math.abs(Math.round(n)).toLocaleString('ko-KR')}주`);

/**
 * 축약 표시 옆에 붙일 정확한 값.
 *
 * fmtNetQty 는 45,454 를 '5만주' 로 줄입니다 — 10% 오차입니다.
 * 이 저장소의 규칙("줄인 표시에 마우스를 올리면 정확한 값이 title 로")을
 * 수급 숫자에도 적용합니다. 수급은 규모를 비교하는 값이라 축약이 맞지만,
 * 정확한 값을 잃으면 안 됩니다.
 */
export const exactNetQty = (n) => (n === null || n === undefined
  ? ''
  : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('ko-KR')}주`);

export const exactNetMoney = (n) => (n === null || n === undefined
  ? ''
  : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('ko-KR')}원`);

/** amountUnit(원) → 사람이 읽는 이름. 화면에 가정한 단위를 밝히는 용도입니다. */
export const unitLabel = (unit) => (
  { 1: '원', 1000: '천원', 1000000: '백만원' }[unit] ?? `${unit.toLocaleString('ko-KR')}원`
);
