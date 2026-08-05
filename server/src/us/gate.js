/**
 * 미국 시세 공급자용 호출 제한 + 캐시.
 *
 * 무료 티어는 분당 호출 수가 매우 적습니다(Twelve Data 기본 8회/분).
 * 화면 한 번 열 때 관심종목 여러 개 + 차트 + 계획을 몰아서 부르므로
 * 아무 장치가 없으면 곧바로 한도 초과가 납니다.
 *
 * 세 가지로 막습니다.
 *   1) 캐시    — 15분 지연 데이터를 매번 다시 받을 이유가 없습니다
 *   2) 중복 제거 — 같은 키로 동시에 들어온 요청은 하나만 실제로 보냅니다
 *   3) 토큰 버킷 — 한도를 넘으면 오류 대신 잠시 기다립니다
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class RollingLimiter {
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

export function createGate({ perMinute = 8 } = {}) {
  const limiter = new RollingLimiter(perMinute);
  const cache = new Map();    // key -> { at, value }
  const inFlight = new Map(); // key -> Promise

  /**
   * @param {number} ttlMs      이 시간 안이면 캐시를 그대로 씁니다
   * @param {number} maxStaleMs 만료됐지만 이 시간 안이면 기다리지 않고
   *                            예전 값을 주고 갱신은 뒤에서 진행합니다.
   *                            15분 지연 데이터라 2분 전 값이 빈 화면보다 낫습니다.
   */
  async function run(key, ttlMs, fn, { maxStaleMs = ttlMs * 10 } = {}) {
    const hit = cache.get(key);
    const age = hit ? Date.now() - hit.at : Infinity;

    if (hit && age < ttlMs) return hit.value;

    if (!inFlight.has(key)) {
      const p = (async () => {
        await limiter.take();
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
    stats: () => ({
      perMinute,
      usedThisMinute: limiter.waiting,
      cached: cache.size,
    }),
    /** 캐시가 만료된 값이라도 있으면 돌려줍니다 (한도 초과 시 대체용) */
    stale: (key) => cache.get(key)?.value ?? null,
  };
}

/** 캐시 유지 시간. 15분 지연 데이터이므로 넉넉히 잡아도 신선도가 같습니다. */
export const TTL = {
  quote: 60_000,          // 1분
  // 일봉·주봉·월봉은 장중에도 거의 바뀌지 않습니다. 길게 잡으면
  // 종목을 오갈 때 차트가 즉시 뜨고 호출 한도도 아낍니다.
  candles: 3_600_000,     // 1시간
  search: 3_600_000,      // 1시간
};
