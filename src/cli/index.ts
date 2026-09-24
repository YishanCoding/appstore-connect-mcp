import { runCli } from './run.js';

const result = await runCli(process.argv.slice(2));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exit(result.code);
