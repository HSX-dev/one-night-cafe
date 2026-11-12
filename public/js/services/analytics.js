/**
 * 埋点：本地队列 + 批量上报。页面隐藏/关闭时用 sendBeacon 兜底，尽量不丢"流失前最后一个节点"。
 */
const FLUSH_INTERVAL = 3000;
const MAX_BATCH = 20;

class Analytics {
  constructor() {
    this.queue = [];
    this.playId = null;
    this.timer = null;
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    });
    addEventListener('pagehide', () => this.flush(true));
  }

  setPlay(playId) {
    this.playId = playId;
  }

  track(event, props = {}) {
    this.queue.push({ event, props, playId: this.playId, ts: Date.now() });
    if (this.queue.length >= MAX_BATCH) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_INTERVAL);
  }

  flush(beacon = false) {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.queue.length) return;
    const events = this.queue.splice(0);
    const body = JSON.stringify({ events });
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/track', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {
      // 网络失败放回队列，下次再试
      this.queue.unshift(...events);
    });
  }
}

export const analytics = new Analytics();

export function newPlayId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
