import { fmtPrice, fmtRate, dirClass } from '../lib/api.js';
import { Truncated } from './Truncated.jsx';

export function Watchlist({ items, ticks, selected, onSelect, onRemove, market = 'KR' }) {
  return (
    <>
      <div className="eyebrow">
        <span>관심종목</span>
        <span>{items.length}</span>
      </div>

      {items.length === 0 ? (
        <p className="notice">위 검색창에서 종목을 찾아 추가해 보세요. 예: <code>{market === 'US' ? 'AAPL' : '005930'}</code></p>
      ) : (
        items.map((item) => {
          const live = ticks[item.code];
          const price = live?.price ?? item.price;
          const rate = live?.changeRate ?? item.changeRate;

          return (
            <button
              type="button"
              // key에 seq를 섞어 매 체결마다 점멸 애니메이션이 다시 시작되게 합니다
              key={`${item.code}:${live?.seq ?? 0}`}
              className={`watch-row ${live?.dir ? `tick-${live.dir}` : ''}`}
              aria-current={item.code === selected}
              onClick={() => onSelect(item.code)}
            >
              <Truncated className="watch-row__name" text={item.name ?? item.code} />
              <span className={`watch-row__price num ${dirClass(rate)}`}>{fmtPrice(price, market)}</span>
              <span className="watch-row__code">{item.code}</span>
              <span className={`watch-row__rate num ${dirClass(rate)}`}>{fmtRate(rate)}</span>
              <span
                className="watch-row__drop"
                role="button"
                tabIndex={-1}
                aria-label={`${item.name ?? item.code} 삭제`}
                onClick={(e) => { e.stopPropagation(); onRemove(item.code); }}
              >
                ×
              </span>
            </button>
          );
        })
      )}
    </>
  );
}
