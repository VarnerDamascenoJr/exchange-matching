const { createHash } = require('node:crypto');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const patch = require('../patches/deepmerge-4.3.1.json');

const sha256 = (source) => createHash('sha256').update(source).digest('hex');

// No fixed upstream release exists. Preserve the API used by Jest and webpack,
// and reject an unknown package or source rather than silently skipping the fix.
function patchDeepmerge(directory = resolve(__dirname, '../node_modules/deepmerge')) {
  if (!existsSync(directory)) return 0; // Dev dependency omitted in production.
  const installed = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  if (installed.name !== 'deepmerge' || installed.version !== patch.version) {
    throw new Error('Review the deepmerge security patch for the installed version');
  }

  // Validate every entrypoint before writing any file. Repeated installs are safe.
  const updates = patch.files.flatMap((file) => {
    const filename = resolve(directory, file.path);
    let source = readFileSync(filename, 'utf8');
    const hash = sha256(source);
    if (hash === file.patchedSha256) return [];
    if (hash !== file.originalSha256) {
      throw new Error(`Unexpected deepmerge source: ${file.path}`);
    }
    for (const replacement of patch.replacements) {
      if (source.split(replacement.before).length !== 2) {
        throw new Error(`Unexpected deepmerge patch context: ${file.path}`);
      }
      source = source.replace(replacement.before, replacement.after);
    }
    if (sha256(source) !== file.patchedSha256) {
      throw new Error(`Unexpected deepmerge patch result: ${file.path}`);
    }
    return [{ filename, source }];
  });
  for (const { filename, source } of updates) writeFileSync(filename, source);
  return updates.length;
}

module.exports = { patchDeepmerge };
if (require.main === module) {
  console.log(`Deepmerge security patch: ${patchDeepmerge()} entrypoints updated`);
}
