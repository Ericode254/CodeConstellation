import * as vscode from 'vscode';
import { GraphPanel } from './GraphPanel';

export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "code-constellation" is now active!');

	let disposable = vscode.commands.registerCommand('code-constellation.showGraph', () => {
		GraphPanel.createOrShow(context.extensionUri);
	});

	context.subscriptions.push(disposable);
}

export function deactivate() {}
