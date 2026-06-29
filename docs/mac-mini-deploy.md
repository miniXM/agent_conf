# Mac mini 部署版

这版面向 Apple Silicon Mac mini 本机部署。推荐直接在 Mac mini 上构建 macOS 产物，Windows 机器继续只负责 Windows 安装包。

## 目标产物

- 未签名本机部署包：`npm run dist:mac`
- 未签名目录版：`npm run pack:mac`
- 需要 Apple Developer ID 签名时：`npm run dist:mac:signed`

默认生成 arm64 产物，适合 M 系列 Mac mini。

## Mac mini 环境

```bash
xcode-select --install
node -v
npm -v
```

Node.js 需要 20 或更高版本。第一次部署建议从干净依赖开始：

```bash
npm ci
npm run check
npm run dist:mac
```

产物会生成在 `dist/` 目录，常见文件名类似：

```text
agent_conf-0.1.0-mac-arm64.dmg
agent_conf-0.1.0-mac-arm64.zip
mac-arm64/agent_conf.app
```

## 安装到 Mac mini

1. 打开 `dist/agent_conf-0.1.0-mac-arm64.dmg`。
2. 把 `agent_conf.app` 拖到 `/Applications`。
3. 第一次启动如果被 Gatekeeper 拦截，在 Finder 中右键应用，选择“打开”，再确认打开。

未签名包只建议内部分发或本机部署。如果要给外部用户稳定分发，使用 `dist:mac:signed`，并配置 Apple Developer ID 证书与公证环境变量。

## 运行数据

Electron 桌面版数据目录：

```text
~/Library/Application Support/agent_conf/data
```

Node 服务开发模式默认数据目录仍是项目内：

```text
.agent-conf/
```

如果要在服务模式中使用 macOS 风格的数据目录，可以显式指定：

```bash
export AGENT_CONF_DATA_DIR="$HOME/Library/Application Support/agent_conf/data"
npm start
```

## 工具写入路径

Mac mini 默认写入：

```text
Codex:  ~/.codex/config.toml
Codex:  ~/.codex/auth.json
Hermes: ~/.hermes/config.yaml
Hermes: ~/.hermes/.env
```

LobsterAI 当前仍按 SQLite 写入适配，macOS 默认尝试：

```text
~/Library/Application Support/LobsterAI/lobsterai.sqlite
```

如果实际数据库路径不同，在界面里打开 LobsterAI 工具设置并改写入路径；也可以启动前设置：

```bash
export LOBSTER_DB_PATH="/absolute/path/to/lobsterai.sqlite"
```

## 常用排错

如果端口 `4788` 被占用，应用会自动尝试后续端口，并把实际地址写到：

```text
~/Library/Application Support/agent_conf/data/server.json
```

如果配置写入失败，先确认目标工具没有正在运行，并检查文件权限：

```bash
ls -la ~/.codex ~/.hermes
```

如果需要清理本机部署数据：

```bash
rm -rf "$HOME/Library/Application Support/agent_conf"
```
