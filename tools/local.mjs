// Runs the app locally with the real backend: builds, then serves dist/ and the API on http://localhost:4180 with
// data in .local/data (git-ignored). The first time it prints an invite link for Daniel (owner).
//   npm run local
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const env = { ...process.env, PORT: '4180', ORIGIN: 'http://localhost:4180', STATIC_DIR: 'dist', DATA_DIR: '.local/data' };
execFileSync('node', ['tools/build.mjs'], { stdio: 'inherit' });
execFileSync('node', ['tools/build-server.mjs'], { stdio: 'inherit' });
const first = !existsSync('.local/data/kofferklar.db');
const server = spawn('node', ['dist-server/main.mjs'], { env, stdio: 'inherit' });
if (first) {
  setTimeout(() => {
    execFileSync('node', ['dist-server/cli.mjs', 'invite', '--name', 'Daniel', '--role', 'owner'], { env, stdio: 'inherit' });
  }, 500);
}
process.on('SIGINT', () => server.kill());
