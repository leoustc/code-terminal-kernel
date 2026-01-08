# Terminal Kernel

Terminal Kernel lets you create and reuse persistent terminals from VS Code.

Features:
- `codexinbox`: run Codex in a hardened Docker container with restricted filesystem access (only the current working directory and its subfolders are writable).

Usage:
- Click the Terminal Kernel icon in the Activity Bar
- Sessions are grouped by tool name; the default group is `Terminal`
- Use the `New` button on a group row to create a session for that tool
- Optionally enter a suffix (names become `<group>-<suffix>`, max 8 chars; non-alphanumeric characters are removed)
- Click a session row to connect
- Hover a session row and click the X to delete
- Use Refresh in the view header when needed

Defaults:
- If no suffix is provided, sessions are named `terminal-1`, `terminal-2`, ...
- tmux sessions enable mouse scrolling for easier scrollback.
- screen sessions set a 10,000-line scrollback buffer (use `Ctrl-a [` to scroll).
- Sessions are persistent and survive VS Code reloads until you delete them.

Troubleshooting:
- If sessions do not start, ensure the selected backend (`tmux` or `screen`) is installed and available on your PATH.
- If a tool session does not start, verify the tool path in `terminalKernel.tools` is correct and executable.

Settings:
- `terminalKernel.backend`: choose `tmux` (default) or `screen`.
- `terminalKernel.shell`: choose `bash` (default) or `sh`.
- `terminalKernel.preloadEnvFile`: path to a shell file to source when starting a new session.
- `terminalKernel.tools`: list of tool command paths (executables only, no arguments); the sidebar uses the command basename as the group name.
  - Add or remove tool entries in the VS Code Settings UI to control which groups appear in the sidebar.
  - Executables shipped in the extension's `tools/` folder are auto-included and appear before custom entries.

Built-in tools:
- `codexinbox`: launches Codex in a container with restricted filesystem access.
  - Requires Docker installed and available on your PATH.
  - Runs `docker.io/leoustc/codex:latest` with dropped capabilities and no new privileges.
  - Mounts the current working directory (and subfolders) read-write; other host paths are not mounted except optional Codex config/SSH mounts.

Tools example (`settings.json`):
```json
{
  "terminalKernel.tools": [
    "/usr/local/bin/codex",
    "/usr/bin/python3",
    "/opt/homebrew/bin/node"
  ]
}
```

Requires `tmux` or `screen` installed on the system (based on the backend setting). `codexinbox` also requires Docker.

License: GPL v2
