/** Run against an already installed plugin in an isolated .tmp/host Electron instance. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9229');
const page = browser.contexts()[0].pages()[0];
const root = path.resolve('.tmp/host');
assert.ok(page.url().toLowerCase().startsWith('file:///' + root.replaceAll('\\', '/').toLowerCase() + '/'), 'Only an isolated workspace test instance is allowed');
const frame = page.frames().find((f) => f.parentFrame()); assert.ok(frame);
const rpc = (command, data = {}) => frame.evaluate(({ command, data }) => new Promise((resolve, reject) => {
  const id = crypto.randomUUID(); const timeout = setTimeout(() => reject(Error('Test RPC timed out')), 20000);
  const handler = (event) => {
    if (event.source !== parent || event.data?.messageId !== id) return;
    clearTimeout(timeout); removeEventListener('message', handler);
    if (event.data.type === 'PLUGIN_MESSAGE_ERROR') reject(Error(event.data.error)); else resolve(event.data.result);
  };
  addEventListener('message', handler); parent.postMessage({ type: 'PLUGIN_MESSAGE', messageId: id, message: { command, ...data } }, '*');
}), { command, data });
const host = (method, ...args) => frame.evaluate(({ method, args }) => PluginAPI[method](...args), { method, args });
const results = [];
try {
  let status = await rpc('status');
  assert.equal(path.resolve(status.config.vaultPath), path.join(root, 'vault'));
  await rpc('save-config', { config: { ...status.config, paused: true } });
  const readState = async () => JSON.parse(await fs.readFile(path.join(root, 'vault/Super Productivity/.sp-sync/state.json'), 'utf8'));
  const state = await readState(), projectId = status.config.projectIds[0];
  const tasksPath = state.projects[projectId].directory + '/tasks.md';
  const absolute = (relative) => path.join(root, 'vault', relative);
  const prefix = `实际桌面验收-${Date.now()}`;
  await fs.writeFile(absolute('验收源笔记.md'), '---\ncustom: true\n---\n原始正文\n\n- [ ] 正文中的复选框\n');
  const notePath = state.projects[projectId].directory + `/task-notes/acceptance-${Date.now()}.md`;
  await fs.writeFile(absolute(notePath), '任务 notes\n\n[[验收源笔记]]');
  await fs.appendFile(absolute(tasksPath), `\n- [ ] ${prefix} #验收 ⏳ 2026-10-03 [sp-planned-time:: 14:00] 📅 2026-10-05 [sp-deadline-time:: 18:00] estimate [90min](sp-estimate-minutes:: 90) [sp-expected-finish:: 2026-10-03T16:00:00-07:00] [sp-notes:: [[${notePath.slice(0,-3)}]]]\n  - [ ] ${prefix}子任务 estimate [30min](sp-estimate-minutes:: 30)\n`);
  const synchronize = async () => {
    await rpc('save-config', { config: { ...status.config, paused: false } });
    const result = await rpc('sync');
    await rpc('save-config', { config: { ...status.config, paused: true } });
    assert.deepEqual(result.issues, []); return result;
  };
  await synchronize();
  const tasks = await host('getTasks');
  const parentTask = tasks.find(t => t.title === prefix), child = tasks.find(t => t.title === prefix+'子任务');
  assert.ok(parentTask); assert.equal(child.parentId,parentTask.id);
  assert.equal(parentTask.timeEstimate,1800000); assert.equal(child.timeEstimate,1800000); assert.ok(parentTask.dueWithTime); assert.ok(parentTask.deadlineWithTime);
  assert.ok(parentTask.notes.includes('原始正文')); assert.equal(tasks.filter(t=>t.title===prefix).length,1);
  results.push('Markdown 新增父子任务、标签、四类时间与引用导入通过');
  await host('updateTask', parentTask.id, { notes: parentTask.notes.replace('原始正文','应用编辑正文') });
  await synchronize(); assert.ok((await fs.readFile(absolute('验收源笔记.md'),'utf8')).includes('custom: true\n---\n应用编辑正文'));
  await fs.writeFile(absolute('验收源笔记.md'),'---\ncustom: true\n---\n源笔记编辑正文\n');
  await synchronize(); assert.ok((await host('getTasks')).find(t=>t.id===parentTask.id).notes.includes('源笔记编辑正文'));
  results.push('任务引用写回源笔记、源笔记传播到应用且保留 YAML 通过');
  let content = await fs.readFile(absolute(tasksPath),'utf8');
  content = content.replace(`- [ ] ${prefix} `,`- [x] ${prefix} `); await fs.writeFile(absolute(tasksPath),content);
  await synchronize(); assert.equal((await host('getTasks')).find(t=>t.id===parentTask.id).isDone,true);
  await synchronize(); assert.equal((await host('getTasks')).filter(t=>t.title===prefix).length,1);
  results.push('完成状态导入与重复同步去重通过');
  content = await fs.readFile(absolute(tasksPath),'utf8');
  await fs.writeFile(absolute(tasksPath),content.split('\n').filter(line=>!line.includes(`sp:task:${parentTask.id} `)).join('\n'));
  await synchronize();
  const removed = await readState(); assert.ok(removed.removed[parentTask.id]); assert.ok(removed.removed[child.id]);
  for(const id of [parentTask.id,child.id]) {
    assert.equal(await fs.stat(absolute(removed.notesPaths[id])).then(()=>true,()=>false),false);
    assert.ok(await fs.stat(absolute(removed.removed[id].note.recoveryPath)));
  }
  assert.ok(await fs.stat(absolute('验收源笔记.md')));
  const remaining = await host('getTasks'); assert.ok(remaining.find(t=>t.id===parentTask.id)); assert.equal(remaining.find(t=>t.id===child.id).parentId,parentTask.id);
  await rpc('restore',{id:parentTask.id}); await synchronize();
  assert.ok((await fs.readFile(absolute(tasksPath),'utf8')).includes(`sp:task:${parentTask.id}`));
  for(const id of [parentTask.id,child.id]) assert.ok(await fs.stat(absolute(removed.notesPaths[id])));
  assert.ok((await host('getTasks')).find(task=>task.id===parentTask.id).notes.includes('源笔记编辑正文'));
  results.push('仅删除父任务行保留原生整组、清理 notes 并保存副本、恢复 notes 与关联且身份稳定通过');
  content = await fs.readFile(absolute(tasksPath),'utf8');
  await fs.writeFile(absolute(tasksPath),content.replace(`  - [ ] ${prefix}子任务`,`- [ ] ${prefix}子任务`));
  await synchronize(); assert.ok(!(await host('getTasks')).find(t=>t.id===child.id).parentId);
  content = await fs.readFile(absolute(tasksPath),'utf8');
  const lines = content.split('\n'), childLine = lines.find(line=>line.includes(`sp:task:${child.id} `));
  const remainingLines = lines.filter(line=>line!==childLine), parentIndex = remainingLines.findIndex(line=>line.includes(`sp:task:${parentTask.id} `));
  remainingLines.splice(parentIndex+1,0,'  '+childLine); await fs.writeFile(absolute(tasksPath),remainingLines.join('\n'));
  await synchronize(); assert.equal((await host('getTasks')).find(t=>t.id===child.id).parentId,parentTask.id);
  results.push('原生 batchUpdateForProject 提升和重新关联子任务通过');
  const markdownFiles = await fs.readdir(absolute(state.projects[projectId].directory)); assert.ok(!markdownFiles.includes('project-notes'));
  results.push('项目笔记默认关闭通过');
  await fs.writeFile(root+'/acceptance.json',JSON.stringify({app:'Super Productivity 19.1.0 Windows x64',results,taskId:parentTask.id,childId:child.id},null,2));
  console.log(results.join('\n'));
} finally { await browser.close(); }
