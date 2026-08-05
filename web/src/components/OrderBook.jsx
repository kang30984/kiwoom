import { fmt, fmtVolume } from '../lib/api.js';

/**
 * 호가창. 가격 축을 가운데 고정하고 잔량 바가 좌우 바깥으로 자랍니다.
 * 위쪽 = 매도(파랑) / 아래쪽 = 매수(빨강), 그 사이 이음선에 현재가.
 */
export function OrderBook({ book, price, prevClose, hideHeader = false }) {
  const ask = book?.ask ?? [];
  const bid = book?.bid ?? [];

  if (ask.length === 0 && bid.length === 0) {
    return <p className="notice">호가를 불러오는 중입니다.</p>;
  }

  const peak = Math.max(1, ...[...ask, ...bid].map((r) => r.qty ?? 0));
  const askTotal = ask.reduce((sum, r) => sum + (r.qty ?? 0), 0);
  const bidTotal = bid.reduce((sum, r) => sum + (r.qty ?? 0), 0);

  // 매수 잔량 비중 — 매수세가 우세한지 한눈에
  const bidShare = bidTotal + askTotal > 0
    ? Math.round((bidTotal / (bidTotal + askTotal)) * 100)
    : 50;

  const tone = (p) => {
    if (!prevClose || !p) return 'flat';
    return p > prevClose ? 'up' : p < prevClose ? 'down' : 'flat';
  };

  return (
    <>
      {!hideHeader && (
        <div className="eyebrow">
          <span>호가</span>
          <span>매수 {bidShare}% · 매도 {100 - bidShare}%</span>
        </div>
      )}
      {hideHeader && (
        <p className="ladder__pressure">매수 {bidShare}% · 매도 {100 - bidShare}%</p>
      )}

      <div className="ladder">
        {/* 매도: 높은 호가가 위로 오도록 역순 */}
        {[...ask].reverse().map((row) => (
          <div className="ladder__row" key={`a${row.level}`}>
            <span
              className="ladder__bar ladder__bar--ask"
              style={{ width: `calc((100% - 88px) / 2 * ${(row.qty ?? 0) / peak})` }}
            />
            <span className="ladder__qty ladder__qty--ask">{fmt(row.qty)}</span>
            <span className={`ladder__price ${tone(row.price)}`}>{fmt(row.price)}</span>
          </div>
        ))}

        <div className="ladder__seam">
          <small>매도 {fmtVolume(askTotal)}</small>
          <span className={tone(price)}>{fmt(price)}</span>
          <small style={{ textAlign: 'right' }}>{fmtVolume(bidTotal)} 매수</small>
        </div>

        {bid.map((row) => (
          <div className="ladder__row" key={`b${row.level}`}>
            <span
              className="ladder__bar ladder__bar--bid"
              style={{ width: `calc((100% - 88px) / 2 * ${(row.qty ?? 0) / peak})` }}
            />
            <span className={`ladder__price ${tone(row.price)}`}>{fmt(row.price)}</span>
            <span className="ladder__qty ladder__qty--bid">{fmt(row.qty)}</span>
          </div>
        ))}

        <div className="ladder__totals">
          <span>매도 잔량</span>
          <span />
          <span>매수 잔량</span>
        </div>
      </div>
    </>
  );
}
