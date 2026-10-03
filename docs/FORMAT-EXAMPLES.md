# 格式示例（版本 1）

以下 ID 仅用于展示。不要把示例中的 `demo-task` 当作已有任务导入；新增任务使用 README 中没有 ID 的示例，成功同步后插件会自动填写身份。

## 项目 tasks.md

```markdown
---
sp-project-id: "demo-project"
sp-project-title: "示例项目"
sp-format-version: 1
custom-owner: "用户自己的属性，插件保留"
---
# 示例项目

用户正文留在任务行之外。

- [ ] 编写需求 #工作 ⏳ 2026-10-03 📅 2026-10-05 [sp-planned-time:: 14:00] [sp-deadline-time:: 18:00] estimate [90min](<sp-estimate-minutes:: 90>) [sp-expected-finish:: 2026-10-03T16:00:00-07:00] [[Super Productivity/projects/示例--demo/task-notes/demo|笔记]] <!-- sp:task:demo-task --> ^sp-64656d6f2d7461736b
- [ ] 新增父任务
  - [ ] 子任务在这里（新增行，不填写已有 ID） estimate [30min](<sp-estimate-minutes:: 30>)
```

真正的项目目录和 notes 文件名由插件自动生成，绑定后保持稳定。可改项目 YAML 名称，跨项目移动保留任务 ID 和原 notes 链接。

`[[路径|笔记]]` 只显示“笔记”，仍指向完整 note 路径。保留 `|笔记` 和路径；旧 `sp-notes` 字段兼容导入并自动规范为此格式。已有子任务的标签只读导出，原生独立标签会保留；子任务提升／重新关联遵循原生标签规则。

独立任务和子任务的 estimate 可以编辑；有子任务的父任务会导出应用汇总的剩余耗时，不能单独设置预算。旧格式 `[sp-estimate-minutes:: 90]` 继续兼容。

## 独立任务 notes

```markdown
---
custom-reviewer: "用户属性不导入原生 notes"
---
第一段任务说明。

第二段可以包含代码和正文复选框，不会生成新任务。

参考 [[资料/方案]]；原笔记 YAML 留在源文件。
```

同步后 notes 末尾会增加 `sp-references` 生成区块，每篇完整引用有一对 `sp-ref:<路径的 UTF-8 十六进制>:start/end` 标记。编辑引用正文时保留边界；引用副本中的正文修改会写回源文件。生成区块之外是任务自己的说明。

Inbox 中没有正文的任务也生成 notes 文件，初始内容为：

```yaml
---
sp-task-id: "实际任务 ID"
sp-project-id: "INBOX_PROJECT"
---
```

删除任务行或在应用删除／归档任务后，项目目录中的托管 note 会清理，完整副本保存在 `.sp-sync/removed/`。引用源文件不会删除；使用面板恢复关联可还原缺失的 note。

## 标签属性

```yaml
sp-tag-id: "demo-tag"
sp-tag-title: "工作"
sp-tag-color: "#287D60"
custom-context: "用户属性"
```

改名称和颜色可以写回应用；任务行使用原来的可逆别名，标签索引显示别名和真实名称。

## 每日笔记

```markdown
# 2026-10-03

## 下一步计划

用户的每日计划，插件保留。

<!-- sp-generated:calendar:start -->
## 任务索引（只读）

- 计划执行：[[Super Productivity/projects/示例--demo/tasks#^sp-64656d6f2d7461736b|编写需求]] · [[Super Productivity/projects/示例--demo/task-notes/demo|笔记]]
<!-- sp-generated:calendar:end -->
```

索引只替换这对生成标记之间的内容。历史归档、开启后的原生项目笔记也是只读导出；任务编辑始终在项目 `tasks.md` 和独立任务 notes 中进行。
