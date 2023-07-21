import fs from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

await execa('pnpm', ['clean'], {
	cwd: _dirname + '/../',
	stdout: process.stdout,
	stderr: process.stderr,
});

await execa('pnpm', ['build-pre'], {
	cwd: _dirname + '/../',
	stdout: process.stdout,
	stderr: process.stderr,
});

execa('pnpm', ['exec', 'gulp', 'watch'], {
	cwd: _dirname + '/../',
	stdout: process.stdout,
	stderr: process.stderr,
});

execa('pnpm', ['--filter', 'backend', 'watch'], {
	cwd: _dirname + '/../',
	stdout: process.stdout,
	stderr: process.stderr,
});

execa('pnpm', ['--filter', 'frontend', 'watch'], {
	cwd: _dirname + '/../',
	stdout: process.stdout,
	stderr: process.stderr,
});

execa('pnpm', ['--filter', 'sw', 'watch'], {
	cwd: _dirname + '/../',
	stdout: process.stdout,
	stderr: process.stderr,
});

const start = async () => {
	try {
		const stat = fs.statSync(_dirname + '/../packages/backend/built/boot/index.js');
		if (!stat) throw new Error('not exist yet');
		if (stat.size === 0) throw new Error('not built yet');

		const subprocess = await execa('pnpm', ['start'], {
			cwd: _dirname + '/../',
			stdout: process.stdout,
			stderr: process.stderr,
		});

		// なぜかworkerだけが終了してmasterが残るのでその対策
		process.on('SIGINT', () => {
			subprocess.kill('SIGINT');
			process.exit(0);
		});
	} catch (e) {
		await new Promise(resolve => setTimeout(resolve, 3000));
		start();
	}
};

start();
