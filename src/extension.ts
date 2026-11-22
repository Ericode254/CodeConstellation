import * as vscode from 'vscode';
import { GraphPanel } from './GraphPanel';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('code-constellation.showGraph', () => {
			GraphPanel.createOrShow(context.extensionUri);
		})
	);
}

export function deactivate() {}
