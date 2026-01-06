
import * as vscode from 'vscode';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type Backend = 'tmux' | 'screen';
type ShellName = 'bash' | 'sh';

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

class TerminalProvider implements vscode.TreeDataProvider<TerminalItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item: TerminalItem) {
    return item;
  }

  getChildren(): Thenable<TerminalItem[]> {
    const sessions = listSessions();
    if (!sessions.length) {
      return Promise.resolve([]);
    }
    try {
      const items = sessions.map(name => new TerminalItem(name));
      return Promise.resolve(items);
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

function shellEscape(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function buildShellBootstrap(shell: ShellName, envFile: string): string {
  const sourceCmd = `. ${shellEscape(envFile)}`;
  const execCmd = shell === 'bash' ? `exec ${shell} -l` : `exec ${shell}`;
  const shellFlag = shell === 'bash' ? '-lc' : '-c';
  const command = `${sourceCmd}; ${execCmd}`;
  return `${shell} ${shellFlag} ${shellEscape(command)}`;
}

function getShellCommand(envFile?: string): string {
  const shell = getShellName();
  if (!envFile) {
    return shell === 'bash' ? `${shell} -l` : shell;
  }
  return buildShellBootstrap(shell, envFile);
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

function createSession(session: string, cwd?: string, envFile?: string) {
  const backend = getBackend();
  const options = cwd ? { cwd } : undefined;
  const shellCommand = getShellCommand(envFile);
  if (backend === 'screen') {
    execSync(
      `screen -dmS ${session} ${shellCommand}`,
      options
    );
    return;
  }
  execSync(
    `tmux new -d -s ${session} ${shellCommand}`,
    options
  );
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

function getNextTerminalName(): string {
  try {
    const used = new Set<number>();
    listSessions().forEach(name => {
      const match = /^terminal-(\d+)$/.exec(name);
      if (match) used.add(Number(match[1]));
    });
    let next = 1;
    while (used.has(next)) next += 1;
    return `terminal-${next}`;
  } catch {
    return 'terminal-1';
  }
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

export function activate(context: vscode.ExtensionContext) {
  const provider = new TerminalProvider();
  vscode.window.createTreeView('terminalKernelSessions', { treeDataProvider: provider });

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.newSession', async () => {
      const suffix = await vscode.window.showInputBox({
        placeHolder: 'Name suffix (optional)',
        prompt: 'Will be prefixed with terminal-'
      });
      const cleaned = (suffix ?? '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
      const session = cleaned ? `terminal-${cleaned}` : getNextTerminalName();
      try {
        const cwd = getPreferredCwd();
        const envFile = getPreloadEnvFile();
        if (envFile && !fs.existsSync(envFile)) {
          vscode.window.showErrorMessage(`Preload env file not found: ${envFile}`);
          return;
        }
        createSession(session, cwd, envFile);
        provider.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to create terminal: ${session}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('terminalKernel.connectSession', async (item: TerminalItem) => {
      if (!item?.session) return;
      const cwd = getPreferredCwd();
      const term = vscode.window.createTerminal({
        name: item.session,
        shellPath: getShellName(),
        shellArgs: ['-c', attachSessionCommand(item.session)],
        cwd
      });
      term.show();
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
}

export function deactivate() {}
