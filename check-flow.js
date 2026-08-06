/**
 * 수급 기능 파일이 제대로 복사됐는지 검사합니다.
 *
 * 파일이 17개라 하나씩 눈으로 확인하기 어렵습니다. 각 파일에 있어야 할
 * 표식을 찾아보고 빠진 것만 알려줍니다.
 *
 * ── 사용법 ───────────────────────────────────────────────
 *   저장소 루트(kiwoom 폴더)에서:
 *     node check-flow.js
 *
 * 화면은 새 코드인데 기능이 안 보일 때 가장 먼저 돌려보세요.
 * 서버와 브라우저가 각각 다른 파일을 보고 있으면 증상이 헷갈립니다 —
 * 예를 들어 ver 는 31-flow 인데 탭이 안 보이면 App.jsx 만 옛 버전입니다.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** [파일경로, 있어야 할 표식, 무엇을 담당하는지] */
const CHECKS = [
  ['server/src/cache.js', 'export const krGate', '공용 캐시 계층 (신규 파일)'],
  ['server/src/routes/flow.js', 'debugPayload', '체결강도·프로그램매매 라우트 (신규 파일)'],
  ['web/src/components/FlowPanel.jsx', 'flow__block', '수급 패널 (신규 파일)'],

  ['server/src/config.js', "APP_VERSION = '31-flow'", '버전 표시'],
  ['server/src/config.js', 'FID_OVERRIDE', '체결강도 FID 설정'],
  ['server/src/config.js', 'programAmountUnit', '프로그램매매 금액 단위'],
  ['server/src/index.js', 'flowRouter', '라우트 연결'],
  ['server/src/realtime.js', 'FID_OVERRIDE.strength', '실시간 체결강도'],
  ['server/src/kiwoomRest.js', "m[1].includes('-')", '이중 부호 파싱 수정 ★'],
  ['server/src/kiwoomRest.js', 'export const net', '순매수용 부호 유지 함수'],
  ['server/src/demoFeed.js', 'demoStrengthTrend', '데모 체결강도'],
  ['server/src/demoFeed.js', 'buyAmount', '데모 프로그램매매 (매수/매도)'],
  ['server/src/markets.js', 'hasFlow', '시장별 기능 플래그'],
  ['server/src/routes/quote.js', 'cntr_str', '스냅샷 체결강도'],
  ['server/src/routes/rank.js', 'krGate', '순위 30초 캐시'],
  ['server/src/us/gate.js', "from '../cache.js'", '미국 게이트를 공용 계층으로'],

  ['web/src/App.jsx', 'RIGHT_TABS', '수급 탭 ★'],
  ['web/src/App.jsx', 'FlowPanel', '수급 패널 연결 ★'],
  ['web/src/lib/api.js', 'fmtAbsQty', '절대수량 표시'],
  ['web/src/lib/api.js', 'api.strength', ''],
  ['web/src/styles.css', '.flow__block', '수급 패널 스타일'],
];

/* api.js 의 표식은 객체 프로퍼티라 'api.strength' 로는 안 잡힙니다.
   실제 소스에 있는 형태로 고쳐 씁니다. */
const FIXUP = { 'api.strength': 'strength: (code, period' };

const root = process.cwd();
const cache = new Map();

async function read(file) {
  if (cache.has(file)) return cache.get(file);
  let text = null;
  try {
    text = await readFile(path.join(root, file), 'utf8');
  } catch {
    text = null;
  }
  cache.set(file, text);
  return text;
}

const results = [];
for (const [file, rawMarker, what] of CHECKS) {
  const marker = FIXUP[rawMarker] ?? rawMarker;
  const text = await read(file);
  results.push({
    file,
    what,
    state: text === null ? 'MISSING_FILE' : text.includes(marker) ? 'OK' : 'OLD',
  });
}

/* 같은 파일이 여러 번 검사되므로 파일 단위로 묶어 정리합니다. */
const byFile = new Map();
for (const r of results) {
  const cur = byFile.get(r.file) ?? { file: r.file, state: 'OK', notes: [] };
  if (r.state !== 'OK') {
    cur.state = r.state;
    cur.notes.push(r.what || '내용 확인 필요');
  }
  byFile.set(r.file, cur);
}

const rows = [...byFile.values()];
const bad = rows.filter((r) => r.state !== 'OK');

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n검사 위치: ${root}\n`);
console.log(`${pad('상태', 8)}${pad('파일', 42)}빠진 것`);
console.log('─'.repeat(96));

for (const r of rows) {
  const mark = r.state === 'OK' ? '  ok  ' : r.state === 'MISSING_FILE' ? ' 없음 ' : ' 구버전';
  console.log(`${pad(mark, 8)}${pad(r.file, 42)}${r.notes.join(', ')}`);
}

console.log('─'.repeat(96));

if (bad.length === 0) {
  console.log('\n파일 21개 표식 전부 확인됐습니다.');
  console.log('그래도 화면에 안 보이면 재시작 문제입니다:');
  console.log('  1) server 터미널 종료 후 npm start');
  console.log('  2) web 터미널 종료 후 npm run dev');
  console.log('  3) 브라우저에서 Ctrl+Shift+R (강제 새로고침)\n');
  process.exit(0);
}

console.log(`\n${bad.length}개 파일이 아직 예전 버전입니다. 이 파일들을 다시 복사하세요:\n`);
for (const r of bad) console.log(`  ${r.file}`);

const web = bad.filter((r) => r.file.startsWith('web/'));
const server = bad.filter((r) => r.file.startsWith('server/'));
console.log('');
if (web.length) console.log('web/ 을 고쳤으면 → web 터미널 재시작 + 브라우저 Ctrl+Shift+R');
if (server.length) console.log('server/ 을 고쳤으면 → server 터미널 재시작');
console.log('');
