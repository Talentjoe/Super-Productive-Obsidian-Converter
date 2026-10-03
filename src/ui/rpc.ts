declare global { interface Window { __OBSIDIAN_TEST_RPC__?: (message: unknown) => Promise<unknown> } }
export function rpc<T>(command: string, data: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException('操作已取消', 'AbortError'));
  if (window.__OBSIDIAN_TEST_RPC__) return window.__OBSIDIAN_TEST_RPC__({ command, ...data }) as Promise<T>;
  if (window.parent === window) return Promise.reject(new Error('此页面需要在 Super Productivity 插件面板中打开。安装 ZIP 后选择“Obsidian 同步”。'));
  const messageId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); window.removeEventListener('message', handler); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('操作已取消', 'AbortError')); };
    // Status is read-only and can safely be retried if the iframe opens before the
    // background handler is ready. Mutations retain the longer execution window.
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(command === 'status' ? '未收到后台响应。请确认插件已启用，点击“重新连接”。' : '后台响应超时，请检查 Super Productivity 的 Node 权限对话框和同步状态；确认操作结果后再重试。'));
    }, command === 'status' ? 5000 : 120000);
    const handler = (event: MessageEvent) => {
      if (event.source !== window.parent || event.data?.messageId !== messageId) return;
      if (!['PLUGIN_MESSAGE_RESPONSE', 'PLUGIN_MESSAGE_ERROR'].includes(event.data.type)) return;
      cleanup();
      if (event.data.type === 'PLUGIN_MESSAGE_ERROR') reject(new Error(event.data.error)); else resolve(event.data.result as T);
    };
    window.addEventListener('message', handler);
    signal?.addEventListener('abort', abort, { once: true });
    window.parent.postMessage({ type: 'PLUGIN_MESSAGE', messageId, message: { command, ...data } }, '*');
  });
}
