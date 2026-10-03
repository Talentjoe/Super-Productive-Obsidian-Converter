import type { AppSnapshot, HostTask, HostProject, SyncLanguage, SyncState, TaskValue } from '../types';
import { noteLabel, translate } from '../i18n';
import { fromHost } from './dates';
import { link, safeName, stableId } from './text';

export const ROOT = 'Super Productivity';
export const taskFile = (state: SyncState, projectId: string) => `${state.projects[projectId].directory}/tasks.md`;
export const taskLink = (state: SyncState, id: string, value: TaskValue) => link(`${taskFile(state, value.projectId)}#^sp-${stableId(id)}`, value.title);
export const isTagAlias = (value: string): boolean => /^[\p{L}\p{M}\p{N}_\-\p{Extended_Pictographic}\uFE0F\u200D]+(?:\/[\p{L}\p{M}\p{N}_\-\p{Extended_Pictographic}\uFE0F\u200D]+)*$/u.test(value) && /[^\p{N}]/u.test(value);
export function tagAliases(snapshot: AppSnapshot, existing: Record<string, string>): Record<string, string> {
  const aliases = { ...existing }; const used = new Set(Object.values(aliases).map(alias=>alias.toLowerCase()));
  for (const tag of Object.values(snapshot.tags)) {
    if (tag.id === 'TODAY' || aliases[tag.id]) continue;
    const candidate = isTagAlias(tag.title) ? tag.title : `${safeName(tag.title).replace(/[^\p{L}\p{M}\p{N}_-]/gu, '-') || 'tag'}--${stableId(tag.id)}`;
    aliases[tag.id] = used.has(candidate.toLowerCase()) ? `${candidate}--${stableId(tag.id)}` : candidate; used.add(aliases[tag.id].toLowerCase());
  }
  return aliases;
}
export function valueFromHost(task: HostTask, state: SyncState, zone: string, project?: HostProject): TaskValue {
  const planned = fromHost(task.dueDay, task.dueWithTime, zone), deadline = fromHost(task.deadlineDay, task.deadlineWithTime, zone);
  return { title: task.title, isDone: task.isDone, projectId: task.projectId, parentId: task.parentId || null,
    list: project?.backlogTaskIds.includes(task.parentId || task.id) ? 'backlog' : 'active',
    tags: [...new Set(task.tagIds.filter((id) => id !== 'TODAY').map((id) => state.tagAliases[id]).filter(Boolean))].sort(),
    estimate: task.timeEstimate || 0, plannedDay: planned.day, plannedTime: planned.time, deadlineDay: deadline.day, deadlineTime: deadline.time,
    expectedFinish: state.metadata[task.id]?.expectedFinish || null, notes: task.notes || '' };
}
export function indexExports(snapshot: AppSnapshot, state: SyncState, selected: string[], zone: string, language?: SyncLanguage): Record<string, { name: string; body: string; initial: string }> {
  const t = (text: string) => translate(text, language);
  const result: Record<string, { name: string; body: string; initial: string }> = {};
  const values = Object.entries(state.baseline).filter(([id, value]) => selected.includes(value.projectId) && !state.removed[id] && snapshot.tasks[id]);
  result[`${ROOT}/index.md`] = { name: 'root', initial: '# Super Productivity\n', body: `${link(`${ROOT}/README`, t('AI 编辑指南'))}\n\n${selected.filter((id) => state.projects[id]).map((id) => `- ${link(`${state.projects[id].directory}/index`, snapshot.projects[id]?.title || state.projects[id].title)}`).join('\n')}\n\n- ${link(`${ROOT}/calendar/index`, t('日历索引'))}` };
  for (const projectId of selected) {
    const binding = state.projects[projectId]; if (!binding) continue;
    const tasks = values.filter(([, v]) => v.projectId === projectId);
    result[`${binding.directory}/index.md`] = { name: 'project', initial: `# ${t('项目索引')}\n`, body: `## ${snapshot.projects[projectId]?.title || binding.title}\n\n${link(`${ROOT}/README`, t('AI 编辑指南'))} · ${link(taskFile(state, projectId), t('编辑任务'))}\n\n${tasks.map(([id, value]) => `- ${taskLink(state, id, value)} · ${link(state.notesPaths[id], noteLabel(language))}`).join('\n')}` };
  }
  for (const tag of Object.values(snapshot.tags)) {
    if (tag.id === 'TODAY') continue;
    const tasks = values.filter(([, v]) => v.tags.includes(state.tagAliases[tag.id])); if (!tasks.length) continue;
    const path = `${ROOT}/tags/${safeName(state.tagAliases[tag.id])}--${stableId(tag.id)}.md`;
    result[path] = { name: 'tag', initial: `---\nsp-tag-id: ${JSON.stringify(tag.id)}\nsp-tag-title: ${JSON.stringify(tag.title)}\nsp-tag-color: ${JSON.stringify(tag.color || null)}\n---\n# ${t('标签索引')}\n`, body: `## ${tag.title}\n\n${t('别名')}: \`#${state.tagAliases[tag.id]}\`\n\n${tasks.map(([id, value]) => `- ${taskLink(state, id, value)}`).join('\n')}` };
  }
  const tags = Object.entries(result).filter(([, index]) => index.name === 'tag');
  if (tags.length) result[`${ROOT}/index.md`].body += `\n\n## ${t('标签')}\n\n${tags.map(([path, index]) => `- ${link(path, propertyTitle(index.body))}`).join('\n')}`;
  const days = new Map<string, string[]>();
  for (const [id, value] of values) {
    const expected = value.expectedFinish ? fromHost(null, Date.parse(value.expectedFinish), zone).day : null;
    for (const [type, day] of [['计划执行', value.plannedDay], ['截止', value.deadlineDay], ['预计完成', expected]] as const) {
      if (!day) continue; const lines = days.get(day) || [];
      lines.push(`- ${t(type)}: ${taskLink(state, id, value)} · ${link(state.notesPaths[id], noteLabel(language))}`); days.set(day, lines);
    }
  }
  for (const [day, lines] of days) result[`${ROOT}/calendar/${day}.md`] = { name: 'calendar', initial: `# ${day}\n\n## ${t('下一步计划')}\n\n`, body: `## ${t('任务索引（只读）')}\n\n${lines.join('\n')}` };
  result[`${ROOT}/calendar/index.md`] = { name: 'calendar-index', initial: `# ${t('日历')}\n`, body: [...days.keys()].sort().map((day) => `- ${link(`${ROOT}/calendar/${day}`, day)}`).join('\n') };
  return result;
}
const propertyTitle = (body: string) => body.split('\n')[0].replace(/^## /, '');
