import { expect, it } from 'vitest';
import { languageOf, noteLabel, translate } from '../src/i18n';

it('defaults old settings to Chinese and exposes English notes labels', () => {
  expect(languageOf(undefined)).toBe('zh'); expect(noteLabel()).toBe('笔记'); expect(noteLabel('en')).toBe('notes');
  expect(translate('保存设置', 'en')).toBe('Save settings'); expect(translate('保存设置', 'zh')).toBe('保存设置');
});
it('translates diagnostics without changing a user title or path', () => {
  const title='保存设置；差异字段：自己的任务', path='资料/无效日期：示例.md';
  expect(translate(`应用更新未通过读回验证：${title}；差异字段：tags。暂停该项目，其余项目继续。`, 'en'))
    .toBe(`App update failed readback verification: ${title}; differing fields: tags. This project is paused; other projects continue.`);
  expect(translate(`文件已在同步期间变化，请重新同步：${path}`, 'en')).toBe(`The file changed during sync. Sync again: ${path}`);
});
it('translates nested line errors while preserving unknown host errors', () => {
  expect(translate('第 12 行：字段重复 sp-notes', 'en')).toBe('Line 12: Duplicate field sp-notes');
  expect(translate('第 3 行：无效日期 2026-02-30', 'en')).toBe('Line 3: Invalid date 2026-02-30');
  expect(translate('EACCES: permission denied, open 资料.md', 'en')).toBe('EACCES: permission denied, open 资料.md');
});
