# Super Productivity ↔ Obsidian Converter

Windows 桌面插件，最低支持 **Super Productivity 19.1.0**。按选择的项目双向同步 Markdown 任务、长 notes、引用笔记正文、标签、计划日期、截止时间和预计耗时；补充保存预计完成时刻。无需安装 Obsidian 插件。

当前版本：**0.1.3** · MIT 许可证 · [GitHub 仓库](https://github.com/Talentjoe/Super-Productive-Obsidian-Converter)

[下载安装 ZIP](https://github.com/Talentjoe/Super-Productive-Obsidian-Converter/raw/refs/heads/main/releases/v0.1.3/sp-obsidian-sync.zip) · [完整使用指南](docs/USER-GUIDE.md) · [AI 编辑指南](docs/AI-GUIDE.md) · [Git 与开发指南](docs/GIT-GUIDE.md) · [验收记录](docs/VALIDATION.md)

## 功能与同步范围

| 内容 | 支持方式 |
| --- | --- |
| 任务与项目 | 多项目勾选；新增、标题、完成状态、排序、项目迁移、父任务和一层子任务 |
| 标签 | 独立任务标签双向编辑；原生子任务标签保留并只读导出；名称／颜色可通过标签索引 YAML 编辑 |
| 任务 notes | 独立 Markdown 文件双向编辑；空 Inbox 任务也生成 note；链接只显示“笔记” |
| 引用笔记 | 整篇 vault Markdown 正文双向同步；源文件 YAML 保留；标题／block 只读摘录 |
| 时间 | 预计耗时、计划日期／时间、截止日期／时间；补充持久化预计完成时刻 |
| 项目／标签／日历索引 | 自动生成，保留生成区块之外的用户正文；每日笔记可写自由计划 |
| 原生项目笔记 | 可选只读导出，默认关闭；不是任务 notes |
| 历史归档 | 可选只读导出，按项目和月份保存，默认关闭 |
| 移除与冲突 | 删行保留应用任务并暂停关联；托管 note 保存恢复副本后清理；同字段冲突应用优先，旧文件备份 |

## 同步后的文件

```text
Super Productivity/
├── README.md                         # AI 编辑指南
├── index.md                          # 根索引
├── projects/<项目名>--<稳定ID>/
│   ├── index.md
│   ├── tasks.md                      # 任务编辑入口
│   ├── task-notes/<任务ID>.md
│   ├── project-notes/                # 可选，只读
│   └── archive/YYYY-MM.md            # 可选，只读
├── tags/
├── calendar/
└── .sp-sync/                         # 状态、备份与移除副本
```

只在选中项目的 `tasks.md` 编辑任务；notes 点击“笔记”进入对应文件。任务身份由隐藏 ID 决定，不根据名称判断。

## 安装与使用

1. 下载上方安装 ZIP：Super Productivity → 设置 → 插件 → 选择／上传 ZIP，启用 **Obsidian Vault Sync**。
2. 启用插件，允许主程序显示的 Node 文件访问权限。仅桌面版可用。
3. 打开“Obsidian 同步”，选择 vault 根目录、勾选项目（可多选，包括 Inbox）、检查时区，点击“保存设置”。
4. 如已暂停，先“恢复同步”，再点击“立即同步”。内容写入 vault 的 `Super Productivity/`。
5. 在 Obsidian 打开 `Super Productivity/index.md`，检查项目任务、notes 和“待处理问题”。应用运行时继续自动同步。

详细步骤、设置说明、删除恢复和常见问题见 [使用指南](docs/USER-GUIDE.md)。安装包与 SHA-256 校验文件见 [安装包索引](https://github.com/Talentjoe/Super-Productive-Obsidian-Converter/blob/main/releases/README.md)。

新增任务示例（保存到某个已选项目的 `tasks.md`，不要手写 ID）：

```markdown
- [ ] 编写需求 #工作 ⏳ 2026-10-03 📅 2026-10-05 estimate [60min](<sp-estimate-minutes:: 60>)
- [ ] 准备演示
  - [ ] 整理资料 estimate [30min](<sp-estimate-minutes:: 30>)
```

成功同步后会回填稳定 ID 和 `[[完整路径|笔记]]` 链接。已有任务修改时保留 ID、block ID 和 notes 链接。

**0.1.3 更新：** 修复已有子任务保留原生标签时出现的 `tags` 读回错误；保留子任务独立标签及提升／关联时的原生规则，独立任务标签仍严格验证。任务、项目和日历中的 notes 链接统一显示“笔记”；旧 `sp-notes` 格式自动迁移，ID、路径及正文保持不变。

0.1.2 的多项目耗时汇总修复、删除 note 恢复副本、Inbox 空 notes 文件、同步延迟和批量读写继续保留。预计耗时使用 `estimate [60min](<sp-estimate-minutes:: 60>)`，旧格式仍兼容。

在插件设置重新上传新的 ZIP，关闭原面板后再打开“Obsidian 同步”。现有配置和 vault 可继续使用；如果主程序再次询问 Node 权限，请选择允许。

文件夹读取期间，面板显示进度，“使用此文件夹”会等待读取完成再启用。取消后迟到的结果不会重开弹窗。后台尚未连接时会显示原因，并提供“重新连接”；首次状态请求超过 5 秒即提示重试。直接在浏览器打开 `index.html` 不具备宿主接口，需要安装 ZIP。

任务 notes 和完整引用正文双向同步。原生项目笔记、历史归档均为可选只读导出，**默认关闭**。日历／标签／项目索引是生成视图；下一步计划写在生成区块外。

删除任务行会保留应用原任务和原生 notes，加 `sync-removed` 标记，暂停该任务导出。项目中的托管 note 先保存完整恢复副本再清理；在应用删除／归档任务时也会清理 note。引用源笔记保留。文件缺失会暂停绑定。同字段冲突应用优先，原文件先备份。引用正文多个版本冲突可在面板选择。

备份查看／恢复、移除关联恢复和缺失任务文件重建均在插件面板操作。恢复备份会自动暂停同步；检查内容后再恢复同步。

[格式示例](docs/FORMAT-EXAMPLES.md)展示完整任务行、notes、标签属性和日历区块；[验收记录](docs/VALIDATION.md)说明测试环境与覆盖范围。

## 开发

Node.js 20.19+（推荐 22 或 24），npm。锁文件固定已验证依赖。

```powershell
git clone https://github.com/Talentjoe/Super-Productive-Obsidian-Converter.git
cd Super-Productive-Obsidian-Converter
npm ci
npm run git:setup
npm run typecheck
npm test
npm run test:ui
npm run build
```

`git:setup` 配置当前仓库的 `git changes`、`git history`、`git last` 管理命令。日常分支、提交、HTTPS／SSH 认证及安装包更新见 [Git 与开发指南](docs/GIT-GUIDE.md)。依赖、临时 vault 和 `dist/` 不入 Git；可下载的安装 ZIP 单独保存在 `releases/v0.1.3/`。

构建生成独立 `plugin.js` 和自包含 `index.html`，打包 ZIP 不包含 vault、测试数据、源码或个人备份。构建自动更新 README 中的 AI 指南。`npm run dev` 仅供 UI 开发；脱离主程序时会显示安装提示。界面测试默认使用已安装的 Chrome。

`npm run test:ui` 会先构建，再验证开发界面和 ZIP 的真实 `srcdoc` iframe、父窗口消息通信、鼠标／输入操作、目录读取延迟与取消、首次消息丢失和权限拒绝恢复。`npm run test:host:ui` 对已安装插件的隔离 19.1.0 实例执行真实控件和文件操作；`npm run test:host:multi` 验证多项目、原生 Inbox 新任务、父子耗时读回和原生删除后的 note 清理；`npm run test:host:tags` 验证带标签子任务、notes 迁移和提升／关联；`npm run test:host` 验证完整同步流程。实例设置见验收记录。

架构：`src/core` 为解析、三方合并、引用、索引和同步引擎；`src/adapters` 为文件桥接；`src/node/io.cjs` 为静态 Node 脚本；`src/background.ts` 为后台生命周期和消息协议；`src/ui` 为 SolidJS 中文配置面板。

默认同步延迟 10 秒、文件检查间隔 30 秒，均可在面板调整；连续编辑会合并为一次同步，手动“立即同步”跳过等待。完整补查间隔 120 秒，面板可见时每 10 秒刷新状态。文件读写按批次调用 Node 桥接，内容不变时跳过写入，减少后台进程启动；禁用控件使用普通鼠标指针。

路径和配置仅保存在本机，补充任务字段通过插件持久化保存；索引更新只替换生成区块。只允许所选 vault 内真实路径，包括符号链接检查。较大文件通过分块传输、完整 SHA-256 校验及原子替换保存，避开 Windows 命令行长度限制。格式错误或任务字段读回失败暂停相关项目文件；其他无依赖的选中项目仍可同步。父任务预计耗时使用应用汇总值，只验证独立可编辑字段。

同一 vault 使用单台设备写入。网页／手机、关闭应用时后台同步、外部日历、附件复制、原生项目 notes 写回和重复规则编辑不在第一版范围。项目目录绑定后请勿手动重命名；在应用或 YAML 中改项目名称。单个笔记最大 4 MB。

0.1.3 已通过 TypeScript 检查、62 项 Vitest、12 项 Playwright，以及隔离 Windows 19.1.0 宿主验证；Obsidian 本体阅读模式尚未单独验收。详细环境与限制见 [验收记录](docs/VALIDATION.md)。

## 参考与许可证

项目遵循 [MIT 许可证](LICENSE)。参考了 Super Productivity 插件接口以及 [Archived-Tasks-Viewer](https://github.com/baiyina/Archived-Tasks-Viewer)、[ai-assistant-plugin](https://github.com/ai-eifying/ai-assistant-plugin)、[sync-md-multi](https://codeberg.org/fpindado/sync-md-multi) 的思路；本仓库是独立实现。依赖和第三方说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## AI 编辑指南

完整指南以 [docs/AI-GUIDE.md](docs/AI-GUIDE.md) 为唯一维护来源；构建时将其内容嵌入本文，运行时同一内容写入 vault 的 `Super Productivity/README.md`。

<!-- ai-guide:start -->
# AI 编辑指南 · 格式版本 1

此目录将 Obsidian Markdown 与 Super Productivity 任务双向同步。修改前先阅读本指南。应用必须正在运行、插件已启用且未暂停。默认应用变更延迟 10 秒同步，文件每 30 秒检查，文件修改通常在约 40 秒内开始同步；面板可以调整这两个间隔，也可以点击“立即同步”。

## 修改入口

| 要修改的内容 | 修改位置 |
| --- | --- |
| 标题、完成、标签、预计耗时、日期、顺序、子任务 | 对应项目的 `tasks.md` |
| 某个任务自己的 notes | 任务行“笔记”链接指向的 `task-notes/*.md` |
| 引用笔记的正文 | 原始 Obsidian 笔记；也可以在应用任务 notes 的 `sp-ref` 区块内编辑 |
| 预计完成时刻 | `sp-expected-finish` 字段，或插件面板 |
| 下一步计划、随手记 | 每日笔记中生成区块之外的正文 |
| 项目名称 | 项目 `tasks.md` 的 YAML `sp-project-title`，或在应用中修改 |
| 标签名称、颜色 | 标签索引的 YAML `sp-tag-title`、`sp-tag-color`，或在应用中修改 |

根／项目／标签／日历索引的 `sp-generated` 区块是只读生成内容。历史归档及可选的 `project-notes/` 是只读导出。`.sp-sync/` 是内部状态、恢复记录和备份，不直接编辑。用户正文写在生成区块之外，插件会保留。

## 新增任务与子任务

只在已选择项目的 `tasks.md` 新增任务。不要把引用笔记里的复选框当作要导入的任务。

```markdown
- [ ] 编写需求说明 #工作 ⏳ 2026-10-03 📅 2026-10-05
  - [ ] 整理现有资料 estimate [30min](<sp-estimate-minutes:: 30>)
- [ ] 独立任务 estimate [60min](<sp-estimate-minutes:: 60>)
```

父任务不缩进，子任务缩进两个空格。最多两层；子任务继承父任务的项目，标签遵循应用原生规则。已有子任务可以保留独立标签，文件中的子任务标签是只读导出；如需修改，在应用中操作。新增子任务不要单独设置标签。第三层不会降级成 notes：文件会暂停并显示格式问题。

有子任务的父任务耗时由应用汇总为未完成子任务的剩余耗时，属于只读导出。调整子任务的耗时即可改变汇总值；独立任务和子任务的耗时可以编辑。不要用父任务耗时表达另一份独立预算。

新任务不要自行编造 ID。插件会分配并回填 `<!-- sp:task:... -->`、`^sp-...`、`[[路径|笔记]]` 链接。保留这些标记和链接；名称相同的任务仍是不同任务。

## 修改字段与勾选状态

保留现有身份和 notes 链接，只修改相应文字／字段。

```markdown
- [ ] 独立任务 #工作 ⏳ 2026-10-03 📅 2026-10-05 [sp-planned-time:: 14:00] [sp-deadline-time:: 18:00] estimate [90min](<sp-estimate-minutes:: 90>) [sp-expected-finish:: 2026-10-03T16:00:00-07:00]
```

- `[ ]` 是未完成，`[x]` 是完成。取消勾选会重新打开任务。
- `⏳` 是计划执行日期，`📅` 是截止日期，不混用。日期必须是有效 `YYYY-MM-DD`。
- 时间必须为 `HH:mm`，同时保留对应日期，按插件配置的 IANA 时区解释。夏令时跳过的时刻会报错；重复时刻选择较早一次。
- `sp-estimate-minutes` 是非负分钟数；修改链接内数值，并保持显示的分钟数一致。旧的 `[sp-estimate-minutes:: 90]` 仍能导入，下一次导出会统一格式。`sp-expected-finish` 必须带 `Z` 或时区偏移，不会自动由耗时推算。
- 耗时链接的目标含空格，导出时使用尖括号包裹，以便阅读模式只显示 `60min`。你也可以输入 `estimate [60min](sp-estimate-minutes:: 60)`，同步后会规范为带尖括号的形式。
- 清除字段时删除整个字段／日期标记，不使用“未知”“明天”等文本。
- `sp-spent-minutes`、`sp-completed-at` 为只读导出，不用于修改计时历史。
- 标签写作 `#标签`。含空格等不适合 hashtag 的名称使用插件生成的别名；别名和原名称在标签索引显示。`TODAY` 由计划日期管理，不作为普通标签新增。

## 重排、改变父子关系和跨项目移动

在同一 `tasks.md` 中移动整条任务行可以重排。增减缩进可以改变父子关系，但只允许两层。父任务及其子任务必须保持在一起。

跨项目移动：将父任务及全部子任务行剪切到另一个已选择项目的 `tasks.md`，保留 ID、block ID 和原“笔记”链接，两个文件都保存后同步。同步前可暂停插件，保存双方后点击“立即同步”。不要复制出两个相同 ID 的任务。子任务先提升为父任务才能单独跨项目移动；提升时保留自己的原生标签，没有标签时按原生规则继承父任务标签。

## 任务 notes 与引用笔记

每个任务都生成独立 notes，包括 Inbox 中正文为空的新任务。空 notes 文件包含任务／项目身份 YAML；添加正文即可写回应用。任务 notes 文件正文可以包含多段 Markdown、代码块和普通复选框。YAML 属性留在文件，不写入应用 notes。

任务行使用 `[[Super Productivity/projects/项目--ID/task-notes/任务ID|笔记]]`，阅读时只显示“笔记”，点击仍打开原文件。`|笔记` 是插件识别 notes 的标记，保留显示文字和路径；其他参考链接放在 notes 正文。旧 `[sp-notes:: [[路径]]]` 仍可导入，下次成功导出会自动替换成新链接，任务 ID、note 路径及正文保持不变。

```markdown
按 [[资料/需求说明]] 执行。
参考 ![[资料/会议记录]]。
参阅 [完整方案](资料/完整方案.md)。
标题定位：[[资料/需求说明#验收标准]]。
```

完整笔记引用正文会嵌入应用任务 notes 并可写回源文件。标题／block 引用仅提供只读摘录。不递归展开引用链，不同步附件文件。

可写引用指向 vault 中插件同步目录之外的 Markdown 笔记。其他任务 notes 请直接编辑其文件；插件目录内的文件仅允许标题／block 只读引用，避免相互嵌入同步区块。

保留 `sp-references` 和 `sp-ref` 起止标记，只改引用区块内部正文。源笔记 YAML 不包含在嵌入区块中，也不会被区块编辑覆盖。移除链接／引用区块只解除引用，不删除原始文件。

引用重名时改为 vault 内完整路径。引用文件缺失、区块边界损坏或多个任务同时给出不同正文时，先在插件的问题列表处理，不猜测目标／覆盖版本。

## 删除、冲突和恢复

删除已关联任务行会保存快照、保留应用原任务和原生 notes、添加 `sync-removed` 标记并暂停该任务同步，不硬删除应用任务。删除父任务行时保留整组；仅删除子任务会记录子任务移除并标记父任务。需要恢复时使用插件“恢复关联”，不要创建同标题任务代替。

对应的托管 `task-notes/*.md` 会先完整保存到 `.sp-sync/removed/`，持久化恢复路径后再从项目目录清理。文件中的 YAML 和未同步正文一并保留；清理期间文件变化会保留原文件并报告问题，下次重试。恢复关联会还原缺失的 note；若应用 notes 在移除后已有修改，以应用正文为准，移除副本仍保留。

在应用中删除／归档任务也会清理对应的托管 note，并保留恢复副本，不从旧 Markdown 自动重建该任务。需要恢复关联时先在应用恢复任务。引用的源笔记始终保留。

删除整个文件、文件夹或应用项目会暂停对应绑定。取消勾选项目只停止同步，不删除任何内容。

两边同字段同时修改时应用优先，文件旧版本保存为备份。不同字段的修改可以合并。首次绑定合并双方内容，不按标题匹配，也不因文件缺少任务删除应用内容。

某个项目未通过应用读回验证时，问题列表会显示任务和差异字段，该项目文件与共同版本暂停推进；其他无依赖的已选项目继续导出。

## 修改后的检查

保存全部修改文件，点击“立即同步”，检查问题列表、任务数量、ID、父子关系、日期和 notes。若出现格式问题，修正后再同步；插件保留原文。不要直接编辑备份或内部状态来消除问题。

第一版只支持单台设备写入同一 vault。应用关闭时不会运行同步。
<!-- ai-guide:end -->
