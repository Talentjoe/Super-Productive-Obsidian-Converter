import type { HostAPI, SyncConfig, SyncStatus } from './types';
import { defaultConfig } from './types';
import { NodeVault } from './adapters/vault';
import { readSnapshot } from './adapters/snapshot';
import { SyncEngine } from './core/engine';
import { translate } from './i18n';

declare const PluginAPI: HostAPI;
const api = PluginAPI;
const CONFIG_KEY = 'sp-obsidian-sync:config:v1';
let config = defaultConfig();
try { const saved = localStorage.getItem(CONFIG_KEY); if (saved) config = validateConfig(JSON.parse(saved)); } catch { /* UI can replace an invalid local configuration. */ }
let engine: SyncEngine | null = null, disposed = false, ready = false;
let startupError: string | null = null, fingerprint = '', lastFullCheck = 0, lastFileCheck = 0;
let queue: Promise<unknown> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let checking = false;
function validateConfig(value: unknown): SyncConfig {
  const c = value as SyncConfig;
  if (!c || c.version !== 1 || typeof c.vaultPath !== 'string' || !Array.isArray(c.projectIds) || c.projectIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) || typeof c.paused !== 'boolean' || typeof c.exportArchive !== 'boolean' || typeof c.exportProjectNotes !== 'boolean') throw new Error('配置格式无效');
  new Intl.DateTimeFormat('zh-CN', { timeZone: c.timezone }).format();
  if (c.language !== undefined && c.language !== 'zh' && c.language !== 'en') throw new Error('语言必须为 zh 或 en');
  const syncDelaySeconds = c.syncDelaySeconds ?? 10, fileCheckSeconds = c.fileCheckSeconds ?? 30;
  if (!Number.isInteger(syncDelaySeconds) || syncDelaySeconds < 3 || syncDelaySeconds > 300 || !Number.isInteger(fileCheckSeconds) || fileCheckSeconds < 10 || fileCheckSeconds > 300) throw new Error('同步延迟需为 3–300 秒，文件检查间隔需为 10–300 秒');
  return { ...c, projectIds: [...new Set(c.projectIds)], syncDelaySeconds, fileCheckSeconds, language: c.language ?? 'zh' };
}
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.then(() => { if (disposed) throw new Error('插件已停用'); return work(); });
  queue = result.catch(() => {}); return result;
}
async function ensureEngine(): Promise<SyncEngine> {
  if (!ready) throw new Error(startupError || '桌面接口正在初始化，请稍后重试');
  if (!config.vaultPath) throw new Error('请先选择 vault 文件夹');
  if (!engine) { engine = new SyncEngine(api, new NodeVault(api, config.vaultPath), config); await engine.initialize(); }
  return engine;
}
async function status(): Promise<SyncStatus> {
  const snapshot = await readSnapshot(api);
  return { config, running: engine?.running || false, lastSync: engine?.state.lastSync || null,
    issues: startupError ? [{ code: 'startup', message: startupError }] : engine?.issues || [],
    projects: Object.values(snapshot.projects).filter((p) => !p.isArchived),
    removed: Object.entries(engine?.state.removed || {}).map(([id, record]) => ({ id, title: record.snapshot.title, reason: record.reason })),
    tasks: Object.values(snapshot.tasks).filter((task) => config.projectIds.includes(task.projectId)).map((task) => ({ id: task.id, title: task.title, expectedFinish: engine?.state.metadata[task.id]?.expectedFinish || null })) };
}
async function runSync(): Promise<void> {
  if (!config.vaultPath || !config.projectIds.length || config.paused || !ready) return;
  const active = await ensureEngine(); await active.sync(); lastFullCheck = Date.now();
  try { fingerprint = await active.io.fingerprint(); lastFileCheck = Date.now(); } catch { /* engine reports filesystem failures on the next pass */ }
}
function schedule(): void {
  if (disposed || config.paused) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; void serial(runSync).catch(report); }, (config.syncDelaySeconds ?? 10) * 1000);
}
function report(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (engine) engine.issues = [...engine.issues.filter((issue) => issue.code !== 'background'), { code: 'background', message }];
  else startupError = message;
}
api.registerMenuEntry({ label: 'Obsidian Sync / Obsidian 同步', icon: 'sync', onClick: () => api.showIndexHtmlAsView() });
api.registerConfigHandler(() => api.showIndexHtmlAsView());
api.registerHeaderButton({ label: 'Obsidian: Sync now / 立即同步', icon: 'sync', onClick: () => { void serial(runSync).then(() => api.showSnack({ msg: translate(engine?.issues.length ? '同步有待处理问题，请打开 Obsidian 同步面板' : 'Obsidian 同步完成', config.language), type: engine?.issues.length ? 'WARNING' : 'SUCCESS' })).catch(report); } });
for (const hook of ['anyTaskUpdate', 'projectListUpdate', 'persistedDataChanged']) api.registerHook(hook, () => { if (!engine?.running) schedule(); });
api.onMessage(async (input) => {
  const message = input as { command: string; [key: string]: unknown };
  if (!message || typeof message.command !== 'string') throw new Error('消息格式无效');
  if (message.command === 'status') return status();
  return serial(async () => {
    switch (message.command) {
      case 'browse': {
        if (!ready) throw new Error('桌面文件接口未就绪');
        return new NodeVault(api, config.vaultPath).browse(typeof message.directory === 'string' ? message.directory : '');
      }
      case 'save-config': {
        const next = validateConfig(message.config);
        const projects = await api.getAllProjects();
        if (next.projectIds.some((id) => !projects.some((p) => p.id === id && !p.isArchived))) throw new Error('配置包含不存在或已归档项目');
        if (next.vaultPath && next.vaultPath !== config.vaultPath) await new NodeVault(api, next.vaultPath).fingerprint();
        if (config.vaultPath !== next.vaultPath) { engine?.dispose(); engine = null; fingerprint = ''; }
        config = next; if (engine) engine.config = config;
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); startupError = null;
        if (config.vaultPath) await ensureEngine();
        if (config.paused && timer) { clearTimeout(timer); timer = undefined; } else schedule();
        return status();
      }
      case 'sync': {
        if (timer) { clearTimeout(timer); timer = undefined; }
        if (config.paused) throw new Error('同步已暂停，请先恢复');
        await runSync(); return status();
      }
      case 'restore': { const active = await ensureEngine(); await active.restore(String(message.id)); await runSync(); return status(); }
      case 'rebuild': { const active = await ensureEngine(); await active.rebuild(String(message.id)); await runSync(); return status(); }
      case 'set-expected': { const active = await ensureEngine(); await active.setExpectedFinish(String(message.id), message.value === null ? null : String(message.value)); schedule(); return status(); }
      case 'resolve-reference': { const active = await ensureEngine(); await active.resolveReference(String(message.path), String(message.body)); await runSync(); return status(); }
      case 'backups': return (await ensureEngine()).io.backups();
      case 'read-backup': {
        const path = String(message.path); if (!path.startsWith('Super Productivity/.sp-sync/backups/')) throw new Error('不是插件备份');
        const file = await (await ensureEngine()).io.read(path); if (!file) throw new Error('备份不存在'); return JSON.parse(file.content);
      }
      case 'restore-backup': {
        const active = await ensureEngine();
        config = { ...config, paused: true }; active.config = config;
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
        if (timer) { clearTimeout(timer); timer = undefined; }
        await active.restoreBackup(String(message.path)); return status();
      }
      default: throw new Error('未知操作');
    }
  });
});
api.onReady(async () => {
  ready = true;
  lastFileCheck = Date.now();
  try { if (config.vaultPath) await ensureEngine(); schedule(); } catch (error) { report(error); }
  interval = setInterval(() => {
    if (checking || disposed || config.paused || !config.vaultPath || !config.projectIds.length || engine?.running) return;
    if (Date.now() - lastFileCheck < (config.fileCheckSeconds ?? 30) * 1000) return;
    lastFileCheck = Date.now();
    checking = true;
    void serial(async () => {
      const active = await ensureEngine(), next = await active.io.fingerprint();
      if (next !== fingerprint) { fingerprint = next; schedule(); }
      if (Date.now() - lastFullCheck >= 120000 && !timer) schedule();
    }).catch(report).finally(() => { checking = false; });
  }, 2000);
});
api.onUnload(() => { disposed = true; ready = false; engine?.dispose(); if (timer) clearTimeout(timer); if (interval) clearInterval(interval); });
