# Terminal Kernel

Terminal Kernel lets you create, reuse, and manage persistent terminal sessions from VS Code.

## Features

- Persistent sessions backed by `tmux` or `screen`.
- Fast access from a dedicated Activity Bar view.
- Favorites, filtering, refresh, and session cleanup controls.
- Automatic discovery of sessions created outside the extension.
- Direct backend attachment using the user's configured default shell.
- SSH connections from aliases in the local `~/.ssh/config` file.

## Session groups

- **Favorites** contains favorited sessions.
- **Terminal** contains sessions named `terminal-*`, including sessions created by the extension.
- **Remote** contains concrete host aliases from the local SSH configuration.
- **Other** contains every other session discovered from the selected backend and remains at the bottom of the sidebar.

A favorite also remains visible in its Terminal or Other group.

## Usage

1. Click the Terminal Kernel icon in the Activity Bar.
2. Use the add icon on the Terminal group to create a session.
3. Optionally enter a suffix. Without one, sessions are named `terminal-1`, `terminal-2`, and so on.
4. Click a session to connect.
5. Use the inline actions to favorite, clear the attached VS Code terminal, or delete the persistent session.

Select a host in Remote to open `ssh <alias>` in an integrated terminal. SSH options configured for that alias, including its user, port, identity file, and jump host, are applied by the local SSH client. Wildcard and negated `Host` patterns are not shown.

The sidebar header provides icon actions for Refresh, Filter or Clear Filter, and Settings.

## Settings

- `terminalKernel.backend`: choose `tmux` (default) or `screen`.
- `terminalKernel.tmuxMouse`: enable tmux mouse mode. It is disabled by default so VS Code text selection continues to work normally.

Use the gear icon in the sidebar header to open these settings.

## Backend behavior

- New sessions start in the active editor's workspace, or the first workspace folder when no file editor is active.
- The selected backend starts its configured default shell.
- tmux sessions show a compact status line, and the mouse setting applies only to sessions created by Terminal Kernel.
- screen sessions use a 10,000-line scrollback buffer. Press `Ctrl-a [` to enter screen scrollback mode.
- Sessions survive VS Code reloads until they are explicitly deleted.

## Requirements

Install `tmux` or `screen` and make the selected backend available on `PATH`. Remote connections also require the `ssh` client and `~/.ssh/config`.

## Troubleshooting

If sessions do not appear or start, confirm that `terminalKernel.backend` matches an installed backend, then use the Refresh icon in the sidebar header.

License: GPL v2
