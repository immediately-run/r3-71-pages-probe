#!/usr/bin/env node
// Derive the R3-43 zip-integrity drill fixtures from this repo's genuine cache zip.
//
// R3-43 (D4.1) needs a Pages-hosted zip that FAILS the REPO_LIFECYCLE §3.4 integrity
// checks, so the live recovery path can be observed rather than reasoned about. The
// fixtures are derived here, in code, from the genuine zip — never hand-built and never
// committed as opaque binaries — so a reviewer can see exactly what was tampered with,
// and so they regenerate automatically when the repo changes.
//
// Two fixtures, each isolating ONE check. Isolation is the point: a zip that fails
// several legs at once cannot tell you which leg the host actually reacted to.
//
//   forged-entries.zip  — RL2-1, the entries↔tree binding.
//       A file's bytes are replaced AND its `entries[].sha` is updated to the true git
//       blob sha of the new bytes, so per-blob verification still PASSES. `treeSha` and
//       `commitSha` keep their genuine upstream values. The only thing that can catch
//       this is recomputing the root tree from `entries[]` — which is precisely the
//       check RL2-1 added after a forged-entries zip with real coordinates was found to
//       reach UP_TO_DATE with poisoned content.
//
//   extra-entry.zip     — RL2-2, the extra-entry rule.
//       An unlisted file is appended to the archive. Everything in `entries[]` is
//       genuine and verifies; the appended file is invisible to `entries[]`, would mount
//       and execute unchecked, and never appears in a contribute diff. The `.immediately.run/`
//       allowlist is deliberately avoided — a file placed there is exempt BY DESIGN, so
//       putting the fixture there would prove nothing.
//
// The sidecar `ref` is rewritten per fixture because the host rejects a zip whose sidecar
// coordinates disagree with the requested repo/ref ("invalid zip file: sidecar coordinates
// do not match"). That is a DIFFERENT check, and letting it fire first would mask the two
// under test — the coordinate guard would reject the zip before the tree/extra-entry legs
// ever ran. The branches themselves point at the same commit as main, so `commitSha` and
// `treeSha` stay honest.
//
// Usage: node scripts/make-integrity-fixtures.mjs <cacheDir>
//        where <cacheDir> already contains the genuine <defaultBranch>.zip.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const SIDECAR = '.immediately.run/contribute-manifest.json';

/** git's blob object id: sha1("blob <bytelength>\0" + bytes). */
const gitBlobSha = (buf) =>
  createHash('sha1')
    .update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf]))
    .digest('hex');

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' });

/** Unpack `zipPath` into a fresh temp dir and return it. */
const explode = (zipPath) => {
  const dir = mkdtempSync(join(tmpdir(), 'irfix-'));
  sh('unzip', ['-q', '-o', zipPath, '-d', dir]);
  return dir;
};

/** Re-zip `dir`'s contents into `outPath`. `-X` drops extra attributes so the
 *  output is a function of the inputs and not of the machine that built it.
 *  `outPath` is resolved to an ABSOLUTE path first: `zip` runs with cwd set to the
 *  exploded dir, so a relative one would land inside the temp dir. */
const rezip = (dir, outPath) => {
  const abs = resolve(outPath);
  rmSync(abs, { force: true });
  mkdirSync(dirname(abs), { recursive: true });
  sh('zip', ['-q', '-r', '-X', abs, '.'], dir);
};

const readSidecar = (dir) => JSON.parse(readFileSync(join(dir, SIDECAR), 'utf8'));
const writeSidecar = (dir, m) =>
  writeFileSync(join(dir, SIDECAR), JSON.stringify(m, null, 2) + '\n');

const cacheDir = process.argv[2];
if (!cacheDir) {
  console.error('usage: make-integrity-fixtures.mjs <cacheDir>');
  process.exit(2);
}

// The genuine zip is whichever one the cache step just produced.
const source = ['main', 'master'].map((b) => join(cacheDir, `${b}.zip`)).find(existsSync);
if (!source) {
  console.error(`no genuine cache zip found in ${cacheDir}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fixture 1 — forged entries (tree-binding mismatch, blob check still passes)
// ---------------------------------------------------------------------------
{
  const dir = explode(source);
  const m = readSidecar(dir);
  const target = 'src/App.tsx';
  const entry = m.entries.find((e) => e.path === target);
  if (!entry) {
    console.error(`fixture target ${target} is not in entries[] — pick another file`);
    process.exit(1);
  }

  // Visibly poisoned content: if the tree-binding check ever regressed, this string
  // renders on screen, so the drill has an unmistakable positive signal and not just
  // an absence of one.
  const poisoned = Buffer.from(
    `// R3-43 FIXTURE — forged-entries. This file is NOT what upstream contains.\n` +
      `// If you can see this rendering, the entries<->tree binding (RL2-1) did not fire.\n` +
      readFileSync(join(dir, target), 'utf8'),
  );
  writeFileSync(join(dir, target), poisoned);

  // The forgery: entries[] is made SELF-CONSISTENT with the poisoned bytes, so blob
  // verification passes. treeSha/commitSha are left genuine — that inconsistency is
  // the whole attack, and the recomputed root tree is the only thing that sees it.
  entry.sha = gitBlobSha(poisoned);
  entry.size = poisoned.length;
  m.ref = 'forged-entries';
  writeSidecar(dir, m);

  rezip(dir, join(cacheDir, 'forged-entries.zip'));
  rmSync(dir, { recursive: true, force: true });
  console.log(`forged-entries.zip: ${target} repointed to ${entry.sha} (treeSha ${m.treeSha} untouched)`);
}

// ---------------------------------------------------------------------------
// Fixture 2 — an unlisted extra entry
// ---------------------------------------------------------------------------
{
  const dir = explode(source);
  const m = readSidecar(dir);
  const extra = 'src/unlisted-injection.tsx';

  writeFileSync(
    join(dir, extra),
    `// R3-43 FIXTURE — extra-entry. This file is in the ZIP but NOT in entries[].\n` +
      `// It is outside the .immediately.run/ allowlist on purpose: that prefix is exempt\n` +
      `// by design, so a fixture placed there would prove nothing.\n` +
      `export const UNLISTED = true;\n`,
  );
  if (m.entries.some((e) => e.path === extra)) {
    console.error('the extra entry must NOT be listed — fixture is void');
    process.exit(1);
  }
  m.ref = 'extra-entry';
  writeSidecar(dir, m);

  rezip(dir, join(cacheDir, 'extra-entry.zip'));
  rmSync(dir, { recursive: true, force: true });
  console.log(`extra-entry.zip: added ${extra}, absent from entries[] (${m.entries.length} listed)`);
}
