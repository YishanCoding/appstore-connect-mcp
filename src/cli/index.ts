import { runCli } from './run.js';

// Pipes are async: process.exit() right after write() truncates output past the 64KB pipe buffer.
function writeAll(stream: NodeJS.WriteStream, data: string): Promise<void> {
    return new Promise((resolve) => {
        if (!data) return resolve();
        stream.write(data, () => resolve());
    });
}

const result = await runCli(process.argv.slice(2));
await writeAll(process.stdout, result.stdout);
await writeAll(process.stderr, result.stderr);
process.exit(result.code);
