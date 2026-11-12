#!/usr/bin/env node
/**
 * 由 story.json 生成 Mermaid 剧情流程图：npm run graph > graph.md
 * 改了剧情后重新生成即可，README 里的流程图就是这样来的。
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = process.argv[2] ?? fileURLToPath(new URL('../story/story.json', import.meta.url));
const story = JSON.parse(fs.readFileSync(file, 'utf8'));

const cond = (c) => {
  if (!c) return '';
  if (c.affection) return Object.entries(c.affection).map(([op, v]) => `好感${{ gte: '≥', gt: '>', lte: '≤', lt: '<', eq: '=' }[op] ?? op}${v}`).join(' ');
  if (c.flag) return `flag:${c.flag}`;
  return '条件';
};
const label = (s) => String(s).replace(/["「」『』]/g, '').replace(/\s+/g, ' ').slice(0, 18);

const lines = ['flowchart TD'];
for (const [id, n] of Object.entries(story.nodes)) {
  const title = label(n.title ?? id);
  if (n.ending) lines.push(`  ${id}(["🏁 ${title}"])`);
  else if (n.branch) lines.push(`  ${id}{"${title}"}`);
  else if (n.chat) lines.push(`  ${id}[["💬 ${title}"]]`);
  else lines.push(`  ${id}["${title}"]`);

  if (n.next) lines.push(`  ${id} --> ${n.next}`);
  for (const b of n.branch ?? []) lines.push(`  ${id} -- "${cond(b.if) || '否则'}" --> ${b.next}`);
  for (const c of n.choices ?? []) {
    const d = c.effects?.affection;
    lines.push(`  ${id} -- "${label(c.text)}${d ? ` (${d > 0 ? '+' : ''}${d})` : ''}" --> ${c.next}`);
  }
  if (n.chat) lines.push(`  ${id} -- "自由聊天 ×${n.chat.rounds}" --> ${n.chat.next}`);
}
console.log('```mermaid\n' + lines.join('\n') + '\n```');
