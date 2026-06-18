# Direct Write Configuration Plan

This product is a local configuration writer, not a request proxy.

Users enter only:

- Base URL
- API Key
- Model

The app then writes the real configuration into each target tool.

## User Flow

1. Paste API info from the provider dashboard.
2. Validate the API with `/models`.
3. Select Codex, Hermes, and optionally LobsterAI.
4. Preview the exact file/database changes.
5. Back up old config, replace it with the new config, then restart the affected tools.
6. Restore the last backup if the replacement needs to be rolled back.

## Codex

Write `~/.codex/config.toml` with a custom provider:

```toml
model = "gpt-5.5"
model_provider = "agent_direct"

[model_providers.agent_direct]
name = "Direct API"
base_url = "https://api.example.com/v1"
wire_api = "responses"
requires_openai_auth = true
```

Write the real API key to `~/.codex/auth.json`:

```json
{
  "OPENAI_API_KEY": "sk-..."
}
```

## Hermes

Write `~/.hermes/config.yaml`:

```yaml
model:
  provider: custom
  default: "gpt-5.5"
  base_url: "https://api.example.com/v1"
```

Write the real API key to `~/.hermes/.env`:

```env
OPENAI_API_KEY="sk-..."
```

## LobsterAI

LobsterAI stores app configuration in Electron user data SQLite:

```text
%APPDATA%/LobsterAI/lobsterai.sqlite
```

The relevant table is `kv`, and the key is `app_config`.

Patch `providers.custom_0`:

```json
{
  "enabled": true,
  "apiKey": "sk-...",
  "baseUrl": "https://api.example.com/v1",
  "apiFormat": "openai",
  "displayName": "Direct API",
  "models": [
    {
      "id": "gpt-5.5",
      "name": "gpt-5.5",
      "supportsImage": true
    }
  ]
}
```

Also update:

```json
{
  "model": {
    "defaultModel": "gpt-5.5",
    "defaultModelProvider": "custom_0"
  }
}
```

Safety requirements:

- Detect whether LobsterAI is running.
- Ask the user to close it before writing.
- Back up `lobsterai.sqlite`, `lobsterai.sqlite-wal`, and `lobsterai.sqlite-shm`.
- Verify `kv.app_config` JSON before and after writing.
- Prompt the user to restart LobsterAI.

## Advanced Settings

Keep hidden by default:

- Codex provider id
- Provider display name
- Log masking
- Tool-specific compatibility switches

## Product Guardrails

- Do not expose API keys in preview, diagnostics, or logs.
- Always show the target path before writing.
- Always back up existing files or databases before replacing values.
- Record backup paths from the last run and offer a one-click restore.
- Report partial failures plainly and keep successful writes intact.
