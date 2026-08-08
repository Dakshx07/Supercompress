#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function readJson(relPath) {
  const fullPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

console.log('🔍 Checking version consistency across SuperCompress packages...');

let hasErrors = false;

// 1. Read packages/proxy/package.json
const proxyPkg = readJson('packages/proxy/package.json');
if (!proxyPkg) {
  console.error('❌ Could not find packages/proxy/package.json');
  process.exit(1);
}

const proxyVersion = proxyPkg.version;
console.log(`📦 packages/proxy/package.json version: ${proxyVersion}`);

// 2. Check packages/proxy/package-lock.json
const proxyLock = readJson('packages/proxy/package-lock.json');
if (proxyLock) {
  if (proxyLock.version !== proxyVersion) {
    console.error(`❌ Mismatch: packages/proxy/package-lock.json version (${proxyLock.version}) does not match package.json (${proxyVersion})`);
    hasErrors = true;
  } else {
    console.log(`✅ packages/proxy/package-lock.json version matches (${proxyLock.version})`);
  }
}

// 3. Check root package.json dependency on supercompress-proxy
const rootPkg = readJson('package.json');
if (rootPkg && rootPkg.dependencies && rootPkg.dependencies['supercompress-proxy']) {
  const rootDepRange = rootPkg.dependencies['supercompress-proxy'];
  console.log(`📌 Root package.json supercompress-proxy dependency: ${rootDepRange}`);

  // Extract major.minor from proxy version (e.g. 0.5 from 0.5.12)
  const proxyMajorMinor = proxyVersion.split('.').slice(0, 2).join('.');
  
  // Extract numbers from range (e.g. ^0.4.0 -> 0.4)
  const match = rootDepRange.match(/(\d+\.\d+)/);
  if (match) {
    const rootDepMajorMinor = match[1];
    if (rootDepMajorMinor !== proxyMajorMinor) {
      console.error(`❌ Mismatch: Root package.json pins supercompress-proxy to '${rootDepRange}' (major.minor ${rootDepMajorMinor}) but packages/proxy is at '${proxyVersion}' (major.minor ${proxyMajorMinor})`);
      hasErrors = true;
    } else {
      console.log(`✅ Root package.json dependency range matches proxy major.minor (${proxyMajorMinor})`);
    }
  }
}

// 4. Check root package-lock.json if present
const rootLock = readJson('package-lock.json');
if (rootLock) {
  if (rootLock.packages && rootLock.packages['node_modules/supercompress-proxy']) {
    const lockedDep = rootLock.packages['node_modules/supercompress-proxy'];
    if (lockedDep.version && lockedDep.version !== proxyVersion) {
      console.error(`❌ Mismatch: Root package-lock.json has supercompress-proxy locked to ${lockedDep.version}, expected ${proxyVersion}`);
      hasErrors = true;
    } else {
      console.log(`✅ Root package-lock.json has supercompress-proxy locked to ${proxyVersion}`);
    }
  }
}

if (hasErrors) {
  console.error('\n❌ Version consistency check failed!');
  process.exit(1);
} else {
  console.log('\n🎉 All version consistency checks passed successfully!');
}
