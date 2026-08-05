import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 말줄임(...)으로 잘린 텍스트에 마우스를 올리면 전체를 보여줍니다.
 *
 * 툴팁은 position: fixed 로 띄웁니다. 관심종목 패널과 검색 드롭다운은
 * overflow: auto 라서, 안쪽에 절대배치하면 경계에서 잘립니다.
 *
 * @param {string} text        전체 텍스트 (툴팁 내용)
 * @param {React.ReactNode} children 화면에 그릴 내용 (강조 표시 등). 없으면 text 를 씁니다.
 */
export function Truncated({ text, className, children }) {
  const ref = useRef(null);
  const [tip, setTip] = useState(null);

  const hide = useCallback(() => setTip(null), []);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 잘리지 않았으면 툴팁이 불필요합니다 (같은 내용을 두 번 보여줄 뿐)
    if (el.scrollWidth <= el.clientWidth + 1) return;

    const r = el.getBoundingClientRect();
    const MAX = 280;
    // 오른쪽 화면 밖으로 나가지 않게 당겨옵니다
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MAX - 8));
    setTip({ left, top: r.bottom + 4 });
  }, []);

  /* 스크롤·리사이즈 중에는 좌표가 어긋나므로 닫습니다 */
  useEffect(() => {
    if (!tip) return undefined;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [tip, hide]);

  return (
    <>
      <span
        ref={ref}
        className={className}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        /* 커스텀 툴팁이 안 뜨는 환경(터치 등)을 위한 대비 */
        title={text}
      >
        {children ?? text}
      </span>

      {tip && (
        <span className="tip" role="tooltip" style={{ left: tip.left, top: tip.top }}>
          {text}
        </span>
      )}
    </>
  );
}
