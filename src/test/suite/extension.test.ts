import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('registers the showGraph command', async () => {
		await vscode.extensions.getExtension('code-constellation.code-constellation')?.activate();
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('code-constellation.showGraph'));
	});
});
