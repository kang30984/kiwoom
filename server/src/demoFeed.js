/**
 * 데모 모드용 가짜 시세 생성기.
 * 키움 앱키 없이도 화면 동작을 확인하기 위한 것으로, 실제 시세와 무관합니다.
 * .env 의 DEMO=false 로 바꾸면 이 파일은 전혀 쓰이지 않습니다.
 */

import { tickSize, snapTick, priceLimits } from './krx.js';

const UNIVERSE = [
  { code: '005930', name: '삼성전자',      base: 74_300 },
  { code: '000660', name: 'SK하이닉스',    base: 231_500 },
  { code: '035720', name: '카카오',        base: 41_150 },
  { code: '035420', name: 'NAVER',         base: 186_000 },
  { code: '005380', name: '현대차',        base: 248_000 },
  { code: '051910', name: 'LG화학',        base: 312_500 },
  { code: '207940', name: '삼성바이오로직스', base: 1_042_000 },
  { code: '068270', name: '셀트리온',      base: 172_800 },
  { code: '105560', name: 'KB금융',        base: 86_400 },
  { code: '005490', name: 'POSCO홀딩스',   base: 267_000 },
];

const snap = (price) => snapTick(price, 'nearest');

/** code → 진행 상태 */
const state = new Map();

function seedOf(code) {
  // 알 수 없는 코드도 요청할 수 있으므로 코드에서 기준가를 유도합니다.
  const known = UNIVERSE.find((s) => s.code === code);
  if (known) return known;
  const digits = [...code].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return { code, name: `데모종목 ${code}`, base: snap(10_000 + (digits % 90) * 1_000) };
}

function stateOf(code) {
  if (!state.has(code)) {
    const seed = seedOf(code);
    const prevClose = seed.base;
    // 시작 등락률을 -3% ~ +3% 사이에서 랜덤 부여
    const price = snap(prevClose * (1 + (Math.random() - 0.5) * 0.06));
    const volume = Math.floor(200_000 + Math.random() * 9_000_000);
    // 체결강도는 '매수체결 누계 ÷ 매도체결 누계' 입니다. 매 스텝 랜덤값을
    // 뽑으면 실제와 성질이 달라져 UI 검증에 쓸 수 없습니다 — 실제 값은
    // 장 초반 분모가 작아 크게 튀고, 누계가 쌓이면서 안정됩니다.
    // 그 성질을 재현해야 극단값 처리를 테스트할 수 있습니다.
    const seedLots = 8 + Math.floor(Math.random() * 12); // 장 초반: 체결 수십 건
    const lot = Math.max(1, Math.floor(volume / 4_000));
    state.set(code, {
      ...seed,
      prevClose,
      price,
      open: snap(prevClose * (1 + (Math.random() - 0.5) * 0.02)),
      high: price,
      low: price,
      volume,
      lot,
      // 좌우를 비대칭으로 흔들어 둡니다. 정확히 100.00 으로 시작하면
      // 값이 아직 안 붙은 것처럼 보입니다.
      buyVol: Math.round(lot * seedLots * (0.4 + Math.random() * 0.25)),
      sellVol: Math.round(lot * seedLots * (0.4 + Math.random() * 0.25)),
      steps: 0,
      startedAt: Date.now(),
    });
  }
  return state.get(code);
}

/**
 * 한 스텝 랜덤워크.
 * 두 가지 제약이 있습니다.
 *  1) 일일 가격제한폭 ±30% 를 넘지 못합니다 (실제 KRX 규칙).
 *  2) 전일종가에서 멀어질수록 되돌아오는 힘이 붙습니다.
 * 이게 없으면 장시간 실행 시 가격이 무한히 발산해
 * 등락률 +50% 같은 불가능한 값이 나옵니다.
 */
function step(s) {
  const unit = tickSize(s.price);
  const { upper, lower } = priceLimits(s.prevClose);

  const deviation = (s.price - s.prevClose) / s.prevClose;
  const pull = -deviation * 40;              // 되돌림
  const noise = (Math.random() - 0.5) * 2;   // -1 ~ +1

  const next = snap(s.price + unit * (noise + pull));
  s.price = Math.min(upper, Math.max(lower, next));

  s.high = Math.max(s.high, s.price);
  s.low = Math.min(s.low, s.price);

  // 체결을 매수/매도로 갈라 누적합니다. 부호는 이번 스텝의 가격 방향을
  // 따릅니다 — 그래야 체결강도와 가격이 완전히 무상관이 되지 않습니다.
  const traded = Math.floor(Math.random() * 4_000);
  const buyShare = noise > 0 ? 0.5 + Math.random() * 0.35 : 0.15 + Math.random() * 0.35;
  const buys = Math.floor(traded * buyShare);
  s.buyVol += buys;
  s.sellVol += traded - buys;
  s.volume += traded;
  s.steps += 1;
  return s;
}

/**
 * 체결강도 = 매수체결 누계 ÷ 매도체결 누계 × 100.
 * 분모가 0이면 값이 존재하지 않습니다 (null → 화면에 '—').
 */
function strengthOf(s) {
  if (!s.sellVol) return null;
  return Number(((s.buyVol / s.sellVol) * 100).toFixed(2));
}

function toQuote(s) {
  const change = s.price - s.prevClose;
  return {
    code: s.code,
    name: s.name,
    price: s.price,
    change,
    changeRate: Number(((change / s.prevClose) * 100).toFixed(2)),
    volume: s.volume,
    open: s.open,
    high: s.high,
    low: s.low,
    upperLimit: snap(s.prevClose * 1.3),
    lowerLimit: snap(s.prevClose * 0.7),
    marketCap: null,
    per: null,
    // startDemoFeed 가 toQuote 를 그대로 펼쳐 보내므로, 여기에 넣으면
    // 실시간 trade 이벤트에도 자동으로 실립니다.
    strength: strengthOf(s),
  };
}

/** 데모 모드에서 종목 마스터 대용으로 씁니다. */
export function demoUniverse() {
  return UNIVERSE.map(({ code, name }) => ({ code, name }));
}

export function demoQuote(code) {
  return toQuote(stateOf(code));
}

export function demoOrderbook(code) {
  const s = stateOf(code);
  const unit = tickSize(s.price);
  const ask = [];
  const bid = [];
  for (let i = 0; i < 10; i += 1) {
    ask.push({ level: i + 1, price: s.price + unit * (i + 1), qty: Math.floor(300 + Math.random() * 24_000) });
    bid.push({ level: i + 1, price: Math.max(unit, s.price - unit * i), qty: Math.floor(300 + Math.random() * 24_000) });
  }
  return { code, ask, bid };
}

export function demoCandles(code, type, countOverride) {
  const s = stateOf(code);
  // 호출자가 기간을 지정하면 그 개수를 씁니다 (첫 화면은 일봉 3년).
  const count = Number(countOverride) > 0
    ? Math.min(Number(countOverride), 3_000)
    : ({ minute: 200, week: 156, month: 72 }[type] ?? 760);
  const candles = [];
  const cursor = new Date();

  // 일봉은 주말을 건너뛰므로(주 5거래일) 달력일 기준으로는 7/5 배를 훑어야
  // 목표 개수가 나옵니다. 이걸 빼먹으면 3년을 요청해도 2년치만 나옵니다.
  const iterations = type === 'day' ? Math.ceil((count * 7) / 5) : count;

  // 기간이 길수록 한 봉의 변동폭도 커집니다.
  const shockScale = { minute: 0.004, day: 0.022, week: 0.055, month: 0.11 }[type] ?? 0.022;
  const wickScale = { minute: 0.006, day: 0.006, week: 0.018, month: 0.04 }[type] ?? 0.006;

  let close = s.base;

  for (let i = iterations; i > 0; i -= 1) {
    const at = new Date(cursor);
    if (type === 'minute') {
      at.setMinutes(at.getMinutes() - i);
    } else if (type === 'week') {
      at.setDate(at.getDate() - i * 7);
      // 주봉은 그 주 월요일에 맞춥니다
      const shift = (at.getDay() + 6) % 7;
      at.setDate(at.getDate() - shift);
    } else if (type === 'month') {
      // 월봉은 각 달 1일에 맞춥니다
      at.setDate(1);
      at.setMonth(at.getMonth() - i);
    } else {
      at.setDate(at.getDate() - i);
      if (at.getDay() === 0 || at.getDay() === 6) continue; // 주말 제외
    }

    const open = close;
    const deviation = (close - s.base) / s.base;
    const revert = -deviation * 0.12;
    const shock = (Math.random() - 0.5) * shockScale;
    close = Math.max(tickSize(open), snap(open * (1 + revert + shock)));

    const wick = Math.max(open, close) * (0.002 + Math.random() * wickScale);
    const high = snap(Math.max(open, close) + wick);
    const low = Math.max(tickSize(open), snap(Math.min(open, close) - wick));

    const pad = (n) => String(n).padStart(2, '0');
    const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

    candles.push({
      time: type === 'minute' ? `${date}T${pad(at.getHours())}:${pad(at.getMinutes())}:00` : date,
      open: snap(open),
      high,
      low,
      close,
      volume: Math.floor(({ week: 300_000, month: 1_200_000 }[type] ?? 50_000) + Math.random() * 900_000),
    });
  }

  return candles;
}

/* ── 체결강도 ─────────────────────────────────────────────── */

const pad2 = (n) => String(n).padStart(2, '0');

export function demoStrength(code) {
  const s = stateOf(code);
  return {
    code,
    strength: strengthOf(s),
    buyVolume: s.buyVol,
    sellVolume: s.sellVol,
    // 누계 체결 건수가 적으면 분모가 작아 값이 크게 튑니다.
    // UI 가 이 플래그를 보고 '표본 부족' 을 알립니다.
    thin: s.buyVol + s.sellVol < s.lot * 40,
  };
}

/**
 * 시간별 체결강도 추이.
 * 09:00 부터 현재까지 10분 간격. 장 초반은 크게 튀고 점차 100 근처로 수렴합니다.
 */
export function demoStrengthTrend(code, slots = 40) {
  const s = stateOf(code);
  const rows = [];
  let buy = s.lot * 5;
  let sell = s.lot * 5;

  for (let i = 0; i < slots; i += 1) {
    const minutes = i * 10;
    const hh = 9 + Math.floor(minutes / 60);
    const mm = minutes % 60;
    if (hh > 15 || (hh === 15 && mm > 30)) break;

    const traded = s.lot * (6 + Math.floor(Math.random() * 10));
    const share = 0.35 + Math.random() * 0.3;
    buy += Math.floor(traded * share);
    sell += traded - Math.floor(traded * share);

    rows.push({
      time: `${pad2(hh)}:${pad2(mm)}`,
      strength: Number(((buy / sell) * 100).toFixed(2)),
      volume: buy + sell,
    });
  }
  return rows;
}

/* ── 프로그램 매매 ────────────────────────────────────────── */

const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/**
 * 종목별 프로그램 순매수 (일자별).
 *
 * 실제 데이터의 두 가지 성질을 재현합니다.
 *   1) 부호가 의미의 전부입니다 — 순매수와 순매도가 섞여 나옵니다
 *   2) 오늘 자료는 미집계일 수 있습니다 (장중·휴장일)
 * DEMO_FLOW_EMPTY=true 로 켜면 2번 상태를 강제해 빈 응답 처리를 볼 수 있습니다.
 */
export function demoProgram(code, days = 10) {
  const s = stateOf(code);
  const rows = [];
  const cursor = new Date();

  for (let i = 0; i < days * 2 && rows.length < days; i += 1) {
    const at = new Date(cursor);
    at.setDate(at.getDate() - i);
    if (at.getDay() === 0 || at.getDay() === 6) continue;

    // 순매수 수량은 당일 거래량의 -8% ~ +8% 수준
    const netQty = Math.round(s.volume * (Math.random() - 0.5) * 0.16);
    /* 실제 TR(ka90013)이 주는 모양에 맞춥니다 — 매수·매도를 따로 주고
       순매수가 그 차이입니다. 데모가 응답 모양을 흉내내지 않으면
       화면을 데모로 검증한 의미가 없어집니다. */
    const halfTurnover = Math.round(s.volume * (0.18 + Math.random() * 0.12));
    const buyQty = halfTurnover + Math.max(0, netQty);
    const sellQty = halfTurnover + Math.max(0, -netQty);

    rows.push({
      date: ymd(at),
      netQty,
      netAmount: netQty * s.price,
      netAmountRaw: netQty * s.price,
      netSource: 'field',
      buyQty,
      sellQty,
      buyAmount: buyQty * s.price,
      sellAmount: sellQty * s.price,
      // ka90013 은 차익/비차익을 주지 않습니다. 데모도 null 로 두어
      // 화면에서 그 줄이 숨는 것을 확인할 수 있게 합니다.
      arbitrageNetQty: null,
      nonArbitrageNetQty: null,
      totalVolume: s.volume,
      price: s.price,
    });
  }

  rows.reverse(); // 과거 → 최신

  // 오늘분 미집계 재현
  const today = ymd(new Date());
  const hasToday = rows.some((r) => r.date === today);
  return {
    code,
    rows,
    asOf: rows.at(-1)?.date ?? null,
    lastValuedDate: rows.filter((r) => r.netQty !== null).at(-1)?.date ?? null,
    todayPending: false,
    // '0' 과 '미집계' 는 완전히 다릅니다. 0 으로 채우면 사용자는 중립으로 읽습니다.
    pending: !hasToday,
  };
}

/** 시장 전체(코스피/코스닥) 프로그램 순매수 시간별. */
export function demoProgramMarket(market = '001', slots = 40) {
  const rows = [];
  const base = market === '101' ? 4_000 : 20_000; // 코스닥은 규모가 작습니다
  let cum = 0;

  for (let i = 0; i < slots; i += 1) {
    const minutes = i * 10;
    const hh = 9 + Math.floor(minutes / 60);
    const mm = minutes % 60;
    if (hh > 15 || (hh === 15 && mm > 30)) break;

    cum += Math.round((Math.random() - 0.48) * base * 1_000_000);
    rows.push({ time: `${pad2(hh)}:${pad2(mm)}`, netAmount: cum });
  }
  return { market, rows, asOf: ymd(new Date()), pending: rows.length === 0 };
}

export function demoRank(kind) {
  const rows = UNIVERSE.map((seed) => toQuote(stateOf(seed.code)));
  rows.sort((a, b) => (kind === 'change' ? b.changeRate - a.changeRate : b.volume - a.volume));
  return rows.map((row, i) => ({
    rank: i + 1,
    code: row.code,
    name: row.name,
    price: row.price,
    change: row.change,
    changeRate: row.changeRate,
    volume: row.volume,
  }));
}

/**
 * 구독 중인 종목에 대해 체결/호가 이벤트를 주기적으로 흘려보냅니다.
 * @param {(event:object)=>void} emit
 * @param {()=>string[]} activeCodes 현재 구독 중인 종목코드
 * @returns {()=>void} 정지 함수
 */
export function startDemoFeed(emit, activeCodes) {
  const trade = setInterval(() => {
    for (const code of activeCodes()) {
      const s = step(stateOf(code));
      emit({ type: 'trade', ...toQuote(s), time: null });
    }
  }, 800);

  const book = setInterval(() => {
    for (const code of activeCodes()) {
      emit({ type: 'orderbook', ...demoOrderbook(code) });
    }
  }, 1_200);

  console.log('[demo] 가짜 시세 피드 시작 (실제 시세가 아닙니다)');
  return () => { clearInterval(trade); clearInterval(book); };
}
