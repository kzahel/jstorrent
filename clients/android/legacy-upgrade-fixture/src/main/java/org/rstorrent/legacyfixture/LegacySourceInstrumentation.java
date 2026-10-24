package org.rstorrent.legacyfixture;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.Intent;
import android.content.UriPermission;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.os.Bundle;
import android.os.Process;
import android.provider.DocumentsContract;
import android.util.Base64;
import java.io.File;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Independently authored test data. Only the released picker writes roots/grants. */
public final class LegacySourceInstrumentation extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle();
        try { seed(); result.putString("legacy_seed", "passed"); finish(Activity.RESULT_OK, result); }
        catch (Throwable error) { result.putString("legacy_seed", "failed: " + android.util.Log.getStackTraceString(error)); finish(Activity.RESULT_CANCELED, result); }
    }
    private static void require(boolean condition) { if (!condition) throw new AssertionError("legacy fixture prerequisite failed"); }
    private static byte[] bytes(String value) { return value.getBytes(StandardCharsets.UTF_8); }
    private static byte[] digest(String algorithm, byte[] value) throws Exception { return MessageDigest.getInstance(algorithm).digest(value); }
    private static String hex(byte[] value) { StringBuilder output = new StringBuilder(); for (byte part : value) output.append(String.format("%02x", part)); return output.toString(); }
    private static byte[] concat(byte[]... values) throws Exception { java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream(); for (byte[] value : values) out.write(value); return out.toByteArray(); }
    private static void write(File file, byte[] value) throws Exception { File parent = file.getParentFile(); require(parent.mkdirs() || parent.isDirectory()); Files.write(file.toPath(), value); }
    private static void put(SQLiteDatabase database, String key, String value) { database.execSQL("INSERT OR REPLACE INTO kv(key,value) VALUES (?,?)", new Object[]{key,value}); }

    private void seed() throws Exception {
        Context context = getTargetContext();
        require(context.getPackageName().equals("com.jstorrent.app"));
        require(context.getPackageManager().getPackageInfo(context.getPackageName(),0).getLongVersionCode() == 24);
        List<UriPermission> grants = context.getContentResolver().getPersistedUriPermissions();
        require(grants.size() == 1 && grants.get(0).isReadPermission() && grants.get(0).isWritePermission());
        Uri tree = grants.get(0).getUri();
        File rootsFile = new File(context.getFilesDir(), "roots.json");
        JSONArray roots = new JSONObject(new String(Files.readAllBytes(rootsFile.toPath()),StandardCharsets.UTF_8)).getJSONArray("roots");
        require(roots.length() == 1 && roots.getJSONObject(0).getString("uri").equals(tree.toString()));
        String rootKey = roots.getJSONObject(0).getString("key");
        byte[] payload = new byte[16384]; Arrays.fill(payload,(byte)37);
        JSONArray index = new JSONArray();
        File databaseFile = context.getDatabasePath("jstorrent_kv.db");
        require(databaseFile.getParentFile().mkdirs() || databaseFile.getParentFile().isDirectory());
        try (SQLiteDatabase database = SQLiteDatabase.openOrCreateDatabase(databaseFile,null)) {
            database.execSQL("CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT)"); database.setVersion(1);
            database.beginTransaction();
            try {
                Uri documentRoot = DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
                String[] names = {"intact.bin","corrupt.bin","private.bin","held.bin"};
                for (int ordinal=0; ordinal<names.length; ordinal++) {
                    String name=names[ordinal];
                    byte[] info=concat(bytes("d6:lengthi16384e4:name" + bytes(name).length + ":" + name + "12:piece lengthi16384e6:pieces20:"), digest("SHA-1",payload), bytes("7:privatei1ee"));
                    String hash=hex(digest("SHA-1",info));
                    index.put(new JSONObject().put("infoHash",hash).put("source","file").put("addedAt",ordinal));
                    put(database,"session:torrent:"+hash+":state",new JSONObject().put("storageKey",name.equals("private.bin")?"default":rootKey).put("userState",name.equals("held.bin")?"awaitingFileSelection":"stopped").put("filePriorities",new JSONArray().put(name.equals("held.bin")?1:0)).put("bitfield","80").put("pieceCount",1).put("uploaded",999).put("downloaded",999).toString());
                    put(database,"session:torrent:"+hash+":torrentfile",JSONObject.quote(Base64.encodeToString(concat(bytes("d4:info"),info,bytes("e")),Base64.NO_WRAP)));
                    byte[] content=payload;
                    if (name.equals("corrupt.bin")) { content=payload.clone(); Arrays.fill(content,(byte)38); }
                    if (name.equals("private.bin")) write(new File(context.getFilesDir(),"downloads/"+name),content);
                    else {
                        Uri document=DocumentsContract.createDocument(context.getContentResolver(),documentRoot,"application/octet-stream",name); require(document != null);
                        try (OutputStream output=context.getContentResolver().openOutputStream(document,"wt")) { require(output != null); output.write(content); }
                    }
                }
                String pending="1111111111111111111111111111111111111111";
                index.put(new JSONObject().put("infoHash",pending).put("source","magnet").put("magnetUri","magnet:?xt=urn:btih:"+pending));
                put(database,"session:torrent:"+pending+":state",new JSONObject().put("storageKey",rootKey).put("userState","stopped").put("magnetSelectOnly",new JSONArray()).toString());
                put(database,"session:torrents",new JSONObject().put("version",2).put("torrents",index).toString());
                String[][] configs={{"dhtEnabled","false"},{"pexEnabled","false"},{"maxGlobalPeers","77"},{"activeDownloads","3"},{"activeSeeds","4"},{"encryptionPolicy","\"required\""},{"uploadSpeedUnlimited","false"},{"uploadSpeedLimit","12345"},{"downloadSpeedUnlimited","false"},{"downloadSpeedLimit","23456"},{"defaultRootKey",JSONObject.quote(rootKey)}};
                for(String[] config:configs) put(database,"config:"+config[0],config[1]);
                database.setTransactionSuccessful();
            } finally { database.endTransaction(); }
        }
        require(context.getSharedPreferences("jstorrent_settings",Context.MODE_PRIVATE).edit().putBoolean("wifi_only_enabled",true).putBoolean("vpn_only_enabled",true).putBoolean("shutdown_low_battery_enabled",true).putBoolean("background_downloads_enabled",true).putBoolean("cpu_wake_lock_enabled",false).putBoolean("show_file_selection",false).putString("when_downloads_complete","keep_seeding").commit());
        write(new File(context.getFilesDir(),"legacy-upgrade-uid"),bytes(Integer.toString(Process.myUid())));
        write(new File(context.getFilesDir(),"legacy-upgrade-db-hash"),bytes(hex(digest("SHA-256",Files.readAllBytes(databaseFile.toPath())))));
        write(new File(context.getFilesDir(),"legacy-upgrade-roots-hash"),bytes(hex(digest("SHA-256",Files.readAllBytes(rootsFile.toPath())))));
    }
}
