/**
 * KRX 시장 규칙. 호가단위와 가격제한폭.
 * 규정이 개정되면 이 파일만 고치면 됩니다.
 */

/** 호가단위 (2023년 개정 기준) */
export function tickSize(price) {
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

/**
 * 가격을 유효한 호가에 맞춥니다.
 * 손절가는 아래로(down), 익절가는 위로(up) 맞추는 편이 보수적입니다.
 * @param {number} price
 * @param {'nearest'|'down'|'up'} mode
 */
export function snapTick(price, mode = 'nearest') {
  if (!Number.isFinite(price) || price <= 0) return null;
  const unit = tickSize(price);
  const fn = mode === 'down' ? Math.floor : mode === 'up' ? Math.ceil : Math.round;
  return Math.max(unit, fn(price / unit) * unit);
}

/** 일일 가격제한폭 ±30% */
export const PRICE_LIMIT_RATE = 0.3;

export function priceLimits(prevClose) {
  if (!prevClose) return { upper: null, lower: null };
  return {
    upper: snapTick(prevClose * (1 + PRICE_LIMIT_RATE), 'down'),
    lower: snapTick(prevClose * (1 - PRICE_LIMIT_RATE), 'up'),
  };
}

/**
 * 거래비용 기본값 — 반드시 본인 계좌 조건으로 바꿔 쓰세요.
 * 증권사 수수료는 계좌·이벤트별로 크게 다르고, 증권거래세율은 개정이 잦습니다.
 */
export const DEFAULT_COSTS = {
  buyFeePct: 0.015,   // 매수 위탁수수료 (%)
  sellFeePct: 0.015,  // 매도 위탁수수료 (%)
  sellTaxPct: 0.18,   // 매도 시 증권거래세 등 (%) — 최신 세율 확인 필요
};
