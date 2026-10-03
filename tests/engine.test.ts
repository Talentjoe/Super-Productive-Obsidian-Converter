import { beforeEach, describe, expect, it } from 'vitest';
import { SyncEngine } from '../src/core/engine';
import { taskFile } from '../src/core/exports';
import { defaultConfig } from '../src/types';
import { FakeHost, MemoryVault, task } from './fakes';
import { noteParts } from '../src/core/references';

let host: FakeHost, vault: MemoryVault, engine: SyncEngine;
beforeEach(() => { host = new FakeHost(); vault = new MemoryVault(); engine = new SyncEngine(host, vault, { ...defaultConfig(), vaultPath: 'vault', projectIds: ['p1', 'p2'], timezone: 'America/Los_Angeles' }); });
const sync = async () => { await engine.sync(); expect(engine.issues.filter((issue) => issue.code === 'sync-failed')).toEqual([]); };
const text = (path: string) => vault.files.get(path)!;
const change = (path: string, from: string, to: string) => vault.files.set(path, text(path).replace(from, to));

describe('engine integration', () => {
  it('preserves native tagged children, exports other projects and still imports editable fields', async () => {
    host.state.tags={explore:{id:'explore',title:'Explore'},grad:{id:'grad',title:'Grad'},task:{id:'task',title:'Task'}};
    host.add(task('parent',{title:'尝试联系导师',tagIds:['explore','grad']}));
    host.add(task('doneChild',{title:'已完成子任务',parentId:'parent',tagIds:['grad'],isDone:true}));
    host.add(task('openChild',{title:'未完成子任务',parentId:'parent',tagIds:['grad']}));
    host.add(task('gpu',{title:'开发父任务',tagIds:['task']}));
    host.add(task('barrier',{title:'耗时子任务',parentId:'gpu',tagIds:['task'],timeEstimate:3600000}));
    host.add(task('other',{projectId:'p2',notes:'另一个项目'}));
    await sync();expect(engine.issues).toEqual([]);
    const file=taskFile(engine.state,'p1');
    expect(text(file)).toContain('未完成子任务 #Grad');expect(text(file)).toContain('耗时子任务 #Task');
    expect(text(taskFile(engine.state,'p2'))).toContain('sp:task:other');
    change(file,'- [ ] 未完成子任务 ','- [x] 未完成子任务 ');
    change(file,'耗时子任务 #Task','耗时子任务 修改 #Task');
    await sync();expect(engine.issues).toEqual([]);expect(host.state.tasks.openChild.isDone).toBe(true);
    expect(host.state.tasks.barrier.title).toBe('耗时子任务 修改');
    expect(host.state.tasks.doneChild.tagIds).toEqual(['grad']);expect(host.state.tasks.openChild.tagIds).toEqual(['grad']);
    expect(host.state.tasks.barrier.tagIds).toEqual(['task']);
    change(file,'未完成子任务 #Grad','未完成子任务 #Explore');
    await sync();expect(engine.issues).toEqual([]);
    expect(text(file)).toContain('未完成子任务 #Grad');expect(host.state.tasks.openChild.tagIds).toEqual(['grad']);
  });
  it('preserves native tags when promoting tagged or untagged children and reattaching roots', async () => {
    host.state.tags={a:{id:'a',title:'父标签'},b:{id:'b',title:'子标签'}};
    host.add(task('parent',{tagIds:['a']}));host.add(task('own',{parentId:'parent',tagIds:['b']}));host.add(task('empty',{parentId:'parent'}));
    await sync();const path=taskFile(engine.state,'p1');
    change(path,'  - [ ] own','- [ ] own');change(path,'  - [ ] empty','- [ ] empty');
    await sync();expect(engine.issues).toEqual([]);
    expect(host.state.tasks.own.tagIds).toEqual(['b']);expect(host.state.tasks.empty.tagIds).toEqual(['a']);
    change(path,'- [ ] own','  - [ ] own');change(path,'- [ ] empty','  - [ ] empty');
    await sync();expect(engine.issues).toEqual([]);
    expect(host.state.tasks.own.tagIds).toEqual(['b']);expect(host.state.tasks.empty.tagIds).toEqual(['a']);
  });
  it('still pauses a root when the host rejects an editable tag change', async () => {
    host.state.tags={a:{id:'a',title:'旧标签'},b:{id:'b',title:'新标签'}};host.add(task('root',{tagIds:['a']}));
    await sync();const path=taskFile(engine.state,'p1');change(path,'#旧标签','#新标签');
    const update=host.updateTask.bind(host);host.updateTask=async(id,fields)=>{const {tagIds:_rejected,...other}=fields;await update(id,other);};
    await sync();expect(engine.issues.some(issue=>issue.code==='verification-paused'&&issue.message.includes('tags'))).toBe(true);
    expect(engine.state.baseline.root.tags).toEqual(['旧标签']);expect(text(path)).toContain('#新标签');
  });
  it('migrates legacy note links without changing task identity, note path, YAML or body', async () => {
    host.add(task('a',{notes:'保留正文'}));await sync();const path=taskFile(engine.state,'p1'),note=engine.state.notesPaths.a;
    vault.files.set(note,'---\ncustom: yes\n---\n保留正文');
    change(path,`[[${note.slice(0,-3)}|笔记]]`,`[sp-notes:: [[${note.slice(0,-3)}]]]`);
    await sync();expect(engine.issues).toEqual([]);expect(engine.state.notesPaths.a).toBe(note);expect(host.created).toBe(0);
    expect(text(path)).toContain(`[[${note.slice(0,-3)}|笔记]]`);expect(text(path)).not.toContain('[sp-notes::');
    expect(text(note)).toBe('---\ncustom: yes\n---\n保留正文');expect(host.state.tasks.a.notes).toBe('保留正文');
  });
  it('exports host tasks, long notes and AI guide, then repeats without changing content', async () => {
    host.add(task('a', { title: '任务', notes: '第一段\n\n第二段\n```\n- [ ] code\n```' }));
    await sync(); const path = taskFile(engine.state, 'p1');
    expect(text(path)).toContain('sp:task:a'); expect(text(engine.state.notesPaths.a)).toContain('第二段');
    expect(text('Super Productivity/README.md')).toContain('AI 编辑指南');
    expect([...vault.files.keys()].some((path) => path.includes('/project-notes/') || path.includes('/archive/'))).toBe(false);
    const files = new Map([...vault.files].filter(([p]) => !p.includes('/.sp-sync/'))), count = host.calls.length;
    await sync(); expect(new Map([...vault.files].filter(([p]) => !p.includes('/.sp-sync/')))).toEqual(files); expect(host.calls.length).toBe(count);
  });
  it('creates same-title tasks and subtasks, imports dates and tags without title matching', async () => {
    await sync(); const path = taskFile(engine.state, 'p1');
    vault.files.set(path, text(path) + '- [ ] 同名 #工作 ⏳ 2026-10-03 [sp-planned-time:: 14:00] 📅 2026-10-05 [sp-estimate-minutes:: 90]\n  - [ ] 子任务 [sp-estimate-minutes:: 90]\n- [ ] 同名\n');
    await sync(); expect(host.created).toBe(3);
    const root = Object.values(host.state.tasks).find((task) => task.title === '同名' && task.subTaskIds.length)!;
    expect(root.timeEstimate).toBe(5400000); expect(root.deadlineDay).toBe('2026-10-05'); expect(root.dueDay).toBeNull(); expect(root.dueWithTime).toBeTruthy();
    expect(host.state.tasks[root.subTaskIds[0]].parentId).toBe(root.id);
    await sync(); expect(host.created).toBe(3); expect(engine.state.journal).toEqual({});
  });
  it('merges different fields and backs up same-field conflicts with host priority', async () => {
    host.add(task('a', { title: '原名', notes: '旧笔记' })); await sync(); const path = taskFile(engine.state, 'p1');
    host.state.tasks.a.title = '应用新名'; change(path, '- [ ]', '- [x]'); await sync();
    expect(host.state.tasks.a.isDone).toBe(true); expect(text(path)).toContain('应用新名');
    host.state.tasks.a.notes = '应用笔记'; vault.files.set(engine.state.notesPaths.a, '文件笔记'); await sync();
    expect(host.state.tasks.a.notes).toBe('应用笔记'); expect(engine.issues.some((issue) => issue.code === 'task-conflict')).toBe(true);
    const backup = [...vault.backupRecords].reverse().find((record) => record.originalPath === engine.state.notesPaths.a)!;
    expect(JSON.parse(text(backup.path)).content).toBe('文件笔记');
  });
  it('marks removed tasks, keeps notes and family, never reintroduces until restored', async () => {
    host.add(task('a', { notes: '保留内容' })); host.add(task('child', { parentId: 'a', notes: '子内容' })); await sync(); const path = taskFile(engine.state, 'p1');
    vault.files.set(path, text(path).split('\n').filter((line) => !line.includes('sp:task:')).join('\n'));
    await sync(); expect(host.state.tasks.a).toBeDefined(); expect(host.state.tasks.child).toBeDefined(); expect(engine.state.removed.a).toBeDefined();
    expect(Object.values(host.state.tags).find((tag) => tag.title === 'sync-removed')).toBeDefined();
    await sync(); expect(text(path)).not.toContain('sp:task:a');
    await engine.restore('a'); await sync(); expect(text(path)).toContain('sp:task:a'); expect(text(path)).toContain('sp:task:child'); expect(text(engine.state.notesPaths.a)).toBe('保留内容');
  });
  it('moves families between selected projects without marking them removed', async () => {
    host.add(task('a')); host.add(task('child', { parentId: 'a' })); await sync();
    const p1 = taskFile(engine.state, 'p1'), p2 = taskFile(engine.state, 'p2');
    const lines = text(p1).split('\n').filter((line) => line.includes('sp:task:'));
    vault.files.set(p1, text(p1).split('\n').filter((line) => !line.includes('sp:task:')).join('\n')); vault.files.set(p2, text(p2) + lines.join('\n') + '\n');
    await sync(); expect(host.state.tasks.a.projectId).toBe('p2'); expect(host.state.tasks.child.projectId).toBe('p2'); expect(engine.state.removed).toEqual({});
    expect(text(p2)).toContain('sp:task:child');
  });
  it('promotes and reattaches children using the relational API', async () => {
    host.add(task('a')); host.add(task('b')); host.add(task('child', { parentId: 'a' })); await sync(); const path = taskFile(engine.state, 'p1');
    change(path, '  - [ ] child', '- [ ] child'); await sync(); expect(host.state.tasks.child.parentId).toBeNull();
    const lines = text(path).split('\n'), child = lines.find((line) => line.includes('sp:task:child'))!;
    const remaining = lines.filter((line) => line !== child); const b = remaining.findIndex((line) => line.includes('sp:task:b')); remaining.splice(b + 1, 0, '  ' + child);
    vault.files.set(path, remaining.join('\n')); await sync(); expect(host.state.tasks.child.parentId).toBe('b'); expect(host.calls).toContain('relation:child');
  });
  it('pauses missing/invalid files without host changes and explicitly rebuilds missing files', async () => {
    host.add(task('a')); await sync(); const path = taskFile(engine.state, 'p1'), count = host.calls.length;
    vault.files.delete(path); await engine.sync(); expect(engine.issues.at(-1)?.message).toContain('缺失'); expect(host.calls.length).toBe(count); expect(engine.state.removed).toEqual({});
    await engine.rebuild('p1'); await sync(); expect(text(path)).toContain('sp:task:a');
    vault.files.set(path, text(path) + '\n- [ ] 根\n  - [ ] 子\n    - [ ] 孙'); await engine.sync(); expect(engine.issues.at(-1)?.code).toBe('file-paused'); expect(host.created).toBe(0);
  });
  it('keeps first-sync host tasks when pre-existing Markdown only contains new tasks', async () => {
    host.add(task('a'));
    await engine.initialize(); engine.state.projects.p1 = { directory: 'Super Productivity/projects/existing', initialized: false, title: '项目一' };
    vault.files.set(taskFile(engine.state, 'p1'), '---\ncustom: yes\n---\n# 自由标题\n- [ ] 新任务\n'); await sync();
    expect(host.state.tasks.a).toBeDefined(); expect(host.created).toBe(1); expect(engine.state.removed).toEqual({});
  });
  it('synchronizes shared whole-note references in both directions preserving YAML', async () => {
    vault.files.set('资料/方案.md', '---\ncustom: true\n---\n原文\n\n- [ ] 普通正文\n');
    host.add(task('a', { notes: '按 [[资料/方案]] 做。' })); host.add(task('b', { notes: '也参考 [[资料/方案]]。' })); await sync();
    expect(host.state.tasks.a.notes).toContain('原文'); expect(host.created).toBe(0);
    host.state.tasks.a.notes = host.state.tasks.a.notes!.replace('原文', '应用修改'); await sync();
    expect(text('资料/方案.md')).toBe('---\ncustom: true\n---\n应用修改\n\n- [ ] 普通正文\n'); expect(host.state.tasks.b.notes).toContain('应用修改');
    change('资料/方案.md', '应用修改', '源文件修改'); await sync(); expect(host.state.tasks.a.notes).toContain('源文件修改');
    expect(noteParts(host.state.tasks.a.notes!).own).toBe('按 [[资料/方案]] 做。');
  });
  it('keeps divergent reference copies and lets the user choose a version', async () => {
    vault.files.set('方案.md', '原文'); host.add(task('a', { notes: '[[方案]]' })); host.add(task('b', { notes: '[[方案]]' })); await sync();
    host.state.tasks.a.notes = host.state.tasks.a.notes!.replace('\n原文\n', '\n版本A\n'); host.state.tasks.b.notes = host.state.tasks.b.notes!.replace('\n原文\n', '\n版本B\n'); await sync();
    expect(text('方案.md')).toBe('原文'); expect(engine.issues.some((issue) => issue.code === 'reference-conflict')).toBe(true);
    await engine.resolveReference('方案.md', '版本A'); await sync(); expect(text('方案.md')).toBe('版本A'); expect(host.state.tasks.b.notes).toContain('版本A');
  });
  it('stores expected finish and preserves free daily plans while clearing stale indexes', async () => {
    host.add(task('a', { dueDay: '2026-10-03' })); await sync(); const daily = 'Super Productivity/calendar/2026-10-03.md';
    change(daily, '## 下一步计划', '## 下一步计划\n\n手写计划');
    await engine.setExpectedFinish('a', '2026-10-04T16:00:00-07:00'); await sync();
    expect(text(taskFile(engine.state, 'p1'))).toContain('sp-expected-finish'); expect(text('Super Productivity/calendar/2026-10-04.md')).toContain('预计完成');
    host.state.tasks.a.dueDay = null; await sync(); expect(text(daily)).toContain('手写计划'); expect(text(daily)).not.toContain('计划执行：');
  });
  it('exports optional project notes and archive families only when enabled', async () => {
    host.state.notes.n = { id: 'n', projectId: 'p1', content: '项目背景', created: 1, modified: 2 };
    host.archived = [task('old', { isDone: true, doneOn: Date.UTC(2026, 8, 2), notes: '历史说明', subTaskIds: ['old-child'] }), task('old-child', { parentId: 'old', isDone: true, doneOn: Date.UTC(2026, 8, 2), notes: '历史子说明' })];
    await sync(); expect([...vault.files.keys()].some((p) => p.includes('/project-notes/'))).toBe(false);
    engine.config.exportProjectNotes = true; engine.config.exportArchive = true; await sync();
    expect([...vault.files.values()].some((body) => body.includes('项目背景'))).toBe(true); expect([...vault.files.values()].some((body) => body.includes('历史子说明'))).toBe(true);
  });
  it('reuses a durable creation marker after crashing between host create and ID persistence', async () => {
    await sync(); const path = taskFile(engine.state, 'p1'); vault.files.set(path, text(path) + '- [ ] 新任务\n');
    let crash = true;
    host.afterCreate = () => { vault.beforeWrite = (file) => { if (file.endsWith('/state.json') && crash) { crash = false; throw new Error('模拟断电'); } }; };
    await engine.sync(); expect(host.created).toBe(1);
    host.afterCreate = undefined; vault.beforeWrite = undefined;
    engine = new SyncEngine(host, vault, engine.config); await sync(); expect(host.created).toBe(1); expect(text(path)).toContain('新任务');
  });
  it('does not advance the common baseline after a concurrent file overwrite', async () => {
    host.add(task('a', { title: '原名' })); await sync(); const path = taskFile(engine.state, 'p1'); const base = structuredClone(engine.state.baseline);
    host.state.tasks.a.title = '应用修改'; let once = true;
    vault.beforeWrite = (file) => { if (file === path && once) { once = false; vault.files.set(file, text(file) + '\n并发正文'); } };
    await engine.sync(); expect(engine.issues.at(-1)?.message).toContain('变化'); expect(engine.state.baseline).toEqual(base); expect(text(path)).toContain('并发正文');
    vault.beforeWrite = undefined; await sync(); expect(text(path)).toContain('并发正文');
  });
  it('suspends the complete family when only the parent line is removed', async () => {
    host.add(task('previous')); host.add(task('a')); host.add(task('child', { parentId: 'a', notes: '保存子内容' })); await sync();
    const path = taskFile(engine.state, 'p1');
    vault.files.set(path, text(path).split('\n').filter((line) => !line.includes('sp:task:a ')).join('\n'));
    await sync(); expect(Object.keys(engine.state.removed).sort()).toEqual(['a', 'child']);
    expect(host.state.tasks.child.parentId).toBe('a'); expect(text(path)).not.toContain('sp:task:child');
    expect(host.state.tasks.child.notes).toBe('保存子内容'); await engine.restore('a'); await sync();
    expect(text(path)).toContain('sp:task:child');
  });
  it('marks a retained parent when only a child line is removed without completing it', async () => {
    host.add(task('a')); host.add(task('child', { parentId: 'a' })); await sync(); const path = taskFile(engine.state, 'p1');
    vault.files.set(path, text(path).split('\n').filter((line) => !line.includes('sp:task:child ')).join('\n'));
    await sync(); expect(Object.keys(engine.state.removed)).toEqual(['child']);
    const marker = Object.values(host.state.tags).find((tag) => tag.title === 'sync-removed')!;
    expect(host.state.tasks.a.tagIds).toContain(marker.id); expect(host.state.tasks.child.isDone).toBe(false);
    await sync(); expect(host.state.tasks.a.tagIds).toContain(marker.id); await engine.restore('child'); await sync();
    expect(host.state.tasks.a.tagIds).not.toContain(marker.id);
  });
  it('imports root and child ordering and backlog membership without dropping host tasks', async () => {
    host.add(task('a')); host.add(task('b')); host.add(task('c1', { parentId: 'a' })); host.add(task('c2', { parentId: 'a' })); await sync();
    const path = taskFile(engine.state, 'p1'), doc = text(path).split('\n');
    const line = (id: string) => doc.find((l) => l.includes(`sp:task:${id} `))!;
    vault.files.set(path, doc.filter((l) => !l.includes('sp:task:')).join('\n') + [line('b'), line('a'), line('c2'), line('c1')].join('\n') + '\n');
    await sync(); expect(host.state.projects.p1.taskIds).toEqual(['b', 'a']); expect(host.state.tasks.a.subTaskIds).toEqual(['c2', 'c1']);
    change(path, '- [ ] b ', '- [ ] b [sp-list:: backlog] '); await sync(); expect(host.state.projects.p1.backlogTaskIds).toEqual(['b']);
    engine.config.projectIds = ['p2']; const before = text(path); await sync(); expect(text(path)).toBe(before); expect(host.state.tasks.b).toBeDefined();
  });
  it('imports project and tag YAML properties while preserving user attributes', async () => {
    host.state.tags.t = { id: 't', title: '工作', color: '#123456' }; host.add(task('a', { tagIds: ['t'] })); await sync();
    const path = taskFile(engine.state, 'p1'); change(path, 'sp-project-title: "项目一"', 'custom: yes\nsp-project-title: "新项目"');
    const tagPath = [...vault.files.keys()].find((p) => p.includes('/tags/'))!;
    change(tagPath, 'sp-tag-title: "工作"', 'sp-tag-title: "新标签"'); change(tagPath, '"#123456"', '"#abcdef"'); await sync();
    expect(host.state.projects.p1.title).toBe('新项目'); expect(host.state.tags.t).toMatchObject({ title: '新标签', color: '#abcdef' }); expect(text(path)).toContain('custom: yes');
  });
  it('keeps a newly imported row position even when the host inserts new tasks at the front', async () => {
    host.add(task('old')); await sync();
    host.afterCreate = () => { const project = host.state.projects.p1; project.taskIds.reverse(); };
    const path = taskFile(engine.state, 'p1'); vault.files.set(path, text(path) + '- [ ] 新任务\n');
    await sync(); expect(engine.issues).toEqual([]); expect(host.state.projects.p1.taskIds).toEqual(['old', 'new-1']);
  });
  it('never writes local project-note edits into native project notes', async () => {
    host.state.notes.n = { id: 'n', projectId: 'p1', content: '项目背景', created: 1, modified: 1 };
    engine.config.exportProjectNotes = true; await sync(); const path = [...vault.files.keys()].find((p) => p.includes('/project-notes/'))!;
    change(path, '项目背景', '文件编辑'); await sync(); expect(host.state.notes.n.content).toBe('项目背景'); expect(text(path)).toContain('项目背景');
    expect(vault.backupRecords.some((b) => b.originalPath === path)).toBe(true);
  });
  it('preserves timestamp seconds when unchanged and stops on a concurrent host edit', async () => {
    const exact = Date.parse('2026-10-03T14:00:23-07:00'); host.add(task('a', { dueWithTime: exact })); await sync(); expect(host.state.tasks.a.dueWithTime).toBe(exact);
    change(taskFile(engine.state, 'p1'), '- [ ] a ', '- [ ] 文件名 ');
    const list = vault.listMarkdown.bind(vault); vault.listMarkdown = async () => { host.state.tasks.a.title = '同步期间的新修改'; return list(); };
    const base = structuredClone(engine.state.baseline); await engine.sync(); expect(engine.issues.at(-1)?.message).toContain('应用任务已变化');
    expect(host.state.tasks.a.title).toBe('同步期间的新修改'); expect(engine.state.baseline).toEqual(base);
    vault.listMarkdown = list; await sync(); expect(host.state.tasks.a.title).toBe('同步期间的新修改');
  });
  it('pauses a malformed project while another selected project can still sync', async () => {
    host.add(task('a')); host.add(task('b',{projectId:'p2'})); await sync();
    const bad = taskFile(engine.state,'p1'), good = taskFile(engine.state,'p2');
    vault.files.set(bad,text(bad)+'\n- [ ] 错误 📅 2026-02-30'); const original = text(bad);
    change(good,'- [ ] b ','- [x] b '); await sync();
    expect(host.state.tasks.b.isDone).toBe(true); expect(host.state.tasks.a.isDone).toBe(false);
    expect(engine.issues.some(i=>i.code==='file-paused')).toBe(true); expect(text(bad)).toBe(original); expect(engine.state.removed).toEqual({});
  });
  it('exports reversible aliases for special, numeric and case-colliding tag names', async () => {
    host.state.tags = { a:{id:'a',title:'C++'}, b:{id:'b',title:'123'}, c:{id:'c',title:'Work'}, d:{id:'d',title:'work'} };
    host.add(task('a',{tagIds:['a','b','c','d']})); await sync(); const aliases = engine.state.tagAliases;
    expect(aliases.a).toBe('C----61'); expect(aliases.b).toBe('123--62'); expect(aliases.c.toLowerCase()).not.toBe(aliases.d.toLowerCase());
    const path = taskFile(engine.state,'p1'); change(path,'#Work ','#WORK '); await sync();
    expect(host.state.tasks.a.tagIds.sort()).toEqual(['a','b','c','d']); expect(engine.issues).toEqual([]);
  });
  it('exports multiple selected projects and an empty Inbox note with stable identity', async () => {
    host.state.projects.INBOX_PROJECT = { id: 'INBOX_PROJECT', title: 'Inbox', taskIds: [], backlogTaskIds: [] };
    engine.config.projectIds.push('INBOX_PROJECT');
    host.add(task('inbox', { projectId: 'INBOX_PROJECT', title: 'Inbox 新任务' }));
    host.add(task('a', { notes: '项目一正文' })); host.add(task('b', { projectId: 'p2', notes: '项目二正文' }));
    // Older imports can omit the native project field even while in Inbox membership.
    host.state.tasks.inbox.projectId = undefined as unknown as string;
    await sync();
    for (const id of ['p1','p2','INBOX_PROJECT']) expect(text(taskFile(engine.state,id))).toContain('sp-project-id');
    expect(text(engine.state.notesPaths.inbox)).toContain('sp-task-id: "inbox"');
    expect(text(engine.state.notesPaths.a)).toBe('项目一正文'); expect(text(engine.state.notesPaths.b)).toBe('项目二正文');
    const persisted = JSON.stringify([...vault.files].filter(([path]) => !path.includes('/.sp-sync/')));
    await sync(); expect(JSON.stringify([...vault.files].filter(([path]) => !path.includes('/.sp-sync/')))).toBe(persisted);
  });
  it('follows the native parent remaining estimate and keeps other projects exporting', async () => {
    await sync(); const p1=taskFile(engine.state,'p1'), p2=taskFile(engine.state,'p2');
    vault.files.set(p1,text(p1)+'- [ ] 独立任务 estimate [60min](sp-estimate-minutes:: 60)\n');
    vault.files.set(p2,text(p2)+'- [ ] 父任务 [sp-estimate-minutes:: 90]\n  - [ ] 子任务 estimate [30min](sp-estimate-minutes:: 30)\n');
    await sync(); expect(engine.issues).toEqual([]);
    const parent=Object.values(host.state.tasks).find(task=>task.title==='父任务')!;
    expect(parent.timeEstimate).toBe(1800000); expect(text(p2)).toContain('estimate [30min](<sp-estimate-minutes:: 30>)');
    expect(text(p1)).toContain('estimate [60min](<sp-estimate-minutes:: 60>)');
    host.state.tasks[parent.subTaskIds[0]].timeSpent=600000;
    change(p2,'- [ ] 子任务 estimate [30min](<sp-estimate-minutes:: 30>)','- [ ] 子任务 estimate [45min](<sp-estimate-minutes:: 45>)');
    await sync(); expect(parent.timeEstimate).toBe(2100000);
    expect(text(p2)).toContain('父任务 estimate [35min](<sp-estimate-minutes:: 35>)');
  });
  it('isolates readback rejection to its project and reports mismatched fields', async () => {
    host.add(task('a')); host.add(task('b',{projectId:'p2'})); await sync();
    const bad=taskFile(engine.state,'p1'), good=taskFile(engine.state,'p2'); const original=text(bad);
    change(bad,'- [ ] a ','- [ ] 被宿主拒绝的标题 '); change(good,'- [ ] b ','- [x] b ');
    const update=host.updateTask.bind(host); host.updateTask=async(id,fields)=>{ if(id==='a') return; return update(id,fields); };
    await sync(); expect(engine.issues.find(issue=>issue.code==='verification-paused')?.message).toContain('title');
    expect(text(bad)).toBe(original.replace('- [ ] a ','- [ ] 被宿主拒绝的标题 '));
    expect(engine.state.baseline.a.title).toBe('a'); expect(host.state.tasks.b.isDone).toBe(true); expect(text(good)).toContain('- [x] b ');
    host.updateTask=update; await sync(); expect(host.state.tasks.a.title).toBe('被宿主拒绝的标题');
  });
  it('isolates invalid native relationships instead of blocking every selected project', async () => {
    host.add(task('a')); host.add(task('parent',{projectId:'p2'})); host.add(task('child',{projectId:'p2',parentId:'parent'}));
    host.add(task('grandchild',{projectId:'p2',parentId:'child'}));
    await sync(); expect(text(taskFile(engine.state,'p1'))).toContain('sp:task:a'); expect(engine.issues.some(issue=>issue.code==='file-paused')).toBe(true);
    expect(vault.files.has(taskFile(engine.state,'p2'))).toBe(false);
  });
  it('cleans deleted-row notes after a durable recovery copy, preserves sources and restores YAML/body', async () => {
    vault.files.set('共享源.md','原始源文件'); host.add(task('a',{notes:'[[共享源]]'})); await sync();
    const path=taskFile(engine.state,'p1'), note=engine.state.notesPaths.a;
    vault.files.set(note,'---\ncustom: yes\n---\n移除前未同步的正文\n');
    vault.files.set(path,text(path).split('\n').filter(line=>!line.includes('sp:task:a ')).join('\n'));
    await sync(); expect(vault.files.has(note)).toBe(false); expect(host.state.tasks.a).toBeDefined();
    const record=engine.state.removed.a; expect(text(record.note!.recoveryPath)).toBe('---\ncustom: yes\n---\n移除前未同步的正文\n');
    expect(text('共享源.md')).toBe('原始源文件');
    engine=new SyncEngine(host,vault,engine.config); await sync(); expect(vault.files.has(note)).toBe(false);
    await engine.restore('a'); await sync(); expect(text(note)).toBe('---\ncustom: yes\n---\n移除前未同步的正文\n');
    expect(host.state.tasks.a.notes).toBe('移除前未同步的正文\n'); expect(text(path)).toContain('sp:task:a');
  });
  it('cleans notes when tasks are deleted in the app without resurrecting their Markdown IDs', async () => {
    host.add(task('a',{notes:'恢复正文'})); await sync(); const note=engine.state.notesPaths.a, doc=taskFile(engine.state,'p1');
    delete host.state.tasks.a; host.state.projects.p1.taskIds=[]; await sync();
    expect(vault.files.has(note)).toBe(false); expect(text(doc)).not.toContain('sp:task:a');
    expect(text(engine.state.removed.a.note!.recoveryPath)).toBe('恢复正文');
    await sync(); expect(host.created).toBe(0); expect(vault.files.has(note)).toBe(false);
  });
  it('keeps concurrent note changes during cleanup and retries without losing either recovery version', async () => {
    host.add(task('a',{notes:'原笔记'})); await sync(); const note=engine.state.notesPaths.a, doc=taskFile(engine.state,'p1');
    vault.files.set(doc,text(doc).split('\n').filter(line=>!line.includes('sp:task:a ')).join('\n'));
    let once=true; vault.beforeWrite=path=>{ if(path===note&&once){once=false;vault.files.set(note,'并发修改');} };
    await sync(); expect(text(note)).toBe('并发修改'); expect(engine.issues.some(issue=>issue.code==='note-cleanup-paused')).toBe(true);
    const previous=engine.state.removed.a.note!.recoveryPath;
    vault.beforeWrite=undefined; await sync(); expect(vault.files.has(note)).toBe(false);
    expect(text(previous)).toBe('原笔记'); expect(text(engine.state.removed.a.note!.recoveryPath)).toBe('并发修改');
  });
});
