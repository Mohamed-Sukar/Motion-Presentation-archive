import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(appDir, '..');
const pkgPath = path.join(appDir, 'package.json');
const lockPath = path.join(appDir, 'package-lock.json');
const installerDir = path.join(rootDir, 'installer');
const versionsDir = path.join(rootDir, 'versions');

function parseSemver(v) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!match) {
    throw new Error(`Invalid semver version: "${v}"`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function computeNextVersion(current, arg) {
  const [maj, min, pat] = parseSemver(current);
  if (!arg || arg === 'patch') return `${maj}.${min}.${pat + 1}`;
  if (arg === 'minor') return `${maj}.${min + 1}.0`;
  if (arg === 'major') return `${maj + 1}.0.0`;
  parseSemver(arg);
  return arg.trim();
}

function main() {
  const arg = process.argv[2] ?? 'patch';
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version;
  const nextVersion = computeNextVersion(currentVersion, arg);

  if (nextVersion === currentVersion) {
    throw new Error(`Target version (${nextVersion}) is identical to current version.`);
  }

  console.log(`\n🚀 Releasing Motion Presentation Studio: v${currentVersion} -> v${nextVersion}\n`);

  // 1. Update package.json
  pkg.version = nextVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

  // 2. Update package-lock.json if present
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    lock.version = nextVersion;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].version = nextVersion;
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8');
  }

  // 3. Best-effort cleanup of stale workspace win-unpacked dirs, then stage NSIS build outside workspace indexer
  for (const staleName of ['win-unpacked', 'win-unpacked.tmp']) {
    const staleDir = path.join(installerDir, staleName);
    if (fs.existsSync(staleDir)) {
      try {
        fs.rmSync(staleDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 400 });
      } catch {
        // Ignore if a workspace indexer holds a handle; staging build runs in os.tmpdir().
      }
    }
  }

  const productName = pkg.productName || 'Motion Presentation Studio';
  const exeName = `${productName} Setup ${nextVersion}.exe`;
  const blockmapName = `${exeName}.blockmap`;
  const stagingOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpres-release-'));

  try {
    console.log(`📦 Building Windows installer via staging dir: ${stagingOutDir}`);
    execSync('npm run build:icons', { cwd: appDir, stdio: 'inherit' });
    execSync('npm run build', { cwd: appDir, stdio: 'inherit' });
    execSync(`npx electron-builder --win nsis -c.directories.output="${stagingOutDir}"`, {
      cwd: appDir,
      stdio: 'inherit',
    });

    const stagedExe = path.join(stagingOutDir, exeName);
    const stagedBlockmap = path.join(stagingOutDir, blockmapName);
    if (!fs.existsSync(stagedExe)) {
      throw new Error(`Expected installer not found at: ${stagedExe}`);
    }

    // 4. Copy finished installer artifacts to installer/ (keeping only latest there) and versions/v<nextVersion>/
    fs.mkdirSync(installerDir, { recursive: true });
    for (const entry of fs.readdirSync(installerDir, { withFileTypes: true })) {
      if (entry.isFile() && (entry.name.endsWith('.exe') || entry.name.endsWith('.blockmap'))) {
        try {
          fs.rmSync(path.join(installerDir, entry.name), { force: true });
        } catch {
          // Best-effort cleanup of older duplicate installer artifacts in installer/
        }
      }
    }
    fs.copyFileSync(stagedExe, path.join(installerDir, exeName));
    if (fs.existsSync(stagedBlockmap)) {
      fs.copyFileSync(stagedBlockmap, path.join(installerDir, blockmapName));
    }
    for (const metaFile of ['latest.yml', 'builder-debug.yml']) {
      const stagedMeta = path.join(stagingOutDir, metaFile);
      if (fs.existsSync(stagedMeta)) {
        fs.copyFileSync(stagedMeta, path.join(installerDir, metaFile));
      }
    }

    const targetDir = path.join(versionsDir, `v${nextVersion}`);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.copyFileSync(stagedExe, path.join(targetDir, exeName));
    if (fs.existsSync(stagedBlockmap)) {
      fs.copyFileSync(stagedBlockmap, path.join(targetDir, blockmapName));
    }

    console.log(`\n✅ Archived installer to: ${path.relative(rootDir, targetDir)}\\${exeName}`);
  } finally {
    try {
      fs.rmSync(stagingOutDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 400 });
    } catch {
      // Best-effort cleanup of temp staging dir
    }
  }

  // 5. Commit & tag in Git if initialized (in appDir or rootDir)
  const gitCwd = fs.existsSync(path.join(appDir, '.git'))
    ? appDir
    : fs.existsSync(path.join(rootDir, '.git'))
      ? rootDir
      : null;

  if (gitCwd) {
    try {
      const pkgRel = path.relative(gitCwd, pkgPath);
      execSync(`git add "${pkgRel}"`, { cwd: gitCwd, stdio: 'inherit' });
      if (fs.existsSync(lockPath)) {
        const lockRel = path.relative(gitCwd, lockPath);
        execSync(`git add "${lockRel}"`, { cwd: gitCwd, stdio: 'inherit' });
      }
      for (const buildAsset of ['build/installerSidebar.bmp', 'build/icon.png', 'build/icon.ico']) {
        const assetAbs = path.join(appDir, buildAsset);
        if (fs.existsSync(assetAbs)) {
          const assetRel = path.relative(gitCwd, assetAbs);
          execSync(`git add "${assetRel}"`, { cwd: gitCwd, stdio: 'inherit' });
        }
      }
      execSync(`git commit -m "chore: release v${nextVersion}"`, { cwd: gitCwd, stdio: 'inherit' });
      execSync(`git tag -a "v${nextVersion}" -m "Release v${nextVersion}"`, { cwd: gitCwd, stdio: 'inherit' });
      console.log(`🏷️  Created git commit & tag: v${nextVersion}`);
    } catch (err) {
      console.warn(`⚠️  Git commit/tag skipped or failed: ${err.message}`);
    }
  }
}

main();
