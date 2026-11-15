import fs from 'node:fs';
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

  // 3. Build icons, app bundle, and NSIS installer
  console.log('📦 Building Windows installer (npm run dist:win)...');
  execSync('npm run dist:win', { cwd: appDir, stdio: 'inherit' });

  // 4. Archive installer into versions/v<nextVersion>/
  const productName = pkg.productName || 'Motion Presentation Studio';
  const exeName = `${productName} Setup ${nextVersion}.exe`;
  const blockmapName = `${exeName}.blockmap`;
  const exeSrc = path.join(installerDir, exeName);
  const blockmapSrc = path.join(installerDir, blockmapName);

  if (!fs.existsSync(exeSrc)) {
    throw new Error(`Expected installer not found at: ${exeSrc}`);
  }

  const targetDir = path.join(versionsDir, `v${nextVersion}`);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(exeSrc, path.join(targetDir, exeName));
  if (fs.existsSync(blockmapSrc)) {
    fs.copyFileSync(blockmapSrc, path.join(targetDir, blockmapName));
  }

  console.log(`\n✅ Archived installer to: ${path.relative(rootDir, targetDir)}\\${exeName}`);

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
