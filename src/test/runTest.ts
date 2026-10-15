import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { runTests } from '@vscode/test-electron';

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		// Open an empty workspace folder so tests can run VS Code tasks, which
		// need a workspace.
		const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'zephyr-tools-test-workspace-'));

		// Download VS Code, unzip it and run the integration test
		try {
			await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: [workspacePath] });
		} finally {
			fs.rmSync(workspacePath, { recursive: true, force: true });
		}
	} catch (_err) {
		console.error('Failed to run tests');
		process.exit(1);
	}
}

main();
