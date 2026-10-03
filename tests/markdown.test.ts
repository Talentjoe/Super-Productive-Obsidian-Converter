import { describe, expect, it } from 'vitest';
import { marked } from 'marked';
import { parseTasks, renderRow, rewriteTasks } from '../src/core/markdown';
import { validDay, timestamp, fromHost } from '../src/core/dates';
import { composeNote, noteParts, referenceTargets, resolveReference, excerpt } from '../src/core/references';

describe('lossless task syntax', () => {
  it('parses compact note aliases and legacy wiki/plain fields without making them part of the title', () => {
    const path='Super Productivity/projects/示例--p/task-notes/id';
    for(const syntax of [`[[${path}|笔记]]`,`[sp-notes:: [[${path}]]]`,`[sp-notes:: [[${path}|笔记]]]`,`[sp-notes:: ${path}]`]) {
      const row=parseTasks(`- [ ] 标题 ${syntax} <!-- sp:task:a --> ^sp-61`,'p1').rows[0];
      expect(row.id).toBe('a');expect(row.value.title).toBe('标题');expect(row.notePath).toBe(path+'.md');
      expect(renderRow('a',row.value,row.notePath!)).toContain(`[[${path}|笔记]]`);
    }
    expect(()=>parseTasks(`- [ ] A [[${path}|笔记]] [sp-notes:: [[${path}]]]`,'p1')).toThrow('重复');
    expect(()=>parseTasks(`- [ ] A [[${path}|笔记]] [[${path}/two|笔记]]`,'p1')).toThrow('重复');
    const value=parseTasks('- [ ] 原始标题','p1').rows[0].value;value.title=`文字 [[${path}|笔记]]`;
    expect(parseTasks(renderRow('a',value,path+'.md'),'p1').rows[0].value).toEqual(value);
  });
  it('round-trips Unicode, literal syntax, all time fields and task identity', () => {
    const original = parseTasks('- [ ] 原始任务 #工作 ⏳ 2026-10-03 📅 2026-10-05 [sp-estimate-minutes:: 90] [sp-planned-time:: 14:00] [sp-deadline-time:: 18:00] [sp-expected-finish:: 2026-10-03T16:00:00-07:00]', 'p1').rows[0].value;
    original.title = '文本 #不是标签 ⏳ [sp-test:: literal] \\ 路径';
    const rendered = renderRow('t_1', original, 'Super Productivity/projects/p/task-notes/n.md');
    expect(parseTasks(rendered, 'p1').rows[0]).toMatchObject({ id: 't_1', value: original });
  });
  it('preserves YAML, headings, prose and fenced checkboxes while reordering task slots', () => {
    const input = '---\ncustom: yes\n---\n# 标题\n- [ ] A\n## 用户标题\n自由正文\n- [ ] B\n```md\n- [ ] 不是任务\n```\n';
    const doc = parseTasks(input, 'p1'); expect(doc.rows).toHaveLength(2);
    const output = rewriteTasks(doc, ['- [x] B', '- [ ] A'], 'p1', '项目');
    expect(output).toContain('custom: yes'); expect(output).toContain('## 用户标题\n自由正文'); expect(output).toContain('```md\n- [ ] 不是任务\n```');
  });
  it.each(['- [ ] 根\n  - [ ] 子\n    - [ ] 孙', '- [ ] A <!-- sp:task:a -->\n- [ ] B <!-- sp:task:a -->', '- [ ] A 📅 2026-02-30', '- [ ] A [sp-estimate-minutes:: -1]', '- [ ] A [sp-planned-time:: 14:00]', '```\n- [ ] A'])('rejects unsafe syntax %s', (input) => expect(() => parseTasks(input, 'p1')).toThrow());
  it('preserves CRLF', () => { const doc = parseTasks('# header\r\n- [ ] A\r\n', 'p1'); expect(rewriteTasks(doc, ['- [x] A'], 'p1', 'P')).toBe('# header\r\n- [x] A\r\n'); });
  it('imports elegant estimates and legacy syntax, rejecting duplicate or invalid values', () => {
    const row=parseTasks('- [ ] 任务 estimate [60min](sp-estimate-minutes:: 60)','p1').rows[0];
    expect(row.value.title).toBe('任务'); expect(row.value.estimate).toBe(3600000);
    expect(renderRow('a',row.value,'notes.md')).toContain('estimate [60min](<sp-estimate-minutes:: 60>)');
    expect(parseTasks('- [ ] 任务 estimate [60min](<sp-estimate-minutes:: 60>)','p1').rows[0].value).toEqual(row.value);
    expect(parseTasks('- [ ] 任务 [label](sp-estimate-minutes:: 1.5)','p1').rows[0].value.estimate).toBe(90000);
    expect(()=>parseTasks('- [ ] A estimate [x](sp-estimate-minutes:: -1)','p1')).toThrow();
    expect(()=>parseTasks('- [ ] A estimate [60min](sp-estimate-minutes:: 60) [sp-estimate-minutes:: 30]','p1')).toThrow('重复');
    const literal={...row.value,title:'保留 estimate [60min](<sp-estimate-minutes:: 60>) 原文'};
    expect(parseTasks(renderRow('a',literal,'notes.md'),'p1').rows[0].value).toEqual(literal);
  });
  it('renders the exported estimate as a Markdown link with only minutes visible', () => {
    const value=parseTasks('- [ ] 任务 [sp-estimate-minutes:: 60]','p1').rows[0].value;
    const field=renderRow('a',value,'notes.md').match(/estimate \[[^\]]+\]\(<[^>]+>\)/)![0];
    expect(marked.parseInline(field)).toBe('estimate <a href="sp-estimate-minutes::%2060">60min</a>');
  });
});
describe('calendar times', () => {
  it('distinguishes all-day from timestamps across timezones', () => {
    expect(validDay('2028-02-29')).toBe(true); expect(validDay('2026-02-29')).toBe(false);
    expect(fromHost('2026-10-03', null, 'Asia/Shanghai')).toEqual({ day: '2026-10-03', time: null });
    const ms = timestamp('2026-10-03', '23:30', 'America/Los_Angeles')!;
    expect(fromHost(null, ms, 'America/Los_Angeles')).toEqual({ day: '2026-10-03', time: '23:30' });
    expect(fromHost(null, ms, 'Asia/Shanghai').day).toBe('2026-10-04');
  });
  it('rejects daylight saving gaps and consistently chooses earlier folds', () => {
    expect(() => timestamp('2026-03-08', '02:30', 'America/Los_Angeles')).toThrow('不存在');
    expect(new Date(timestamp('2026-11-01', '01:30', 'America/Los_Angeles')!).toISOString()).toBe('2026-11-01T08:30:00.000Z');
  });
});
describe('reference blocks', () => {
  it('preserves exact paragraphs and blank lines without recursive expansion', () => {
    const own = '按 [[资料/方案]] 做。\n\n正文\n', body = '段落一\n\n- [ ] 正文复选框\n\n[[下一篇]]\n';
    const note = composeNote(own, [{ path: '资料/方案.md', body }]);
    expect(noteParts(note)).toEqual({ own, embedded: [{ path: '资料/方案.md', body }] });
    expect(referenceTargets(noteParts(note).own)).toEqual(['资料/方案']);
  });
  it('rejects broken boundaries, ambiguous names and paths escaping the vault', () => {
    expect(() => noteParts('<!-- sp-references:start -->broken')).toThrow();
    expect(() => resolveReference('方案', 'tasks/n.md', ['a/方案.md', 'b/方案.md'])).toThrow('重名');
    expect(resolveReference('../方案', 'tasks/n.md', ['方案.md'])).toEqual({ path: '方案.md', anchor: null });
    expect(() => resolveReference('../../方案', 'tasks/n.md', ['方案.md'])).toThrow();
  });
  it('locates heading and block excerpts', () => {
    const note = '# 大标题\nintro\n## 子标题\n内容\n\n段落 ^block\n## 下一节\n结尾';
    expect(excerpt(note, '子标题')).toContain('内容'); expect(excerpt(note, '子标题')).not.toContain('结尾'); expect(excerpt(note, '^block')).toBe('段落 ^block');
  });
  it('retains free prose after reference blocks including its trailing blank lines', () => {
    const note = composeNote('说明\n\n', [{path:'源.md',body:'正文'}]) + '\n\n补充\n\n';
    expect(noteParts(note).own).toBe('说明\n\n\n\n补充\n\n');
  });
});
