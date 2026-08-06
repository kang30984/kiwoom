/**
 * 공용 캐시 + 중복제거 + 호출 한도 계층.
 *
 * 원래 us/gate.js 안에만 있던 것을 시장 무관한 부분으로 끌어냈습니다.
 * 국내 경로에는 kiwoomRest.js 의 250ms 직렬 큐밖에 없어서, 폴링이 필요한
 * 기능(체결강도·프로그램매매)을 붙이면 같은 큐를 쓰는 차트 조회까지 밀립니다.
 *
 * 세 가지를 합니다.
 *   1) 캐시     — TTL 안이면 다시 부르지 않습니다
 *   2) 중복 제거 — 같은 키로 동시에 들어온 요청은 하나만 실제로 보냅니다
 *   3) 호출 한도 — perMinute 를 주면 초과분을 오류 대신 대기시킵니다
 *
 * 국내는 perMinute 를 주지 않습니다. kiwoomRest.callTr 이 이미 모든 호출을
 * 250ms 간격으로 직렬화하므로 여기서 또 세면 이중 제한이 됩니다.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RollingLimiter {
  constructor(perMinute) {
    this.perMinute = Math.max(1, perMinute);
    this.stamps = [];
    this.chain = Promise.resolve();
  }

  /** 순서를 지켜 한 자리를 확보합니다. */
  take() {
    this.chain = this.chain.then(async () => {
      for (;;) {
        const now = Date.now();
        this.stamps = this.stamps.filter((t) => now - t < 60_000);
        if (this.stamps.length < this.perMinute) {
          this.stamps.push(now);
          return;
        }
        // 가장 오래된 호출이 60초 창을 벗어날 때까지 대기
        await sleep(60_000 - (now - this.stamps[0]) + 60);
      }
    });
    return this.chain;
  }

  get waiting() {
    const now = Date.now();
    return this.stamps.filter((t) => now - t < 60_000).length;
  }
}

/**
 * @param {object}  opts
 * @param {number} [opts.perMinute] 분당 호출 상한. 생략하면 제한하지 않습니다.
 * @param {string} [opts.label]     stats() 에 찍히는 이름
 */
export function createGate({ perMinute = 0, label = 'gate' } = {}) {
  const limiter = perMinute > 0 ? new RollingLimiter(perMinute) : null;
  const cache = new Map();    // key -> { at, value }
  const inFlight = new Map(); // key -> Promise

  /**
   * @param {string}  key
   * @param {number}  ttlMs      이 시간 안이면 캐시를 그대로 씁니다
   * @param {Function} fn        실제 호출
   * @param {number} [opts.maxStaleMs] 만료됐지만 이 시간 안이면 기다리지 않고
   *                            예전 값을 주고 갱신은 뒤에서 진행합니다.
   */
  async function run(key, ttlMs, fn, { maxStaleMs = ttlMs * 10 } = {}) {
    const hit = cache.get(key);
    const age = hit ? Date.now() - hit.at : Infinity;

    if (hit && age < ttlMs) return hit.value;

    if (!inFlight.has(key)) {
      const p = (async () => {
        if (limiter) await limiter.take();
        const value = await fn();
        cache.set(key, { at: Date.now(), value });
        return value;
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, p);
    }
    const pending = inFlight.get(key);

    // 낡았지만 쓸 만한 값이 있으면 즉시 돌려줍니다 (stale-while-revalidate).
    // 이게 없으면 호출 한도 큐에 걸린 동안 화면이 비어 있습니다.
    if (hit && age < maxStaleMs) {
      pending.catch(() => {}); // 뒤에서 실패해도 조용히
      return hit.value;
    }

    return pending;
  }

  return {
    run,
    label,
    stats: () => ({
      label,
      perMinute: perMinute || null,
      usedThisMinute: limiter ? limiter.waiting : null,
      cached: cache.size,
    }),
    /** 캐시가 만료된 값이라도 있으면 돌려줍니다 (한도 초과 시 대체용) */
    stale: (key) => cache.get(key)?.value ?? null,
    /** 테스트·디버깅용 */
    clear: () => cache.clear(),
  };
}

/**
 * 국내(키움) 경로 공용 게이트.
 *
 * perMinute 를 주지 않는 이유는 위 주석 참고 — callTr 이 이미 직렬화합니다.
 * 여기서 막는 건 "같은 것을 반복해서 부르는 것" 입니다.
 */
export const krGate = createGate({ label: 'kr' });

/**
 * 국내 캐시 유지 시간.
 *
 * 체결강도는 실시간(0B)으로도 들어오므로 REST 는 초기값·추이용입니다.
 * 프로그램매매는 집계·공시 데이터라 초 단위로 바뀌지 않습니다.
 */
export const KR_TTL = {
  rank: 30_000,           // README 의 "순위 30초 캐시" 항목
  strength: 15_000,       // 스냅샷
  strengthTrend: 60_000,  // 시간별 추이
  program: 60_000,        // 종목별 프로그램매매
  programMarket: 60_000,  // 시장 전체 프로그램매매
};
