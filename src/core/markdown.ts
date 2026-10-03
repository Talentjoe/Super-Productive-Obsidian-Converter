import type { SyncLanguage, TaskValue } from '../types';
import { noteLabel, translate } from '../i18n';
import { validDay, validateExpected, validateTime } from './dates';
import { frontmatterBody, link, stableId } from './text';

export interface TaskRow {
  id: string | null; operationId: string | null; parentKey: string | null; key: string;
  value: TaskValue; notePath: string | null; line: number;
}
export interface TaskDocument { content: string; lines: string[]; rows: TaskRow[]; newline: string }
const fieldPattern = /(?<!\\)\[(sp-[a-z-]+)::\s*(\[\[[^\n]*?\]\]|[^\]\n]*)\]/g;
const noteLinkPattern = /(?<![\\!])\[\[([^|\]#\r\n]+)\|(?:笔记|notes)\]\]/g;
const supported = new Set(['sp-planned-time', 'sp-deadline-time', 'sp-estimate-minutes', 'sp-expected-finish', 'sp-notes', 'sp-spent-minutes', 'sp-completed-at', 'sp-list']);
const unescapeTitle = (title: string) => title.replace(/\\([\\#\[<^⏳📅])/gu, '$1');
export const escapeTitle = (title: string) => title.replace(/\\/g, '\\\\').replace(/[#⏳📅]/gu, '\\$&').replace(/\[sp-|<!--|\^sp-/g, '\\$&').replace(/\[(?=[^\]\n]+\]\(<?sp-estimate-minutes::)/g, '\\[').replace(/\[(?=\[[^|\]#\r\n]+\|(?:笔记|notes)\]\])/g, '\\[');

export function parseTasks(content: string, projectId: string, previousParents: Record<string, string | null> = {}): TaskDocument {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/), rows: TaskRow[] = [];
  const prefix = frontmatterBody(content).prefix;
  if (prefix) {
    const identity = /^sp-project-id:\s*(.+)$/m.exec(prefix);
    if (identity) {
      let value = identity[1].trim();
      if (value.startsWith('"')) value = JSON.parse(value);
      if (value !== projectId) throw new Error('文件的 sp-project-id 与项目绑定不一致');
    }
  }
  let fence: string | null = null, prefixLines = prefix ? prefix.split(/\r?\n/).length - 1 : 0;
  let parent: TaskRow | null = null, childIndent: number | null = null;
  const ids = new Set<string>();
  const documentIds = new Set([...content.matchAll(/<!-- sp:task:([A-Za-z0-9_-]+) -->/g)].map((m) => m[1]));
  for (let line = 0; line < lines.length; line++) {
    if (line < prefixLines) continue;
    const text = lines[line];
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(text);
    if (fenceMatch) { if (!fence) fence = fenceMatch[1]; else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null; continue; }
    if (fence) continue;
    const checkbox = /^(\s*)[-*+] \[([ xX])\]\s+(.+)$/.exec(text);
    if (!checkbox) { if (/^\s*[-*+] \[/.test(text)) throw new Error(`第 ${line + 1} 行：复选框格式无效`); continue; }
    const indent = checkbox[1].replace(/\t/g, '    ').length;
    if (indent && (indent > 4 || (childIndent !== null && indent !== childIndent))) throw new Error(`第 ${line + 1} 行：仅支持父任务和一层子任务`);
    if (indent) childIndent ??= indent;
    let title = checkbox[3];
    const idMatch = /(?<!\\)<!-- sp:task:([A-Za-z0-9_-]+) -->/.exec(title);
    const opMatch = /(?<!\\)<!-- sp-op:([a-zA-Z0-9-]+) -->/.exec(title);
    if (!idMatch && /(?<!\\)\^sp-[a-f0-9]+\s*$/.test(title)) throw new Error(`第 ${line + 1} 行：任务 ID 标记被删除，恢复标记后再同步`);
    const id = idMatch?.[1] ?? null;
    // A deleted parent line must suspend its family, even if an earlier root remains.
    const missingParent = id && previousParents[id] && !documentIds.has(previousParents[id]!) ? previousParents[id]! : null;
    const parentId = indent ? missingParent || parent?.id || null : null;
    const parentKey = indent ? missingParent || parent?.key || null : null;
    if (indent && !parentKey) throw new Error(`第 ${line + 1} 行：子任务缺少父任务`);
    if (id && ids.has(id)) throw new Error(`重复任务 ID：${id}`);
    if (id) ids.add(id);
    title = title.replace(/(?<!\\)<!-- sp:task:[A-Za-z0-9_-]+ -->/g, '').replace(/(?<!\\)<!-- sp-op:[a-zA-Z0-9-]+ -->/g, '').replace(/(?<!\\)\^sp-[a-f0-9]+\s*$/, '');
    const fields: Record<string, string> = {};
    title = title.replace(/(?<!\\)(?:\bestimate\s+)?\[([^\]\n]+)\]\((?:<sp-estimate-minutes::\s*([^<>\)\n]+)>|sp-estimate-minutes::\s*([^<>\)\n]+))\)/g, (_, _label: string, wrapped: string | undefined, plain: string | undefined) => {
      if ('sp-estimate-minutes' in fields) throw new Error(`第 ${line + 1} 行：字段重复 sp-estimate-minutes`);
      fields['sp-estimate-minutes'] = (wrapped ?? plain!).trim(); return '';
    });
    title = title.replace(fieldPattern, (_, key: string, value: string) => {
      if (!supported.has(key)) throw new Error(`第 ${line + 1} 行：未知字段 ${key}`);
      if (key in fields) throw new Error(`第 ${line + 1} 行：字段重复 ${key}`);
      fields[key] = value.trim(); return '';
    });
    title = title.replace(noteLinkPattern, (_, path: string) => {
      if ('sp-notes' in fields) throw new Error(`第 ${line + 1} 行：字段重复 sp-notes`);
      fields['sp-notes'] = `[[${path}]]`; return '';
    });
    const planned = [...title.matchAll(/(?<!\\)⏳\s*(\d{4}-\d{2}-\d{2})/g)];
    const deadline = [...title.matchAll(/(?<!\\)📅\s*(\d{4}-\d{2}-\d{2})/g)];
    if (planned.length > 1 || deadline.length > 1) throw new Error(`第 ${line + 1} 行：日期重复`);
    title = title.replace(/(?<!\\)(?:⏳|📅)\s*\d{4}-\d{2}-\d{2}/g, '');
    if (/(?<!\\)(?:⏳|📅)/.test(title)) throw new Error(`第 ${line + 1} 行：日期必须为 YYYY-MM-DD`);
    const tags: string[] = [];
    title = title.replace(/(?<![\\\w])#([^\s#\[\]<>]+)/gu, (_, tag: string) => { tags.push(tag); return ''; });
    title = unescapeTitle(title.trim());
    if (!title) throw new Error(`第 ${line + 1} 行：任务标题为空`);
    const plannedDay = planned[0]?.[1] ?? null, deadlineDay = deadline[0]?.[1] ?? null;
    for (const day of [plannedDay, deadlineDay]) if (day && !validDay(day)) throw new Error(`第 ${line + 1} 行：无效日期 ${day}`);
    const plannedTime = fields['sp-planned-time'] || null, deadlineTime = fields['sp-deadline-time'] || null;
    validateTime(plannedTime); validateTime(deadlineTime);
    if ((plannedTime && !plannedDay) || (deadlineTime && !deadlineDay)) throw new Error(`第 ${line + 1} 行：时间缺少日期`);
    const estimate = fields['sp-estimate-minutes'] ? Number(fields['sp-estimate-minutes']) * 60000 : 0;
    if (!Number.isFinite(estimate) || estimate < 0) throw new Error(`第 ${line + 1} 行：预计耗时必须为非负分钟数`);
    const expectedFinish = fields['sp-expected-finish'] || null; validateExpected(expectedFinish);
    if (fields['sp-list'] && !['active', 'backlog'].includes(fields['sp-list'])) throw new Error('sp-list 必须为 active 或 backlog');
    let notePath: string | null = null;
    if (fields['sp-notes']) {
      const target = /^\[\[([^|\]#]+)(?:\|[^\]]*)?\]\]$/.exec(fields['sp-notes']);
      const plain = /^Super Productivity\/projects\/[^|\]#\r\n]+\/task-notes\/[^|\]#\r\n]+$/.test(fields['sp-notes']) ? fields['sp-notes'] : null;
      const path = target?.[1] || plain;
      if (!path) throw new Error(`第 ${line + 1} 行：sp-notes 必须是整篇笔记链接`);
      notePath = path.endsWith('.md') ? path : `${path}.md`;
    }
    const key = id || opMatch?.[1] || `line-${line}`;
    const row: TaskRow = { id, operationId: opMatch?.[1] ?? null, parentKey, key, line, notePath,
      value: { title, isDone: checkbox[2] !== ' ', projectId, parentId, list: indent ? parent?.value.list || 'active' : (fields['sp-list'] === 'backlog' ? 'backlog' : 'active'), tags: [...new Set(tags)].sort(), estimate, plannedDay, plannedTime, deadlineDay, deadlineTime, expectedFinish, notes: '' } };
    rows.push(row); if (!indent) { parent = row; childIndent = null; }
  }
  if (fence) throw new Error('代码块未闭合，文件暂不同步');
  return { content, lines, rows, newline };
}

export function renderRow(id: string, value: TaskValue, notePath: string, spent = 0, completed: number | null = null, language?: SyncLanguage): string {
  const fields: string[] = [];
  if (value.plannedDay) fields.push(`⏳ ${value.plannedDay}`);
  if (value.deadlineDay) fields.push(`📅 ${value.deadlineDay}`);
  if (value.plannedTime) fields.push(`[sp-planned-time:: ${value.plannedTime}]`);
  if (value.deadlineTime) fields.push(`[sp-deadline-time:: ${value.deadlineTime}]`);
  if (value.estimate) fields.push(`estimate [${value.estimate / 60000}min](<sp-estimate-minutes:: ${value.estimate / 60000}>)`);
  if (value.expectedFinish) fields.push(`[sp-expected-finish:: ${value.expectedFinish}]`);
  if (!value.parentId && value.list === 'backlog') fields.push('[sp-list:: backlog]');
  fields.push(link(notePath, noteLabel(language)));
  if (spent) fields.push(`[sp-spent-minutes:: ${Math.round(spent / 600) / 100}]`);
  if (completed) fields.push(`[sp-completed-at:: ${new Date(completed).toISOString()}]`);
  return `${value.parentId ? '  ' : ''}- [${value.isDone ? 'x' : ' '}] ${escapeTitle(value.title)}${value.tags.length ? ` ${value.tags.map((t) => `#${t}`).join(' ')}` : ''} ${fields.join(' ')} <!-- sp:task:${id} --> ^sp-${stableId(id)}`;
}

/** Replace task slots, retaining every non-task line, even between task families. */
export function rewriteTasks(doc: TaskDocument, rows: string[], projectId: string, title: string, language?: SyncLanguage): string {
  const slots = new Set(doc.rows.map((r) => r.line));
  let cursor = 0;
  const result = doc.lines.flatMap((line, index) => slots.has(index) ? (cursor < rows.length ? [rows[cursor++]] : []) : [line]);
  const extra = rows.slice(cursor);
  if (extra.length) { if (result.at(-1) === '') result.pop(); result.push(...extra, ''); }
  if (!doc.content) result.unshift('---', `sp-project-id: ${JSON.stringify(projectId)}`, 'sp-format-version: 1', '---', `# ${title}`, '', `> ${translate('编辑此文件的任务；修改前参阅', language)} ${link('Super Productivity/README', translate('AI 编辑指南', language))}.`, '');
  return result.join(doc.newline);
}

export function stampOperation(doc: TaskDocument, line: number, operationId: string): string {
  const lines = [...doc.lines]; lines[line] += ` <!-- sp-op:${operationId} -->`; return lines.join(doc.newline);
}
