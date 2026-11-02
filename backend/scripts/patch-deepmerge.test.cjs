const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, dirname } = require('node:path');
const { test } = require('node:test');
const { patchDeepmerge } = require('./patch-deepmerge.cjs');
const patch = require('../patches/deepmerge-4.3.1.json');

function fixture(run) {
  const directory = mkdtempSync(resolve(tmpdir(), 'exchange-deepmerge-'));
  try {
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: 'deepmerge', version: '4.3.1' }));
    for (const file of patch.files) {
      let source = readFileSync(resolve(__dirname, '../node_modules/deepmerge', file.path), 'utf8');
      for (const replacement of [...patch.replacements].reverse()) {
        source = source.replace(replacement.after, replacement.before);
      }
      mkdirSync(dirname(resolve(directory, file.path)), { recursive: true });
      writeFileSync(resolve(directory, file.path), source);
    }
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('patches every entrypoint and is idempotent', () => {
  fixture((directory) => {
    const vulnerable = require(resolve(directory, 'dist/cjs.js'));
    assert.equal(vulnerable(Object.create(null), JSON.parse('{"__proto__":{"isAdmin":true}}')).isAdmin, true);
    assert.equal(patchDeepmerge(directory), 3);
    assert.equal(patchDeepmerge(directory), 0);
    delete require.cache[require.resolve(resolve(directory, 'dist/cjs.js'))];
    const fixed = require(resolve(directory, 'dist/cjs.js'));
    assert.equal(fixed(Object.create(null), JSON.parse('{"__proto__":{"isAdmin":true}}')).isAdmin, undefined);
  });
});

test('rejects modified source before writing any entrypoint', () => {
  fixture((directory) => {
    const first = readFileSync(resolve(directory, 'index.js'), 'utf8');
    writeFileSync(resolve(directory, 'dist/umd.js'), '// unknown source');
    assert.throws(() => patchDeepmerge(directory), /Unexpected deepmerge source/);
    assert.equal(readFileSync(resolve(directory, 'index.js'), 'utf8'), first);
  });
});

test('rejects unreviewed versions and permits omitted development dependencies', () => {
  fixture((directory) => {
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: 'deepmerge', version: '4.3.2' }));
    assert.throws(() => patchDeepmerge(directory), /installed version/);
    assert.equal(patchDeepmerge(resolve(directory, 'not-installed')), 0);
  });
});

for (const entrypoint of ['dist/cjs.js', 'dist/umd.js']) {
  test(`${entrypoint} rejects source and target prototype keys at every depth`, () => {
    const merge = require(resolve(__dirname, '../node_modules/deepmerge', entrypoint));
    const hostile = JSON.parse('{"__proto__":{"isAdmin":true},"constructor":{"prototype":{"isAdmin":true}},"prototype":{"isAdmin":true},"safe":1}');
    for (const value of [merge(Object.create(null), hostile), merge(hostile, {}), merge({ session: null }, { session: hostile }).session]) {
      assert.equal(Object.getPrototypeOf(value), Object.prototype);
      assert.equal(value.isAdmin, undefined);
      assert.equal(value.safe, 1);
      for (const key of ['__proto__', 'constructor', 'prototype']) assert.equal(Object.hasOwn(value, key), false);
    }
    assert.equal({}.isAdmin, undefined);
    const symbol = Symbol('kept');
    const original = { array: [1], nested: { x: 1 }, [symbol]: 1 };
    const result = merge(original, { array: [2], nested: { y: 2 } });
    assert.deepEqual(result.array, [1, 2]);
    assert.deepEqual(result.nested, { x: 1, y: 2 });
    assert.equal(result[symbol], 1);
    assert.deepEqual(original.array, [1]);
    assert.deepEqual(merge.all([{ x: 1 }, { y: 2 }]), { x: 1, y: 2 });
    assert.deepEqual(merge({ x: [1] }, { x: [2] }, { arrayMerge: (_, source) => source }), { x: [2] });
    assert.deepEqual(merge({ custom: { x: 1 } }, { custom: { y: 2 } }, {
      customMerge: (key) => key === 'custom' ? () => ({ merged: true }) : undefined,
    }), { custom: { merged: true } });
  });
}
