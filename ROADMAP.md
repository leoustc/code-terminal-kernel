# Terminal Kernel Roadmap

## Version 1.2.0 — Terminal Only and Local SSH

- Add a fixed Remote group to the sidebar.
- Keep Other as the final group below Remote.
- Read concrete aliases from the local `~/.ssh/config` file on activation and manual refresh.
- Exclude wildcard and negated `Host` patterns.
- Deduplicate aliases case-insensitively and sort them alphabetically.
- Open selected hosts through the local SSH client using the alias as a direct process argument.
- Apply the existing manual filter to both sessions and remote hosts without background polling.

### Goal

Make Terminal Kernel a focused persistent-terminal extension. Version 1.2.0 will remove browser, Codex, generic tool-launching, and explicit shell-selection features while keeping the terminal workflow small and direct.

### Keep

- Persistent terminal sessions backed by `tmux` or `screen`.
- Create, list, connect, clear, and delete terminal sessions.
- Four fixed groups: Favorites, Terminal, Remote, and Other.
- Terminal contains sessions created by the extension using the `terminal-*` naming convention.
- Other contains every discovered tmux or screen session that does not match the Terminal naming convention, including legacy tool-prefixed sessions.
- Favorite-session drag and drop.
- Session filtering and refresh.
- Configurable tmux mouse support.

### Remove

#### Browser and VNC

- Remove the embedded webview/browser panel.
- Remove the `terminalKernel.openVnc` command and sidebar action.
- Remove the `terminalKernel.noVncUrl` setting.
- Remove all VNC constants, state, HTML generation, and documentation.

#### Codex and tools

- Delete the bundled `tools/codexinbox` executable.
- Remove bundled-tool discovery and generic tool launching.
- Remove the `terminalKernel.tools` setting.
- Remove the `terminalKernel.launchTool` and `terminalKernel.newGroupSession` commands.
- Remove tool-derived sidebar groups and tool-specific session creation.
- Remove Codex, Docker, and tool configuration from the documentation and package.

#### Bash and sh integration

- Remove the `terminalKernel.shell` setting and the `ShellName` type.
- Remove explicit `bash`, `sh`, login-shell, and shell-bootstrap handling.
- Remove `terminalKernel.preloadEnvFile` and environment-file sourcing.
- Let `tmux` or `screen` start the user's configured default shell.
- Attach VS Code terminals directly to the selected backend without a `bash -c` or `sh -c` wrapper.

### Sidebar header

- Add a Settings command to the Terminal Kernel sidebar header.
- Declare the Settings command icon as `$(gear)` under `contributes.commands`.
- Open the settings UI filtered to Terminal Kernel settings.
- Declare the Refresh command icon as `$(refresh)` under `contributes.commands` so the header does not render its title as text.
- Declare the Filter command icon as `$(filter)` under `contributes.commands` so the header does not render "Filter Sessions" as text.
- Keep Clear Filter conditional on an active filter and declare its command icon as `$(clear-all)`.
- Use `view/title` menu contributions only for placement, conditions, and ordering.
- Retain accessible command titles and tooltips even when actions are presented as icons.
- Order the header actions consistently: Refresh, Filter/Clear Filter, Settings.

### Implementation plan

1. Simplify the tree provider to four fixed groups: Favorites, Terminal, Remote, and Other.
2. Remove VNC/browser code and manifest contributions.
3. Remove Codex, bundled tools, tool groups, and tool-launch commands.
4. Replace explicit shell wrappers with direct `tmux` and `screen` creation and attachment.
5. Add the sidebar Settings command and finalize the header icons and ordering.
6. Update `README.md`, `package.json`, `VERSION`, and generated package metadata for 1.2.0.
7. Compile, package, install-test, and manually exercise both supported backends.

### Compatibility notes

- Existing `terminalKernel.shell`, `terminalKernel.tools`, `terminalKernel.preloadEnvFile`, and `terminalKernel.noVncUrl` user settings will become unused and should be removed from the contributed configuration.
- Existing tmux and screen sessions remain discoverable and usable.
- Existing favorite and filter state remains compatible.
- Existing sessions named `terminal-*` appear under Terminal.
- All other existing sessions, including tool-prefixed sessions, appear under Other; version 1.2.0 will not create new tool-specific sessions.
- Favorited sessions also appear under Favorites without changing their Terminal or Other classification.

### Acceptance criteria

- The extension exposes only persistent-terminal functionality.
- No browser, webview, VNC, Codex, Docker, bundled-tool, Bash, or sh feature references remain in tracked source, configuration, or documentation.
- `tools/codexinbox` is no longer packaged.
- Creating a session starts the backend's configured default shell.
- Connecting to a session attaches directly through `tmux` or `screen`.
- Every discovered session appears under Terminal or Other, and favorited sessions additionally appear under Favorites.
- Sessions outside the `terminal-*` naming convention are never hidden or discarded.
- Refresh, Filter, Clear Filter, and Settings appear only as sidebar-header icons, not text buttons, while retaining accessible labels and hover tooltips.
- Settings opens the Terminal Kernel settings page.
- Terminal creation, listing, connection, clearing, deletion, favorites, filtering, and refresh work with both tmux and screen.
- TypeScript compilation succeeds with no errors.
- The extension packages successfully as version 1.2.0.
