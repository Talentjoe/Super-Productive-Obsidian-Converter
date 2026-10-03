import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute, sep } from 'node:path';
import { NodeVault } from '../src/adapters/vault';
import script from '../src/node/io.cjs?raw';
import { FakeHost, task } from './fakes';
import { SyncEngine } from '../src/core/engine';
import { defaultConfig } from '../src/types';
import { taskFile } from '../src/core/exports';
const require = createRequire(import.meta.url);
const execute = new Function('require', 'args', script) as (require: NodeRequire, args: unknown[]) => unknown;
const base = resolve('.tmp/vault-tests');
let directory: string, root: string, vault: NodeVault, host: FakeHost;
beforeEach(() => {
  mkdirSync(base, { recursive: true }); directory = mkdtempSync(join(base, 'fixture-')); root = join(directory, 'vault'); mkdirSync(root);
  host = new FakeHost(); host.executeNodeScript = async (request?: { args?: unknown[] }) => {
    try { return { success: true, result: execute(require, request?.args || []) }; }
    catch (error) { return { success: false, error: { message: (error as Error).message } }; }
  };
  vault = new NodeVault(host, root);
});
afterEach(() => {
  const absolute = realpathSync(directory), rel = relative(realpathSync(base), absolute);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Refusing cleanup outside test workspace');
  rmSync(absolute, { recursive: true, force: true });
});
describe('real Windows-compatible Node bridge filesystem', () => {
  it('transfers large Unicode files below Windows command-line limits and verifies before commit', async () => {
    const real = host.executeNodeScript.bind(host);
    host.executeNodeScript = async (request) => {
      if (request!.script.length + JSON.stringify(request!.args).length > 26000) throw new Error('spawn ENAMETOOLONG');
      return real(request);
    };
    const content = ('Unicode 中文 😀\\路径\n').repeat(18000), path = '资料/长笔记.md';
    const savedHash = await vault.write(path,content,null); expect(savedHash).toBe((await vault.read(path))?.hash);
    expect((await vault.read(path))?.content).toBe(content);
    expect(readdirSync(join(root,'Super Productivity/.sp-sync/staging'))).toEqual([]);
    let append = 0;
    host.executeNodeScript = async (request) => {
      const input = request!.args![0] as { action: string };
      if (input.action === 'stage-append' && ++append === 2) return {success:false,error:'模拟传输中断'};
      return real(request);
    };
    await expect(vault.write(path,content+'改变',savedHash)).rejects.toThrow('中断');
    expect((await vault.read(path))?.content).toBe(content); expect(readdirSync(join(root,'Super Productivity/.sp-sync/staging'))).toEqual([]);
  });
  it('creates files atomically, checks concurrent edits and creates inspectable/restorable backups', async () => {
    const path = 'Super Productivity/projects/中文/task-notes/a.md';
    const hash = await vault.write(path, '原文\n\n段落', null); expect((await vault.read(path))?.content).toBe('原文\n\n段落');
    await expect(vault.write(path, '覆盖', null)).rejects.toThrow('变化');
    await vault.write(path, '新内容', hash);
    const backup = (await vault.backups())[0]; expect(backup.originalPath).toBe(path);
    expect(JSON.parse((await vault.read(backup.path))!.content).content).toBe('原文\n\n段落');
    expect(readdirSync(join(root, 'Super Productivity/projects/中文/task-notes'))).toEqual(['a.md']);
  });
  it('rejects traversal, absolute paths, drive paths and escaping directory junctions', async () => {
    await expect(vault.write('../outside.md', 'bad', null)).rejects.toThrow('超出');
    await expect(vault.read('C:/outside.md')).rejects.toThrow('相对路径');
    await expect(vault.read('/outside.md')).rejects.toThrow('相对路径');
    const outside = join(directory, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'private.md'), '秘密');
    symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(vault.read('escape/private.md')).rejects.toThrow('符号链接');
    await expect(vault.write('escape/new.md', 'bad', null)).rejects.toThrow('符号链接');
    expect(await vault.listMarkdown()).not.toContain('escape/private.md');
  });
  it('selects directories, excludes internal files, and detects real content changes', async () => {
    writeFileSync(join(root, '笔记.md'), '一'); mkdirSync(join(root, '.obsidian')); writeFileSync(join(root, '.obsidian/ignore.md'), 'config');
    expect((await vault.browse(root)).directory).toBe(realpathSync(root));
    expect(await vault.listMarkdown()).toEqual(['笔记.md']); const before = await vault.fingerprint();
    writeFileSync(join(root, '笔记.md'), '较长的修改'); expect(await vault.fingerprint()).not.toBe(before);
  });
  it('runs the actual engine against independent disk files and reloads its durable state', async () => {
    host.add(task('a', { title: '真实文件测试', notes: '任务说明\n\n第二段' }));
    const config = { ...defaultConfig(), vaultPath: root, projectIds: ['p1'], timezone: 'America/Los_Angeles' };
    const engine = new SyncEngine(host, vault, config); await engine.sync(); expect(engine.issues).toEqual([]);
    const taskPath = taskFile(engine.state, 'p1'); const file = await vault.read(taskPath);
    writeFileSync(join(root, taskPath), file!.content.replace('真实文件测试', '磁盘编辑')); await engine.sync(); expect(host.state.tasks.a.title).toBe('磁盘编辑');
    const restarted = new SyncEngine(host, vault, config); await restarted.sync(); expect(restarted.issues).toEqual([]); expect(restarted.state.baseline.a.title).toBe('磁盘编辑');
    expect(readFileSync(join(root, 'Super Productivity/README.md'), 'utf8')).toContain('AI 编辑指南');
    const notePath=engine.state.notesPaths.a,originalNote=readFileSync(join(root,notePath),'utf8');
    config.language='en';await restarted.sync();expect(restarted.issues).toEqual([]);
    expect(readFileSync(join(root,taskPath),'utf8')).toContain(`[[${notePath.slice(0,-3)}|notes]]`);
    expect(readFileSync(join(root,'Super Productivity/README.md'),'utf8')).toContain('# AI editing guide');
    expect(readFileSync(join(root,notePath),'utf8')).toBe(originalNote);
  });
  it('batches real file reads/writes with preflight, backups and safe note cleanup', async () => {
    const a='Super Productivity/projects/p/task-notes/a.md', b='Super Productivity/projects/q/task-notes/b.md';
    const hashes=await vault.writeMany([{path:a,content:'A'.repeat(5000),expectedHash:null},{path:b,content:'B',expectedHash:null}]);
    const files=await vault.readMany([a,b,'../outside.md']);
    expect(files[a].file?.content).toBe('A'.repeat(5000)); expect(files[b].file?.hash).toBe(hashes[b]); expect(files['../outside.md'].error).toContain('超出');
    await expect(vault.writeMany([{path:a,content:'覆盖A',expectedHash:hashes[a]},{path:b,content:'覆盖B',expectedHash:'wrong'}])).rejects.toThrow('变化');
    expect((await vault.read(a))?.content).toBe('A'.repeat(5000));
    await vault.writeMany([{path:a,content:'新A',expectedHash:hashes[a]},{path:b,content:'新B',expectedHash:hashes[b]}]);
    expect(await vault.backups()).toHaveLength(2);
    await expect(vault.removeTaskNote(a,hashes[a])).rejects.toThrow('变化');
    await vault.removeTaskNote(a,(await vault.read(a))!.hash); expect(await vault.read(a)).toBeNull();
    await vault.write('源笔记.md','保留',null);
    await expect(vault.removeTaskNote('源笔记.md',(await vault.read('源笔记.md'))!.hash)).rejects.toThrow('只能清理');
    expect((await vault.read('源笔记.md'))?.content).toBe('保留');
  });
  it('exports 24 tasks across projects with fewer bridge launches and cleans app-deleted notes on disk', async () => {
    let calls=0; const real=host.executeNodeScript.bind(host);
    host.executeNodeScript=async request=>{ calls++; if(request!.script.length+JSON.stringify(request!.args).length>26000)throw Error('spawn ENAMETOOLONG'); return real(request); };
    for(let index=0;index<24;index++)host.add(task(`t${index}`,{projectId:index%2?'p1':'p2',notes:index%3?'':'任务正文'}));
    const engine=new SyncEngine(host,vault,{...defaultConfig(),vaultPath:root,projectIds:['p1','p2']});
    await engine.sync(); expect(engine.issues).toEqual([]); expect(Object.keys(engine.state.notesPaths)).toHaveLength(24);
    // Individual reads and writes alone would need at least 48 child launches.
    expect(calls).toBeLessThan(48);
    const note=engine.state.notesPaths.t0; delete host.state.tasks.t0; host.state.projects.p2.taskIds=host.state.projects.p2.taskIds.filter(id=>id!=='t0');
    await engine.sync(); expect(engine.issues).toEqual([]); expect(await vault.read(note)).toBeNull();
    expect((await vault.read(engine.state.removed.t0.note!.recoveryPath))?.content).toBe('任务正文');
    expect((await vault.read(taskFile(engine.state,'p1')))?.content).toContain('sp:task:t1');
  });
});
