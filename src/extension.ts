
import * as vscode from 'vscode';
import { execSync, execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type Backend = 'tmux' | 'screen';
type ShellName = 'bash' | 'sh';
type GroupKey = string;

const SESSION_CACHE_TTL_MS = 500;
const SESSION_NAME_MAX = 24;

let bundledTools: string[] = [];

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
  private sessionsCache: string[] | undefined;
  private groupedCache: Map<GroupKey, string[]> | undefined;
  private sessionsCacheAt = 0;
  private sessionsFetch?: Promise<string[]>;

  refresh() {
    this.sessionsCache = undefined;
    this.groupedCache = undefined;
    this.sessionsFetch = undefined;
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

  private getKnownGroupNames(): GroupKey[] {
    const names = ['terminal', ...this.getToolGroups().map(group => group.name)];
    const seen = new Set<GroupKey>();
    const unique: GroupKey[] = [];
    names.forEach(name => {
      const lowered = name.toLowerCase();
      if (seen.has(lowered)) return;
      seen.add(lowered);
      unique.push(lowered);
    });
    unique.sort((a, b) => b.length - a.length);
    return unique;
  }

  private groupSessions(sessions: string[]): Map<GroupKey, string[]> {
    const grouped = new Map<GroupKey, string[]>();
    const knownGroups = this.getKnownGroupNames();
    sessions.forEach(session => {
      const key = getSessionGroupName(session, knownGroups);
      const existing = grouped.get(key);
      if (existing) {
        existing.push(session);
      } else {
        grouped.set(key, [session]);
      }
    });
    return grouped;
  }

  private async getSessions(): Promise<string[]> {
    const now = Date.now();
    if (this.sessionsCache && now - this.sessionsCacheAt < SESSION_CACHE_TTL_MS) {
      return this.sessionsCache;
    }
    if (this.sessionsFetch) {
      return this.sessionsFetch;
    }
    this.sessionsFetch = listSessions()
      .then(sessions => {
        this.sessionsCache = sessions;
        this.sessionsCacheAt = Date.now();
        this.groupedCache = undefined;
        return sessions;
      })
      .finally(() => {
        this.sessionsFetch = undefined;
      });
    return this.sessionsFetch;
  }

  private async getGroupedSessions(): Promise<Map<GroupKey, string[]>> {
    if (this.groupedCache) return this.groupedCache;
    const sessions = await this.getSessions();
    const grouped = this.groupSessions(sessions);
    this.groupedCache = grouped;
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

  async getChildren(element?: TerminalItem | GroupItem): Promise<(TerminalItem | GroupItem)[]> {
    try {
      if (!element) {
        const grouped = await this.getGroupedSessions();
        return this.buildGroupItems(grouped);
      }
      if (element instanceof GroupItem) {
        const grouped = await this.getGroupedSessions();
        const groupSessions = grouped.get(element.groupName) ?? [];
        return groupSessions.map(name => new TerminalItem(name));
      }
      return [];
    } catch (err) {
      vscode.window.showErrorMessage('Unable to list terminals');
      return [];
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

function getTmuxMouseEnabled(): boolean {
  return vscode.workspace.getConfiguration('terminalKernel').get<boolean>('tmuxMouse', false);
}

function discoverBundledTools(toolsDir: string): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(toolsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const tools: string[] = [];
  entries.forEach(entry => {
    if (!entry.isFile()) return;
    const toolPath = path.join(toolsDir, entry.name);
    try {
      fs.accessSync(toolPath, fs.constants.X_OK);
      tools.push(toolPath);
    } catch {
      // Ignore non-executable files.
    }
  });

  tools.sort();
  return tools;
}

function resolveHomePath(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function sanitizeSessionName(value: string): string {
  return value.replace(/[^a-zA-Z0-9-]/g, '-');
}

function buildNumberedSessionName(prefix: string, suffix: number | string): string {
  const safePrefix = sanitizeSessionName(prefix) || 'terminal';
  const suffixText = String(suffix);
  const maxPrefixLen = Math.max(1, SESSION_NAME_MAX - suffixText.length - 1);
  const trimmedPrefix = safePrefix.slice(0, maxPrefixLen);
  return `${trimmedPrefix}-${suffixText}`;
}

function buildSessionName(prefix: string, suffix: string): string {
  const safePrefix = sanitizeSessionName(prefix) || 'terminal';
  const safeSuffix = sanitizeSessionName(suffix);
  if (safePrefix.length >= SESSION_NAME_MAX - 1) {
    const trimmedPrefix = safePrefix.slice(0, SESSION_NAME_MAX - 2);
    const trimmedSuffix = safeSuffix.slice(0, 1);
    return `${trimmedPrefix}-${trimmedSuffix}`;
  }
  const maxSuffixLen = Math.max(1, SESSION_NAME_MAX - safePrefix.length - 1);
  const trimmedSuffix = safeSuffix.slice(0, maxSuffixLen);
  return `${safePrefix}-${trimmedSuffix}`;
}

function mergeTools(primary: string[], secondary: string[]): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    merged.push(trimmed);
  };
  primary.forEach(add);
  secondary.forEach(add);
  return merged;
}

function resolveToolCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (bundledTools.includes(trimmed)) {
    return `. ${shellEscape(trimmed)}`;
  }
  return trimmed;
}

function getPreloadEnvFile(): string | undefined {
  const raw = vscode.workspace
    .getConfiguration('terminalKernel')
    .get<string>('preloadEnvFile', '')
    .trim();
  if (!raw) return undefined;
  let resolved = resolveHomePath(raw);
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
  const configTools = Array.isArray(raw)
    ? raw.map(value => (typeof value === 'string' ? value : String(value ?? '')))
    : ['codex'];
  return mergeTools(bundledTools, configTools);
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

function execFileResult(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; error: Error | null }> {
  return new Promise(resolve => {
    execFile(command, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({
        stdout: (stdout ?? '').trim(),
        stderr: (stderr ?? '').trim(),
        error: error ?? null
      });
    });
  });
}

async function listSessions(): Promise<string[]> {
  try {
    const backend = getBackend();
    if (backend === 'screen') {
      const result = await execFileResult('screen', ['-ls']);
      const combined = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      return parseScreenSessions(combined);
    }
    const result = await execFileResult('tmux', ['ls']);
    if (result.error) return [];
    return parseTmuxSessions(result.stdout);
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
      `screen -dmS ${shellEscape(session)} ${shellCommand}`,
      options
    );
    configureScreenScrollback(session);
    return;
  }
  execSync(
    `tmux new -d -s ${shellEscape(session)} ${shellCommand}`,
    options
  );
  configureTmuxStatus(session);
}

function attachSessionCommand(session: string): string {
  const backend = getBackend();
  return backend === 'screen'
    ? `screen -r ${shellEscape(session)}`
    : `tmux attach -t ${shellEscape(session)}`;
}

function deleteSession(session: string) {
  const backend = getBackend();
  if (backend === 'screen') {
    execSync(`screen -S ${shellEscape(session)} -X quit`);
    return;
  }
  execSync(`tmux kill-session -t ${shellEscape(session)}`);
}

async function getNextSessionName(prefix: string): Promise<string> {
  try {
    const safePrefix = sanitizeSessionName(prefix) || 'terminal';
    const used = new Set<number>();
    const sessions = await listSessions();
    sessions.forEach(name => {
      const token = `${safePrefix}-`;
      if (!name.startsWith(token)) return;
      const suffix = Number(name.slice(token.length));
      if (Number.isInteger(suffix) && suffix > 0) {
        used.add(suffix);
      }
    });
    let next = 1;
    while (used.has(next)) next += 1;
    return buildNumberedSessionName(safePrefix, next);
  } catch {
    return buildNumberedSessionName(prefix, 1);
  }
}

function configureTmuxStatus(session: string) {
  const options: Array<[string, string, 'session' | 'global']> = [
    ['mouse', getTmuxMouseEnabled() ? 'on' : 'off', 'global'],
    ['status', 'on', 'session'],
    ['status-interval', '5', 'session'],
    ['status-justify', 'left', 'session'],
    ['status-left-length', '60', 'session'],
    ['status-right-length', '120', 'session'],
    ['status-left', ' #{session_name} #{?client_prefix,[PREFIX] ,}', 'session'],
    ['status-right', ' #{pane_current_command} #{pane_current_path} | #h %Y-%m-%d %H:%M ', 'session']
  ];
  const commands = options.map(([key, value, scope]) => {
    const target = scope === 'global' ? '-g' : `-t ${shellEscape(session)}`;
    return `set-option ${target} ${key} ${shellEscape(value)}`;
  });
  try {
    if (commands.length > 0) {
      execSync(`tmux ${commands.join(' \\; ')}`);
      return;
    }
  } catch {
    // Fall back to per-option updates to preserve behavior on older tmux versions.
  }
  options.forEach(([key, value, scope]) => {
    try {
      const target = scope === 'global' ? '-g' : `-t ${shellEscape(session)}`;
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
      execSync(`screen -S ${shellEscape(session)} -X ${command}`);
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

function getSessionGroupName(session: string, knownGroups: GroupKey[] = []): GroupKey {
  const lowered = session.toLowerCase();
  for (const group of knownGroups) {
    if (lowered.startsWith(`${group}-`)) return group;
  }
  const match = /^(.+)-([a-z0-9-]+)$/i.exec(session);
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
  bundledTools = discoverBundledTools(context.asAbsolutePath('tools'));

  const provider = new TerminalProvider();
  vscode.window.createTreeView('terminalKernelSessions', { treeDataProvider: provider });

  const startSessionWithPrefix = async (prefix: string, initialCommand?: string) => {
    const suffix = await vscode.window.showInputBox({
      placeHolder: 'Name suffix (optional)',
      prompt: `Will be prefixed with ${prefix}-`
    });
    if (suffix === undefined) return;
    const cleaned = sanitizeSessionName(suffix);
    const session = cleaned ? buildSessionName(prefix, cleaned) : await getNextSessionName(prefix);
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
    const resolvedCommand = resolveToolCommand(trimmed);
    await startSessionWithPrefix(prefix, resolvedCommand);
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
