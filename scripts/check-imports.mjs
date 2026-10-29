// Garante a regra: apps/* só dependem de packages/*, nunca de outros apps.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const apps = readdirSync('apps').filter((d) => existsSync(join('apps', d, 'package.json')));
const names = Object.fromEntries(
  apps.map((d) => [JSON.parse(readFileSync(join('apps', d, 'package.json'))).name, d]),
);
let bad = 0;
for (const d of apps) {
  const pkg = JSON.parse(readFileSync(join('apps', d, 'package.json'), 'utf8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const dep of Object.keys(deps)) {
    if (names[dep]) {
      console.error(`✗ apps/${d} depende de apps/${names[dep]} (proibido)`);
      bad++;
    }
  }
}
if (bad) process.exit(1);
console.log('✓ regras de importação entre apps OK');
