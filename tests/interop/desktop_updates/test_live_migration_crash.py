"""Observe actual SQLite spill/commit behavior, including stale WAL bytes."""
from pathlib import Path
import sqlite3
import tempfile
import unittest

from live_migration_crash import uncommitted_wal_bytes


class WalProbeTests(unittest.TestCase):
    def test_actual_spilled_transaction_then_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "session.db"
            with sqlite3.connect(database) as connection:
                connection.executescript("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=64; CREATE TABLE old(value); PRAGMA user_version=29;")
                wal = database.with_name("session.db-wal")
                self.assertEqual(uncommitted_wal_bytes(wal), 0)
                connection.execute("BEGIN IMMEDIATE")
                connection.execute("CREATE TABLE probe(payload)")
                connection.execute("INSERT INTO probe VALUES(zeroblob(4194304))")
                self.assertGreater(uncommitted_wal_bytes(wal), 2 * 1024 * 1024)
                with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as reader:
                    self.assertEqual(reader.execute("PRAGMA user_version").fetchone()[0], 29)
                    self.assertEqual(reader.execute("SELECT count(*) FROM sqlite_master WHERE name='probe'").fetchone()[0], 0)
                original = wal.read_bytes()
                connection.commit()
                self.assertEqual(uncommitted_wal_bytes(wal), 0)
                connection.execute("PRAGMA wal_checkpoint(RESTART)").fetchall()
                connection.execute("INSERT INTO old VALUES(123)")
                connection.commit()
                self.assertGreater(wal.stat().st_size, 2 * 1024 * 1024)
                self.assertEqual(uncommitted_wal_bytes(wal), 0)
                # A copied observer input with a corrupted first frame must not
                # count later valid-looking pages or a retained stale tail.
                copy = Path(directory) / "observer.wal"
                changed = bytearray(original)
                changed[64] ^= 1
                copy.write_bytes(changed)
                self.assertEqual(uncommitted_wal_bytes(copy), 0)
                copy.write_bytes(original[:40])
                self.assertEqual(uncommitted_wal_bytes(copy), 0)


if __name__ == "__main__":
    unittest.main()
