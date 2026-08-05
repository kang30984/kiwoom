import { TR, config } from './config.js';
import { callTr, firstArray, normalizeCode } from './kiwoomRest.js';
import { demoUniverse } from './demoFeed.js';

/**
 * 종목 마스터(코드 ↔ 이름 목록)를 한 번 받아 캐시합니다.
 * 종목명 검색을 매 입력마다 API로 보내면 호출 한도에 걸리므로,
 * 목록을 메모리에 두고 로컬에서 찾습니다.
 */

const TTL_MS = 12 * 60 * 60 * 1000; // 마스터는 하루 한 번이면 충분합니다
let cache = null;   // { at: number, items: Array<{code,name,market}> }
let inFlight = null;

/** 응답 필드명이 문서 개정으로 바뀌어도 견디도록 여러 후보를 훑습니다. */
function pick(row, keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return String(row[k]).trim();
    }
  }
  return '';
}

function normalizeRows(rows, market) {
  const out = [];
  for (const row of rows) {
    const code = normalizeCode(pick(row, ['code', 'stk_cd', 'shrn_iscd', 'isu_srt_cd']));
    const name = pick(row, ['name', 'stk_nm', 'hts_kor_isnm', 'isu_abbrv']);
    if (!code || !name) continue;
    out.push({ code, name, market });
  }
  return out;
}

async function fetchMaster() {
  if (config.demo) {
    return demoUniverse().map((s) => ({ code: s.code, name: s.name, market: '데모' }));
  }

  const markets = [
    ['0', '코스피'],
    ['10', '코스닥'],
  ];

  const items = [];
  for (const [mrktTp, label] of markets) {
    try {
      const { data } = await callTr(TR.STOCK_LIST, { mrkt_tp: mrktTp });
      items.push(...normalizeRows(firstArray(data), label));
    } catch (err) {
      console.warn(`[master] ${label} 목록을 받지 못했습니다: ${err.message}`);
    }
  }

  // 중복 코드 제거 (양 시장에 같은 코드가 오는 경우 방지)
  const seen = new Set();
  const unique = items.filter((s) => (seen.has(s.code) ? false : seen.add(s.code)));

  if (unique.length === 0) {
    // 요청은 성공했는데 결과가 비었다면 api-id 나 필드명이 어긋난 것입니다.
    console.warn('[master] 종목 목록이 비어 있습니다.');
    console.warn('         config.js 의 STOCK_LIST api-id(ka10099)와');
    console.warn('         stockMaster.js 의 필드명 후보(code/stk_cd, name/stk_nm)를 문서와 대조하세요.');
  }
  return unique;
}

export async function getMaster() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.items;
  if (!inFlight) {
    inFlight = fetchMaster()
      .then((items) => {
        cache = { at: Date.now(), items };
        console.log(`[master] 종목 ${items.length}개 캐시`);
        return items;
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** 검색용 정규화 — 공백 제거, 영문 소문자화 */
const norm = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

/**
 * 일치도 점수. 낮을수록 위에 옵니다.
 * 코드 완전일치 → 이름 완전일치 → 이름 앞부분 → 코드 앞부분 → 이름 포함
 */
function score(item, q) {
  const name = norm(item.name);
  const code = norm(item.code);
  if (code === q) return 0;
  if (name === q) return 1;
  if (name.startsWith(q)) return 2;
  if (code.startsWith(q)) return 3;
  if (name.includes(q)) return 4;
  return null;
}

export async function searchStocks(query, limit = 12) {
  const q = norm(query);
  if (q.length === 0) return { items: [], masterEmpty: false };

  const master = await getMaster();
  if (master.length === 0) return { items: [], masterEmpty: true };

  const hits = [];
  for (const item of master) {
    const s = score(item, q);
    if (s === null) continue;
    hits.push({ ...item, _score: s });
  }

  hits.sort((a, b) => (
    a._score - b._score
    // 같은 점수면 이름이 짧은 쪽이 대개 본주입니다 (레버리지·인버스 ETF 뒤로)
    || a.name.length - b.name.length
    || a.name.localeCompare(b.name, 'ko')
  ));

  return {
    items: hits.slice(0, limit).map(({ _score, ...rest }) => rest),
    masterEmpty: false,
  };
}

export function masterStatus() {
  return {
    cached: Boolean(cache),
    count: cache?.items.length ?? 0,
    ageMs: cache ? Date.now() - cache.at : null,
  };
}
