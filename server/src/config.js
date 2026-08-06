import 'dotenv/config';

/**
 * 빌드 식별자. 소스를 갱신했는데 화면이 그대로일 때
 * 어느 코드가 실제로 돌고 있는지 확인하는 용도입니다.
 */
export const APP_VERSION = '31-flow';

/**
 * 환경변수 읽기. **빈 문자열을 '설정하지 않음' 으로 취급합니다.**
 *
 * ?? 만 쓰면 .env 에 `TR_STRENGTH_TIME=` 처럼 값 없이 적어둔 줄이
 * 빈 문자열로 통과해서 api-id 가 '' 가 됩니다. 그러면 모든 호출이
 * 실패하는데, 사용자는 "기본값으로 돌아갈 것" 이라 생각하므로
 * 원인을 찾기 어렵습니다. 주석 처리와 빈 값이 같게 동작해야 합니다.
 */
const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || String(v).trim() === '' ? fallback : String(v).trim();
};

const MOCK = String(process.env.KIWOOM_MOCK ?? 'true') === 'true';

const APP_KEY = process.env.KIWOOM_APP_KEY ?? '';
const SECRET_KEY = process.env.KIWOOM_SECRET_KEY ?? '';
const HAS_KEYS = Boolean(APP_KEY && SECRET_KEY);

/**
 * 데모 모드 판정.
 *
 * DEMO 를 명시하면 그 값을 그대로 씁니다. 지정하지 않았으면 앱키 유무로
 * 판단합니다 — 키가 없으면 데모로 시작합니다.
 *
 * 예전에는 기본값이 false 여서, .env 없이 처음 실행하면 빈 앱키로 키움에
 * 접속을 시도하다 토큰 발급에 실패하고 화면이 비어 있었습니다.
 * 반대로 무조건 true 로 두면 키를 넣어 둔 기존 사용자가 갑자기 가짜 시세를
 * 보게 되므로, 키가 있으면 실제 모드를 유지합니다.
 */
const DEMO = process.env.DEMO !== undefined
  ? String(process.env.DEMO) === 'true'
  : !HAS_KEYS;

export const config = {
  port: Number(process.env.PORT ?? 4000),
  appKey: APP_KEY,
  secretKey: SECRET_KEY,
  mock: MOCK,
  hasKeys: HAS_KEYS,
  // DEMO=true 면 키움에 접속하지 않고 가짜 시세로 화면만 확인합니다.
  demo: DEMO,
  restBase: MOCK ? 'https://mockapi.kiwoom.com' : 'https://api.kiwoom.com',
  wsUrl: MOCK
    ? 'wss://mockapi.kiwoom.com:10000/api/dostk/websocket'
    : 'wss://api.kiwoom.com:10000/api/dostk/websocket',
  // 키움은 초당 호출 제한이 있습니다. 요청 사이 최소 간격(ms).
  minRequestGapMs: Number(process.env.MIN_REQUEST_GAP_MS ?? 250),

  /**
   * 프로그램매매 금액 필드의 단위(원).
   *
   * ⚠ 키움은 TR 마다 금액 단위가 다릅니다 — 원 / 천원 / 백만원이 섞여 있습니다.
   * 잘못 잡으면 100만 배 틀린 값이 화면에 나오는데, 숫자가 크니 오히려
   * 그럴듯해 보여서 눈으로 잡히지 않습니다. 그래서
   *   1) 여기에 가정값을 두고
   *   2) 응답에 amountUnit 을 함께 담아 화면에 표시하고
   *   3) NODE_ENV=development 면 raw 를 같이 내려보냅니다.
   *
   * 실제 응답을 한 번 보고 이 값을 맞추세요. 1 이면 원 단위 그대로입니다.
   */
  programAmountUnit: Number(process.env.PROGRAM_AMOUNT_UNIT ?? 1_000_000),

  /**
   * 프로그램매매 조회의 거래소 범위 (stex_tp).
   *
   * 넥스트레이드 출범 이후 KRX 만 / 통합 집계가 갈립니다. 이걸 지정하지
   * 않으면 어느 범위로 오는지 보장되지 않고, 같은 날짜인데 호출마다
   * 다른 숫자가 올 수 있습니다 — 순매수 부호까지 뒤집힙니다.
   * 이 저장소는 순위 조회에서 이미 '3'(통합)을 명시하고 있습니다.
   *
   *   1 KRX / 2 NXT(넥스트레이드) / 3 통합
   *
   * 빈 값으로 두면 파라미터를 보내지 않습니다 (예전 동작).
   * 응답의 exchange 필드에서 실제로 무엇이 왔는지 확인할 수 있습니다.
   */
  programExchange: env('PROGRAM_STEX_TP', '3'),

  /** 데모에서 '미집계' 상태를 재현합니다 (빈 응답 처리 테스트용). */
  demoFlowEmpty: String(process.env.DEMO_FLOW_EMPTY ?? 'false') === 'true',
};

/**
 * TR 정의를 한곳에 모아둡니다.
 * 문서(https://openapi.kiwoom.com)의 api-id와 다르면 이 파일만 고치면 됩니다.
 */
export const TR = {
  STOCK_INFO:   { path: '/api/dostk/stkinfo',  apiId: 'ka10001' }, // 주식기본정보
  ORDERBOOK:    { path: '/api/dostk/mrkcond',  apiId: 'ka10004' }, // 주식호가
  DAILY_CHART:  { path: '/api/dostk/chart',    apiId: 'ka10081' }, // 일봉
  WEEKLY_CHART: { path: '/api/dostk/chart',    apiId: 'ka10082' }, // 주봉
  MONTHLY_CHART:{ path: '/api/dostk/chart',    apiId: 'ka10083' }, // 월봉
  MINUTE_CHART: { path: '/api/dostk/chart',    apiId: 'ka10080' }, // 분봉
  STOCK_LIST:   { path: '/api/dostk/stkinfo',  apiId: 'ka10099' }, // 종목정보 리스트(마스터)
  VOLUME_RANK:  { path: '/api/dostk/rkinfo',   apiId: 'ka10030' }, // 당일거래량상위
  CHANGE_RANK:  { path: '/api/dostk/rkinfo',   apiId: 'ka10027' }, // 전일대비등락률상위

  /* ── 아래 4개는 검증되지 않았습니다 ─────────────────────────────
   *
   * 체결강도·프로그램매매 TR 의 api-id 와 path 는 문서에서 직접 확인하세요.
   * 기억으로 적은 값이라 틀릴 가능성이 높고, 잘못된 api-id 는
   * return_code != 0 으로 조용히 실패합니다 (README '확인이 필요한 부분').
   *
   * 문서에서 찾을 이름:
   *   체결강도추이 시간별 / 일별
   *   종목별 프로그램매매현황 (또는 종목시간별·일별 프로그램매매추이)
   *   프로그램매매추이 시간별 (시장 단위)
   *
   * 코드를 고치지 않고 server/.env 로 덮어쓸 수 있습니다:
   *   TR_STRENGTH_TIME=ka10046
   *   TR_STRENGTH_TIME_PATH=/api/dostk/mrkcond
   * 데모 모드(DEMO=true)에서는 이 값이 전혀 쓰이지 않으므로,
   * 화면·UI 검증은 api-id 를 맞추기 전에 끝낼 수 있습니다.
   */
  STRENGTH_TIME: {
    path:  env('TR_STRENGTH_TIME_PATH', '/api/dostk/mrkcond'),
    apiId: env('TR_STRENGTH_TIME', 'ka10046'),
    // .env 로 덮어썼으면 '문서를 확인한 값' 으로 보고 경고를 내립니다.
    unverified: env('TR_STRENGTH_TIME', null) === null,
  },
  STRENGTH_DAY: {
    path:  env('TR_STRENGTH_DAY_PATH', '/api/dostk/mrkcond'),
    apiId: env('TR_STRENGTH_DAY', 'ka10047'),
    unverified: env('TR_STRENGTH_DAY', null) === null,
  },
  PROGRAM_STOCK: {
    path:  env('TR_PROGRAM_STOCK_PATH', '/api/dostk/stkinfo'),
    apiId: env('TR_PROGRAM_STOCK', 'ka90013'),
    unverified: env('TR_PROGRAM_STOCK', null) === null,
  },
  PROGRAM_MARKET: {
    path:  env('TR_PROGRAM_MARKET_PATH', '/api/dostk/mrkcond'),
    apiId: env('TR_PROGRAM_MARKET', 'ka90005'),
    unverified: env('TR_PROGRAM_MARKET', null) === null,
  },
};

/** 실시간 FID 도 같은 규칙을 씁니다. realtime.js 가 씁니다. */
export const FID_OVERRIDE = {
  strength: env('FID_STRENGTH', '228'),
  strengthVerified: env('FID_STRENGTH', null) !== null,
};

/**
 * 차트 기본 조회 기간(년). 첫 화면은 일봉 1년을 봅니다.
 * 탭을 옮길수록 더 긴 흐름을 보게 됩니다 (일 1년 → 주 3년 → 월 6년).
 * 키움은 한 번에 주는 행 수가 제한적이라 cont-yn 페이징으로 이어 받습니다.
 */
export const CHART_YEARS = {
  day: 1,
  week: 3,
  month: 6,
};

/** 실시간 등록 타입 */
export const RT_TYPE = {
  TRADE: '0B',     // 주식체결 (현재가/등락률/거래량)
  ORDERBOOK: '0D', // 주식호가잔량
};
