export type ClientKey = 'codex' | 'claude-code' | 'claude-desktop' | 'vs-code' | 'opencode';

export type ClientIcon = 'openai' | 'claude' | 'vscode' | 'opencode';

export interface ClientHttpSetup {
  configTitle: string;
  language: string;
  code: string;
  note: string;
}

export interface ClientSetup {
  key: ClientKey;
  icon: ClientIcon;
  label: string;
  description: string;
  configLocation: string;
  configTitle: string;
  language: string;
  code: string;
  http?: ClientHttpSetup;
  httpUnavailableNote?: string;
  reload: string;
  secretNote: string;
  docsLabel: string;
  docsUrl: string;
}

export const VERIFY_PROMPT = 'Can you show me my SimpleLogin account usage?';

export const VERIFY_EXPECTED =
  'Review the proposed call and approve only account_get_stats. It takes no arguments, is marked read-only, and returns aggregate account counts without changing SimpleLogin. Those counts still pass through the client and its configured model.';

export const CLIENT_SETUPS = [
  {
    key: 'codex',
    icon: 'openai',
    label: 'Codex',
    description:
      'Codex reads MCP servers from its TOML configuration and shares that configuration across the desktop app, CLI, and IDE extension on the same host.',
    configLocation: 'Add this table to ~/.codex/config.toml.',
    configTitle: '~/.codex/config.toml',
    language: 'toml',
    code: `[mcp_servers.simplelogin]
command = "node"
args = ["/absolute/path/to/simplelogin-mcp/dist/index.js"]
default_tools_approval_mode = "writes"

[mcp_servers.simplelogin.env]
TRANSPORT = "stdio"
SL_API_KEY = "sl-your-key-here"`,
    http: {
      configTitle: '~/.codex/config.toml',
      language: 'toml',
      code: `[mcp_servers.simplelogin]
url = "http://127.0.0.1:3000/mcp"
bearer_token_env_var = "SIMPLELOGIN_MCP_BEARER_TOKEN"`,
      note: 'Export SIMPLELOGIN_MCP_BEARER_TOKEN with the same value as the server’s MCP_AUTH_TOKEN. Omit bearer_token_env_var when the HTTP server does not require bearer authentication.',
    },
    reload:
      'Restart the Codex client, then open the MCP server list or use /mcp to confirm that simplelogin is connected.',
    secretNote:
      'This configuration contains the SimpleLogin API key. Keep it private. The writes approval mode asks before tools that are not marked read-only.',
    docsLabel: 'Codex MCP documentation',
    docsUrl: 'https://learn.chatgpt.com/docs/extend/mcp',
  },
  {
    key: 'claude-code',
    icon: 'claude',
    label: 'Claude Code',
    description:
      'Claude Code expands environment variables in project-scoped .mcp.json files, so the shared file can reference a machine-specific checkout and secret without containing either value.',
    configLocation:
      'Set SIMPLELOGIN_MCP_ROOT and SL_API_KEY in the environment that starts Claude Code, then create .mcp.json at the project root.',
    configTitle: '.mcp.json',
    language: 'json',
    code: `{
  "mcpServers": {
    "simplelogin": {
      "type": "stdio",
      "command": "node",
      "args": ["\${SIMPLELOGIN_MCP_ROOT}/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "SL_API_KEY": "\${SL_API_KEY}"
      }
    }
  }
}`,
    http: {
      configTitle: '.mcp.json',
      language: 'json',
      code: `{
  "mcpServers": {
    "simplelogin": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer \${SIMPLELOGIN_MCP_BEARER_TOKEN}"
      }
    }
  }
}`,
      note: 'Export SIMPLELOGIN_MCP_BEARER_TOKEN with the same value as the server’s MCP_AUTH_TOKEN. Remove headers when the HTTP server does not require bearer authentication.',
    },
    reload:
      'Start a new Claude Code session, run /mcp, and confirm that simplelogin is connected. claude mcp list also reports missing environment variables.',
    secretNote:
      'The file contains only environment-variable references and can be shared. Keep the environment source for SL_API_KEY private and out of version control.',
    docsLabel: 'Claude Code MCP documentation',
    docsUrl: 'https://code.claude.com/docs/en/mcp',
  },
  {
    key: 'claude-desktop',
    icon: 'claude',
    label: 'Claude Desktop',
    description:
      'Until simplelogin-mcp is distributed as a desktop extension package, Claude Desktop can launch the locally built server as a developer-defined stdio process.',
    configLocation:
      'Open Settings → Developer → Edit Config and add this entry to claude_desktop_config.json.',
    configTitle: 'claude_desktop_config.json',
    language: 'json',
    code: `{
  "mcpServers": {
    "simplelogin": {
      "command": "node",
      "args": ["/absolute/path/to/simplelogin-mcp/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "SL_API_KEY": "sl-your-key-here"
      }
    }
  }
}`,
    httpUnavailableNote:
      'Claude Desktop’s manual local-server configuration does not expose a documented custom bearer-header field, so this guide does not claim a protected Streamable HTTP setup for it.',
    reload:
      'Quit and reopen Claude Desktop. Open Connectors from the chat composer or Developer settings to check the server status and tools.',
    secretNote:
      'This developer configuration contains the SimpleLogin API key. Keep the file private; do not paste it into an issue or support request.',
    docsLabel: 'MCP local server guide',
    docsUrl: 'https://modelcontextprotocol.io/docs/develop/connect-local-servers',
  },
  {
    key: 'vs-code',
    icon: 'vscode',
    label: 'VS Code',
    description:
      'VS Code input variables can request the API key when the server first starts and store it without placing the value directly in mcp.json.',
    configLocation:
      'Run MCP: Open User Configuration from the Command Palette and replace its contents or merge these inputs and server entries.',
    configTitle: 'User profile mcp.json',
    language: 'json',
    code: `{
  "inputs": [
    {
      "type": "promptString",
      "id": "simplelogin-api-key",
      "description": "SimpleLogin API key",
      "password": true
    }
  ],
  "servers": {
    "simplelogin": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/simplelogin-mcp/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio",
        "SL_API_KEY": "\${input:simplelogin-api-key}"
      }
    }
  }
}`,
    http: {
      configTitle: 'User profile mcp.json',
      language: 'json',
      code: `{
  "inputs": [
    {
      "type": "promptString",
      "id": "simplelogin-mcp-bearer-token",
      "description": "simplelogin-mcp bearer token",
      "password": true
    }
  ],
  "servers": {
    "simplelogin": {
      "type": "http",
      "url": "http://127.0.0.1:3000/mcp",
      "headers": {
        "Authorization": "Bearer \${input:simplelogin-mcp-bearer-token}"
      }
    }
  }
}`,
      note: 'Remove both headers and the unused password input when the HTTP server does not require bearer authentication. These password-input examples target desktop VS Code.',
    },
    reload:
      'Run MCP: List Servers, select simplelogin, and start or restart it. Review the server configuration before accepting VS Code’s trust prompt.',
    secretNote:
      'The password input keeps the actual API key out of mcp.json. Use the user configuration unless you intentionally want to share a credential-free workspace definition.',
    docsLabel: 'VS Code MCP configuration reference',
    docsUrl: 'https://code.visualstudio.com/docs/agents/reference/mcp-configuration',
  },
  {
    key: 'opencode',
    icon: 'opencode',
    label: 'OpenCode',
    description:
      'OpenCode defines local servers under mcp.servers and can read the SimpleLogin API key from the environment instead of a tracked project file.',
    configLocation:
      'Save this as opencode.json in the project or ~/.config/opencode/opencode.json for global use.',
    configTitle: 'opencode.json',
    language: 'json',
    code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "simplelogin": {
        "type": "local",
        "command": [
          "node",
          "/absolute/path/to/simplelogin-mcp/dist/index.js"
        ],
        "environment": {
          "TRANSPORT": "stdio",
          "SL_API_KEY": "{env:SL_API_KEY}"
        }
      }
    }
  }
}`,
    http: {
      configTitle: 'opencode.json',
      language: 'json',
      code: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "simplelogin": {
        "type": "remote",
        "url": "http://127.0.0.1:3000/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:SIMPLELOGIN_MCP_BEARER_TOKEN}"
        }
      }
    }
  }
}`,
      note: 'Export SIMPLELOGIN_MCP_BEARER_TOKEN with the same value as the server’s MCP_AUTH_TOKEN. Remove headers when the HTTP server does not require bearer authentication.',
    },
    reload:
      'Relaunch OpenCode and run opencode2 mcp list. OpenCode does not currently promise hot reload after direct configuration edits.',
    secretNote:
      'Keep the environment that supplies SL_API_KEY private. The local stdio recipe has been maintainer-tested; the HTTP example remains documentation-reviewed.',
    docsLabel: 'OpenCode MCP documentation',
    docsUrl: 'https://opencode.ai/v2/docs/mcp-servers',
  },
] as const satisfies readonly ClientSetup[];
