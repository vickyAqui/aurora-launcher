#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const patchDir = join(root, 'patches');
const nmDir = join(root, 'node_modules');

const patches = [
  { name: 'eml-lib', version: '2.3.5' },
];

for (const { name, version } of patches) {
  const patchFile = join(patchDir, `${name}+${version}.patch`);
  const pkgDir = join(nmDir, name);

  if (!existsSync(patchFile)) {
    console.log(`[apply-patches] No patch file for ${name}, skipping.`);
    continue;
  }
  if (!existsSync(pkgDir)) {
    console.log(`[apply-patches] Package ${name} not installed, skipping.`);
    continue;
  }

  console.log(`[apply-patches] Applying patch for ${name}@${version}...`);
  try {
    execSync(`patch -p1 --no-backup-if-mismatch < "${patchFile}"`, {
      cwd: pkgDir,
      stdio: 'inherit',
    });
    console.log(`[apply-patches] ${name} patched successfully.`);
  } catch (err) {
    console.error(`[apply-patches] Failed to patch ${name}:`, err.message);
    process.exit(1);
  }
}
