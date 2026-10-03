# Install packages / 安装包

0.1.4 adds English/Chinese settings, generated labels and editing guides. [English user guide](../docs/USER-GUIDE.en.md).

| 版本 | 下载 | 校验 | 最低主程序 |
| --- | --- | --- | --- |
| 0.1.4 | [sp-obsidian-sync.zip](https://github.com/Talentjoe/Super-Productive-Obsidian-Converter/raw/refs/heads/main/releases/v0.1.4/sp-obsidian-sync.zip) | [SHA-256](v0.1.4/sp-obsidian-sync.zip.sha256) | Super Productivity 19.1.0 Windows 桌面版 |
| 0.1.3 | [sp-obsidian-sync.zip](https://github.com/Talentjoe/Super-Productive-Obsidian-Converter/raw/refs/heads/main/releases/v0.1.3/sp-obsidian-sync.zip) | [SHA-256](v0.1.3/sp-obsidian-sync.zip.sha256) | Super Productivity 19.1.0 Windows 桌面版 |

下载 ZIP 后，在 Super Productivity 的“设置 → 插件”上传并启用。完整步骤见 [使用指南](../docs/USER-GUIDE.md)。

Windows 校验下载文件：

```powershell
Get-FileHash -LiteralPath .\sp-obsidian-sync.zip -Algorithm SHA256
```

将输出与相同版本的 `.sha256` 文件比较。ZIP 包含插件、中文界面、说明文档和许可证，不包含 vault、测试数据或本机配置。
