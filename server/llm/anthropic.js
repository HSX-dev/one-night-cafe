/**
 * Claude 接入：结构化输出一次拿到 { reply, expression, affection_delta, reason }。
 * - 模型默认 claude-opus-5-5，effort 默认 low（闲聊场景延迟优先），都可用环境变量覆盖
 * - 开启服务端 refusal fallback（fallbacks: 'default'），被安全策略拒绝时由服务端自动换模型重试
 * - system prompt 加 cache_control，多轮对话复用缓存前缀
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { buildSystemPrompt, buildStateNote } from './prompt.js';

export function createAnthropicProvider({ model, effort }) {
  const client = new Anthropic();

  return {
    name: 'anthropic',
    model,

    /**
     * @param {{ character, chat, history: {role,content}[], message: string, affection: number, roundsLeft: number }} input
     */
    async reply({ character, chat, history, message, affection, roundsLeft }) {
      const expressions = Object.keys(character.sprites ?? { normal: 1 });
      const Reply = z.object({
        reply: z.string().describe('角色这一轮说的话，1～3 句，不超过 80 个汉字'),
        expression: z.enum(expressions).describe('角色此刻的表情'),
        affection_delta: z.number().int().describe('好感度变化，-5 到 5 的整数'),
        reason: z.string().describe('好感度变化原因，一句话'),
      });

      const response = await client.beta.messages.parse({
        model,
        max_tokens: 4000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort, format: betaZodOutputFormat(Reply) },
        system: [{ type: 'text', text: buildSystemPrompt({ character, chat }), cache_control: { type: 'ephemeral' } }],
        messages: [
          ...history,
          { role: 'user', content: message },
          { role: 'system', content: buildStateNote({ affection, roundsLeft }) },
        ],
      });

      if (response.stop_reason === 'refusal' || !response.parsed_output) {
        // 整条 fallback 链都拒绝 / 输出被截断：用角色口吻岔开话题，不扣好感
        console.warn(`[llm] 未拿到结构化回复 stop_reason=${response.stop_reason}`, response.stop_details ?? '');
        return { reply: '……（她轻轻摇了摇头）这个话题，换一个好不好？', expression: 'shy', affection_delta: 0, reason: `stop_reason=${response.stop_reason}` };
      }
      return response.parsed_output;
    },
  };
}

/** 区分可重试与不可重试错误，便于路由层决定是否降级 */
export function describeAnthropicError(error) {
  if (error instanceof Anthropic.AuthenticationError) return 'API Key 无效或未配置';
  if (error instanceof Anthropic.PermissionDeniedError) return '没有权限使用该模型';
  if (error instanceof Anthropic.NotFoundError) return '模型不存在（检查 ANTHROPIC_MODEL）';
  if (error instanceof Anthropic.RateLimitError) return '触发限流，请稍后再试';
  if (error instanceof Anthropic.BadRequestError) return `请求参数错误：${error.message}`;
  if (error instanceof Anthropic.APIConnectionError) return '无法连接 Anthropic API';
  if (error instanceof Anthropic.APIError) return `API 错误 ${error.status}：${error.message}`;
  return error?.message ?? String(error);
}
