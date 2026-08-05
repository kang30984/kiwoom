import { WebSocketServer, WebSocket } from 'ws';
import { config, RT_TYPE } from './config.js';
import { getToken } from './kiwoomAuth.js';
import { startDemoFeed } from './demoFeed.js';

/**
 * 키움 실시간 FID 번호. (0B 주식체결 / 0D 주식호가잔량)
 * 문서의 FID 표와 다르면 여기만 고치세요.
 */
const FID = {
  price: '10',       // 현재가
  change: '11',      // 전일대비
  changeRate: '12',  // 등락율
  cumVolume: '13',   // 누적거래량
  time: '20',        // 체결시간
  open: '16',
  high: '17',
  low: '18',
};

const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
const toAbs = (v) => { const n = toNum(v); return n === null ? null : Math.abs(n); };

/** 0D 호가잔량: 매도호가 41~50, 매수호가 51~60, 매도잔량 61~70, 매수잔량 71~80 */
function parseRealtimeOrderbook(values) {
  const ask = [];
  const bid = [];
  for (let i = 0; i < 10; i += 1) {
    ask.push({ level: i + 1, price: toAbs(values[String(41 + i)]), qty: toAbs(values[String(61 + i)]) });
    bid.push({ level: i + 1, price: toAbs(values[String(51 + i)]), qty: toAbs(values[String(71 + i)]) });
  }
  return { ask: ask.filter((r) => r.price), bid: bid.filter((r) => r.price) };
}

export function attachRealtime(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  /** code → Set<browser socket> */
  const subscribers = new Map();
  let upstream = null;
  let upstreamReady = false;
  let reconnectDelay = 1000;
  let reconnectTimer = null;

  const broadcastStatus = () => {
    const msg = JSON.stringify({ type: 'status', connected: upstreamReady });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };

  const sendUpstream = (obj) => {
    if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(obj));
  };

  const register = (codes) => {
    if (config.demo || !upstreamReady || codes.length === 0) return;
    sendUpstream({
      trnm: 'REG',
      grp_no: '1',
      refresh: '1', // 기존 등록 유지
      data: [{ item: codes, type: [RT_TYPE.TRADE, RT_TYPE.ORDERBOOK] }],
    });
  };

  const unregister = (codes) => {
    if (config.demo || !upstreamReady || codes.length === 0) return;
    sendUpstream({
      trnm: 'REMOVE',
      grp_no: '1',
      data: [{ item: codes, type: [RT_TYPE.TRADE, RT_TYPE.ORDERBOOK] }],
    });
  };

  const fanout = (code, payload) => {
    const targets = subscribers.get(code);
    if (!targets) return;
    const msg = JSON.stringify(payload);
    for (const client of targets) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };

  /* ── 키움 업스트림 연결 ──────────────────────────────────── */
  async function connectUpstream() {
    clearTimeout(reconnectTimer);
    let token;
    try {
      token = await getToken();
    } catch (err) {
      console.error('[rt] 토큰 발급 실패, 재시도 예약:', err.message);
      scheduleReconnect();
      return;
    }

    console.log('[rt] 키움 실시간 연결 시도…');
    upstream = new WebSocket(config.wsUrl);

    upstream.on('open', () => {
      sendUpstream({ trnm: 'LOGIN', token });
    });

    upstream.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }

      // 키움이 보내는 PING은 그대로 되돌려줘야 연결이 유지됩니다.
      if (msg.trnm === 'PING') { sendUpstream(msg); return; }

      if (msg.trnm === 'LOGIN') {
        if (Number(msg.return_code) === 0) {
          upstreamReady = true;
          reconnectDelay = 1000;
          console.log('[rt] 로그인 성공');
          broadcastStatus();
          register([...subscribers.keys()]); // 끊긴 사이 쌓인 구독 복구
        } else {
          console.error('[rt] 로그인 실패:', msg.return_msg);
          upstream.close();
        }
        return;
      }

      if (msg.trnm !== 'REAL' || !Array.isArray(msg.data)) return;

      for (const item of msg.data) {
        const code = String(item.item ?? '').trim();
        const values = item.values ?? {};
        if (!code) continue;

        if (item.type === RT_TYPE.TRADE) {
          fanout(code, {
            type: 'trade',
            code,
            price: toAbs(values[FID.price]),
            change: toNum(values[FID.change]),
            changeRate: toNum(values[FID.changeRate]),
            volume: toAbs(values[FID.cumVolume]),
            open: toAbs(values[FID.open]),
            high: toAbs(values[FID.high]),
            low: toAbs(values[FID.low]),
            time: values[FID.time] ?? null,
          });
        } else if (item.type === RT_TYPE.ORDERBOOK) {
          fanout(code, { type: 'orderbook', code, ...parseRealtimeOrderbook(values) });
        }
      }
    });

    upstream.on('close', () => {
      upstreamReady = false;
      broadcastStatus();
      console.warn('[rt] 업스트림 연결 종료');
      scheduleReconnect();
    });

    upstream.on('error', (err) => console.error('[rt] 업스트림 오류:', err.message));
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectUpstream, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000); // 지수 백오프
  }

  /* ── 브라우저 클라이언트 ─────────────────────────────────── */
  wss.on('connection', (client) => {
    client.mine = new Set();
    client.send(JSON.stringify({ type: 'status', connected: upstreamReady }));

    client.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      const codes = (msg.codes ?? []).map((c) => String(c).trim()).filter(Boolean);

      if (msg.action === 'subscribe') {
        const fresh = [];
        for (const code of codes) {
          if (!subscribers.has(code)) { subscribers.set(code, new Set()); fresh.push(code); }
          subscribers.get(code).add(client);
          client.mine.add(code);
        }
        register(fresh); // 아무도 안 보던 종목만 새로 등록
      }

      if (msg.action === 'unsubscribe') {
        release(client, codes);
      }
    });

    client.on('close', () => release(client, [...client.mine]));
  });

  function release(client, codes) {
    const dropped = [];
    for (const code of codes) {
      const set = subscribers.get(code);
      if (!set) continue;
      set.delete(client);
      client.mine.delete(code);
      if (set.size === 0) { subscribers.delete(code); dropped.push(code); }
    }
    unregister(dropped); // 보는 사람이 아무도 없어진 종목만 해지
  }

  if (config.demo) {
    // 키움에 접속하지 않고 가짜 피드를 구독자에게 흘려보냅니다.
    upstreamReady = true;
    startDemoFeed(
      (event) => fanout(event.code, event),
      () => [...subscribers.keys()],
    );
    broadcastStatus();
  } else {
    connectUpstream();
  }

  return wss;
}
