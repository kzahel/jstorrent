import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hash = value => createHash('sha256').update(value).digest('hex');
const read = (root, name) => readFileSync(resolve(root, name), 'utf8');
function item(source, name) {
  const start = source.indexOf(`fn ${name}(`);
  const end = source.indexOf('\n}', start);
  if (start < 0 || end < 0) throw new Error(`Missing migration ${name}`);
  return source.slice(start, end + 2);
}
function constant(source, name) {
  const start = source.indexOf(`const ${name}:`);
  const end = source.indexOf(';\n', start);
  if (start < 0 || end < 0) throw new Error(`Missing schema constant ${name}`);
  return source.slice(start, end + 1);
}
const beforeTests = text => text.split('#[cfg(test)]')[0];
export function databaseCompatibility(root) {
  const session = read(root, 'crates/rstorrent-session/src/store_migration.rs');
  const product = read(root, 'crates/rstorrent-session/src/product_state.rs');
  const speed = read(root, 'crates/rstorrent-session/src/speed.rs');
  function store(floor, units) {
    let prefix = '';
    const lineage = {};
    for (const [version, unit] of units) {
      prefix = hash(Buffer.concat([Buffer.from(`${prefix}\n`), Buffer.isBuffer(unit) ? unit : Buffer.from(unit)]));
      lineage[version] = prefix;
    }
    return { floor, target: Number(Object.keys(lineage).at(-1)), lineage };
  }
  const stores = {
    session: store(26, [
      [26, readFileSync(resolve(root, 'crates/rstorrent-session/tests/fixtures/catalog/v26.sqlite'))],
      [27, item(session, 'migrate_26_to_27') + constant(session, 'SEED_STOP_SETTINGS_COLUMNS_27')],
      [28, item(session, 'migrate_27_to_28') + constant(session, 'NETWORK_DEFAULTS_COLUMN_28')],
      [29, item(session, 'migrate_28_to_29') + beforeTests(read(root, 'crates/rstorrent-session/src/store/file_state.rs')) + beforeTests(read(root, 'crates/rstorrent-session/src/store/safety.rs'))],
    ]),
    product: store(2, [
      [2, readFileSync(resolve(root, 'crates/rstorrent-session/tests/fixtures/product/v2.sqlite'))],
      [3, item(product, 'migrate_product_2_to_3')],
      [4, item(product, 'migrate_product_3_to_4')],
    ]),
    metrics: store(1, [[1, item(speed, 'migrate_metrics')]]),
  };
  for (const [name, source, marker] of [
    ['session', read(root, 'crates/rstorrent-session/src/store_schema.rs'), 'SCHEMA_VERSION'],
    ['product', product, 'PRODUCT_SCHEMA_VERSION'], ['metrics', speed, 'METRICS_SCHEMA_VERSION'],
  ]) {
    const version = Number(new RegExp(`const ${marker}: i64 = (\\d+);`).exec(source)?.[1]);
    if (version !== stores[name].target) throw new Error(`${name}: register every migration in desktop-compatibility.mjs`);
  }
  return { schemaVersion: 1, stores };
}
export function assertForwardCompatibility(previous, next) {
  for (const [name, old] of Object.entries(previous.stores)) {
    const current = next.stores[name];
    if (!current || current.floor > old.floor || current.target < old.target) throw new Error(`${name}: lost released database support`);
    for (const [version, digest] of Object.entries(old.lineage)) {
      if (current.lineage[version] !== digest) throw new Error(`${name}: changed released migration ${version}`);
    }
  }
}
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = resolve(root, 'distribution/desktop-compatibility.json');
  const generated = `${JSON.stringify(databaseCompatibility(root), null, 2)}\n`;
  if (process.argv.includes('--write')) writeFileSync(path, generated);
  else if (readFileSync(path, 'utf8') !== generated) throw new Error('Regenerate database compatibility with --write; review migration prefix changes');
}
