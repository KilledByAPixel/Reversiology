// Which directories the build may empty and write into. `node tools/build.js
// --out <dir>` clears <dir> first, so a mistyped --out (".", "..", "src")
// would delete work. outputRefusal(root, out) says why <dir> is refused, or
// returns null when it's safe: dist/ under the repository, a directory that
// doesn't exist yet or is empty, or one a build wrote before (it holds the
// marker file every build writes).
import fs from 'node:fs';
import path from 'node:path';

export const MARKER = '.reversiology-build';
// What the build reads, and what must never be lost.
export const INPUT_DIRS = ['src', 'tools', 'test', 'weights', '.git', '.github', 'local'];

const inside = (dir, parent) => {
  const rel = path.relative(parent, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

export function outputRefusal(root, out) {
  root = path.resolve(root); out = path.resolve(out);
  if (out === path.join(root, 'dist')) return null;
  if (out === path.parse(out).root) return 'it is the root of a drive';
  if (inside(root, out)) return out === root ? 'it is the repository itself' : 'it holds the repository';
  for (const d of INPUT_DIRS) if (inside(out, path.join(root, d))) return `it is inside ${d}/, which the build reads or must keep`;
  if (!fs.existsSync(out)) return null;
  if (!fs.statSync(out).isDirectory()) return 'it is a file';
  const entries = fs.readdirSync(out);
  if (entries.length && !entries.includes(MARKER)) return 'it holds files a build didn\'t write (empty it first if they can go)';
  return null;
}
