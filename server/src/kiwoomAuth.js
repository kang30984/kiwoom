import { config } from './config.js';

let cached = null;      // { token, expiresAt }
let inFlight = null;    // 동시에 여러 요청이 토큰을 요구할 때 중복 발급 방지

function parseExpiry(expiresDt) {
  // 키움은 'YYYYMMDDHHmmss' 형태로 만료시각을 줍니다.
  if (typeof expiresDt === 'string' && /^\d{14}$/.test(expiresDt)) {
    const [y, m, d, h, mi, s] = [
      expiresDt.slice(0, 4), expiresDt.slice(4, 6), expiresDt.slice(6, 8),
      expiresDt.slice(8, 10), expiresDt.slice(10, 12), expiresDt.slice(12, 14),
    ].map(Number);
    return new Date(y, m - 1, d, h, mi, s).getTime();
  }
  return Date.now() + 6 * 60 * 60 * 1000; // 파싱 실패 시 6시간
}

async function issue() {
  if (!config.appKey || !config.secretKey) {
    throw new Error('KIWOOM_APP_KEY / KIWOOM_SECRET_KEY 가 .env 에 설정되지 않았습니다.');
  }

  const res = await fetch(`${config.restBase}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: config.appKey,
      secretkey: config.secretKey,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`토큰 발급 실패 (${res.status}): ${body.return_msg ?? JSON.stringify(body)}`);
  }

  const token = body.token ?? body.access_token;
  if (!token) throw new Error(`응답에 토큰이 없습니다: ${JSON.stringify(body)}`);

  // 만료 5분 전에 미리 갱신
  const expiresAt = parseExpiry(body.expires_dt) - 5 * 60 * 1000;
  cached = { token, expiresAt };
  console.log(`[auth] 토큰 발급 완료 (만료 ${new Date(expiresAt).toLocaleString('ko-KR')})`);
  return token;
}

export async function getToken() {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (!inFlight) {
    inFlight = issue().finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function invalidateToken() {
  cached = null;
}
