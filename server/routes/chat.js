/**
 * AI 自由聊天。会话状态（历史、剩余轮数、累计好感变化）保存在服务端：
 *  - 前端拿不到也改不了历史（防止伪造 assistant 消息做 prompt 注入）
 *  - 单轮 ±5、单段聊天累计 ±maxAffection 的上限在服务端裁剪
 */
import crypto from 'node:crypto';
import { Router } from 'express';

const HISTORY_LIMIT = 20; // 最多带最近 10 轮上下文

export function chatRoutes({ stories, llm, config, track }) {
  const r = Router();
  const sessions = new Map();
  const rate = new Map(); // uid → 最近一分钟的请求时间戳

  // 定期清理过期会话
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.updatedAt > config.chat.sessionTtlMs) sessions.delete(id);
  }, 60 * 1000);
  timer.unref();

  function rateLimited(uid) {
    const now = Date.now();
    const list = (rate.get(uid) ?? []).filter((t) => now - t < 60 * 1000);
    list.push(now);
    rate.set(uid, list);
    return list.length > config.chat.ratePerMinute;
  }

  r.post('/chat/start', (req, res) => {
    const { node: nodeId, affection } = req.body ?? {};
    const story = stories.get();
    const chat = story.nodes[nodeId]?.chat;
    if (!chat) return res.status(400).json({ error: 'not_chat_node' });
    const characterId = chat.character ?? Object.keys(story.characters).find((k) => story.characters[k].persona);
    const aff = story.settings?.affection ?? {};
    const session = {
      id: crypto.randomUUID(),
      uid: req.uid,
      node: nodeId,
      characterId,
      history: [],
      rounds: chat.rounds,
      used: 0,
      affectionStart: clamp(Number(affection) || 0, aff.min ?? 0, aff.max ?? 100),
      totalDelta: 0,
      maxAffection: chat.maxAffection ?? 15,
      updatedAt: Date.now(),
    };
    sessions.set(session.id, session);
    res.json({
      chatId: session.id,
      rounds: session.rounds,
      opening: chat.opening ?? null,
      suggestions: chat.suggestions ?? [],
      provider: llm.name,
      model: llm.model,
    });
  });

  r.post('/chat/message', async (req, res) => {
    const { chatId, text } = req.body ?? {};
    const session = sessions.get(chatId);
    if (!session || session.uid !== req.uid) return res.status(410).json({ error: 'chat_expired', message: '聊天已结束或已过期' });
    if (session.used >= session.rounds) return res.status(409).json({ error: 'no_rounds_left' });
    const message = String(text ?? '').trim().slice(0, config.chat.maxMessageLength);
    if (!message) return res.status(400).json({ error: 'empty_message' });
    if (rateLimited(req.uid)) return res.status(429).json({ error: 'rate_limited', message: '说得太快啦，喝口咖啡歇一歇' });
    if (session.pending) return res.status(409).json({ error: 'busy' });

    const story = stories.get();
    const character = story.characters[session.characterId];
    const chat = story.nodes[session.node].chat;
    session.pending = true;
    try {
      const out = await llm.reply({
        character,
        chat,
        history: session.history,
        message,
        affection: session.affectionStart + session.totalDelta,
        roundsLeft: session.rounds - session.used - 1,
      });

      // 服务端裁剪：单轮上限 + 本段聊天累计上限
      const perReply = clamp(Math.round(Number(out.affection_delta) || 0), -config.chat.perReplyMaxDelta, config.chat.perReplyMaxDelta);
      const newTotal = clamp(session.totalDelta + perReply, -session.maxAffection, session.maxAffection);
      const applied = newTotal - session.totalDelta;
      session.totalDelta = newTotal;
      session.used++;
      session.updatedAt = Date.now();

      const expression = character.sprites?.[out.expression] ? out.expression : 'normal';
      const reply = String(out.reply ?? '').trim() || '……';
      session.history.push({ role: 'user', content: message }, { role: 'assistant', content: reply });
      if (session.history.length > HISTORY_LIMIT) session.history.splice(0, session.history.length - HISTORY_LIMIT);

      track(req, 'chat_message', { node: session.node, delta: applied, raw: perReply, provider: out.provider, playId: req.body.playId });
      res.json({
        reply,
        expression,
        delta: applied,
        totalDelta: session.totalDelta,
        roundsLeft: session.rounds - session.used,
        provider: out.provider,
        degraded: Boolean(out.degraded),
      });
    } catch (error) {
      console.error('[chat] 回复失败', error);
      res.status(500).json({ error: 'chat_failed', message: '她好像走神了……再说一次？' });
    } finally {
      session.pending = false;
    }
  });

  r.post('/chat/end', (req, res) => {
    const session = sessions.get(req.body?.chatId);
    if (!session || session.uid !== req.uid) return res.json({ ended: true });
    sessions.delete(session.id);
    res.json({ ended: true, totalDelta: session.totalDelta, used: session.used });
  });

  return r;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
