import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { Truncated } from './Truncated.jsx';

const KR_CODE_RE = /^[0-9A-Za-z]{6}$/;
const US_TICKER_RE = /^[A-Za-z][A-Za-z0-9.\-]{0,11}$/;

/** 없는 종목 문구. 드롭다운과 알림이 같은 말을 하도록 한 곳에서 만듭니다. */
const notFoundText = (q, market) => (market === 'US'
  ? `'${q}' 은 미국 상장 종목 목록에 없습니다. 비상장 기업이거나 티커가 다를 수 있습니다.`
  : `'${q}' 에 해당하는 종목이 없습니다. 종목명을 다시 확인하거나 6자리 코드를 입력해 주세요.`);

/** 종목명에서 입력한 부분을 강조합니다. */
function highlight(name, query) {
  const q = query.trim();
  if (!q) return name;
  const at = name.toLowerCase().indexOf(q.toLowerCase());
  if (at === -1) return name;
  return [
    name.slice(0, at),
    <mark className="search__hl" key="hl">{name.slice(at, at + q.length)}</mark>,
    name.slice(at + q.length),
  ];
}

/**
 * 종목 검색 콤보박스. 2단계 흐름입니다.
 *   1) 글자를 입력하면 포함하는 종목이 아래에 뜹니다
 *   2) 하나를 고르면 검색란에 종목명이 채워지고, 추가를 누르면 관심종목에 들어갑니다
 * 6자리 코드를 직접 넣으면 종목 마스터와 무관하게 바로 추가됩니다.
 */
export function StockSearch({ onPick, market = 'KR', busy = false }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failMsg, setFailMsg] = useState(null);   // 실제 실패 사유
  const [masterEmpty, setMasterEmpty] = useState(false);
  const [picked, setPicked] = useState(null);   // 고른 종목 {code, name}
  const [searchedFor, setSearchedFor] = useState(null); // 검색을 마친 검색어
  const [notice, setNotice] = useState(null);   // 없는 종목 알림
  const [lookingUp, setLookingUp] = useState(false); // 추가 직전 확인 중

  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  // 목록에서 고른 직후 그 이름으로 재검색하지 않도록, '건너뛸 검색어'를 담습니다.
  // boolean 플래그를 쓰면 setQuery 가 같은 값이어서 effect 가 돌지 않을 때
  // 플래그가 남아 다음 키 입력을 삼켜버립니다.
  const skipQuery = useRef(null);
  const noticeTimer = useRef(null);
  // 알림을 띄운 검색어. 뒤늦게 끝난 디바운스 검색이 드롭다운을 다시 열어
  // 알림을 가리는 것을 막습니다.
  const noticeFor = useRef(null);

  const announce = (text) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  };

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  /* 시장을 바꾸면 입력과 결과를 비웁니다 */
  useEffect(() => {
    skipQuery.current = null;
    noticeFor.current = null;
    setQuery('');
    setItems([]);
    setPicked(null);
    setOpen(false);
    setNotice(null);
    setSearchedFor(null);
    setLookingUp(false);
  }, [market]);

  /* 입력 디바운스. 오래된 응답은 버립니다. */
  useEffect(() => {
    if (skipQuery.current !== null && skipQuery.current === query) {
      skipQuery.current = null;
      return undefined;
    }
    skipQuery.current = null;

    const q = query.trim();
    if (q.length === 0) { setItems([]); setOpen(false); return undefined; }

    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      api.search(q, market)
        .then((res) => {
          if (cancelled) return;
          setItems(res.items);
          setActive(res.items.length > 0 ? 0 : -1);
          setMasterEmpty(Boolean(res.masterEmpty));
          setFailed(false);
          setFailMsg(null);
          setSearchedFor(q);
          if (noticeFor.current !== q) setOpen(true);
        })
        .catch((err) => {
          if (cancelled) return;
          setItems([]);
          setFailed(true);
          setFailMsg(err?.message ?? null);
          setOpen(true);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 120);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, market]);

  /* 바깥 클릭 시 닫기 */
  useEffect(() => {
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  /* 1단계: 목록에서 고르기 — 추가하지 않고 검색란만 채웁니다 */
  const select = (item) => {
    skipQuery.current = item.name;
    setQuery(item.name);
    setPicked(item);
    setItems([]);
    setOpen(false);
    setActive(-1);
    setNotice(null);
    setSearchedFor(null);
    inputRef.current?.focus();
  };

  /* 2단계: 추가 */
  const submit = async () => {
    const q = query.trim();
    if (q.length === 0) return;

    // 고른 종목이 그대로 남아 있으면 그것을 씁니다.
    // onPick 은 시세를 확인하므로 결과를 기다립니다. 실패하면 입력을 유지해
    // 사용자가 무엇을 시도했는지 볼 수 있게 합니다.
    if (picked && picked.name === q) {
      setLookingUp(true);
      try {
        if (await onPick(picked.code, picked.name) !== false) reset();
      } finally {
        setLookingUp(false);
      }
      return;
    }
    // 목록이 열려 있으면 강조된 항목을 고르는 단계로
    if (items.length > 0) {
      select(items[Math.max(0, active)]);
      return;
    }

    // 검색이 아직 안 끝났을 수 있습니다. 빠르게 입력하고 바로 추가를 누르면
    // searchedFor 가 비어 있어 '검색 안 해봤음' 으로 오판되고 그대로 통과합니다.
    // 그래서 판정 전에 검색을 확실히 마칩니다.
    let hits = items;
    let searchFailed = failed;
    let emptyMaster = masterEmpty;

    if (searchedFor !== q) {
      setLookingUp(true);
      try {
        const res = await api.search(q, market);
        hits = res.items;
        emptyMaster = Boolean(res.masterEmpty);
        searchFailed = false;
        setItems(res.items);
        setSearchedFor(q);
        setMasterEmpty(emptyMaster);
        // 후보가 있으면 바로 추가하지 않고 고르는 단계로 보냅니다
        if (res.items.length > 0) {
          setActive(0);
          setOpen(true);
          return;
        }
      } catch (err) {
        searchFailed = true;
        setFailed(true);
        setFailMsg(err?.message ?? null);

        // 호출 한도나 타임아웃이면 시세 확인도 같은 큐에 막힙니다.
        // 10초를 더 기다리게 하지 말고 바로 알려줍니다.
        if (err?.status === 429 || err?.status === 408) {
          setLookingUp(false);
          setOpen(false);
          noticeFor.current = q;
          announce('호출 한도 대기 중입니다. 잠시 후 다시 시도해 주세요.');
          return;
        }
      } finally {
        setLookingUp(false);
      }
    }

    // 직접 입력 허용 조건.
    // 국내는 6자리 코드면 마스터 없이도 통과시킵니다 (마스터가 비어도 쓸 수 있어야 함).
    // 미국은 검색이 '성공했는데 0건' 이면 존재하지 않는 티커이므로 막습니다.
    // 검색 자체가 실패한 경우에는 판단 근거가 없으니 통과시킵니다.
    const searchWorked = !searchFailed && !emptyMaster && hits.length === 0;
    const direct = market === 'US' ? US_TICKER_RE : KR_CODE_RE;
    const allowDirect = direct.test(q) && !(market === 'US' && searchWorked);

    if (allowDirect) {
      setLookingUp(true);
      try {
        if (await onPick(q.toUpperCase(), undefined) !== false) reset();
      } finally {
        setLookingUp(false);
      }
      return;
    }

    // 여기까지 오면 일치하는 종목이 없습니다.
    setOpen(false);
    setActive(-1);
    noticeFor.current = q;   // 이 검색어에 대해서는 드롭다운을 다시 열지 않습니다
    announce(notFoundText(q, market));
  };

  const reset = () => {
    skipQuery.current = '';
    setQuery('');
    setPicked(null);
    setItems([]);
    setOpen(false);
    setActive(-1);
    setNotice(null);
    setSearchedFor(null);
    setFailed(false);
    setFailMsg(null);
  };

  const onChange = (e) => {
    skipQuery.current = null;   // 직접 입력은 항상 검색
    noticeFor.current = null;
    setQuery(e.target.value);
    setPicked(null);   // 직접 고친 텍스트는 선택을 무효화합니다
    setNotice(null);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (items.length === 0 ? -1 : (i + 1) % items.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (items.length === 0 ? -1 : (i - 1 + items.length) % items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  // picked 가 있으면(목록에서 고른 직후) 드롭다운을 띄우지 않습니다.
  // focus 이벤트가 setOpen(true) 로 되돌려 놓아도 여기서 최종 차단됩니다.
  const showMenu = open && !picked && query.trim().length > 0;
  // 현재 검색어로 검색이 실제로 끝났을 때만 '없습니다' 를 말합니다.
  const noMatch = !loading && !failed && !masterEmpty
    && items.length === 0 && searchedFor === query.trim();

  return (
    <div className="search" ref={wrapRef}>
      <div className="search__box">
        <input
          ref={inputRef}
          value={query}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => { if (!picked && items.length > 0) setOpen(true); }}
          placeholder={market === 'US' ? '티커 또는 회사명' : '종목명 또는 코드'}
          aria-label={market === 'US' ? '티커 또는 회사명으로 검색' : '종목명 또는 코드로 검색'}
          role="combobox"
          aria-expanded={showMenu}
          aria-controls="stock-search-list"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `stock-opt-${active}` : undefined}
          autoComplete="off"
        />

        {showMenu && (
          <ul className="search__menu" id="stock-search-list" role="listbox">
            {loading && items.length === 0 && <li className="search__empty">찾는 중…</li>}

            {lookingUp && (
              <li className="search__empty">확인 중…</li>
            )}

            {!loading && !lookingUp && failed && (
              <li className="search__empty">
                {failMsg ?? '검색에 실패했습니다.'}
                {market === 'US'
                  ? ' 티커를 직접 입력해도 됩니다.'
                  : ' 6자리 종목코드로 입력해도 됩니다.'}
              </li>
            )}

            {!loading && !failed && masterEmpty && (
              <li className="search__empty">
                종목 목록이 비어 있습니다. 그 사이에는
                {market === 'US' ? ' 티커를' : ' 6자리 코드를'} 직접 입력해 주세요.
              </li>
            )}

            {noMatch && (
              <li className="search__empty">{notFoundText(query.trim(), market)}</li>
            )}

            {items.length > 0 && (
              <li className="search__count">{items.length}개 종목</li>
            )}

            {items.map((item, i) => (
              <li key={item.code} role="none">
                <button
                  type="button"
                  id={`stock-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`search__item ${i === active ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => select(item)}
                >
                  <Truncated className="search__name" text={item.name}>
                    {highlight(item.name, query)}
                  </Truncated>
                  <span className="search__code num">{item.code}</span>
                  {item.market && <span className="search__market">{item.market}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {notice && !showMenu && (
          <p className="search__notice" role="alert">{notice}</p>
        )}
      </div>

      <button type="button" onClick={submit} disabled={lookingUp || busy}>
        {lookingUp || busy ? '확인 중…' : '추가'}
      </button>
    </div>
  );
}
