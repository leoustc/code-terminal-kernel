# Terminal Kernel

Terminal Kernel lets you create and reuse persistent terminals from VS Code.

Usage:
- Click the Terminal Kernel icon in the Activity Bar
- Press New to create a session
- Optionally enter a suffix (names become `terminal-<suffix>`, max 8 chars)
- Click a row to connect
- Right-click a row to delete

Defaults:
- If no suffix is provided, sessions are named `terminal-1`, `terminal-2`, ...

Settings:
- `terminalKernel.backend`: choose `tmux` (default) or `screen`.
- `terminalKernel.shell`: choose `bash` (default) or `sh`.
- `terminalKernel.preloadEnvFile`: path to a shell file to source when starting a new session.

Requires a compatible terminal multiplexer installed on the system.
