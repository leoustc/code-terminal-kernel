
import * as vscode from 'vscode';
import { execFile, execFileSync } from 'child_process';
import * as path from 'path';
import {
  buildNumberedSessionName,
  buildSessionName,
  getSessionGroupName,
  listSshHosts,
  parseScreenSessions,
  parseTmuxSessions,
  sanitizeSessionName
} from './core';

type Backend = 'tmux' | 'screen';
type GroupKey = 'favorites' | 'terminal' | 'other' | 'remote';
type TreeItem = TerminalItem | RemoteItem | GroupItem;

const FAVORITES_GROUP = 'favorites';
const FAVORITES_KEY = 'terminalKernel.favorites';
const FILTER_KEY = 'terminalKernel.sessionFilter';
const SESSION_DRAG_MIME = 'application/vnd.code.tree.terminalKernelSessions';

let favoriteSessions = new Set<string>();
let sessionFilter = '';
let extensionContext: vscode.ExtensionContext | undefined;
let sessionTreeView: vscode.TreeView<TreeItem> | undefined;
const sessionTerminals = new Map<string, Set<vscode.Terminal>>();

class TerminalItem extends vscode.TreeItem {
  constructor(
    public readonly session: string,
    public readonly backend: Backend,
    isFavorite: boolean
  ) {
    super(session, vscode.TreeItemCollapsibleState.None);
    this.contextValue = isFavorite ? 'terminalSessionFavorite' : 'terminalSession';
    this.iconPath = new vscode.ThemeIcon('terminal');
    this.tooltip = `terminal: ${session}`;
    this.command = {
      command: 'terminalKernel.connectSession',
      title: 'Connect to Terminal',
      arguments: [this]
    };
  }
}

class RemoteItem extends vscode.TreeItem {
  constructor(public readonly host: string) {
    super(host, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'sshHost';
    this.iconPath = new vscode.ThemeIcon('remote');
    this.tooltip = `SSH: ${host}`;
    this.command = {
      command: 'terminalKernel.connectRemote',
      title: 'Connect via SSH',
      arguments: [this]
    };
  }
}

class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: GroupKey,
    count: number,
    contextValue = 'terminalGroup'
  ) {
    const displayName = capitalizeGroupName(groupName);
    const hasSessions = count > 0;
    const state = hasSessions
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
    super(displayName, state);
    this.contextValue = contextValue;
    this.description = String(count);
    this.id = `terminalGroup:${groupName}`;
    this.collapsibleState = state;
    this.tooltip = `${displayName} (${count})`;
  }
}

class TerminalProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private sessionsCache: string[] | undefined;
  private groupedCache: Map<GroupKey, string[]> | undefined;
  private sessionsBackend: Backend | undefined;
  private sessionsFetch?: { backend: Backend; promise: Promise<string[]> };
  private loadGeneration = 0;
  private remoteHostsCache: string[] | undefined;

  refresh() {
    this.loadGeneration += 1;
    this.sessionsCache = undefined;
    this.groupedCache = undefined;
    this.sessionsFetch = undefined;
    this.sessionsBackend = undefined;
    this.remoteHostsCache = undefined;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item: TreeItem) {
    return item;
  }

  private groupSessions(sessions: string[]): Map<GroupKey, string[]> {
    const grouped = new Map<GroupKey, string[]>([
      ['terminal', []],
      ['other', []]
    ]);
    sessions.forEach(session => {
      const key = getSessionGroupName(session);
      grouped.get(key)?.push(session);
    });
    return grouped;
  }

  private async getSessions(): Promise<string[]> {
    const backend = getBackend();
    if (this.sessionsBackend !== backend) {
      this.sessionsCache = undefined;
      this.groupedCache = undefined;
      this.sessionsFetch = undefined;
      this.sessionsBackend = backend;
      this.loadGeneration += 1;
    }
    if (this.sessionsCache) return this.sessionsCache;
    if (this.sessionsFetch?.backend === backend) {
      return this.sessionsFetch.promise;
    }
    const generation = this.loadGeneration;
    const promise = listSessions(backend)
      .then(sessions => {
        if (generation === this.loadGeneration && this.sessionsBackend === backend) {
          this.sessionsCache = sessions;
          this.groupedCache = undefined;
        }
        return sessions;
      })
      .finally(() => {
        if (this.sessionsFetch?.promise === promise) this.sessionsFetch = undefined;
      });
    this.sessionsFetch = { backend, promise };
    return promise;
  }

  private async getFilteredSessions(): Promise<string[]> {
    const sessions = await this.getSessions();
    return applySessionFilter(sessions);
  }

  private async getGroupedSessions(): Promise<Map<GroupKey, string[]>> {
    if (this.groupedCache) return this.groupedCache;
    const sessions = await this.getFilteredSessions();
    const grouped = this.groupSessions(sessions);
    this.groupedCache = grouped;
    return grouped;
  }

  private getRemoteHosts(): string[] {
    if (!this.remoteHostsCache) {
      this.remoteHostsCache = applySessionFilter(listSshHosts());
    }
    return this.remoteHostsCache;
  }

  private buildGroupItems(
    sessions: string[],
    sessionsByGroup: Map<GroupKey, string[]>
  ): GroupItem[] {
    const favorites = getFavoriteSessions(sessions);
    return [
      new GroupItem(FAVORITES_GROUP, favorites.length, 'terminalGroupFavorites'),
      new GroupItem('terminal', sessionsByGroup.get('terminal')?.length ?? 0),
      new GroupItem('remote', this.getRemoteHosts().length, 'terminalGroupRemote'),
      new GroupItem('other', sessionsByGroup.get('other')?.length ?? 0, 'terminalGroupOther')
    ];
  }

  async getChildren(element?: TreeItem): Promise<TreeItem[]> {
    try {
      if (!element) {
        const sessions = await this.getFilteredSessions();
        const grouped = await this.getGroupedSessions();
        return this.buildGroupItems(sessions, grouped);
      }
      if (element instanceof GroupItem) {
        if (element.groupName === 'remote') {
          return this.getRemoteHosts().map(host => new RemoteItem(host));
        }
        const sessions = await this.getFilteredSessions();
        if (element.groupName === FAVORITES_GROUP) {
          const backend = this.sessionsBackend ?? getBackend();
          return getFavoriteSessions(sessions).map(name => new TerminalItem(name, backend, true));
        }
        const grouped = await this.getGroupedSessions();
        const groupSessions = grouped.get(element.groupName) ?? [];
        const backend = this.sessionsBackend ?? getBackend();
        return groupSessions.map(name => new TerminalItem(name, backend, isFavorite(name)));
      }
      return [];
    } catch (err) {
      const backend = getBackend();
      const detail = err instanceof Error ? ` ${err.message}` : '';
      vscode.window.showErrorMessage(`Unable to list ${backend} sessions.${detail}`);
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

function getTmuxMouseEnabled(): boolean {
  return vscode.workspace.getConfiguration('terminalKernel').get<boolean>('tmuxMouse', false);
}

function loadFavorites(context: vscode.ExtensionContext) {
  const stored = context.workspaceState.get<string[]>(FAVORITES_KEY, []);
  favoriteSessions = new Set(stored);
}

function persistFavorites() {
  if (!extensionContext) return;
  const sorted = Array.from(favoriteSessions).sort();
  extensionContext.workspaceState.update(FAVORITES_KEY, sorted);
}

function isFavorite(session: string): boolean {
  return favoriteSessions.has(session);
}

function addFavoriteSessions(sessions: string[]) {
  let changed = false;
  sessions.forEach(session => {
    if (favoriteSessions.has(session)) return;
    favoriteSessions.add(session);
    changed = true;
  });
  if (changed) persistFavorites();
}

function removeFavoriteSession(session: string) {
  if (!favoriteSessions.delete(session)) return;
  persistFavorites();
}

function getFavoriteSessions(sessions: string[]): string[] {
  return sessions.filter(session => favoriteSessions.has(session));
}

function loadSessionFilter(context: vscode.ExtensionContext) {
  sessionFilter = context.workspaceState.get<string>(FILTER_KEY, '').trim();
  updateFilterContext();
  updateTreeMessage();
}

function setSessionFilter(value: string) {
  sessionFilter = value.trim();
  if (extensionContext) {
    extensionContext.workspaceState.update(FILTER_KEY, sessionFilter);
  }
  updateFilterContext();
  updateTreeMessage();
}

function getSessionFilter(): string {
  return sessionFilter;
}

function applySessionFilter(sessions: string[]): string[] {
  const filter = getSessionFilter().toLowerCase();
  if (!filter) return sessions;
  return sessions.filter(session => session.toLowerCase().includes(filter));
}

function updateFilterContext() {
  const active = Boolean(getSessionFilter());
  vscode.commands.executeCommand('setContext', 'terminalKernel.filterActive', active);
}

function updateTreeMessage() {
  if (!sessionTreeView) return;
  const filter = getSessionFilter();
  sessionTreeView.message = filter ? `Filter: ${filter}` : undefined;
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

function describeProcessError(command: string, error: Error, stderr = ''): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return `${command} is not installed or not available on PATH.`;
  if (code === 'EACCES') return `${command} is not executable.`;
  return stderr || error.message || `${command} failed.`;
}

async function listSessions(backend: Backend): Promise<string[]> {
  if (backend === 'screen') {
    const result = await execFileResult('screen', ['-ls']);
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (result.error && !/No Sockets found/i.test(combined)) {
      throw new Error(describeProcessError('screen', result.error, combined));
    }
    return parseScreenSessions(combined);
  }

  const result = await execFileResult('tmux', ['list-sessions', '-F', '#{session_name}']);
  if (result.error) {
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    if (/no server running|failed to connect to server/i.test(combined)) return [];
    throw new Error(describeProcessError('tmux', result.error, combined));
  }
  return parseTmuxSessions(result.stdout);
}

function createSession(session: string, backend: Backend, cwd?: string) {
  const options = cwd ? { cwd } : undefined;
  if (backend === 'screen') {
    execFileSync('screen', ['-dmS', session], options);
    configureScreenScrollback(session);
    return;
  }
  const args = ['new-session', '-d', '-s', session];
  if (cwd) args.push('-c', cwd);
  execFileSync('tmux', args, options);
  configureTmuxStatus(session);
}

function getAttachCommand(session: string, backend: Backend): { command: Backend; args: string[] } {
  return backend === 'screen'
    ? { command: 'screen', args: ['-r', session] }
    : { command: 'tmux', args: ['attach-session', '-t', session] };
}

function deleteSession(session: string, backend: Backend) {
  if (backend === 'screen') {
    execFileSync('screen', ['-S', session, '-X', 'quit']);
    return;
  }
  execFileSync('tmux', ['kill-session', '-t', session]);
}

async function getNextSessionName(prefix: string, backend: Backend): Promise<string> {
  try {
    const safePrefix = sanitizeSessionName(prefix) || 'terminal';
    const used = new Set<number>();
    const sessions = await listSessions(backend);
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
    ['mouse', getTmuxMouseEnabled() ? 'on' : 'off', 'session'],
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
      const target = scope === 'global' ? ['-g'] : ['-t', session];
      execFileSync('tmux', ['set-option', ...target, key, value]);
    } catch {
      // Ignore tmux styling failures to avoid blocking session creation.
    }
  });
}

function configureScreenScrollback(session: string) {
  const scrollback = 10000;
  const commands = ['defscrollback', 'scrollback'];
  commands.forEach(command => {
    try {
      execFileSync('screen', ['-S', session, '-X', command, String(scrollback)]);
    } catch {
      // Ignore screen scrollback failures to avoid blocking session creation.
    }
  });
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

function connectToSession(session: string, backend: Backend) {
  const cwd = getPreferredCwd();
  const attach = getAttachCommand(session, backend);
  const term = vscode.window.createTerminal({
    name: session,
    shellPath: attach.command,
    shellArgs: attach.args,
    cwd
  });
  trackSessionTerminal(session, backend, term);
  term.show();
}

function connectToRemote(host: string) {
  const term = vscode.window.createTerminal({
    name: `SSH: ${host}`,
    shellPath: 'ssh',
    shellArgs: [host],
    cwd: getPreferredCwd()
  });
  term.show();
}

function getSessionTerminalKey(session: string, backend: Backend): string {
  return `${backend}:${session}`;
}

function trackSessionTerminal(session: string, backend: Backend, term: vscode.Terminal) {
  const key = getSessionTerminalKey(session, backend);
  const existing = sessionTerminals.get(key);
  if (existing) {
    existing.add(term);
    return;
  }
  sessionTerminals.set(key, new Set([term]));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function discoverSessionTerminals(session: string, backend: Backend): vscode.Terminal[] {
  const escaped = escapeRegExp(session);
  const exactOrDup = new RegExp(`^${escaped}( \\(\\d+\\))?$`);
  return vscode.window.terminals.filter(term => {
    if (!exactOrDup.test(term.name)) return false;
    const options = term.creationOptions as vscode.TerminalOptions;
    return typeof options.shellPath !== 'string' || path.basename(options.shellPath) === backend;
  });
}

function getTrackedSessionTerminals(session: string, backend: Backend): vscode.Terminal[] {
  const key = getSessionTerminalKey(session, backend);
  const tracked = sessionTerminals.get(key);
  if (tracked && tracked.size > 0) {
    return Array.from(tracked);
  }
  const discovered = discoverSessionTerminals(session, backend);
  discovered.forEach(term => trackSessionTerminal(session, backend, term));
  return discovered;
}

function clearSessionFrontends(session: string, backend: Backend) {
  const tracked = getTrackedSessionTerminals(session, backend);
  if (tracked.length === 0) {
    return;
  }
  tracked.forEach(term => term.dispose());
}

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  loadFavorites(context);
  loadSessionFilter(context);
  const provider = new TerminalProvider();
  const dragAndDropController: vscode.TreeDragAndDropController<TreeItem> = {
    dragMimeTypes: [SESSION_DRAG_MIME],
    dropMimeTypes: [SESSION_DRAG_MIME],
    handleDrag(source, dataTransfer) {
      const sessions = source
        .filter((item): item is TerminalItem => item instanceof TerminalItem)
        .map(item => item.session);
      if (sessions.length === 0) return;
      dataTransfer.set(SESSION_DRAG_MIME, new vscode.DataTransferItem(JSON.stringify(sessions)));
    },
    async handleDrop(target, dataTransfer) {
      if (!(target instanceof GroupItem) || target.groupName !== FAVORITES_GROUP) return;
      const item = dataTransfer.get(SESSION_DRAG_MIME);
      if (!item) return;
      const raw = await item.asString();
      let sessions: unknown;
      try {
        sessions = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(sessions)) return;
      const cleaned = sessions.filter((session): session is string => typeof session === 'string');
      if (cleaned.length === 0) return;
      addFavoriteSessions(cleaned);
      provider.refresh();
    }
  };
  const treeView = vscode.window.createTreeView('terminalKernelSessions', {
    treeDataProvider: provider,
    dragAndDropController
  });
  sessionTreeView = treeView;
  updateTreeMessage();
  context.subscriptions.push(treeView);

  const startTerminalSession = async () => {
    const backend = getBackend();
    const suffix = await vscode.window.showInputBox({
      placeHolder: 'Name suffix (optional)',
      prompt: 'Will be prefixed with terminal-'
    });
    if (suffix === undefined) return;
    const cleaned = sanitizeSessionName(suffix);
    const session = cleaned
      ? buildSessionName('terminal', cleaned)
      : await getNextSessionName('terminal', backend);
    try {
      const cwd = getPreferredCwd();
      createSession(session, backend, cwd);
      provider.refresh();
    } catch (e) {
      const detail = e instanceof Error ? ` ${e.message}` : '';
      vscode.window.showErrorMessage(`Failed to create terminal "${session}".${detail}`);
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.newSession', async () => {
      await startTerminalSession();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.connectSession', async (item: TerminalItem) => {
      if (!item?.session) return;
      connectToSession(item.session, item.backend);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.connectRemote', (item: RemoteItem) => {
      if (!item?.host) return;
      connectToRemote(item.host);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.addFavorite', async (item: TerminalItem) => {
      if (!item?.session) return;
      addFavoriteSessions([item.session]);
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.removeFavorite', async (item: TerminalItem) => {
      if (!item?.session) return;
      removeFavoriteSession(item.session);
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.setFilter', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Filter sessions',
        value: getSessionFilter()
      });
      if (value === undefined) return;
      setSessionFilter(value);
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.clearFilter', () => {
      if (!getSessionFilter()) return;
      setSessionFilter('');
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.showSession', async (item: TerminalItem) => {
      if (!item?.session) return;
      clearSessionFrontends(item.session, item.backend);
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
        deleteSession(item.session, item.backend);
        removeFavoriteSession(item.session);
        provider.refresh();
      } catch (e) {
        const detail = e instanceof Error ? ` ${e.message}` : '';
        vscode.window.showErrorMessage(`Failed to delete terminal "${item.session}".${detail}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.refresh', () => provider.refresh())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.openSettings', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        `@ext:${context.extension.id}`
      );
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('terminalKernel.backend')) return;
      provider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(term => {
      sessionTerminals.forEach((terminals, key) => {
        if (!terminals.delete(term)) return;
        if (terminals.size === 0) {
          sessionTerminals.delete(key);
        }
      });
    })
  );
}

export function deactivate() {}
