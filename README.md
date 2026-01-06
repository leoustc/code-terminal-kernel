# Terminal Kernel

Terminal Kernel lets you create and reuse persistent terminals from VS Code.

Usage:
- Click the Terminal Kernel icon in the Activity Bar
- Press New to create a session
- Optionally enter a suffix (names become `terminal-<suffix>`, max 8 chars)
- Click a row to connect
- Hover a row and click the X to delete

Defaults:
- If no suffix is provided, sessions are named `terminal-1`, `terminal-2`, ...
- tmux sessions enable mouse scrolling for easier scrollback.
- screen sessions set a 10,000-line scrollback buffer (use `Ctrl-a [` to scroll).

Settings:
- `terminalKernel.backend`: choose `tmux` (default) or `screen`.
- `terminalKernel.shell`: choose `bash` (default) or `sh`.
- `terminalKernel.preloadEnvFile`: path to a shell file to source when starting a new session.
- `terminalKernel.tools`: list of tool commands shown in the Tools view.

Tools example (`settings.json`):
```json
{
  "terminalKernel.tools": [
    "codex",
    "python",
    "npm run lint"
  ]
}
```

Requires `tmux` or `screen` installed on the system (based on the backend setting).
