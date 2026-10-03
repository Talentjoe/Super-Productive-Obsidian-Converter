import { expect, test, type Page } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

// Test the exact ZIP iframe and its parent message bridge, without the dev RPC bypass.
async function packaged(page: Page, options = { dropStatus: 0, holdBrowse: false }) {
  const html = await readFile('dist/index.html', 'utf8');
  await page.route('**/__packaged-host', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body style="margin:0"><iframe id="plugin" sandbox="allow-scripts allow-same-origin" style="width:100%;height:900px;border:0"></iframe></body></html>' }));
  await page.goto('/__packaged-host');
  await page.clock.install();
  await page.evaluate(({ html, options }) => {
    const status = { config: { version: 1, vaultPath: '', projectIds: [] as string[], timezone: 'America/Los_Angeles', paused: false, exportArchive: false, exportProjectNotes: false }, running: false, lastSync: null as string | null,
      projects: [{ id: 'p1', title: '网站改版', taskIds: [], backlogTaskIds: [] }], tasks: [{ id: 't1', title: '编写需求说明', expectedFinish: null as string | null }], removed: [], issues: [] };
    const requests: Record<string, any>[] = [];
    let pending: MessageEvent | undefined;
    const respond = (event: MessageEvent, result: unknown, error?: string) => (event.source as Window).postMessage({ type: error ? 'PLUGIN_MESSAGE_ERROR' : 'PLUGIN_MESSAGE_RESPONSE', messageId: event.data.messageId, result, error }, '*');
    (window as any).__packaged = { requests, holdNextBrowse() { options.holdBrowse = true; }, releaseBrowse(error?: string) { if (pending) respond(pending, { directory: pending.data.message.directory || 'D:\\Vault', parent: 'D:\\', directories: [] }, error); pending = undefined; options.holdBrowse = false; } };
    addEventListener('message', (event) => {
      if (event.source !== document.querySelector('iframe')?.contentWindow || event.data?.type !== 'PLUGIN_MESSAGE') return;
      const request = event.data.message; requests.push(request);
      if (request.command === 'status' && options.dropStatus-- > 0) return;
      if (request.command === 'browse' && options.holdBrowse) { pending = event; return; }
      switch (request.command) {
        case 'browse': respond(event, { directory: request.directory || 'D:\\Vault', parent: 'D:\\', directories: ['D:\\Vault\\资料'] }); return;
        case 'save-config': status.config = request.config; break;
        case 'sync': status.lastSync = '2026-10-02T12:00:00Z'; break;
        case 'set-expected': status.tasks[0].expectedFinish = request.value; break;
        case 'backups': respond(event, [{ path: 'Super Productivity/.sp-sync/backups/1.json', originalPath: '方案.md', created: '2026-10-02T12:00:00Z' }]); return;
        case 'read-backup': respond(event, { content: '原始备份正文' }); return;
      }
      respond(event, structuredClone(status));
    });
    document.querySelector('iframe')!.srcdoc = html;
  }, { html, options });
  return page.frameLocator('#plugin');
}

test('ZIP contains literal bundled JavaScript, including Solid event handler keys', async () => {
  const files = await readdir('.tmp/ui-build/assets');
  const js = await readFile(`.tmp/ui-build/assets/${files.find((name) => name.endsWith('.js'))}`, 'utf8');
  const html = await readFile('dist/index.html', 'utf8');
  expect(html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1]).toBe(js.replace(/<\/script/gi, '<\\/script'));
  const zip = unzipSync(await readFile('dist/sp-obsidian-sync.zip'));
  expect(strFromU8(zip['index.html'])).toBe(html);
  expect(JSON.parse(strFromU8(zip['manifest.json'])).version).toBe(JSON.parse(await readFile('manifest.json','utf8')).version);
});

test('packaged iframe accepts pointer clicks, typing, checkboxes and background replies', async ({ page }) => {
  const ui = await packaged(page);
  await expect(ui.getByRole('button', { name: '选择文件夹', exact: true })).toBeEnabled();
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await ui.getByRole('button', { name: 'D:\\Vault\\资料', exact: true }).click();
  await expect(ui.getByRole('dialog')).toContainText('D:\\Vault\\资料');
  await ui.getByRole('button', { name: '取消', exact: true }).click();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await ui.getByRole('button', { name: '使用此文件夹' }).click();
  await ui.getByLabel('Obsidian 文件夹').fill('D:\\我的笔记');
  await ui.getByLabel('网站改版').check();
  await ui.getByLabel('导出原生项目笔记（只读）').check();
  await ui.getByLabel('导出历史归档（只读）').check();
  await ui.getByLabel('具体时间使用的时区').fill('Asia/Shanghai');
  await ui.getByLabel('自动同步延迟').selectOption('60');
  await ui.getByLabel('文件检查间隔').selectOption('120');
  await ui.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__packaged.requests.findLast((r: any) => r.command === 'save-config')?.config)).toMatchObject({ vaultPath: 'D:\\我的笔记', projectIds: ['p1'], timezone: 'Asia/Shanghai', exportArchive: true, exportProjectNotes: true, syncDelaySeconds:60, fileCheckSeconds:120 });
  await ui.getByRole('button', { name: '立即同步', exact: true }).click();
  await expect(ui.getByText('上次成功同步：', { exact: false })).toBeVisible();
  await ui.getByRole('button', { name: '暂停同步' }).click();
  await expect(ui.getByText('已暂停', { exact: true })).toBeVisible();
  await ui.getByRole('button', { name: '恢复同步' }).click();
  await expect(ui.getByRole('button', { name: '暂停同步' })).toBeEnabled();
  await ui.getByLabel('编写需求说明预计完成').fill('2026-10-03T16:00:00+08:00');
  await ui.getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__packaged.requests.findLast((r: any) => r.command === 'set-expected')?.value)).toBe('2026-10-03T16:00:00+08:00');
  await ui.getByRole('button', { name: '查看备份' }).click();
  await ui.getByRole('button', { name: '查看／恢复' }).click();
  await expect(ui.getByRole('dialog').locator('pre')).toHaveText('原始备份正文');
  await ui.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
});

test('lost first status message times out promptly and can reconnect by pointer click', async ({ page }) => {
  const ui = await packaged(page, { dropStatus: 1, holdBrowse: false });
  await expect(ui.getByRole('status')).toContainText('正在连接');
  await page.clock.runFor(5100);
  await expect(ui.getByRole('status')).toContainText('未收到后台响应');
  await ui.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(ui.getByRole('button', { name: '选择文件夹', exact: true })).toBeEnabled();
  await expect(ui.getByRole('status')).toHaveCount(0);
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await expect(ui.getByRole('dialog')).toBeVisible();
});

test('pending native permission is explained and rejection releases the UI for retry', async ({ page }) => {
  const ui = await packaged(page, { dropStatus: 0, holdBrowse: true });
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await expect(ui.getByRole('status')).toContainText('Node 权限对话框');
  expect(await ui.getByLabel('Obsidian 文件夹').evaluate(node=>getComputedStyle(node).cursor)).toBe('default');
  await page.evaluate(() => (window as any).__packaged.releaseBrowse('Node 文件权限被拒绝'));
  await expect(ui.getByRole('alert')).toHaveText('Node 文件权限被拒绝');
  await expect(ui.getByRole('button', { name: '选择文件夹', exact: true })).toBeEnabled();
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await expect(ui.getByRole('dialog')).toBeVisible();
});

test('closing and reopening the packaged iframe installs event listeners again', async ({ page }) => {
  const ui = await packaged(page);
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await ui.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => { const frame = document.querySelector('iframe')!; const html = frame.srcdoc; frame.remove(); const next = document.createElement('iframe'); next.id = 'plugin'; next.style.cssText = 'width:100%;height:900px;border:0'; next.setAttribute('sandbox', 'allow-scripts allow-same-origin'); next.srcdoc = html; document.body.append(next); });
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await ui.getByRole('button', { name: '使用此文件夹' }).click();
  await ui.getByLabel('网站改版').check();
  await expect(ui.getByRole('button', { name: '保存设置', exact: true })).toBeEnabled();
});

test('cannot confirm a directory until its real asynchronous read finishes', async ({ page }) => {
  const ui = await packaged(page);
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await page.evaluate(() => (window as any).__packaged.holdNextBrowse());
  await ui.getByRole('button', { name: 'D:\\Vault\\资料', exact: true }).click();
  await expect(ui.getByRole('button', { name: '使用此文件夹' })).toBeDisabled();
  await expect(ui.getByRole('dialog').getByRole('status')).toContainText('正在读取');
  await page.evaluate(() => (window as any).__packaged.releaseBrowse());
  await expect(ui.getByRole('dialog')).toContainText('D:\\Vault\\资料');
  await ui.getByRole('button', { name: '使用此文件夹' }).click();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await expect(ui.getByLabel('Obsidian 文件夹')).toHaveValue('D:\\Vault\\资料');
});

test('cancel a pending directory read immediately and ignore its late response', async ({ page }) => {
  const ui = await packaged(page);
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await page.evaluate(() => (window as any).__packaged.holdNextBrowse());
  await ui.getByRole('button', { name: 'D:\\Vault\\资料', exact: true }).click();
  await ui.getByRole('button', { name: '取消', exact: true }).click();
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await expect(ui.getByRole('button', { name: '选择文件夹', exact: true })).toBeEnabled();
  await page.evaluate(() => (window as any).__packaged.releaseBrowse());
  await page.clock.runFor(100);
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await expect(ui.getByRole('alert')).toHaveCount(0);
  await ui.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await ui.getByRole('button', { name: '使用此文件夹' }).click();
  await expect(ui.getByLabel('Obsidian 文件夹')).toHaveValue('D:\\Vault');
});
