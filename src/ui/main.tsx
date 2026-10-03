import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { SyncConfig, SyncStatus } from '../types';
import { defaultConfig } from '../types';
import type { DirectoryView } from '../adapters/vault';
import { rpc } from './rpc';
import './style.css';

function App() {
  const [status, setStatus] = createSignal<SyncStatus>();
  const [config, setConfig] = createSignal<SyncConfig>(defaultConfig());
  const [error, setError] = createSignal(''); const [busy, setBusy] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const [connectionError, setConnectionError] = createSignal('');
  const [operation, setOperation] = createSignal('');
  const [directory, setDirectory] = createSignal<DirectoryView>();
  const [backups, setBackups] = createSignal<Array<{ path: string; originalPath: string; created: string }>>([]);
  const [preview, setPreview] = createSignal<{ content: string; path?: string }>();
  const [search, setSearch] = createSignal(''); const [dirty, setDirty] = createSignal(false);
  const [timeDrafts, setTimeDrafts] = createSignal<Record<string, string>>({});
  let browseGeneration = 0;
  let browseController: AbortController | undefined;
  const update = (change: Partial<SyncConfig>) => { setConfig((c) => ({ ...c, ...change })); setDirty(true); };
  async function refresh() {
    if (refreshing()) return;
    setRefreshing(true);
    try {
      const result = await rpc<SyncStatus>('status'); setStatus(previous => JSON.stringify(previous) === JSON.stringify(result) ? previous : result); if (!dirty()) setConfig(result.config);
      setConnectionError('');
    } catch (e) { setConnectionError((e as Error).message); }
    finally { setRefreshing(false); }
  }
  async function act(work: () => Promise<void>, label = '正在处理，请稍候…') {
    if (busy()) return; setBusy(true); setError(''); setOperation(label);
    try { await work(); } catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message); } finally { setBusy(false); setOperation(''); }
  }
  async function save(next = config()) {
    const result = await rpc<SyncStatus>('save-config', { config: next }); setStatus(result); setConfig(result.config); setDirty(false);
  }
  async function command(command: string, data: Record<string, unknown> = {}) { setStatus(await rpc<SyncStatus>(command, data)); }
  async function browse(path: string) {
    const generation = ++browseGeneration;
    const controller = new AbortController(); browseController = controller;
    try {
      const result = await rpc<DirectoryView>('browse', { directory: path }, controller.signal);
      if (generation === browseGeneration) setDirectory(result);
    } finally { if (browseController === controller) browseController = undefined; }
  }
  function closeDirectory() { ++browseGeneration; browseController?.abort(); setDirectory(undefined); }
  const unavailable = () => busy() || !status();
  onMount(() => {
    void refresh(); const timer = setInterval(() => { if (!busy() && document.visibilityState === 'visible') void refresh(); }, 10000);
    const focus = () => { if (!busy()) void refresh(); }; window.addEventListener('focus', focus);
    onCleanup(() => { clearInterval(timer); window.removeEventListener('focus', focus); browseController?.abort(); });
  });
  return <main>
    <header><div><span class="eyebrow">SUPER PRODUCTIVITY × OBSIDIAN</span><h1>把任务与笔记放在一起</h1><p>按项目同步到你的 vault，保留内容、引用与计划。</p></div><span classList={{ badge: true, paused: config().paused }}>{config().paused ? '已暂停' : status()?.running ? '同步中' : '自动同步'}</span></header>
    <Show when={!status() || connectionError()}><div class="connection" role="status"><span>{connectionError() || '正在连接 Super Productivity 后台…'}</span><button disabled={refreshing()} onClick={() => void refresh()}>{refreshing() ? '连接中…' : '重新连接'}</button></div></Show>
    <Show when={error()}><div role="alert" class="alert">{error()}</div></Show>
    <Show when={busy()}><p class="progress" role="status">{operation()}</p></Show>
    <section class="card"><h2>连接 vault</h2><label for="vault">Obsidian 文件夹</label><div class="row"><input id="vault" disabled={unavailable()} placeholder="D:\Notes\MyVault" value={config().vaultPath} onInput={(e) => update({ vaultPath: e.currentTarget.value })} /><button disabled={unavailable()} onClick={() => void act(() => browse(config().vaultPath), '正在读取文件夹；首次使用请在 Super Productivity 的 Node 权限对话框中选择允许。')}>选择文件夹</button></div><p class="hint">内容写入 Super Productivity/；引用笔记保留在原位置。</p>
      <label for="zone">具体时间使用的时区</label><input id="zone" disabled={unavailable()} value={config().timezone} onInput={(e) => update({ timezone: e.currentTarget.value })} />
      <div class="project-grid"><div><label for="delay">自动同步延迟</label><select id="delay" disabled={unavailable()} value={config().syncDelaySeconds ?? 10} onChange={(e) => update({ syncDelaySeconds: Number(e.currentTarget.value) })}><For each={[3, 10, 30, 60, 120, 300]}>{seconds => <option value={seconds}>{seconds} 秒</option>}</For></select></div><div><label for="poll">文件检查间隔</label><select id="poll" disabled={unavailable()} value={config().fileCheckSeconds ?? 30} onChange={(e) => update({ fileCheckSeconds: Number(e.currentTarget.value) })}><For each={[10, 30, 60, 120, 300]}>{seconds => <option value={seconds}>{seconds} 秒</option>}</For></select></div></div><p class="hint">变更集中后再同步，减少磁盘调用；“立即同步”可随时执行。</p>
    </section>
    <section class="card"><h2>选择同步项目</h2><div class="project-grid"><For each={status()?.projects || []}>{(project) => <label class="check"><input type="checkbox" disabled={unavailable()} checked={config().projectIds.includes(project.id)} onChange={(e) => update({ projectIds: e.currentTarget.checked ? [...config().projectIds, project.id] : config().projectIds.filter((id) => id !== project.id) })} />{project.title}</label>}</For></div><p class="hint">取消选择只停止同步，不删除应用或文件中的内容。</p>
      <div class="options"><label class="check"><input type="checkbox" disabled={unavailable()} checked={config().exportProjectNotes} onChange={(e) => update({ exportProjectNotes: e.currentTarget.checked })} />导出原生项目笔记（只读）</label><label class="check"><input type="checkbox" disabled={unavailable()} checked={config().exportArchive} onChange={(e) => update({ exportArchive: e.currentTarget.checked })} />导出历史归档（只读）</label></div>
      <div class="row actions"><button class="primary" disabled={unavailable() || !config().vaultPath || !config().projectIds.length} onClick={() => void act(() => save())}>保存设置</button><button disabled={unavailable() || dirty() || config().paused || !config().projectIds.length} onClick={() => void act(() => command('sync'), '正在同步任务和笔记…')}>立即同步</button><button disabled={unavailable() || dirty()} onClick={() => void act(() => save({ ...config(), paused: !config().paused }))}>{config().paused ? '恢复同步' : '暂停同步'}</button></div>
      <p class="hint">{dirty() ? '设置已修改，保存后生效。' : status()?.lastSync ? `上次成功同步：${new Date(status()!.lastSync!).toLocaleString()}` : '保存设置后开始首次同步。'}</p>
    </section>
    <section class="card"><h2>预计完成时刻</h2><p class="hint">这是独立的补充字段，不会由预计耗时自动推算。输入带偏移的 ISO 时间。</p><input aria-label="搜索任务" placeholder="搜索任务" value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
      <div class="task-list"><For each={(status()?.tasks || []).filter((task) => task.title.includes(search()))}>{(task) => {
        const value = () => timeDrafts()[task.id] ?? task.expectedFinish ?? '';
        return <div class="task-edit"><span>{task.title}</span><input aria-label={`${task.title}预计完成`} placeholder="2026-10-03T16:00:00-07:00" value={value()} onInput={(e) => setTimeDrafts((drafts) => ({ ...drafts, [task.id]: e.currentTarget.value }))} /><button disabled={busy()} onClick={() => void act(async () => { await command('set-expected', { id: task.id, value: value() || null }); setTimeDrafts((drafts) => { const next = { ...drafts }; delete next[task.id]; return next; }); })}>保存</button></div>;
      }}</For></div>
    </section>
    <Show when={status()?.issues.length}><section class="card"><h2>待处理问题</h2><For each={status()?.issues}>{(issue) => <article class="issue"><strong>{issue.message}</strong><Show when={issue.path}><p class="path">{issue.path}</p></Show><div class="row"><For each={issue.candidates}>{(candidate) => <><button onClick={() => setPreview({ content: candidate.body })}>查看：{candidate.label}</button><button disabled={busy()} onClick={() => void act(() => command('resolve-reference', { path: issue.path, body: candidate.body }))}>采用：{candidate.label}</button></>}</For></div></article>}</For><Show when={status()?.issues.some((issue) => issue.message.includes('任务文件缺失'))}><p>重建缺失任务文件：</p><For each={config().projectIds}>{(id) => <button disabled={busy()} onClick={() => void act(() => command('rebuild', { id }))}>{status()?.projects.find((p) => p.id === id)?.title || id}</button>}</For></Show></section></Show>
    <Show when={status()?.removed.length}><section class="card"><h2>已移除的同步关联</h2><p class="hint">任务 note 已移入恢复目录；删除行会保留应用原任务及 notes，恢复关联后重新生成文件。</p><For each={status()?.removed}>{(record) => <div class="row removed"><div><strong>{record.title}</strong><p class="hint">{record.reason}</p></div><button disabled={busy()} onClick={() => void act(() => command('restore', { id: record.id }))}>恢复关联</button></div>}</For></section></Show>
    <section class="card"><div class="row between"><h2>备份与 AI 指南</h2><button disabled={busy() || !config().vaultPath} onClick={() => void act(async () => { setBackups(await rpc('backups')); })}>查看备份</button></div><p>AI 编辑指南随同步内容写入 <code>Super Productivity/README.md</code>。索引会链接到它。</p><For each={backups()}>{(backup) => <div class="backup"><div><strong>{backup.originalPath}</strong><p class="hint">{new Date(backup.created).toLocaleString()}</p></div><button disabled={busy()} onClick={() => void act(async () => { const data = await rpc<{ content: string }>('read-backup', { path: backup.path }); setPreview({ content: data.content, path: backup.path }); })}>查看／恢复</button></div>}</For></section>
    <footer>格式 v1 · 原生项目笔记与历史归档默认不导出 · 同一 vault 使用单台设备写入</footer>
    <Show when={directory()}>{(dir) => <div class="overlay"><section class="dialog" role="dialog" aria-modal="true" aria-label="选择 vault"><h2>选择 vault 文件夹</h2><p class="path">{dir().directory || '选择磁盘'}</p><Show when={busy()}><p role="status" class="hint">正在读取文件夹，请稍候…</p></Show><div class="directory-list"><Show when={dir().parent && dir().parent !== dir().directory}><button disabled={busy()} onClick={() => void act(() => browse(dir().parent!))}>↑ 上一级</button></Show><For each={dir().directories}>{(path) => <button disabled={busy()} onClick={() => void act(() => browse(path))}>{path}</button>}</For></div><div class="row actions"><button class="primary" disabled={busy() || !dir().directory} onClick={() => { update({ vaultPath: dir().directory }); closeDirectory(); }}>使用此文件夹</button><button onClick={closeDirectory}>取消</button></div></section></div>}</Show>
    <Show when={preview()}>{(data) => <div class="overlay"><section class="dialog wide" role="dialog" aria-modal="true" aria-label="内容预览"><h2>内容预览</h2><pre>{data().content}</pre><div class="row actions"><Show when={data().path}><button disabled={busy()} onClick={() => void act(async () => { await command('restore-backup', { path: data().path }); setPreview(undefined); })}>恢复此备份（当前版本也会备份）</button></Show><button onClick={() => setPreview(undefined)}>关闭</button></div></section></div>}</Show>
  </main>;
}
render(() => <App />, document.getElementById('root')!);
