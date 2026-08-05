import { useEffect, useRef, useState } from 'react';
import { createChart } from 'lightweight-charts';
import { api } from '../lib/api.js';

/**
 * CSS 변수를 읽습니다. 반드시 차트 컨테이너에서 읽어야 합니다.
 * 미국 색 반전은 .shell[data-market='US'] 에 걸려 있어서
 * document.documentElement(:root) 에서 읽으면 국내 색이 나옵니다.
 */
const CSS = (name, el) => getComputedStyle(el ?? document.documentElement)
  .getPropertyValue(name).trim();

/** 봉 종류. 긴 기간이 왼쪽. 추가할 땐 여기와 서버의 CHART_TR 만 고치면 됩니다. */
const PERIODS = [
  ['month', '월봉'],
  ['week', '주봉'],
  ['day', '일봉'],
  ['minute', '분봉'],
];

/**
 * ISO 문자열 → lightweight-charts 시간값.
 * 분봉은 UNIX 초, 일봉·주봉은 'YYYY-MM-DD' 날짜 문자열을 씁니다.
 */
const toChartTime = (iso, type) =>
  type === 'minute' ? Math.floor(Date.parse(iso) / 1000) : iso.slice(0, 10);

export function PriceChart({ code, market = 'KR' }) {
  const holderRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const volumeRef = useRef(null);

  const [type, setType] = useState('day');
  const [tick, setTick] = useState('5');
  const [error, setError] = useState(null);
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (market === 'US' && type === 'minute') setType('day');
  }, [market, type]);

  /* 차트 생성 (한 번) */
  useEffect(() => {
    const host = holderRef.current;
    const up = CSS('--up', host) || '#f04452';
    const down = CSS('--down', host) || '#3b82f6';

    const chart = createChart(host, {
      layout: {
        background: { color: 'transparent' },
        textColor: CSS('--muted', host) || '#78849a',
        fontFamily: CSS('--mono', host) || 'monospace',
        fontSize: 10,
      },
      grid: {
        vertLines: { color: CSS('--rule', host) || '#252b37' },
        horzLines: { color: CSS('--rule', host) || '#252b37' },
      },
      rightPriceScale: { borderColor: CSS('--rule', host) || '#252b37' },
      timeScale: { borderColor: CSS('--rule', host) || '#252b37', timeVisible: false },
      crosshair: { mode: 0 },
      localization: {
        locale: 'ko-KR',
        priceFormatter: (v) => Math.round(v).toLocaleString('ko-KR'),
      },
    });

    // 상승 빨강 / 하락 파랑 — 한국 시장 관례
    candleRef.current = chart.addCandlestickSeries({
      upColor: up, downColor: down,
      borderUpColor: up, borderDownColor: down,
      wickUpColor: up, wickDownColor: down,
    });

    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: CSS('--rule', host) || '#252b37',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candleRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.22 } });

    chartRef.current = chart;

    const observer = new ResizeObserver(([entry]) => {
      chart.applyOptions({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(host);

    return () => { observer.disconnect(); chart.remove(); };
  }, []);

  /* 데이터 적재 */
  useEffect(() => {
    // 종목·시장이 바뀌면 먼저 이전 데이터를 비웁니다.
    // 새 요청 결과로 덮어쓰기만 하면, 그 요청이 실패하거나 느릴 때
    // 다른 종목(심하면 다른 나라)의 차트가 그대로 남습니다.
    candleRef.current?.setData([]);
    volumeRef.current?.setData([]);

    if (!code) return;
    let cancelled = false;

    setError(null);
    setCount(null);
    setLoading(true);

    api.chart(code, type, tick, market)
      .then(({ candles }) => {
        if (cancelled || !candleRef.current) return;
        setCount(candles.length);

        // 시장이 바뀌면 --up/--down 이 뒤집히므로 캔들 색을 다시 적용합니다.
        // 차트는 한 번만 생성되니 여기서 갱신하지 않으면 예전 색이 남습니다.
        const up = CSS('--up', holderRef.current) || '#f04452';
        const down = CSS('--down', holderRef.current) || '#3b82f6';
        candleRef.current.applyOptions({
          upColor: up, downColor: down,
          borderUpColor: up, borderDownColor: down,
          wickUpColor: up, wickDownColor: down,
        });

        candleRef.current.setData(
          candles.map((c) => ({ ...c, time: toChartTime(c.time, type) })),
        );
        volumeRef.current.setData(
          candles.map((c) => ({
            time: toChartTime(c.time, type),
            value: c.volume,
            color: `${c.close >= c.open ? up : down}44`,
          })),
        );
        chartRef.current.timeScale().applyOptions({ timeVisible: type === 'minute' });
        chartRef.current.timeScale().fitContent();
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [code, type, tick, market]);

  return (
    <>
      <div className="eyebrow">
        <span>
          차트
          {loading && ' · 불러오는 중…'}
          {!loading && count !== null && ` · ${count.toLocaleString()}봉`}
        </span>
        <div className="tabs">
          {PERIODS.filter(([v]) => !(market === 'US' && v === 'minute')).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => setType(value)}
            >
              {label}
            </button>
          ))}
          {type === 'minute' && ['1', '5', '30'].map((t) => (
            <button key={t} type="button" aria-pressed={tick === t} onClick={() => setTick(t)}>{t}분</button>
          ))}
        </div>
      </div>
      {error && <p className="notice">차트를 불러오지 못했습니다. {error}</p>}
      {!error && !loading && count === 0 && (
        <p className="notice">이 종목의 캔들 데이터가 없습니다.</p>
      )}
      <div className="chart-wrap" ref={holderRef} />
    </>
  );
}
