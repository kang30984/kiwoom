import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtPrice, fmtPriceSigned, fmtRate, fmtVol, dirClass, normalizeCode } from './lib/api.js';
import { useRealtime } from './lib/useRealtime.js';
import { Watchlist } from './components/Watchlist.jsx';
import { OrderBook } from './components/OrderBook.jsx';
import { PriceChart } from './components/PriceChart.jsx';
import { RankTable } from './components/RankTable.jsx';
import { TradePlan } from './components/TradePlan.jsx';
import { StockSearch } from './components/StockSearch.jsx';
import { FlowPanel } from './components/FlowPanel.jsx';

const MARKET_KEY = 'market.v1';

/**
 * 우측 패널 탭. 시장별로 갖는 기능이 다릅니다 (서버 markets.js 의 hasOrderbook /
 * hasFlow 와 같은 구분). isUs 를 렌더 안에 흩뿌리는 대신 여기 한곳에 두면,
 * 기능을 추가할 때 조건 분기가 App 곳곳으로 번지지 않습니다.
 *   - 호가: 미국 무료 API 는 depth 를 주지 않습니다
 *   - 수급: 체결강도·프로그램매매는 키움 국내 TR 만 있습니다
 */
const RIGHT_TABS = {
  KR: [['book', '호가'], ['flow', '수급'], ['plan', '매매계획']],
  US: [['plan', '매매계획']],
};
const STORE_KEY = { KR: 'watchlist.v1', US: 'watchlist.us.v1' };

const DEFAULTS = {
  KR: [
    { code: '005930', name: '삼성전자' },
    { code: '000660', name: 'SK하이닉스' },
    { code: '035720', name: '카카오' },
  ],
  US: [
    { code: 'AAPL', name: 'Apple Inc.' },
    { code: 'MSFT', name: 'Microsoft Corporation' },
    { code: 'NVDA', name: 'NVIDIA Corporation' },
  ],
};

/** 미국 티커는 6자리 규칙이 아니라 문자열입니다. */
const cleanCode = (raw, market) => (market === 'US'
  ? String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12)
  : normalizeCode(raw));

function loadWatchlist(market) {
  const fallback = DEFAULTS[market] ?? DEFAULTS.KR;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY[market]));
    if (!Array.isArray(saved) || saved.length === 0) return fallback;

    // 예전 버전이 거래소 접미사가 붙은 코드(233740AL)를 저장해 뒀을 수 있습니다.
    // 불러올 때 씻어내고 중복을 제거합니다.
    const seen = new Set();
    const cleaned = [];
    for (const item of saved) {
      const code = cleanCode(item?.code, market);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      cleaned.push({ ...item, code });
    }
    return cleaned.length > 0 ? cleaned : fallback;
  } catch {
    return fallback;
  }
}

/** 어디서든 표시할 가격이 하나라도 있는지 */
function hasAnyPrice(live, snapshot, held) {
  return [live?.price, snapshot?.price, held?.price].some((v) => v !== undefined && v !== null);
}

function loadMarket() {
  const saved = localStorage.getItem(MARKET_KEY);
  return saved === 'US' ? 'US' : 'KR';
}

export default function App() {
  const [market, setMarket] = useState(loadMarket);
  const [watchlist, setWatchlist] = useState(() => loadWatchlist(loadMarket()));
  const [selected, setSelected] = useState(() => loadWatchlist(loadMarket())[0]?.code ?? '005930');
  const [snapshot, setSnapshot] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteSlow, setQuoteSlow] = useState(false);
  const [addError, setAddError] = useState(null);
  const [verifying, setVerifying] = useState(false);
  // 겹친 확인 요청 중 마지막 것만 반영합니다
  const verifyToken = useRef(0);
  const [setupError, setSetupError] = useState(null);
  const [rightTab, setRightTab] = useState('book');
  const [version, setVersion] = useState(null);
  const [usProvider, setUsProvider] = useState(null);

  const isUs = market === 'US';
  const tabs = RIGHT_TABS[market] ?? RIGHT_TABS.KR;

  const codes = useMemo(() => watchlist.map((w) => w.code), [watchlist]);
  // 실시간 WebSocket 은 키움 국내주식만 제공합니다.
  // 미국은 15분 지연 REST 이므로 구독하지 않습니다.
  const { connected, ticks, books } = useRealtime(isUs ? [] : codes);

  useEffect(() => {
    localStorage.setItem(STORE_KEY[market], JSON.stringify(watchlist));
  }, [watchlist, market]);

  useEffect(() => {
    localStorage.setItem(MARKET_KEY, market);
  }, [market]);

  /* 시장 전환 — 각 시장의 관심종목으로 갈아탑니다 */
  const switchMarket = useCallback((next) => {
    if (next === market) return;
    const list = loadWatchlist(next);
    setMarket(next);
    setWatchlist(list);
    setSelected(list[0]?.code ?? '');
    setSnapshot(null);
    // 시장에 없는 탭이 선택된 상태로 남으면 패널이 빈 채로 보입니다.
    setRightTab((RIGHT_TABS[next] ?? RIGHT_TABS.KR)[0][0]);
  }, [market]);

  /* 앱 시작 시 키 설정 여부 확인 */
  useEffect(() => {
    api.health()
      .then((h) => {
        setVersion(h.version ?? '구버전');
        if (!h.keyLoaded) setSetupError('키움 앱키가 서버에 설정되지 않았습니다.');
      })
      .catch(() => setSetupError('백엔드 서버에 연결할 수 없습니다.'));

    api.usProvider().then(setUsProvider).catch(() => setUsProvider(null));
  }, []);

  /* 선택 종목 스냅샷 (REST) — 이후 값은 실시간이 덮어씁니다 */
  useEffect(() => {
    if (!selected) { setSnapshot(null); setQuoteLoading(false); setQuoteSlow(false); return undefined; }
    let cancelled = false;

    setSnapshot(null);
    setQuoteLoading(true);
    setQuoteSlow(false);
    // 호출 한도 큐에 걸리면 오래 걸립니다. 그동안 사용자가 빠져나갈 길을 열어둡니다.
    const slowTimer = setTimeout(() => { if (!cancelled) setQuoteSlow(true); }, 8000);
    api.quote(selected, market)
      .then((q) => {
        if (cancelled) return;
        setSnapshot(q);
        // 이름이 비어있던 항목 채우기
        setWatchlist((prev) => prev.map((w) => (w.code === q.code && !w.name ? { ...w, name: q.name } : w)));
      })
      .catch((err) => !cancelled && setSnapshot({ code: selected, error: err.message }))
      .finally(() => {
        clearTimeout(slowTimer);
        if (!cancelled) { setQuoteLoading(false); setQuoteSlow(false); }
      });

    // 초기 호가는 실시간 0D가 곧 채웁니다 (국내만)
    if (!isUs) api.orderbook(selected).catch(() => {});

    return () => { cancelled = true; clearTimeout(slowTimer); };
  }, [selected, market]);

  /* 관심종목 가격 채우기.
     실시간 체결만 기다리면 장이 닫혀 있을 때 계속 비어 있습니다. */
  useEffect(() => {
    let cancelled = false;

    // 순차로 부르면 종목 수만큼 느려집니다.
    // 서버의 토큰 버킷이 호출 한도를 지켜주므로 동시에 보내도 안전합니다.
    Promise.all(codes.map(async (code) => {
      try {
        const q = await api.quote(code, market);
        if (cancelled) return;
        setWatchlist((prev) => prev.map((w) => (
          w.code === q.code
            ? { ...w, name: w.name ?? q.name, price: q.price, changeRate: q.changeRate }
            : w
        )));
      } catch {
        /* 개별 종목 실패는 무시합니다 */
      }
    }));

    return () => { cancelled = true; };
  }, [codes.join(','), market]);

  /**
   * 관심종목 추가. 넣기 전에 시세를 실제로 조회해서 값이 오는지 확인합니다.
   * 검색 결과만 믿으면, 검색 색인에는 있지만 시세가 없는 종목이 통과합니다.
   * 이 조회는 캐시되므로 곧이어 실행되는 스냅샷 조회가 재사용합니다 (호출 증가 없음).
   */
  const addCode = useCallback(async (code, name) => {
    const clean = cleanCode(code, market);
    if (!clean) return false;

    setAddError(null);

    // 이미 있으면 선택만 옮깁니다
    if (watchlist.some((w) => w.code === clean)) {
      setSelected(clean);
      return true;
    }

    const token = ++verifyToken.current;
    setVerifying(true);
    try {
      const q = await api.verify(clean, market);
      if (token !== verifyToken.current) return false; // 더 최근 요청이 있으면 버립니다

      if (!q?.price) {
        setAddError(`${clean} 은 시세를 받을 수 없어 목록에 추가하지 않았습니다.`
          + (isUs ? ' 상장 종목이 아니거나 티커가 다를 수 있습니다.' : ' 종목코드를 확인해 주세요.'));
        return false;
      }
      setWatchlist((prev) => (prev.some((w) => w.code === clean)
        ? prev
        : [...prev, { code: clean, name: name ?? q.name, price: q.price, changeRate: q.changeRate }]));
      setSelected(clean);
      return true;
    } catch (err) {
      if (token === verifyToken.current) {
        setAddError(`${clean} 의 시세 확인에 실패해 추가하지 않았습니다. ${err.message}`);
      }
      return false;
    } finally {
      if (token === verifyToken.current) setVerifying(false);
    }
  }, [market, watchlist, isUs]);

  const removeCode = useCallback((code) => {
    setWatchlist((prev) => {
      const next = prev.filter((w) => w.code !== code);
      // 보고 있던 종목을 지웠으면 선택을 옮깁니다.
      // 이걸 빠뜨리면 사라진 종목의 시세를 계속 조회하며 헤더에 남습니다.
      setSelected((cur) => (cur === code ? (next[0]?.code ?? '') : cur));
      return next;
    });
    setAddError(null);
  }, []);

  /* 표시값 우선순위: 실시간 > 방금 받은 스냅샷 > 관심종목에 이미 있는 값.
     관심종목 값을 마지막 대안으로 두면, 새 시세를 기다리는 동안에도
     헤더가 비지 않습니다. 미국은 호출 한도 큐 때문에 대기가 길어질 수 있습니다. */
  const live = ticks[selected];
  const held = watchlist.find((w) => w.code === selected);
  const pick = (...values) => values.find((v) => v !== undefined && v !== null) ?? null;

  /* 응답은 왔지만 값이 비어 있는 경우 — 없는 티커이거나 거래가 없는 종목입니다.
     '갱신 중' 상태로 방치하면 사용자가 원인을 알 수 없습니다. */
  const emptyQuote = Boolean(
    snapshot && !snapshot.error && !snapshot.price && !quoteLoading && !ticks[selected],
  );
  // 값도 없고 응답도 늦으면 갇힌 상태입니다. 원인 후보와 삭제 경로를 함께 보여줍니다.
  const stuckQuote = Boolean(quoteSlow && !hasAnyPrice(live, snapshot, held));

  const view = {
    name: pick(snapshot?.name, held?.name, selected),
    price: pick(live?.price, snapshot?.price, held?.price),
    change: pick(live?.change, snapshot?.change),
    changeRate: pick(live?.changeRate, snapshot?.changeRate, held?.changeRate),
    volume: pick(live?.volume, snapshot?.volume),
    open: pick(live?.open, snapshot?.open),
    high: pick(live?.high, snapshot?.high),
    low: pick(live?.low, snapshot?.low),
    // 체결강도도 같은 우선순위를 따릅니다: 실시간 > 스냅샷.
    // 관심종목에는 담지 않으므로 대안이 두 개뿐입니다.
    strength: pick(live?.strength, snapshot?.strength),
  };
  const prevClose = view.price !== null && view.change !== null ? view.price - view.change : null;
  const tone = dirClass(view.changeRate ?? 0);

  return (
    <div className={`shell ${isUs ? 'shell--us' : ''}`} data-market={market}>
      <header className="pane pane--top">
        <div className="topbar">
          <h1 className="wordmark">시세 터미널<span>ver {version ?? '…'}</span></h1>

          <div className="market-tabs" role="tablist" aria-label="시장 선택">
            {[['KR', '국내'], ['US', '미국']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={market === id}
                onClick={() => switchMarket(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <StockSearch onPick={addCode} market={market} busy={verifying} />

          <p className="link-status">
            {isUs ? (
              <>
                <span className="dot" />
                15분 지연 · {usProvider?.provider ?? '—'}
              </>
            ) : (
              <>
                <span className={`dot ${connected ? 'live' : ''}`} />
                {connected ? '실시간 연결됨' : '실시간 끊김'}
              </>
            )}
          </p>
        </div>
      </header>

      <aside className="pane pane--watch">
        <Watchlist
          items={watchlist}
          ticks={ticks}
          selected={selected}
          onSelect={setSelected}
          onRemove={removeCode}
          market={market}
        />
      </aside>

      <main className="pane pane--main">
        {!selected ? (
          <p className="notice">
            관심종목이 비어 있습니다. 위 검색창에서 종목을 찾아 추가해 보세요.
            {' '}예: <code>{isUs ? 'AAPL' : '005930'}</code>
            {addError && (
              <>
                <br /><br /><b>{addError}</b>
              </>
            )}
          </p>
        ) : (
        <>
        <div className="quote-head">
          <div className="quote-head__id">
            <span className="quote-head__name">{view.name}</span>
            <span className="quote-head__code">{selected}</span>
            {quoteLoading && <span className="quote-head__loading">갱신 중…</span>}
          </div>

          {snapshot?.error ? (
            <p className="notice" style={{ padding: '8px 0 0' }}>
              시세를 불러오지 못했습니다. {snapshot.error}
              {' '}
              <button type="button" className="link-btn" onClick={() => removeCode(selected)}>
                관심종목에서 삭제
              </button>
            </p>
          ) : (emptyQuote || stuckQuote) ? (
            <p className="notice" style={{ padding: '8px 0 0' }}>
              <b>{selected}</b>{stuckQuote ? ' 의 응답이 늦습니다.' : ' 의 시세를 받을 수 없습니다.'}
              {isUs
                ? ' 상장 종목이 아니거나 티커가 다를 수 있습니다. 비상장 기업은 시세가 없습니다.'
                : ' 거래가 정지되었거나 종목코드가 잘못되었을 수 있습니다.'}
              {' '}
              <button type="button" className="link-btn" onClick={() => removeCode(selected)}>
                관심종목에서 삭제
              </button>
            </p>
          ) : (
            <>
              <div className="quote-head__price">
                <span className={`quote-head__last ${tone}`}>{fmtPrice(view.price, market)}</span>
                <span className={`quote-head__delta ${tone}`}>
                  {fmtPriceSigned(view.change, market)} · {fmtRate(view.changeRate)}
                </span>
              </div>

              <dl className="stat-strip">
                <div><dt>시가</dt><dd>{fmtPrice(view.open, market)}</dd></div>
                <div><dt>고가</dt><dd className="up">{fmtPrice(view.high, market)}</dd></div>
                <div><dt>저가</dt><dd className="down">{fmtPrice(view.low, market)}</dd></div>
                <div><dt>거래량</dt><dd>{fmtVol(view.volume, market)}</dd></div>
              </dl>
            </>
          )}

          {addError && (
            <p className="notice" style={{ padding: '8px 0 0' }}>
              <b>{addError}</b>
              {' '}
              <button type="button" className="link-btn" onClick={() => setAddError(null)}>닫기</button>
            </p>
          )}

          {setupError && !isUs && (
            <p className="notice" style={{ padding: '10px 0 0' }}>
              <b>{setupError}</b> <code>server/.env</code> 를 확인한 뒤 서버를 다시 시작하세요.
            </p>
          )}

          {isUs && usProvider?.provider === 'demo' && (
            <p className="notice" style={{ padding: '10px 0 0' }}>
              미국 시세가 <b>데모(가짜 데이터)</b>입니다. 실제 시세를 보려면
              {' '}<code>server/.env</code> 에 <code>US_PROVIDER=twelvedata</code> 와
              {' '}<code>US_API_KEY</code> 를 설정하세요.
            </p>
          )}
        </div>

        {/* key 에 market 을 넣어 시장 전환 시 차트를 새로 만듭니다.
            색(--up/--down)이 뒤집히고 이전 시장 데이터가 남지 않도록. */}
        <PriceChart key={market} code={selected} market={market} />
        </>
        )}
      </main>

      <aside className="pane pane--book">
        <div className="eyebrow">
          {tabs.length > 1 ? (
            <div className="tabs">
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={rightTab === id}
                  onClick={() => setRightTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <span>{tabs[0]?.[1]}</span>
          )}
        </div>

        {rightTab === 'book' && (
          <OrderBook book={books[selected]} price={view.price} prevClose={prevClose} hideHeader />
        )}
        {rightTab === 'flow' && (
          /* 실시간 체결강도를 넘겨줍니다. REST 스냅샷은 패널이 직접 받고,
             실시간이 있으면 그 값이 이깁니다. */
          <FlowPanel code={selected} liveStrength={live?.strength ?? null} />
        )}
        {rightTab === 'plan' && (
          <TradePlan code={selected} price={view.price} market={market} />
        )}
      </aside>

      {/* 순위는 키움 국내 TR 만 있습니다 */}
      {!isUs && (
        <section className="pane pane--ranks">
          <RankTable onPick={addCode} />
        </section>
      )}
    </div>
  );
}
