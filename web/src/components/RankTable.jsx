import { useEffect, useState } from 'react';
import { api, fmt, fmtRate, fmtVolume, dirClass } from '../lib/api.js';
import { Truncated } from './Truncated.jsx';

export function RankTable({ onPick }) {
  const [kind, setKind] = useState('volume');
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = () => api.rank(kind)
      .then((res) => { if (!cancelled) { setItems(res.items); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    setLoading(true);
    load();
    const id = setInterval(load, 30_000); // 순위는 30초마다 갱신
    return () => { cancelled = true; clearInterval(id); };
  }, [kind]);

  return (
    <>
      <div className="eyebrow">
        <span>순위</span>
        <div className="tabs">
          <button type="button" aria-pressed={kind === 'volume'} onClick={() => setKind('volume')}>거래량</button>
          <button type="button" aria-pressed={kind === 'change'} onClick={() => setKind('change')}>등락률</button>
        </div>
      </div>

      {error && <p className="notice">순위를 불러오지 못했습니다. {error}</p>}
      {!error && loading && items.length === 0 && <p className="notice">불러오는 중…</p>}

      {items.length > 0 && (
        <table className="rank-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">종목</th>
              <th scope="col">현재가</th>
              <th scope="col">등락률</th>
              <th scope="col">거래량</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.code} onClick={() => onPick(row.code, row.name)}>
                <td>{row.rank}</td>
                <td className="name"><Truncated className="rank-name" text={row.name} /></td>
                <td className={`num ${dirClass(row.changeRate)}`}>{fmt(row.price)}</td>
                <td className={`num ${dirClass(row.changeRate)}`}>{fmtRate(row.changeRate)}</td>
                <td className="num">{fmtVolume(row.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
