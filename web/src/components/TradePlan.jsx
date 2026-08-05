import { useEffect, useState } from 'react';
import {
  api, fmtPrice, fmtRate, fmtMoneyShort, fmtExact, fmtShares, groupDigits, ungroup,
} from '../lib/api.js';

const STORE_KEY = 'planParams.v1';

const DEFAULTS = {
  KR: { capital: 10_000_000, riskPct: 1, atrMult: 2, avgCost: '', heldQty: '' },
  US: { capital: 10_000, riskPct: 1, atrMult: 2, avgCost: '', heldQty: '' },
};

function loadParams(market) {
  const base = DEFAULTS[market] ?? DEFAULTS.KR;
  try {
    return { ...base, ...(JSON.parse(localStorage.getItem(`${STORE_KEY}.${market}`)) ?? {}) };
  } catch {
    return base;
  }
}

export function TradePlan({ code, price, market = 'KR' }) {
  const amt = (n) => fmtMoneyShort(n, market);   // 화면 표시 (축약)
  const exact = (n) => fmtExact(n, market);      // tooltip 용 (정확)
  const [params, setParams] = useState(() => loadParams(market));
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(`${STORE_KEY}.${market}`, JSON.stringify(params));
  }, [params, market]);

  /* 시장이 바뀌면 그 시장의 저장값으로 갈아탑니다 */
  useEffect(() => {
    setParams(loadParams(market));
    setPlan(null);
    setError(null);
  }, [market]);

  const set = (key) => (e) => setParams((p) => ({ ...p, [key]: e.target.value }));
  // 큰 금액·수량은 자릿수 구분 없이는 읽을 수 없습니다.
  // 화면에는 구분 기호를 넣고, 저장·전송은 숫자만 합니다.
  const setNum = (key) => (e) => setParams((p) => ({ ...p, [key]: ungroup(e.target.value) }));

  const calculate = () => {
    if (!code) return;
    setLoading(true);
    setError(null);
    api.plan(code, params, market)
      .then(setPlan)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  // 종목이 바뀌면 이전 종목의 계산 결과를 지웁니다.
  useEffect(() => { setPlan(null); setError(null); }, [code]);

  return (
    <>
      <div className="plan">
        <p className="plan__lede">
          진입 여부는 직접 판단하세요. 여기서는 그 결정에 딸린 숫자만 계산합니다 —
          손절폭을 얼마로 두면 몇 주까지 살 수 있고, 손절에 걸렸을 때 얼마를 잃는지.
        </p>

        <div className="plan__inputs">
          <label>
            <span>투자 가능 자금 <em>({market === 'US' ? '달러' : '원'})</em></span>
            <input className="num" value={groupDigits(params.capital)} onChange={setNum('capital')} inputMode="numeric" />
          </label>
          <label>
            <span>감당할 손실 <em>(자금의 %)</em></span>
            <input className="num" value={params.riskPct} onChange={set('riskPct')} inputMode="decimal" />
          </label>
          <label>
            <span>손절폭 <em>(ATR의 몇 배)</em></span>
            <input className="num" value={params.atrMult} onChange={set('atrMult')} inputMode="decimal" />
          </label>
          <label>
            <span>평균단가 <em>(보유 중일 때만)</em></span>
            <input className="num" value={groupDigits(params.avgCost)} onChange={setNum('avgCost')} inputMode="numeric" placeholder="미보유" />
          </label>
          <label>
            <span>보유 수량 <em>(주)</em></span>
            <input className="num" value={groupDigits(params.heldQty)} onChange={setNum('heldQty')} inputMode="numeric" placeholder="0" />
          </label>
        </div>

        <button type="button" className="plan__go" onClick={calculate} disabled={loading || !code}>
          {loading ? '계산 중…' : '계산하기'}
        </button>

        {error && <p className="notice">계산하지 못했습니다. {error}</p>}

        {!plan && !error && (
          <p className="plan__hint">
            자금과 감당할 손실을 정한 뒤 계산하기를 누르세요.
            손절폭은 이 종목의 실제 일평균 변동폭(ATR)에 맞춰 잡히므로,
            변동성이 큰 종목일수록 손절폭이 넓어지고 그만큼 수량이 줄어듭니다.
            {market === 'US' && ' 미국 주식은 환율과 양도소득세를 반영하지 않은 달러 기준입니다.'}
          </p>
        )}

        {plan && <PlanResult plan={plan} price={price} market={market} />}
      </div>
    </>
  );
}

function PlanResult({ plan, price, market }) {
  const px = (n) => fmtPrice(n, market);
  /** 아주 작거나 아주 큰 비율이 0.0% / 107000% 로 뭉개지지 않게 */
  const pctText = (v) => {
    if (v >= 1000) return `${Math.round(v / 100)}배`;
    if (v < 0.1) return '<0.1%';
    return `${v.toFixed(v < 10 ? 1 : 0)}%`;
  };
  // 합계 금액은 줄여서 보여주고 정확한 값은 마우스를 올리면 나옵니다
  const amt = (n) => fmtMoneyShort(n, market);
  const exact = (n) => fmtExact(n, market);
  const qty = (n) => fmtQty(n, market);
  const drifted = price && plan.price && Math.abs(price - plan.price) / plan.price > 0.005;

  return (
    <div className="plan__out">
      {drifted && (
        <p className="plan__stale">
          계산 시점 {px(plan.price)} → 현재 {px(price)}. 다시 계산하세요.
        </p>
      )}

      <div className="plan__vol">
        <span>일평균 변동폭 ATR(14)</span>
        <b className="num" title={exact(plan.volatility.atr)}>{amt(plan.volatility.atr)}</b>
        <span className="num">{plan.volatility.atrPct?.toFixed(2)}%</span>
      </div>

      {plan.limits?.upper != null && (
        <p className="plan__swing" style={{ marginTop: 8 }}>
          오늘 상한가 <b className="num">{px(plan.limits.upper)}</b>
          {' · '}하한가 <b className="num">{px(plan.limits.lower)}</b>
        </p>
      )}

      {/* 손절 · 익절 가격대 */}
      {/* 호가창과 같은 방향: 높은 가격이 위, 낮은 가격이 아래 */}
      <table className="plan__levels">
        <tbody>
          {[...plan.targets].reverse().map((t) => (
            <tr key={t.r} className="plan__levels--target">
              <th scope="row">익절 {t.r}R</th>
              <td className="num">{px(t.price)}</td>
              <td className="num up">+{t.pct.toFixed(2)}%</td>
              <td>{t.beyondDailyLimit ? '당일 도달 불가' : `손절폭 × ${t.r}`}</td>
            </tr>
          ))}
          {plan.costs.breakevenPrice && (
            <tr>
              <th scope="row">손익분기</th>
              <td className="num">{px(plan.costs.breakevenPrice)}</td>
              <td className="num flat">+{plan.costs.breakevenPct.toFixed(2)}%</td>
              <td>수수료·세금 회수</td>
            </tr>
          )}
          <tr className="plan__levels--now">
            <th scope="row">현재</th>
            <td className="num">{px(plan.price)}</td>
            <td className="num flat">기준</td>
            <td>진입가로 가정</td>
          </tr>
          {plan.stop && (
            <tr className="plan__levels--stop">
              <th scope="row">손절</th>
              <td className="num">{px(plan.stop.price)}</td>
              <td className="num down">−{plan.stop.pct.toFixed(2)}%</td>
              <td>{plan.stop.belowDailyLimit ? '당일 체결 불가' : plan.stop.basis}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* 수량 산정.
          4열 표는 좁은 패널에서 마지막 열이 잘립니다. 기준별 카드로 쌓습니다. */}
      {plan.sizing && (
        <div className="sizing">
          {[
            ['자금 전액', plan.sizing.byCapital, 'capital'],
            [`감당 손실 ${plan.params.riskPct}%`, plan.sizing.byRisk, 'risk'],
          ].filter(([, data]) => data).map(([label, data, key]) => (
            <div key={key} className={`sizing__card ${plan.sizing.limitedBy === key ? 'is-chosen' : ''}`}>
              <div className="sizing__head">
                <span className="sizing__label">{label}</span>
                <b className="sizing__qty num">{fmtShares(data.shares)}</b>
              </div>
              <dl className="sizing__rows">
                <div>
                  <dt>투입</dt>
                  <dd className="num" title={exact(data.cost)}>{amt(data.cost)}</dd>
                </div>
                <div>
                  <dt>손절 시</dt>
                  <dd className="num down" title={exact(data.loss)}>
                    −{amt(data.loss)}
                    {data.lossPct !== null && <em> 자금의 {data.lossPct.toFixed(1)}%</em>}
                  </dd>
                </div>
              </dl>
              {plan.sizing.limitedBy === key && <span className="sizing__badge">권장</span>}
            </div>
          ))}

          <p className="sizing__note">
            {plan.sizing.limitedBy === 'risk'
              ? '자금은 더 여유가 있지만 감당 손실 한도가 수량을 묶습니다.'
              : '감당 손실 기준으로는 더 살 수 있지만 투자금이 한도입니다.'}
            {' '}둘 중 <b>작은 쪽</b>이 권장 수량입니다.
          </p>
        </div>
      )}

      {/* 보유 중일 때 — 수량만 있어도 계산되는 항목과 평균단가가 필요한 항목을 나눕니다 */}
      {plan.holding && (
        <>
          <dl className="plan__sizing plan__sizing--held">
            {plan.holding.heldQty && (
              <div>
                <dt>보유 수량</dt>
                <dd className="num" title={`${plan.holding.heldQty.toLocaleString('ko-KR')}주`}>{fmtShares(plan.holding.heldQty)}</dd>
              </div>
            )}
            {plan.holding.marketValue !== null && (
              <div>
                <dt>평가 금액</dt>
                <dd className="num" title={exact(plan.holding.marketValue)}>{amt(plan.holding.marketValue)}</dd>
              </div>
            )}
            {plan.holding.lossAtStop !== null && (
              <div>
                <dt>손절 시 손실</dt>
                <dd className="num down" title={exact(plan.holding.lossAtStop)}>
                  −{amt(plan.holding.lossAtStop)}
                  {plan.holding.lossVsBudget !== null && (
                    <em> 감당 손실 예산의 {pctText(plan.holding.lossVsBudget)}</em>
                  )}
                </dd>
              </div>
            )}
            {plan.holding.avgCost && (
              <div>
                <dt>평균단가</dt>
                <dd className="num">{px(plan.holding.avgCost)}</dd>
              </div>
            )}
            {plan.holding.diffPct !== null && (
              <div>
                <dt>현재 손익</dt>
                <dd className={`num ${plan.holding.diff > 0 ? 'up' : plan.holding.diff < 0 ? 'down' : 'flat'}`}>
                  {fmtRate(plan.holding.diffPct)}
                </dd>
              </div>
            )}
            {plan.holding.breakevenPrice && (
              <div>
                <dt>원금 회복가</dt>
                <dd className="num">{px(plan.holding.breakevenPrice)}</dd>
              </div>
            )}
            {plan.holding.unrealized !== null && (
              <div>
                <dt>평가손익</dt>
                <dd
                  className={`num ${plan.holding.unrealized > 0 ? 'up' : plan.holding.unrealized < 0 ? 'down' : 'flat'}`}
                  title={exact(plan.holding.unrealized)}
                >
                  {amt(plan.holding.unrealized)}
                </dd>
              </div>
            )}
          </dl>

          {plan.holding.needsAvgCost && (
            <p className="sizing__note">
              평가손익과 원금 회복가는 <b>평균단가</b>를 넣어야 계산됩니다.
            </p>
          )}
        </>
      )}

      {/* 참고 지지·저항 */}
      {plan.swing && (
        <p className="plan__swing">
          최근 {plan.swing.lookback}일 고점 <b className="num">{px(plan.swing.high)}</b> ({plan.swing.highDate})
          · 저점 <b className="num">{px(plan.swing.low)}</b> ({plan.swing.lowDate})
        </p>
      )}

      {plan.warnings.length > 0 && (
        <ul className="plan__warn">
          {plan.warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <p className="plan__disclaimer">{plan.disclaimer}</p>
    </div>
  );
}
