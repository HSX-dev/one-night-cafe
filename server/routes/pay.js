/**
 * 模拟支付 + CG 鉴权。
 *
 * 真实接入时的对应关系：
 *   POST /api/pay/orders              → 服务端下单（调用微信/支付宝统一下单，拿到 prepay 参数）
 *   POST /api/pay/orders/:id/confirm  → 相当于支付平台的异步回调（真实环境由平台带签名回调，这里由收银台模拟触发）
 *   GET  /api/cg/:id                  → 每次取图都在服务端校验解锁记录，原图不在 public 目录、URL 猜不到也拿不到
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';

const ORDER_TTL_MS = 15 * 60 * 1000;

export function payRoutes({ store, stories, config, track }) {
  const r = Router();

  const isUnlocked = (uid, cgId) => Boolean(store.data.unlocks[uid]?.[cgId]);

  r.get('/unlocks', (req, res) => {
    res.json({ unlocks: Object.keys(store.data.unlocks[req.uid] ?? {}) });
  });

  r.post('/pay/orders', (req, res) => {
    const { cgId } = req.body ?? {};
    const cg = stories.get().cgs?.[cgId];
    if (!cg?.paid) return res.status(400).json({ error: 'invalid_item', message: '该 CG 不存在或无需付费' });
    if (isUnlocked(req.uid, cgId)) return res.json({ status: 'unlocked', cgId });

    const order = {
      id: `ord_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
      uid: req.uid,
      cgId,
      title: cg.title,
      amount: cg.price, // 金额以服务端配置为准，不信任前端传值
      currency: cg.currency ?? 'CNY',
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + ORDER_TTL_MS,
    };
    store.mutate((d) => (d.orders[order.id] = order));
    res.json(publicOrder(order));
  });

  r.get('/pay/orders/:id', (req, res) => {
    const order = store.data.orders[req.params.id];
    if (!order || order.uid !== req.uid) return res.status(404).json({ error: 'not_found' });
    res.json(publicOrder(order));
  });

  r.post('/pay/orders/:id/confirm', (req, res) => {
    const order = store.data.orders[req.params.id];
    // 订单只能由下单本人确认（防止拿别人的订单号解锁）
    if (!order || order.uid !== req.uid) return res.status(404).json({ error: 'not_found' });
    if (order.status === 'paid') return res.json({ ...publicOrder(order), unlocked: true }); // 幂等：回调重复到达
    if (order.status !== 'pending') return res.status(409).json({ error: 'order_closed', status: order.status });
    if (Date.now() > order.expiresAt) {
      store.mutate((d) => (d.orders[order.id].status = 'expired'));
      return res.status(410).json({ error: 'order_expired' });
    }

    const { result = 'success', method = 'mock' } = req.body ?? {};
    if (result !== 'success') {
      store.mutate((d) => Object.assign(d.orders[order.id], { status: 'failed', method }));
      track(req, 'pay_fail', { cgId: order.cgId, orderId: order.id });
      return res.status(402).json({ error: 'payment_failed', message: '支付失败（模拟）' });
    }

    store.mutate((d) => {
      Object.assign(d.orders[order.id], { status: 'paid', paidAt: Date.now(), method });
      (d.unlocks[order.uid] ??= {})[order.cgId] = { orderId: order.id, at: Date.now() };
    });
    // 支付成功事件以服务端为准记录（前端埋点可能丢，钱不能丢）
    track(req, 'pay_success', { cgId: order.cgId, orderId: order.id, amount: order.amount });
    res.json({ ...publicOrder(store.data.orders[order.id]), unlocked: true });
  });

  r.get('/cg/:id', (req, res) => {
    const cg = stories.get().cgs?.[req.params.id];
    if (!cg) return res.status(404).json({ error: 'not_found' });
    if (!cg.paid) return res.redirect(`/${cg.image}`);
    if (!isUnlocked(req.uid, req.params.id)) {
      return res.status(403).json({ error: 'locked', message: '该 CG 需要解锁后查看' });
    }
    const file = path.resolve(config.protectedDir, cg.file);
    if (!file.startsWith(config.protectedDir + path.sep)) return res.status(400).json({ error: 'bad_path' });
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(file, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'file_missing' });
    });
  });

  return r;
}

function publicOrder(o) {
  const { uid, ...rest } = o;
  return rest;
}
