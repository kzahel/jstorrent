"""Real delayed-listener and owned-failure cleanup checks, without SSH/devices."""
import sys
import subprocess
import time
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'clients/android'))
import run_bootstrap as bootstrap

REAL_POPEN = subprocess.Popen


class UploadTransportSafety(unittest.TestCase):
    def test_delayed_listener_is_observed_and_child_is_joined(self):
        children = []
        def child(command, **options):
            binding = command[command.index('-L') + 1]
            port = binding.split(':')[1]
            process = REAL_POPEN([sys.executable, '-c',
                'import socket,time,sys;sys.stderr.write("owned tunnel diagnostic\\n");sys.stderr.flush();time.sleep(.35);s=socket.socket();s.bind(("127.0.0.1",int(sys.argv[1])));s.listen();time.sleep(30)', port], **options)
            children.append(process)
            return process
        transport = None
        with patch.object(bootstrap.subprocess, 'Popen', side_effect=child):
            started = time.monotonic()
            try:
                transport = bootstrap.ChromeForwardTransport.create('owned-test-alias', 6881)
                self.assertGreater(time.monotonic() - started, .3)
                self.assertIsNone(transport.process.poll())
            finally:
                if transport is not None:
                    detail = transport.close()
                    self.assertIn("owned tunnel diagnostic", detail)
                for process in children:
                    if process.poll() is None:
                        process.kill(); process.wait()
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].poll())
        self.assertTrue(children[0].stderr.closed)

    def test_authentication_failure_is_not_retried_and_stderr_is_closed(self):
        children = []
        def child(_command, **options):
            process = REAL_POPEN([sys.executable, '-c', 'import sys;sys.stderr.write("Permission denied");sys.exit(1)'], **options)
            children.append(process)
            return process
        with patch.object(bootstrap.subprocess, 'Popen', side_effect=child):
            with self.assertRaisesRegex(bootstrap.BootstrapFailure, 'Permission denied'):
                bootstrap.ChromeForwardTransport.create('owned-test-alias', 6881)
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].poll())
        self.assertTrue(children[0].stderr.closed)

    def test_listener_timeout_terminates_and_joins_its_child(self):
        children = []
        def child(_command, **options):
            process = REAL_POPEN([sys.executable, '-c', 'import time;time.sleep(30)'], **options)
            children.append(process)
            return process
        with patch.object(bootstrap.subprocess, 'Popen', side_effect=child), \
             patch.object(bootstrap.time, 'monotonic', side_effect=[0, 1, 20]), \
             patch.object(bootstrap.socket, 'create_connection', side_effect=ConnectionRefusedError):
            with self.assertRaisesRegex(bootstrap.BootstrapFailure, 'never opened'):
                bootstrap.ChromeForwardTransport.create('owned-test-alias', 6881)
        self.assertEqual(len(children), 1)
        self.assertIsNotNone(children[0].poll())
        self.assertTrue(children[0].stderr.closed)

    def test_invalid_upload_budget_refuses_before_any_forward(self):
        for seconds in [0, -1, 301, True, '120']:
            target = Mock()
            with self.assertRaisesRegex(bootstrap.BootstrapFailure, '1..300'):
                bootstrap.verify_product_upload(target, object(), leech_timeout_seconds=seconds)
            target.run.assert_not_called()

    def test_failed_tunnel_removes_only_the_owned_forward_and_directory(self):
        target = Mock(host='owned-test-alias')
        target.run.return_value = SimpleNamespace(returncode=0, stdout='54321', stderr='')
        session = Mock()
        fake_lt = SimpleNamespace(session=Mock(return_value=session), enc_policy=SimpleNamespace(pe_disabled=0),
            alert=SimpleNamespace(category_t=SimpleNamespace(error_notification=1, status_notification=64, connect_notification=32, peer_notification=2)))
        with tempfile.TemporaryDirectory() as directory:
            owned = Path(directory) / 'owned-upload'; owned.mkdir()
            sentinel = Path(directory) / 'unrelated'; sentinel.write_text('preserve')
            with patch.dict(sys.modules, {'libtorrent': fake_lt}), \
                 patch.object(bootstrap.tempfile, 'mkdtemp', return_value=str(owned)), \
                 patch.object(bootstrap.ChromeForwardTransport, 'create', side_effect=bootstrap.BootstrapFailure('owned tunnel failed')):
                with self.assertRaisesRegex(bootstrap.BootstrapFailure, 'owned tunnel failed'):
                    bootstrap.verify_product_upload(target, object())
            self.assertFalse(owned.exists())
            self.assertEqual(sentinel.read_text(), 'preserve')
        self.assertEqual(target.run.call_args_list[-1].args[0], ['forward', '--remove', 'tcp:54321'])
        session.pause.assert_called_once()


if __name__ == '__main__':
    unittest.main()
