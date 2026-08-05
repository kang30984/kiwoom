import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config, APP_VERSION } from './config.js';
import { quoteRouter } from './routes/quote.js';
import { chartRouter } from './routes/chart.js';
import { rankRouter } from './routes/rank.js';
import { planRouter } from './routes/plan.js';
import { searchRouter } from './routes/search.js';
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
    keyLoaded: config.demo || Boolean(config.appKey),
  });
});

app.use('/api', quoteRouter, chartRouter, rankRouter, planRouter, searchRouter, usRouter);

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
  if (config.demo) console.log('   실제 시세를 보려면 server/.env 에서 DEMO=false 로 바꾸고 앱키를 넣으세요.');
  else if (!config.appKey) console.warn('⚠  .env 에 KIWOOM_APP_KEY / KIWOOM_SECRET_KEY 를 넣어주세요.');
});
