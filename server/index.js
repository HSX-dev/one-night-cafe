/**
 * 《一夜咖啡馆》服务端
 *  - 静态资源（前端无构建步骤，ES Modules 直出）
 *  - 剧情下发与热更新
 *  - 匿名用户身份（签名 Cookie）
 *  - 模拟支付 / CG 解锁鉴权
 *  - AI 自由聊天
 *  - 埋点收集与统计
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { loadConfig } from './config.js';
import { JsonStore, EventLog } from './store.js';
import { createStoryLoader, StoryError } from './story.js';
import { createLLM } from './llm/index.js';
import { computeStats, TRACKED_EVENTS } from './stats.js';
import { payRoutes } from './routes/pay.js';
import { chatRoutes } from './routes/chat.js';

const UID_COOKIE = 'onc_uid';

export function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const store = new JsonStore(path.join(config.dataDir, 'db.json'), { users: {}, orders: {}, unlocks: {} });
  const events = new EventLog(path.join(config.dataDir, 'events.jsonl'));
  const stories = createStoryLoader(config.storyFile);
  const llm = overrides.llm ?? createLLM(config.llm);

  /** 服务端产生的事件（支付成功等）直接写日志 */
  const track = (req, event, props = {}) => {
    const { playId, ...rest } = props;
    events.append([{ event, uid: req.uid, playId: playId ?? req.get('x-play-id') ?? null, props: rest, ts: Date.now(), src: 'server' }]);
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // ── 静态资源 ──
  app.use(
    express.static(config.publicDir, {
      setHeaders(res, file) {
        // HTML/JS/CSS 每次协商缓存，保证改动立即生效；图片缓存 1 天
        if (/\.(html|js|css)$/.test(file)) res.set('Cache-Control', 'no-cache');
        else res.set('Cache-Control', 'public, max-age=86400');
      },
    }),
  );

  const api = express.Router();
  api.use(express.json({ limit: '64kb', type: ['application/json', 'text/plain'] }));
  api.use(cookieParser(config.cookieSecret));

  // ── 匿名身份：签名 Cookie，前端无法伪造他人 uid ──
  api.use((req, res, next) => {
    let uid = req.signedCookies?.[UID_COOKIE];
    if (!uid || !store.data.users[uid]) {
      uid = uid && /^[0-9a-f-]{36}$/.test(uid) ? uid : crypto.randomUUID();
      store.mutate((d) => (d.users[uid] = { createdAt: Date.now() }));
    }
    res.cookie(UID_COOKIE, uid, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: 365 * 24 * 3600 * 1000,
    });
    req.uid = uid;
    next();
  });

  api.get('/health', (req, res) => res.json({ ok: true }));

  api.get('/session', (req, res) => {
    res.json({
      uid: req.uid.slice(0, 8),
      unlocks: Object.keys(store.data.unlocks[req.uid] ?? {}),
      llm: { provider: llm.name, model: llm.model },
    });
  });

  api.get('/story', (req, res, next) => {
    try {
      const s = stories.load();
      res.set('ETag', s.etag);
      res.set('Cache-Control', 'no-cache');
      if (req.get('if-none-match') === s.etag) return res.status(304).end();
      res.type('json').send(s.publicJson);
    } catch (e) {
      next(e);
    }
  });

  // ── 埋点 ──
  api.post('/track', (req, res) => {
    const list = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [];
    const now = Date.now();
    const rows = [];
    for (const e of list) {
      if (!TRACKED_EVENTS.includes(e?.event)) continue;
      // pay_success 只认服务端记录，忽略前端上报，避免被刷
      if (e.event === 'pay_success') continue;
      const props = e.props && typeof e.props === 'object' ? e.props : {};
      if (JSON.stringify(props).length > 2000) continue;
      rows.push({
        event: e.event,
        uid: req.uid,
        playId: typeof e.playId === 'string' ? e.playId.slice(0, 64) : null,
        props,
        ts: Number.isFinite(e.ts) && Math.abs(now - e.ts) < 24 * 3600 * 1000 ? e.ts : now,
      });
    }
    events.append(rows);
    res.json({ accepted: rows.length });
  });

  api.get('/stats', (req, res) => {
    if (config.statsToken && req.query.token !== config.statsToken) return res.status(401).json({ error: 'unauthorized' });
    res.json(computeStats(events.readAll(), stories.get()));
  });

  api.use(payRoutes({ store, stories, config, track }));
  api.use(chatRoutes({ stories, llm, config, track }));

  api.use((req, res) => res.status(404).json({ error: 'not_found' }));
  api.use((err, req, res, _next) => {
    if (err instanceof StoryError) return res.status(500).json({ error: 'story_invalid', message: err.message, details: err.errors });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error('[api]', err);
    res.status(500).json({ error: 'internal', message: '服务器开小差了' });
  });

  app.use('/api', api);
  return { app, config, store, events, llm };
}

// 直接运行时启动服务
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { app, config, llm } = createApp();
  app.listen(config.port, () => {
    console.log(`\n☕ 一夜咖啡馆 已启动：http://localhost:${config.port}`);
    console.log(`   统计页：http://localhost:${config.port}/stats.html${config.statsToken ? '?token=***' : ''}`);
    console.log(`   AI 聊天：${llm.name === 'anthropic' ? `Claude（${llm.model}）` : '离线规则回复（未配置 ANTHROPIC_API_KEY）'}\n`);
  });
}
