import { h } from './dom.js';

/** 渲染选项按钮。锁定的选项显示条件提示且不可点。 */
export function renderChoices(container, options, onPick) {
  let picked = false;
  container.replaceChildren(
    ...options.map((o, i) =>
      h(
        'button',
        {
          class: `choice ${o.locked ? 'locked' : ''}`,
          style: { animationDelay: `${i * 70}ms` },
          disabled: o.locked,
          onclick: (e) => {
            e.stopPropagation();
            if (picked || o.locked) return;
            picked = true;
            e.currentTarget.classList.add('picked');
            setTimeout(() => onPick(o.index), 220);
          },
        },
        h('span', {}, o.text),
        o.locked ? h('small', {}, `🔒 ${o.hint}`) : null,
      ),
    ),
  );
  container.classList.remove('hidden');
  container.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
}
