#!/usr/bin/env node
/**
 * openspec-sync — coordinate change folders across paired OpenSpec repos.
 *
 * Sibling repo location is read from openspec/sibling.json relative to the
 * repo root, or overridden via the OPENSPEC_SIBLING environment variable
 * (which CI uses to point at a sibling checkout).
 *
 * Commands:
 *   propose <change-id> [--no-pair]
 *     Scaffold a new change folder locally and, by default, an identically-
 *     named one in the sibling repo with reciprocal linkage.
 *
 *   pair <change-id> [--role consumer|producer]
 *     Add an openspec.link.json to an existing local change, declaring the
 *     sibling repo's matching change as its partner. Writes the reciprocal
 *     file on the sibling side.
 *
 *   check
 *     Validates linkage and shared-capability reference stubs. Exits non-zero
 *     on error. Safe to run in CI.
 *
 *   archive <change-id> [--force]
 *     Moves the change folder to changes/archive/YYYY-MM-DD-<id>/ in both
 *     repos. Refuses while tasks.md still has unchecked items unless --force.
 *     Does NOT merge delta specs — that step belongs to `openspec apply` or
 *     manual merging. This script handles only cross-repo coordination.
 *
 *   list
 *     Lists in-flight changes locally with linkage status.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const OPENSPEC = path.join(ROOT, 'openspec');
const CHANGES = path.join(OPENSPEC, 'changes');
const SPECS = path.join(OPENSPEC, 'specs');
const SIBLING_CONFIG = path.join(OPENSPEC, 'sibling.json');
const LINK_FILE = 'openspec.link.json';

const FG = {
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
  reset: '\x1b[0m', dim: '\x1b[2m',
};
const ok   = (s) => console.log(`${FG.green}✓${FG.reset} ${s}`);
const warn = (s) => console.log(`${FG.yellow}!${FG.reset} ${s}`);
const fail = (s) => console.log(`${FG.red}✗${FG.reset} ${s}`);
const info = (s) => console.log(`${FG.cyan}›${FG.reset} ${s}`);
const dim  = (s) => console.log(`${FG.dim}${s}${FG.reset}`);

function loadSibling() {
  if (process.env.OPENSPEC_SIBLING) {
    const repo = path.resolve(process.env.OPENSPEC_SIBLING);
    return { name: path.basename(repo), repo };
  }
  if (!fs.existsSync(SIBLING_CONFIG)) {
    throw new Error(`Missing ${path.relative(ROOT, SIBLING_CONFIG)} — create it or set OPENSPEC_SIBLING.`);
  }
  const cfg = JSON.parse(fs.readFileSync(SIBLING_CONFIG, 'utf8'));
  const repo = path.resolve(ROOT, cfg.repo);
  if (!fs.existsSync(path.join(repo, 'openspec'))) {
    throw new Error(`Sibling repo at ${repo} has no openspec/ directory.`);
  }
  return { name: cfg.name ?? path.basename(repo), repo };
}

const sibChanges = (sib) => path.join(sib.repo, 'openspec', 'changes');
const sibSpecs   = (sib) => path.join(sib.repo, 'openspec', 'specs');

function isValidChangeId(id) {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(id);
}

function relFromTo(fromAbs, toAbs) {
  return path.relative(fromAbs, toAbs).split(path.sep).join('/');
}

// ─── Templates ───────────────────────────────────────────────────────────

const proposalTemplate = (id, sibling) => `# ${id}

## Why
<one paragraph: why this change is needed now>

## What changes
- <capability>: ADDED / MODIFIED / REMOVED — summary

## Impacted capabilities
- \`<capability>\` (ADDED | MODIFIED | REMOVED)

## Out of scope
- <bullet>

## Cross-repo
Paired with \`${sibling.name}/openspec/changes/${id}/\`. See \`openspec.link.json\` for the linkage record.
`;

const tasksTemplate = (id) => `# Tasks — ${id}

## Implementation
- [ ] <step>

## Tests
- [ ] <step>

## Cross-repo handoff
- [ ] Ensure the sibling change is deployable (or feature-flagged) before merging this side.
- [ ] Archive both change folders the same day.
`;

function writeLink(linkPath, partnerRepoAbs, partnerName, partnerChangeId, role) {
  const linkDirAbs = path.dirname(linkPath);
  // store the partner repo path as relative to *this* repo's root for portability
  const repoRoot = path.resolve(linkDirAbs, '..', '..', '..'); // changes/<id>/openspec.link.json → repo root
  const relRepo = relFromTo(repoRoot, partnerRepoAbs);
  const body = {
    crossRepo: [{ repo: relRepo, name: partnerName, changeId: partnerChangeId, role }],
  };
  fs.writeFileSync(linkPath, JSON.stringify(body, null, 2) + '\n');
}

// ─── Commands ────────────────────────────────────────────────────────────

function cmdPropose(args) {
  const id = args[0];
  const noPair = args.includes('--no-pair');
  if (!id) throw new Error('Usage: propose <change-id> [--no-pair]');
  if (!isValidChangeId(id)) throw new Error(`Invalid change id: ${id} (must be kebab-case, verb-first)`);

  const localDir = path.join(CHANGES, id);
  if (fs.existsSync(localDir)) throw new Error(`Local change folder already exists: ${path.relative(ROOT, localDir)}`);

  const sibling = noPair ? null : loadSibling();
  if (sibling) {
    const sibDir = path.join(sibChanges(sibling), id);
    if (fs.existsSync(sibDir)) throw new Error(`Sibling change folder already exists: ${path.relative(ROOT, sibDir)}`);
  }

  fs.mkdirSync(path.join(localDir, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(localDir, 'proposal.md'), proposalTemplate(id, sibling ?? { name: '<sibling>' }));
  fs.writeFileSync(path.join(localDir, 'tasks.md'), tasksTemplate(id));
  if (sibling) {
    writeLink(path.join(localDir, LINK_FILE), sibling.repo, sibling.name, id, 'producer');
  }
  ok(`Scaffolded ${path.relative(ROOT, localDir)}`);

  if (sibling) {
    const sibDir = path.join(sibChanges(sibling), id);
    fs.mkdirSync(path.join(sibDir, 'specs'), { recursive: true });
    const self = { name: path.basename(ROOT), repo: ROOT };
    fs.writeFileSync(path.join(sibDir, 'proposal.md'), proposalTemplate(id, self));
    fs.writeFileSync(path.join(sibDir, 'tasks.md'), tasksTemplate(id));
    writeLink(path.join(sibDir, LINK_FILE), ROOT, self.name, id, 'consumer');
    ok(`Scaffolded ${sibling.name}:${path.relative(sibling.repo, sibDir)}`);
  }

  info('Next: edit proposal.md, tasks.md, and add delta specs under specs/<capability>/spec.md.');
}

function cmdPair(args) {
  const id = args[0];
  const roleIdx = args.indexOf('--role');
  const role = roleIdx >= 0 ? args[roleIdx + 1] : 'producer';
  if (!id) throw new Error('Usage: pair <change-id> [--role consumer|producer]');
  if (!['producer', 'consumer'].includes(role)) throw new Error(`role must be producer or consumer`);

  const localDir = path.join(CHANGES, id);
  if (!fs.existsSync(localDir)) throw new Error(`Local change folder missing: ${path.relative(ROOT, localDir)}`);

  const sibling = loadSibling();
  const sibDir = path.join(sibChanges(sibling), id);
  if (!fs.existsSync(sibDir)) throw new Error(`Sibling change folder missing: ${path.relative(ROOT, sibDir)} — create it first with \`propose ${id} --no-pair\``);

  writeLink(path.join(localDir, LINK_FILE), sibling.repo, sibling.name, id, role);
  writeLink(path.join(sibDir, LINK_FILE), ROOT, path.basename(ROOT), id, role === 'producer' ? 'consumer' : 'producer');
  ok(`Linked ${id} between ${path.basename(ROOT)} (${role}) and ${sibling.name} (${role === 'producer' ? 'consumer' : 'producer'})`);
}

function cmdList() {
  if (!fs.existsSync(CHANGES)) { dim('No changes/ directory yet.'); return; }
  const entries = fs.readdirSync(CHANGES, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== 'archive');
  if (entries.length === 0) { dim('No in-flight changes.'); return; }

  for (const e of entries) {
    const linkPath = path.join(CHANGES, e.name, LINK_FILE);
    if (!fs.existsSync(linkPath)) {
      info(`${e.name}  ${FG.dim}(unpaired — repo-local)${FG.reset}`);
      continue;
    }
    const link = JSON.parse(fs.readFileSync(linkPath, 'utf8'));
    for (const partner of link.crossRepo ?? []) {
      const partnerDir = path.join(path.resolve(ROOT, partner.repo), 'openspec', 'changes', partner.changeId);
      const exists = fs.existsSync(partnerDir);
      const status = exists ? `${FG.green}OK${FG.reset}` : `${FG.red}MISSING${FG.reset}`;
      info(`${e.name}  ↔  ${partner.name}:${partner.changeId}  [${status}]`);
    }
  }
}

function cmdCheck() {
  let errors = 0;
  let warnings = 0;
  let checked = 0;

  // 1. Linkage check — every in-flight change folder
  if (fs.existsSync(CHANGES)) {
    const entries = fs.readdirSync(CHANGES, { withFileTypes: true }).filter(e => e.isDirectory() && e.name !== 'archive');
    for (const e of entries) {
      const linkPath = path.join(CHANGES, e.name, LINK_FILE);
      if (!fs.existsSync(linkPath)) {
        warn(`${e.name}: no ${LINK_FILE} — change is repo-local`);
        warnings++;
        continue;
      }
      let link;
      try { link = JSON.parse(fs.readFileSync(linkPath, 'utf8')); }
      catch (err) { fail(`${e.name}: ${LINK_FILE} is invalid JSON: ${err.message}`); errors++; continue; }

      for (const partner of link.crossRepo ?? []) {
        const partnerRepoAbs = path.resolve(ROOT, partner.repo);
        const partnerDir = path.join(partnerRepoAbs, 'openspec', 'changes', partner.changeId);
        if (!fs.existsSync(partnerDir)) {
          fail(`${e.name}: partner ${partner.name}:${partner.changeId} missing at ${path.relative(ROOT, partnerDir)}`);
          errors++;
          continue;
        }
        const reversePath = path.join(partnerDir, LINK_FILE);
        if (!fs.existsSync(reversePath)) {
          fail(`${e.name}: partner ${partner.name}:${partner.changeId} has no ${LINK_FILE}`);
          errors++;
          continue;
        }
        const reverse = JSON.parse(fs.readFileSync(reversePath, 'utf8'));
        const backLink = (reverse.crossRepo ?? []).find(p => p.changeId === e.name);
        if (!backLink) {
          fail(`${e.name}: partner ${partner.name}:${partner.changeId} does not link back to ${e.name}`);
          errors++;
          continue;
        }
        ok(`${e.name} ↔ ${partner.name}:${partner.changeId}`);
        checked++;
      }
    }
  }

  // 2. Reference-stub check — every spec.md that declares a source-of-truth pointer
  if (fs.existsSync(SPECS)) {
    const capabilities = fs.readdirSync(SPECS, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const cap of capabilities) {
      const specPath = path.join(SPECS, cap.name, 'spec.md');
      if (!fs.existsSync(specPath)) continue;
      const content = fs.readFileSync(specPath, 'utf8');
      const m = content.match(/^>\s*\*\*Source of truth:\*\*\s*`([^`]+)`/m);
      if (!m) continue;
      const target = path.resolve(path.dirname(specPath), m[1]);
      if (!fs.existsSync(target)) {
        fail(`spec/${cap.name}: source-of-truth path missing: ${m[1]}`);
        errors++;
      } else {
        ok(`spec/${cap.name} stub → ${path.relative(ROOT, target)}`);
        checked++;
      }
    }
  }

  if (errors > 0) {
    fail(`${errors} error(s), ${warnings} warning(s), ${checked} OK`);
    process.exit(1);
  }
  ok(`${checked} OK${warnings > 0 ? `, ${warnings} warning(s)` : ''}`);
}

function hasUncheckedTask(tasksPath) {
  if (!fs.existsSync(tasksPath)) return false;
  return /^\s*-\s+\[\s\]/m.test(fs.readFileSync(tasksPath, 'utf8'));
}

function cmdArchive(args) {
  const id = args[0];
  const force = args.includes('--force');
  if (!id) throw new Error('Usage: archive <change-id> [--force]');

  const localDir = path.join(CHANGES, id);
  if (!fs.existsSync(localDir)) throw new Error(`No such change: ${id}`);
  if (hasUncheckedTask(path.join(localDir, 'tasks.md')) && !force) {
    throw new Error(`Local tasks.md has unchecked items — pass --force to archive anyway`);
  }

  const date = new Date().toISOString().slice(0, 10);
  const archiveDir = path.join(CHANGES, 'archive', `${date}-${id}`);

  let sibling = null, sibDir = null, sibArchive = null;
  const linkPath = path.join(localDir, LINK_FILE);
  if (fs.existsSync(linkPath)) {
    const link = JSON.parse(fs.readFileSync(linkPath, 'utf8'));
    const partner = (link.crossRepo ?? [])[0];
    if (partner) {
      sibling = { name: partner.name, repo: path.resolve(ROOT, partner.repo) };
      sibDir = path.join(sibChanges(sibling), partner.changeId);
      if (!fs.existsSync(sibDir)) throw new Error(`Sibling change folder missing: ${path.relative(ROOT, sibDir)}`);
      if (hasUncheckedTask(path.join(sibDir, 'tasks.md')) && !force) {
        throw new Error(`Sibling tasks.md has unchecked items — pass --force to archive anyway`);
      }
      sibArchive = path.join(sibChanges(sibling), 'archive', `${date}-${partner.changeId}`);
    }
  }

  fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
  fs.renameSync(localDir, archiveDir);
  ok(`Archived ${path.relative(ROOT, archiveDir)}`);

  if (sibDir) {
    fs.mkdirSync(path.dirname(sibArchive), { recursive: true });
    fs.renameSync(sibDir, sibArchive);
    ok(`Archived ${sibling.name}:${path.relative(sibling.repo, sibArchive)}`);
  }

  warn(`Reminder: delta specs were NOT merged into specs/ automatically. Run \`openspec apply\` (CLI) or merge ADDED/MODIFIED/REMOVED sections by hand.`);
}

// ─── Entrypoint ──────────────────────────────────────────────────────────

const [cmd, ...rest] = process.argv.slice(2);

try {
  switch (cmd) {
    case 'propose': cmdPropose(rest); break;
    case 'pair':    cmdPair(rest); break;
    case 'check':   cmdCheck(); break;
    case 'archive': cmdArchive(rest); break;
    case 'list':    cmdList(); break;
    default:
      console.log(`openspec-sync — cross-repo OpenSpec coordination

Commands:
  propose <change-id> [--no-pair]              Create matching change folders in both repos
  pair <change-id> [--role producer|consumer]  Link an existing change to its sibling
  check                                        Validate linkage and reference stubs (CI-safe)
  archive <change-id> [--force]                Archive change in both repos
  list                                         Show in-flight changes with linkage status

Sibling repo: openspec/sibling.json (override with OPENSPEC_SIBLING env var).
`);
  }
} catch (err) {
  fail(err.message);
  process.exit(1);
}
