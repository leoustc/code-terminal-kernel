
import * as vscode from 'vscode';
import { execSync } from 'child_process';

class TmuxItem extends vscode.TreeItem {
  constructor(public readonly session: string) {
    super(session, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'tmuxSession';
    this.iconPath = new vscode.ThemeIcon('terminal');
    this.tooltip = `tmux session: ${session}`;
  }
}

class TmuxProvider implements vscode.TreeDataProvider<TmuxItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(item: TmuxItem) {
    return item;
  }

  getChildren(): Thenable<TmuxItem[]> {
    try {
      const out = execSync('tmux ls 2>/dev/null || true').toString().trim();
      if (!out) return Promise.resolve([]);
      const items = out.split('\n').filter(Boolean).map(line => {
        const name = line.split(':')[0];
        return new TmuxItem(name);
      });
      return Promise.resolve(items);
    } catch (err) {
      vscode.window.showErrorMessage('Unable to list tmux sessions');
      return Promise.resolve([]);
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new TmuxProvider();
  vscode.window.createTreeView('tmuxSessions', { treeDataProvider: provider });

  context.subscriptions.push(
    vscode.commands.registerCommand('tmux.newSession', async () => {
      const name = await vscode.window.showInputBox({
        placeHolder: 'Session name',
        prompt: 'Leave blank to auto-generate'
      });
      const session = name && name.trim() !== '' ? name.trim() : `session-${Date.now()}`;
      try {
        execSync(`tmux new -d -s ${session}`);
        provider.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to create tmux session: ${session}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tmux.connectSession', async (item: TmuxItem) => {
      if (!item?.session) return;
      const term = vscode.window.createTerminal({
        name: `tmux:${item.session}`,
        shellPath: '/bin/bash',
        shellArgs: ['-c', `tmux attach -t ${item.session}`]
      });
      term.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tmux.deleteSession', async (item: TmuxItem) => {
      if (!item?.session) return;
      const confirm = await vscode.window.showWarningMessage(
        `Delete tmux session "${item.session}"?`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') return;
      try {
        execSync(`tmux kill-session -t ${item.session}`);
        provider.refresh();
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to delete session: ${item.session}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('tmux.refresh', () => provider.refresh())
  );
}

export function deactivate() {}
