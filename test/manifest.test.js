// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest itself is validated by the store indexer; these tests tie it
// to what the code expects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));

test('the manifest, package.json and the image tag carry the same version', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('config_schema and DEFAULT_CONFIG describe the same keys and defaults', () => {
  const fields = manifest.config_schema.filter((field) => field.type !== 'section');
  assert.deepEqual(fields.map((field) => field.key).sort(), Object.keys(DEFAULT_CONFIG).sort());
  for (const field of fields) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of ${field.key}`);
    }
  }
});

test('every manifest text is bilingual', () => {
  const texts = [manifest.description];
  for (const field of manifest.config_schema) {
    texts.push(field.label, field.description, field.placeholder);
    for (const link of field.links ?? []) {
      texts.push(link.label);
    }
  }
  for (const text of texts.filter(Boolean)) {
    assert.ok(text.en && text.fr, `missing translation in ${JSON.stringify(text)}`);
  }
  for (const text of Object.values(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100);
  }
});

test('the user documentation exists in both languages (300 characters minimum)', async () => {
  for (const language of ['en', 'fr']) {
    assert.ok((await read(`../docs/${language}.md`)).length >= 300);
  }
});
