import { useEffect, useRef, useState } from 'react';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

/**
 * 실시간 시세 구독.
 * @param {string[]} codes 구독할 종목코드 목록
 * @returns {{connected:boolean, ticks:Record<string,object>, books:Record<string,object>}}
 */
export function useRealtime(codes) {
  const [connected, setConnected] = useState(false);
  const [ticks, setTicks] = useState({});
  const [books, setBooks] = useState({});

  const socketRef = useRef(null);
  const subscribedRef = useRef(new Set());
  const retryRef = useRef(1000);
  const timerRef = useRef(null);
  const closedByUs = useRef(false);

  /* 연결 수립 (마운트당 한 번, 끊기면 백오프 재연결) */
  useEffect(() => {
    closedByUs.current = false;

    const open = () => {
      const ws = new WebSocket(WS_URL);
      socketRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 1000;
        // 재연결이면 서버가 구독을 모르므로 전량 재전송
        const all = [...subscribedRef.current];
        if (all.length) ws.send(JSON.stringify({ action: 'subscribe', codes: all }));
      };

      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'status') { setConnected(Boolean(msg.connected)); return; }

        if (msg.type === 'trade') {
          setTicks((prev) => {
            const before = prev[msg.code];
            // 직전 가격과 비교해 점멸 방향 결정
            const dir = !before || before.price === msg.price
              ? null
              : msg.price > before.price ? 'up' : 'down';
            return { ...prev, [msg.code]: { ...before, ...msg, dir, seq: (before?.seq ?? 0) + 1 } };
          });
        }

        if (msg.type === 'orderbook') {
          setBooks((prev) => ({ ...prev, [msg.code]: { ask: msg.ask, bid: msg.bid } }));
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (closedByUs.current) return;
        timerRef.current = setTimeout(open, retryRef.current);
        retryRef.current = Math.min(retryRef.current * 2, 15000);
      };

      ws.onerror = () => ws.close();
    };

    open();

    return () => {
      closedByUs.current = true;
      clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, []);

  /* codes 변경분만 구독/해지 */
  useEffect(() => {
    const ws = socketRef.current;
    const wanted = new Set(codes);
    const current = subscribedRef.current;

    const toAdd = codes.filter((c) => !current.has(c));
    const toDrop = [...current].filter((c) => !wanted.has(c));

    toAdd.forEach((c) => current.add(c));
    toDrop.forEach((c) => current.delete(c));

    if (ws?.readyState !== WebSocket.OPEN) return;
    if (toAdd.length) ws.send(JSON.stringify({ action: 'subscribe', codes: toAdd }));
    if (toDrop.length) ws.send(JSON.stringify({ action: 'unsubscribe', codes: toDrop }));
  }, [codes.join(',')]);

  return { connected, ticks, books };
}
