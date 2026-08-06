/**
 * api-id × URI 짝 찾기 프로브.
 *
 * 키움은 api-id 와 URI 의 짝이 안 맞으면 1504 를 돌려줍니다
 * ("해당 URI에서는 지원하는 API ID가 아닙니다").
 * 이걸 역으로 이용해서, 후보를 전부 찔러보고 1504 가 아닌 것만 골라냅니다.
 *
 * 서버를 띄우지 않고 단독으로 돕니다. server/.env 의 앱키를 그대로 씁니다.
 *
 * ── 사용법 ───────────────────────────────────────────────
 *   cd server
 *   node probe.js ka90013                 # 이 api-id 를 모든 주소에 시도
 *   node probe.js ka90013 ka90005 ka90003 # 여러 개 한 번에
 *   node probe.js --market ka90005        # 시장 단위 TR (종목코드 대신 시장구분 전송)
 *   node probe.js --code 000660 ka90013   # 다른 종목으로
 *
 * ── 결과 읽는 법 ─────────────────────────────────────────
 *   OK        → 짝이 맞고 데이터도 왔습니다. 이걸 .env 에 넣으세요
 *   빈응답    → 짝은 맞습니다. 장 시간이나 파라미터 문제일 수 있습니다
 *   1504      → 짝이 안 맞습니다 (그 주소는 그 api-id 를 안 받음)
 *   그 외     → 짝은 맞고 요청 내용이 틀립니다. 메시지를 읽어보세요
 *
 * OK 가 나오면 응답 필드명과 샘플값까지 찍어줍니다 —
 * 금액 단위(원/천원/백만원)를 여기서 확인할 수 있습니다.
 */

import 'dotenv/config';
import { config } from './src/config.js';
import { getToken } from './src/kiwoomAuth.js';

/* ── 시도할 주소 목록 ───────────────────────────────────────
 * 앞의 4개는 이 저장소가 이미 쓰고 있어 확실한 주소입니다.
 * 나머지는 추측이므로, 문서에서 다른 주소를 보셨으면 여기 추가하세요. */
const PATHS = [
  '/api/dostk/mrkcond',   // 시세 — 호가·체결강도가 여기 있습니다
  '/api/dostk/stkinfo',   // 종목정보
  '/api/dostk/rkinfo',    // 순위정보
  '/api/dostk/chart',     // 차트
  // ↓ 여기부터는 추측입니다
  '/api/dostk/frgnistt',
  '/api/dostk/invstr',
  '/api/dostk/sect',
  '/api/dostk/thme',
  '/api/dostk/shsa',
  '/api/dostk/crdt',
];

const args = process.argv.slice(2);
const isMarket = args.includes('--market');
const codeIdx = args.indexOf('--code');
const code = codeIdx >= 0 ? args[codeIdx + 1] : '005930';
// --code 가 없으면 codeIdx 는 -1 이고, codeIdx + 1 === 0 이 되어
// 첫 api-id 를 실수로 걸러냅니다. 값이 있을 때만 제외합니다.
const skipIdx = codeIdx >= 0 ? codeIdx + 1 : -1;
const apiIds = args.filter((a, i) => !a.startsWith('--') && i !== skipIdx);

if (apiIds.length === 0) {
  console.error('시도할 api-id 를 하나 이상 적어주세요.  예: node probe.js ka90013');
  process.exit(1);
}

if (!config.hasKeys) {
  console.error('server/.env 에 KIWOOM_APP_KEY / KIWOOM_SECRET_KEY 가 없습니다.');
  process.exit(1);
}

const pad = (s, n) => String(s).padEnd(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 시장 단위 TR 과 종목 단위 TR 은 보내는 파라미터가 다릅니다. */
const bodyFor = () => (isMarket
  ? { mrkt_tp: '001', stex_tp: '3' }
  : { stk_cd: code, stex_tp: '3' });

async function tryOne(token, apiId, path) {
  const res = await fetch(`${config.restBase}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      authorization: `Bearer ${token}`,
      'api-id': apiId,
      'cont-yn': 'N',
      'next-key': '',
    },
    body: JSON.stringify(bodyFor()),
  });

  const data = await res.json().catch(() => ({}));
  const rc = Number(data.return_code);
  const msg = String(data.return_msg ?? '');
  const mismatch = msg.includes('1504') || msg.includes('지원하는 API ID가 아닙니다');

  // 응답에서 첫 배열을 찾습니다 (TR 마다 키 이름이 다릅니다)
  let arrayKey = null;
  let rows = [];
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) { arrayKey = k; rows = v; break; }
  }

  return { apiId, path, status: res.status, rc, msg, mismatch, arrayKey, rows, data };
}

function verdict(r) {
  if (r.mismatch) return '1504 짝 안 맞음';
  if (r.rc === 0 && r.rows.length > 0) return '★ OK';
  if (r.rc === 0) return '빈응답 (짝은 맞음)';
  return `rc=${r.rc}`;
}

const token = await getToken();
console.log(`\n서버: ${config.restBase}  (${config.mock ? '모의투자' : '실전'})`);
console.log(`보내는 파라미터: ${JSON.stringify(bodyFor())}\n`);
console.log(`${pad('api-id', 10)}${pad('URI', 24)}${pad('결과', 22)}메시지`);
console.log('─'.repeat(110));

const hits = [];

for (const apiId of apiIds) {
  for (const path of PATHS) {
    let r;
    try {
      r = await tryOne(token, apiId, path);
    } catch (err) {
      console.log(`${pad(apiId, 10)}${pad(path, 24)}${pad('요청 실패', 22)}${err.message}`);
      continue;
    }

    const v = verdict(r);
    // 짝이 안 맞는 건 대부분이라 한 줄로 조용히 넘깁니다
    const note = r.mismatch ? '' : r.msg.slice(0, 60);
    console.log(`${pad(apiId, 10)}${pad(path, 24)}${pad(v, 22)}${note}`);

    if (!r.mismatch && r.rc === 0) hits.push(r);
    await sleep(config.minRequestGapMs); // 호출 한도 회피
  }
}

console.log('─'.repeat(110));

if (hits.length === 0) {
  console.log('\n짝이 맞는 조합이 없습니다.');
  console.log('api-id 가 틀렸거나, 시도할 주소 목록에 정답이 없습니다.');
  console.log('문서에서 api-id 를 다시 확인하고, 주소는 이 파일의 PATHS 배열에 추가하세요.\n');
  process.exit(0);
}

/* 성공한 조합의 응답 구조를 보여줍니다.
   여기서 필드명과 금액 단위를 확인해 pickNum 후보와
   PROGRAM_AMOUNT_UNIT 을 맞출 수 있습니다. */
for (const h of hits) {
  console.log(`\n★ ${h.apiId}  ${h.path}`);
  console.log(`  .env 에 넣을 값:`);
  console.log(`     TR_PROGRAM_STOCK=${h.apiId}`);
  console.log(`     TR_PROGRAM_STOCK_PATH=${h.path}`);
  console.log(`  (체결강도라면 TR_STRENGTH_TIME / _PATH 로 이름만 바꿔 넣으세요)`);

  if (!h.arrayKey) {
    console.log('\n  배열이 없습니다. 단건 응답 필드:');
    for (const [k, v] of Object.entries(h.data)) {
      if (k.startsWith('return_')) continue;
      console.log(`     ${pad(k, 26)}${JSON.stringify(v)}`);
    }
    continue;
  }

  console.log(`\n  배열 키: ${h.arrayKey}  (${h.rows.length}행)`);
  console.log('  첫 행의 필드 — 이름과 값을 보고 무엇이 순매수·금액인지 판단하세요:');
  const first = h.rows[0] ?? {};
  for (const [k, v] of Object.entries(first)) {
    console.log(`     ${pad(k, 26)}${JSON.stringify(v)}`);
  }

  /* 금액 단위 추정을 돕습니다. 순매수 금액은 보통 수량 × 가격 규모입니다.
     자릿수가 그보다 6자리 작으면 백만원 단위입니다. */
  const amtKeys = Object.keys(first).filter((k) => /amt/i.test(k));
  if (amtKeys.length > 0) {
    console.log('\n  금액으로 보이는 필드 (단위 확인용):');
    for (const k of amtKeys) {
      const raw = String(first[k] ?? '').replace(/,/g, '');
      const n = Math.abs(Number(raw));
      const digits = Number.isFinite(n) && n > 0 ? String(Math.round(n)).length : 0;
      const guess = digits >= 10 ? '원 단위로 보입니다 (PROGRAM_AMOUNT_UNIT=1)'
        : digits >= 7 ? '천원 단위일 수 있습니다 (=1000)'
          : '백만원 단위일 수 있습니다 (=1000000)';
      console.log(`     ${pad(k, 26)}${pad(first[k], 18)}${digits}자리 → ${guess}`);
    }
    console.log('  * 추정입니다. 삼성전자 하루 프로그램 순매수는 보통 수백억~수천억 원입니다.');
  }
}

console.log('');
