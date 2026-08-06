import { tickSize as krTickSize, snapTick as krSnapTick, priceLimits as krPriceLimits, DEFAULT_COSTS } from './krx.js';

/**
 * 시장별 규칙. 호가단위·가격제한폭·통화·거래비용이 시장마다 다릅니다.
 * 새 시장을 붙일 때는 이 모양만 맞추면 analysis.js 가 그대로 동작합니다.
 */

const krMoney = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const krPrice = (n) => Math.round(n).toLocaleString('ko-KR');

const usMoney = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usPrice = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const KR = {
  id: 'KR',
  label: '국내',
  currency: 'KRW',
  /** 경고 문구 등에 쓰는 통화 서식. 시장마다 달라야 합니다. */
  money: krMoney,
  price: krPrice,
  tickSize: krTickSize,
  snapTick: krSnapTick,
  priceLimits: krPriceLimits,
  hasPriceLimit: true,
  hasOrderbook: true,
  // 체결강도·프로그램매매는 키움 국내 TR 만 있습니다.
  // isUs 를 화면에 하드코딩하는 대신 여기에 모아 두면, 기능이 늘어날 때
  // 조건 분기가 App.jsx 곳곳으로 번지지 않습니다.
  hasFlow: true,
  costs: DEFAULT_COSTS,
  /** 상승 색. 한국은 빨강, 미국은 초록입니다. */
  upColor: 'red',
};

/** 미국 호가단위: 1달러 이상은 $0.01, 그 아래는 $0.0001 (SEC Rule 612) */
function usTickSize(price) {
  return price >= 1 ? 0.01 : 0.0001;
}

function usSnapTick(price, mode = 'nearest') {
  if (!Number.isFinite(price) || price <= 0) return null;
  const unit = usTickSize(price);
  const fn = mode === 'down' ? Math.floor : mode === 'up' ? Math.ceil : Math.round;
  // 부동소수 오차를 피하려고 정수로 올렸다 내립니다
  const scaled = fn(Math.round((price / unit) * 1e6) / 1e6);
  return Math.max(unit, Number((scaled * unit).toFixed(4)));
}

export const US = {
  id: 'US',
  label: '미국',
  currency: 'USD',
  money: usMoney,
  price: usPrice,
  tickSize: usTickSize,
  snapTick: usSnapTick,
  // 미국은 일일 가격제한폭이 없습니다. 변동성 중단(LULD)은 일시 정지일 뿐
  // 상한가·하한가처럼 가격을 묶지 않습니다.
  priceLimits: () => ({ upper: null, lower: null }),
  hasPriceLimit: false,
  // 무료 시세 API는 호가(depth)를 주지 않습니다.
  hasOrderbook: false,
  // 프로그램매매는 KRX 공시 개념이고, 체결강도도 무료 API 가 주지 않습니다.
  hasFlow: false,
  // 대부분의 미국 브로커가 수수료 0입니다. 양도소득세는 연말 정산 대상이라
  // 건별 손익분기에 넣지 않습니다 (README 참고).
  costs: { buyFeePct: 0, sellFeePct: 0, sellTaxPct: 0 },
  upColor: 'green',
};

export const MARKETS = { KR, US };

export function marketOf(id) {
  return MARKETS[String(id ?? 'KR').toUpperCase()] ?? KR;
}
