import type { AppSnapshot, FileSnapshot, FileWrite, HostAPI, HostTask, Issue, RemovedTask, SyncConfig, SyncState, TaskValue, VaultIO } from '../types';
import { readSnapshot } from '../adapters/snapshot';
import { emptyState } from '../types';
import { timestamp, validateExpected } from './dates';
import { ROOT, indexExports, isTagAlias, tagAliases, taskFile, valueFromHost } from './exports';
import { getGuide } from './guide';
import { translate } from '../i18n';
import { equal, mergeTask } from './merge';
import { parseTasks, renderRow, rewriteTasks, stampOperation, type TaskDocument, type TaskRow } from './markdown';
import { property, setProperty } from './properties';
import { composeNote, excerpt, noteParts, referenceTargets, resolveReference } from './references';
import { frontmatterBody, generatedBlock, link, operationMarker, safeName, stableId, stripOperationMarkers } from './text';

const STATE_PATH = `${ROOT}/.sp-sync/state.json`;
interface Document { path: string; snapshot: FileSnapshot | null; document: TaskDocument }
interface Candidate { id: string; value: TaskValue; host: TaskValue; file?: TaskValue; row?: TaskRow; conflicts: string[] }
export class SyncEngine {
  state: SyncState = emptyState(); issues: Issue[] = []; running = false;
  private stateHash: string | null = null;
  private stateContent: string | null = null;
  private files = new Map<string, FileSnapshot | null>();
  private readErrors = new Map<string, string>();
  private initialized = false;
  private disposed = false;
  constructor(public api: HostAPI, public io: VaultIO, public config: SyncConfig) {}
  dispose(): void { this.disposed = true; }
  private assertActive(): void { if (this.disposed) throw new Error('插件已停用'); }
  private async read(path: string): Promise<FileSnapshot | null> {
    if (this.readErrors.has(path)) throw new Error(this.readErrors.get(path));
    if (!this.files.has(path)) this.files.set(path, await this.io.read(path));
    return this.files.get(path)!;
  }
  private async prefetch(paths: string[]): Promise<void> {
    if (!this.io.readMany) return;
    const pending = [...new Set(paths)].filter(path => !this.files.has(path) && !this.readErrors.has(path));
    for (let offset = 0; offset < pending.length; offset += 8) {
      const results = await this.io.readMany(pending.slice(offset, offset + 8));
      for (const [path, result] of Object.entries(results)) {
        if (result.error) this.readErrors.set(path, result.error); else this.files.set(path, result.file);
      }
    }
  }
  private async writeSet(entries: Array<{ path: string; content: string }>): Promise<void> {
    await this.prefetch(entries.map(entry => entry.path));
    const operations: FileWrite[] = [];
    for (const entry of entries) {
      const previous = await this.read(entry.path);
      if (previous?.content !== entry.content) operations.push({ ...entry, expectedHash: previous?.hash ?? null });
    }
    if (!this.io.writeMany) { for (const op of operations) await this.write(op.path, op.content); return; }
    for (let offset = 0; offset < operations.length; offset += 8) {
      this.assertActive();
      const group = operations.slice(offset, offset + 8), hashes = await this.io.writeMany(group);
      for (const op of group) { this.files.set(op.path, { content: op.content, hash: hashes[op.path] }); this.state.fileHashes[op.path] = hashes[op.path]; }
    }
  }
  private async write(path: string, content: string): Promise<void> {
    this.assertActive();
    const previous = await this.read(path);
    if (previous?.content === content) return;
    const hash = await this.io.write(path, content, previous?.hash ?? null);
    this.files.set(path, { content, hash }); this.state.fileHashes[path] = hash;
  }
  private async saveState(): Promise<void> {
    this.assertActive();
    const content = JSON.stringify(this.state, null, 2);
    if (content === this.stateContent) return;
    this.stateHash = await this.io.write(STATE_PATH, content, this.stateHash); this.stateContent = content;
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const version = this.api.cfg.appVersion.split('.').map(Number);
    if (this.api.cfg.platform !== 'desktop' || version[0] < 19 || (version[0] === 19 && version[1] < 1)) throw new Error('需要 Super Productivity 19.1.0 或更新的桌面版');
    if (typeof this.api.getAppState !== 'function' || typeof this.api.onReady !== 'function') throw new Error('主程序缺少必要插件接口');
    const saved = await this.io.read(STATE_PATH);
    if (saved) {
      const parsed: SyncState = JSON.parse(saved.content);
      if (parsed.version !== 1 || !parsed.projects || !parsed.baseline || !parsed.journal || !parsed.removed || !parsed.references) throw new Error('同步状态格式无效，保留文件并从备份恢复');
      this.state = { ...emptyState(), ...parsed }; this.stateHash = saved.hash; this.stateContent = saved.content;
    }
    this.initialized = true;
  }
  private issue(code: string, message: string, extra: Partial<Issue> = {}): void { this.issues.push({ code, message, ...extra }); }
  private hostValue(task: HostTask, snapshot: AppSnapshot): TaskValue {
    const value = valueFromHost(task, this.state, this.config.timezone, snapshot.projects[task.projectId]);
    value.notes = stripOperationMarkers(value.notes); return value;
  }
  private async metadata(snapshot: AppSnapshot): Promise<void> {
    for (const task of Object.values(snapshot.tasks).filter((t) => this.config.projectIds.includes(t.projectId))) {
      const data = await this.api.loadSyncedData(`task-${task.id}`);
      if (data) { const parsed = JSON.parse(data); if (parsed.version !== 1) throw new Error('不支持的预计完成时间数据版本'); validateExpected(parsed.expectedFinish); this.state.metadata[task.id] = parsed; }
    }
  }
  async setExpectedFinish(id: string, expectedFinish: string | null): Promise<void> {
    await this.initialize(); validateExpected(expectedFinish);
    const snapshot = await readSnapshot(this.api);
    if (!snapshot.tasks[id] || !this.config.projectIds.includes(snapshot.tasks[id].projectId)) throw new Error('只能修改已选择项目的任务');
    const data = { version: 1 as const, expectedFinish };
    await this.api.persistDataSynced(JSON.stringify(data), `task-${id}`); this.state.metadata[id] = data; await this.saveState();
  }
  private async reconcileNames(snapshot: AppSnapshot, docs: Map<string, Document>): Promise<void> {
    for (const [id, doc] of docs) {
      const project = snapshot.projects[id], binding = this.state.projects[id];
      const fileTitle = property(doc.document.content, 'sp-project-title');
      if (fileTitle !== undefined && fileTitle !== null && fileTitle !== project.title) {
        if (!fileTitle.trim()) throw new Error('项目名称不能为空');
        if (binding.title === project.title) { await this.api.updateProject(id, { title: fileTitle }); project.title = fileTitle; }
        else this.issue('project-conflict', '项目名称冲突，应用名称优先', { path: doc.path });
      }
    }
    for (const tag of Object.values(snapshot.tags)) {
      if (tag.id === 'TODAY') continue;
      const path = this.tagPath(tag.id);
      const file = await this.read(path); if (!file) continue;
      const base = this.state.tagMetadata[tag.id];
      const next = { title: tag.title, color: tag.color || null };
      for (const [field, key] of [['title', 'sp-tag-title'], ['color', 'sp-tag-color']] as const) {
        const value = property(file.content, key);
        if (value === undefined || value === next[field]) continue;
        if (field === 'title' && !value?.trim()) throw new Error('标签名称不能为空');
        if (field === 'color' && value !== null && !/^#[a-f0-9]{6}$/i.test(value)) throw new Error('标签颜色必须为 #RRGGBB 或 null');
        if (base && base[field] === next[field]) (next as Record<string, string | null>)[field] = value;
        else this.issue('tag-conflict', '标签属性冲突，应用属性优先', { path });
      }
      if (next.title !== tag.title || next.color !== (tag.color || null)) { await this.api.updateTag(tag.id, next); Object.assign(tag, next); }
    }
  }
  private tagPath(id: string): string { return `${ROOT}/tags/${safeName(this.state.tagAliases[id])}--${stableId(id)}.md`; }
  private parse(content: string, projectId: string): TaskDocument {
    return parseTasks(content, projectId, Object.fromEntries(Object.entries(this.state.baseline).map(([id, value]) => [id, value.parentId])));
  }
  private async readDocuments(snapshot: AppSnapshot): Promise<Map<string, Document>> {
    const docs = new Map<string, Document>();
    for (const id of this.config.projectIds) {
      const project = snapshot.projects[id];
      if (project && !this.state.projects[id]) this.state.projects[id] = { directory: `${ROOT}/projects/${safeName(project.title)}--${stableId(id)}`, initialized: false, title: project.title };
    }
    await this.prefetch(this.config.projectIds.filter(id => this.state.projects[id]).map(id => taskFile(this.state, id)));
    for (const id of this.config.projectIds) {
      try {
      const project = snapshot.projects[id];
      if (!project) throw new Error(`项目已不存在，绑定暂停：${this.state.projects[id]?.title || id}`);
      if (!this.state.projects[id]) this.state.projects[id] = { directory: `${ROOT}/projects/${safeName(project.title)}--${stableId(id)}`, initialized: false, title: project.title };
      const path = taskFile(this.state, id), file = await this.read(path);
      if (!file && this.state.projects[id].initialized) throw new Error(`任务文件缺失，绑定暂停（可在面板重建）：${path}`);
      const document = this.parse(file?.content || '', id);
      for (const task of Object.values(snapshot.tasks).filter((t) => t.projectId === id)) {
        noteParts(stripOperationMarkers(task.notes || ''));
        const value = this.hostValue(task, snapshot);
        timestamp(value.plannedDay, value.plannedTime, this.config.timezone); timestamp(value.deadlineDay, value.deadlineTime, this.config.timezone);
        if (task.parentId) {
          const parent = snapshot.tasks[task.parentId];
          if (!parent || parent.parentId || parent.projectId !== id) throw new Error(`应用父子关系无效或超过两层：${task.title}`);
        }
      }
      for (const row of document.rows) {
        if (row.value.tags.some(tag=>!isTagAlias(tag))) throw new Error('标签不符合 Obsidian 格式；特殊名称请在应用创建并使用索引中的别名');
        row.value.tags = [...new Set(row.value.tags.map(tag=>Object.values(this.state.tagAliases).find(alias=>alias.toLowerCase()===tag.toLowerCase()) || tag))].sort();
        if (row.value.tags.includes('TODAY')) throw new Error('TODAY 由计划日期管理，不是可创建的普通标签');
        if (row.parentKey && row.value.tags.length && !row.id) throw new Error(`新增子任务的标签由应用管理，不单独设置：${row.value.title}`);
        timestamp(row.value.plannedDay, row.value.plannedTime, this.config.timezone);
        timestamp(row.value.deadlineDay, row.value.deadlineTime, this.config.timezone);
        if (row.notePath && (!row.notePath.startsWith(`${ROOT}/projects/`) || !row.notePath.includes('/task-notes/'))) throw new Error('sp-notes 只能指向插件的 task-notes 文件；外部笔记请使用正文引用');
      }
      docs.set(id, { path, snapshot: file, document });
      } catch (error) { this.issue('file-paused', (error as Error).message, { path: this.state.projects[id] ? taskFile(this.state, id) : undefined }); }
    }
    const seen = new Map<string, string>(), noteOwners = new Map<string, string>(), blocked = new Set<string>();
    await this.prefetch([...docs.values()].flatMap(doc => doc.document.rows.map(row => row.notePath || (row.id ? this.state.notesPaths[row.id] : null)).filter((path): path is string => !!path)));
    for (const [projectId, doc] of docs) try { for (const row of doc.document.rows) {
      const identity = row.id || row.operationId;
      if (identity && seen.has(identity)) { blocked.add(seen.get(identity)!); throw new Error(`跨文件重复任务 ID：${identity}`); }
      if (identity) seen.set(identity, projectId);
      if (row.id && snapshot.tasks[row.id] && !this.config.projectIds.includes(snapshot.tasks[row.id].projectId) && !this.state.baseline[row.id]) throw new Error('不能导入未选择项目的任务 ID');
      if (row.id && !snapshot.tasks[row.id] && !this.state.baseline[row.id]) throw new Error(`未知任务 ID，不能凭空创建：${row.id}`);
      const path = row.notePath || (row.id ? this.state.notesPaths[row.id] : null);
      if (!path) continue;
      if (noteOwners.has(path)) { blocked.add(noteOwners.get(path)!); throw new Error(`多个任务不能共享任务 notes 文件：${path}；共享正文请使用引用`); }
      noteOwners.set(path, projectId);
      if (row.id && this.state.removed[row.id]) continue;
      const file = await this.read(path);
      if (!file && row.id && snapshot.tasks[row.id] && this.state.baseline[row.id]) throw new Error(`任务笔记缺失，暂停同步：${path}`);
      if (file) noteParts(frontmatterBody(file.content).body);
    } } catch (error) { blocked.add(projectId); this.issue('file-paused', (error as Error).message, { path: doc.path }); }
    for (const id of blocked) docs.delete(id);
    // An incomplete source file cannot safely participate in a cross-project move.
    let changed = true;
    while (changed) {
      changed = false;
      for (const [id, doc] of docs) if (doc.document.rows.some(row => row.id && snapshot.tasks[row.id] && this.config.projectIds.includes(snapshot.tasks[row.id].projectId) && !docs.has(snapshot.tasks[row.id].projectId))) {
        docs.delete(id); changed = true; this.issue('file-paused', '跨项目移动的源项目文件已暂停，请先修复源文件', { path: doc.path });
      }
    }
    return docs;
  }
  private async createTasks(snapshot: AppSnapshot, docs: Map<string, Document>): Promise<void> {
    for (const doc of docs.values()) {
      let content = doc.document.content;
      for (const row of doc.document.rows) {
        if (row.id) continue;
        const op = row.operationId || crypto.randomUUID(); row.operationId = op;
        if (!this.state.journal[op]) this.state.journal[op] = { operationId: op, projectId: row.value.projectId, parentId: row.value.parentId, title: row.value.title };
        if (!doc.document.lines[row.line].includes(`<!-- sp-op:${op} -->`)) {
          const stamped = this.parse(content, row.value.projectId); content = stampOperation(stamped, row.line, op);
        }
      }
      if (content !== doc.document.content) { await this.write(doc.path, content); doc.document = this.parse(content, doc.document.rows[0]?.value.projectId || this.config.projectIds.find((id) => taskFile(this.state, id) === doc.path)!); }
    }
    await this.saveState();
    for (const doc of docs.values()) {
      const keys = new Map<string, string>();
      for (const row of doc.document.rows) {
        if (row.parentKey) row.value.parentId = keys.get(row.parentKey) || row.value.parentId;
        if (row.id) { keys.set(row.key, row.id); continue; }
        const op = row.operationId!, journal = this.state.journal[op];
        const recovered = Object.values(snapshot.tasks).filter((t) => (t.notes || '').includes(operationMarker(op)));
        if (recovered.length > 1) throw new Error('重复创建操作标记，需要先处理应用中的重复任务');
        let id = journal.hostId || recovered[0]?.id;
        if (id && !snapshot.tasks[id]) throw new Error('待恢复的新增任务已在应用中移除，请在问题列表检查');
        if (id && !journal.hostId) { journal.hostId = id; await this.saveState(); }
        if (!id) {
          journal.parentId = row.value.parentId; await this.saveState();
          // A neutral title bypasses host short syntax on create; actual title is applied via updateTask.
          id = await this.api.addTask({ title: `Obsidian ${op}`, projectId: row.value.parentId ? undefined : row.value.projectId, parentId: row.value.parentId, notes: operationMarker(op), dueDay: null });
          journal.hostId = id; await this.saveState();
          const fresh = await readSnapshot(this.api); Object.assign(snapshot.tasks, fresh.tasks); Object.assign(snapshot.projects, fresh.projects);
          if (!snapshot.tasks[id]) throw new Error('新增任务未能通过读回验证');
        }
        row.id = id; keys.set(row.key, id);
        this.state.notesPaths[id] = row.notePath || `${this.state.projects[row.value.projectId].directory}/task-notes/${stableId(id)}.md`;
      }
    }
  }
  private async candidates(snapshot: AppSnapshot, docs: Map<string, Document>): Promise<Map<string, Candidate>> {
    const result = new Map<string, Candidate>();
    for (const task of Object.values(snapshot.tasks)) {
      if (!docs.has(task.projectId) || this.state.removed[task.id]) continue;
      const host = this.hostValue(task, snapshot); noteParts(host.notes);
      result.set(task.id, { id: task.id, value: structuredClone(host), host, conflicts: [] });
      this.state.notesPaths[task.id] ||= `${this.state.projects[task.projectId].directory}/task-notes/${stableId(task.id)}.md`;
    }
    for (const doc of docs.values()) for (const row of doc.document.rows) {
      const id = row.id!;
      if (this.state.removed[id]) continue;
      const candidate = result.get(id); if (!candidate) continue;
      const notePath = row.notePath || this.state.notesPaths[id]; this.state.notesPaths[id] = notePath;
      const note = await this.read(notePath);
      const file = { ...row.value, tags: row.parentKey ? [...candidate.host.tags] : row.value.tags, notes: note ? frontmatterBody(note.content).body : candidate.host.notes };
      const isNew = !!row.operationId && !!this.state.journal[row.operationId];
      const merged = isNew ? { value: file, conflicts: [] } : mergeTask(this.state.baseline[id], candidate.host, file);
      candidate.file = file; candidate.row = row; candidate.value = merged.value; candidate.conflicts = merged.conflicts;
      if (merged.conflicts.length) this.issue('task-conflict', `同字段冲突，应用优先：${merged.conflicts.join('、')}；原文件将在写入时备份`, { taskId: id, path: doc.path });
    }
    for (const candidate of result.values()) {
      const value = candidate.value;
      if (value.parentId) {
        const parent = result.get(value.parentId);
        if (!parent || parent.value.parentId) throw new Error('父子关系无效或超过两层，暂停同步');
        value.projectId = parent.value.projectId; value.list = parent.value.list;
        // Native children can have their own stored tags. They are exported as
        // read-only here rather than being compared against an empty tag list.
        value.tags = [...candidate.host.tags];
      }
    }
    await this.prefetch([...result.keys()].map(id => this.state.notesPaths[id]));
    return result;
  }
  private async markRemoved(snapshot: AppSnapshot, docs: Map<string, Document>, candidates: Map<string, Candidate>): Promise<void> {
    const present = new Set([...docs.values()].flatMap((d) => d.document.rows.map((r) => r.id!)));
    const removed = new Set<string>();
    for (const [id, baseline] of Object.entries(this.state.baseline)) {
      if (!docs.has(baseline.projectId) || this.state.removed[id] || present.has(id)) continue;
      const host = snapshot.tasks[id];
      if (host && (!this.config.projectIds.includes(host.projectId) || host.projectId !== baseline.projectId)) continue;
      removed.add(id);
      if (host && !host.parentId) for (const child of host.subTaskIds) if (!present.has(child) || candidates.get(child)?.value.parentId === id) removed.add(child);
    }
    // Preserve tasks explicitly deleted or archived in SP; do not resurrect stale Markdown IDs.
    for (const id of present) if (!snapshot.tasks[id] && this.state.baseline[id]) removed.add(id);
    for (const id of removed) {
      const task = snapshot.tasks[id] || this.state.snapshots[id]; if (!task) continue;
      const reason = snapshot.tasks[id] ? 'Markdown 任务行已移除' : '应用任务已删除或归档';
      const record: RemovedTask = { reason, snapshot: structuredClone(task), removedAt: new Date().toISOString() };
      await this.write(`${ROOT}/.sp-sync/removed/${stableId(id)}.json`, JSON.stringify(record, null, 2));
      this.state.removed[id] = record; candidates.delete(id);
      await this.saveState(); // Durable removal before adding host tags; recovery retries tagging.
    }
    await this.cleanRemovedNotes(snapshot, docs);
    if (!Object.keys(this.state.removed).some((id) => snapshot.tasks[id] && docs.has(snapshot.tasks[id].projectId))) return;
    let tag = Object.values(snapshot.tags).find((t) => t.title === 'sync-removed');
    if (!tag) { const id = await this.api.addTag({ title: 'sync-removed' }); tag = { id, title: 'sync-removed' }; snapshot.tags[id] = tag; this.state.tagAliases = tagAliases(snapshot, this.state.tagAliases); }
    for (const id of Object.keys(this.state.removed)) {
      const task = snapshot.tasks[id]; if (!task || !docs.has(task.projectId)) continue;
      const target = snapshot.tasks[task.parentId || id];
      if (target && !target.tagIds.includes(tag.id)) { await this.api.updateTask(target.id, { tagIds: [...target.tagIds, tag.id] }); target.tagIds.push(tag.id); }
      const retained = target ? candidates.get(target.id) : undefined;
      if (retained) {
        const alias = this.state.tagAliases[tag.id];
        if (!retained.value.tags.includes(alias)) retained.value.tags.push(alias);
        if (!retained.host.tags.includes(alias)) retained.host.tags.push(alias);
        retained.value.tags.sort(); retained.host.tags.sort();
      }
    }
  }
  private async cleanRemovedNotes(snapshot: AppSnapshot, docs: Map<string, Document>): Promise<void> {
    for (const [id, record] of Object.entries(this.state.removed)) {
      if (!docs.has(record.snapshot.projectId) || record.note?.cleaned) continue;
      const originalPath = record.note?.originalPath || this.state.notesPaths[id];
      if (!originalPath) continue;
      try {
        if (Object.entries(this.state.notesPaths).some(([other, path]) => other !== id && path === originalPath && snapshot.tasks[other] && !this.state.removed[other])) throw new Error('该 note 仍被其他任务使用，保留原文件');
        const file = await this.io.read(originalPath);
        if (file) {
          if (!record.note || record.note.hash !== file.hash) {
            const recoveryPath = `${ROOT}/.sp-sync/removed/${stableId(id)}/${crypto.randomUUID()}.md`;
            await this.write(recoveryPath, file.content);
            record.note = { originalPath, recoveryPath, hash: file.hash, cleaned: false };
            await this.write(`${ROOT}/.sp-sync/removed/${stableId(id)}.json`, JSON.stringify(record, null, 2));
            await this.saveState(); // Recovery copy and mapping must be durable before unlink.
          }
          await this.io.removeTaskNote(originalPath, file.hash);
          this.files.set(originalPath, null); delete this.state.fileHashes[originalPath];
        }
        if (record.note) {
          record.note.cleaned = true;
          await this.write(`${ROOT}/.sp-sync/removed/${stableId(id)}.json`, JSON.stringify(record, null, 2));
        }
      } catch (error) { this.issue('note-cleanup-paused', (error as Error).message, { taskId: id, path: originalPath }); }
    }
  }
  private async synchronizeReferences(candidates: Map<string, Candidate>): Promise<void> {
    const paths = await this.io.listMarkdown();
    const groups = new Map<string, Array<{ id: string; body?: string; hostChanged: boolean }>>();
    const targets = new Map<string, Array<{ path: string; anchor: string | null; target: string }>>();
    const parts = new Map<string, ReturnType<typeof noteParts>>();
    for (const candidate of candidates.values()) {
      const split = noteParts(candidate.value.notes); parts.set(candidate.id, split);
      const baseline = this.state.baseline[candidate.id] ? noteParts(this.state.baseline[candidate.id].notes) : null;
      const resolved: Array<{ path: string; anchor: string | null; target: string }> = [];
      for (const target of referenceTargets(split.own)) {
        try {
          const ref = resolveReference(target, this.state.notesPaths[candidate.id], paths);
          if (ref.path.startsWith(`${ROOT}/`) && !ref.anchor) throw new Error('插件生成文件不能用作可写引用；任务 notes 请直接编辑对应文件');
          if (ref.path === this.state.notesPaths[candidate.id]) throw new Error('任务 notes 不能引用自身');
          resolved.push({ ...ref, target });
        } catch (error) { this.issue('reference-unresolved', String((error as Error).message), { taskId: candidate.id }); }
      }
      const suppressed = new Set((this.state.referenceSuppressions[candidate.id] || []).filter((path) => resolved.some((r) => r.path === path)));
      for (const ref of baseline?.embedded || []) if (!split.embedded.some((current) => current.path === ref.path) && resolved.some((r) => r.path === ref.path)) suppressed.add(ref.path);
      this.state.referenceSuppressions[candidate.id] = [...suppressed];
      targets.set(candidate.id, resolved.filter((r) => !suppressed.has(r.path)));
      for (const ref of resolved) {
        if (ref.anchor || suppressed.has(ref.path)) continue;
        const body = split.embedded.find((item) => item.path === ref.path)?.body;
        const hostBody = noteParts(candidate.host.notes).embedded.find((item) => item.path === ref.path)?.body;
        const baseBody = baseline?.embedded.find((item) => item.path === ref.path)?.body;
        const entries = groups.get(ref.path) || [];
        if (!entries.some((entry) => entry.id === candidate.id)) entries.push({ id: candidate.id, body, hostChanged: hostBody !== undefined && hostBody !== baseBody });
        groups.set(ref.path, entries);
      }
    }
    const canonical = new Map<string, string>();
    for (const [path, entries] of groups) {
      const source = await this.read(path); if (!source) continue;
      const { prefix, body: sourceBody } = frontmatterBody(source.content);
      const base = this.state.references[path];
      const changes = entries.filter((entry) => entry.body !== undefined && base && entry.body !== base.body);
      let body = sourceBody;
      const variants = [...new Set(changes.map((entry) => entry.body!))];
      if (variants.length > 1) {
        this.issue('reference-conflict', '多个任务给出不同引用正文，暂停该笔记写回；选择一个版本恢复', { path, candidates: [{ label: 'Obsidian 源文件', body: sourceBody, kind: 'source' }, ...changes.map((entry) => ({ label: candidates.get(entry.id)!.value.title, body: entry.body!, kind: 'task' as const }))] });
        // Preserve every competing embedded version; other references can still synchronize.
        continue;
      }
      if (variants.length === 1) {
        if (sourceBody === base!.body || changes.some((entry) => entry.hostChanged)) body = variants[0];
        else {
          this.issue('reference-conflict', '源笔记和 Markdown 中的引用副本同时变化，选择版本后写回', { path, candidates: [{ label: '源文件', body: sourceBody, kind: 'source' }, { label: '引用副本', body: variants[0], kind: 'copy' }] }); continue;
        }
      }
      if (body !== sourceBody) await this.write(path, prefix + body);
      canonical.set(path, body);
      this.state.references[path] = { path, body, taskIds: entries.map((entry) => entry.id) };
    }
    for (const candidate of candidates.values()) {
      const split = parts.get(candidate.id)!;
      const embedded: Array<{ path: string; body: string }> = [];
      const excerpts: Array<{ target: string; body: string }> = [];
      for (const ref of targets.get(candidate.id) || []) {
        if (ref.anchor) {
          try { const source = await this.read(ref.path); if (source) excerpts.push({ target: ref.target, body: excerpt(source.content, ref.anchor) }); }
          catch (error) { this.issue('reference-anchor', (error as Error).message, { path: ref.path, taskId: candidate.id }); }
        } else {
          const body = canonical.get(ref.path) ?? split.embedded.find((item) => item.path === ref.path)?.body;
          if (body !== undefined && !embedded.some((item) => item.path === ref.path)) embedded.push({ path: ref.path, body });
        }
      }
      candidate.value.notes = composeNote(split.own, embedded, excerpts, this.config.language);
    }
  }
  private async tagIds(aliases: string[], snapshot: AppSnapshot): Promise<string[]> {
    const result: string[] = [];
    for (const alias of aliases) {
      if (alias === 'TODAY') throw new Error('TODAY 由计划日期管理，不是可创建的普通标签');
      let id = Object.keys(this.state.tagAliases).find((key) => this.state.tagAliases[key] === alias && snapshot.tags[key]);
      if (!id) { id = await this.api.addTag({ title: alias }); snapshot.tags[id] = { id, title: alias }; this.state.tagAliases[id] = alias; }
      result.push(id);
    }
    return result;
  }
  private async applyCandidates(snapshot: AppSnapshot, candidates: Map<string, Candidate>): Promise<AppSnapshot> {
    snapshot = await readSnapshot(this.api);
    for (const candidate of candidates.values()) {
      const task = snapshot.tasks[candidate.id];
      if (!task || !equal(this.hostValue(task, snapshot), candidate.host)) throw new Error('同步期间应用任务已变化，将在下次同步重新合并');
    }
    // Promote/detach first, then move root families, then attach. Never set relational fields via updateTask.
    for (const candidate of candidates.values()) {
      const task = snapshot.tasks[candidate.id];
      if (task.parentId && task.parentId !== candidate.value.parentId) {
        this.assertActive();
        const response = await this.api.batchUpdateForProject({ projectId: task.projectId, operations: [{ type: 'update', taskId: task.id, updates: { parentId: null } }] });
        if (!response.success || response.errors?.length) throw new Error('子任务提升失败');
      }
    }
    snapshot = await readSnapshot(this.api);
    for (const candidate of candidates.values()) {
      const task = snapshot.tasks[candidate.id];
      if (!task) throw new Error('同步期间应用任务已变化');
      if (task.projectId !== candidate.value.projectId && !task.parentId) { this.assertActive(); await this.api.updateTask(task.id, { projectId: candidate.value.projectId }); }
    }
    snapshot = await readSnapshot(this.api);
    for (const candidate of candidates.values()) {
      const task = snapshot.tasks[candidate.id];
      if (candidate.value.parentId && task.parentId !== candidate.value.parentId) {
        this.assertActive();
        const response = await this.api.batchUpdateForProject({ projectId: candidate.value.projectId, operations: [{ type: 'update', taskId: task.id, updates: { parentId: candidate.value.parentId } }] });
        if (!response.success || response.errors?.length) throw new Error('子任务关联失败');
      }
    }
    snapshot = await readSnapshot(this.api);
    for (const candidate of candidates.values()) {
      this.assertActive();
      const task = snapshot.tasks[candidate.id], value = candidate.value;
      if (!task || task.projectId !== value.projectId || (task.parentId || null) !== value.parentId) throw new Error('父子关系／项目迁移未通过读回验证');
      const current = this.hostValue(task, snapshot);
      const scalar = ({ projectId: _project, parentId: _parent, list: _list, tags: _tags, ...fields }: TaskValue) => {
        if (task.subTaskIds.length) { const { estimate: _derived, ...independent } = fields; return independent; }
        return fields;
      };
      if (!equal(scalar(current), scalar(candidate.host))) throw new Error('同步期间应用任务字段已变化，将在下次同步重新合并');
      const updates: Partial<HostTask> = {};
      if (task.title !== value.title) updates.title = value.title;
      if (task.isDone !== value.isDone) updates.isDone = value.isDone;
      if (stripOperationMarkers(task.notes || '') !== value.notes) updates.notes = value.notes;
      // Parents hold native remaining-time aggregates, not a separate editable estimate.
      if (!task.subTaskIds.length && task.timeEstimate !== value.estimate) updates.timeEstimate = value.estimate;
      if (!value.parentId) {
        // Native promotion retains a child's tags, or inherits the parent's
        // tags when the child has none. Preserve that result unless the file
        // explicitly changed tags while promoting the task.
        if (candidate.host.parentId && equal(candidate.file?.tags ?? candidate.host.tags, candidate.host.tags)) value.tags = [...current.tags];
        const tags = await this.tagIds(value.tags, snapshot);
        if (!equal([...task.tagIds.filter((id) => id !== 'TODAY')].sort(), [...tags].sort())) updates.tagIds = [...tags, ...task.tagIds.filter((id) => id === 'TODAY')];
      }
      const planned = timestamp(value.plannedDay, value.plannedTime, this.config.timezone);
      const deadline = timestamp(value.deadlineDay, value.deadlineTime, this.config.timezone);
      const dueDay = planned === null ? value.plannedDay : null, deadlineDay = deadline === null ? value.deadlineDay : null;
      if (current.plannedDay !== value.plannedDay || current.plannedTime !== value.plannedTime) Object.assign(updates, { dueDay, dueWithTime: planned, remindAt: null });
      if (current.deadlineDay !== value.deadlineDay || current.deadlineTime !== value.deadlineTime) Object.assign(updates, { deadlineDay, deadlineWithTime: deadline, deadlineRemindAt: null });
      if (Object.keys(updates).length) { await this.api.updateTask(task.id, updates); }
      const meta = { version: 1 as const, expectedFinish: value.expectedFinish };
      if (!equal(this.state.metadata[task.id], meta)) { await this.api.persistDataSynced(JSON.stringify(meta), `task-${task.id}`); this.state.metadata[task.id] = meta; }
    }
    return readSnapshot(this.api);
  }
  private async synchronizeOrder(snapshot: AppSnapshot, docs: Map<string, Document>, candidates: Map<string, Candidate>): Promise<string[]> {
    const final: string[] = [];
    for (const [projectId, doc] of docs) {
      const project = snapshot.projects[projectId];
      const hostRoot = [...project.taskIds, ...project.backlogTaskIds, ...Object.values(snapshot.tasks).filter((t) => t.projectId === projectId && !t.parentId).map((t) => t.id)]
        .filter((id, index, ids) => ids.indexOf(id) === index && candidates.has(id) && !candidates.get(id)!.value.parentId);
      const fileRoot = doc.document.rows.filter((row) => row.id && candidates.has(row.id) && !candidates.get(row.id)!.value.parentId && candidates.get(row.id)!.value.projectId === projectId).map((row) => row.id!);
      const key = `project:${projectId}`, base = this.state.order[key];
      const shared = new Set(fileRoot.filter((id) => hostRoot.includes(id) && (!base || base.includes(id))));
      const relative = (ids: string[]) => ids.filter((id) => shared.has(id));
      let roots = hostRoot;
      if (base && equal(relative(hostRoot), relative(base))) roots = [...fileRoot, ...hostRoot.filter((id) => !fileRoot.includes(id))];
      else if (base && !equal(relative(fileRoot), relative(base)) && !equal(relative(hostRoot), relative(fileRoot))) this.issue('order-conflict', '任务顺序冲突，应用顺序优先', { path: doc.path });
      const active = roots.filter((id) => candidates.get(id)!.value.list === 'active'), backlog = roots.filter((id) => candidates.get(id)!.value.list === 'backlog');
      // Preserve unsynchronized/removed tasks in their original lists; never drop them from project membership.
      const activeAll = [...active, ...project.taskIds.filter((id) => !candidates.has(id))];
      const backlogAll = [...backlog, ...project.backlogTaskIds.filter((id) => !candidates.has(id))];
      if (!equal(project.taskIds, activeAll) || !equal(project.backlogTaskIds, backlogAll)) await this.api.updateProject(projectId, { taskIds: activeAll, backlogTaskIds: backlogAll });
      this.state.order[key] = [...active, ...backlog];
      for (const id of [...active, ...backlog]) {
        final.push(id);
        const hostChildren = (snapshot.tasks[id]?.subTaskIds || []).filter((child) => candidates.has(child));
        const fileChildren = doc.document.rows.filter((row) => row.id && candidates.get(row.id)?.value.parentId === id).map((row) => row.id!);
        const childKey = `task:${id}`, childBase = this.state.order[childKey];
        const childShared = new Set(fileChildren.filter((child) => hostChildren.includes(child) && (!childBase || childBase.includes(child))));
        const relativeChild = (ids: string[]) => ids.filter((child) => childShared.has(child));
        let children = hostChildren;
        if (childBase && equal(relativeChild(hostChildren), relativeChild(childBase))) children = [...fileChildren, ...hostChildren.filter((child) => !fileChildren.includes(child))];
        const all = [...children, ...(snapshot.tasks[id]?.subTaskIds || []).filter((child) => !candidates.has(child))];
        if (!equal(all, snapshot.tasks[id]?.subTaskIds)) await this.api.reorderTasks(all, id, 'task');
        this.state.order[childKey] = children; final.push(...children);
      }
    }
    return final;
  }
  private async exportTasks(snapshot: AppSnapshot, docs: Map<string, Document>, candidates: Map<string, Candidate>, order: string[]): Promise<void> {
    for (const [projectId, doc] of docs) {
      const entries: Array<{ path: string; content: string }> = [];
      for (const candidate of candidates.values()) if (candidate.value.projectId === projectId) {
        const path = this.state.notesPaths[candidate.id], previous = await this.read(path);
        const prefix = previous ? frontmatterBody(previous.content).prefix : !candidate.value.notes ? `---\nsp-task-id: ${JSON.stringify(candidate.id)}\nsp-project-id: ${JSON.stringify(projectId)}\n---\n` : '';
        entries.push({ path, content: prefix + candidate.value.notes });
      }
      const rows = order.filter((id) => candidates.get(id)?.value.projectId === projectId).map((id) => {
        const candidate = candidates.get(id)!, task = snapshot.tasks[id];
        return renderRow(id, candidate.value, this.state.notesPaths[id], task.timeSpent, task.doneOn || null, this.config.language);
      });
      let output = rewriteTasks(doc.document, rows, projectId, snapshot.projects[projectId].title, this.config.language);
      output = setProperty(output, 'sp-project-title', snapshot.projects[projectId].title);
      entries.push({ path: doc.path, content: output });
      await this.writeSet(entries);
    }
  }
  private async exportIndexes(snapshot: AppSnapshot, selected: string[]): Promise<void> {
    await this.write(`${ROOT}/README.md`, getGuide(this.config.language));
    const indexes = indexExports(snapshot, this.state, selected, this.config.timezone, this.config.language);
    // Clear obsolete generated calendar/tag sections while retaining user prose.
    for (const path of Object.keys(this.state.fileHashes)) {
      if (indexes[path] || (!path.startsWith(`${ROOT}/calendar/`) && !path.startsWith(`${ROOT}/tags/`))) continue;
      const file = await this.read(path); if (!file) continue;
      const name = path.startsWith(`${ROOT}/tags/`) ? 'tag' : 'calendar';
      if (file.content.includes(`<!-- sp-generated:${name}:start -->`)) await this.write(path, generatedBlock(file.content, name, `> ${translate('当前没有匹配任务。', this.config.language)}`, ''));
    }
    if (this.config.exportProjectNotes) {
      for (const note of Object.values(snapshot.notes).filter((n) => n.projectId && selected.includes(n.projectId))) {
        const path = `${this.state.projects[note.projectId!].directory}/project-notes/${stableId(note.id)}.md`;
        const previous = await this.read(path);
        await this.write(path, generatedBlock(previous?.content ?? null, 'project-note', note.content, `---\nsp-note-id: ${JSON.stringify(note.id)}\nsp-read-only: true\n---\n> ${translate('原生项目笔记只读导出；编辑不会写回应用。', this.config.language)}\n`));
      }
    }
    if (this.config.exportArchive) {
      const archived = await this.api.getArchivedTasks(), months = new Map<string, HostTask[]>();
      for (const task of archived) {
        if (!selected.includes(task.projectId)) continue;
        const date = new Date(task.doneOn || task.created).toLocaleDateString('sv-SE', { timeZone: this.config.timezone });
        const path = `${this.state.projects[task.projectId].directory}/archive/${date.slice(0, 7)}.md`;
        const group = months.get(path) || []; group.push(task); months.set(path, group);
      }
      for (const [path, tasks] of months) {
        const families = new Map(archived.map((task) => [task.id, task]));
        const expanded = new Map(tasks.map((task) => [task.id, task]));
        for (const task of tasks) {
          if (task.parentId && families.has(task.parentId)) expanded.set(task.parentId, families.get(task.parentId)!);
          for (const id of task.subTaskIds || []) if (families.has(id)) expanded.set(id, families.get(id)!);
        }
        const body = [...expanded.values()].sort((a, b) => (a.parentId || a.id).localeCompare(b.parentId || b.id) || Number(!!a.parentId) - Number(!!b.parentId)).map((task) => `${task.parentId ? '  ' : ''}- [${task.isDone ? 'x' : ' '}] ${task.title}\n\n${task.notes || ''}`).join('\n\n');
        const previous = await this.read(path); await this.write(path, generatedBlock(previous?.content ?? null, 'archive', body, `# ${translate('历史归档（只读）', this.config.language)}\n`));
      }
    }
    await this.prefetch(Object.keys(indexes));
    const indexWrites: Array<{ path: string; content: string }> = [];
    for (const [path, index] of Object.entries(indexes)) {
      if (index.name === 'project') {
        const directory = path.slice(0, path.lastIndexOf('/'));
        const extra = Object.keys(this.state.fileHashes).filter((file) =>
          (this.config.exportProjectNotes && file.startsWith(`${directory}/project-notes/`)) ||
          (this.config.exportArchive && file.startsWith(`${directory}/archive/`)));
        if (extra.length) index.body += `\n\n## ${translate('只读导出', this.config.language)}\n\n${extra.sort().map((file) => `- ${link(file, file.slice(directory.length + 1))}`).join('\n')}`;
      }
      const previous = await this.read(path);
      let content = generatedBlock(previous?.content ?? null, index.name, index.body, index.initial);
      if (index.name === 'tag') {
        const id = property(content, 'sp-tag-id');
        if (id && snapshot.tags[id]) {
          content = setProperty(content, 'sp-tag-title', snapshot.tags[id].title);
          content = setProperty(content, 'sp-tag-color', snapshot.tags[id].color || null);
        }
      }
      indexWrites.push({ path, content });
    }
    await this.writeSet(indexWrites);
  }
  async sync(): Promise<void> {
    if (this.running || this.config.paused || !this.config.vaultPath || !this.config.projectIds.length || this.disposed) return;
    this.running = true; this.issues = []; this.files.clear(); this.readErrors.clear();
    let rollback: { baseline: SyncState['baseline']; order: SyncState['order']; references: SyncState['references'] } | undefined;
    let committed = false;
    try {
      await this.initialize();
      rollback = { baseline: structuredClone(this.state.baseline), order: structuredClone(this.state.order), references: structuredClone(this.state.references) };
      let snapshot = await readSnapshot(this.api);
      this.state.tagAliases = tagAliases(snapshot, this.state.tagAliases);
      await this.metadata(snapshot);
      const docs = await this.readDocuments(snapshot);
      if (!docs.size) return;
      await this.reconcileNames(snapshot, docs);
      await this.createTasks(snapshot, docs);
      const candidates = await this.candidates(snapshot, docs);
      await this.markRemoved(snapshot, docs, candidates);
      await this.synchronizeReferences(candidates);
      snapshot = await this.applyCandidates(snapshot, candidates);
      // Verify the host accepted editable fields before writing Markdown or advancing baseline.
      const rejected = new Set<string>();
      for (const [id, candidate] of candidates) {
        const task = snapshot.tasks[id];
        if (!task) { rejected.add(candidate.value.projectId); this.issue('verification-paused', `应用任务在同步期间已消失：${candidate.value.title}`, { taskId: id }); continue; }
        const actual = this.hostValue(task, snapshot);
        if (task.subTaskIds.length) candidate.value.estimate = actual.estimate;
        if (task.parentId) candidate.value.tags = [...actual.tags];
        const intended = { ...candidate.value, list: actual.list };
        const different = (Object.keys(actual) as Array<keyof TaskValue>).filter(key => !equal(actual[key], intended[key]));
        if (different.length) {
          rejected.add(candidate.value.projectId); rejected.add(candidate.host.projectId);
          this.issue('verification-paused', `应用更新未通过读回验证：${candidate.value.title}；差异字段：${different.join('、')}。暂停该项目，其余项目继续。`, { taskId: id, path: docs.get(candidate.value.projectId)?.path });
        }
      }
      for (const project of rejected) docs.delete(project);
      for (const [id, candidate] of candidates) if (!docs.has(candidate.value.projectId) || rejected.has(candidate.host.projectId)) candidates.delete(id);
      if (!docs.size) return;
      const ordered = await this.synchronizeOrder(snapshot, docs, candidates);
      await this.exportTasks(snapshot, docs, candidates, ordered);
      for (const [id, candidate] of candidates) { this.state.baseline[id] = structuredClone(candidate.value); this.state.snapshots[id] = structuredClone(snapshot.tasks[id]); }
      for (const [id, binding] of Object.entries(this.state.projects)) if (docs.has(id)) { binding.initialized = true; binding.title = snapshot.projects[id].title; }
      for (const tag of Object.values(snapshot.tags)) this.state.tagMetadata[tag.id] = { title: tag.title, color: tag.color || null };
      await this.exportIndexes(snapshot, [...docs.keys()]);
      this.state.lastSync = new Date().toISOString();
      await this.saveState();
      committed = true;
      // Remove creation markers only AFTER the ID mapping and final baseline are durable.
      for (const [op, entry] of Object.entries(this.state.journal)) {
        if (!entry.hostId || !this.state.baseline[entry.hostId]) continue;
        const task = snapshot.tasks[entry.hostId];
        if (task && (task.notes || '').includes(operationMarker(op))) await this.api.updateTask(task.id, { notes: stripOperationMarkers(task.notes || '') });
        delete this.state.journal[op];
      }
      await this.saveState();
    } catch (error) {
      // Keep durable journal/removal records, but failed passes never advance their common baseline.
      if (rollback && !committed) { this.state.baseline = rollback.baseline; this.state.order = rollback.order; this.state.references = rollback.references; }
      this.issue('sync-failed', (error as Error).message || String(error));
    } finally { this.running = false; }
  }
  async restore(id: string): Promise<void> {
    await this.initialize(); this.files.clear(); this.readErrors.clear();
    const record = this.state.removed[id]; if (!record) throw new Error('没有这条移除记录');
    const snapshot = await readSnapshot(this.api), task = snapshot.tasks[id];
    if (!task) throw new Error('任务已在应用中删除／归档；先在应用恢复，再恢复关联');
    const ids = task.parentId ? [id] : [id, ...task.subTaskIds];
    // Check parents too: restoring a child cannot leave it inside a suppressed family.
    if (task.parentId && this.state.removed[task.parentId]) throw new Error('请先恢复父任务家庭');
    for (const key of ids) {
      const removed = this.state.removed[key], existingTask = snapshot.tasks[key];
      if (removed?.note && existingTask && !await this.read(removed.note.originalPath)) {
        const recovery = await this.read(removed.note.recoveryPath); if (!recovery) throw new Error('任务 note 恢复副本缺失，保留移除记录');
        await this.write(removed.note.originalPath, recovery.content);
        if (stripOperationMarkers(existingTask.notes || '') === stripOperationMarkers(removed.snapshot.notes || '')) await this.api.updateTask(key, { notes: frontmatterBody(recovery.content).body });
      }
      delete this.state.removed[key]; delete this.state.baseline[key];
    }
    const markedParents = new Set(Object.keys(this.state.removed).map((key) => snapshot.tasks[key]?.parentId || key));
    const target = snapshot.tasks[task.parentId || id];
    const tag = Object.values(snapshot.tags).find((t) => t.title === 'sync-removed');
    if (target && tag && !markedParents.has(target.id)) await this.api.updateTask(target.id, { tagIds: target.tagIds.filter((key) => key !== tag.id) });
    await this.saveState();
  }
  async rebuild(projectId: string): Promise<void> {
    await this.initialize(); this.files.clear(); this.readErrors.clear();
    if (!this.config.projectIds.includes(projectId) || !this.state.projects[projectId]) throw new Error('项目未绑定');
    if (await this.io.read(taskFile(this.state, projectId))) throw new Error('任务文件仍存在；不会覆盖它');
    this.state.projects[projectId].initialized = false;
    // Absence on this explicitly requested recreation must not count as line removal.
    for (const [id, value] of Object.entries(this.state.baseline)) if (value.projectId === projectId) delete this.state.baseline[id];
    await this.saveState();
  }
  async resolveReference(path: string, body: string): Promise<void> {
    await this.initialize(); this.files.clear(); this.readErrors.clear();
    const issue = this.issues.find((entry) => entry.code === 'reference-conflict' && entry.path === path);
    if (!issue?.candidates?.some((candidate) => candidate.body === body)) throw new Error('该冲突版本已过期，请刷新问题列表');
    const source = await this.read(path); if (!source) throw new Error('引用源文件已不存在');
    await this.write(path, frontmatterBody(source.content).prefix + body);
    const snapshot = await readSnapshot(this.api);
    const ids = this.state.references[path]?.taskIds || [];
    for (const id of ids) {
      const task = snapshot.tasks[id]; if (!task) continue;
      const parts = noteParts(task.notes || '');
      const notes = composeNote(parts.own, parts.embedded.map((ref) => ref.path === path ? { path, body } : ref));
      await this.api.updateTask(id, { notes });
      const notePath = this.state.notesPaths[id], file = notePath ? await this.read(notePath) : null;
      if (file) await this.write(notePath, frontmatterBody(file.content).prefix + notes);
      if (this.state.baseline[id]) this.state.baseline[id].notes = notes;
    }
    this.state.references[path] = { path, body, taskIds: ids }; await this.saveState();
  }
  async restoreBackup(path: string): Promise<void> {
    this.files.clear(); this.readErrors.clear();
    if (!path.startsWith(`${ROOT}/.sp-sync/backups/`)) throw new Error('不是插件备份');
    const backup = await this.read(path); if (!backup) throw new Error('备份不存在');
    const data = JSON.parse(backup.content);
    if (data.version !== 1 || typeof data.originalPath !== 'string' || typeof data.content !== 'string') throw new Error('备份格式无效');
    await this.write(data.originalPath, data.content);
  }
}
