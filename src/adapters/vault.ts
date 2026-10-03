import script from '../node/io.cjs?raw';
import type { HostAPI, FileSnapshot, FileReads, FileWrite, VaultIO } from '../types';
export interface DirectoryView { directory: string; parent: string | null; directories: string[] }
export class NodeVault implements VaultIO {
  constructor(private api: HostAPI, public root: string) {}
  private async call<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
    const response = await this.api.executeNodeScript({ script, args: [{ action, root: this.root, ...extra }], timeout: 30000 });
    if (!response.success) throw new Error(typeof response.error === 'string' ? response.error : response.error?.message ?? '桌面文件操作失败');
    return response.result as T;
  }
  read(path: string): Promise<FileSnapshot | null> { return this.call('read', { path }); }
  readMany(paths: string[]): Promise<FileReads> { return this.call('read-many', { paths }); }
  removeTaskNote(path: string, expectedHash: string): Promise<void> { return this.call('remove-task-note', { path, expectedHash }); }
  async write(path: string, content: string, expectedHash: string | null): Promise<string> {
    if (content.length <= 3000) return this.call('write', { path, content, expectedHash });
    return this.staged<string>(content, 'stage-commit', { path, expectedHash });
  }
  async writeMany(operations: FileWrite[]): Promise<Record<string, string>> {
    const content = JSON.stringify(operations);
    if (content.length <= 3000) return this.call('write-many', { operations });
    return this.staged<Record<string, string>>(content, 'stage-commit-many');
  }
  private async staged<T>(content: string, action: string, extra: Record<string, unknown> = {}): Promise<T> {
    // Host 19.1.0 passes complex scripts/args via Windows' limited process command line.
    const bytes = new TextEncoder().encode(content), stageId = crypto.randomUUID();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const contentHash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    await this.call('stage-begin', { stageId });
    try {
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        const data = btoa(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
        await this.call('stage-append', { stageId, offset, data });
      }
      return await this.call(action, { stageId, ...extra, length: bytes.length, contentHash });
    } finally { await this.call('stage-abort', { stageId }).catch(() => {}); }
  }
  listMarkdown(): Promise<string[]> { return this.call('list'); }
  fingerprint(): Promise<string> { return this.call('fingerprint'); }
  backups(): Promise<Array<{ path: string; originalPath: string; created: string }>> { return this.call('backups'); }
  browse(directory: string): Promise<DirectoryView> { return this.call('browse', { directory }); }
}
