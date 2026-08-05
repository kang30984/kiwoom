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
    state.set(code, {
      ...seed,
      prevClose,
      price,
      open: snap(prevClose * (1 + (Math.random() - 0.5) * 0.02)),
      high: price,
      low: price,
      volume: Math.floor(200_000 + Math.random() * 9_000_000),
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
  s.volume += Math.floor(Math.random() * 4_000);
  return s;
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
