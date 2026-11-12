/** 后端接口封装。所有请求同源 + Cookie 身份，无需手动带 token。 */

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || body?.error || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const api = {
  session: () => request('GET', '/api/session'),
  story: () => request('GET', '/api/story'),
  unlocks: () => request('GET', '/api/unlocks'),
  createOrder: (cgId, playId) => request('POST', '/api/pay/orders', { cgId }, { 'x-play-id': playId ?? '' }),
  confirmOrder: (orderId, payload, playId) =>
    request('POST', `/api/pay/orders/${encodeURIComponent(orderId)}/confirm`, payload, { 'x-play-id': playId ?? '' }),
  chatStart: (body) => request('POST', '/api/chat/start', body),
  chatMessage: (body) => request('POST', '/api/chat/message', body),
  chatEnd: (chatId) => request('POST', '/api/chat/end', { chatId }),
  cgUrl: (cgId) => `/api/cg/${encodeURIComponent(cgId)}`,
};
