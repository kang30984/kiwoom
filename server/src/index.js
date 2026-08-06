import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config, APP_VERSION } from './config.js';
import { quoteRouter } from './routes/quote.js';
import { chartRouter } from './routes/chart.js';
import { rankRouter } from './routes/rank.js';
import { planRouter } from './routes/plan.js';
import { searchRouter } from './routes/search.js';
import { flowRouter } from './routes/flow.js';
import { usRouter } from './routes/us.js';
import { attachRealtime } from './realtime.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173' }));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    demo: config.demo,
    mode: config.demo ? 'demo' : config.mock ? 'mock' : 'real',
    // 데모 모드에서도 실제 키 유무를 그대로 보고합니다.
    // 예전에는 demo 면 무조건 true 라서 키가 없는데 있는 것처럼 보였습니다.
    keyLoaded: config.hasKeys,
  });
});

app.use('/api', quoteRouter, chartRouter, rankRouter, planRouter, searchRouter, flowRouter, usRouter);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error('[api]', err);
  res.status(status).json({ error: err.message ?? '알 수 없는 오류', detail: err.payload ?? null });
});

const server = http.createServer(app);
attachRealtime(server);

server.listen(config.port, () => {
  const label = config.demo ? '데모 — 가짜 시세' : config.mock ? '모의투자' : '실전';
  console.log(`서버 실행 http://localhost:${config.port}  (${label})  ver ${APP_VERSION}`);

  if (config.demo) {
    if (!config.hasKeys) {
      console.log('   앱키가 없어 데모 모드로 시작했습니다. 화면의 숫자는 실제 시세가 아닙니다.');
      console.log('   실제 시세: server/.env 에 KIWOOM_APP_KEY / KIWOOM_SECRET_KEY 를 넣고 DEMO=false 로 바꾸세요.');
    } else {
      console.log('   DEMO=true 이므로 앱키가 있어도 가짜 시세를 씁니다. 실제 시세는 DEMO=false 로 바꾸세요.');
    }
  } else if (!config.hasKeys) {
    // 여기까지 오면 사용자가 DEMO=false 를 직접 지정했는데 키가 없는 상태입니다.
    console.warn('⚠  DEMO=false 인데 앱키가 없습니다. 시세 조회가 모두 실패합니다.');
    console.warn('   server/.env 에 KIWOOM_APP_KEY / KIWOOM_SECRET_KEY 를 넣거나, DEMO=true 로 바꾸세요.');
  }
});
