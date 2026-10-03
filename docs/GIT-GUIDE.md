# Git 与开发指南

仓库：[Talentjoe/Super-Productive-Obsidian-Converter](https://github.com/Talentjoe/Super-Productive-Obsidian-Converter)。默认分支为 `main`。

## 克隆与管理命令

安装 Git、Node.js 20.19+（推荐 24）后：

```powershell
git clone https://github.com/Talentjoe/Super-Productive-Obsidian-Converter.git
cd Super-Productive-Obsidian-Converter
npm ci
npm run git:setup
```

`git:setup` 仅配置当前仓库，不改全局 Git 设置，不覆盖已有 `origin`；未初始化的项目会建立 `main` 和本仓库远端。它配置三个快捷命令：

| 命令 | 用途 |
| --- | --- |
| `git changes` | 查看修改和未跟踪文件 |
| `git history` | 查看最近 20 条提交与分支图 |
| `git last` | 查看最近提交的文件统计 |

`.gitattributes` 统一源码为 LF，ZIP 等二进制文件保留原字节。`.gitignore` 排除依赖、构建目录、测试 vault、缓存、日志和本机环境文件；安装包在 `releases/<版本>/` 单独保存。

## 日常修改与推送

```powershell
git switch main
git pull --ff-only
git switch -c improve-sync

# 编辑源文件或文档后
npm run check
git diff
git add src docs README.md
git diff --cached
git commit -m "Improve task synchronization"
git push -u origin improve-sync
```

在 GitHub 从工作分支创建 Pull Request。合并后回到 `main` 并 `git pull --ff-only`。首次推送整个项目到空仓库时可以直接 `git push -u origin main`。

提交前检查 `git diff --cached` 和 `git status --short`。同步 vault、`.sp-sync/` 状态、个人备份、`.tmp/` 验收数据和认证信息不属于源码。不要强制推送覆盖别人的提交。

## HTTPS 与 SSH

本次使用 HTTPS 远端，Git Credential Manager 负责认证。需要登录时按 Git 的原生提示使用 GitHub 账号；不要把 token 写进远端 URL。

配置好 GitHub SSH key 后，可以切换到用户提供的 SSH 地址：

```powershell
git remote set-url origin git@github.com:Talentjoe/Super-Productive-Obsidian-Converter.git
git remote -v
ssh -T git@github.com
```

SSH 提示 `Permission denied (publickey)` 时，检查密钥是否加载且公钥已添加到对应 GitHub 账号；也可以切回 HTTPS：

```powershell
git remote set-url origin https://github.com/Talentjoe/Super-Productive-Obsidian-Converter.git
```

`git push` 出现 `non-fast-forward` 表示远端有更新，先获取和合并／变基，再正常推送；不要直接使用 `--force`。

## 验证与构建

```powershell
npm ci
npm run typecheck
npm test
npm run test:ui
npm run build
```

- `npm test`：解析、同步、真实文件桥接与后台调度回归。
- `npm run test:ui`：先构建，再用 Chrome 验证开发页面及安装包的 iframe。
- `npm run build`：生成 `dist/plugin.js`、自包含 `dist/index.html`、安装 ZIP、SHA-256 校验文件和文档。
- `npm run check`：类型检查、单元测试与构建。
- `npm run dev`：仅用于界面开发；实际文件／任务操作需要桌面宿主。

构建会把 `docs/AI-GUIDE.md` 嵌入仓库 README，并将同一份指南编入插件。修改 AI 指南后运行 `npm run docs` 或构建，然后一起提交更新后的 README。

真实宿主测试使用工作区 `.tmp/host/` 下的隔离 Super Productivity 19.1.0 实例、调试端口 9229 和 `.tmp/host/vault`，必须先启动、安装和配置插件，不能指向个人 vault。详见 [验收记录](VALIDATION.md)。相关命令为 `test:host`、`test:host:ui`、`test:host:multi`、`test:host:tags`。

## 发布安装包

版本号在 `package.json`、`package-lock.json` 的根包信息和 `manifest.json` 中保持一致。构建和验证后，把 ZIP 及校验文件保存到对应版本目录，并更新 [安装包索引](https://github.com/Talentjoe/Super-Productive-Obsidian-Converter/blob/main/releases/README.md)和 README 下载链接：

```powershell
npm run check
New-Item -ItemType Directory -Force releases/v0.1.3
Copy-Item -LiteralPath dist/sp-obsidian-sync.zip -Destination releases/v0.1.3/sp-obsidian-sync.zip
Copy-Item -LiteralPath dist/sp-obsidian-sync.zip.sha256 -Destination releases/v0.1.3/sp-obsidian-sync.zip.sha256
git add releases manifest.json package.json package-lock.json README.md docs
git diff --cached --stat
git commit -m "Package v0.1.3"
git push
```

首次交付把可直接安装的 ZIP 纳入 Git，用户无需构建即可下载。`dist/` 仍被忽略，避免把全部中间构建文件纳入版本历史。未来也可把验证后的 ZIP 上传到 GitHub Releases。
