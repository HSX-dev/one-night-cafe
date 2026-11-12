import { createAnthropicProvider, describeAnthropicError } from './anthropic.js';
import { createMockProvider } from './mock.js';

/**
 * 选择大模型提供方。主提供方失败时自动降级到离线规则回复，聊天流程不中断。
 * @returns {{ name, model, reply(input) => Promise<{reply, expression, affection_delta, reason, provider, degraded?}> }}
 */
export function createLLM({ provider, model, effort }) {
  const mock = createMockProvider();
  if (provider !== 'anthropic') {
    return { name: mock.name, model: mock.model, reply: async (input) => ({ ...(await mock.reply(input)), provider: 'mock' }) };
  }

  const primary = createAnthropicProvider({ model, effort });
  return {
    name: primary.name,
    model: primary.model,
    async reply(input) {
      try {
        return { ...(await primary.reply(input)), provider: primary.name };
      } catch (error) {
        console.error(`[llm] Claude 调用失败，降级到离线回复：${describeAnthropicError(error)}`);
        return { ...(await mock.reply(input)), provider: 'mock', degraded: true };
      }
    },
  };
}
