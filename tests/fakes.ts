import { createHash } from 'node:crypto';
import type { AppSnapshot, HostAPI, HostTask, VaultIO } from '../src/types';
export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export class MemoryVault implements VaultIO {
  files = new Map<string, string>(); writes: string[] = []; backupRecords: Array<{ path: string; originalPath: string; created: string }> = [];
  beforeWrite?: (path: string) => void;
  async read(path: string) { const content = this.files.get(path); return content === undefined ? null : { content, hash: hash(content) }; }
  async write(path: string, content: string, expectedHash: string | null) {
    this.beforeWrite?.(path);
    const previous = await this.read(path); if ((previous?.hash ?? null) !== expectedHash) throw new Error('文件已在同步期间变化');
    if (previous?.content === content) return hash(content);
    if (previous && !path.includes('/.sp-sync/')) {
      const backupPath = `Super Productivity/.sp-sync/backups/backup-${this.backupRecords.length}.json`;
      const data = { version: 1, originalPath: path, created: new Date().toISOString(), content: previous.content };
      this.files.set(backupPath, JSON.stringify(data)); this.backupRecords.push({ path: backupPath, originalPath: path, created: data.created });
    }
    this.files.set(path, content); this.writes.push(path); return hash(content);
  }
  async listMarkdown() { return [...this.files.keys()].filter((p) => p.endsWith('.md') && !p.includes('/.sp-sync/')); }
  async removeTaskNote(path: string, expectedHash: string) {
    this.beforeWrite?.(path);
    const file = await this.read(path); if (!file) return;
    if (file.hash !== expectedHash) throw new Error('任务 note 在清理期间变化，保留原文件');
    if (!/^Super Productivity\/projects\/[^/]+\/task-notes\//.test(path)) throw new Error('只能清理托管任务 notes 文件');
    this.files.delete(path);
  }
  async fingerprint() { return hash(JSON.stringify([...this.files].filter(([p]) => !p.includes('/.sp-sync/')))); }
  async backups() { return this.backupRecords; }
}
export const task = (id: string, extra: Partial<HostTask> = {}): HostTask => ({ id, title: id, projectId: 'p1', parentId: null, subTaskIds: [], tagIds: [], notes: '', isDone: false, timeEstimate: 0, timeSpent: 0, created: Date.UTC(2026, 9, 2), ...extra });
export class FakeHost implements HostAPI {
  cfg = { platform: 'desktop', appVersion: '19.1.0' };
  state: AppSnapshot = { tasks: {}, projects: { p1: { id: 'p1', title: '项目一', taskIds: [], backlogTaskIds: [] }, p2: { id: 'p2', title: '项目二', taskIds: [], backlogTaskIds: [] } }, tags: {}, notes: {} };
  archived: HostTask[] = []; synced = new Map<string, string>(); created = 0; calls: string[] = [];
  afterCreate?: () => void;
  private aggregate(id: string) {
    const parent = this.state.tasks[id]; if (!parent?.subTaskIds.length) return;
    parent.timeEstimate = parent.subTaskIds.reduce((sum, child) => {
      const task = this.state.tasks[child]; return sum + (task && !task.isDone ? Math.max(0, task.timeEstimate - task.timeSpent) : 0);
    }, 0);
  }
  add(t: HostTask) { this.state.tasks[t.id] = structuredClone(t); if (t.parentId) { this.state.tasks[t.parentId].subTaskIds.push(t.id); this.aggregate(t.parentId); } else this.state.projects[t.projectId].taskIds.push(t.id); }
  async getAppState() { return structuredClone(this.state); }
  async getTasks() { return structuredClone(Object.values(this.state.tasks)); }
  async getArchivedTasks() { return structuredClone(this.archived); }
  async getAllProjects() { return structuredClone(Object.values(this.state.projects)); }
  async getAllTags() { return structuredClone(Object.values(this.state.tags)); }
  async addTask(data: Parameters<HostAPI['addTask']>[0]) {
    const id = `new-${++this.created}`, parent = data.parentId ? this.state.tasks[data.parentId] : null;
    this.add(task(id, { ...data, projectId: parent?.projectId || data.projectId || 'p1', tagIds: [] })); this.calls.push(`create:${id}`); this.afterCreate?.(); return id;
  }
  async updateTask(id: string, changes: Partial<HostTask>) {
    if ('parentId' in changes || 'subTaskIds' in changes) throw new Error('关系字段不得直接更新');
    const t = this.state.tasks[id]; if (!t) throw new Error('任务不存在');
    if (changes.projectId && changes.projectId !== t.projectId) {
      if (t.parentId) throw new Error('子任务不可直接迁移');
      const old = this.state.projects[t.projectId]; old.taskIds = old.taskIds.filter((key) => key !== id); old.backlogTaskIds = old.backlogTaskIds.filter((key) => key !== id);
      this.state.projects[changes.projectId].taskIds.push(id);
      for (const child of t.subTaskIds) this.state.tasks[child].projectId = changes.projectId;
    }
    Object.assign(t, structuredClone(changes));
    if (changes.isDone !== undefined) t.doneOn = changes.isDone ? Date.UTC(2026, 9, 2, 12) : null;
    if (t.parentId && (changes.timeEstimate !== undefined || changes.isDone !== undefined)) this.aggregate(t.parentId);
    this.calls.push(`update:${id}`);
  }
  async batchUpdateForProject(request: Parameters<HostAPI['batchUpdateForProject']>[0]) {
    for (const op of request.operations) {
      const t = this.state.tasks[op.taskId], parent = op.updates.parentId ? this.state.tasks[op.updates.parentId] : null;
      const previousParent = t.parentId ? this.state.tasks[t.parentId] : null;
      if (t.projectId !== request.projectId || (parent && (parent.parentId || parent.id === t.id || parent.projectId !== t.projectId || t.subTaskIds.length))) throw new Error('关系无效');
      if (t.parentId) { const previous = t.parentId; this.state.tasks[previous].subTaskIds = this.state.tasks[previous].subTaskIds.filter((id) => id !== t.id); this.aggregate(previous); }
      const project = this.state.projects[t.projectId]; project.taskIds = project.taskIds.filter((id) => id !== t.id); project.backlogTaskIds = project.backlogTaskIds.filter((id) => id !== t.id);
      t.parentId = parent?.id || null;
      if (parent) { parent.subTaskIds.push(t.id); this.aggregate(parent.id); }
      else { if (!t.tagIds.length && previousParent) t.tagIds = previousParent.tagIds.filter(id=>id!=='TODAY'); project.taskIds.push(t.id); }
      this.calls.push(`relation:${t.id}`);
    }
    return { success: true };
  }
  async reorderTasks(ids: string[], contextId: string, type: 'project' | 'task') { if (type === 'task') this.state.tasks[contextId].subTaskIds = [...ids]; else this.state.projects[contextId].taskIds = [...ids]; }
  async updateProject(id: string, changes: Parameters<HostAPI['updateProject']>[1]) { Object.assign(this.state.projects[id], structuredClone(changes)); }
  async updateTag(id: string, changes: Parameters<HostAPI['updateTag']>[1]) { Object.assign(this.state.tags[id], structuredClone(changes)); }
  async addTag(data: { title: string }) { const id = `tag-${Object.keys(this.state.tags).length}`; this.state.tags[id] = { id, ...data }; return id; }
  async loadSyncedData(key = '') { return this.synced.get(key) || null; }
  async persistDataSynced(data: string, key = '') { this.synced.set(key, data); }
  async executeNodeScript(_request?: Parameters<HostAPI['executeNodeScript']>[0]): ReturnType<HostAPI['executeNodeScript']> { throw new Error('Use real Node bridge fixture'); }
  registerHook() {} registerMenuEntry() {} registerHeaderButton() {} registerConfigHandler() {} showIndexHtmlAsView() {} showSnack() {} onMessage() {} onReady() {} onUnload() {}
}
