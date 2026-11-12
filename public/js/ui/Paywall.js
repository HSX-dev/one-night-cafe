import { h, wait } from './dom.js';
import { openModal, toast } from './modal.js';
import { api, ApiError } from '../services/api.js';
import { analytics } from '../services/analytics.js';

/**
 * 付费 CG 解锁流程：付费墙 → 模拟收银台 → 后端下单/确认 → 刷新解锁状态。
 * 解锁结果以后端为准（session.unlocks 只是缓存，取图时后端还会再校验）。
 */
export class Paywall {
  constructor({ story, session, audio }) {
    this.story = story;
    this.session = session;
    this.audio = audio;
  }

  /** @returns {Promise<'unlocked' | 'skipped'>} */
  request(cgId, { source = 'story' } = {}) {
    const cg = this.story.cgs[cgId];
    if (this.session.unlocks.has(cgId)) return Promise.resolve('unlocked');
    this.audio.sfx('open');

    return new Promise((resolve) => {
      const price = formatPrice(cg.price, cg.currency);
      const modal = openModal({
        className: 'modal-paywall',
        dismissible: source !== 'story',
        onClose: (r) => resolve(r === 'unlocked' ? 'unlocked' : 'skipped'),
        body: h(
          'div',
          { class: 'paywall' },
          h('div', { class: 'paywall-preview' }, h('img', { src: cg.preview, alt: '' }), h('span', { class: 'paywall-badge' }, '限定 CG')),
          h('h3', {}, cg.title),
          h('p', { class: 'paywall-desc' }, cg.description ?? ''),
          h('ul', { class: 'paywall-points' }, h('li', {}, '解锁后可在「CG 鉴赏」中随时回看'), h('li', {}, '解锁记录保存在服务器，换设备 / 清缓存不丢（同一账号 Cookie）')),
        ),
        actions: [
          {
            label: source === 'story' ? '暂不解锁，继续剧情' : '再想想',
            onClick: (m) => {
              analytics.track('pay_cancel', { cgId, stage: 'paywall', source });
              m.close('skipped');
            },
          },
          {
            label: `${price} 解锁观看`,
            primary: true,
            onClick: async (m) => {
              analytics.track('pay_click', { cgId, source });
              const ok = await this.checkout(cgId);
              if (ok) m.close('unlocked');
            },
          },
        ],
      });
      modal.el.querySelector('.btn-primary')?.focus();
    });
  }

  /** 模拟收银台。@returns {Promise<boolean>} 是否支付成功 */
  async checkout(cgId) {
    let order;
    try {
      order = await api.createOrder(cgId, analytics.playId);
    } catch (e) {
      toast(`下单失败：${e.message}`, { type: 'error' });
      return false;
    }
    if (order.status === 'unlocked') {
      this.session.unlocks.add(cgId);
      return true;
    }

    return new Promise((resolve) => {
      let method = 'wechat';
      let paying = false;
      const methods = [
        { id: 'wechat', label: '微信支付', color: '#07c160' },
        { id: 'alipay', label: '支付宝', color: '#1677ff' },
      ];
      const status = h('p', { class: 'cashier-status' });
      const list = h(
        'div',
        { class: 'cashier-methods', role: 'radiogroup' },
        methods.map((m) =>
          h(
            'label',
            { class: 'cashier-method', style: { '--method-color': m.color } },
            h('input', { type: 'radio', name: 'pay-method', value: m.id, checked: m.id === method, onchange: () => (method = m.id) }),
            h('span', { class: 'cashier-dot' }),
            m.label,
          ),
        ),
      );

      const pay = async (modal, result) => {
        if (paying) return;
        paying = true;
        modal.el.classList.add('paying');
        status.textContent = '支付中…';
        await wait(700); // 模拟拉起支付的等待
        try {
          await api.confirmOrder(order.id, { result, method }, analytics.playId);
          this.session.unlocks.add(cgId);
          this.audio.sfx('coin');
          toast('支付成功，CG 已解锁 ♥', { type: 'success' });
          modal.close(true);
        } catch (e) {
          paying = false;
          modal.el.classList.remove('paying');
          status.textContent = e instanceof ApiError && e.status === 402 ? '支付失败（模拟），可以重试或换一种方式' : `出错了：${e.message}`;
          status.classList.add('error');
        }
      };

      openModal({
        title: '收银台（模拟）',
        className: 'modal-cashier',
        onClose: (paid) => {
          if (!paid) analytics.track('pay_cancel', { cgId, stage: 'cashier' });
          resolve(Boolean(paid));
        },
        body: h(
          'div',
          { class: 'cashier' },
          h('div', { class: 'cashier-amount' }, h('small', {}, order.title), formatPrice(order.amount, order.currency)),
          h('p', { class: 'cashier-order' }, `订单号 ${order.id}`),
          list,
          status,
          h('p', { class: 'cashier-note' }, '演示环境：不会产生真实扣款。'),
        ),
        actions: [
          { label: '模拟失败', className: 'btn-ghost', onClick: (m) => pay(m, 'fail') },
          { label: '确认支付', primary: true, onClick: (m) => pay(m, 'success') },
        ],
      });
    });
  }
}

export function formatPrice(amount, currency = 'CNY') {
  const sym = currency === 'CNY' ? '¥' : `${currency} `;
  return `${sym}${Number(amount).toFixed(2)}`;
}
