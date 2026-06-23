# SimpleLogin MCP

Self-hostable MCP server for SimpleLogin email-alias workflows.

Configuration requires a SimpleLogin API key from Settings -> API Keys. The Docker MCP Registry
entry runs the container in stdio mode with `TRANSPORT=stdio` and passes the key through
`SL_API_KEY`.

Full documentation: https://github.com/enthouan/simplelogin-mcp#readme
