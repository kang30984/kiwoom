import 'dotenv/config';

/**
 * 빌드 식별자. 소스를 갱신했는데 화면이 그대로일 때
 * 어느 코드가 실제로 돌고 있는지 확인하는 용도입니다.
 */
export const APP_VERSION = '30-held-risk';

const MOCK = String(process.env.KIWOOM_MOCK ?? 'true') === 'true';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  appKey: process.env.KIWOOM_APP_KEY ?? '',
  secretKey: process.env.KIWOOM_SECRET_KEY ?? '',
  mock: MOCK,
  // DEMO=true 면 키움에 접속하지 않고 가짜 시세로 화면만 확인합니다.
  demo: String(process.env.DEMO ?? 'false') === 'true',
  restBase: MOCK ? 'https://mockapi.kiwoom.com' : 'https://api.kiwoom.com',
  wsUrl: MOCK
    ? 'wss://mockapi.kiwoom.com:10000/api/dostk/websocket'
    : 'wss://api.kiwoom.com:10000/api/dostk/websocket',
  // 키움은 초당 호출 제한이 있습니다. 요청 사이 최소 간격(ms).
  minRequestGapMs: Number(process.env.MIN_REQUEST_GAP_MS ?? 250),
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
