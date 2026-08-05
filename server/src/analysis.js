import { KR } from './markets.js';

/**
 * 이 모듈은 "사라/팔라"를 판단하지 않습니다.
 * 진입 여부는 사용자가 정하고, 여기서는 그 결정에 딸린 숫자만 계산합니다.
 * 손절폭 → 수량 → 최대손실 → 손익분기. 전부 공개된 산식입니다.
 */

/** True Range: 당일 변동폭과 전일 종가 대비 갭 중 큰 값 */
function trueRanges(candles) {
  const out = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    out.push(Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    ));
  }
  return out;
}

/**
 * ATR — Wilder 방식 지수평활.
 * 초기값은 첫 period개 TR의 단순평균으로 잡습니다.
 */
export function atr(candles, period = 14) {
  const tr = trueRanges(candles);
  if (tr.length < period) return null;

  let value = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i += 1) {
    value = (value * (period - 1) + tr[i]) / period;
  }
  return value;
}

/** 최근 N봉의 고점·저점 — 지지·저항 참고용 */
export function swingLevels(candles, lookback = 20) {
  const window = candles.slice(-lookback);
  if (window.length === 0) return null;

  let high = window[0];
  let low = window[0];
  for (const c of window) {
    if (c.high > high.high) high = c;
    if (c.low < low.low) low = c;
  }
  return {
    lookback: window.length,
    high: high.high,
    highDate: high.time?.slice(0, 10) ?? null,
    low: low.low,
    lowDate: low.time?.slice(0, 10) ?? null,
  };
}

/** 최근 N일 일간 변동률 평균 — 변동성 체감용 */
function avgDailyRangePct(candles, lookback = 20) {
  const window = candles.slice(-lookback);
  if (window.length === 0) return null;
  const sum = window.reduce((acc, c) => acc + ((c.high - c.low) / c.close) * 100, 0);
  return sum / window.length;
}

/**
 * 손익분기가. 매수 수수료를 물고 들어가서 매도 수수료·세금을 떼고 나올 때,
 * 원금이 되는 가격입니다. 이 위로 올라가야 비로소 수익입니다.
 */
function breakeven(entry, costs) {
  const buy = 1 + costs.buyFeePct / 100;
  const sell = 1 - (costs.sellFeePct + costs.sellTaxPct) / 100;
  if (sell <= 0) return null;
  return entry * (buy / sell);
}

/**
 * 리스크 계획 계산.
 *
 * @param {object} o
 * @param {Array}  o.candles     일봉 (오름차순)
 * @param {number} o.price       현재가
 * @param {number} o.prevClose   전일 종가
 * @param {object} o.params      사용자 입력
 * @param {number} o.params.atrMult    손절폭 = ATR × 이 배수 (기본 2)
 * @param {number} o.params.capital    투자에 쓸 총 자금 (원)
 * @param {number} o.params.riskPct    그 자금 중 감당할 손실 비율 (%)
 * @param {number} [o.params.avgCost]  보유 중이면 평균단가
 * @param {number} [o.params.heldQty]  보유 수량
 * @param {object} [o.params.costs]    수수료·세율
 * @param {object} [o.market]          시장 규칙 (markets.js). 기본 국내.
 */
export function computePlan({ candles, price, prevClose, params, market = KR }) {
  const warnings = [];
  const { snapTick, priceLimits, money, price: fmtPx } = market;
  const costs = { ...market.costs, ...(params.costs ?? {}) };

  const atrMult = Number(params.atrMult) > 0 ? Number(params.atrMult) : 2;
  const capital = Number(params.capital) > 0 ? Number(params.capital) : 0;
  const riskPct = Number(params.riskPct) > 0 ? Number(params.riskPct) : 1;

  const atrValue = atr(candles, 14);
  const limits = priceLimits(prevClose);

  if (!atrValue) {
    warnings.push('일봉이 부족해 ATR을 계산할 수 없습니다. 손절폭을 직접 정하세요.');
  }

  /* ── 손절가 ─────────────────────────────────────────── */
  const rawStop = atrValue ? price - atrValue * atrMult : null;
  const stopPrice = rawStop ? snapTick(rawStop, 'down') : null;

  // 하한가로 끌어올리지 않습니다. 그렇게 하면 손절폭이 줄어
  // 수량이 과대 계산되고 실제 위험이 과소평가됩니다.
  const stopBelowDailyLimit = Boolean(
    market.hasPriceLimit && stopPrice && limits.lower && stopPrice < limits.lower,
  );
  if (stopBelowDailyLimit) {
    warnings.push(`손절가가 오늘 하한가(${fmtPx(limits.lower)})보다 낮습니다. 오늘 중에는 이 가격에 체결되지 않습니다.`);
  }

  const riskPerShare = stopPrice ? price - stopPrice : null;
  const stopPct = riskPerShare ? (riskPerShare / price) * 100 : null;

  /* ── 익절가 (R 배수) ────────────────────────────────── */
  // ±30% 는 '당일' 제한입니다. 익절 목표는 며칠에 걸쳐 도달하는 값이므로
  // 오늘 상한가로 자르지 않고, 당일 도달 가능 여부만 표시합니다.
  const targets = riskPerShare
    ? [1, 2, 3].map((r) => {
        const target = snapTick(price + riskPerShare * r, 'up');
        return {
          r,
          price: target,
          gain: target - price,
          pct: ((target - price) / price) * 100,
          beyondDailyLimit: Boolean(market.hasPriceLimit && limits.upper && target > limits.upper),
        };
      })
    : [];

  const beyond = targets.filter((t) => t.beyondDailyLimit);
  if (beyond.length === targets.length && targets.length > 0) {
    warnings.push(`목표가 전부가 오늘 상한가(${fmtPx(limits.upper)})를 넘습니다. 손절폭이 커서 하루 안에 닿을 수 있는 수준이 아닙니다.`);
  } else if (beyond.length > 0) {
    warnings.push(`${beyond.map((t) => `${t.r}R`).join(', ')} 목표가는 오늘 상한가를 넘습니다. 당일에는 도달할 수 없습니다.`);
  }

  /* ── 수량 산정 ─────────────────────────────────────── */
  /**
   * 두 가지 상한을 각각 계산합니다. 서로 다른 질문에 답하므로 둘 다 보여줍니다.
   *   자금 기준   : 돈으로 몇 주까지 살 수 있나
   *   리스크 기준 : 손절에 걸렸을 때 감당 손실 안에 머무는 수량은 몇 주까지인가
   * 실제 수량은 둘 중 작은 값입니다. 자금이 없으면 살 수 없고,
   * 리스크 한도를 넘기면 애초에 정한 손실 상한이 무의미해집니다.
   */
  let sizing = null;
  if (capital > 0 && price > 0) {
    const byCapital = Math.floor(capital / price);
    const byRisk = riskPerShare ? Math.floor((capital * (riskPct / 100)) / riskPerShare) : null;

    const shares = byRisk === null ? byCapital : Math.min(byCapital, byRisk);
    const limitedBy = byRisk === null || byCapital < byRisk ? 'capital' : 'risk';

    const lossAt = (n) => (riskPerShare ? n * riskPerShare : null);

    sizing = {
      riskBudget: capital * (riskPct / 100),
      shares,
      cost: shares * price,
      maxLoss: lossAt(shares),
      capitalUsedPct: (shares * price) / capital * 100,
      limitedBy,

      // 자금을 다 쓰는 선택지 — 그때의 손실을 함께 보여줍니다
      byCapital: {
        shares: byCapital,
        cost: byCapital * price,
        loss: lossAt(byCapital),
        lossPct: lossAt(byCapital) !== null ? (lossAt(byCapital) / capital) * 100 : null,
        capitalUsedPct: (byCapital * price) / capital * 100,
      },

      // 감당 손실을 지키는 선택지
      byRisk: byRisk === null ? null : {
        shares: byRisk,
        cost: byRisk * price,
        loss: lossAt(byRisk),
        lossPct: lossAt(byRisk) !== null ? (lossAt(byRisk) / capital) * 100 : null,
        capitalUsedPct: (byRisk * price) / capital * 100,
      },
    };

    if (shares === 0) {
      warnings.push(byCapital === 0
        ? `현재가 ${fmtPx(price)}가 투자금보다 비쌉니다. 1주도 살 수 없습니다.`
        : '감당 손실 대비 손절폭이 커서 1주도 살 수 없습니다. 손실 비율을 늘리거나 ATR 배수를 줄이세요.');
    } else if (limitedBy === 'risk' && byCapital > byRisk) {
      warnings.push(`자금으로는 ${byCapital.toLocaleString('ko-KR')}주까지 살 수 있지만, `
        + `그러면 손절 시 ${money(lossAt(byCapital))} (자금의 ${((lossAt(byCapital) / capital) * 100).toFixed(1)}%)을 잃습니다. `
        + `감당 손실 ${riskPct}% 를 지키려면 ${byRisk.toLocaleString('ko-KR')}주입니다.`);
    } else if (limitedBy === 'capital') {
      warnings.push(`감당 손실 기준으로는 더 살 수 있지만 투자금이 ${byCapital.toLocaleString('ko-KR')}주에서 막힙니다.`);
    }
  }

  /* ── 손익분기 ───────────────────────────────────────── */
  const feeSum = costs.buyFeePct + costs.sellFeePct + costs.sellTaxPct;
  const bePrice = feeSum > 0 ? breakeven(price, costs) : null;
  const beSnapped = bePrice ? snapTick(bePrice, 'up') : null;

  /* ── 보유 중일 때 ───────────────────────────────────── */
  /**
   * 평균단가와 보유 수량은 각각 독립적으로 쓸모가 있습니다.
   *   수량만    → 평가금액, 손절되면 얼마를 잃는지
   *   단가까지  → 평가손익, 원금 회복가
   * 예전에는 평균단가가 없으면 수량을 통째로 버려서, 입력해도 아무 반응이 없었습니다.
   */
  const avgCost = Number(params.avgCost) > 0 ? Number(params.avgCost) : null;
  const heldQty = Number(params.heldQty) > 0 ? Number(params.heldQty) : null;

  let holding = null;
  if (avgCost || heldQty) {
    const beFromCost = avgCost ? breakeven(avgCost, costs) : null;
    const lossAtStop = heldQty && riskPerShare ? heldQty * riskPerShare : null;

    holding = {
      heldQty,
      avgCost,

      // 수량만 있으면 계산됩니다
      marketValue: heldQty ? heldQty * price : null,
      lossAtStop,
      // 분모는 '평가금액' 입니다. 자금 대비로 하면 자금이 클 때 0.0% 가 되어
      // 아무 정보도 주지 않습니다. 평가금액 대비는 손절폭 % 와 일치해 검산도 됩니다.
      /**
       * 평가액 대비 비율은 손절폭 %와 수학적으로 같아(수량이 약분됨) 중복입니다.
       * 감당 손실 예산 대비로 보면 '이 보유분이 내 리스크 허용치를 넘는가' 를
       * 바로 판단할 수 있습니다.
       */
      lossVsBudget: lossAtStop && capital > 0 && riskPct > 0
        ? (lossAtStop / (capital * (riskPct / 100))) * 100
        : null,

      // 평균단가가 있어야 계산됩니다
      diff: avgCost ? price - avgCost : null,
      diffPct: avgCost ? ((price - avgCost) / avgCost) * 100 : null,
      breakevenPrice: beFromCost ? snapTick(beFromCost, 'up') : null,
      unrealized: avgCost && heldQty ? (price - avgCost) * heldQty : null,

      needsAvgCost: Boolean(heldQty && !avgCost),
    };

    if (avgCost && price < avgCost) {
      warnings.push('현재가가 평균단가보다 낮습니다. 손실 상태에서 추가 매수는 손절폭을 넓히는 결과가 됩니다.');
    }
    if (heldQty && !avgCost) {
      warnings.push('보유 수량만 입력되어 평가손익은 계산할 수 없습니다. 평균단가를 넣으면 손익과 원금 회복가가 함께 나옵니다.');
    }
    if (holding.lossVsBudget !== null && holding.lossVsBudget > 100) {
      const times = holding.lossVsBudget / 100;
      warnings.push(`보유 ${heldQty.toLocaleString('ko-KR')}주가 손절되면 ${money(lossAtStop)}을 잃습니다. `
        + `감당 손실 ${riskPct}% 예산(${money(capital * (riskPct / 100))})의 `
        + `${times >= 10 ? `${Math.round(times)}배` : `${holding.lossVsBudget.toFixed(0)}%`}입니다. `
        + '이미 보유한 수량이 정한 리스크 허용치를 넘습니다.');
    }
    if (avgCost && !heldQty) {
      warnings.push('평균단가만 입력되어 금액은 계산할 수 없습니다. 보유 수량을 넣으면 평가손익이 나옵니다.');
    }
  }

  /* ── 변동성 참고 ────────────────────────────────────── */
  const volatility = {
    atr: atrValue,
    atrPct: atrValue ? (atrValue / price) * 100 : null,
    avgDailyRangePct: avgDailyRangePct(candles, 20),
    period: 14,
  };

  if (stopPct && stopPct > 15) {
    warnings.push(`손절폭이 현재가의 ${stopPct.toFixed(1)}%입니다. ATR이 비정상적으로 큰지 차트를 확인하거나 배수를 줄이세요.`);
  }

  if (riskPct > 10 && capital > 0) {
    warnings.push(`감당 손실 ${riskPct}%는 ${money(capital * (riskPct / 100))}입니다. 한 종목당 1~2%가 통상적인 범위입니다.`);
  }

  // 최근 거래량 대비 수량 점검. 시장이 소화할 수 없는 규모면 계산상의 값일 뿐입니다.
  const recentVolume = candles.slice(-20);
  if (sizing?.shares > 0 && recentVolume.length > 0) {
    const avgVol = recentVolume.reduce((sum, c) => sum + (c.volume ?? 0), 0) / recentVolume.length;
    if (avgVol > 0) {
      const share = (sizing.shares / avgVol) * 100;
      if (share > 5) {
        warnings.push(`권장 ${sizing.shares.toLocaleString('ko-KR')}주는 최근 20일 평균 거래량의 ${share < 1000 ? `${share.toFixed(0)}%` : `${Math.round(share / 100)}배`}입니다. 이 규모는 시장에서 소화되지 않으니 투자금 입력을 확인하세요.`);
      }
    }
  }

  if (volatility.atrPct && volatility.atrPct > 5) {
    warnings.push(`일평균 변동폭이 현재가의 ${volatility.atrPct.toFixed(1)}%입니다. 변동성이 큰 종목이라 손절폭도 그만큼 넓어집니다.`);
  }

  return {
    market: market.id,
    currency: market.currency,
    price,
    prevClose,
    limits,
    volatility,
    stop: stopPrice
      ? {
          price: stopPrice,
          riskPerShare,
          pct: stopPct,
          basis: `ATR(14) × ${atrMult}`,
          belowDailyLimit: stopBelowDailyLimit,
        }
      : null,
    targets,
    sizing,
    costs: {
      ...costs,
      breakevenPrice: beSnapped,
      breakevenPct: beSnapped ? ((beSnapped - price) / price) * 100 : null,
    },
    holding,
    swing: swingLevels(candles, 20),
    params: { atrMult, capital, riskPct },
    warnings,
    disclaimer:
      '변동성(ATR)에서 기계적으로 계산한 값입니다. 가격 예측이나 매매 추천이 아니며, 이 가격에 도달한다는 보장은 없습니다.',
  };
}
