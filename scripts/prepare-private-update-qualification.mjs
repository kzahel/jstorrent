import { readFileSync,writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
/** Nonshipping source overlay, applied only inside private CI working copies. */
export function qualificationSources(migration,schema,generator,automatic) {
  const replace=(source,from,to)=>{if(!source.includes(from))throw new Error('Qualification source changed; review overlay');return source.replace(from,to);};
  migration=replace(migration,
    'const MIGRATION_STEPS: &[MigrationStep] = &[migrate_26_to_27, migrate_27_to_28, migrate_28_to_29];',
    `const MIGRATION_STEPS: &[MigrationStep] = &[
    migrate_26_to_27,
    migrate_27_to_28,
    migrate_28_to_29,
    migrate_29_to_30,
];`);
  migration+=`
// Private Tactical 377 probe; never part of shipping schema history.
fn migrate_29_to_30(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    let populated: bool =
        transaction.query_row("SELECT EXISTS(SELECT 1 FROM torrents)", [], |row| {
            row.get(0)
        })?;
    transaction.execute_batch(
        "CREATE TABLE qualification_update_probe (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), marker TEXT NOT NULL, payload BLOB NOT NULL);",
    )?;
    transaction.execute(
        "INSERT INTO qualification_update_probe VALUES (1, 'tactical-377', zeroblob(?1))",
        [if populated { 8 * 1024 * 1024_i64 } else { 0 }],
    )?;
    if populated {
        std::thread::sleep(std::time::Duration::from_secs(10));
    }
    Ok(())
}
`;
  schema=replace(schema,'const SCHEMA_VERSION: i64 = 29;','const SCHEMA_VERSION: i64 = 30;');
  generator=replace(generator,"    ]),\n    product: store", "      [30, item(session, 'migrate_29_to_30')],\n    ]),\n    product: store");
  // Production candidates already use the ordinary server rollout gate.
  if(!automatic.includes('qualification_available(app) || app.config().identifier == "com.jstorrent.desktop"'))throw new Error('Review private qualification rollout policy');
  return {migration,schema,generator,automatic};
}
let isMain = false;
try { isMain = realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url); } catch {}
if (isMain) {
 if(process.env.JSTORRENT_PRIVATE_UPDATE_QUALIFICATION!=='true')throw new Error('Explicit private CI qualification authority required');
 const root=resolve(import.meta.dirname,'..');
 const paths={migration:'crates/rstorrent-session/src/store_migration.rs',schema:'crates/rstorrent-session/src/store_schema.rs',generator:'scripts/desktop-compatibility.mjs',automatic:'clients/desktop/src-tauri/src/automatic_updates.rs'};
 const originals=Object.fromEntries(Object.entries(paths).map(([k,p])=>[k,readFileSync(resolve(root,p),'utf8').replace(/\r\n/g,'\n')]));
 const modified=qualificationSources(originals.migration,originals.schema,originals.generator,originals.automatic);
 const receipt={privateQualification:true,sessionSchema:30,stableEnabled:true,files:{}};
 for(const [key,path]of Object.entries(paths)){writeFileSync(resolve(root,path),modified[key]);receipt.files[path]={original:createHash('sha256').update(originals[key]).digest('hex'),qualified:createHash('sha256').update(modified[key]).digest('hex')};}
 execFileSync(process.execPath,[resolve(root,'scripts/desktop-compatibility.mjs'),'--write'],{stdio:'inherit'});
 writeFileSync(resolve(root,'distribution/private-update-qualification.json'),JSON.stringify(receipt,null,2)+'\n');
}
