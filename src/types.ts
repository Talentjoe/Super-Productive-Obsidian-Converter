/** Minimal, verified 19.1.0 host contract. No access to host stores/private APIs. */
export interface HostTask {
  id: string; title: string; projectId: string; tagIds: string[];
  parentId?: string | null; subTaskIds: string[]; notes?: string;
  isDone: boolean; timeEstimate: number; timeSpent: number; created: number;
  dueDay?: string | null; dueWithTime?: number | null;
  deadlineDay?: string | null; deadlineWithTime?: number | null;
  remindAt?: number | null; deadlineRemindAt?: number | null;
  doneOn?: number | null; timeSpentOnDay?: Record<string, number>;
}
export interface HostProject { id: string; title: string; taskIds: string[]; backlogTaskIds: string[]; noteIds?: string[]; isArchived?: boolean }
export interface HostTag { id: string; title: string; color?: string | null }
export interface HostNote { id: string; projectId: string | null; content: string; modified: number; created: number }
export interface AppSnapshot { tasks: Record<string, HostTask>; projects: Record<string, HostProject>; tags: Record<string, HostTag>; notes: Record<string, HostNote> }
export interface HostAPI {
  cfg: { platform: string; appVersion: string };
  getAppState(): Promise<AppSnapshot>; getTasks(): Promise<HostTask[]>;
  getArchivedTasks(): Promise<HostTask[]>; getAllProjects(): Promise<HostProject[]>;
  getAllTags(): Promise<HostTag[]>;
  addTask(data: { title: string; projectId?: string; parentId?: string | null; notes?: string; timeEstimate?: number; isDone?: boolean; dueDay?: string | null }): Promise<string>;
  updateTask(id: string, changes: Partial<HostTask>): Promise<void>;
  batchUpdateForProject(request: { projectId: string; operations: Array<{ type: 'update'; taskId: string; updates: { parentId?: string | null } }> }): Promise<{ success: boolean; errors?: unknown[] }>;
  reorderTasks(ids: string[], contextId: string, contextType: 'project' | 'task'): Promise<void>;
  updateProject(id: string, changes: { title?: string; taskIds?: string[]; backlogTaskIds?: string[] }): Promise<void>;
  updateTag(id: string, changes: { title?: string; color?: string | null }): Promise<void>;
  addTag(data: { title: string }): Promise<string>;
  loadSyncedData(key?: string): Promise<string | null>; persistDataSynced(data: string, key?: string): Promise<void>;
  executeNodeScript(request: { script: string; args?: unknown[]; timeout?: number }): Promise<{ success: boolean; result?: unknown; error?: string | { message: string } }>;
  registerHook(hook: string, callback: () => void): void;
  registerMenuEntry(data: { label: string; icon: string; onClick: () => void }): void;
  registerHeaderButton(data: { label: string; icon: string; onClick: () => void }): void;
  registerConfigHandler(callback: () => void): void;
  showIndexHtmlAsView(): void; showSnack(data: { msg: string; type: string }): void;
  onMessage(callback: (message: unknown) => Promise<unknown>): void;
  onReady(callback: () => void | Promise<void>): void; onUnload(callback: () => void): void;
}
export type SyncLanguage = 'zh' | 'en';
export interface SyncConfig {
  version: 1; vaultPath: string; projectIds: string[]; paused: boolean;
  timezone: string; exportProjectNotes: boolean; exportArchive: boolean;
  syncDelaySeconds?: number; fileCheckSeconds?: number; language?: SyncLanguage;
}
export const defaultConfig = (): SyncConfig => ({ version: 1, vaultPath: '', projectIds: [], paused: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, exportProjectNotes: false, exportArchive: false, syncDelaySeconds: 10, fileCheckSeconds: 30, language: 'zh' });
export interface RemovedTask {
  reason: string; snapshot: HostTask; removedAt: string;
  note?: { originalPath: string; recoveryPath: string; hash: string; cleaned: boolean };
}
export interface TaskMetadata { version: 1; expectedFinish: string | null }
export interface TaskValue {
  title: string; isDone: boolean; projectId: string; parentId: string | null;
  list: 'active' | 'backlog';
  tags: string[]; estimate: number; plannedDay: string | null; plannedTime: string | null;
  deadlineDay: string | null; deadlineTime: string | null; expectedFinish: string | null;
  notes: string;
}
export interface ReferenceBinding { path: string; body: string; taskIds: string[] }
export interface Issue { code: string; message: string; path?: string; taskId?: string; candidates?: Array<{ label: string; body: string; kind?: 'source' | 'copy' | 'task' }> }
export interface ProjectBinding { directory: string; initialized: boolean; title: string }
export interface JournalEntry { operationId: string; hostId?: string; projectId: string; parentId: string | null; title: string }
export interface SyncState {
  version: 1; projects: Record<string, ProjectBinding>; baseline: Record<string, TaskValue>;
  metadata: Record<string, TaskMetadata>; notesPaths: Record<string, string>;
  removed: Record<string, RemovedTask>;
  references: Record<string, ReferenceBinding>; journal: Record<string, JournalEntry>;
  order: Record<string, string[]>; tagAliases: Record<string, string>; fileHashes: Record<string, string>;
  tagMetadata: Record<string, { title: string; color: string | null }>;
  snapshots: Record<string, HostTask>;
  referenceSuppressions: Record<string, string[]>;
  lastSync: string | null;
}
export const emptyState = (): SyncState => ({ version: 1, projects: {}, baseline: {}, metadata: {}, notesPaths: {}, removed: {}, references: {}, journal: {}, order: {}, tagAliases: {}, fileHashes: {}, tagMetadata: {}, snapshots: {}, referenceSuppressions: {}, lastSync: null });
export interface FileSnapshot { content: string; hash: string }
export interface FileWrite { path: string; content: string; expectedHash: string | null }
export type FileReads = Record<string, { file: FileSnapshot | null; error?: string }>;
export interface VaultIO {
  read(path: string): Promise<FileSnapshot | null>;
  write(path: string, content: string, expectedHash: string | null): Promise<string>;
  removeTaskNote(path: string, expectedHash: string): Promise<void>;
  readMany?(paths: string[]): Promise<FileReads>;
  writeMany?(operations: FileWrite[]): Promise<Record<string, string>>;
  listMarkdown(): Promise<string[]>; fingerprint(): Promise<string>;
  backups(): Promise<Array<{ path: string; originalPath: string; created: string }>>;
}
export interface SyncStatus {
  config: SyncConfig; running: boolean; lastSync: string | null; issues: Issue[];
  projects: HostProject[]; removed: Array<{ id: string; title: string; reason: string }>;
  tasks: Array<{ id: string; title: string; expectedFinish: string | null }>;
}
