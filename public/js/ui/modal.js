import { $, h } from './dom.js';

const stack = [];

/**
 * 通用弹窗。返回 { el, body, close }。
 * dismissible：点遮罩 / Esc 可关闭。
 */
export function openModal({ title, body, actions = [], className = '', dismissible = true, onClose } = {}) {
  const root = $('.modal-root');
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const footer = actions.length
    ? h(
        'footer',
        { class: 'modal-actions' },
        actions.map((a) => h('button', { class: `btn ${a.primary ? 'btn-primary' : ''} ${a.className ?? ''}`, onclick: () => a.onClick?.(api) }, a.label)),
      )
    : null;
  const panel = h(
    'div',
    { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title ?? '' },
    title ? h('header', { class: 'modal-header' }, h('h2', {}, title), dismissible ? h('button', { class: 'modal-close', 'aria-label': '关闭', onclick: () => api.close() }, '×') : null) : null,
    bodyEl,
    footer,
  );
  const overlay = h('div', { class: 'modal-overlay' }, panel);
  overlay.addEventListener('click', (e) => {
    // 弹窗里的点击不能冒泡到舞台：否则点"关闭"后弹窗已出栈，同一次点击会顺带推进剧情
    e.stopPropagation();
    if (e.target === overlay && dismissible) api.close();
  });
  // 弹窗内的点击不要冒泡到舞台（否则会推进剧情）
  overlay.addEventListener('pointerdown', (e) => e.stopPropagation());

  let closed = false;
  const api = {
    el: panel,
    body: bodyEl,
    dismissible,
    close(result) {
      if (closed) return;
      closed = true;
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 180);
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      onClose?.(result);
    },
  };
  root.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  stack.push(api);
  return api;
}

export function hasOpenModal() {
  return stack.length > 0;
}

export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (top?.dismissible) top.close();
}

export function confirmDialog(message, { ok = '确定', cancel = '取消', title = '提示' } = {}) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      className: 'modal-small',
      body: h('p', { class: 'confirm-text' }, message),
      onClose: (r) => resolve(Boolean(r)),
      actions: [
        { label: cancel, onClick: (x) => x.close(false) },
        { label: ok, primary: true, onClick: (x) => x.close(true) },
      ],
    });
    m.el.querySelector('.btn-primary')?.focus();
  });
}

export function toast(message, { type = 'info', ms = 2200 } = {}) {
  const el = h('div', { class: `toast toast-${type}` }, message);
  $('.toast-root').append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
