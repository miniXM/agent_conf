# agent_conf

本地一键配置写入器。用户只填一次 `Base URL / API Key / Model`，软件分别把真实配置写进 Codex、Hermes、LobsterAI。

```text
真实 API 信息 -> agent_conf -> Codex / Hermes / LobsterAI 配置文件
```

## 运行

```powershell
npm start
```

然后打开：

```text
http://127.0.0.1:4788
```

## Electron 桌面版

开发模式启动桌面版:

```powershell
npm run desktop
```

生成 Windows 安装包:

```powershell
npm run dist
```

生成 Mac mini / macOS Apple Silicon 部署包:

```bash
npm run dist:mac
```

以上 macOS 打包命令建议直接在目标 Mac mini 或其他 macOS 机器上执行。

仅打包未签名目录版:

```bash
npm run pack:mac
```

常见产物位置:

- 安装包: `dist/agent_conf-Setup-0.1.0.exe`
- 解包版: `dist/win-unpacked/agent_conf.exe`
- macOS 产物: `dist/` 下的 `.dmg`、`.zip` 和 `.app`

桌面版启用了单实例锁；重复打开时会只唤醒已有窗口，不会再启动第二个应用实例。

桌面版运行数据默认写到:

```text
%APPDATA%/agent_conf/data
```

macOS 桌面版运行数据默认写到:

```text
~/Library/Application Support/agent_conf/data
```

Mac mini 部署步骤见 [docs/mac-mini-deploy.md](docs/mac-mini-deploy.md)。

## 当前模式

- 直写模式，不做本地中转
- 主界面只保留三项：`Base URL`、`API Key`、`Model`
- Codex：写 `~/.codex/config.toml` 和 `~/.codex/auth.json`
- Hermes：写 `~/.hermes/config.yaml`，API Key 写 `~/.hermes/.env`
- LobsterAI：写 `%APPDATA%/LobsterAI/lobsterai.sqlite` 的 `kv.app_config`
- macOS 下 LobsterAI 默认尝试 `~/Library/Application Support/LobsterAI/lobsterai.sqlite`；如果实际路径不同，可在工具设置里改写入路径，或设置 `LOBSTER_DB_PATH`
- 写入前展示预览，执行时先备份旧配置，再替换为新配置
- 支持把上次写入前的备份恢复回原配置
- 预览、诊断、日志都不显示 API Key 明文

## 学习模块

- 学习页支持读取远程 `cards.json` 卡片列表
- 每张卡片包含标题、简介、封面图地址、单个 HTML 文章地址
- 点击文章时会把 HTML 缓存到本地，之后可离线打开
- 未配置远程地址时，默认读取 Gitee raw 列表：https://gitee.com/miniXM/agent_conf/raw/master/public/learn-sample/catalog.json

示例 `cards.json`:

```json
{
  "version": "2026-06-18-001",
  "cards": [
    {
      "id": "article-001",
      "title": "第一篇文章",
      "desc": "一句简介",
      "cover": "https://gitee.com/your-name/repo/raw/master/covers/article-001.jpg",
      "html": "https://gitee.com/your-name/repo/raw/master/articles/article-001.html",
      "htmlVersion": "1",
      "updatedAt": "2026-06-18"
    }
  ]
}
```

建议文章做成单文件 HTML，把正文样式写在 `<style>` 里。这样应用缓存一份 HTML 后，离线阅读最稳。

## 设计记录

见 [docs/direct-write-plan.md](docs/direct-write-plan.md)。
