import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

let server;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onc-test-'));
  const { app } = createApp({ dataDir, llmProvider: 'mock', cookieSecret: 'test-secret', statsToken: '' });
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** 带 Cookie 的简易客户端，模拟一个玩家 */
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) if (c.startsWith('onc_uid=')) cookie = c.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, type, body: type.includes('json') ? await res.json() : await res.text() };
  };
}

test('下发的剧情不包含 AI 人设和付费 CG 原图路径', async () => {
  const req = client();
  const { status, body } = await req('GET', '/api/story');
  assert.equal(status, 200);
  assert.equal(body.meta.start, 'prologue');
  assert.equal(body.characters.wan.persona, undefined);
  assert.equal(body.cgs.cg_night.file, undefined);
  assert.equal(body.cgs.cg_night.paid, true);
});

test('付费 CG：未解锁 403 → 下单 → 支付 → 可访问；其他用户仍然 403', async () => {
  const alice = client();
  const bob = client();
  await alice('GET', '/api/session');
  await bob('GET', '/api/session');

  assert.equal((await alice('GET', '/api/cg/cg_night')).status, 403);
  // 原图不在静态目录里
  assert.equal((await alice('GET', '/cg/cg_night.svg')).status, 404);

  const order = await alice('POST', '/api/pay/orders', { cgId: 'cg_night', amount: 0.01 });
  assert.equal(order.status, 200);
  assert.equal(order.body.amount, 6, '金额以服务端配置为准，忽略前端传值');
  assert.equal(order.body.status, 'pending');

  // Bob 不能确认 Alice 的订单
  assert.equal((await bob('POST', `/api/pay/orders/${order.body.id}/confirm`)).status, 404);

  const paid = await alice('POST', `/api/pay/orders/${order.body.id}/confirm`, { method: 'wechat' });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.status, 'paid');

  // 幂等：重复回调不报错
  assert.equal((await alice('POST', `/api/pay/orders/${order.body.id}/confirm`)).body.status, 'paid');

  const img = await alice('GET', '/api/cg/cg_night');
  assert.equal(img.status, 200);
  assert.match(img.type, /svg/);
  assert.deepEqual((await alice('GET', '/api/session')).body.unlocks, ['cg_night']);

  assert.equal((await bob('GET', '/api/cg/cg_night')).status, 403);
  assert.deepEqual((await bob('GET', '/api/session')).body.unlocks, []);

  // 已解锁再下单直接返回 unlocked
  assert.equal((await alice('POST', '/api/pay/orders', { cgId: 'cg_night' })).body.status, 'unlocked');
});

test('支付失败不会解锁；免费 CG 不能下单', async () => {
  const carol = client();
  const order = await carol('POST', '/api/pay/orders', { cgId: 'cg_night' });
  const fail = await carol('POST', `/api/pay/orders/${order.body.id}/confirm`, { result: 'fail' });
  assert.equal(fail.status, 402);
  assert.equal((await carol('GET', '/api/cg/cg_night')).status, 403);
  assert.equal((await carol('POST', '/api/pay/orders', { cgId: 'cg_rooftop' })).status, 400);
});

test('AI 聊天：服务端维护会话、裁剪好感度、限制轮数', async () => {
  const dave = client();
  assert.equal((await dave('POST', '/api/chat/start', { node: 'meet' })).status, 400);
  const start = await dave('POST', '/api/chat/start', { node: 'candle_chat', affection: 50 });
  assert.equal(start.status, 200);
  const { chatId, rounds } = start.body;
  assert.equal(rounds, 5);

  const r1 = await dave('POST', '/api/chat/message', { chatId, text: '你推荐的咖啡真好喝，豆子是自己烘的吗？' });
  assert.equal(r1.status, 200);
  assert.ok(r1.body.reply.length > 0);
  assert.ok(r1.body.delta > 0);
  assert.equal(r1.body.roundsLeft, 4);

  const r2 = await dave('POST', '/api/chat/message', { chatId, text: '闭嘴吧你' });
  assert.ok(r2.body.delta < 0);

  // 别人拿到 chatId 也用不了
  const eve = client();
  assert.equal((await eve('POST', '/api/chat/message', { chatId, text: 'hi there' })).status, 410);

  for (let i = 0; i < 3; i++) await dave('POST', '/api/chat/message', { chatId, text: '今晚的雨好大啊，你一个人不寂寞吗' });
  assert.equal((await dave('POST', '/api/chat/message', { chatId, text: '还能聊吗' })).status, 409);
  const end = await dave('POST', '/api/chat/end', { chatId });
  assert.ok(Math.abs(end.body.totalDelta) <= 15);
});

test('AI 聊天刷新后继续：沿用已用轮数，伪造的累计好感被裁剪', async () => {
  const frank = client();
  const start = await frank('POST', '/api/chat/start', { node: 'candle_chat', affection: 80, resume: { used: 3, totalDelta: 999 } });
  assert.equal(start.body.used, 3);
  const r = await frank('POST', '/api/chat/message', { chatId: start.body.chatId, text: '谢谢你陪我聊天' });
  assert.equal(r.body.roundsLeft, 1);
  assert.ok(r.body.totalDelta <= 15);
});

test('埋点上报与统计：漏斗、选项比例、付费点击', async () => {
  const p = client();
  const t = Date.now() - 10 * 60 * 1000; // 10 分钟前，超出"进行中"窗口，算流失
  const ev = (playId, event, props, dt = 0) => ({ event, playId, props, ts: t + dt });
  const res = await p('POST', '/api/track', {
    events: [
      ev('play-1', 'game_start', {}),
      ev('play-1', 'node_enter', { node: 'prologue' }, 1),
      ev('play-1', 'node_enter', { node: 'meet' }, 2),
      ev('play-1', 'choice', { node: 'meet', index: 0 }, 3),
      ev('play-1', 'node_enter', { node: 'counter' }, 4),
      ev('play-2', 'game_start', {}),
      ev('play-2', 'node_enter', { node: 'prologue' }, 1),
      ev('play-2', 'node_enter', { node: 'meet' }, 2),
      ev('play-2', 'choice', { node: 'meet', index: 2 }, 3),
      ev('play-2', 'pay_click', { cgId: 'cg_night' }, 4),
      ev('play-2', 'pay_success', { cgId: 'cg_night', amount: 999 }, 5), // 前端伪造的支付成功应被忽略
      { event: 'not_a_real_event', playId: 'play-2', ts: t },
    ],
  });
  assert.equal(res.body.accepted, 10);

  const stats = (await p('GET', '/api/stats')).body;
  const meet = stats.funnel.find((f) => f.node === 'meet');
  assert.ok(meet.arrivals >= 2);
  const counter = stats.funnel.find((f) => f.node === 'counter');
  assert.ok(counter.dropped >= 1);
  const meetChoices = stats.choices.find((c) => c.node === 'meet');
  assert.ok(meetChoices.options[0].count >= 1 && meetChoices.options[2].count >= 1);
  assert.ok(stats.pay.clicks >= 1);
  assert.ok(stats.pay.revenue < 999, '前端伪造的 pay_success 不计入收入');
});

test('剧情 JSON 写错时返回可读的错误列表', async () => {
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onc-bad-'));
  const storyFile = path.join(badDir, 'story.json');
  fs.writeFileSync(storyFile, JSON.stringify({ meta: { start: 'a' }, nodes: { a: { next: 'nowhere' } } }));
  const { app } = createApp({ dataDir: badDir, storyFile, llmProvider: 'mock', cookieSecret: 'x' });
  const srv = await new Promise((r) => {
    const s = app.listen(0, () => r(s));
  });
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/story`);
  const body = await res.json();
  srv.close();
  fs.rmSync(badDir, { recursive: true, force: true });
  assert.equal(res.status, 500);
  assert.equal(body.error, 'story_invalid');
  assert.ok(body.details.some((d) => d.includes('nowhere')));
});
