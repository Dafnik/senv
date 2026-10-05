import { chmod } from 'node:fs/promises';
await chmod(new URL('../dist/senv.js', import.meta.url), 0o755);
