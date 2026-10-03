import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, withIssues = false) {
  await page.addInitScript((withIssues) => {
    const status = { config: { version: 1, vaultPath: '', projectIds: [], timezone: 'America/Los_Angeles', paused: false, exportArchive: false, exportProjectNotes: false }, running: false, lastSync: null as string | null,
      projects: [{ id: 'p1', title: '网站改版', taskIds: [], backlogTaskIds: [] }, { id: 'p2', title: '<script>不会执行</script>', taskIds: [], backlogTaskIds: [] }],
      tasks: [{ id: 't1', title: '编写需求说明', expectedFinish: null }], removed: [{ id: 'r1', title: '保留的任务', reason: 'Markdown 任务行已移除' }], issues: [] };
    if(withIssues) (status as any).issues=[
      {code:'verification-paused',message:'应用更新未通过读回验证：保存设置；差异字段：tags。暂停该项目，其余项目继续。'},
      {code:'file-paused',message:'任务文件缺失，绑定暂停（可在面板重建）：Super Productivity/projects/项目/tasks.md'},
      {code:'reference-conflict',message:'多个任务给出不同引用正文，暂停该笔记写回；选择一个版本恢复',path:'资料.md',candidates:[{label:'源文件',body:'用户的源文件正文',kind:'task'},{label:'Obsidian 源文件',body:'Source body',kind:'source'}]},
    ];
    window.__OBSIDIAN_TEST_RPC__ = async (data) => {
      const request = data as Record<string, any>;
      switch (request.command) {
        case 'status': return structuredClone(status);
        case 'save-config': status.config = request.config; return structuredClone(status);
        case 'sync': status.lastSync = '2026-10-02T12:00:00Z'; return structuredClone(status);
        case 'browse': return { directory: 'D:\\Vault', parent: 'D:\\', directories: ['D:\\Vault\\资料'] };
        case 'restore': status.removed = []; return structuredClone(status);
        case 'set-expected': return structuredClone(status);
        case 'backups': return [{ path: 'Super Productivity/.sp-sync/backups/1.json', originalPath: '资料/方案.md', created: '2026-10-02T12:00:00Z' }];
        case 'read-backup': return { content: '<script>alert("not executed")</script>\n备份原文' };
        case 'restore-backup': return structuredClone(status);
        default: throw new Error('未知测试命令');
      }
    };
  }, withIssues);
  await page.goto('/');
}
test('configure vault and projects, default exports off, sync and pause', async ({ page }) => {
  await setup(page);
  await expect(page.getByLabel('导出原生项目笔记（只读）')).not.toBeChecked();
  await expect(page.getByLabel('导出历史归档（只读）')).not.toBeChecked();
  await page.getByRole('button', { name: '选择文件夹', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '选择 vault' })).toBeVisible();
  await page.getByRole('button', { name: '使用此文件夹' }).click();
  await page.getByLabel('网站改版').check(); await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '立即同步', exact: true }).click(); await expect(page.getByText('上次成功同步：', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '暂停同步' }).click(); await expect(page.getByText('已暂停', { exact: true })).toBeVisible();
  await page.screenshot({ path: '.tmp/ui-config.png', fullPage: true });
});
test('restore associations and preview backups without rendering untrusted HTML', async ({ page }) => {
  await setup(page); await page.getByLabel('Obsidian 文件夹').fill('D:\\Vault'); await page.getByLabel('网站改版').check(); await page.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '恢复关联', exact: true }).click(); await expect(page.getByText('保留的任务', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: '查看备份' }).click(); await page.getByRole('button', { name: '查看／恢复' }).click();
  await expect(page.getByRole('dialog').locator('pre')).toContainText('<script>');
  await expect(page.getByRole('dialog').locator('script')).toHaveCount(0);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
});
test('usable narrow layout and dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' }); await setup(page);
  await expect(page.getByRole('heading', { name: '把任务与笔记放在一起' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '.tmp/ui-mobile-dark.png', fullPage: true });
});
test('standalone page explains installation instead of silently pretending to sync', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('status')).toContainText('需要在 Super Productivity');
});
test('keeps an unfinished time edit through automatic status refresh', async ({ page }) => {
  await page.clock.install(); await setup(page);
  const input=page.getByLabel('编写需求说明预计完成'); await input.fill('2026-10-03T16:');
  await page.clock.runFor(11000); await expect(page.getByLabel('编写需求说明预计完成')).toHaveValue('2026-10-03T16:');
});

test('English translates standalone connection errors before a host is available',async({page})=>{
  await page.goto('/');await page.locator('#language').selectOption('en');
  await expect(page.getByRole('status')).toContainText('Open this page in the Super Productivity plugin panel');
  await expect(page.getByRole('button',{name:'Reconnect',exact:true})).toBeVisible();
});

test('English diagnostics and removal reasons preserve user titles and preview bodies',async({page})=>{
  await setup(page,true);await page.locator('#language').selectOption('en');
  await expect(page.getByText('App update failed readback verification: 保存设置; differing fields: tags.',{exact:false})).toBeVisible();
  await expect(page.getByText('Rebuild a missing task file:',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'View: 源文件',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'View: Obsidian source file',exact:true})).toBeVisible();
  await expect(page.getByText('The Markdown task row was removed',{exact:true})).toBeVisible();
  await expect(page.getByText('保留的任务',{exact:true})).toBeVisible();
  await page.getByLabel('Obsidian vault folder').fill('D:\\Vault');await page.getByLabel('网站改版').check();await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByRole('button',{name:'View backups',exact:true}).click();await page.getByRole('button',{name:'View / restore',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Content preview',exact:true}).locator('pre')).toContainText('备份原文');
  await expect(page.getByRole('dialog').locator('script')).toHaveCount(0);
  await page.getByRole('button',{name:'Close',exact:true}).click();
});
