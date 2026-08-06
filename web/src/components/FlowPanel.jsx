import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api, fmtStrength, fmtNetQty, fmtNetMoney, netLabel, unitLabel,
  exactNetQty, exactNetMoney, fmtAbsQty, exactAbsQty,
} from '../lib/api.js';

/**
 * 수급 패널 — 체결강도 · 프로그램 매매 동향.
 *
 * 두 데이터의 성격이 다릅니다.
 *  - 체결강도는 실시간(0B)으로 들어옵니다. REST 는 초기값과 시간별 추이용이고,
 *    현재값은 실시간이 덮어씁니다 (quote 헤더와 같은 우선순위 규칙).
 *  - 프로그램매매는 집계·지연 데이터입니다. 폴링으로 충분합니다.
 *
 * ── 이 패널이 의도적으로 하지 않는 것 ──────────────────────
 * 해석하지 않습니다. '강한 매수세', '프로그램 순매수 유입' 같은 문구와
 * 상승/하락 색, 화살표를 넣지 않았습니다. 이유는 두 가지입니다.
 *  1) 이 앱의 화면 규칙이 "색은 등락 방향에만" 이고, 수급 지표를 빨강/파랑으로
 *     칠하면 규칙이 깨지는 동시에 방향 신호가 됩니다.
 *  2) 체결강도는 누적 비율이라 후행하고, 프로그램매매는 사전 등록된 바스켓
 *     주문 방식일 뿐 투자 주체(외국인 등)와 1:1 대응하지 않습니다.
 * 대신 산식과 기준일자를 드러내서 사용자가 직접 판단하게 합니다.
 */

/** 폴링 주기. 실제 호출은 서버 캐시가 막습니다 (KR_TTL). */
const POLL = {
  strength: 60_000,  // 현재값은 실시간이 담당하므로 추이만 갱신
  program: 120_000,  // 일자별 집계 — 초 단위로 바뀌지 않습니다
};

/** 탭이 백그라운드면 폴링을 건너뜁니다. */
const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

export function FlowPanel({ code, liveStrength = null }) {
  const [strength, setStrength] = useState(null);
  const [program, setProgram] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const token = useRef(0);

  /* 종목이 바뀌면 반드시 먼저 비웁니다.
     받아온 값으로 덮어쓰기만 하면 요청이 느리거나 실패했을 때 이전 종목의
     수급이 그대로 남습니다 — 차트를 비우는 것과 같은 이유입니다. */
  useEffect(() => {
    setStrength(null);
    setProgram(null);
    setError(null);

    if (!code) return undefined;

    const mine = ++token.current;
    let alive = true;
    const fresh = () => alive && mine === token.current;

    const loadStrength = async () => {
      if (!visible()) return;
      try {
        const d = await api.strength(code);
        if (fresh()) setStrength(d);
      } catch (err) {
        if (fresh()) setError(err.message);
      }
    };

    const loadProgram = async () => {
      if (!visible()) return;
      try {
        const d = await api.program(code);
        if (fresh()) setProgram(d);
      } catch (err) {
        if (fresh()) setError(err.message);
      }
    };

    setLoading(true);
    Promise.all([loadStrength(), loadProgram()]).finally(() => {
      if (fresh()) setLoading(false);
    });

    const t1 = setInterval(loadStrength, POLL.strength);
    const t2 = setInterval(loadProgram, POLL.program);
    // 백그라운드에서 돌아오면 즉시 한 번 갱신합니다.
    const onVisible = () => { if (visible()) { loadStrength(); loadProgram(); } };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearInterval(t1);
      clearInterval(t2);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [code]);

  /* 표시값 우선순위: 실시간 > REST 스냅샷.
     실시간이 붙어 있으면 그 값이 항상 최신입니다. */
  const nowStrength = liveStrength ?? strength?.strength ?? null;
  const trend = strength?.trend ?? [];

  if (!code) return <p className="notice">종목을 선택하세요.</p>;

  return (
    <div className="flow">
      {error && !strength && !program && (
        <p className="notice" style={{ padding: '14px 0' }}>
          수급 데이터를 불러오지 못했습니다. {error}
          <br />
          <span style={{ fontSize: 10 }}>
            api-id 가 문서와 다를 수 있습니다. <code>/api/flow/stats</code> 로 확인하세요.
          </span>
        </p>
      )}

      <StrengthBlock
        value={nowStrength}
        trend={trend}
        thin={strength?.thin}
        live={liveStrength !== null && liveStrength !== undefined}
        loading={loading && !strength}
      />

      <ProgramBlock data={program} loading={loading && !program} />
    </div>
  );
}

/* ── 체결강도 ─────────────────────────────────────────────── */

function StrengthBlock({ value, trend, thin, live, loading }) {
  // 값이 100 에서 얼마나 떨어져 있는지를 위치로만 보여줍니다 (색 없음).
  // 0~200 을 축으로 쓰고 그 밖은 끝에 붙입니다 — 장 초반 400% 같은 값에
  // 스케일을 맞추면 나머지 시간대가 전부 가운데 한 점으로 뭉갭니다.
  const pos = value === null || value === undefined
    ? null
    : Math.min(100, Math.max(0, (value / 200) * 100));

  const extreme = value !== null && value !== undefined && (value > 300 || value < 40);

  return (
    <section className="flow__block">
      <div className="flow__head">
        <h3>체결강도</h3>
        {live && <span className="flow__live">실시간</span>}
      </div>

      {/* 산식을 드러냅니다. 아래 호가 탭의 '매수 62% · 매도 38%' 는
          주문 잔량 비중이고, 이건 성사된 체결의 비율입니다 —
          잔량은 취소되지만 체결은 확정입니다. 완전히 다른 값입니다. */}
      <p className="flow__formula">매수체결 누계 ÷ 매도체결 누계 × 100</p>

      {loading ? (
        <p className="flow__empty">불러오는 중…</p>
      ) : (
        <>
          {/* 라벨을 숫자 옆에 둡니다.
              우측 패널은 overflow:auto 로 스크롤되고 탭 바(.eyebrow)가
              sticky 라서, 스크롤하면 위쪽 제목이 탭 바 밑으로 숨습니다.
              그러면 '80.7%' 라는 숫자만 남아 무슨 값인지 알 수 없습니다.
              제목(h3)은 구조·스크린리더용으로 두고, 화면에서 항상 보이는
              라벨은 여기에 둡니다. */}
          <div className="flow__value">
            <b>{fmtStrength(value)}</b>
            <small>
              체결강도 · 100% = 매수·매도 체결량이 같음
              {live && ' · 실시간'}
            </small>
          </div>

          {pos !== null && (
            <div className="flow__axis" aria-hidden="true">
              <span className="flow__axis-mid" />
              <span className="flow__axis-dot" style={{ left: `${pos}%` }} />
              <em style={{ left: 0 }}>0</em>
              <em style={{ left: '50%' }}>100</em>
              <em style={{ left: '100%' }}>200+</em>
            </div>
          )}

          {(thin || extreme) && (
            <p className="flow__warn">
              누계 표본이 적어 값이 크게 튈 수 있습니다.
              장 초반에는 분모(매도체결 누계)가 작아 몇 건의 체결로도 수백 %가 나옵니다.
            </p>
          )}

          <Sparkline rows={trend} />
        </>
      )}
    </section>
  );
}

/**
 * 시간별 체결강도 추이. 의존성 없이 SVG 로 그립니다.
 * 100 기준선을 함께 그려야 위/아래를 읽을 수 있습니다.
 */
function Sparkline({ rows }) {
  const pts = useMemo(
    () => (rows ?? []).filter((r) => typeof r.strength === 'number'),
    [rows],
  );

  if (pts.length < 2) {
    return <p className="flow__empty">시간별 추이가 없습니다.</p>;
  }

  const W = 260;
  const H = 46;
  const values = pts.map((p) => p.strength);
  // 100 을 항상 축에 포함시킵니다. 빼면 기준선이 화면 밖으로 나갑니다.
  const lo = Math.min(...values, 100);
  const hi = Math.max(...values, 100);
  const span = hi - lo || 1;

  const x = (i) => (i / (pts.length - 1)) * W;
  const y = (v) => H - ((v - lo) / span) * H;

  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.strength).toFixed(1)}`).join(' ');
  const baseY = y(100).toFixed(1);

  return (
    <figure className="flow__spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
        aria-label={`체결강도 추이 ${pts[0].time} ~ ${pts.at(-1).time}`}>
        <line x1="0" x2={W} y1={baseY} y2={baseY} className="flow__spark-base" />
        <path d={path} className="flow__spark-line" />
      </svg>
      <figcaption>
        <span>{pts[0].time}</span>
        <span>100% 기준선</span>
        <span>{pts.at(-1).time}</span>
      </figcaption>
    </figure>
  );
}

/* ── 프로그램 매매 ────────────────────────────────────────── */

function ProgramBlock({ data, loading }) {
  const rows = data?.rows ?? [];
  // 최신이 위로 오게 뒤집습니다 (서버는 과거 → 최신 순으로 줍니다).
  const shown = [...rows].reverse().slice(0, 8);

  /* 대표값은 **값이 실제로 들어 있는** 마지막 행에서 뽑습니다.
     프로그램매매가 없던 날은 필드가 비어 오는데, rows 끝을 그대로 쓰면
     표에는 데이터가 있는데 큰 숫자만 '—' 로 보입니다. */
  const latest = [...rows].reverse().find(
    (r) => r.netQty !== null && r.netQty !== undefined,
  ) ?? null;

  const hasArb = shown.some((r) => r.arbitrageNetQty !== null && r.arbitrageNetQty !== undefined);
  const hasSides = latest?.buyQty !== null && latest?.buyQty !== undefined
    && latest?.sellQty !== null && latest?.sellQty !== undefined;

  /* 프로그램 매매 비중. 거래량이 0 이거나 없으면 계산하지 않습니다 —
     0 으로 나누면 Infinity 가 화면에 그대로 나옵니다. */
  const share = hasSides && latest?.totalVolume
    ? ((latest.buyQty + latest.sellQty) / (latest.totalVolume * 2)) * 100
    : null;

  return (
    <section className="flow__block">
      <div className="flow__head">
        <h3>프로그램 매매</h3>
        {data?.asOf && <span className="flow__asof">기준 {data.asOf}</span>}
      </div>

      {loading ? (
        <p className="flow__empty">불러오는 중…</p>
      ) : (data?.pending && !latest) || rows.length === 0 ? (
        /* '0' 과 '미집계' 는 완전히 다릅니다. 0 으로 채우면 사용자는 중립으로
           읽습니다. 프로그램매매는 장 마감 후 정정되고, 휴장일에는 값이
           갱신되지 않습니다. */
        <p className="flow__empty">
          <b>아직 집계되지 않았습니다.</b>
          {data?.asOf
            ? ` 마지막 집계일은 ${data.asOf} 입니다.`
            : ' 오늘 자료가 아직 없습니다.'}
          <br />
          프로그램매매는 장 마감 후 정정되며, 이 값이 0이라는 뜻은 아닙니다.
        </p>
      ) : (
        <>
          <div className="flow__value">
            <b title={exactNetQty(latest?.netQty)}>{fmtNetQty(latest?.netQty)}</b>
            <small>{netLabel(latest?.netQty)} · {latest?.date ?? '—'}</small>
          </div>

          {/* 오늘 행은 왔지만 값이 비어 있는 상태. 표는 그대로 보여주고
              대표값이 오늘이 아니라는 것만 알립니다 — 지난 값을 오늘 값으로
              읽게 두는 것이 가장 위험합니다. */}
          {data?.todayPending && (
            <p className="flow__warn">
              오늘({data.asOf}) 자료는 아직 집계되지 않았습니다.
              위 숫자는 <b>{latest?.date}</b> 기준입니다.
            </p>
          )}

          <table className="flow__table">
            <thead>
              <tr>
                <th scope="col">일자</th>
                <th scope="col">순매수 수량</th>
                <th scope="col">금액</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.date ?? r.time}>
                  <th scope="row">{(r.date ?? r.time ?? '—').slice(5)}</th>
                  {/* 부호를 살립니다. abs() 를 쓰면 순매도가 순매수로 뒤집혀
                      표시되고, 숫자가 그럴듯해서 눈으로 안 잡힙니다.
                      축약값 옆에 정확한 값을 title 로 답니다. */}
                  <td title={exactNetQty(r.netQty)}>{fmtNetQty(r.netQty)}</td>
                  <td title={exactNetMoney(r.netAmount)}>{fmtNetMoney(r.netAmount)}</td>
                  {/* fmtNetQty/fmtNetMoney 는 null 을 '—', 0 을 '0' 으로
                      구분해서 냅니다. 거래가 없던 날과 순매수 0 은 다릅니다. */}
                </tr>
              ))}
            </tbody>
          </table>

          {/* 매수·매도 규모. 순매수만 보면 '거래가 거의 없었는데 순매수 소액'
              인지 '양쪽 다 대량인데 상계돼 소액' 인지 구분할 수 없습니다. */}
          {hasSides && (
            <dl className="flow__split">
              <div>
                <dt>매수</dt>
                <dd title={exactAbsQty(latest?.buyQty)}>{fmtAbsQty(latest?.buyQty)}</dd>
              </div>
              <div>
                <dt>매도</dt>
                <dd title={exactAbsQty(latest?.sellQty)}>{fmtAbsQty(latest?.sellQty)}</dd>
              </div>
            </dl>
          )}

          {/* 프로그램 매매가 그날 거래량에서 차지한 비중.
              (매수 + 매도) ÷ (거래량 × 2) — 거래량은 매수·매도를 한 번만
              세므로 분모를 2배 해야 같은 기준이 됩니다. */}
          {share !== null && (
            <p className="flow__note">
              이날 거래량의 <b>{share.toFixed(1)}%</b>가 프로그램 매매였습니다
              (매수 {fmtAbsQty(latest.buyQty)} + 매도 {fmtAbsQty(latest.sellQty)} ÷ 거래량 {fmtAbsQty(latest.totalVolume)} × 2).
            </p>
          )}

          {hasArb && (
            <dl className="flow__split">
              <div>
                <dt>차익</dt>
                <dd title={exactNetQty(latest?.arbitrageNetQty)}>{fmtNetQty(latest?.arbitrageNetQty)}</dd>
              </div>
              <div>
                <dt>비차익</dt>
                <dd title={exactNetQty(latest?.nonArbitrageNetQty)}>{fmtNetQty(latest?.nonArbitrageNetQty)}</dd>
              </div>
            </dl>
          )}

          {hasArb && (
            <p className="flow__note">
              차익거래는 선물·현물 가격차를 노린 매매이고 비차익은 바스켓 매매입니다.
              해석이 다르므로 합계만 보면 오독합니다.
            </p>
          )}

          {/* 순매수를 매수−매도로 유도했다는 뜻 — 파싱이 어긋났다는 신호입니다.
              값은 맞지만 원인을 알 수 있게 표시합니다. */}
          {latest?.netSource === 'derived' && (
            <p className="flow__warn">
              순매수 컬럼을 읽지 못해 <b>매수 − 매도</b>로 계산했습니다.
              응답 형식이 바뀌었을 수 있습니다 — <code>?debug=1</code> 로 확인하세요.
            </p>
          )}

          {/* 금액 단위를 밝힙니다. 키움은 TR 마다 원/천원/백만원이 섞여서,
              잘못 잡으면 100만 배 틀린 값이 그럴듯하게 표시됩니다.
              server/.env 의 PROGRAM_AMOUNT_UNIT 으로 맞추세요. */}
          {data?.amountUnit && data.amountUnit !== 1 && (
            <p className="flow__note">
              금액은 원 단위로 환산했습니다 (원본 단위 <b>{unitLabel(data.amountUnit)}</b> 가정).
              실제 응답과 다르면 <code>PROGRAM_AMOUNT_UNIT</code> 을 고치세요.
            </p>
          )}

          {/* 어느 거래소 기준인지 밝힙니다. 넥스트레이드 출범 이후
              KRX 만인지 통합인지에 따라 같은 날짜라도 숫자가 다릅니다.
              요청한 stex_tp 는 표시하지 않습니다 — ka90013 은 이 파라미터를
              받지 않고 항상 KRX 를 주는데, 나란히 보여주면 요청이 실패한
              것처럼 읽힙니다. 값은 응답 JSON 과 ?debug=1 에 그대로 있습니다. */}
          {data?.exchange && (
            <p className="flow__note">
              거래소 범위: <b>{data.exchange}</b> 기준
            </p>
          )}

          <p className="flow__note">
            프로그램매매는 사전 등록된 바스켓 주문 방식입니다.
            투자 주체(외국인 등)와 1:1 로 대응하지 않습니다.
          </p>
        </>
      )}

      {data?.demo && (
        <p className="flow__note flow__note--demo">
          데모 모드 — 이 숫자는 프로그램이 만든 <b>가짜 값</b>입니다.
        </p>
      )}
    </section>
  );
}
