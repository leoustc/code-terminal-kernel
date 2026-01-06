
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type Backend = 'tmux' | 'screen';
type ShellName = 'bash' | 'sh';
type GroupKey = string;

class TerminalItem extends vscode.TreeItem {
  constructor(public readonly session: string) {
    super(session, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'terminalSession';
    this.iconPath = new vscode.ThemeIcon('terminal');
    this.tooltip = `terminal: ${session}`;
    this.command = {
      command: 'terminalKernel.connectSession',
      title: 'Connect to Terminal',
      arguments: [this]
    };
  }
}

class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: GroupKey,
    public readonly commandText: string | undefined,
    count: number
  ) {
    const displayName = capitalizeGroupName(groupName);
    const hasSessions = count > 0;
    const state = hasSessions
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
    super(displayName, state);
    this.contextValue = 'terminalGroup';
    this.description = String(count);
    this.id = `terminalGroup:${groupName}:${count}`;
    this.collapsibleState = state;
    this.tooltip = `${displayName} (${count})`;
  }
}

class TerminalProvider implements vscode.TreeDataProvider<TerminalItem | GroupItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item: TerminalItem | GroupItem) {
    return item;
  }

  private getToolGroups(): Array<{ name: GroupKey; command: string }> {
    const seen = new Set<GroupKey>();
    const groups: Array<{ name: GroupKey; command: string }> = [];
    getToolsConfig()
      .map(command => command.trim())
      .filter(Boolean)
      .forEach(command => {
        const name = getToolPrefix(command);
        if (!name || seen.has(name) || name === 'terminal') return;
        seen.add(name);
        groups.push({ name, command });
      });
    return groups;
  }

  private groupSessions(sessions: string[]): Map<GroupKey, string[]> {
    const grouped = new Map<GroupKey, string[]>();
    sessions.forEach(session => {
      const key = getSessionGroupName(session);
      const existing = grouped.get(key);
      if (existing) {
        existing.push(session);
      } else {
        grouped.set(key, [session]);
      }
    });
    return grouped;
  }

  private buildGroupItems(sessionsByGroup: Map<GroupKey, string[]>): GroupItem[] {
    const items: GroupItem[] = [];
    const seen = new Set<GroupKey>();
    const addGroup = (name: GroupKey, commandText?: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      const count = sessionsByGroup.get(name)?.length ?? 0;
      items.push(new GroupItem(name, commandText, count));
    };

    addGroup('terminal');
    this.getToolGroups().forEach(group => addGroup(group.name, group.command));
    const extra = Array.from(sessionsByGroup.keys()).filter(name => !seen.has(name));
    extra.sort().forEach(name => addGroup(name, name));
    return items;
  }

  getChildren(
    element?: TerminalItem | GroupItem
  ): Thenable<(TerminalItem | GroupItem)[]> {
    try {
      const sessions = listSessions();
      if (!element) {
        const grouped = this.groupSessions(sessions);
        return Promise.resolve(this.buildGroupItems(grouped));
      }
      if (element instanceof GroupItem) {
        const grouped = this.groupSessions(sessions);
        const groupSessions = grouped.get(element.groupName) ?? [];
        return Promise.resolve(groupSessions.map(name => new TerminalItem(name)));
      }
      return Promise.resolve([]);
    } catch (err) {
      vscode.window.showErrorMessage('Unable to list terminals');
      return Promise.resolve([]);
    }
  }
}

function getBackend(): Backend {
  const backend = vscode.workspace
    .getConfiguration('terminalKernel')
    .get<string>('backend', 'tmux');
  return backend === 'screen' ? 'screen' : 'tmux';
}

function getShellName(): ShellName {
  const shell = vscode.workspace
    .getConfiguration('terminalKernel')
    .get<string>('shell', 'bash');
  return shell === 'sh' ? 'sh' : 'bash';
}

function getPreloadEnvFile(): string | undefined {
  const raw = vscode.workspace
    .getConfiguration('terminalKernel')
    .get<string>('preloadEnvFile', '')
    .trim();
  if (!raw) return undefined;
  let resolved = raw;
  if (resolved.startsWith('~')) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  if (!path.isAbsolute(resolved)) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      resolved = path.join(workspaceRoot, resolved);
    }
  }
  return resolved;
}

function getToolsConfig(): string[] {
  const raw = vscode.workspace
    .getConfiguration('terminalKernel')
    .get<unknown>('tools', ['codex']);
  if (!Array.isArray(raw)) return ['codex'];
  return raw.map(value => (typeof value === 'string' ? value : String(value ?? '')));
}

function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function buildShellBootstrap(shell: ShellName, envFile?: string, initialCommand?: string): string {
  const commands: string[] = [];
  if (envFile) {
    commands.push(`. ${shellEscape(envFile)}`);
  }
  if (initialCommand) {
    commands.push(initialCommand);
  }
  const execCmd = shell === 'bash' ? `exec ${shell} -l` : `exec ${shell}`;
  commands.push(execCmd);
  const shellFlag = shell === 'bash' ? '-lc' : '-c';
  const command = commands.join('; ');
  return `${shell} ${shellFlag} ${shellEscape(command)}`;
}

function getShellCommand(envFile?: string, initialCommand?: string): string {
  const shell = getShellName();
  if (!envFile && !initialCommand) {
    return shell === 'bash' ? `${shell} -l` : shell;
  }
  return buildShellBootstrap(shell, envFile, initialCommand);
}

function parseTmuxSessions(out: string): string[] {
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map(line => line.split(':')[0])
    .filter(Boolean);
}

function parseScreenSessions(out: string): string[] {
  if (!out || /No Sockets found/i.test(out)) return [];
  return out
    .split('\n')
    .map(line => line.trim())
    .map(line => {
      const match = /^\d+\.(\S+)\s/.exec(line);
      return match?.[1];
    })
    .filter((name): name is string => Boolean(name));
}

function listSessions(): string[] {
  try {
    const backend = getBackend();
    const cmd =
      backend === 'screen' ? 'screen -ls 2>/dev/null || true' : 'tmux ls 2>/dev/null || true';
    const out = execSync(cmd).toString().trim();
    return backend === 'screen' ? parseScreenSessions(out) : parseTmuxSessions(out);
  } catch {
    return [];
  }
}

function createSession(
  session: string,
  cwd?: string,
  envFile?: string,
  initialCommand?: string
) {
  const backend = getBackend();
  const options = cwd ? { cwd } : undefined;
  const shellCommand = getShellCommand(envFile, initialCommand);
  if (backend === 'screen') {
    execSync(
      `screen -dmS ${session} ${shellCommand}`,
      options
    );
    configureScreenScrollback(session);
    return;
  }
  execSync(
    `tmux new -d -s ${session} ${shellCommand}`,
    options
  );
  configureTmuxStatus(session);
}

function attachSessionCommand(session: string): string {
  const backend = getBackend();
  return backend === 'screen' ? `screen -r ${session}` : `tmux attach -t ${session}`;
}

function deleteSession(session: string) {
  const backend = getBackend();
  if (backend === 'screen') {
    execSync(`screen -S ${session} -X quit`);
    return;
  }
  execSync(`tmux kill-session -t ${session}`);
}

function getNextSessionName(prefix: string): string {
  try {
    const used = new Set<number>();
    listSessions().forEach(name => {
      const token = `${prefix}-`;
      if (!name.startsWith(token)) return;
      const suffix = Number(name.slice(token.length));
      if (Number.isInteger(suffix) && suffix > 0) {
        used.add(suffix);
      }
    });
    let next = 1;
    while (used.has(next)) next += 1;
    return `${prefix}-${next}`;
  } catch {
    return `${prefix}-1`;
  }
}

function configureTmuxStatus(session: string) {
  const options: Array<[string, string, 'session' | 'global']> = [
    ['mouse', 'on', 'global'],
    ['status', 'on', 'session'],
    ['status-interval', '5', 'session'],
    ['status-justify', 'left', 'session'],
    ['status-left-length', '60', 'session'],
    ['status-right-length', '120', 'session'],
    ['status-left', ' #{session_name} #{?client_prefix,[PREFIX] ,}', 'session'],
    ['status-right', ' #{pane_current_command} #{pane_current_path} | #h %Y-%m-%d %H:%M ', 'session']
  ];
  options.forEach(([key, value, scope]) => {
    try {
      const target = scope === 'global' ? '-g' : `-t ${session}`;
      execSync(`tmux set-option ${target} ${key} ${shellEscape(value)}`);
    } catch {
      // Ignore tmux styling failures to avoid blocking session creation.
    }
  });
}

function configureScreenScrollback(session: string) {
  const scrollback = 10000;
  const commands = [`defscrollback ${scrollback}`, `scrollback ${scrollback}`];
  commands.forEach(command => {
    try {
      execSync(`screen -S ${session} -X ${command}`);
    } catch {
      // Ignore screen scrollback failures to avoid blocking session creation.
    }
  });
}

function getToolPrefix(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return 'tool';
  const firstToken = trimmed.split(/\s+/)[0];
  const base = path.basename(firstToken);
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return cleaned || 'tool';
}

function getSessionGroupName(session: string): GroupKey {
  const match = /^(.+)-([a-z0-9]+)$/i.exec(session);
  return match?.[1]?.toLowerCase() || 'terminal';
}

function capitalizeGroupName(name: string): string {
  if (!name) return name;
  return name[0].toUpperCase() + name.slice(1);
}

function getPreferredCwd(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document?.uri?.scheme === 'file') {
    const filePath = editor.document.uri.fsPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    return workspaceFolder?.uri.fsPath ?? path.dirname(filePath);
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function connectToSession(session: string) {
  const cwd = getPreferredCwd();
  const term = vscode.window.createTerminal({
    name: session,
    shellPath: getShellName(),
    shellArgs: ['-c', attachSessionCommand(session)],
    cwd
  });
  term.show();
}

function getValidatedEnvFile(): string | null | undefined {
  const envFile = getPreloadEnvFile();
  if (envFile && !fs.existsSync(envFile)) {
    vscode.window.showErrorMessage(`Preload env file not found: ${envFile}`);
    return null;
  }
  return envFile;
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new TerminalProvider();
  vscode.window.createTreeView('terminalKernelSessions', { treeDataProvider: provider });

  const startSessionWithPrefix = async (prefix: string, initialCommand?: string) => {
    const suffix = await vscode.window.showInputBox({
      placeHolder: 'Name suffix (optional)',
      prompt: `Will be prefixed with ${prefix}-`
    });
    if (suffix === undefined) return;
    const cleaned = suffix.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    const session = cleaned ? `${prefix}-${cleaned}` : getNextSessionName(prefix);
    try {
      const cwd = getPreferredCwd();
      const envFile = getValidatedEnvFile();
      if (envFile === null) return;
      createSession(session, cwd, envFile, initialCommand);
      provider.refresh();
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to create terminal: ${session}`);
    }
  };

  const startTerminalSession = async () => startSessionWithPrefix('terminal');

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.newSession', async () => {
      await startTerminalSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.connectSession', async (item: TerminalItem) => {
      if (!item?.session) return;
      connectToSession(item.session);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.deleteSession', async (item: TerminalItem) => {
      if (!item?.session) return;
      const confirm = await vscode.window.showWarningMessage(
        `Delete terminal "${item.session}"?`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') return;
      try {
        deleteSession(item.session);
        provider.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to delete terminal: ${item.session}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.refresh', () => provider.refresh())
  );

  const startToolSession = async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) {
      vscode.window.showErrorMessage('Tool command is empty.');
      return;
    }
    const prefix = getToolPrefix(trimmed);
    await startSessionWithPrefix(prefix, trimmed);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.launchTool', (command: string) =>
      startToolSession(command)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.newGroupSession', async (item: GroupItem) => {
      if (!item) return;
      if (item.groupName === 'terminal') {
        await startTerminalSession();
        return;
      }
      const command = item.commandText ?? item.groupName;
      await startToolSession(command);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('terminalKernel.tools')) return;
      provider.refresh();
    })
  );
}

export function deactivate() {}
