#!/usr/bin/env node
/**
 * 剧情 JSON 校验：npm run validate [path/to/story.json]
 * 检查跳转断链、引用了不存在的角色/表情/场景/CG/音频、条件语法、可达性、结局数量。
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateStory } from '../public/js/engine/validate.js';

const file = process.argv[2] ?? fileURLToPath(new URL('../story/story.json', import.meta.url));
let story;
try {
  story = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`✗ 无法解析 ${file}\n  ${e.message}`);
  process.exit(1);
}

const { errors, warnings, stats } = validateStory(story);
for (const e of errors) console.error(`  ✗ ${e}`);
for (const w of warnings) console.warn(`  ! ${w}`);
console.log(
  `\n${errors.length ? '✗ 校验失败' : '✓ 校验通过'}  ${file}\n` +
    `  节点 ${stats.nodes ?? 0} 个 · 选项节点 ${stats.choiceNodes ?? 0} 个 · 台词 ${stats.lines ?? 0} 句 · 可达结局 ${(stats.endings ?? []).join(' / ')}\n` +
    `  错误 ${errors.length} · 警告 ${warnings.length}`,
);
process.exit(errors.length ? 1 : 0);
