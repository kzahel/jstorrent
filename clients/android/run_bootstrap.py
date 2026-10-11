#!/usr/bin/env python3
"""Run Tactical 004 profiles against an explicit Android target."""

from __future__ import annotations

import argparse
import base64
import gc
import hashlib
import importlib.util
import json
import os
import re
import shlex
import shutil
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, Sequence
from urllib.parse import quote


PACKAGE = "org.rstorrent.bootstrap"
ACTIVITY = f"{PACKAGE}/.MainActivity"
RECEIVER = f"{PACKAGE}/.CommandReceiver"
ACTION_START = "org.rstorrent.bootstrap.START"
ACTION_CANCEL = "org.rstorrent.bootstrap.CANCEL"
ACTION_OBSERVE = "org.rstorrent.bootstrap.OBSERVE"
ACTION_VERIFY = "org.rstorrent.bootstrap.VERIFY"
EXPECTED_INTERFACE = "rstorrent-android/0.4.0;uniffi/0.31.0"
PAYLOAD_LIMIT = 32 * 1024
MAX_TORRENT_SOURCE_BYTES = 64 * 1024 * 1024
MAX_EXTERNAL_INTAKE_FD_DELTA = 32
MAX_EXTERNAL_INTAKE_SETTLED_FD_DELTA = 4
CANCELLATION_STORAGE_DELAY_MILLIS = 5_000
RESULT_TIMEOUT_SECONDS = 45
PROFILE_CHOICES = (
    "success",
    "product-data-reset",
    "product-dynamic-saf",
    "product-hybrid-saf",
    "product-pure-v2-saf",
    "product-identity-reset",
    "product-incomplete-duplex",
    "product-notifications",
    "product-saf-grant-repair",
    "product-https-tracker",
    "product-https-platform-trust",
    "product-mse",
    "product-concurrent-downloads",
    "product-ipv6-policy",
    "product-unmetered-network",
    "product-background-lifecycle",
    "product-external-intake",
    "product-file-selection",
    "product-media-playback",
    "slow-storage",
    "cancellation",
    "peer-failure",
    "duplicate-start",
    "activity-recreation",
    "preexisting-artifacts",
)


class BootstrapFailure(RuntimeError):
    pass


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]


def android_root() -> Path:
    return Path(__file__).resolve().parent


def load_module(name: str, path: Path) -> ModuleType:
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise BootstrapFailure(f"could not load module at {path}")
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    specification.loader.exec_module(module)
    return module


def ensure_interop_environment() -> None:
    try:
        import libtorrent  # noqa: F401
    except ModuleNotFoundError:
        if os.environ.get("RSTORRENT_BOOTSTRAP_UV") == "1":
            raise BootstrapFailure(
                "libtorrent is unavailable inside the pinned interop environment"
            )
        environment = os.environ.copy()
        environment["RSTORRENT_BOOTSTRAP_UV"] = "1"
        command = [
            "uv",
            "run",
            "--project",
            str(repository_root() / "tests" / "interop"),
            "python",
            str(Path(__file__).resolve()),
            *sys.argv[1:],
        ]
        os.execvpe(command[0], command, environment)


def load_support() -> tuple[
    ModuleType, ModuleType, ModuleType, ModuleType, ModuleType, ModuleType
]:
    interop_root = repository_root() / "tests" / "interop"
    if str(interop_root) not in sys.path:
        sys.path.insert(0, str(interop_root))
    probe = load_module(
        "rstorrent_storage_probe_support",
        repository_root() / "experiments" / "android-storage-probe" / "run_probe.py",
    )
    interop = load_module(
        "rstorrent_interop_support",
        repository_root() / "tests" / "interop" / "first_verified_piece.py",
    )
    tracker = load_module(
        "rstorrent_http_tracker_support",
        interop_root / "http_tracker_application.py",
    )
    duplex = load_module(
        "rstorrent_incomplete_duplex_support",
        interop_root / "incomplete_duplex.py",
    )
    pure_v2 = load_module(
        "rstorrent_pure_v2_runtime_support",
        interop_root / "pure_v2_runtime.py",
    )
    hybrid = load_module(
        "rstorrent_hybrid_runtime_support",
        interop_root / "hybrid_runtime.py",
    )
    return probe, interop, tracker, duplex, pure_v2, hybrid


def build_apk() -> Path:
    completed = subprocess.run(
        [str(android_root() / "build.sh")],
        cwd=repository_root(),
        capture_output=True,
        text=True,
        timeout=420,
        check=False,
    )
    if completed.returncode != 0:
        raise BootstrapFailure(
            "Android bootstrap build failed\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )
    lines = completed.stdout.strip().splitlines()
    apk = Path(lines[-1]) if lines else Path()
    if not apk.is_file():
        raise BootstrapFailure("build did not report an APK")
    return apk


def build_android_test_apk() -> Path:
    completed = subprocess.run(
        [str(android_root() / "gradlew"), "assembleDebugAndroidTest"],
        cwd=android_root(),
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if completed.returncode != 0:
        raise BootstrapFailure(
            "Android external-intake fixture build failed\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )
    apk = (
        android_root()
        / "app"
        / "build"
        / "outputs"
        / "apk"
        / "androidTest"
        / "debug"
        / "app-debug-androidTest.apk"
    )
    if not apk.is_file():
        raise BootstrapFailure("Android external-intake fixture APK is unavailable")
    return apk


@dataclass
class SeedFixture:
    run_path: Path
    torrent_path: Path
    expected_file_hashes: dict[str, str]
    piece_hashes: list[str]
    info_hash: str
    name: str
    session: Any
    handle: Any
    host_port: int
    alerts: list[str]

    @classmethod
    def create(
        cls,
        interop: ModuleType,
        label: str,
        *,
        force_rc4: bool = False,
        root_name: str | None = None,
        content_offset: int = 0,
    ) -> "SeedFixture":
        run_path = Path(tempfile.mkdtemp(prefix=f"rstorrent-android-{label}-"))
        alerts: list[str] = []
        (
            torrent_path,
            seed_directory,
            torrent_info,
            expected_file_hashes,
            piece_hashes,
        ) = interop.create_selective_fixture(
            run_path,
            root_name or interop.SELECTIVE_ROOT_NAME,
            content_offset,
        )
        session = interop.create_session()
        if force_rc4:
            import libtorrent as lt

            session.apply_settings(
                {
                    "in_enc_policy": int(lt.enc_policy.pe_forced),
                    "out_enc_policy": int(lt.enc_policy.pe_forced),
                    "allowed_enc_level": int(lt.enc_level.pe_rc4),
                    "prefer_rc4": True,
                }
            )
        host_port = interop.wait_for_listener(session, alerts)
        handle = interop.add_seed(
            session,
            torrent_info,
            seed_directory,
            alerts,
        )
        return cls(
            run_path=run_path,
            torrent_path=torrent_path,
            expected_file_hashes=expected_file_hashes,
            piece_hashes=piece_hashes,
            info_hash=str(torrent_info.info_hashes().v1),
            name=str(torrent_info.name()),
            session=session,
            handle=handle,
            host_port=host_port,
            alerts=alerts,
        )

    def close(self) -> None:
        try:
            self.alerts.extend(
                alert.message() for alert in self.session.pop_alerts()
            )
        except Exception:
            pass
        try:
            if self.handle.is_valid():
                self.session.remove_torrent(self.handle)
        except Exception:
            pass
        try:
            self.session.pause()
        except Exception:
            pass
        self.handle = None
        self.session = None
        gc.collect()
        shutil.rmtree(self.run_path)


@dataclass
class MediaSeedFixture:
    run_path: Path
    torrent_path: Path
    info_hash: str
    name: str
    file_size: int
    expected_sha1: str
    piece_count: int
    session: Any
    handle: Any
    host_port: int
    alerts: list[str]

    @classmethod
    def create(
        cls,
        interop: ModuleType,
        label: str,
    ) -> "MediaSeedFixture":
        import libtorrent as lt

        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg is None:
            raise BootstrapFailure("product-media-playback requires ffmpeg")
        run_path = Path(tempfile.mkdtemp(prefix=f"rstorrent-android-{label}-"))
        source_root = run_path / "source"
        torrent_root = source_root / "media-playback"
        torrent_root.mkdir(parents=True)
        media_path = torrent_root / "controlled.mp4"
        encoded = subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=size=320x180:rate=24",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=44100",
                "-t",
                "30",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-profile:v",
                "baseline",
                "-pix_fmt",
                "yuv420p",
                "-b:v",
                "160k",
                "-maxrate",
                "160k",
                "-bufsize",
                "320k",
                "-g",
                "48",
                "-c:a",
                "aac",
                "-b:a",
                "32k",
                "-movflags",
                "+faststart",
                str(media_path),
            ],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        if encoded.returncode != 0 or not media_path.is_file():
            shutil.rmtree(run_path)
            raise BootstrapFailure(
                "could not create controlled Android media fixture\n" + encoded.stderr
            )
        file_size = media_path.stat().st_size
        if not 256 * 1024 <= file_size <= 2 * 1024 * 1024:
            shutil.rmtree(run_path)
            raise BootstrapFailure(
                f"controlled media fixture has unexpected size {file_size}"
            )
        storage = lt.file_storage()
        storage.add_file("media-playback/controlled.mp4", file_size)
        creator = lt.create_torrent(
            storage,
            piece_size=32 * 1024,
            flags=lt.create_torrent.v1_only,
        )
        lt.set_piece_hashes(creator, str(source_root))
        torrent_path = run_path / "media-playback.torrent"
        torrent_path.write_bytes(bytes(lt.bencode(creator.generate())))
        torrent_info = lt.torrent_info(str(torrent_path))
        alerts: list[str] = []
        session = interop.create_session()
        host_port = interop.wait_for_listener(session, alerts)
        handle = interop.add_seed(session, torrent_info, source_root, alerts)
        return cls(
            run_path=run_path,
            torrent_path=torrent_path,
            info_hash=str(torrent_info.info_hashes().v1),
            name=str(torrent_info.name()),
            file_size=file_size,
            expected_sha1=hashlib.sha1(media_path.read_bytes()).hexdigest(),
            piece_count=torrent_info.num_pieces(),
            session=session,
            handle=handle,
            host_port=host_port,
            alerts=alerts,
        )

    def close(self) -> None:
        try:
            self.alerts.extend(alert.message() for alert in self.session.pop_alerts())
        except Exception:
            pass
        try:
            if self.handle.is_valid():
                self.session.remove_torrent(self.handle)
        except Exception:
            pass
        try:
            self.session.pause()
        except Exception:
            pass
        self.handle = None
        self.session = None
        gc.collect()
        shutil.rmtree(self.run_path)


@dataclass
class PureV2SeedFixture:
    run_path: Path
    torrent_path: Path
    expected_file_hashes: dict[str, str]
    info_hash: str
    wire_info_hash: str
    name: str
    session: Any
    handle: Any
    host_port: int
    alerts: list[str]
    piece_count: int

    @classmethod
    def create(cls, interop: ModuleType, pure_v2: ModuleType, label: str) -> "PureV2SeedFixture":
        run_path = Path(tempfile.mkdtemp(prefix=f"rstorrent-android-{label}-"))
        files = (
            pure_v2.SourceFile((b"a.bin",), pure_v2.deterministic_bytes(41, 9)),
            pure_v2.SourceFile(
                (b"b.bin",),
                pure_v2.deterministic_bytes(43, 7 * 32 * 1024 + 123),
            ),
            pure_v2.SourceFile(
                (b"nested", b"c.bin"),
                pure_v2.deterministic_bytes(47, 17),
            ),
        )
        fixture = pure_v2.make_fixture(run_path, "android-pure-v2", files, 32 * 1024)
        expected_file_hashes = {
            "/".join(component.decode("utf-8") for component in source.path):
                hashlib.sha1(source.data).hexdigest()
            for source in files
        }
        alerts: list[str] = []
        session = interop.create_session()
        host_port = interop.wait_for_listener(session, alerts)
        handle = interop.add_seed(
            session,
            fixture.torrent_info,
            fixture.libtorrent_storage_root,
            alerts,
        )
        return cls(
            run_path=run_path,
            torrent_path=fixture.torrent_path,
            expected_file_hashes=expected_file_hashes,
            info_hash=fixture.full_info_hash,
            wire_info_hash=fixture.wire_info_hash,
            name=str(fixture.torrent_info.name()),
            session=session,
            handle=handle,
            host_port=host_port,
            alerts=alerts,
            piece_count=fixture.torrent_info.num_pieces(),
        )

    def source_with_tracker(self, tracker_url: str) -> bytes:
        import libtorrent as lt

        metainfo = lt.bdecode(self.torrent_path.read_bytes())
        metainfo[b"announce"] = tracker_url.encode("utf-8")
        source = bytes(lt.bencode(metainfo))
        identity = lt.torrent_info(source).info_hashes()
        if identity.has_v1() or str(identity.v2) != self.info_hash:
            raise BootstrapFailure("adding a tracker changed pure-v2 source identity")
        return source

    def restart_seed(self, interop: ModuleType, *, upload_rate_limit: int = 0) -> None:
        import libtorrent as lt

        if self.handle.is_valid():
            self.session.remove_torrent(self.handle)
        self.session.pause()
        self.handle = None
        self.session = None
        gc.collect()
        self.alerts = []
        self.session = interop.create_session()
        if upload_rate_limit > 0:
            self.session.apply_settings(
                {
                    "ignore_limits_on_local_network": False,
                    "upload_rate_limit": upload_rate_limit,
                }
            )
        self.host_port = interop.wait_for_listener(self.session, self.alerts)
        self.handle = interop.add_seed(
            self.session,
            lt.torrent_info(str(self.torrent_path)),
            self.torrent_path.parent / "libtorrent-content",
            self.alerts,
        )

    def close(self) -> None:
        try:
            self.alerts.extend(alert.message() for alert in self.session.pop_alerts())
        except Exception:
            pass
        try:
            if self.handle.is_valid():
                self.session.remove_torrent(self.handle)
        except Exception:
            pass
        try:
            self.session.pause()
        except Exception:
            pass
        self.handle = None
        self.session = None
        gc.collect()
        shutil.rmtree(self.run_path)


@dataclass
class HybridSeedFixture:
    run_path: Path
    torrent_path: Path
    expected_file_hashes: dict[str, str]
    info_hash: str
    wire_info_hash: str
    name: str
    session: Any
    handle: Any
    host_port: int
    alerts: list[str]
    piece_count: int
    skipped_file: int

    @classmethod
    def create(
        cls,
        interop: ModuleType,
        hybrid: ModuleType,
        label: str,
    ) -> "HybridSeedFixture":
        run_path = Path(tempfile.mkdtemp(prefix=f"rstorrent-android-{label}-"))
        fixture = hybrid.make_fixture(run_path)
        expected_file_hashes = {
            "/".join(component.decode("utf-8") for component in source.path):
                hashlib.sha1(source.data).hexdigest()
            for source in fixture.files
        }
        alerts: list[str] = []
        session = interop.create_session()
        host_port = interop.wait_for_listener(session, alerts)
        handle = interop.add_seed(
            session,
            fixture.torrent_info,
            fixture.libtorrent_storage_root,
            alerts,
        )
        return cls(
            run_path=run_path,
            torrent_path=fixture.torrent_path,
            expected_file_hashes=expected_file_hashes,
            info_hash=fixture.full_info_hash,
            wire_info_hash=fixture.wire_info_hash,
            name=str(fixture.torrent_info.name()),
            session=session,
            handle=handle,
            host_port=host_port,
            alerts=alerts,
            piece_count=fixture.torrent_info.num_pieces(),
            skipped_file=hybrid.SKIPPED_FILE,
        )

    def stop_seed(self) -> None:
        try:
            self.alerts.extend(alert.message() for alert in self.session.pop_alerts())
        except Exception:
            pass
        try:
            if self.handle.is_valid():
                self.session.remove_torrent(self.handle)
        except Exception:
            pass
        try:
            self.session.pause()
        except Exception:
            pass
        self.handle = None
        self.session = None
        gc.collect()

    def close(self) -> None:
        self.stop_seed()
        shutil.rmtree(self.run_path)


class RequestClosingProxy:
    def __init__(self, upstream_port: int) -> None:
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.port = self.listener.getsockname()[1]
        self.upstream_port = upstream_port
        self.saw_request = threading.Event()
        self.finished = threading.Event()
        self.failure: BaseException | None = None
        self.thread = threading.Thread(
            target=self._run,
            name="rstorrent-request-closing-proxy",
            daemon=True,
        )
        self.thread.start()

    def _run(self) -> None:
        client: socket.socket | None = None
        upstream: socket.socket | None = None
        try:
            self.listener.settimeout(90)
            client, _ = self.listener.accept()
            upstream = socket.create_connection(
                ("127.0.0.1", self.upstream_port),
                timeout=10,
            )
            stop = threading.Event()
            server_thread = threading.Thread(
                target=self._relay,
                args=(upstream, client, stop, False),
                daemon=True,
            )
            server_thread.start()
            self._relay(client, upstream, stop, True)
            stop.set()
            server_thread.join(timeout=2)
        except BaseException as error:
            self.failure = error
        finally:
            for stream in (client, upstream):
                if stream is not None:
                    try:
                        stream.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    stream.close()
            self.finished.set()

    def _relay(
        self,
        source: socket.socket,
        destination: socket.socket,
        stop: threading.Event,
        inspect_requests: bool,
    ) -> None:
        buffered = bytearray()
        handshake_remaining = 68
        source.settimeout(1)
        while not stop.is_set():
            try:
                chunk = source.recv(64 * 1024)
            except TimeoutError:
                continue
            if not chunk:
                return
            destination.sendall(chunk)
            if not inspect_requests:
                continue
            buffered.extend(chunk)
            if handshake_remaining:
                consumed = min(handshake_remaining, len(buffered))
                del buffered[:consumed]
                handshake_remaining -= consumed
                if handshake_remaining:
                    continue
            while len(buffered) >= 4:
                frame_length = struct.unpack(">I", buffered[:4])[0]
                if len(buffered) < 4 + frame_length:
                    break
                frame = bytes(buffered[4 : 4 + frame_length])
                del buffered[: 4 + frame_length]
                if frame and frame[0] == 6:
                    self.saw_request.set()
                    stop.set()
                    return

    def close(self) -> None:
        try:
            self.listener.close()
        except OSError:
            pass
        self.thread.join(timeout=5)
        if self.thread.is_alive():
            return
        if self.failure is not None and not self.saw_request.is_set():
            raise BootstrapFailure(f"peer-failure proxy failed: {self.failure}")


class RepeatedDelayedPieceProxy:
    """Relay repeated plaintext peers while delaying piece payload frames."""

    def __init__(self, target: tuple[str, int], piece_delay_seconds: float) -> None:
        self.target = target
        self.piece_delay_seconds = piece_delay_seconds
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(8)
        self.listener.settimeout(0.2)
        self.endpoint = ("127.0.0.1", int(self.listener.getsockname()[1]))
        self.pieces: list[tuple[int, int, int]] = []
        self._closing = threading.Event()
        self._sockets: list[socket.socket] = []
        self._failure: BaseException | None = None
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        try:
            while not self._closing.is_set():
                try:
                    downstream, _ = self.listener.accept()
                except TimeoutError:
                    continue
                upstream = socket.create_connection(self.target, timeout=5)
                upstream.settimeout(None)
                downstream.settimeout(None)
                self._sockets.extend((downstream, upstream))
                self._relay_connection(downstream, upstream)
        except BaseException as error:
            if not (self._closing.is_set() and isinstance(error, OSError)):
                self._failure = error
        finally:
            self._shutdown_sockets()

    def _relay_connection(
        self,
        downstream: socket.socket,
        upstream: socket.socket,
    ) -> None:
        stop = threading.Event()
        workers = (
            threading.Thread(
                target=self._relay_guard,
                args=(downstream, upstream, stop, False),
                daemon=True,
            ),
            threading.Thread(
                target=self._relay_guard,
                args=(upstream, downstream, stop, True),
                daemon=True,
            ),
        )
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()
        for stream in (downstream, upstream):
            try:
                stream.close()
            except OSError:
                pass

    def _relay_guard(
        self,
        source: socket.socket,
        destination: socket.socket,
        stop: threading.Event,
        observe_pieces: bool,
    ) -> None:
        try:
            handshake = self._recv_exact(source, 68)
            if not handshake.startswith(b"\x13BitTorrent protocol"):
                raise BootstrapFailure("media proxy received a non-BitTorrent handshake")
            destination.sendall(handshake)
            while not stop.is_set():
                prefix = self._recv_maybe_exact(source, 4)
                if prefix is None:
                    return
                length = struct.unpack(">I", prefix)[0]
                body = self._recv_exact(source, length) if length else b""
                destination.sendall(prefix + body)
                if observe_pieces and len(body) >= 9 and body[0] == 7:
                    piece, begin = struct.unpack(">II", body[1:9])
                    self.pieces.append((piece, begin, len(body) - 9))
                    time.sleep(self.piece_delay_seconds)
        except (ConnectionError, EOFError, OSError):
            pass
        except BaseException as error:
            self._failure = error
        finally:
            stop.set()
            for stream in (source, destination):
                try:
                    stream.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    @staticmethod
    def _recv_exact(stream: socket.socket, length: int) -> bytes:
        data = bytearray()
        while len(data) < length:
            chunk = stream.recv(length - len(data))
            if not chunk:
                raise EOFError("media proxy peer closed within a frame")
            data.extend(chunk)
        return bytes(data)

    @classmethod
    def _recv_maybe_exact(
        cls,
        stream: socket.socket,
        length: int,
    ) -> bytes | None:
        first = stream.recv(length)
        if not first:
            return None
        if len(first) == length:
            return first
        return first + cls._recv_exact(stream, length - len(first))

    def _shutdown_sockets(self) -> None:
        for stream in self._sockets:
            try:
                stream.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def close(self) -> None:
        self._closing.set()
        try:
            self.listener.close()
        except OSError:
            pass
        self._shutdown_sockets()
        self._thread.join(timeout=5)
        if self._thread.is_alive():
            raise BootstrapFailure("media proxy did not join")
        if self._failure is not None:
            raise BootstrapFailure(f"media proxy failed: {self._failure}")


@dataclass
class ReverseTransport:
    target: Any
    device_port: int
    chrome_tunnel: subprocess.Popen[str] | None = None

    @classmethod
    def create(
        cls,
        target: Any,
        target_kind: str,
        host_port: int,
        ordinal: int,
        slot: int = 0,
    ) -> "ReverseTransport":
        if not 0 <= slot <= 7:
            raise BootstrapFailure("reverse transport slot must be between zero and seven")
        device_port = 39_000 + (ordinal % 500) * 8 + slot
        chrome_tunnel: subprocess.Popen[str] | None = None
        if target_kind == "chromeos":
            chrome_tunnel = subprocess.Popen(
                [
                    "ssh",
                    "-N",
                    "-o",
                    "ExitOnForwardFailure=yes",
                    "-R",
                    f"127.0.0.1:{device_port}:127.0.0.1:{host_port}",
                    "chromeroot",
                ],
                cwd=repository_root(),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            time.sleep(0.4)
            if chrome_tunnel.poll() is not None:
                detail = chrome_tunnel.stderr.read() if chrome_tunnel.stderr else ""
                raise BootstrapFailure(
                    f"ChromeOS reverse SSH tunnel failed: {detail}"
                )
            reverse_host_port = device_port
        else:
            reverse_host_port = host_port
        result = target.run(
            [
                "reverse",
                f"tcp:{device_port}",
                f"tcp:{reverse_host_port}",
            ],
            timeout=20,
            check=False,
        )
        if result.returncode != 0:
            if chrome_tunnel is not None:
                chrome_tunnel.terminate()
                chrome_tunnel.wait(timeout=5)
            raise BootstrapFailure(
                "adb reverse failed\n"
                f"stdout:\n{result.stdout}\n"
                f"stderr:\n{result.stderr}"
            )
        return cls(target, device_port, chrome_tunnel)

    def close(self) -> None:
        self.target.run(
            ["reverse", "--remove", f"tcp:{self.device_port}"],
            timeout=15,
            check=False,
        )
        if self.chrome_tunnel is not None:
            self.chrome_tunnel.terminate()
            try:
                self.chrome_tunnel.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.chrome_tunnel.kill()
                self.chrome_tunnel.wait(timeout=5)


@dataclass
class ChromeForwardTransport:
    local_port: int
    process: subprocess.Popen[str]

    @classmethod
    def create(cls, host: str, remote_port: int) -> "ChromeForwardTransport":
        last_detail = ""
        for _ in range(8):
            reservation = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            reservation.bind(("127.0.0.1", 0))
            local_port = int(reservation.getsockname()[1])
            reservation.close()
            process = subprocess.Popen(
                [
                    "ssh",
                    "-N",
                    "-o",
                    "ExitOnForwardFailure=yes",
                    "-L",
                    f"127.0.0.1:{local_port}:127.0.0.1:{remote_port}",
                    host,
                ],
                cwd=repository_root(),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline and process.poll() is None:
                try:
                    with socket.create_connection(("127.0.0.1", local_port), timeout=0.2):
                        return cls(local_port, process)
                except OSError:
                    time.sleep(0.05)
            if process.poll() is None:
                cls(local_port, process).close()
                raise BootstrapFailure("ChromeOS upload tunnel never opened its owned listener")
            last_detail = process.stderr.read() if process.stderr else ""
            if process.stderr is not None:
                process.stderr.close()
            if "Address already in use" not in last_detail:
                raise BootstrapFailure(f"ChromeOS forward SSH tunnel failed: {last_detail}")
        raise BootstrapFailure(f"ChromeOS forward SSH tunnel failed: {last_detail}")

    def close(self) -> str:
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        finally:
            detail = ""
            if self.process.stderr is not None:
                detail = self.process.stderr.read(65_536)
                self.process.stderr.close()
        return detail


def clear_application(target: Any) -> None:
    target.shell(["am", "force-stop", PACKAGE], check=False)
    cleared = target.shell(["pm", "clear", PACKAGE], check=False)
    if cleared.returncode != 0 or "Success" not in cleared.stdout:
        raise BootstrapFailure(
            f"could not clear bootstrap app data: {cleared.stdout}"
        )
    target.run(["logcat", "-c"], check=False)


def launch(
    target: Any,
    action: str,
    *,
    run_id: str,
    fixture: SeedFixture | None = None,
    peer_port: int | None = None,
    scenario: str | None = None,
    storage_delay_millis: int = 0,
    collision: str = "",
    storage: str = "private",
    tree_initial_uri: str | None = None,
    via_receiver: bool = False,
) -> None:
    arguments = ["am", "broadcast" if via_receiver else "start"]
    arguments.extend(
        [
            "-a",
            action,
            "-n",
            RECEIVER if via_receiver else ACTIVITY,
        ]
    )
    if not via_receiver:
        arguments.extend(
            [
                "--ez",
                "finish_activity",
                "true",
            ]
        )
    arguments.extend(
        [
        "--es",
        "run_id",
        run_id,
        ]
    )
    if action == ACTION_START:
        if fixture is None or peer_port is None:
            raise BootstrapFailure("start action requires fixture and peer port")
        metainfo = base64.b64encode(fixture.torrent_path.read_bytes()).decode("ascii")
        arguments.extend(
            [
                "--es",
                "scenario",
                scenario or "success",
                "--es",
                "metainfo_base64",
                metainfo,
                "--ei",
                "peer_port",
                str(peer_port),
                "--el",
                "timeout_seconds",
                "45",
                "--el",
                "max_buffered_payload_bytes",
                str(PAYLOAD_LIMIT),
                "--el",
                "storage_write_delay_millis",
                str(storage_delay_millis),
                "--es",
                "skip_files",
                "1,2",
                "--es",
                "storage",
                storage,
            ]
        )
        if tree_initial_uri:
            arguments.extend(["--es", "tree_initial_uri", tree_initial_uri])
        if collision:
            arguments.extend(["--es", "collision", collision])
    completed = target.shell(arguments, timeout=30, check=False)
    if completed.returncode != 0 or "Error:" in completed.stdout:
        raise BootstrapFailure(
            f"activity launch failed for {action}\n"
            f"stdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )


def app_text(target: Any, relative_path: str) -> str | None:
    result = target.shell(
        ["run-as", PACKAGE, "cat", relative_path],
        timeout=10,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def app_bytes(target: Any, relative_path: str) -> bytes | None:
    completed = subprocess.run(
        [
            *target.prefix,
            "exec-out",
            "run-as",
            PACKAGE,
            "cat",
            relative_path,
        ],
        cwd=repository_root(),
        capture_output=True,
        timeout=20,
        check=False,
    )
    if completed.returncode != 0:
        return None
    return completed.stdout


def app_exists(target: Any, relative_path: str) -> bool:
    result = target.shell(
        ["run-as", PACKAGE, "ls", "-d", relative_path],
        timeout=10,
        check=False,
    )
    return result.returncode == 0


def push_local_file(
    target: Any,
    target_kind: str,
    source: Path,
    destination: str,
    *,
    timeout: float = 30,
) -> None:
    if target_kind != "chromeos":
        target.run(["push", str(source), destination], timeout=timeout)
        return
    host = getattr(target, "host", None)
    if not isinstance(host, str) or not host:
        raise BootstrapFailure("ChromeOS ADB target does not expose its SSH host")
    remote_source = (
        f"/tmp/rstorrent-upload-{os.getpid()}-{time.monotonic_ns()}-{source.name}"
    )
    staged = subprocess.run(
        ["scp", str(source), f"{host}:{remote_source}"],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if staged.returncode != 0:
        raise BootstrapFailure(
            f"could not stage ChromeOS upload {source.name}: {staged.stderr.strip()}"
        )
    try:
        target.run(["push", remote_source, destination], timeout=timeout)
    finally:
        subprocess.run(
            ["ssh", host, shlex.join(["rm", "-f", remote_source])],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )


def wait_result(
    target: Any,
    run_id: str,
    *,
    restart: bool = False,
) -> dict[str, Any]:
    suffix = "-restart" if restart else ""
    relative = f"files/results/{run_id}{suffix}.json"
    deadline = time.monotonic() + RESULT_TIMEOUT_SECONDS
    last = ""
    while time.monotonic() < deadline:
        text = app_text(target, relative)
        if text:
            last = text.strip()
            try:
                return json.loads(last)
            except json.JSONDecodeError:
                pass
        time.sleep(0.2)
    logcat = target.run(
        [
            "logcat",
            "-d",
            "-s",
            "RSTorrentBootstrap:*",
            "AndroidRuntime:E",
            "*:S",
        ],
        timeout=20,
        check=False,
    ).stdout
    raise BootstrapFailure(
        f"timed out waiting for {relative}; last={last!r}\n"
        f"logcat tail:\n{logcat}"
    )


def read_events(target: Any, run_id: str) -> list[dict[str, Any]]:
    text = app_text(target, f"files/sessions/{run_id}/events.jsonl")
    if not text:
        return []
    events = []
    for line in text.splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError as error:
            raise BootstrapFailure(f"invalid event JSON: {line!r}") from error
    return events


def wait_for_event(
    target: Any,
    run_id: str,
    predicate: Any,
    description: str,
    timeout_seconds: float = 15,
    use_activity: bool = False,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        launch(
            target,
            ACTION_OBSERVE,
            run_id=run_id,
            via_receiver=not use_activity,
        )
        for event in read_events(target, run_id):
            if predicate(event):
                return event
        time.sleep(0.15)
    logcat = target.run(
        ["logcat", "-d", "-t", "250"],
        timeout=20,
        check=False,
    ).stdout
    raise BootstrapFailure(
        f"timed out waiting for event: {description}; "
        f"events={json.dumps(read_events(target, run_id), sort_keys=True)}\n"
        f"logcat tail:\n{logcat}"
    )


def wait_recorded_event(
    target: Any,
    run_id: str,
    predicate: Any,
    description: str,
    timeout_seconds: float = 10,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        for event in read_events(target, run_id):
            if predicate(event):
                return event
        time.sleep(0.1)
    raise BootstrapFailure(f"timed out waiting for recorded event: {description}")


def validate_common(result: dict[str, Any], identity: dict[str, str]) -> None:
    if result.get("interface_version") != EXPECTED_INTERFACE:
        raise BootstrapFailure("result reported the wrong native interface")
    if not result.get("joined"):
        raise BootstrapFailure("engine task was not joined")
    snapshot = result.get("snapshot", {})
    if snapshot.get("task_alive"):
        raise BootstrapFailure("terminal result still reports a live engine task")
    if snapshot.get("buffered_payload_bytes") != 0:
        raise BootstrapFailure("terminal payload reservation is nonzero")
    if snapshot.get("payload_high_water", 0) > PAYLOAD_LIMIT:
        raise BootstrapFailure("payload high water exceeded the configured limit")
    requested = snapshot.get("requested_bytes", -1)
    received = snapshot.get("received_bytes", -1)
    stored = snapshot.get("stored_bytes", -1)
    if not requested >= received >= stored >= 0:
        raise BootstrapFailure(
            "byte counters are not ordered as requested >= received >= stored"
        )
    device = result.get("device", {})
    if str(device.get("api")) != identity["api"]:
        raise BootstrapFailure("application and ADB API identities differ")
    if device.get("model") != identity["model"]:
        raise BootstrapFailure("application and ADB model identities differ")
    if device.get("fingerprint") != identity["fingerprint"]:
        raise BootstrapFailure("application and ADB fingerprints differ")


def sha1_bytes(payload: bytes) -> str:
    return hashlib.sha1(payload).hexdigest()


def validate_success(
    target: Any,
    result: dict[str, Any],
    fixture: SeedFixture,
    run_id: str,
    identity: dict[str, str],
) -> None:
    validate_common(result, identity)
    terminal = result.get("terminal", {})
    if terminal.get("outcome") != "SUCCEEDED":
        raise BootstrapFailure(
            "successful profile ended unexpectedly: "
            f"{json.dumps(terminal, sort_keys=True)}; "
            f"events={json.dumps(read_events(target, run_id), sort_keys=True)}"
        )
    report = terminal.get("report", {})
    expected = {
        "info_hash": fixture.info_hash,
        "final_piece_hash": fixture.piece_hashes[-1],
        "bytes_written": 97_232,
        "block_count": 7,
        "payload_limit": PAYLOAD_LIMIT,
        "verification_buffer": 16 * 1024,
        "piece_count": 5,
        "verified_piece_count": 4,
        "skipped_piece_count": 1,
        "selected_file_bytes": 73_000,
        "skipped_file_bytes": 57_000,
        "padding_bytes": 3_304,
        "selected_written_bytes": 73_000,
        "part_written_bytes": 24_232,
        "part_slots": 2,
        "part_reopened": True,
    }
    for key, value in expected.items():
        if report.get(key) != value:
            raise BootstrapFailure(
                f"report {key}={report.get(key)!r}, expected {value!r}"
            )
    if not 0 < report.get("payload_high_water", 0) <= PAYLOAD_LIMIT:
        raise BootstrapFailure("successful payload high water is invalid")
    snapshot = result["snapshot"]
    for counter in ("requested_bytes", "received_bytes", "stored_bytes"):
        if snapshot.get(counter) != expected["bytes_written"]:
            raise BootstrapFailure(
                f"successful {counter}={snapshot.get(counter)!r}, "
                f"expected {expected['bytes_written']}"
            )

    root = f"files/sessions/{run_id}"
    for file_index, (relative_path, _, padding) in enumerate(fixture_files()):
        output_path = f"{root}/downloaded/{relative_path}"
        if padding or file_index in (1, 2):
            if app_exists(target, output_path):
                raise BootstrapFailure(
                    f"skipped or padding path was created: {relative_path}"
                )
            continue
        payload = app_bytes(target, output_path)
        if payload is None:
            raise BootstrapFailure(f"wanted output is absent: {relative_path}")
        if sha1_bytes(payload) != fixture.expected_file_hashes[relative_path]:
            raise BootstrapFailure(f"wanted output hash differs: {relative_path}")
    if app_exists(target, f"{root}/.downloaded.rstorrent-staging"):
        raise BootstrapFailure("legacy staging root was created")
    if not app_exists(target, f"{root}/.downloaded.rstorrent-parts"):
        raise BootstrapFailure("validated part file is absent")


def validate_saf_direct(
    target: Any,
    result: dict[str, Any],
    fixture: SeedFixture,
    run_id: str,
    identity: dict[str, str],
) -> None:
    validate_common(result, identity)
    terminal = result.get("terminal", {})
    if terminal.get("outcome") != "SUCCEEDED":
        raise BootstrapFailure(
            "SAF native execution did not complete: "
            f"{json.dumps(terminal, sort_keys=True)}; "
            f"events={json.dumps(read_events(target, run_id), sort_keys=True)}"
        )
    if result.get("platform", {}).get("status") != "AWAITING_RESTART":
        raise BootstrapFailure(
            f"SAF direct-content verification failed: {result.get('platform')}"
        )
    report = terminal.get("report", {})
    expected_scalars = {
        "info_hash": fixture.info_hash,
        "final_piece_hash": fixture.piece_hashes[-1],
        "bytes_written": 97_232,
        "block_count": 7,
        "payload_limit": PAYLOAD_LIMIT,
        "verification_buffer": 16 * 1024,
        "piece_count": 5,
        "verified_piece_count": 4,
        "skipped_piece_count": 1,
        "selected_file_bytes": 73_000,
        "skipped_file_bytes": 57_000,
        "padding_bytes": 3_304,
        "selected_written_bytes": 73_000,
        "part_written_bytes": 24_232,
        "part_slots": 2,
        "part_reopened": True,
        "part_path": None,
    }
    for key, expected in expected_scalars.items():
        if report.get(key) != expected:
            raise BootstrapFailure(
                f"SAF report {key}={report.get(key)!r}, expected {expected!r}"
            )
    if result.get("platform", {}).get("file_count") != 4:
        raise BootstrapFailure("SAF direct content omitted wanted files")


def validate_saf_restart(
    result: dict[str, Any],
    fixture: SeedFixture,
    identity: dict[str, str],
) -> None:
    if result.get("interface_version") != EXPECTED_INTERFACE:
        raise BootstrapFailure("restart reported the wrong native interface")
    if result.get("status") != "SUCCEEDED":
        raise BootstrapFailure(
            f"SAF restart verification failed: {json.dumps(result, sort_keys=True)}"
        )
    device = result.get("device", {})
    if (
        str(device.get("api")) != identity["api"]
        or device.get("model") != identity["model"]
        or device.get("fingerprint") != identity["fingerprint"]
    ):
        raise BootstrapFailure("restart identity differs from the selected target")
    expected_hashes = {
        index: fixture.expected_file_hashes[path]
        for index, (path, _, padding) in enumerate(fixture_files())
        if not padding and index not in (1, 2)
    }
    verified = {
        entry["file_index"]: entry["sha1"]
        for entry in result.get("verified_files", [])
    }
    if verified != expected_hashes:
        raise BootstrapFailure(
            f"restart hash manifest differs: {verified!r} != {expected_hashes!r}"
        )
    if not result.get("content_deleted") or not result.get("part_deleted"):
        raise BootstrapFailure("restart did not clean exact SAF artifacts")


def fixture_files() -> Sequence[tuple[str, int, bool]]:
    return (
        ("wanted/start.bin", 20_000, False),
        ("skip/large.bin", 50_000, False),
        ("later.bin", 7_000, False),
        ("wanted/end.bin", 18_000, False),
        ("wanted/empty.bin", 0, False),
        (".pad/3304", 3_304, True),
        ("tail.bin", 35_000, False),
    )


def cleanup_run(target: Any, run_id: str) -> None:
    if not run_id or any(
        character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-"
        for character in run_id
    ):
        raise BootstrapFailure(f"refusing unsafe cleanup run ID {run_id!r}")
    for path in (
        f"files/sessions/{run_id}",
        f"files/results/{run_id}.json",
        f"files/results/{run_id}-restart.json",
        f"files/results/.{run_id}.json.tmp",
        f"files/results/.{run_id}-restart.json.tmp",
    ):
        target.shell(
            ["run-as", PACKAGE, "rm", "-rf", path],
            timeout=15,
            check=False,
        )
        if app_exists(target, path):
            raise BootstrapFailure(f"app-private cleanup failed for {path}")


def peer_count(fixture: SeedFixture) -> int:
    try:
        return int(fixture.handle.status().num_peers)
    except Exception:
        return -1


def run_standard_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    profile: str,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    label = f"{target_kind}-{profile}-{ordinal}"
    run_id = f"{profile.replace('-', '_')}-{ordinal}"
    fixture = SeedFixture.create(interop, label)
    proxy: RequestClosingProxy | None = None
    transport: ReverseTransport | None = None
    saf_storage = storage.startswith("saf-")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    try:
        clear_application(target)
        if saf_storage:
            probe.prepare_grant_folder(target, grant_storage)
        host_port = fixture.host_port
        if profile == "peer-failure":
            proxy = RequestClosingProxy(host_port)
            host_port = proxy.port
        transport = ReverseTransport.create(
            target,
            target_kind,
            host_port,
            ordinal,
        )
        delay = {
            "slow-storage": 2_000,
            "duplicate-start": 750,
            "activity-recreation": 2_000,
        }.get(profile, 0)
        launch(
            target,
            ACTION_START,
            run_id=run_id,
            fixture=fixture,
            peer_port=transport.device_port,
            scenario=profile,
            storage_delay_millis=delay,
            storage=storage,
            tree_initial_uri=(
                probe.MOTO_SD_INITIAL_URI
                if storage == "saf-sdcard"
                else None
            ),
        )
        if saf_storage:
            probe.automate_tree_grant(target, grant_storage)

        observed: dict[str, Any] | None = None
        if profile == "slow-storage":
            observed = wait_for_event(
                target,
                run_id,
                lambda event: (
                    event.get("event") == "activity_observed"
                    and event.get("requested_bytes", 0)
                    >= event.get("received_bytes", 0)
                    > event.get("stored_bytes", 0)
                    and event.get("buffered_payload_bytes", 0) > 0
                    and event.get("task_alive") is True
                ),
                "received payload waiting on slow storage",
            )
        elif profile == "duplicate-start":
            wait_recorded_event(
                target,
                run_id,
                lambda event: event.get("event") == "engine_start",
                "engine start before duplicate command",
            )
            launch(
                target,
                ACTION_START,
                run_id=run_id,
                fixture=fixture,
                peer_port=transport.device_port,
                scenario=profile,
                storage_delay_millis=delay,
                storage=storage,
                via_receiver=True,
            )
        elif profile == "activity-recreation":
            wait_recorded_event(
                target,
                run_id,
                lambda event: event.get("event") == "engine_start",
                "engine start before activity recreation",
            )
            observed = wait_for_event(
                target,
                run_id,
                lambda event: (
                    event.get("event") == "activity_observed"
                    and event.get("task_alive") is True
                ),
                "activity recreation while engine is active",
                use_activity=True,
            )

        result = wait_result(target, run_id)
        restart_result: dict[str, Any] | None = None
        if profile == "peer-failure":
            validate_common(result, identity)
            terminal = result.get("terminal", {})
            if terminal.get("outcome") != "FAILED":
                raise BootstrapFailure("peer-failure profile did not fail")
            if terminal.get("failure_kind") != "PEER":
                raise BootstrapFailure(
                    "peer-failure profile was not typed as PEER"
                )
            snapshot = result["snapshot"]
            if snapshot["requested_bytes"] <= 0:
                raise BootstrapFailure("peer failed before request accounting")
            if proxy is None or not proxy.saw_request.wait(timeout=2):
                raise BootstrapFailure("peer failed before a request was observed")
            if saf_storage:
                if result.get("platform", {}).get("status") != "NOT_PREPARED":
                    raise BootstrapFailure("failed SAF transfer was publishable")
            else:
                assert_unverified_cleanup(target, run_id)
        else:
            if saf_storage:
                validate_saf_direct(target, result, fixture, run_id, identity)
                target.shell(["am", "force-stop", PACKAGE])
                launch(target, ACTION_VERIFY, run_id=run_id)
                restart_result = wait_result(target, run_id, restart=True)
                validate_saf_restart(restart_result, fixture, identity)
            else:
                validate_success(target, result, fixture, run_id, identity)
        events = read_events(target, run_id)
        if profile == "duplicate-start" and not any(
            event.get("event") == "duplicate_start"
            and event.get("disposition") == "BUSY"
            for event in events
        ):
            raise BootstrapFailure("duplicate start was not rejected as BUSY")
        if profile == "activity-recreation" and observed is None:
            raise BootstrapFailure("activity recreation was not observed")
        if profile == "slow-storage":
            if observed is None:
                raise BootstrapFailure("slow storage was not observed in flight")
            if result["snapshot"]["payload_high_water"] > PAYLOAD_LIMIT:
                raise BootstrapFailure("slow storage exceeded its payload limit")

        output = {
            "target": target_kind,
            "profile": profile,
            "run": ordinal,
            "result": result,
            "restart": restart_result,
            "events": events,
            "host_peer_count_after": peer_count(fixture),
        }
        cleanup_run(target, run_id)
        return output
    finally:
        if transport is not None:
            transport.close()
        if proxy is not None:
            proxy.close()
        if saf_storage:
            probe.remove_grant_folder(target, grant_storage)
        fixture.close()


def assert_unverified_cleanup(target: Any, run_id: str) -> None:
    root = f"files/sessions/{run_id}"
    for path in (
        f"{root}/downloaded",
        f"{root}/.downloaded.rstorrent-staging",
        f"{root}/.downloaded.rstorrent-parts",
    ):
        if app_exists(target, path):
            raise BootstrapFailure(
                f"unverified artifact survived terminal cleanup: {path}"
            )


def run_cancellation_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    results = []
    saf_storage = storage.startswith("saf-")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    for phase, after_progress in (("before", False), ("after", True)):
        run_id = f"cancellation_{phase}-{ordinal}"
        fixture = SeedFixture.create(
            interop,
            f"{target_kind}-cancellation-{phase}-{ordinal}",
        )
        transport: ReverseTransport | None = None
        try:
            clear_application(target)
            if saf_storage:
                probe.prepare_grant_folder(target, grant_storage)
            transport = ReverseTransport.create(
                target,
                target_kind,
                fixture.host_port,
                ordinal + (100 if after_progress else 0),
            )
            launch(
                target,
                ACTION_START,
                run_id=run_id,
                fixture=fixture,
                peer_port=transport.device_port,
                scenario=f"cancellation-{phase}",
                storage_delay_millis=CANCELLATION_STORAGE_DELAY_MILLIS,
                storage=storage,
                tree_initial_uri=(
                    probe.MOTO_SD_INITIAL_URI
                    if storage == "saf-sdcard"
                    else None
                ),
            )
            if saf_storage:
                probe.automate_tree_grant(target, grant_storage)
            wait_recorded_event(
                target,
                run_id,
                lambda event: event.get("event") == "engine_start",
                f"engine start before {phase} cancellation",
                timeout_seconds=30,
            )
            if after_progress:
                wait_for_event(
                    target,
                    run_id,
                    lambda event: (
                        event.get("event") == "activity_observed"
                        and event.get("stored_bytes", 0) >= 16_384
                        and event.get("task_alive") is True
                    ),
                    "accepted block before cancellation",
                )
            launch(
                target,
                ACTION_CANCEL,
                run_id=run_id,
                via_receiver=True,
            )
            result = wait_result(target, run_id)
            validate_common(result, identity)
            terminal = result.get("terminal", {})
            if terminal.get("outcome") != "CANCELLED":
                raise BootstrapFailure(
                    f"{phase} cancellation ended as {terminal.get('outcome')}"
                )
            stored = result["snapshot"]["stored_bytes"]
            if after_progress and stored < 16_384:
                raise BootstrapFailure(
                    "after-progress cancellation stored no complete block"
                )
            if not after_progress and stored != 0:
                raise BootstrapFailure(
                    "before-progress cancellation accepted payload"
                )
            if saf_storage:
                if result.get("platform", {}).get("status") != "NOT_PREPARED":
                    raise BootstrapFailure("cancelled SAF transfer was publishable")
            else:
                assert_unverified_cleanup(target, run_id)

            original = app_bytes(
                target,
                f"files/results/{run_id}.json",
            )
            launch(
                target,
                ACTION_CANCEL,
                run_id=run_id,
                via_receiver=True,
            )
            time.sleep(0.5)
            repeated = app_bytes(
                target,
                f"files/results/{run_id}.json",
            )
            if original != repeated:
                raise BootstrapFailure(
                    "repeated terminal cancellation changed the result"
                )
            results.append(
                {
                    "phase": phase,
                    "result": result,
                    "events": read_events(target, run_id),
                }
            )
            cleanup_run(target, run_id)
        finally:
            if transport is not None:
                transport.close()
            if saf_storage:
                probe.remove_grant_folder(target, grant_storage)
            fixture.close()
    return {
        "target": target_kind,
        "profile": "cancellation",
        "run": ordinal,
        "phases": results,
    }


def collision_bytes(
    target: Any,
    run_id: str,
    collision: str,
) -> bytes | None:
    root = f"files/sessions/{run_id}"
    paths = {
        "output": f"{root}/downloaded",
        "staging": f"{root}/.downloaded.rstorrent-staging/sentinel",
        "part": f"{root}/.downloaded.rstorrent-parts",
        "result": f"files/results/{run_id}.json",
    }
    return app_bytes(target, paths[collision])


def run_preexisting_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    interop: ModuleType,
    ordinal: int,
) -> dict[str, Any]:
    collisions = []
    for collision_index, collision in enumerate(
        ("output", "staging", "part", "result"),
        start=1,
    ):
        run_id = f"preexisting_{collision}-{ordinal}"
        fixture = SeedFixture.create(
            interop,
            f"{target_kind}-{run_id}",
        )
        transport: ReverseTransport | None = None
        try:
            clear_application(target)
            transport = ReverseTransport.create(
                target,
                target_kind,
                fixture.host_port,
                ordinal + 200 + collision_index,
            )
            launch(
                target,
                ACTION_START,
                run_id=run_id,
                fixture=fixture,
                peer_port=transport.device_port,
                scenario="preexisting-artifacts",
                collision=collision,
            )
            expected = f"RSTORRENT_SENTINEL:{collision}".encode()
            if collision == "result":
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline:
                    if collision_bytes(target, run_id, collision) == expected:
                        break
                    time.sleep(0.2)
                else:
                    raise BootstrapFailure(
                        "preexisting result sentinel was not preserved"
                    )
                result: dict[str, Any] | None = None
            else:
                result = wait_result(target, run_id)
                validate_common(result, identity)
                terminal = result.get("terminal", {})
                if terminal.get("outcome") != "FAILED":
                    raise BootstrapFailure(
                        f"{collision} collision did not fail"
                    )
                if terminal.get("failure_kind") != "PREEXISTING_ARTIFACT":
                    raise BootstrapFailure(
                        f"{collision} collision had kind "
                        f"{terminal.get('failure_kind')}"
                    )
            if collision_bytes(target, run_id, collision) != expected:
                raise BootstrapFailure(
                    f"{collision} sentinel changed during refusal"
                )
            time.sleep(0.3)
            if peer_count(fixture) not in (0, -1):
                raise BootstrapFailure(
                    f"{collision} refusal connected to the peer"
                )
            collisions.append(
                {
                    "collision": collision,
                    "result": result,
                    "sentinel_preserved": True,
                    "peer_connections": peer_count(fixture),
                }
            )
            cleanup_run(target, run_id)
        finally:
            if transport is not None:
                transport.close()
            fixture.close()
    return {
        "target": target_kind,
        "profile": "preexisting-artifacts",
        "run": ordinal,
        "collisions": collisions,
    }


def product_fd_count(target: Any) -> int:
    pid_text = target.shell(["pidof", PACKAGE], check=False).stdout.strip()
    if not pid_text:
        processes = target.shell(["ps", "-A", "-o", "PID,NAME"], check=False)
        for line in processes.stdout.splitlines():
            fields = line.split()
            if len(fields) >= 2 and fields[-1] == PACKAGE:
                pid_text = fields[0]
                break
    if not pid_text:
        return 0
    pid = pid_text.split()[0]
    listing = target.shell(
        ["run-as", PACKAGE, "ls", f"/proc/{pid}/fd"],
        check=False,
    )
    if listing.returncode != 0:
        return 0
    return len(listing.stdout.split())


def product_memory_kib(target: Any) -> dict[str, int]:
    pid_text = target.shell(["pidof", PACKAGE], check=False).stdout.strip()
    if not pid_text:
        return {"java_rss": 0, "native_rss": 0, "process_rss": 0}
    pid = pid_text.split()[0]
    status = target.shell(
        ["run-as", PACKAGE, "cat", f"/proc/{pid}/status"],
        check=False,
    ).stdout
    process_match = re.search(r"^VmRSS:\s+(\d+)\s+kB$", status, re.MULTILINE)
    meminfo = target.shell(["dumpsys", "meminfo", pid], check=False).stdout

    def summary_rss(label: str) -> int:
        match = re.search(rf"^\s*{re.escape(label)}:\s+\d+\s+(\d+)\s*$", meminfo, re.MULTILINE)
        return int(match.group(1)) if match is not None else 0

    return {
        "java_rss": summary_rss("Java Heap"),
        "native_rss": summary_rss("Native Heap"),
        "process_rss": int(process_match.group(1)) if process_match is not None else 0,
    }


def private_app_source_leaks(target: Any, needles: Sequence[bytes]) -> list[str]:
    listing = target.shell(
        ["run-as", PACKAGE, "find", "files", "shared_prefs", "databases", "-type", "f"],
        check=False,
    )
    leaks: list[str] = []
    for relative_path in listing.stdout.splitlines():
        content = app_bytes(target, relative_path.strip())
        if content is not None and any(needle in content for needle in needles):
            leaks.append(relative_path.strip())
    return leaks


def product_logs(target: Any) -> str:
    return target.run(
        ["logcat", "-d", "-v", "brief", "RSTorrentProduct:I", "*:S"],
        timeout=15,
        check=False,
    ).stdout


def product_saf_tree_active(logs: str) -> bool:
    return (
        "saf_tree_ready" in logs
        or "saf_root_health source=startup available=true" in logs
    )


def launch_product_ipv6_policy(target: Any, mode: str) -> None:
    result = target.shell(
        [
            "am",
            "start",
            "-S",
            "-W",
            "-n",
            ACTIVITY,
            "--es",
            "product_ipv6_policy",
            mode,
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in result.stdout or "Error:" in result.stderr or (
        result.returncode != 0 and "Starting:" not in result.stdout
    ):
        raise BootstrapFailure(
            f"could not exercise Android IPv6 policy mode {mode}: "
            f"code={result.returncode} stdout={result.stdout!r} stderr={result.stderr!r}"
        )


def wait_product_ipv6_policy(target: Any, mode: str) -> dict[str, str]:
    marker = f"ipv6_settings mode={mode} "
    deadline = time.monotonic() + 20
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        rows = [line for line in logs.splitlines() if marker in line]
        if rows:
            fields = dict(re.findall(r"([a-z_]+)=([^ ]+)", rows[-1]))
            if fields.get("application") == "APPLYING":
                time.sleep(0.2)
                continue
            return fields
        time.sleep(0.2)
    raise BootstrapFailure(f"timed out waiting for Android IPv6 policy {mode}\n{logs}")


def run_product_ipv6_policy_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    ordinal: int,
) -> dict[str, Any]:
    target.run(["logcat", "-c"], timeout=15, check=False)
    target.shell(
        ["pm", "grant", PACKAGE, "android.permission.POST_NOTIFICATIONS"],
        check=False,
    )
    launch_product_ipv6_policy(target, "disable_sequence")
    initial = wait_product_ipv6_policy(target, "initial")
    if initial.get("configured") != "true":
        raise BootstrapFailure("fresh Android profile did not default IPv6 to enabled")

    disabled = wait_product_ipv6_policy(target, "disabled")
    if not (
        disabled.get("configured") == "false"
        and disabled.get("effective") == "false"
        and disabled.get("application") == "APPLIED"
        and disabled.get("tcp") == "none"
        and disabled.get("udp") == "none"
    ):
        raise BootstrapFailure(f"Android IPv6 disable did not converge: {disabled}")

    target.shell(["am", "force-stop", PACKAGE], check=False)
    time.sleep(1)
    launch_product_ipv6_policy(target, "enable_sequence")
    restarted = wait_product_ipv6_policy(target, "restarted")
    if not (
        restarted.get("configured") == "false"
        and restarted.get("effective") == "false"
        and restarted.get("application") == "APPLIED"
    ):
        raise BootstrapFailure(f"Android IPv6 setting did not survive restart: {restarted}")

    enabled = wait_product_ipv6_policy(target, "reenabled")
    if enabled.get("configured") != "true" or enabled.get("application") not in (
        "APPLIED",
        "DEGRADED",
    ):
        raise BootstrapFailure(f"Android IPv6 re-enable did not terminate: {enabled}")
    if enabled.get("effective") == "false" and not (
        enabled.get("application") == "DEGRADED"
        and enabled.get("tcp") == "none"
        and enabled.get("udp") == "none"
    ):
        raise BootstrapFailure(
            f"Android absent IPv6 address did not degrade to IPv4-only: {enabled}"
        )

    target.shell(["am", "force-stop", PACKAGE], check=False)
    return {
        "target": target_kind,
        "profile": "product-ipv6-policy",
        "run": ordinal,
        "identity": identity,
        "fresh_default_enabled": True,
        "disabled_applied": True,
        "disabled_survived_restart": True,
        "reenabled_effective": enabled.get("effective") == "true",
        "reenabled_application": enabled.get("application"),
    }


def launch_product_unmetered_network_policy(target: Any, mode: str) -> None:
    result = target.shell(
        [
            "am",
            "start",
            "-W",
            "-n",
            ACTIVITY,
            "--es",
            "product_unmetered_network_policy",
            mode,
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in result.stdout or "Error:" in result.stderr or (
        result.returncode != 0 and "Starting:" not in result.stdout
    ):
        raise BootstrapFailure(
            f"could not exercise Android unmetered policy mode {mode}: "
            f"code={result.returncode} stdout={result.stdout!r} stderr={result.stderr!r}"
        )


def wait_product_unmetered_network_policy(
    target: Any,
    mode: str,
    *,
    timeout: float = 35,
) -> dict[str, str]:
    marker = f"network_policy mode={mode} "
    deadline = time.monotonic() + timeout
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        rows = [line for line in logs.splitlines() if marker in line]
        if rows:
            return dict(re.findall(r"([a-z_]+)=([^ ]+)", rows[-1]))
        if "product service initialization failed" in logs:
            break
        time.sleep(0.1)
    raise BootstrapFailure(
        f"timed out waiting for Android unmetered policy {mode}\n{logs}"
    )


def launch_product_lifecycle_evidence(target: Any, mode: str) -> dict[str, str]:
    result = target.shell(
        [
            "am",
            "start",
            "-W",
            "-n",
            ACTIVITY,
            "--es",
            "product_lifecycle_evidence",
            mode,
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in result.stdout or "Error:" in result.stderr or (
        result.returncode != 0 and "Starting:" not in result.stdout
    ):
        raise BootstrapFailure(
            f"could not exercise Android lifecycle mode {mode}: "
            f"code={result.returncode} stdout={result.stdout!r} "
            f"stderr={result.stderr!r}"
        )
    marker = f"lifecycle_evidence mode={mode} "
    deadline = time.monotonic() + 30
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        rows = [line for line in logs.splitlines() if marker in line]
        if rows:
            return dict(re.findall(r"([a-z_]+)=([^ ]+)", rows[-1]))
        time.sleep(0.1)
    raise BootstrapFailure(
        f"timed out waiting for lifecycle mode {mode}: "
        f"launch={result.stdout!r} stderr={result.stderr!r}\n{logs}"
    )


def product_service_state(target: Any) -> tuple[bool, bool]:
    dump = target.shell(
        ["dumpsys", "activity", "services", PACKAGE], timeout=20, check=False
    ).stdout
    rows = [line for line in dump.splitlines() if "ProductEngineService" in line]
    running = bool(rows) and "app=null" not in dump
    foreground = running and (
        "isForeground=true" in dump
        or "foregroundServiceType=0x1" in dump
        or "foregroundServiceType=1" in dump
    )
    return running, foreground


def wait_product_service_state(
    target: Any,
    *,
    running: bool,
    foreground: bool | None = None,
    timeout: float = 20,
) -> tuple[bool, bool]:
    deadline = time.monotonic() + timeout
    observed = (False, False)
    while time.monotonic() < deadline:
        observed = product_service_state(target)
        if observed[0] == running and (
            foreground is None or observed[1] == foreground
        ):
            return observed
        time.sleep(0.1)
    raise BootstrapFailure(
        "Android product service state did not converge: "
        f"expected running={running} foreground={foreground} observed={observed}\n"
        + target.shell(
            ["dumpsys", "activity", "services", PACKAGE],
            timeout=20,
            check=False,
        ).stdout
    )


def product_has_ongoing_notification(target: Any) -> bool:
    dump = target.shell(
        ["dumpsys", "notification", "--noredact"], timeout=20, check=False
    ).stdout
    return bool(
        re.search(
            rf"NotificationRecord\([^\n]*pkg={re.escape(PACKAGE)}[^\n]*id=42\b",
            dump,
        )
    )


def wait_product_pid_change(target: Any, previous: str, timeout: float = 30) -> str:
    deadline = time.monotonic() + timeout
    observed = ""
    while time.monotonic() < deadline:
        observed = target.shell(["pidof", PACKAGE], check=False).stdout.strip()
        if observed and observed != previous:
            return observed
        time.sleep(0.1)
    raise BootstrapFailure(
        f"Android product process did not restart: previous={previous!r} observed={observed!r}"
    )


def remove_product_task(target: Any) -> int:
    dump = target.shell(
        ["dumpsys", "activity", "activities", PACKAGE],
        timeout=20,
        check=False,
    ).stdout
    match = re.search(
        rf"Task(?:Record)?\{{[^\n]*#(\d+)[^\n]*A=(?:\d+:)?{re.escape(PACKAGE)}\b",
        dump,
    )
    if match is None:
        raise BootstrapFailure(f"could not identify the Android product task\n{dump}")
    task_id = int(match.group(1))
    size_dump = target.shell(["wm", "size"], timeout=10, check=False).stdout
    size_match = re.search(r"(?:Physical|Override) size: (\d+)x(\d+)", size_dump)
    if size_match is None:
        raise BootstrapFailure(f"could not identify the Android display size: {size_dump!r}")
    width, height = (int(value) for value in size_match.groups())
    target.shell(["input", "keyevent", "KEYCODE_APP_SWITCH"], check=False)
    time.sleep(0.75)
    removed = target.shell(
        [
            "input",
            "swipe",
            str(width // 2),
            str(height * 2 // 3),
            str(width // 2),
            str(height // 8),
            "350",
        ],
        timeout=20,
        check=False,
    )
    if removed.returncode != 0:
        raise BootstrapFailure(
            f"could not remove Android product task {task_id}: "
            f"stdout={removed.stdout!r} stderr={removed.stderr!r}"
        )
    return task_id


def maximum_product_verified_count(logs: str, torrent_id: str) -> int | None:
    pattern = re.compile(
        rf"view_update .*torrent={re.escape(torrent_id)} .*verified=(\d+)\b"
    )
    counts = [
        int(match.group(1))
        for line in logs.splitlines()
        if (match := pattern.search(line)) is not None
    ]
    return max(counts) if counts else None


def run_product_data_sync_quota_probe(target: Any) -> dict[str, Any]:
    namespace = "activity_manager"
    key = "data_sync_fgs_timeout_duration"
    original = target.shell(["device_config", "get", namespace, key]).stdout.strip()
    restored = ""
    try:
        changed = target.shell(
            ["device_config", "put", namespace, key, "1000"],
            timeout=20,
            check=False,
        )
        if changed.returncode != 0:
            raise BootstrapFailure(
                "could not shorten Android dataSync quota: "
                f"stdout={changed.stdout!r} stderr={changed.stderr!r}"
            )
        target.run(["logcat", "-c"], check=False)
        result = target.shell(
            [
                "am",
                "start",
                "-W",
                "-n",
                ACTIVITY,
                "--es",
                "product_lifecycle_evidence",
                "enable_background",
                "--ez",
                "product_quota_restart_evidence",
                "true",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in result.stdout or result.returncode != 0:
            raise BootstrapFailure(
                "could not start Android dataSync quota probe: "
                f"stdout={result.stdout!r} stderr={result.stderr!r}"
            )
        wait_product_log(
            target,
            "lifecycle_evidence mode=enable_background",
            "dataSync quota setup",
            timeout=30,
        )
        target.shell(["input", "keyevent", "KEYCODE_HOME"], check=False)
        wait_product_log(
            target,
            "product_service_timeout type=data_sync",
            "Android dataSync quota callback",
            timeout=15,
        )
        wait_product_log(
            target,
            "product_shutdown_complete reason=lifecycle_data_sync_timeout",
            "Android dataSync quota shutdown",
            timeout=15,
        )
        retry = wait_product_log(
            target,
            "product_quota_restart outcome=",
            "Android exhausted-quota restart",
            timeout=15,
        )
        match = re.search(r"product_quota_restart outcome=(\S+)", retry)
        outcome = match.group(1) if match is not None else "missing"
        if outcome == "accepted":
            wait_product_log(
                target,
                "product_quota_restart blocked=true",
                "exhausted dataSync product fence",
                timeout=15,
            )
            outcome = "accepted_then_product_blocked"
        elif outcome != "rejected_ForegroundServiceStartNotAllowedException":
            raise BootstrapFailure(
                f"Android exhausted dataSync quota had an unexpected result: {outcome}\n{retry}"
            )
        wait_product_service_state(target, running=False, timeout=30)
        if product_has_ongoing_notification(target):
            raise BootstrapFailure(
                "Android dataSync timeout left the ongoing notification active"
            )
        return {
            "duration_millis": 1_000,
            "timeout_callback": True,
            "joined_shutdown": True,
            "quota_restart": outcome,
            "service_running": False,
            "ongoing_notification": False,
        }
    finally:
        if original in ("", "null"):
            target.shell(
                ["device_config", "delete", namespace, key],
                timeout=20,
                check=False,
            )
        else:
            target.shell(
                ["device_config", "put", namespace, key, original],
                timeout=20,
                check=False,
            )
        restored = target.shell(
            ["device_config", "get", namespace, key],
            timeout=20,
            check=False,
        ).stdout.strip()
        if restored != original:
            raise BootstrapFailure(
                "Android dataSync quota override was not restored: "
                f"original={original!r} restored={restored!r}"
            )


def run_product_background_lifecycle_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if target_kind not in ("avd", "chromeos"):
        raise BootstrapFailure(
            "product-background-lifecycle requires an owned AVD or ChromeOS target"
        )
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-background-lifecycle requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    fixture = SeedFixture.create(
        interop,
        f"{target_kind}-product-background-lifecycle-{ordinal}",
        root_name=f"background-lifecycle-{ordinal}",
    )
    fixture.handle.set_upload_limit(8 * 1024)
    peer_transport: ReverseTransport | None = None
    torrent_id = "unallocated"
    output_root = f"{probe.grant_path(grant_storage)}/{fixture.name}"
    staging_root = f"{probe.grant_path(grant_storage)}/.unallocated.rstorrent-staging"
    part_path = f"{probe.grant_path(grant_storage)}/.unallocated.rstorrent-parts"
    verified_before_stop = 0
    verified_after_reopen = 0
    recovery_pid = ""
    uploaded_bytes = 0
    removed_task_id = None
    task_removal_retained = False

    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        default = launch_product_lifecycle_evidence(target, "observe")
        if not (
            default.get("background") == "false"
            and default.get("keep_seeding") == "false"
            and default.get("effective") == "false"
        ):
            raise BootstrapFailure(f"fresh lifecycle policy was not default-off: {default}")

        baseline_fds = product_fd_count(target)
        peer_transport = ReverseTransport.create(
            target, target_kind, fixture.host_port, ordinal
        )
        magnet = (
            f"magnet:?xt=urn:btih:{fixture.info_hash}"
            f"&dn={fixture.name}&x.pe=127.0.0.1:{peer_transport.device_port}"
        )
        add_count = product_add_count(target, fixture.info_hash)
        started = target.shell(
            ["am", "start", "-n", ACTIVITY, "--es", "product_magnet", shlex.quote(magnet)],
            timeout=30,
            check=False,
        )
        if "Error:" in started.stdout:
            raise BootstrapFailure("could not add background-lifecycle magnet")
        torrent_id = wait_product_torrent_id(target, fixture.info_hash, add_count)
        staging_root = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-staging"
        part_path = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-parts"
        try:
            wait_product_torrent_progress(
                target,
                torrent_id,
                state="DOWNLOADING",
                verified=1,
                description="background-lifecycle first verified piece",
                timeout=45,
            )
        except BootstrapFailure as error:
            fixture.alerts.extend(
                alert.message() for alert in fixture.session.pop_alerts()
            )
            seed_status = fixture.handle.status()
            reverse_mappings = target.run(
                ["reverse", "--list"], timeout=15, check=False
            ).stdout.strip()
            tunnel_status = (
                peer_transport.chrome_tunnel.poll()
                if peer_transport.chrome_tunnel is not None
                else None
            )
            raise BootstrapFailure(
                f"{error}\n"
                f"controlled_seed listening={fixture.session.is_listening()} "
                f"port={fixture.host_port} peers={seed_status.num_peers} "
                f"seeding={seed_status.is_seeding}\n"
                f"reverse_mappings={reverse_mappings!r} "
                f"chrome_tunnel_status={tunnel_status!r}\n"
                f"seed_alerts={fixture.alerts[-32:]!r}"
            ) from error
        verified_before_stop = 1

        target.run(["logcat", "-c"], check=False)
        target.shell(["input", "keyevent", "KEYCODE_HOME"], check=False)
        wait_product_log(
            target,
            "product_shutdown_complete reason=lifecycle_idle",
            "default-off Home shutdown",
            timeout=20,
        )
        wait_product_service_state(target, running=False)
        if product_has_ongoing_notification(target):
            raise BootstrapFailure("default-off shutdown retained the ongoing notification")

        target.run(["logcat", "-c"], check=False)
        reopened = target.shell(["am", "start", "-W", "-n", ACTIVITY], check=False)
        if "Error:" in reopened.stdout:
            raise BootstrapFailure("could not reopen the default-off lifecycle profile")
        logs = wait_product_log(
            target,
            f"view_update ",
            "reopened authoritative torrent snapshot",
            timeout=30,
        )
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            logs = product_logs(target)
            count = maximum_product_verified_count(logs, torrent_id)
            if count is not None:
                verified_after_reopen = max(verified_after_reopen, count)
                if verified_after_reopen >= verified_before_stop:
                    break
            time.sleep(0.1)
        if verified_after_reopen < verified_before_stop:
            raise BootstrapFailure(
                "foreground reopen lost verified progress: "
                f"before={verified_before_stop} after={verified_after_reopen}"
            )

        enabled = launch_product_lifecycle_evidence(target, "enable_background")
        if enabled.get("background") != "true" or enabled.get("effective") != "true":
            raise BootstrapFailure(f"background lifecycle did not enable: {enabled}")
        target.run(["logcat", "-c"], check=False)
        target.shell(["input", "keyevent", "KEYCODE_HOME"], check=False)
        wait_product_log(
            target,
            "decision=retain_active_download",
            "active background admission",
            timeout=20,
        )
        wait_product_service_state(target, running=True, foreground=True)
        if not product_has_ongoing_notification(target):
            raise BootstrapFailure("admitted background work had no ongoing notification")

        if int(identity["api"]) >= 35:
            target.run(["logcat", "-c"], check=False)
            removed_task_id = remove_product_task(target)
            wait_product_log(
                target,
                "product_task_removed background_admitted=true",
                "admitted background task removal",
                timeout=20,
            )
            wait_product_service_state(target, running=True, foreground=True)
            if not product_has_ongoing_notification(target):
                raise BootstrapFailure(
                    "admitted background task removal lost the ongoing notification"
                )
            task_removal_retained = True

        prior_pid = target.shell(["pidof", PACKAGE], check=False).stdout.strip()
        crashed = target.shell(["am", "crash", PACKAGE], timeout=20, check=False)
        if crashed.returncode != 0:
            raise BootstrapFailure(
                f"could not crash admitted AVD process: {crashed.stderr!r}"
            )
        recovery_pid = wait_product_pid_change(target, prior_pid)
        recovery_logs = wait_product_log(
            target,
            "lifecycle_recovery network_admitted=true reason=",
            "closed-network sticky recovery admission",
            timeout=30,
        )
        if not any(
            f"lifecycle_recovery network_admitted=true reason={reason}" in recovery_logs
            for reason in ("active_download", "waiting_for_unmetered_network")
        ):
            raise BootstrapFailure(
                "sticky recovery opened for an unexpected lifetime reason\n" + recovery_logs
            )
        wait_product_service_state(target, running=True, foreground=True)

        metrics, fd_high_water = wait_product_completion(
            target, torrent_id, baseline_fds
        )
        wait_product_log(
            target,
            "product_shutdown_complete reason=lifecycle_idle",
            "completion lifecycle shutdown",
            timeout=20,
        )
        wait_product_service_state(target, running=False)

        target.run(["logcat", "-c"], check=False)
        target.shell(["am", "start", "-W", "-n", ACTIVITY], check=False)
        wait_product_torrent_state(
            target,
            torrent_id,
            state="COMPLETE",
            description="complete torrent before seeding policy",
            timeout=30,
        )
        request_product_torrent_action(target, torrent_id, "enable_upload")
        launch_product_lifecycle_evidence(target, "enable_background")
        seeded = launch_product_lifecycle_evidence(target, "enable_seeding")
        if seeded.get("keep_seeding") != "true":
            raise BootstrapFailure(f"keep-seeding lifecycle did not enable: {seeded}")
        target.run(["logcat", "-c"], check=False)
        target.shell(["input", "keyevent", "KEYCODE_HOME"], check=False)
        wait_product_log(
            target,
            "decision=retain_background_seeding",
            "background seeding admission",
            timeout=20,
        )
        uploaded_bytes = verify_product_upload(target, fixture)

        launch_product_lifecycle_evidence(target, "disable_seeding")
        target.run(["logcat", "-c"], check=False)
        target.shell(["input", "keyevent", "KEYCODE_HOME"], check=False)
        wait_product_log(
            target,
            "product_shutdown_complete reason=lifecycle_idle",
            "seed-only lifecycle shutdown",
            timeout=20,
        )
        wait_product_service_state(target, running=False)

        target.shell(["am", "start", "-W", "-n", ACTIVITY], check=False)
        request_product_torrent_action(target, torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={torrent_id}",
            "background-lifecycle removal",
        )
        launch_product_lifecycle_evidence(target, "disable_background")

        quota = None
        if int(identity["api"]) >= 35:
            quota = run_product_data_sync_quota_probe(target)

        return {
            "target": target_kind,
            "profile": "product-background-lifecycle",
            "run": ordinal,
            "identity": identity,
            "torrent_id": torrent_id,
            "default_off_home_shutdown": True,
            "verified_before_stop": verified_before_stop,
            "verified_after_reopen": verified_after_reopen,
            "background_foreground_service": True,
            "task_removal_retained": task_removal_retained,
            "removed_task_id": removed_task_id,
            "sticky_recovery_pid": recovery_pid,
            "completion_shutdown": True,
            "keep_seeding_upload_bytes": uploaded_bytes,
            "seeding_disable_shutdown": True,
            "data_sync_quota": quota,
            "payload_hashes": "exact",
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        for exact_path in (output_root, staging_root, part_path):
            target.shell(["rm", "-rf", exact_path], check=False)
        probe.remove_grant_folder(target, grant_storage)
        if peer_transport is not None:
            peer_transport.close()
        fixture.close()


def set_avd_wifi_metered(target: Any, metered: bool) -> str:
    listing = target.shell(
        ["cmd", "netpolicy", "list", "wifi-networks"],
        timeout=15,
        check=False,
    )
    network_ids = [
        line.rsplit(";", 1)[0].strip()
        for line in listing.stdout.splitlines()
        if ";" in line and line.rsplit(";", 1)[0].strip()
    ]
    network_id = network_ids[0] if network_ids else "AndroidWifi"
    changed = target.shell(
        [
            "cmd",
            "netpolicy",
            "set",
            "metered-network",
            network_id,
            str(metered).lower(),
        ],
        timeout=15,
        check=False,
    )
    observed = target.shell(
        ["cmd", "netpolicy", "list", "wifi-networks"],
        timeout=15,
        check=False,
    ).stdout
    expected = f"{network_id};{str(metered).lower()}"
    if expected not in observed.splitlines():
        raise BootstrapFailure(
            f"could not set AVD Wi-Fi metered={metered}: "
            f"code={changed.returncode} stdout={changed.stdout!r} "
            f"stderr={changed.stderr!r} observed={observed!r}"
        )
    return network_id


def wait_product_text(
    target: Any,
    probe: ModuleType,
    expected: str,
    *,
    timeout: float = 20,
) -> None:
    deadline = time.monotonic() + timeout
    visible: list[str] = []
    while time.monotonic() < deadline:
        visible = [
            value
            for node in probe.ui_nodes(target)
            for value in (
                node.attrib.get("text", "").strip(),
                node.attrib.get("content-desc", "").strip(),
            )
            if value
        ]
        if any(expected in value for value in visible):
            return
        time.sleep(0.2)
    raise BootstrapFailure(
        f"Android product did not present {expected!r}; visible={visible!r}"
    )


def run_product_unmetered_network_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if target_kind != "avd":
        raise BootstrapFailure("product-unmetered-network is an owned-AVD profile")
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-unmetered-network requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    fixture = SeedFixture.create(
        interop,
        f"{target_kind}-product-unmetered-network-{ordinal}",
        root_name=f"network-running-{ordinal}",
    )
    paused_fixture = SeedFixture.create(
        interop,
        f"{target_kind}-product-unmetered-paused-{ordinal}",
        root_name=f"network-paused-{ordinal}",
        content_offset=interop.SELECTIVE_TOTAL_SIZE,
    )
    fixture.handle.set_upload_limit(8 * 1024)
    peer_transport: ReverseTransport | None = None
    torrent_id = "unallocated"
    paused_torrent_id = "unallocated"
    output_root = f"{probe.grant_path(grant_storage)}/{fixture.name}"
    staging_root = f"{probe.grant_path(grant_storage)}/.unallocated.rstorrent-staging"
    part_path = f"{probe.grant_path(grant_storage)}/.unallocated.rstorrent-parts"
    paused_output_root = f"{probe.grant_path(grant_storage)}/{paused_fixture.name}"
    paused_staging_root = (
        f"{probe.grant_path(grant_storage)}/.unallocated.rstorrent-staging"
    )
    paused_part_path = f"{probe.grant_path(grant_storage)}/.unallocated.rstorrent-parts"
    wifi_network_id = "AndroidWifi"
    peer_high_water = 0

    try:
        set_avd_wifi_metered(target, False)
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        launch_product_unmetered_network_policy(target, "default")
        default = wait_product_unmetered_network_policy(target, "default")
        if not (
            default.get("enabled") == "false"
            and default.get("allowed") == "true"
            and default.get("application") == "ALLOWED"
        ):
            raise BootstrapFailure(
                f"fresh Android unmetered policy was not default-off: {default}"
            )

        launch_product_unmetered_network_policy(target, "enable")
        enabled = wait_product_unmetered_network_policy(target, "enable")
        if not (
            enabled.get("enabled") == "true"
            and enabled.get("eligibility") == "UNRESTRICTED"
            and enabled.get("allowed") == "true"
            and enabled.get("application") == "ALLOWED"
        ):
            raise BootstrapFailure(
                f"unmetered Android network did not permit the engine: {enabled}"
            )

        baseline_fds = product_fd_count(target)
        peer_transport = ReverseTransport.create(
            target,
            target_kind,
            fixture.host_port,
            ordinal,
        )
        magnet = (
            f"magnet:?xt=urn:btih:{fixture.info_hash}"
            f"&dn={fixture.name}&x.pe=127.0.0.1:{peer_transport.device_port}"
        )
        add_count = product_add_count(target, fixture.info_hash)
        started = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_magnet",
                shlex.quote(magnet),
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in started.stdout:
            raise BootstrapFailure("could not add unmetered-network profile magnet")
        torrent_id = wait_product_torrent_id(target, fixture.info_hash, add_count)
        staging_root = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-staging"
        part_path = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-parts"
        wait_product_torrent_progress(
            target,
            torrent_id,
            state="DOWNLOADING",
            verified=1,
            description="first verified piece before metered transition",
            timeout=45,
        )
        peer_high_water = max(peer_high_water, peer_count(fixture))

        close_started = time.monotonic()
        wifi_network_id = set_avd_wifi_metered(target, True)
        launch_product_unmetered_network_policy(target, "metered")
        blocked = wait_product_unmetered_network_policy(target, "metered")
        close_millis = int((time.monotonic() - close_started) * 1000)
        if not (
            blocked.get("enabled") == "true"
            and blocked.get("eligibility") == "WAITING_FOR_UNMETERED_NETWORK"
            and blocked.get("allowed") == "false"
            and blocked.get("application") == "BLOCKED"
            and blocked.get("tcp") == "0"
            and blocked.get("udp") == "0"
            and blocked.get("connected_peers") == "0"
        ):
            raise BootstrapFailure(
                f"metered Android network did not quiesce the engine: {blocked}"
            )
        wait_product_text(target, probe, "Waiting for an unmetered network")
        time.sleep(0.5)
        blocked_upload = int(fixture.handle.status().total_upload)
        time.sleep(1)
        if int(fixture.handle.status().total_upload) != blocked_upload:
            raise BootstrapFailure("controlled payload advanced after blocked convergence")

        connections_before_restart = peer_count(fixture)
        target.shell(["am", "force-stop", PACKAGE], check=False)
        target.run(["logcat", "-c"], timeout=15, check=False)
        launch_product_unmetered_network_policy(target, "restart_metered")
        restarted = wait_product_unmetered_network_policy(target, "restart_metered")
        if not (
            restarted.get("enabled") == "true"
            and restarted.get("allowed") == "false"
            and restarted.get("application") == "BLOCKED"
            and restarted.get("tcp") == "0"
            and restarted.get("udp") == "0"
        ):
            raise BootstrapFailure(
                f"metered process restart did not start closed: {restarted}"
            )
        time.sleep(1)
        if int(fixture.handle.status().total_upload) != blocked_upload:
            raise BootstrapFailure("metered process restart transferred controlled payload")
        if peer_count(fixture) != connections_before_restart:
            raise BootstrapFailure("metered process restart opened a controlled peer")

        paused_add_count = product_unknown_add_count(target)
        paused_add = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_torrent_base64",
                base64.b64encode(paused_fixture.torrent_path.read_bytes()).decode("ascii"),
                "--ez",
                "product_start_content",
                "false",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in paused_add.stdout:
            raise BootstrapFailure("could not add paused network-policy torrent")
        paused_torrent_id = wait_product_unknown_torrent_id(
            target,
            paused_add_count,
        )
        paused_staging_root = (
            f"{probe.grant_path(grant_storage)}/"
            f".{paused_torrent_id}.rstorrent-staging"
        )
        paused_part_path = (
            f"{probe.grant_path(grant_storage)}/.{paused_torrent_id}.rstorrent-parts"
        )
        request_product_torrent_action(target, paused_torrent_id, "observe")
        if (
            f"torrent_state torrent={paused_torrent_id} state=PAUSED"
            not in product_logs(target)
        ):
            raise BootstrapFailure("new blocked torrent did not retain paused intent")
        paused_connections_before_block = peer_count(paused_fixture)

        allow_started = time.monotonic()
        set_avd_wifi_metered(target, False)
        launch_product_unmetered_network_policy(target, "unmetered")
        unmetered = wait_product_unmetered_network_policy(target, "unmetered")
        allow_millis = int((time.monotonic() - allow_started) * 1000)
        if not (
            unmetered.get("enabled") == "true"
            and unmetered.get("eligibility") == "UNRESTRICTED"
            and unmetered.get("allowed") == "true"
            and unmetered.get("application") == "ALLOWED"
        ):
            raise BootstrapFailure(
                f"unmetered Android recovery did not reopen the engine: {unmetered}"
            )
        def sample_resumed_peer() -> None:
            nonlocal peer_high_water
            peer_high_water = max(peer_high_water, peer_count(fixture))

        metrics, fd_high_water = wait_product_completion(
            target,
            torrent_id,
            baseline_fds,
            sample_resumed_peer,
        )
        request_product_torrent_action(target, paused_torrent_id, "observe")
        if (
            f"torrent_state torrent={paused_torrent_id} state=PAUSED"
            not in product_logs(target)
        ):
            raise BootstrapFailure("user-paused torrent changed intent after recovery")
        if (
            peer_count(paused_fixture) != paused_connections_before_block
            or int(paused_fixture.handle.status().total_upload) != 0
        ):
            raise BootstrapFailure("user-paused torrent resumed after network recovery")

        for relative_path, _, padding in fixture_files():
            path = f"{output_root}/{relative_path}"
            exists = target.shell(["test", "-f", path], check=False).returncode == 0
            if padding:
                if exists:
                    raise BootstrapFailure(
                        f"network-policy transfer created padding file {relative_path}"
                    )
                continue
            if not exists:
                raise BootstrapFailure(
                    f"network-policy output is absent: {relative_path}"
                )
            digest = target.shell(["sha1sum", path]).stdout.split()[0]
            if digest != fixture.expected_file_hashes[relative_path]:
                raise BootstrapFailure(
                    f"network-policy output hash differs: {relative_path}"
                )

        launch_product_unmetered_network_policy(target, "disable")
        disabled = wait_product_unmetered_network_policy(target, "disable")
        if not (
            disabled.get("enabled") == "false"
            and disabled.get("allowed") == "true"
            and disabled.get("application") == "ALLOWED"
        ):
            raise BootstrapFailure(
                f"Android unmetered policy did not disable cleanly: {disabled}"
            )
        request_product_torrent_action(target, torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={torrent_id}",
            "network-policy transfer removal",
        )
        request_product_torrent_action(target, paused_torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={paused_torrent_id}",
            "network-policy paused removal",
        )

        return {
            "target": target_kind,
            "profile": "product-unmetered-network",
            "run": ordinal,
            "identity": identity,
            "wifi_network_id": wifi_network_id,
            "torrent_id": torrent_id,
            "paused_torrent_id": paused_torrent_id,
            "pieces": len(fixture.piece_hashes),
            "blocked_after_verified_pieces": 1,
            "blocked_payload_bytes": blocked_upload,
            "close_convergence_millis": close_millis,
            "allow_convergence_millis": allow_millis,
            "peer_connections_high_water": peer_high_water,
            "peer_connections_terminal": peer_count(fixture),
            "paused_peer_connections": peer_count(paused_fixture),
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
            "default_off": True,
            "metered_restart_traffic": 0,
            "blocked_interval_traffic": 0,
            "automatic_resume": "complete",
            "paused_intent": "retained",
            "payload_hashes": "exact",
            "preference_restored": True,
        }
    finally:
        set_avd_wifi_metered(target, False)
        target.shell(["am", "force-stop", PACKAGE], check=False)
        for exact_path in (
            output_root,
            staging_root,
            part_path,
            paused_output_root,
            paused_staging_root,
            paused_part_path,
        ):
            target.shell(["rm", "-rf", exact_path], check=False)
        probe.remove_grant_folder(target, grant_storage)
        if peer_transport is not None:
            peer_transport.close()
        paused_fixture.close()
        fixture.close()


def start_product_tracker_evidence(target: Any, torrent_id: str) -> None:
    result = target.shell(
        [
            "am",
            "start",
            "-n",
            ACTIVITY,
            "--es",
            "product_tracker_evidence_torrent",
            torrent_id,
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in result.stdout:
        raise BootstrapFailure("could not start tracker evidence subscription")


def wait_product_tracker_row(
    target: Any,
    torrent_id: str,
    security: str,
    status: str,
    *,
    error: bool,
    timeout_seconds: float,
) -> str:
    start_product_tracker_evidence(target, torrent_id)
    marker = (
        f"tracker_evidence torrent={torrent_id} security={security} "
        f"status={status}"
    )
    error_marker = f"error={'true' if error else 'false'}"
    deadline = time.monotonic() + timeout_seconds
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        if any(
            marker in line and error_marker in line
            for line in logs.splitlines()
        ):
            return logs
        time.sleep(0.2)
    raise BootstrapFailure(
        "timed out waiting for Android tracker evidence "
        f"torrent={torrent_id} security={security} status={status} "
        f"error={error}\n{logs}"
    )


def dismiss_owned_product_disclosure(target: Any, probe: ModuleType) -> None:
    """Complete first use with statistics disabled in the owned test profile."""
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        nodes = probe.ui_nodes(target)
        labels = {node.attrib.get("text", "") for node in nodes}
        if "Save and continue" in labels:
            checked = next((node for node in nodes
                            if node.attrib.get("checkable") == "true"
                            and node.attrib.get("checked") == "true"), None)
            if checked is not None:
                x, y = probe.parse_bounds(checked.attrib["bounds"])
                target.shell(["input", "tap", str(x), str(y)])
            else:
                probe.click_from_nodes(target, nodes, ["Save and continue"])
        elif "Live" in labels:
            return
        time.sleep(0.2)
    raise BootstrapFailure("owned product disclosure did not reach the Live library")


def prepare_product_saf(target: Any, probe: ModuleType, grant_storage: str) -> None:
    deadline = time.monotonic() + 15
    while True:
        try:
            probe.prepare_grant_folder(target, grant_storage)
            break
        except probe.ProbeFailure:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.2)
    target.shell(
        ["pm", "grant", PACKAGE, "android.permission.POST_NOTIFICATIONS"],
        check=False,
    )
    selected = target.shell(
        [
            "am",
            "start",
            "-n",
            ACTIVITY,
            "--ez",
            "product_select_saf",
            "true",
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in selected.stdout or (
        selected.returncode != 0 and "Starting:" not in selected.stdout
    ):
        raise BootstrapFailure("could not launch product SAF picker")
    probe.automate_tree_grant(target, grant_storage)
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if app_text(target, "shared_prefs/product-saf.xml"):
            break
        time.sleep(0.2)
    else:
        raise BootstrapFailure("product SAF grant was not persisted")
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if product_saf_tree_active(product_logs(target)):
            # A startup reconciliation can make the selected root healthy
            # before MainActivity's service binding has completed. Fence that
            # binding before sending the next product intent so it cannot be
            # lost behind the still-finishing picker handoff.
            # The provider can persist its grant before DocumentsUI has
            # handed the activity back. Sending am start in that interval
            # can acknowledge delivery without reaching the product instance.
            resumed_deadline = time.monotonic() + 15
            while time.monotonic() < resumed_deadline:
                activities = target.shell(
                    ["dumpsys", "activity", "activities"], timeout=10,
                ).stdout
                if any(
                    "ResumedActivity" in line and ACTIVITY in line
                    for line in activities.splitlines()
                ):
                    break
                time.sleep(0.1)
            else:
                raise BootstrapFailure("SAF picker did not return to the resumed product activity")
            launch_product_lifecycle_evidence(target, "observe")
            dismiss_owned_product_disclosure(target, probe)
            return
        time.sleep(0.2)
    raise BootstrapFailure("product service did not activate the persisted SAF tree")


def launch_product_tracker_magnet(
    target: Any,
    magnet: str,
    policy: str,
    *,
    start_content: bool,
) -> None:
    command = [
        "am",
        "start",
        "-n",
        ACTIVITY,
        "--es",
        "product_magnet",
        shlex.quote(magnet),
        "--es",
        "product_tracker_https_policy",
        policy,
        "--ez",
        "product_start_content",
        "true" if start_content else "false",
    ]
    result = target.shell(command, timeout=30, check=False)
    if "Error:" in result.stdout or (
        result.returncode != 0 and "Starting:" not in result.stdout
    ):
        raise BootstrapFailure("could not add Android product tracker magnet")


def wait_product_completion(
    target: Any,
    torrent_id: str,
    baseline_fds: int,
    sample: Any | None = None,
) -> tuple[dict[str, int], int]:
    deadline = time.monotonic() + 90
    high_water_fds = baseline_fds
    metric_pattern = re.compile(
        rf"saf_direct_complete torrent={re.escape(torrent_id)} "
        r"limit=(\d+) owned_high_water=(\d+) pending_high_water=(\d+)"
    )
    logs = ""
    while time.monotonic() < deadline:
        if sample is not None:
            sample()
        high_water_fds = max(high_water_fds, product_fd_count(target))
        logs = target.run(
            ["logcat", "-d", "-v", "brief", "RSTorrentProduct:I", "*:S"],
            timeout=15,
            check=False,
        ).stdout
        if f"saf_direct_complete torrent={torrent_id}" in logs:
            match = metric_pattern.search(logs)
            if match is None:
                raise BootstrapFailure("direct SAF completion omitted storage metrics")
            return (
                {
                    "limit": int(match.group(1)),
                    "owned_high_water": int(match.group(2)),
                    "pending_high_water": int(match.group(3)),
                },
                high_water_fds,
            )
        if "product service initialization failed" in logs:
            raise BootstrapFailure(f"product service failed\n{logs}")
        time.sleep(0.2)
    raise BootstrapFailure(
        "direct SAF product download did not complete before timeout\n" + logs
    )


def automatic_notification_records(target: Any, tag_prefix: str) -> list[str]:
    dump = target.shell(
        ["dumpsys", "notification", "--noredact"], timeout=20, check=False
    ).stdout
    pattern = re.compile(
        rf"NotificationRecord\([^\n]* tag=({re.escape(tag_prefix)}[^ ]+) "
    )
    return pattern.findall(dump)


def wait_product_notification(
    target: Any,
    *,
    tag_prefix: str,
    title: str,
    body: str,
    timeout: float = 15,
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    dump = ""
    records: list[str] = []
    while time.monotonic() < deadline:
        dump = target.shell(
            ["dumpsys", "notification", "--noredact"],
            timeout=20,
            check=False,
        ).stdout
        records = automatic_notification_records(target, tag_prefix)
        if (
            len(records) == 1
            and f"android.title=String ({title})" in dump
            and f"android.text=String ({body})" in dump
        ):
            return {
                "count": 1,
                "tag": "opaque" if records[0].startswith(tag_prefix) else "invalid",
                "title": title,
                "body": body,
            }
        time.sleep(0.2)
    raise BootstrapFailure(
        "timed out waiting for exact Android notification "
        f"prefix={tag_prefix!r} title={title!r} body={body!r} "
        f"records={records!r}\n{dump}"
    )


def assert_no_product_notification(
    target: Any,
    tag_prefix: str,
    description: str,
    timeout: float = 5,
) -> None:
    deadline = time.monotonic() + timeout
    records: list[str] = []
    while time.monotonic() < deadline:
        records = automatic_notification_records(target, tag_prefix)
        if not records:
            return
        time.sleep(0.2)
    raise BootstrapFailure(f"{description} replayed notifications: {records!r}")


def activate_chromeos_notification(body: str) -> None:
    if os.environ.get("RSTORRENT_MANUAL_NOTIFICATION") != "1":
        raise BootstrapFailure(
            "ChromeOS notification activation requires a manual system-UI tap; "
            "rerun with RSTORRENT_MANUAL_NOTIFICATION=1"
        )
    input(
        "close the ChromeOS Files picker if it remains open, then manually "
        f"activate notification {body!r} and press Enter: "
    )


def tap_product_notification(
    target: Any,
    target_kind: str,
    probe: ModuleType,
    *,
    body: str,
    expected_text: str,
    timeout: float = 15,
) -> None:
    if target_kind == "chromeos":
        activate_chromeos_notification(body)
    else:
        target.shell(["cmd", "statusbar", "expand-notifications"], check=False)
        deadline = time.monotonic() + timeout
        visible: list[str] = []
        while time.monotonic() < deadline:
            nodes = probe.ui_nodes(target)
            visible = [
                value
                for node in nodes
                for value in (
                    node.attrib.get("text", "").strip(),
                    node.attrib.get("content-desc", "").strip(),
                )
                if value
            ]
            if probe.click_from_nodes(target, nodes, [body]):
                break
            time.sleep(0.2)
        else:
            raise BootstrapFailure(
                f"could not tap notification body {body!r}; visible={visible!r}"
            )

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        activity = target.shell(
            ["dumpsys", "activity", "activities"], timeout=20, check=False
        ).stdout
        nodes = probe.ui_nodes(target)
        text = {
            value
            for node in nodes
            for value in (
                node.attrib.get("text", "").strip(),
                node.attrib.get("content-desc", "").strip(),
            )
            if value
        }
        if PACKAGE in activity and expected_text in text:
            return
        time.sleep(0.2)
    raise BootstrapFailure(
        f"notification tap did not reach {expected_text!r}; "
        f"visible={sorted(text)!r} package_active={PACKAGE in activity}"
    )


def wait_product_log(target: Any, marker: str, description: str, timeout: float = 20) -> str:
    deadline = time.monotonic() + timeout
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        if marker in logs:
            return logs
        if "product service initialization failed" in logs:
            break
        time.sleep(0.1)
    raise BootstrapFailure(f"timed out waiting for {description}\n{logs}")


def wait_product_torrent_progress(
    target: Any,
    torrent_id: str,
    *,
    state: str,
    verified: int,
    description: str,
    timeout: float = 30,
) -> str:
    pattern = re.compile(
        rf"torrent={re.escape(torrent_id)} .*state={re.escape(state)} .*verified={verified}\b"
    )
    deadline = time.monotonic() + timeout
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        if any(pattern.search(line) for line in logs.splitlines()):
            return logs
        if "product service initialization failed" in logs:
            break
        time.sleep(0.1)
    raise BootstrapFailure(f"timed out waiting for {description}\n{logs}")


def wait_product_torrent_state(
    target: Any,
    torrent_id: str,
    *,
    state: str,
    description: str,
    timeout: float = 30,
) -> str:
    pattern = re.compile(
        rf"torrent={re.escape(torrent_id)} .*state={re.escape(state)}\b"
    )
    deadline = time.monotonic() + timeout
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        if any(pattern.search(line) for line in logs.splitlines()):
            return logs
        if "product service initialization failed" in logs:
            break
        time.sleep(0.1)
    relevant = "\n".join(
        line
        for line in logs.splitlines()
        if f"torrent={torrent_id}" in line
        or "product service initialization failed" in line
    )
    raise BootstrapFailure(
        f"timed out waiting for {description}; torrent={torrent_id}\n{relevant}"
    )


def wait_product_torrent_diagnostic(
    target: Any,
    torrent_id: str,
    *,
    diagnostic: str,
    description: str,
    timeout: float = 30,
) -> str:
    pattern = re.compile(
        rf"torrent={re.escape(torrent_id)} .*diagnostic={re.escape(diagnostic)}\b"
    )
    deadline = time.monotonic() + timeout
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        if any(pattern.search(line) for line in logs.splitlines()):
            return logs
        if "product service initialization failed" in logs:
            break
        time.sleep(0.1)
    raise BootstrapFailure(f"timed out waiting for {description}\n{logs}")


def wait_v2_proxy_candidate(
    proxy: Any,
    *,
    selected_pieces: int,
    description: str,
    timeout: float = 30,
) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    snapshot: dict[str, object] = {}
    while time.monotonic() < deadline:
        snapshot = proxy.snapshot()
        pieces = {piece for piece, _, _ in snapshot["piece_messages"]}
        if snapshot["hash_requests"] and 0 < len(pieces) < selected_pieces:
            return snapshot
        time.sleep(0.02)
    raise BootstrapFailure(f"timed out waiting for {description}: {snapshot}")


def product_add_count(target: Any, v1_info_hash: str) -> int:
    pattern = re.compile(
        rf"torrent_added torrent=t1-[0-9a-f]{{32}} "
        rf"protocol_v1={re.escape(v1_info_hash)}\b"
    )
    return len(pattern.findall(product_logs(target)))


def wait_product_torrent_id(
    target: Any,
    v1_info_hash: str,
    previous_count: int,
    timeout: float = 20,
) -> str:
    pattern = re.compile(
        rf"torrent_added torrent=(t1-[0-9a-f]{{32}}) "
        rf"protocol_v1={re.escape(v1_info_hash)}\b"
    )
    deadline = time.monotonic() + timeout
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        matches = pattern.findall(logs)
        if len(matches) > previous_count:
            return matches[previous_count]
        if "product service initialization failed" in logs:
            break
        time.sleep(0.1)
    raise BootstrapFailure(
        "timed out waiting for allocated Android torrent owner "
        f"for v1={v1_info_hash}\n{logs}"
    )


def product_unknown_add_count(target: Any) -> int:
    pattern = re.compile(
        r"torrent_added torrent=t1-[0-9a-f]{32} protocol_v1=unknown\b"
    )
    return len(pattern.findall(product_logs(target)))


def wait_product_unknown_torrent_id(
    target: Any,
    previous_count: int,
    timeout: float = 20,
) -> str:
    pattern = re.compile(
        r"torrent_added torrent=(t1-[0-9a-f]{32}) protocol_v1=unknown\b"
    )
    deadline = time.monotonic() + timeout
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        matches = pattern.findall(logs)
        if len(matches) > previous_count:
            return matches[previous_count]
        if "product service initialization failed" in logs:
            break
        time.sleep(0.1)
    raise BootstrapFailure(
        "timed out waiting for an exact-byte Android torrent owner\n" + logs
    )


def request_product_torrent_action(target: Any, torrent_id: str, action: str) -> None:
    result = target.shell(
        [
            "am",
            "start",
            "-n",
            ACTIVITY,
            "--es",
            "product_torrent_id",
            torrent_id,
            "--es",
            "product_torrent_action",
            action,
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in result.stdout or (
        result.returncode != 0 and "Starting:" not in result.stdout
    ):
        raise BootstrapFailure(f"could not request product torrent action {action}")
    wait_product_log(
        target,
        f"torrent_action_completed torrent={torrent_id} action={action}",
        f"product torrent action {action}",
    )


def request_product_media_action(target: Any, torrent_id: str, action: str) -> None:
    result = target.shell(
        [
            "am",
            "broadcast",
            "-a",
            "org.rstorrent.bootstrap.PRODUCT_TEST",
            "-n",
            f"{PACKAGE}/.ProductTestReceiver",
            "--es",
            "torrent_id",
            torrent_id,
            "--es",
            "torrent_action",
            action,
        ],
        timeout=30,
        check=False,
    )
    if "result=0" not in result.stdout or result.returncode != 0:
        raise BootstrapFailure(f"could not request product media action {action}")
    wait_product_log(
        target,
        f"torrent_action_completed torrent={torrent_id} action={action}",
        f"product media action {action}",
    )


def verify_product_upload(
    target: Any,
    fixture: SeedFixture,
    *,
    pure_v2: ModuleType | None = None,
    magnet_only: bool = False,
    expect_hybrid_upgrade: bool = False,
    device_port: int = 6881,
    leech_timeout_seconds: int = 30,
) -> int:
    if (
        not isinstance(leech_timeout_seconds, int)
        or isinstance(leech_timeout_seconds, bool)
        or not 1 <= leech_timeout_seconds <= 300
    ):
        raise BootstrapFailure("Android upload leech budget must be 1..300 seconds")
    import libtorrent as lt

    forwarded = target.run(
        ["forward", "tcp:0", f"tcp:{device_port}"], timeout=20, check=False
    )
    if forwarded.returncode != 0:
        raise BootstrapFailure(f"could not forward Android upload listener: {forwarded.stderr}")
    host_port_text = forwarded.stdout.strip()
    if not host_port_text.isdigit():
        raise BootstrapFailure(f"adb did not report an upload forward port: {host_port_text!r}")
    host_port = int(host_port_text)
    chrome_forward = None
    target_host = getattr(target, "host", None)
    output_root = Path(tempfile.mkdtemp(prefix="rstorrent-android-upload-"))
    session = lt.session(
        {
            "listen_interfaces": "127.0.0.1:0",
            "enable_dht": False,
            "enable_lsd": False,
            "enable_upnp": False,
            "enable_natpmp": False,
            "enable_incoming_utp": False,
            "enable_outgoing_utp": False,
            "enable_incoming_tcp": False,
            "enable_outgoing_tcp": True,
            "in_enc_policy": int(lt.enc_policy.pe_disabled),
            "out_enc_policy": int(lt.enc_policy.pe_disabled),
            "alert_queue_size": 1000,
            "alert_mask": int(lt.alert.category_t.error_notification)
            | int(lt.alert.category_t.status_notification)
            | int(lt.alert.category_t.connect_notification)
            | int(lt.alert.category_t.peer_notification),
        }
    )
    handle = None
    hash_proxy = None
    diagnostics: list[str] = []
    try:
        if isinstance(target_host, str):
            chrome_forward = ChromeForwardTransport.create(target_host, host_port)
        peer_port = (
            chrome_forward.local_port if chrome_forward is not None else host_port
        )
        if pure_v2 is not None:
            hash_proxy = pure_v2.PlaintextBep52Proxy(("127.0.0.1", peer_port))
            peer_port = hash_proxy.endpoint[1]
        if magnet_only:
            worker = repository_root() / "tests" / "interop" / "controlled_libtorrent_leech.py"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(worker),
                    "--magnet",
                    f"magnet:?xt=urn:btmh:1220{fixture.info_hash}",
                    "--peer-host",
                    "127.0.0.1",
                    "--peer-port",
                    str(peer_port),
                    "--output",
                    str(output_root),
                ],
                cwd=repository_root(),
                capture_output=True,
                text=True,
                timeout=45,
                check=False,
            )
            if completed.returncode != 0:
                raise BootstrapFailure(
                    "isolated libtorrent Android upload leech failed\n"
                    f"stdout:\n{completed.stdout}\nstderr:\n{completed.stderr}"
                )
            try:
                report = json.loads(completed.stdout.strip().splitlines()[-1])
            except (IndexError, json.JSONDecodeError) as error:
                raise BootstrapFailure(
                    f"isolated libtorrent leecher returned invalid evidence: {completed.stdout!r}"
                ) from error
            downloaded = int(report["payload_download"])
        else:
            parameters = lt.add_torrent_params()
            parameters.ti = lt.torrent_info(str(fixture.torrent_path))
            parameters.save_path = str(output_root)
            parameters.flags &= ~lt.torrent_flags.paused
            parameters.flags &= ~lt.torrent_flags.auto_managed
            handle = session.add_torrent(parameters)
            handle.connect_peer(("127.0.0.1", peer_port))
            deadline = time.monotonic() + leech_timeout_seconds
            next_sample = time.monotonic()
            while time.monotonic() < deadline:
                diagnostics.extend(alert.message() for alert in session.pop_alerts())
                diagnostics = diagnostics[-100:]
                status = handle.status()
                if time.monotonic() >= next_sample:
                    print(
                        json.dumps({
                            "stage": "android_upload_leech",
                            "payload_download": int(status.total_payload_download),
                            "peers": int(status.num_peers),
                            "complete": bool(status.is_seeding),
                        }),
                        file=sys.stderr,
                        flush=True,
                    )
                    next_sample = time.monotonic() + 5
                if status.errc.value() != 0:
                    raise BootstrapFailure(
                        f"Android upload leech failed: {status.errc.message()}"
                    )
                if status.is_seeding:
                    break
                time.sleep(0.02)
            else:
                status = handle.status()
                raise BootstrapFailure(
                    f"libtorrent did not complete from Android SAF storage within {leech_timeout_seconds}s; "
                    f"payload={int(status.total_payload_download)} peers={int(status.num_peers)} "
                    f"tunnel_exit={chrome_forward.process.poll() if chrome_forward else None}\n"
                    + "\n".join(diagnostics[-30:])
                )
            downloaded = int(handle.status().total_payload_download)
        for relative_path, expected_hash in fixture.expected_file_hashes.items():
            actual_path = output_root / fixture.name / relative_path
            if not actual_path.is_file():
                raise BootstrapFailure(f"Android upload omitted {relative_path}")
            actual_hash = hashlib.sha1(actual_path.read_bytes()).hexdigest()
            if actual_hash != expected_hash:
                raise BootstrapFailure(f"Android upload hash differs: {relative_path}")
        if downloaded <= 0:
            raise BootstrapFailure("libtorrent received no payload from Android")
        if hash_proxy is not None:
            wire = hash_proxy.snapshot()
            handshakes = wire["handshakes"]
            if expect_hybrid_upgrade:
                offered = [
                    row
                    for row in handshakes
                    if row.get("direction") == "client"
                    and row.get("info_hash") == fixture.wire_info_hash
                    and row.get("hybrid_v2") is True
                ]
                accepted = [
                    row
                    for row in handshakes
                    if row.get("direction") == "upstream"
                    and row.get("info_hash") == fixture.info_hash[:40]
                ]
                if not offered or not accepted:
                    raise BootstrapFailure(
                        "Android hybrid upload omitted the exact v1-to-v2 upgrade: "
                        f"{wire}"
                    )
            else:
                direct_v2 = [
                    row
                    for row in handshakes
                    if row.get("direction") == "client"
                    and row.get("info_hash") == fixture.info_hash[:40]
                ]
                if not direct_v2:
                    raise BootstrapFailure(
                        "Android v2 upload omitted direct-v2 incoming routing: "
                        f"{wire}"
                    )
            if not expect_hybrid_upgrade and (
                not wire["hash_requests"] or wire["hash_responses"] < 1
            ):
                raise BootstrapFailure(
                    "Android v2 magnet upload omitted authenticated hash service: "
                    f"{wire}"
                )
        return downloaded
    finally:
        if handle is not None and handle.is_valid():
            session.remove_torrent(handle)
        session.pause()
        handle = None
        session = None
        if hash_proxy is not None:
            hash_proxy.close()
        target.run(["forward", "--remove", f"tcp:{host_port}"], timeout=15, check=False)
        if chrome_forward is not None:
            tunnel_detail = chrome_forward.close()
            if tunnel_detail:
                print(json.dumps({"stage": "android_upload_tunnel_joined", "stderr": tunnel_detail}), file=sys.stderr, flush=True)
        shutil.rmtree(output_root)


def run_product_dynamic_saf_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    ordinal: int,
    storage: str,
    tracker_support: ModuleType | None = None,
    identity_reset: bool = False,
) -> dict[str, Any]:
    profile = (
        "product-https-tracker"
        if tracker_support is not None
        else "product-identity-reset"
        if identity_reset
        else "product-dynamic-saf"
    )
    if not storage.startswith("saf-"):
        raise BootstrapFailure(f"{profile} requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    fixture = SeedFixture.create(interop, f"{target_kind}-{profile}-{ordinal}")
    peer_transport: ReverseTransport | None = None
    tracker_transport: ReverseTransport | None = None
    controlled_tracker: Any | None = None
    output_root = f"{probe.grant_path(grant_storage)}/{fixture.name}"
    staging_root = f"{probe.grant_path(grant_storage)}/.{fixture.name}.rstorrent-staging"
    part_path = f"{probe.grant_path(grant_storage)}/.{fixture.name}.rstorrent-parts"
    unrelated_path = f"{output_root}/unrelated-sentinel.bin"
    unrelated_content = b"unrelated-descendant-survives-exact-removal"
    unrelated_hash = hashlib.sha256(unrelated_content).hexdigest()
    reset_sentinels: dict[str, str] = {}

    def assert_exact_data_removed() -> None:
        for relative_path, _, padding in fixture_files():
            if padding:
                continue
            path = f"{output_root}/{relative_path}"
            if target.shell(["test", "-e", path], check=False).returncode == 0:
                raise BootstrapFailure(f"metainfo file survived removal: {relative_path}")
        for hidden_path in (staging_root, part_path):
            if target.shell(["test", "-e", hidden_path], check=False).returncode == 0:
                raise BootstrapFailure(f"side artifact survived removal: {hidden_path}")
        digest = target.shell(["sha256sum", unrelated_path]).stdout.split()[0]
        if digest != unrelated_hash:
            raise BootstrapFailure("removal changed an unrelated descendant")

    try:
        clear_application(target)
        probe.prepare_grant_folder(target, grant_storage)
        if identity_reset:
            legacy_database = fixture.run_path / "schema-21-session.db"
            with sqlite3.connect(legacy_database) as connection:
                connection.execute(
                    "CREATE TABLE request_receipts(request_id TEXT PRIMARY KEY)"
                )
                connection.execute(
                    "INSERT INTO request_receipts VALUES ('legacy-request')"
                )
                connection.execute("PRAGMA user_version = 21")
            remote_database = f"/data/local/tmp/rstorrent-schema21-{ordinal}.db"
            push_local_file(
                target,
                target_kind,
                legacy_database,
                remote_database,
            )
            target.shell(
                ["run-as", PACKAGE, "mkdir", "-p", "files/product-profile"]
            )
            target.shell(
                [
                    "run-as",
                    PACKAGE,
                    "cp",
                    remote_database,
                    "files/product-profile/session.db",
                ]
            )
            target.shell(["rm", remote_database], check=False)
            for name, content in (
                ("existing-final-sentinel.bin", b"final-content-before-schema-reset"),
                (
                    ".legacy-owner.rstorrent-staging",
                    b"legacy-staging-before-schema-reset",
                ),
                (
                    ".t1-11111111111111111111111111111111.rstorrent-parts",
                    b"partial-before-schema-reset",
                ),
                ("unrelated-root-sentinel.bin", b"unrelated-before-schema-reset"),
            ):
                source = fixture.run_path / name
                source.write_bytes(content)
                destination = f"{probe.grant_path(grant_storage)}/{name}"
                push_local_file(target, target_kind, source, destination)
                reset_sentinels[destination] = hashlib.sha256(content).hexdigest()
        target.shell(
            ["pm", "grant", PACKAGE, "android.permission.POST_NOTIFICATIONS"],
            check=False,
        )
        selected = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--ez",
                "product_select_saf",
                "true",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in selected.stdout or (
            selected.returncode != 0 and "Starting:" not in selected.stdout
        ):
            raise BootstrapFailure(
                "could not launch product SAF picker: "
                f"code={selected.returncode} stdout={selected.stdout} stderr={selected.stderr}"
            )
        probe.automate_tree_grant(target, grant_storage)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if app_text(target, "shared_prefs/product-saf.xml"):
                break
            time.sleep(0.2)
        else:
            raise BootstrapFailure("product SAF grant was not persisted")

        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            logs = target.run(
                ["logcat", "-d", "-v", "brief", "RSTorrentProduct:I", "*:S"],
                timeout=15,
                check=False,
            ).stdout
            if product_saf_tree_active(logs):
                break
            time.sleep(0.2)
        else:
            raise BootstrapFailure("product service did not activate the persisted SAF tree")
        if identity_reset:
            wait_product_log(
                target,
                "diagnostic=profile_catalog_reset",
                "schema 21 direct-storage catalog reset",
            )
            for path, expected_hash in reset_sentinels.items():
                actual_hash = target.shell(["sha256sum", path]).stdout.split()[0]
                if actual_hash != expected_hash:
                    raise BootstrapFailure(
                        f"schema reset modified external sentinel {path}"
                    )

        baseline_fds = product_fd_count(target)
        peer_transport = ReverseTransport.create(
            target,
            target_kind,
            fixture.host_port,
            ordinal,
        )
        if tracker_support is None:
            magnet = (
                f"magnet:?xt=urn:btih:{fixture.info_hash}"
                f"&dn={fixture.name}&x.pe=127.0.0.1:{peer_transport.device_port}"
            )
        else:
            controlled_tracker = tracker_support.ControlledHttpTracker(
                fixture.info_hash,
                peer_transport.device_port,
                https=True,
                certificate_root=fixture.run_path / "tracker-certificate",
            )
            controlled_tracker.start()
            tracker_transport = ReverseTransport.create(
                target,
                target_kind,
                controlled_tracker.port,
                ordinal,
                slot=1,
            )
            tracker_url = controlled_tracker.url_for_port(
                tracker_transport.device_port
            )
            magnet = (
                f"magnet:?xt=urn:btih:{fixture.info_hash}"
                f"&dn={fixture.name}&tr={quote(tracker_url, safe='')}"
            )
        start_command = [
            "am",
            "start",
            "-n",
            ACTIVITY,
            "--es",
            "product_magnet",
            shlex.quote(magnet),
        ]
        if controlled_tracker is not None:
            start_command.extend(
                ["--es", "product_tracker_https_policy", "disabled"]
            )
        add_count = product_add_count(target, fixture.info_hash)
        started = target.shell(
            start_command,
            timeout=30,
            check=False,
        )
        if "Error:" in started.stdout or (
            started.returncode != 0 and "Starting:" not in started.stdout
        ):
            raise BootstrapFailure(
                "could not add product magnet: "
                f"code={started.returncode} stdout={started.stdout} stderr={started.stderr}"
            )
        torrent_id = wait_product_torrent_id(target, fixture.info_hash, add_count)
        staging_root = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-staging"
        part_path = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-parts"
        metrics, fd_high_water = wait_product_completion(
            target,
            torrent_id,
            baseline_fds,
        )
        if controlled_tracker is not None:
            controlled_tracker.wait_for_event("started")
            evidence = target.shell(
                [
                    "am",
                    "start",
                    "-n",
                    ACTIVITY,
                    "--es",
                    "product_tracker_evidence_torrent",
                    torrent_id,
                ],
                timeout=30,
                check=False,
            )
            if "Error:" in evidence.stdout:
                raise BootstrapFailure("could not start tracker evidence subscription")
            deadline = time.monotonic() + 10
            logs = ""
            while time.monotonic() < deadline:
                logs = target.run(
                    ["logcat", "-d", "-v", "brief", "RSTorrentProduct:I", "*:S"],
                    timeout=15,
                    check=False,
                ).stdout
                if (
                    "security=ENCRYPTED_UNAUTHENTICATED" in logs
                    and "status=REANNOUNCE_WAIT" in logs
                ):
                    break
                time.sleep(0.2)
            if (
                "tracker_https_settings configured=DISABLED "
                "effective=DISABLED application=APPLIED" not in logs
            ):
                raise BootstrapFailure(
                    "Android product did not apply disabled tracker authentication"
                )
            if (
                "security=ENCRYPTED_UNAUTHENTICATED" not in logs
                or "status=REANNOUNCE_WAIT" not in logs
            ):
                raise BootstrapFailure(
                    "Android product did not project the completed unauthenticated HTTPS row\n"
                    + logs
                )
        if metrics["limit"] != 40:
            raise BootstrapFailure(f"unexpected storage handle limit: {metrics}")
        if metrics["owned_high_water"] > metrics["limit"]:
            raise BootstrapFailure(f"storage handle limit was exceeded: {metrics}")
        if metrics["pending_high_water"] > 16:
            raise BootstrapFailure(f"platform request queue bound was exceeded: {metrics}")
        if baseline_fds and fd_high_water - baseline_fds > 48:
            raise BootstrapFailure(
                "process descriptor delta exceeded Rust plus provider bounds: "
                f"baseline={baseline_fds} high_water={fd_high_water}"
            )

        for relative_path, _, padding in fixture_files():
            path = f"{output_root}/{relative_path}"
            exists = target.shell(["test", "-f", path], check=False).returncode == 0
            if padding:
                if exists:
                    raise BootstrapFailure(f"padding file was created: {relative_path}")
                continue
            if not exists:
                raise BootstrapFailure(f"product output is absent: {relative_path}")
            digest = target.shell(["sha1sum", path]).stdout.split()[0]
            if digest != fixture.expected_file_hashes[relative_path]:
                raise BootstrapFailure(f"product output hash differs: {relative_path}")
        for unexpected in (
            staging_root,
            part_path,
            f"{probe.grant_path(grant_storage)}/{torrent_id}",
            f"{probe.grant_path(grant_storage)}/{fixture.info_hash}",
        ):
            if target.shell(["test", "-e", unexpected], check=False).returncode == 0:
                raise BootstrapFailure(f"unexpected managed artifact survived: {unexpected}")

        target.shell(["am", "force-stop", PACKAGE], check=False)
        target.run(["logcat", "-c"], check=False)
        restarted = target.shell(["am", "start", "-n", ACTIVITY], timeout=30, check=False)
        if "Error:" in restarted.stdout:
            raise BootstrapFailure("could not restart the Android product application")
        wait_product_log(
            target,
            "saf_root_health source=startup available=true",
            "healthy SAF root after process restart",
        )
        restart_logs = wait_product_torrent_state(
            target,
            torrent_id,
            state="COMPLETE",
            description="complete torrent after restart recheck",
            timeout=30,
        )
        if (
            f"torrent={torrent_id}" not in restart_logs
            or "state=AWAITING_STORAGE" not in restart_logs
            or "verified=0" not in restart_logs
            or f"verified={len(fixture.piece_hashes)}" not in restart_logs
        ):
            raise BootstrapFailure(
                "restart did not expose conservative verification reconstruction"
            )
        if identity_reset and "diagnostic=profile_catalog_reset" in restart_logs:
            raise BootstrapFailure("acknowledged schema reset report replayed on restart")

        request_product_torrent_action(target, torrent_id, "force_recheck")
        request_product_torrent_action(target, torrent_id, "enable_upload")
        uploaded_bytes = verify_product_upload(target, fixture)

        unrelated_source = fixture.run_path / "unrelated-sentinel.bin"
        unrelated_source.write_bytes(unrelated_content)
        push_local_file(target, target_kind, unrelated_source, unrelated_path)

        request_product_torrent_action(target, torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={torrent_id}",
            "application-owned SAF removal",
        )
        assert_exact_data_removed()

        target.run(["logcat", "-c"], check=False)
        add_count = 0
        selected = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_magnet",
                shlex.quote(magnet),
                "--es",
                "product_skip_files",
                "1",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in selected.stdout:
            raise BootstrapFailure("could not start selective product download")
        selective_torrent_id = wait_product_torrent_id(
            target, fixture.info_hash, add_count
        )
        staging_root = (
            f"{probe.grant_path(grant_storage)}/"
            f".{selective_torrent_id}.rstorrent-staging"
        )
        part_path = (
            f"{probe.grant_path(grant_storage)}/"
            f".{selective_torrent_id}.rstorrent-parts"
        )
        wait_product_completion(
            target, selective_torrent_id, product_fd_count(target)
        )
        for file_index, (relative_path, _, padding) in enumerate(fixture_files()):
            path = f"{output_root}/{relative_path}"
            exists = target.shell(["test", "-f", path], check=False).returncode == 0
            if padding or file_index == 1:
                if exists:
                    raise BootstrapFailure(f"selective product created {relative_path}")
                continue
            if not exists:
                raise BootstrapFailure(f"selective product omitted {relative_path}")
            digest = target.shell(["sha1sum", path]).stdout.split()[0]
            if digest != fixture.expected_file_hashes[relative_path]:
                raise BootstrapFailure(f"selective product hash differs: {relative_path}")
        if target.shell(["test", "-f", part_path], check=False).returncode != 0:
            raise BootstrapFailure("selective SAF download omitted its boundary part file")
        request_product_torrent_action(target, selective_torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={selective_torrent_id}",
            "selective SAF removal",
        )
        assert_exact_data_removed()

        target.run(["logcat", "-c"], check=False)
        add_count = 0
        fixture.handle.set_upload_limit(4 * 1024)
        cancelling = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_magnet",
                shlex.quote(magnet),
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in cancelling.stdout:
            raise BootstrapFailure("could not start cancellable product download")
        cancelling_torrent_id = wait_product_torrent_id(
            target, fixture.info_hash, add_count
        )
        staging_root = (
            f"{probe.grant_path(grant_storage)}/"
            f".{cancelling_torrent_id}.rstorrent-staging"
        )
        part_path = (
            f"{probe.grant_path(grant_storage)}/"
            f".{cancelling_torrent_id}.rstorrent-parts"
        )
        wait_product_torrent_state(
            target,
            cancelling_torrent_id,
            state="DOWNLOADING",
            description="active product download before cancellation",
        )
        request_product_torrent_action(target, cancelling_torrent_id, "pause")
        request_product_torrent_action(target, cancelling_torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={cancelling_torrent_id}",
            "cancelled SAF cleanup",
        )
        fixture.handle.set_upload_limit(0)
        assert_exact_data_removed()

        return {
            "target": target_kind,
            "profile": profile,
            "run": ordinal,
            "identity": identity,
            "torrent_id": torrent_id,
            "v1_info_hash": fixture.info_hash,
            "content_name": fixture.name,
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
            "peer_connections": peer_count(fixture),
            "restart_recheck": "complete",
            "force_recheck": "complete",
            "uploaded_bytes": uploaded_bytes,
            "removal": "exact",
            "unrelated_descendant": "byte_exact",
            "selection": "skip_exact",
            "cancellation": "joined_and_removed",
            "schema_reset": "21_to_22" if identity_reset else None,
            "external_reset_sentinels": (
                "byte_exact" if identity_reset else None
            ),
            "tracker_security": (
                "encrypted_unauthenticated"
                if controlled_tracker is not None
                else None
            ),
            "tracker_requests": (
                len(controlled_tracker.requests)
                if controlled_tracker is not None
                else 0
            ),
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        for sentinel in reset_sentinels:
            target.shell(["rm", sentinel], check=False)
        for exact_path in (output_root, staging_root, part_path):
            target.shell(["rm", "-rf", exact_path], check=False)
        try:
            probe.remove_grant_folder(target, grant_storage)
        except probe.ProbeFailure as error:
            grant_root = probe.grant_path(grant_storage)
            remaining = target.shell(
                ["find", grant_root, "-maxdepth", "6", "-print"],
                timeout=15,
                check=False,
            ).stdout
            raise BootstrapFailure(
                f"{error}; remaining run-owned objects:\n{remaining}"
            ) from error
        if tracker_transport is not None:
            tracker_transport.close()
        if controlled_tracker is not None:
            controlled_tracker.close()
        if peer_transport is not None:
            peer_transport.close()
        fixture.close()


def select_product_saf_folder(
    target: Any,
    probe: ModuleType,
    grant_storage: str,
    folder: str,
    *,
    create: bool,
) -> str:
    path = probe.grant_path(grant_storage, folder)
    if create:
        probe.prepare_grant_folder(target, grant_storage, folder)
    elif target.shell(["test", "-d", path], check=False).returncode != 0:
        raise BootstrapFailure(f"retained SAF fixture root is absent: {path}")
    previous = product_logs(target).count("saf_root_operation kind=add ")
    selected = target.shell(
        [
            "am",
            "start",
            "-n",
            ACTIVITY,
            "--ez",
            "product_select_saf",
            "true",
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in selected.stdout or (
        selected.returncode != 0 and "Starting:" not in selected.stdout
    ):
        raise BootstrapFailure(f"could not launch product SAF picker for {folder}")
    probe.automate_tree_grant(target, grant_storage, folder)
    deadline = time.monotonic() + 20
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        added = re.findall(
            r"saf_root_operation kind=add root=([a-z0-9_]+) result=complete",
            logs,
        )
        if len(added) > previous:
            root_id = added[previous]
            if f"saf_tree_ready root={root_id}" in logs:
                return path
        if "product service initialization failed" in logs:
            break
        time.sleep(0.2)
    raise BootstrapFailure(f"product did not register SAF root {folder}\n{logs}")


def add_product_fixture(
    target: Any,
    fixture: SeedFixture,
    transport: ReverseTransport,
) -> str:
    magnet = (
        f"magnet:?xt=urn:btih:{fixture.info_hash}"
        f"&dn={fixture.name}&x.pe=127.0.0.1:{transport.device_port}"
    )
    previous = product_add_count(target, fixture.info_hash)
    result = target.shell(
        [
            "am",
            "start",
            "-n",
            ACTIVITY,
            "--es",
            "product_magnet",
            shlex.quote(magnet),
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in result.stdout or (
        result.returncode != 0 and "Starting:" not in result.stdout
    ):
        raise BootstrapFailure(f"could not add controlled fixture {fixture.name}")
    return wait_product_torrent_id(target, fixture.info_hash, previous)


def request_product_data_reset(
    target: Any,
    *,
    delete_data: bool,
    expected_torrents: int,
    baseline_fds: int,
    kill_after_first: bool = False,
) -> tuple[str, int]:
    if kill_after_first and (not delete_data or expected_torrents < 2):
        raise BootstrapFailure("process-kill reset requires at least two delete targets")
    mode = "delete-kill-after-first" if kill_after_first else (
        "delete" if delete_data else "keep"
    )
    marker = (
        f"torrents={expected_torrents} "
        f"delete={'true' if delete_data else 'false'} downgraded=false"
    )
    previous = product_logs(target).count("data_reset_completed operation=")
    previous_start_failures = product_logs(target).count("data_reset_start_failed ")
    previous_process_kills = product_logs(target).count("data_reset_process_kill ")
    result = target.shell(
        [
            "am",
            "start",
            "-n",
            ACTIVITY,
            "--es",
            "product_data_reset",
            mode,
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in result.stdout or (
        result.returncode != 0 and "Starting:" not in result.stdout
    ):
        raise BootstrapFailure(f"could not request product data reset {mode}")
    deadline = time.monotonic() + 90
    high_water_fds = baseline_fds
    recovered_process_kill = False
    logs = ""
    while time.monotonic() < deadline:
        high_water_fds = max(high_water_fds, product_fd_count(target))
        logs = product_logs(target)
        if (
            kill_after_first
            and not recovered_process_kill
            and logs.count("data_reset_process_kill ") > previous_process_kills
        ):
            process_deadline = time.monotonic() + 10
            while time.monotonic() < process_deadline:
                if not target.shell(["pidof", PACKAGE], check=False).stdout.strip():
                    break
                time.sleep(0.05)
            else:
                raise BootstrapFailure("data reset process-kill injection did not exit")
            restarted = target.shell(
                ["am", "start", "-W", "-n", ACTIVITY],
                timeout=30,
                check=False,
            )
            if restarted.returncode != 0 or "Error:" in restarted.stdout:
                raise BootstrapFailure("could not restart data reset after process kill")
            recovered_process_kill = True
            continue
        completed = [
            line
            for line in logs.splitlines()
            if "data_reset_completed operation=" in line
        ]
        if len(completed) > previous:
            if kill_after_first and not recovered_process_kill:
                raise BootstrapFailure("data reset completed without the armed process kill")
            if marker not in completed[-1]:
                raise BootstrapFailure(
                    f"data reset completion differs for {mode}: {completed[-1]}"
                )
            return completed[-1], high_water_fds
        if "product data reset failed" in logs:
            break
        if logs.count("data_reset_start_failed ") > previous_start_failures:
            break
        time.sleep(0.1)
    relevant = "\n".join(
        line
        for line in logs.splitlines()
        if "data_reset_" in line or "product data reset failed" in line
    )
    raise BootstrapFailure(
        f"product data reset {mode} did not complete\n{relevant}"
    )


def remote_file_manifest(target: Any, root: str) -> dict[str, str]:
    listing = target.shell(
        ["find", root, "-type", "f", "-print"],
        timeout=20,
        check=False,
    )
    if listing.returncode != 0:
        raise BootstrapFailure(f"could not enumerate controlled root {root}")
    manifest: dict[str, str] = {}
    for path in sorted(filter(None, listing.stdout.splitlines())):
        digest = target.shell(["sha256sum", path], timeout=20, check=False)
        if digest.returncode != 0:
            raise BootstrapFailure(f"could not hash controlled file {path}")
        manifest[path.removeprefix(f"{root}/")] = digest.stdout.split()[0]
    return manifest


def run_product_data_reset_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-data-reset requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    folder_a = f"RSTorrentDataResetA{ordinal}"
    folder_b = f"RSTorrentDataResetB{ordinal}"
    fixture_a = SeedFixture.create(
        interop,
        f"{target_kind}-product-data-reset-a-{ordinal}",
        root_name=f"data-reset-a-{ordinal}",
    )
    fixture_b = SeedFixture.create(
        interop,
        f"{target_kind}-product-data-reset-b-{ordinal}",
        root_name=f"data-reset-b-{ordinal}",
        content_offset=31,
    )
    transport_a: ReverseTransport | None = None
    transport_b: ReverseTransport | None = None
    root_a = probe.grant_path(grant_storage, folder_a)
    root_b = probe.grant_path(grant_storage, folder_b)
    output_a = f"{root_a}/{fixture_a.name}"
    output_b = f"{root_b}/{fixture_b.name}"
    root_sentinel_a = f"{root_a}/unrelated-root-a.bin"
    root_sentinel_b = f"{root_b}/unrelated-root-b.bin"
    nested_sentinel_a = f"{output_a}/unrelated-nested-a.bin"
    nested_sentinel_b = f"{output_b}/unrelated-nested-b.bin"
    sentinel_content = {
        root_sentinel_a: b"preserve-root-a",
        root_sentinel_b: b"preserve-root-b",
        nested_sentinel_a: b"preserve-nested-a",
        nested_sentinel_b: b"preserve-nested-b",
    }
    def install_sentinels() -> dict[str, str]:
        expected: dict[str, str] = {}
        for index, (destination, content) in enumerate(sentinel_content.items()):
            source = fixture_a.run_path / f"sentinel-{index}.bin"
            source.write_bytes(content)
            push_local_file(target, target_kind, source, destination)
            expected[destination] = hashlib.sha256(content).hexdigest()
        return expected

    def assert_sentinels(expected: dict[str, str]) -> None:
        for path, digest in expected.items():
            result = target.shell(["sha256sum", path], timeout=20, check=False)
            if result.returncode != 0 or result.stdout.split()[0] != digest:
                raise BootstrapFailure(f"data reset changed unrelated sentinel {path}")

    def assert_fixture_files(root: str, fixture: SeedFixture, *, present: bool) -> None:
        for relative_path, _, padding in fixture_files():
            if padding:
                continue
            path = f"{root}/{fixture.name}/{relative_path}"
            exists = target.shell(["test", "-f", path], check=False).returncode == 0
            if exists != present:
                outcome = "absent" if present else "survived exact deletion"
                raise BootstrapFailure(f"fixture file {outcome}: {path}")
            if present:
                digest = target.shell(["sha1sum", path]).stdout.split()[0]
                if digest != fixture.expected_file_hashes[relative_path]:
                    raise BootstrapFailure(f"fixture hash differs after keep: {path}")

    try:
        clear_application(target)
        target.shell(
            ["pm", "grant", PACKAGE, "android.permission.POST_NOTIFICATIONS"],
            check=False,
        )
        root_a = select_product_saf_folder(
            target,
            probe,
            grant_storage,
            folder_a,
            create=True,
        )
        transport_a = ReverseTransport.create(
            target,
            target_kind,
            fixture_a.host_port,
            ordinal,
            slot=0,
        )
        baseline_fds = product_fd_count(target)
        first_id = add_product_fixture(target, fixture_a, transport_a)
        _, first_download_fds = wait_product_completion(
            target,
            first_id,
            baseline_fds,
        )
        request_product_torrent_action(target, first_id, "pause")

        root_b = select_product_saf_folder(
            target,
            probe,
            grant_storage,
            folder_b,
            create=True,
        )
        transport_b = ReverseTransport.create(
            target,
            target_kind,
            fixture_b.host_port,
            ordinal,
            slot=1,
        )
        fixture_b.handle.set_upload_limit(4 * 1024)
        second_id = add_product_fixture(target, fixture_b, transport_b)
        target.run(["logcat", "-c"], check=False)
        target.shell(["am", "force-stop", PACKAGE], check=False)
        restarted = target.shell(
            ["am", "start", "-W", "-n", ACTIVITY],
            timeout=30,
            check=False,
        )
        if restarted.returncode != 0 or "Error:" in restarted.stdout:
            raise BootstrapFailure("could not restart product for multi-root rehydration")
        wait_product_torrent_state(
            target,
            second_id,
            state="DOWNLOADING",
            description="active second root before keep clear",
            timeout=60,
        )
        fixture_b.handle.pause()
        request_product_torrent_action(target, first_id, "resume")
        request_product_torrent_action(target, first_id, "observe")
        wait_product_log(
            target,
            f"torrent_state torrent={first_id} state=COMPLETE",
            "resumed first-root seed",
        )
        expected_sentinels = install_sentinels()
        assert_fixture_files(root_a, fixture_a, present=True)
        keep_line, keep_fds = request_product_data_reset(
            target,
            delete_data=False,
            expected_torrents=2,
            baseline_fds=baseline_fds,
        )
        assert_fixture_files(root_a, fixture_a, present=True)
        assert_sentinels(expected_sentinels)
        retained_after_keep = {
            folder_a: remote_file_manifest(target, root_a),
            folder_b: remote_file_manifest(target, root_b),
        }

        target.run(["logcat", "-c"], check=False)
        select_product_saf_folder(
            target,
            probe,
            grant_storage,
            folder_a,
            create=False,
        )
        readded_a = add_product_fixture(target, fixture_a, transport_a)
        wait_product_torrent_state(
            target,
            readded_a,
            state="COMPLETE",
            description="kept first-root payload recheck",
            timeout=60,
        )
        select_product_saf_folder(
            target,
            probe,
            grant_storage,
            folder_b,
            create=False,
        )
        fixture_b.handle.set_upload_limit(0)
        fixture_b.handle.resume()
        readded_b = add_product_fixture(target, fixture_b, transport_b)
        _, second_download_fds = wait_product_completion(
            target,
            readded_b,
            baseline_fds,
        )
        assert_fixture_files(root_a, fixture_a, present=True)
        assert_fixture_files(root_b, fixture_b, present=True)
        assert_sentinels(expected_sentinels)

        delete_line, delete_fds = request_product_data_reset(
            target,
            delete_data=True,
            expected_torrents=2,
            baseline_fds=baseline_fds,
            kill_after_first=True,
        )
        assert_fixture_files(root_a, fixture_a, present=False)
        assert_fixture_files(root_b, fixture_b, present=False)
        for torrent_id, root in ((readded_a, root_a), (readded_b, root_b)):
            for hidden in (
                f"{root}/.{torrent_id}.rstorrent-staging",
                f"{root}/.{torrent_id}.rstorrent-parts",
            ):
                if target.shell(["test", "-e", hidden], check=False).returncode == 0:
                    raise BootstrapFailure(f"data reset left exact artifact {hidden}")
        assert_sentinels(expected_sentinels)
        final_manifests = {
            folder_a: remote_file_manifest(target, root_a),
            folder_b: remote_file_manifest(target, root_b),
        }
        expected_final = {
            folder_a: {
                root_sentinel_a.removeprefix(f"{root_a}/"): expected_sentinels[root_sentinel_a],
                nested_sentinel_a.removeprefix(f"{root_a}/"): expected_sentinels[nested_sentinel_a],
            },
            folder_b: {
                root_sentinel_b.removeprefix(f"{root_b}/"): expected_sentinels[root_sentinel_b],
                nested_sentinel_b.removeprefix(f"{root_b}/"): expected_sentinels[nested_sentinel_b],
            },
        }
        if final_manifests != expected_final:
            raise BootstrapFailure(
                "data reset final root manifests differ: "
                f"actual={final_manifests} expected={expected_final}"
            )
        final_fds = product_fd_count(target)
        high_water_fds = max(
            first_download_fds,
            keep_fds,
            second_download_fds,
            delete_fds,
            final_fds,
        )
        if baseline_fds and high_water_fds - baseline_fds > 48:
            raise BootstrapFailure(
                "data reset descriptor delta exceeded existing bounds: "
                f"baseline={baseline_fds} high_water={high_water_fds}"
            )
        return {
            "target": target_kind,
            "profile": "product-data-reset",
            "run": ordinal,
            "identity": identity,
            "roots": 2,
            "keep": keep_line,
            "retained_files": {
                key: len(value) for key, value in retained_after_keep.items()
            },
            "readd_recheck": "complete",
            "process_kill_recovery": "after_first_delete",
            "delete": delete_line,
            "final_manifests": {
                key: sorted(value) for key, value in final_manifests.items()
            },
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": high_water_fds,
                "final": final_fds,
            },
            "cleanup": "exact_registered_files_only",
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        for root in (root_a, root_b):
            target.shell(["rm", "-rf", root], timeout=20, check=False)
            if target.shell(["test", "-e", root], check=False).returncode == 0:
                raise BootstrapFailure(f"could not remove task-owned reset root {root}")
        if transport_b is not None:
            transport_b.close()
        if transport_a is not None:
            transport_a.close()
        fixture_b.close()
        fixture_a.close()


def run_product_notifications_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-notifications requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    fixture = SeedFixture.create(interop, f"{target_kind}-product-notifications-{ordinal}")
    peer_transport: ReverseTransport | None = None
    output_root = f"{probe.grant_path(grant_storage)}/{fixture.name}"
    staging_root = f"{probe.grant_path(grant_storage)}/.{fixture.name}.rstorrent-staging"
    part_path = f"{probe.grant_path(grant_storage)}/.{fixture.name}.rstorrent-parts"
    torrent_id = "unallocated"
    completion_body = f"{fixture.name} finished downloading"
    attention_body = f"{fixture.name} · Open RSTorrent for details"
    completion_prefix = "rstorrent-download_complete-"
    attention_prefix = "rstorrent-needs_attention-"

    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        peer_transport = ReverseTransport.create(
            target,
            target_kind,
            fixture.host_port,
            ordinal,
        )
        magnet = (
            f"magnet:?xt=urn:btih:{fixture.info_hash}"
            f"&dn={fixture.name}&x.pe=127.0.0.1:{peer_transport.device_port}"
        )
        baseline_fds = product_fd_count(target)
        add_count = product_add_count(target, fixture.info_hash)
        started = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_magnet",
                shlex.quote(magnet),
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in started.stdout:
            raise BootstrapFailure("could not add notification-profile magnet")
        torrent_id = wait_product_torrent_id(target, fixture.info_hash, add_count)
        staging_root = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-staging"
        part_path = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-parts"
        metrics, fd_high_water = wait_product_completion(
            target,
            torrent_id,
            baseline_fds,
        )
        completion = wait_product_notification(
            target,
            tag_prefix=completion_prefix,
            title="Download complete",
            body=completion_body,
        )
        tap_product_notification(
            target,
            target_kind,
            probe,
            body=completion_body,
            expected_text="Info hash",
        )
        assert_no_product_notification(
            target,
            completion_prefix,
            "completion tap",
        )

        target.shell(["am", "force-stop", PACKAGE], check=False)
        target.run(["logcat", "-c"], check=False)
        restarted = target.shell(
            ["am", "start", "-W", "-n", ACTIVITY], timeout=30, check=False
        )
        if "Error:" in restarted.stdout:
            raise BootstrapFailure("could not restart notification profile")
        wait_product_torrent_state(
            target,
            torrent_id,
            state="COMPLETE",
            description="complete torrent after notification-profile restart",
            timeout=45,
        )
        assert_no_product_notification(
            target,
            completion_prefix,
            "restart baseline",
        )

        target.run(["logcat", "-c"], check=False)
        request_product_torrent_action(target, torrent_id, "force_recheck")
        wait_product_torrent_state(
            target,
            torrent_id,
            state="COMPLETE",
            description="complete torrent after notification-profile recheck",
            timeout=45,
        )
        assert_no_product_notification(
            target,
            completion_prefix,
            "force recheck",
        )

        corrupt_relative = next(
            relative_path
            for relative_path, length, padding in fixture_files()
            if length > 0 and not padding
        )
        corrupt_path = f"{output_root}/{corrupt_relative}"
        target.shell(["rm", "-f", corrupt_path])
        target.shell(["mkdir", "-p", corrupt_path])
        target.run(["logcat", "-c"], check=False)
        recheck = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_torrent_id",
                torrent_id,
                "--es",
                "product_torrent_action",
                "force_recheck",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in recheck.stdout:
            raise BootstrapFailure("could not request malformed-storage recheck")
        repair_logs = wait_product_log(
            target,
            "storage=NEEDS_REPAIR",
            "live storage-repair transition",
            timeout=45,
        )
        if f"torrent={torrent_id}" not in repair_logs:
            raise BootstrapFailure("storage-repair transition selected the wrong torrent")
        attention = wait_product_notification(
            target,
            tag_prefix=attention_prefix,
            title="Download needs attention",
            body=attention_body,
        )
        tap_product_notification(
            target,
            target_kind,
            probe,
            body=attention_body,
            expected_text="Storage",
        )
        assert_no_product_notification(target, attention_prefix, "attention tap")

        target.shell(["rm", "-rf", corrupt_path])
        source_path = fixture.run_path / "seed" / fixture.name / corrupt_relative
        push_local_file(
            target,
            target_kind,
            source_path,
            corrupt_path,
            timeout=30,
        )

        request_product_torrent_action(target, torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={torrent_id}",
            "notification-profile removal",
        )
        if automatic_notification_records(target, completion_prefix):
            raise BootstrapFailure("torrent removal retained completion notification")
        if automatic_notification_records(target, attention_prefix):
            raise BootstrapFailure("torrent removal retained attention notification")

        return {
            "target": target_kind,
            "profile": "product-notifications",
            "run": ordinal,
            "identity": identity,
            "torrent_id": torrent_id,
            "content_name": fixture.name,
            "completion": completion,
            "attention": attention,
            "completion_tap": "exact_torrent",
            "attention_tap": "exact_storage",
            "restart_replay": 0,
            "recheck_replay": 0,
            "malformed_path_restored": True,
            "active_after_removal": 0,
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        for exact_path in (output_root, staging_root, part_path):
            target.shell(["rm", "-rf", exact_path], check=False)
        probe.remove_grant_folder(target, grant_storage)
        if peer_transport is not None:
            peer_transport.close()
        fixture.close()


def run_product_pure_v2_saf_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    tracker_support: ModuleType,
    pure_v2: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-pure-v2-saf requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    fixture = PureV2SeedFixture.create(
        interop,
        pure_v2,
        f"{target_kind}-product-pure-v2-saf-{ordinal}",
    )
    peer_transport: ReverseTransport | None = None
    magnet_peer_transport: ReverseTransport | None = None
    magnet_hash_proxy: Any | None = None
    tracker_transport: ReverseTransport | None = None
    controlled_tracker: Any | None = None
    torrent_id = "pending"
    grant_root = probe.grant_path(grant_storage)
    output_root = f"{grant_root}/{fixture.name}"
    staging_root = ""
    part_path = ""
    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        baseline_fds = product_fd_count(target)
        peer_transport = ReverseTransport.create(
            target,
            target_kind,
            fixture.host_port,
            ordinal,
        )
        controlled_tracker = tracker_support.ControlledHttpTracker(
            fixture.wire_info_hash,
            peer_transport.device_port,
        )
        controlled_tracker.start()
        tracker_transport = ReverseTransport.create(
            target,
            target_kind,
            controlled_tracker.port,
            ordinal,
            slot=1,
        )
        tracker_url = controlled_tracker.url_for_port(tracker_transport.device_port)
        metainfo = fixture.source_with_tracker(tracker_url)
        add_count = product_unknown_add_count(target)
        started = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_torrent_base64",
                base64.b64encode(metainfo).decode("ascii"),
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in started.stdout or (
            started.returncode != 0 and "Starting:" not in started.stdout
        ):
            raise BootstrapFailure("could not add the Android pure-v2 torrent source")
        torrent_id = wait_product_unknown_torrent_id(target, add_count)
        staging_root = f"{grant_root}/.{torrent_id}.rstorrent-staging"
        part_path = f"{grant_root}/.{torrent_id}.rstorrent-parts"
        metrics, fd_high_water = wait_product_completion(
            target,
            torrent_id,
            baseline_fds,
        )
        controlled_tracker.wait_for_event("started")
        if metrics["limit"] != 40 or metrics["owned_high_water"] > 40:
            raise BootstrapFailure(f"pure-v2 SAF handle bound changed: {metrics}")
        if metrics["pending_high_water"] > 16:
            raise BootstrapFailure(f"pure-v2 SAF request bound changed: {metrics}")
        if baseline_fds and fd_high_water - baseline_fds > 48:
            raise BootstrapFailure(
                "pure-v2 Android descriptor delta exceeded its bound: "
                f"baseline={baseline_fds} high_water={fd_high_water}"
            )
        for relative_path, expected_hash in fixture.expected_file_hashes.items():
            path = f"{output_root}/{relative_path}"
            if target.shell(["test", "-f", path], check=False).returncode != 0:
                raise BootstrapFailure(f"pure-v2 SAF output is absent: {relative_path}")
            digest = target.shell(["sha1sum", path]).stdout.split()[0]
            if digest != expected_hash:
                raise BootstrapFailure(f"pure-v2 SAF output differs: {relative_path}")
        for unexpected in (staging_root, part_path, f"{grant_root}/{torrent_id}"):
            if target.shell(["test", "-e", unexpected], check=False).returncode == 0:
                raise BootstrapFailure(
                    f"unexpected pure-v2 managed artifact survived: {unexpected}"
                )

        target.run(["logcat", "-c"], check=False)
        target.shell(["am", "force-stop", PACKAGE], check=False)
        restarted = target.shell(["am", "start", "-n", ACTIVITY], timeout=30, check=False)
        if "Error:" in restarted.stdout:
            raise BootstrapFailure("could not restart the pure-v2 Android product")
        wait_product_log(
            target,
            "saf_root_health source=startup available=true",
            "healthy SAF root after pure-v2 restart",
        )
        restart_logs = wait_product_torrent_state(
            target,
            torrent_id,
            state="COMPLETE",
            description="complete pure-v2 torrent after restart recheck",
            timeout=30,
        )
        if (
            f"torrent={torrent_id}" not in restart_logs
            or "state=AWAITING_STORAGE" not in restart_logs
            or "verified=0" not in restart_logs
            or f"verified={fixture.piece_count}" not in restart_logs
        ):
            raise BootstrapFailure(
                "pure-v2 restart did not expose conservative verification reconstruction"
            )

        request_product_torrent_action(target, torrent_id, "force_recheck")
        request_product_torrent_action(target, torrent_id, "enable_upload")
        uploaded_bytes = verify_product_upload(target, fixture)
        request_product_torrent_action(target, torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={torrent_id}",
            "pure-v2 SAF removal",
        )
        wait_product_log(
            target,
            "diagnostic=torrent_removal_completed",
            "joined pure-v2 application removal",
        )
        for exact_path in (output_root, staging_root, part_path):
            if target.shell(["test", "-e", exact_path], check=False).returncode == 0:
                raise BootstrapFailure(
                    f"pure-v2 managed artifact survived removal: {exact_path}"
                )

        fixture.restart_seed(interop, upload_rate_limit=12 * 1024)
        magnet_hash_proxy = pure_v2.PlaintextBep52Proxy(
            ("127.0.0.1", fixture.host_port)
        )
        magnet_peer_transport = ReverseTransport.create(
            target,
            target_kind,
            magnet_hash_proxy.endpoint[1],
            ordinal,
            slot=2,
        )
        add_count = product_unknown_add_count(target)
        magnet = (
            f"magnet:?xt=urn:btmh:1220{fixture.info_hash}"
            f"&x.pe=127.0.0.1:{magnet_peer_transport.device_port}&so=0-1"
        )
        selective = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_magnet",
                shlex.quote(magnet),
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in selective.stdout or (
            selective.returncode != 0 and "Starting:" not in selective.stdout
        ):
            raise BootstrapFailure("could not add selective Android pure-v2 magnet")
        selective_torrent_id = wait_product_unknown_torrent_id(target, add_count)
        staging_root = f"{grant_root}/.{selective_torrent_id}.rstorrent-staging"
        part_path = f"{grant_root}/.{selective_torrent_id}.rstorrent-parts"
        selected_pieces = fixture.piece_count - 1
        magnet_baseline_fds = product_fd_count(target)
        candidate_wire = wait_v2_proxy_candidate(
            magnet_hash_proxy,
            selected_pieces=selected_pieces,
            description="incomplete selected pure-v2 magnet wire candidate",
        )
        wait_product_torrent_diagnostic(
            target,
            selective_torrent_id,
            diagnostic="piece_verified",
            description="verified incomplete pure-v2 magnet candidate",
        )
        candidate_wire = magnet_hash_proxy.snapshot()
        candidate_pieces = {
            piece for piece, _, _ in candidate_wire["piece_messages"]
        }
        if not candidate_pieces or len(candidate_pieces) >= selected_pieces:
            raise BootstrapFailure(
                "Android v2 magnet candidate completed before forced restart: "
                f"{candidate_wire}"
            )
        candidate_fd_high_water = product_fd_count(target)
        target.shell(["am", "force-stop", PACKAGE], check=False)
        target.run(["logcat", "-c"], check=False)
        restarted = target.shell(["am", "start", "-n", ACTIVITY], timeout=30, check=False)
        if "Error:" in restarted.stdout:
            raise BootstrapFailure("could not restart the Android v2 magnet candidate")
        wait_product_log(
            target,
            "saf_root_health source=startup available=true",
            "healthy SAF root after v2 magnet candidate restart",
        )
        selective_metrics, restarted_fd_high_water = wait_product_completion(
            target,
            selective_torrent_id,
            product_fd_count(target),
        )
        magnet_fd_high_water = max(candidate_fd_high_water, restarted_fd_high_water)
        restart_logs = wait_product_torrent_progress(
            target,
            selective_torrent_id,
            state="COMPLETE",
            verified=selected_pieces,
            description="complete pure-v2 magnet after candidate restart",
        )
        if "state=AWAITING_STORAGE" not in restart_logs or "verified=0" not in restart_logs:
            raise BootstrapFailure(
                "Android v2 magnet restart did not expose conservative local reconstruction"
            )
        restarted_wire = magnet_hash_proxy.snapshot()
        if len(restarted_wire["hash_requests"]) <= len(candidate_wire["hash_requests"]):
            raise BootstrapFailure(
                "Android v2 magnet restart did not refetch volatile hashes: "
                f"before={candidate_wire} after={restarted_wire}"
            )
        if (
            selective_metrics["limit"] != 40
            or selective_metrics["owned_high_water"] > 40
            or selective_metrics["pending_high_water"] > 16
        ):
            raise BootstrapFailure(
                f"pure-v2 magnet SAF resource bound changed: {selective_metrics}"
            )
        for file_index, (relative_path, expected_hash) in enumerate(
            fixture.expected_file_hashes.items()
        ):
            path = f"{output_root}/{relative_path}"
            exists = target.shell(["test", "-f", path], check=False).returncode == 0
            if file_index == 2:
                if exists:
                    raise BootstrapFailure(
                        "selective pure-v2 magnet retained skipped file 2"
                    )
                continue
            if not exists:
                raise BootstrapFailure(
                    f"selective pure-v2 SAF output is absent: {relative_path}"
                )
            digest = target.shell(["sha1sum", path]).stdout.split()[0]
            if digest != expected_hash:
                raise BootstrapFailure(
                    f"selective pure-v2 SAF output differs: {relative_path}"
                )
        if target.shell(["test", "-e", part_path], check=False).returncode == 0:
            raise BootstrapFailure("selective pure-v2 magnet created a part artifact")

        request_product_torrent_action(
            target,
            selective_torrent_id,
            "download_file:2",
        )
        wait_product_torrent_progress(
            target,
            selective_torrent_id,
            state="COMPLETE",
            verified=fixture.piece_count,
            description="promoted Android v2 magnet selection",
        )
        final_relative_path, final_expected_hash = list(
            fixture.expected_file_hashes.items()
        )[2]
        final_path = f"{output_root}/{final_relative_path}"
        if target.shell(["test", "-f", final_path], check=False).returncode != 0:
            raise BootstrapFailure("promoted Android v2 magnet file is absent")
        final_digest = target.shell(["sha1sum", final_path]).stdout.split()[0]
        if final_digest != final_expected_hash:
            raise BootstrapFailure("promoted Android v2 magnet file differs")

        request_product_torrent_action(target, selective_torrent_id, "force_recheck")
        request_product_torrent_action(target, selective_torrent_id, "enable_upload")
        magnet_uploaded_bytes = verify_product_upload(
            target,
            fixture,
            pure_v2=pure_v2,
            magnet_only=True,
        )
        request_product_torrent_action(target, selective_torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={selective_torrent_id}",
            "selective pure-v2 SAF removal",
        )
        for exact_path in (output_root, staging_root, part_path):
            if target.shell(["test", "-e", exact_path], check=False).returncode == 0:
                raise BootstrapFailure(
                    f"selective pure-v2 artifact survived removal: {exact_path}"
                )
        return {
            "target": target_kind,
            "profile": "product-pure-v2-saf",
            "run": ordinal,
            "identity": identity,
            "torrent_id": torrent_id,
            "magnet_torrent_id": selective_torrent_id,
            "v2_info_hash": fixture.info_hash,
            "wire_info_hash": fixture.wire_info_hash,
            "v1_info_hash": None,
            "content_name": fixture.name,
            "files": len(fixture.expected_file_hashes),
            "pieces": fixture.piece_count,
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
            "tracker_requests": len(controlled_tracker.requests),
            "restart_recheck": "complete",
            "force_recheck": "complete",
            "uploaded_bytes": uploaded_bytes,
            "removal": "exact",
            "selection": "complete_source_then_magnet_select_only",
            "selective_storage_metrics": selective_metrics,
            "magnet_selection": "files_0_1_then_promoted_2",
            "magnet_restart": "incomplete_candidate_hash_refetch",
            "magnet_candidate_pieces": sorted(candidate_pieces),
            "magnet_hash_requests_before_restart": len(
                candidate_wire["hash_requests"]
            ),
            "magnet_hash_requests_after_restart": len(
                restarted_wire["hash_requests"]
            ),
            "magnet_process_fd_high_water": magnet_fd_high_water,
            "magnet_uploaded_bytes": magnet_uploaded_bytes,
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        for exact_path in (output_root, staging_root, part_path):
            if exact_path:
                target.shell(["rm", "-rf", exact_path], check=False)
        probe.remove_grant_folder(target, grant_storage)
        if tracker_transport is not None:
            tracker_transport.close()
        if controlled_tracker is not None:
            controlled_tracker.close()
        if peer_transport is not None:
            peer_transport.close()
        if magnet_peer_transport is not None:
            magnet_peer_transport.close()
        if magnet_hash_proxy is not None:
            magnet_hash_proxy.close()
        fixture.close()


def run_product_hybrid_saf_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    pure_v2: ModuleType,
    hybrid: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-hybrid-saf requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    fixture = HybridSeedFixture.create(
        interop,
        hybrid,
        f"{target_kind}-product-hybrid-saf-{ordinal}",
    )
    hash_proxy: Any | None = None
    peer_transport: ReverseTransport | None = None
    torrent_id = "pending"
    grant_root = probe.grant_path(grant_storage)
    output_root = f"{grant_root}/{fixture.name}"
    staging_root = ""
    part_path = ""
    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        baseline_fds = product_fd_count(target)
        hash_proxy = pure_v2.PlaintextBep52Proxy(
            ("127.0.0.1", fixture.host_port)
        )
        peer_transport = ReverseTransport.create(
            target,
            target_kind,
            hash_proxy.endpoint[1],
            ordinal,
        )
        selection = "0-2,4-5"
        magnet = (
            f"magnet:?xt=urn:btmh:1220{fixture.info_hash}"
            f"&x.pe=127.0.0.1:{peer_transport.device_port}&so={selection}"
        )
        add_count = product_unknown_add_count(target)
        started = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_magnet",
                shlex.quote(magnet),
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in started.stdout or (
            started.returncode != 0 and "Starting:" not in started.stdout
        ):
            raise BootstrapFailure("could not add the Android hybrid magnet")
        torrent_id = wait_product_unknown_torrent_id(target, add_count)
        staging_root = f"{grant_root}/.{torrent_id}.rstorrent-staging"
        part_path = f"{grant_root}/.{torrent_id}.rstorrent-parts"
        metrics, fd_high_water = wait_product_completion(
            target,
            torrent_id,
            baseline_fds,
        )
        selected_pieces = fixture.piece_count - 2
        logs = wait_product_torrent_progress(
            target,
            torrent_id,
            state="COMPLETE",
            verified=selected_pieces,
            description="selected Android hybrid magnet",
        )
        identities = f"v1={fixture.wire_info_hash} v2={fixture.info_hash}"
        if identities not in logs:
            raise BootstrapFailure(
                "Android hybrid view omitted authenticated identities\n" + logs
            )
        wire = hash_proxy.snapshot()
        requested_pieces = {piece for piece, _, _ in wire["piece_messages"]}
        if (
            not wire["hash_requests"]
            or wire["hash_responses"] < 1
            or requested_pieces & {3, 4}
        ):
            raise BootstrapFailure(
                f"Android hybrid wire evidence is incomplete: {wire}"
            )
        if (
            metrics["limit"] != 40
            or metrics["owned_high_water"] > 40
            or metrics["pending_high_water"] > 16
        ):
            raise BootstrapFailure(f"hybrid SAF resource bound changed: {metrics}")
        if baseline_fds and fd_high_water - baseline_fds > 48:
            raise BootstrapFailure(
                "hybrid Android descriptor delta exceeded its bound: "
                f"baseline={baseline_fds} high_water={fd_high_water}"
            )
        for file_index, (relative_path, expected_hash) in enumerate(
            fixture.expected_file_hashes.items()
        ):
            path = f"{output_root}/{relative_path}"
            exists = target.shell(["test", "-f", path], check=False).returncode == 0
            if file_index == fixture.skipped_file:
                if exists:
                    raise BootstrapFailure("selected hybrid created its skipped file")
                continue
            if not exists:
                raise BootstrapFailure(f"hybrid SAF output is absent: {relative_path}")
            digest = target.shell(["sha1sum", path]).stdout.split()[0]
            if digest != expected_hash:
                raise BootstrapFailure(f"hybrid SAF output differs: {relative_path}")
        for unexpected in (
            staging_root,
            part_path,
            f"{output_root}/.pad",
            f"{grant_root}/{torrent_id}",
        ):
            if target.shell(["test", "-e", unexpected], check=False).returncode == 0:
                raise BootstrapFailure(
                    f"unexpected hybrid managed artifact survived: {unexpected}"
                )

        uploaded_before_restart = int(fixture.handle.status().total_upload)
        target.run(["logcat", "-c"], check=False)
        target.shell(["am", "force-stop", PACKAGE], check=False)
        restarted = target.shell(["am", "start", "-n", ACTIVITY], timeout=30, check=False)
        if "Error:" in restarted.stdout:
            raise BootstrapFailure("could not restart the hybrid Android product")
        wait_product_log(
            target,
            "saf_root_health source=startup available=true",
            "healthy SAF root after hybrid restart",
        )
        restart_logs = wait_product_torrent_progress(
            target,
            torrent_id,
            state="COMPLETE",
            verified=selected_pieces,
            description="complete selected hybrid after restart",
        )
        if identities not in restart_logs:
            raise BootstrapFailure(
                "Android hybrid restart omitted authenticated identities\n"
                + restart_logs
            )
        uploaded_after_restart = int(fixture.handle.status().total_upload)
        if uploaded_after_restart != uploaded_before_restart:
            raise BootstrapFailure(
                "complete hybrid restart redownloaded payload: "
                f"before={uploaded_before_restart} after={uploaded_after_restart}"
            )

        request_product_torrent_action(
            target,
            torrent_id,
            f"download_file:{fixture.skipped_file}",
        )
        wait_product_torrent_progress(
            target,
            torrent_id,
            state="COMPLETE",
            verified=fixture.piece_count,
            description="promoted Android hybrid selection",
        )
        skipped_relative, skipped_hash = list(
            fixture.expected_file_hashes.items()
        )[fixture.skipped_file]
        skipped_path = f"{output_root}/{skipped_relative}"
        if target.shell(["test", "-f", skipped_path], check=False).returncode != 0:
            raise BootstrapFailure("promoted hybrid file is absent")
        if target.shell(["sha1sum", skipped_path]).stdout.split()[0] != skipped_hash:
            raise BootstrapFailure("promoted hybrid file differs")

        recheck_hash_requests_before = len(hash_proxy.snapshot()["hash_requests"])
        recheck_payload_before = int(fixture.handle.status().total_payload_upload)
        request_product_torrent_action(target, torrent_id, "force_recheck")
        recheck_hash_requests_after = len(hash_proxy.snapshot()["hash_requests"])
        recheck_payload_after = int(fixture.handle.status().total_payload_upload)
        if recheck_payload_after != recheck_payload_before:
            checker = re.findall(
                r"force_recheck_progress[^\n]+processed=([0-9]+) "
                r"matched=([0-9]+) absent=([0-9]+) mismatched=([0-9]+)",
                product_logs(target),
            )
            raise BootstrapFailure(
                "hybrid force recheck redownloaded payload: "
                f"before={recheck_payload_before} after={recheck_payload_after} "
                f"checker={checker[-8:]}"
            )
        peer_transport.close()
        peer_transport = None
        hash_proxy.close()
        hash_proxy = None
        fixture.stop_seed()
        request_product_torrent_action(target, torrent_id, "enable_upload")
        direct_v2_upload_bytes = verify_product_upload(
            target,
            fixture,
            pure_v2=pure_v2,
            magnet_only=True,
        )
        upgraded_upload_bytes = verify_product_upload(
            target,
            fixture,
            pure_v2=pure_v2,
            expect_hybrid_upgrade=True,
        )
        request_product_torrent_action(target, torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={torrent_id}",
            "hybrid SAF removal",
        )
        wait_product_log(
            target,
            "diagnostic=torrent_removal_completed",
            "joined hybrid application removal",
        )
        for exact_path in (output_root, staging_root, part_path):
            if target.shell(["test", "-e", exact_path], check=False).returncode == 0:
                raise BootstrapFailure(
                    f"hybrid managed artifact survived removal: {exact_path}"
                )
        return {
            "target": target_kind,
            "profile": "product-hybrid-saf",
            "run": ordinal,
            "identity": identity,
            "torrent_id": torrent_id,
            "v1_info_hash": fixture.wire_info_hash,
            "v2_info_hash": fixture.info_hash,
            "content_name": fixture.name,
            "files": len(fixture.expected_file_hashes),
            "pieces": fixture.piece_count,
            "selected_pieces": selected_pieces,
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
            "restart": "complete_without_peer_payload",
            "selection": "files_0_2_4_5_then_promoted_3",
            "padding": "excluded_and_synthesized",
            "entry": "direct_v2_download_v1_upgrade_and_v2_upload",
            "recheck_hash_requests": (
                recheck_hash_requests_after - recheck_hash_requests_before
            ),
            "recheck_payload_bytes": recheck_payload_after - recheck_payload_before,
            "upgraded_upload_bytes": upgraded_upload_bytes,
            "direct_v2_upload_bytes": direct_v2_upload_bytes,
            "removal": "exact",
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        for exact_path in (output_root, staging_root, part_path):
            if exact_path:
                target.shell(["rm", "-rf", exact_path], check=False)
        probe.remove_grant_folder(target, grant_storage)
        if peer_transport is not None:
            peer_transport.close()
        if hash_proxy is not None:
            hash_proxy.close()
        fixture.close()


def run_product_saf_grant_repair_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    storage: str,
) -> dict[str, Any]:
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-saf-grant-repair requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"

    def wait_for(marker: str, timeout_seconds: float = 15) -> None:
        deadline = time.monotonic() + timeout_seconds
        logs = ""
        while time.monotonic() < deadline:
            logs = product_logs(target)
            if marker in logs:
                return
            time.sleep(0.2)
        raise BootstrapFailure(f"timed out waiting for {marker}\n{logs}")

    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        wait_for("saf_root_health source=selection available=true")

        target.run(["logcat", "-c"], check=False)
        released = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--ez",
                "product_release_saf_grant",
                "true",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in released.stdout:
            raise BootstrapFailure("could not trigger product SAF grant release")
        target.shell(["am", "force-stop", PACKAGE], check=False)
        target.run(["logcat", "-c"], check=False)
        restarted = target.shell(
            ["am", "start", "-W", "-n", ACTIVITY],
            timeout=30,
            check=False,
        )
        if "Error:" in restarted.stdout:
            raise BootstrapFailure("could not restart after SAF grant release")
        wait_for("saf_root_health source=startup available=false")
        if not app_text(target, "shared_prefs/product-saf.xml"):
            raise BootstrapFailure("revoked grant erased the stable platform identity")

        target.run(["logcat", "-c"], check=False)
        selected = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--ez",
                "product_select_saf",
                "true",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in selected.stdout:
            raise BootstrapFailure("could not relaunch SAF repair picker")
        probe.automate_tree_grant(target, grant_storage)
        wait_for("saf_root_health source=selection available=true")

        target.shell(["am", "force-stop", PACKAGE], check=False)
        target.run(["logcat", "-c"], check=False)
        target.shell(["am", "start", "-W", "-n", ACTIVITY], timeout=30)
        wait_for("saf_root_health source=startup available=true")
        return {
            "target": target_kind,
            "profile": "product-saf-grant-repair",
            "identity": identity,
            "startup_healthy": True,
            "revoked_startup_unavailable": True,
            "stable_root_identity_retained": True,
            "selection_repair_healthy": True,
            "repaired_restart_healthy": True,
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        probe.remove_grant_folder(target, grant_storage)


def run_product_incomplete_duplex_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    duplex: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-incomplete-duplex requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    run_path = Path(tempfile.mkdtemp(prefix="rstorrent-android-incomplete-duplex-"))
    fixture = duplex.create_fixture(run_path / "fixture")
    stage_session: Any | None = None
    stage_handle: Any | None = None
    stage_transport: ReverseTransport | None = None
    stage_proxy: Any | None = None
    stage_diagnostics: list[str] = []
    retained_pieces: tuple[int, ...] = ()
    complement_session: Any | None = None
    complement_handle: Any | None = None
    complement_transport: ReverseTransport | None = None
    proxy: Any | None = None
    baseline_fds = 0
    torrent_id: str | None = None
    output_root = f"{probe.grant_path(grant_storage)}/duplex-tree"
    staging_root = f"{probe.grant_path(grant_storage)}/.duplex-tree.rstorrent-staging"
    part_path = f"{probe.grant_path(grant_storage)}/.duplex-tree.rstorrent-parts"

    def close_partial(session: Any | None, handle: Any | None) -> None:
        if session is None:
            return
        if handle is not None:
            try:
                if handle.is_valid():
                    session.remove_torrent(handle)
            except RuntimeError:
                pass
        session.pause()
        session.pop_alerts()

    def wait_partial_verified() -> str:
        deadline = time.monotonic() + 60
        logs = ""
        while time.monotonic() < deadline:
            logs = product_logs(target)
            if any(
                torrent_id is not None
                and f"torrent={torrent_id}" in line
                and "state=DOWNLOADING" in line
                and "verified=2 " in line
                for line in logs.splitlines()
            ):
                return logs
            if "product service initialization failed" in logs:
                break
            time.sleep(0.1)
        stage_status = stage_handle.status() if stage_handle is not None else None
        if stage_session is not None:
            stage_diagnostics.extend(
                alert.message() for alert in stage_session.pop_alerts()
            )
        proxy_detail = stage_proxy.retained_pieces if stage_proxy is not None else ()
        raise BootstrapFailure(
            "Android SAF torrent did not retain the controlled partial set\n"
            f"stage_status={stage_status}\n"
            f"stage_alerts={stage_diagnostics}\n"
            f"stage_proxy={proxy_detail}\n"
            + logs
        )

    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        baseline_fds = product_fd_count(target)

        stage_session = duplex.create_session()
        duplex.configure_encryption(stage_session, "disabled")
        stage_port = duplex.wait_for_listener(stage_session, stage_diagnostics)
        stage_handle = duplex.add_seed(
            stage_session,
            fixture.torrent_info,
            fixture.source_root,
            stage_diagnostics,
        )
        stage_proxy = duplex.CappedPieceProxy(("127.0.0.1", stage_port))
        stage_transport = ReverseTransport.create(
            target,
            target_kind,
            stage_proxy.endpoint[1],
            ordinal,
        )
        magnet = (
            f"magnet:?xt=urn:btih:{fixture.info_hash}&dn=duplex-tree"
            f"&x.pe=127.0.0.1:{stage_transport.device_port}"
        )
        add_count = product_add_count(target, fixture.info_hash)
        started = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_encryption_policy",
                "disabled",
                "--es",
                "product_skip_files",
                ",".join(str(index) for index in duplex.SKIP_FILES),
                "--es",
                "product_magnet",
                shlex.quote(magnet),
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in started.stdout or (
            started.returncode != 0 and "Starting:" not in started.stdout
        ):
            raise BootstrapFailure("could not start Android incomplete SAF torrent")
        torrent_id = wait_product_torrent_id(target, fixture.info_hash, add_count)
        staging_root = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-staging"
        part_path = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-parts"
        wait_partial_verified()
        time.sleep(3)
        retained_pieces = stage_proxy.retained_pieces
        if len(retained_pieces) != 2:
            raise BootstrapFailure(
                f"partial proxy retained {retained_pieces}, expected two pieces"
            )
        if not stage_handle.status().is_seeding:
            raise BootstrapFailure("the partial source left seed state")
        if target.shell(["test", "-d", output_root], check=False).returncode != 0:
            raise BootstrapFailure("direct SAF content was not visible while incomplete")

        close_partial(stage_session, stage_handle)
        stage_session = None
        stage_handle = None
        gc.collect()
        stage_transport.close()
        stage_transport = None
        stage_proxy.close()
        stage_proxy = None

        target.run(["logcat", "-c"], check=False)
        released = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--ez",
                "product_release_saf_grant",
                "true",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in released.stdout:
            raise BootstrapFailure("could not inject incomplete SAF grant loss")
        target.shell(["am", "force-stop", PACKAGE], check=False)
        target.run(["logcat", "-c"], check=False)
        restarted = target.shell(
            ["am", "start", "-W", "-n", ACTIVITY],
            timeout=30,
            check=False,
        )
        if "Error:" in restarted.stdout:
            raise BootstrapFailure("could not restart incomplete torrent after grant loss")
        unavailable_logs = wait_product_log(
            target,
            "saf_root_health source=startup available=false",
            "incomplete SAF root failure",
        )
        unavailable_logs = wait_product_log(
            target,
            f"torrent={torrent_id}",
            "incomplete torrent after SAF root failure",
        )
        if "state=AWAITING_STORAGE" not in unavailable_logs:
            raise BootstrapFailure(
                "incomplete SAF root failure did not fence the torrent\n" + unavailable_logs
            )
        if not app_text(target, "shared_prefs/product-saf.xml"):
            raise BootstrapFailure("incomplete SAF grant loss erased stable root identity")

        complement_session = duplex.create_session()
        duplex.configure_encryption(complement_session, "disabled")
        complement_port = duplex.wait_for_listener(complement_session, [])
        complement_root = run_path / "complement-peer"
        complement_pieces = tuple(
            piece
            for piece in range(fixture.torrent_info.num_pieces())
            if piece not in retained_pieces
        )
        complement_handle = duplex.add_partial(
            complement_session,
            fixture,
            complement_root,
            complement_pieces,
        )
        proxy = duplex.PlaintextDuplexProxy(
            ("127.0.0.1", complement_port), piece_delay_seconds=0.25
        )
        complement_transport = ReverseTransport.create(
            target,
            target_kind,
            proxy.endpoint[1],
            ordinal,
        )

        target.run(["logcat", "-c"], check=False)
        selected = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--ez",
                "product_select_saf",
                "true",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in selected.stdout:
            raise BootstrapFailure("could not relaunch incomplete SAF repair picker")
        probe.automate_tree_grant(target, grant_storage)
        wait_product_log(
            target,
            "saf_root_health source=selection available=true",
            "repaired incomplete SAF root",
        )
        metrics, fd_high_water = wait_product_completion(
            target,
            torrent_id,
            baseline_fds,
        )
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            status = complement_handle.status()
            if status.errc.value() != 0:
                raise BootstrapFailure(
                    f"Android complementary peer failed: {status.errc.message()}"
                )
            if status.is_seeding:
                break
            time.sleep(0.05)
        else:
            raise BootstrapFailure("Android complementary peer did not complete")

        evidence = duplex.assert_plaintext(
            proxy,
            fast=True,
            client_initial=retained_pieces,
            upstream_initial=complement_pieces,
        )
        duplex.verify_files(complement_root, fixture, skipped_absent=False)
        for file_index, spec in enumerate(duplex.FILES):
            path = f"{output_root}/{spec.path.as_posix()}"
            exists = target.shell(["test", "-f", path], check=False).returncode == 0
            if spec.padding or file_index in duplex.SKIP_FILES:
                if exists:
                    raise BootstrapFailure(
                        f"Android incomplete SAF created excluded file {spec.path}"
                    )
                continue
            if not exists:
                raise BootstrapFailure(
                    f"Android incomplete SAF omitted wanted file {spec.path}"
                )
            digest = target.shell(["sha1sum", path]).stdout.split()[0]
            if digest != fixture.expected_hashes[spec.path]:
                raise BootstrapFailure(
                    f"Android incomplete SAF hash differs for {spec.path}"
                )
        if metrics["limit"] != 40 or metrics["owned_high_water"] > 40:
            raise BootstrapFailure(f"Android incomplete SAF handle bound failed: {metrics}")
        if metrics["pending_high_water"] > 16:
            raise BootstrapFailure(f"Android incomplete SAF broker bound failed: {metrics}")

        request_product_torrent_action(target, torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={torrent_id}",
            "incomplete SAF removal",
        )
        return {
            "target": target_kind,
            "profile": "product-incomplete-duplex",
            "run": ordinal,
            "identity": identity,
            "torrent_id": torrent_id,
            "v1_info_hash": fixture.info_hash,
            "provider_failure": "awaiting_storage",
            "provider_repair": "resumed",
            "retained_pieces": retained_pieces,
            "direct_visible_before_completion": True,
            "piece_evidence": evidence,
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
            "cleanup": "exact",
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        if complement_transport is not None:
            complement_transport.close()
        if stage_transport is not None:
            stage_transport.close()
        if stage_proxy is not None:
            stage_proxy.close()
        if proxy is not None:
            proxy.close()
        close_partial(complement_session, complement_handle)
        close_partial(stage_session, stage_handle)
        for exact_path in (output_root, staging_root, part_path):
            target.shell(["rm", "-rf", exact_path], check=False)
        probe.remove_grant_folder(target, grant_storage)
        shutil.rmtree(run_path, ignore_errors=True)


def run_product_media_playback_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    duplex: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-media-playback requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    fixture = MediaSeedFixture.create(
        interop,
        f"{target_kind}-product-media-playback-{ordinal}",
    )
    proxy: Any | None = None
    transport: ReverseTransport | None = None
    torrent_id = "unallocated"
    baseline_fds = 0
    output_path = f"{probe.grant_path(grant_storage)}/{fixture.name}/controlled.mp4"

    def add_slow_media(slot: int) -> tuple[str, Any, ReverseTransport]:
        nonlocal torrent_id
        media_proxy = RepeatedDelayedPieceProxy(
            ("127.0.0.1", fixture.host_port),
            piece_delay_seconds=0.1,
        )
        media_transport = ReverseTransport.create(
            target,
            target_kind,
            media_proxy.endpoint[1],
            ordinal,
            slot=slot,
        )
        magnet = (
            f"magnet:?xt=urn:btih:{fixture.info_hash}&dn={fixture.name}"
            f"&x.pe=127.0.0.1:{media_transport.device_port}"
        )
        prior = product_add_count(target, fixture.info_hash)
        started = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_magnet",
                shlex.quote(magnet),
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in started.stdout or (
            started.returncode != 0 and "Starting:" not in started.stdout
        ):
            media_transport.close()
            media_proxy.close()
            raise BootstrapFailure("could not add controlled Android media torrent")
        torrent_id = wait_product_torrent_id(target, fixture.info_hash, prior)
        return torrent_id, media_proxy, media_transport

    def wait_incomplete_playable_progress(timeout: float = 45) -> int:
        deadline = time.monotonic() + timeout
        high_water = 0
        logs = ""
        while time.monotonic() < deadline:
            logs = product_logs(target)
            high_water = max(
                high_water,
                maximum_product_verified_count(logs, torrent_id) or 0,
            )
            if 2 <= high_water < fixture.piece_count:
                return high_water
            if "product service initialization failed" in logs:
                break
            time.sleep(0.1)
        raise BootstrapFailure(
            "controlled media torrent did not expose incomplete verified ranges\n" + logs
        )

    def player_instance(marker: str, description: str, timeout: float = 30) -> str:
        deadline = time.monotonic() + timeout
        logs = ""
        while time.monotonic() < deadline:
            logs = product_logs(target)
            matches = re.findall(r"media_playback_created instance=(\d+)", logs)
            if marker in logs and matches:
                return matches[-1]
            if "product service initialization failed" in logs:
                break
            time.sleep(0.1)
        raise BootstrapFailure(f"timed out waiting for {description}\n{logs}")

    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        baseline_fds = product_fd_count(target)

        # First generation: prove that removing an incomplete torrent revokes the
        # ordinary Media3 HTTP source rather than serving stale SAF bytes.
        torrent_id, proxy, transport = add_slow_media(slot=0)
        first_verified = wait_incomplete_playable_progress()
        target.run(["logcat", "-c"], check=False)
        request_product_media_action(target, torrent_id, "play_file:0")
        first_instance = player_instance(
            f"media_playback_capability torrent={torrent_id} file=0 outcome=created",
            "incomplete media capability",
        )
        wait_product_log(
            target,
            f"media_playback_first_frame instance={first_instance}",
            "incomplete media first frame",
            timeout=45,
        )
        request_product_media_action(target, torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={torrent_id}",
            "incomplete media removal",
        )
        wait_product_log(
            target,
            f"media_playback_error instance={first_instance}",
            "removed media source failure",
            timeout=30,
        )
        request_product_media_action(target, torrent_id, "close_media")
        wait_product_log(
            target,
            f"media_playback_released instance={first_instance}",
            "removed media player release",
        )
        transport.close()
        transport = None
        proxy.close()
        proxy = None

        # Second generation: seek while incomplete, retain playback through
        # Home/PiP, and continue using the same player across final publication.
        target.run(["logcat", "-c"], check=False)
        torrent_id, proxy, transport = add_slow_media(slot=1)
        second_verified = wait_incomplete_playable_progress()
        target.run(["logcat", "-c"], check=False)
        request_product_media_action(target, torrent_id, "play_file:0")
        second_instance = player_instance(
            f"media_playback_capability torrent={torrent_id} file=0 outcome=created",
            "handoff media capability",
        )
        wait_product_log(
            target,
            f"media_playback_first_frame instance={second_instance}",
            "handoff media first frame",
            timeout=45,
        )
        if (maximum_product_verified_count(product_logs(target), torrent_id) or 0) >= fixture.piece_count:
            raise BootstrapFailure("controlled media completed before the incomplete playback gate")

        target.shell(["input", "keyevent", "KEYCODE_HOME"], check=False)
        wait_product_log(
            target,
            f"media_playback_pip instance={second_instance} active=true",
            "media picture-in-picture entry",
            timeout=20,
        )
        wait_product_service_state(target, running=True, foreground=True)

        request_product_media_action(target, torrent_id, "seek_media:20000")
        wait_product_log(
            target,
            f"media_playback_seek_requested instance={second_instance} position=20000",
            "incomplete media seek",
        )
        wait_product_log(
            target,
            f"media_playback_position instance={second_instance}",
            "incomplete media seek discontinuity",
            timeout=30,
        )

        def assert_playback_owner() -> None:
            if not product_service_state(target)[0]:
                raise BootstrapFailure("playback lease did not retain the product service")

        metrics, fd_high_water = wait_product_completion(
            target,
            torrent_id,
            baseline_fds,
            sample=assert_playback_owner,
        )
        wait_product_service_state(target, running=True, foreground=True)
        request_product_media_action(target, torrent_id, "seek_media:5000")
        wait_product_log(
            target,
            f"media_playback_seek_requested instance={second_instance} position=5000",
            "post-publication media seek",
        )
        time.sleep(2)
        final_logs = product_logs(target)
        if f"media_playback_error instance={second_instance}" in final_logs:
            raise BootstrapFailure("same-player publication handoff ended in playback failure")
        if len(re.findall(r"media_playback_created instance=", final_logs)) != 1:
            raise BootstrapFailure("publication handoff replaced the player activity")
        if target.shell(["test", "-f", output_path], check=False).returncode != 0:
            raise BootstrapFailure("completed controlled SAF media file is absent")
        digest = target.shell(["sha1sum", output_path]).stdout.split()[0]
        if digest != fixture.expected_sha1:
            raise BootstrapFailure("completed controlled SAF media hash differs")
        leaks = private_app_source_leaks(target, [b"http://127.0.0.1:"])
        if leaks:
            raise BootstrapFailure(f"media capability origin persisted in private files: {leaks}")

        request_product_media_action(target, torrent_id, "close_media")
        wait_product_log(
            target,
            f"media_playback_released instance={second_instance}",
            "handoff media player release",
        )
        target.shell(["input", "keyevent", "KEYCODE_HOME"], check=False)
        wait_product_log(
            target,
            "product_shutdown_complete reason=lifecycle_idle",
            "post-playback lifecycle shutdown",
            timeout=30,
        )
        wait_product_service_state(target, running=False)

        target.shell(["am", "start", "-W", "-n", ACTIVITY], check=False)
        request_product_torrent_action(target, torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={torrent_id}",
            "completed media removal",
        )
        return {
            "target": target_kind,
            "profile": "product-media-playback",
            "run": ordinal,
            "identity": identity,
            "torrent_id": torrent_id,
            "v1_info_hash": fixture.info_hash,
            "file_size": fixture.file_size,
            "piece_count": fixture.piece_count,
            "first_incomplete_verified": first_verified,
            "second_incomplete_verified": second_verified,
            "incomplete_first_frame": True,
            "removal_revoked_source": True,
            "picture_in_picture": True,
            "incomplete_seek": True,
            "publication_handoff": "same_player",
            "completed_hash": "exact",
            "capability_persistence": "absent",
            "playback_release": "joined",
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        if transport is not None:
            transport.close()
        if proxy is not None:
            proxy.close()
        fixture.close()
        target.shell(
            ["rm", "-rf", f"{probe.grant_path(grant_storage)}/{fixture.name}"],
            check=False,
        )
        probe.remove_grant_folder(target, grant_storage)


def run_product_mse_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    ordinal: int,
) -> dict[str, Any]:
    import libtorrent as lt

    grant_storage = "internal"
    fixtures = [
        SeedFixture.create(
            interop,
            f"{target_kind}-product-mse-{ordinal}-{attempt}",
            force_rc4=True,
        )
        for attempt in range(1, 6)
    ]
    fixture = fixtures[0]
    transports: list[ReverseTransport] = []
    observed_rc4: set[int] = set()
    output_root = f"{probe.grant_path(grant_storage)}/{fixture.name}"
    staging_root = f"{probe.grant_path(grant_storage)}/.{fixture.name}.rstorrent-staging"
    part_path = f"{probe.grant_path(grant_storage)}/.{fixture.name}.rstorrent-parts"
    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        baseline_fds = product_fd_count(target)
        transports = [
            ReverseTransport.create(
                target,
                target_kind,
                candidate.host_port,
                ordinal,
                slot=index,
            )
            for index, candidate in enumerate(fixtures)
        ]
        peer_hints = "".join(
            f"&x.pe=127.0.0.1:{transport.device_port}" for transport in transports
        )
        magnet = (
            f"magnet:?xt=urn:btih:{fixture.info_hash}&dn={fixture.name}{peer_hints}"
        )
        add_count = product_add_count(target, fixture.info_hash)
        started = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_magnet",
                shlex.quote(magnet),
                "--es",
                "product_encryption_policy",
                "required",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in started.stdout or (
            started.returncode != 0 and "Starting:" not in started.stdout
        ):
            raise BootstrapFailure("could not add Android product MSE magnet")
        torrent_id = wait_product_torrent_id(target, fixture.info_hash, add_count)
        staging_root = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-staging"
        part_path = f"{probe.grant_path(grant_storage)}/.{torrent_id}.rstorrent-parts"

        def sample_oracle_methods() -> None:
            for index, candidate in enumerate(fixtures):
                try:
                    if any(
                        peer.flags & lt.peer_info.rc4_encrypted
                        for peer in candidate.handle.get_peer_info()
                    ):
                        observed_rc4.add(index)
                except Exception:
                    pass

        metrics, fd_high_water = wait_product_completion(
            target,
            torrent_id,
            baseline_fds,
            sample_oracle_methods,
        )
        sample_oracle_methods()
        if len(observed_rc4) != len(fixtures):
            raise BootstrapFailure(
                "host oracle did not observe forced RC4 on all five attempts: "
                f"{sorted(index + 1 for index in observed_rc4)}"
            )
        evidence = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--ez",
                "product_mse_evidence",
                "true",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in evidence.stdout:
            raise BootstrapFailure("could not request Android MSE work evidence")
        pattern = re.compile(
            r"mse_dh_work waiting=(\d+) active=(\d+) high_water=(\d+) "
            r"tracked=(\d+) closed=(true|false)"
        )
        deadline = time.monotonic() + 10
        match = None
        logs = ""
        while time.monotonic() < deadline:
            logs = product_logs(target)
            match = pattern.search(logs)
            if match is not None:
                break
            time.sleep(0.2)
        if match is None:
            raise BootstrapFailure("Android MSE work evidence was not logged\n" + logs)
        waiting, active, high_water, tracked = (
            int(match.group(index)) for index in range(1, 5)
        )
        if not 1 <= high_water <= 4:
            raise BootstrapFailure(
                f"five Android MSE attempts observed invalid DH high-water {high_water}"
            )
        if waiting != 0 or active != 0 or tracked != 0:
            raise BootstrapFailure(
                "Android MSE work did not drain: "
                f"waiting={waiting} active={active} tracked={tracked}"
            )
        if "mse_settings configured=REQUIRED effective=REQUIRED application=APPLIED" not in logs:
            raise BootstrapFailure("Android product did not apply Required MSE policy")

        for relative_path, _, padding in fixture_files():
            path = f"{output_root}/{relative_path}"
            exists = target.shell(["test", "-f", path], check=False).returncode == 0
            if padding:
                if exists:
                    raise BootstrapFailure(f"padding file was created: {relative_path}")
                continue
            if not exists:
                raise BootstrapFailure(f"product MSE output is absent: {relative_path}")
            digest = target.shell(["sha1sum", path]).stdout.split()[0]
            if digest != fixture.expected_file_hashes[relative_path]:
                raise BootstrapFailure(f"product MSE output hash differs: {relative_path}")
        for unexpected in (staging_root, part_path):
            if target.shell(["test", "-e", unexpected], check=False).returncode == 0:
                raise BootstrapFailure(f"unexpected MSE artifact survived: {unexpected}")

        return {
            "target": target_kind,
            "profile": "product-mse",
            "run": ordinal,
            "identity": identity,
            "torrent_id": torrent_id,
            "v1_info_hash": fixture.info_hash,
            "content_name": fixture.name,
            "forced_rc4_attempts": len(observed_rc4),
            "mse_dh": {
                "waiting": waiting,
                "active": active,
                "high_water": high_water,
                "tracked": tracked,
            },
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        for exact_path in (output_root, staging_root, part_path):
            target.shell(["rm", "-rf", exact_path], check=False)
        probe.remove_grant_folder(target, grant_storage)
        for transport in reversed(transports):
            transport.close()
        for candidate in fixtures:
            candidate.close()


def request_download_admission_evidence(
    target: Any,
    mode: str,
) -> dict[str, int]:
    result = target.shell(
        [
            "am",
            "start",
            "-n",
            ACTIVITY,
            "--es",
            "product_download_admission_evidence",
            mode,
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in result.stdout or (
        result.returncode != 0 and "Starting:" not in result.stdout
    ):
        raise BootstrapFailure("could not request Android download admission evidence")
    marker = f"download_admission mode={mode} "
    deadline = time.monotonic() + 15
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        rows = [line for line in logs.splitlines() if marker in line]
        if rows:
            return {
                key: int(value)
                for key, value in re.findall(r"([a-z_]+)=(\d+)", rows[-1])
            }
        time.sleep(0.2)
    raise BootstrapFailure(
        f"timed out waiting for Android download admission {mode}\n{logs}"
    )


def request_seed_admission_evidence(
    target: Any,
    mode: str,
) -> dict[str, int]:
    result = target.shell(
        [
            "am",
            "start",
            "-n",
            ACTIVITY,
            "--es",
            "product_seed_admission_evidence",
            mode,
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in result.stdout or (
        result.returncode != 0 and "Starting:" not in result.stdout
    ):
        raise BootstrapFailure("could not request Android seed admission evidence")
    marker = f"seed_admission mode={mode} "
    deadline = time.monotonic() + 15
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        rows = [line for line in logs.splitlines() if marker in line]
        if rows:
            return {
                key: int(value)
                for key, value in re.findall(r"([a-z_]+)=(\d+)", rows[-1])
            }
        time.sleep(0.2)
    raise BootstrapFailure(
        f"timed out waiting for Android seed admission {mode}\n{logs}"
    )


def request_bandwidth_evidence(
    target: Any,
    mode: str,
) -> dict[str, int]:
    result = target.shell(
        [
            "am",
            "start",
            "-n",
            ACTIVITY,
            "--es",
            "product_bandwidth_policy",
            mode,
        ],
        timeout=30,
        check=False,
    )
    if "Error:" in result.stdout or (
        result.returncode != 0 and "Starting:" not in result.stdout
    ):
        raise BootstrapFailure("could not request Android bandwidth evidence")
    marker = f"bandwidth_policy mode={mode} "
    deadline = time.monotonic() + 35
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        rows = [line for line in logs.splitlines() if marker in line]
        if rows:
            return {
                key: int(value)
                for key, value in re.findall(r"([a-z_]+)=(\d+)", rows[-1])
            }
        time.sleep(0.2)
    raise BootstrapFailure(f"timed out waiting for Android bandwidth {mode}\n{logs}")


def run_product_concurrent_downloads_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    ordinal: int,
) -> dict[str, Any]:
    grant_storage = "internal"
    fixtures = [
        SeedFixture.create(
            interop,
            f"{target_kind}-product-concurrent-{ordinal}-{index}",
            root_name=f"concurrent-{ordinal}-{index}",
            content_offset=index * 1_000_000,
        )
        for index in range(1, 4)
    ]
    transports: list[ReverseTransport] = []
    grant_root = probe.grant_path(grant_storage)
    output_roots = [f"{grant_root}/{fixture.name}" for fixture in fixtures]
    staging_roots = [f"{grant_root}/.{fixture.name}.rstorrent-staging" for fixture in fixtures]
    part_roots = [f"{grant_root}/.{fixture.name}.rstorrent-parts" for fixture in fixtures]
    torrent_ids: list[str] = []
    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        baseline_fds = product_fd_count(target)
        configured_bandwidth = request_bandwidth_evidence(target, "configure")
        configured_at = time.monotonic()
        if configured_bandwidth.get("configured") != 24 * 1024 or configured_bandwidth.get(
            "effective"
        ) != 24 * 1024:
            raise BootstrapFailure(
                f"Android configured bandwidth diverged: {configured_bandwidth}"
            )
        for fixture in fixtures:
            fixture.handle.set_upload_limit(16 * 1024)
        transports = [
            ReverseTransport.create(
                target,
                target_kind,
                fixture.host_port,
                ordinal,
                slot=index,
            )
            for index, fixture in enumerate(fixtures)
        ]
        for fixture, transport in zip(fixtures, transports, strict=True):
            magnet = (
                f"magnet:?xt=urn:btih:{fixture.info_hash}&dn={fixture.name}"
                f"&x.pe=127.0.0.1:{transport.device_port}"
            )
            add_count = product_add_count(target, fixture.info_hash)
            started = target.shell(
                [
                    "am",
                    "start",
                    "-n",
                    ACTIVITY,
                    "--es",
                    "product_magnet",
                    shlex.quote(magnet),
                ],
                timeout=30,
                check=False,
            )
            if "Error:" in started.stdout or (
                started.returncode != 0 and "Starting:" not in started.stdout
            ):
                raise BootstrapFailure("could not add Android concurrent product magnet")
            torrent_ids.append(
                wait_product_torrent_id(target, fixture.info_hash, add_count)
            )
            time.sleep(0.1)
        staging_roots = [f"{grant_root}/.{owner}.rstorrent-staging" for owner in torrent_ids]
        part_roots = [f"{grant_root}/.{owner}.rstorrent-parts" for owner in torrent_ids]

        active = request_download_admission_evidence(target, "active")
        expected_active = {
            "configured": 3,
            "effective": 2,
            "active": 2,
            "queued": 1,
            "registered": 2,
            "registered_high": 2,
        }
        if any(active.get(key) != value for key, value in expected_active.items()):
            raise BootstrapFailure(f"Android active admission evidence diverged: {active}")
        active_bandwidth = request_bandwidth_evidence(target, "active")
        if (
            active_bandwidth.get("active_downloads") != 2
            or active_bandwidth.get("registered") != 3
            or active_bandwidth.get("granted", 0) <= 0
            or active_bandwidth.get("wait_high", 0) <= 0
        ):
            raise BootstrapFailure(
                f"Android active bandwidth evidence diverged: {active_bandwidth}"
            )

        def validate_resource_ceilings(evidence: dict[str, int]) -> None:
            if evidence.get("request_high", 0) > 128 * 1024 * 1024:
                raise BootstrapFailure(f"Android request ceiling exceeded: {evidence}")
            if evidence.get("payload_high", 0) > 16 * 1024 * 1024:
                raise BootstrapFailure(f"Android payload ceiling exceeded: {evidence}")
            if evidence.get("piece_bytes_high", 0) > 128 * 1024 * 1024:
                raise BootstrapFailure(f"Android piece-byte ceiling exceeded: {evidence}")
            if evidence.get("pieces_high", 0) > 2_048:
                raise BootstrapFailure(f"Android piece-count ceiling exceeded: {evidence}")
            if evidence.get("writes_high", 0) > 4 or evidence.get("hashes_high", 0) > 4:
                raise BootstrapFailure(f"Android storage ceiling exceeded: {evidence}")

        validate_resource_ceilings(active)

        storage_metrics = []
        fd_high_water = baseline_fds
        for torrent_id in torrent_ids:
            metrics, observed_fds = wait_product_completion(
                target,
                torrent_id,
                baseline_fds,
            )
            storage_metrics.append(metrics)
            fd_high_water = max(fd_high_water, observed_fds)
        terminal = request_download_admission_evidence(target, "terminal")
        if (
            terminal.get("active") != 0
            or terminal.get("queued") != 0
            or terminal.get("registered") != 0
            # Android admits at most two downloads. One separately bounded
            # Completion observation may overlap the next promoted download.
            or terminal.get("registered_high", 0) not in range(2, 4)
        ):
            raise BootstrapFailure(f"Android terminal admission did not drain: {terminal}")
        validate_resource_ceilings(terminal)
        terminal_bandwidth = request_bandwidth_evidence(target, "terminal")
        admitted_bytes = terminal_bandwidth.get("granted", 0) - terminal_bandwidth.get(
            "returned", 0
        )
        transfer_seconds = time.monotonic() - configured_at
        rate = 24 * 1024
        upper_bound = int(rate * transfer_seconds) + rate + 16 * 1024
        expected_payload = sum(length for _, length, padding in fixture_files() if not padding)
        if admitted_bytes < len(fixtures) * expected_payload or admitted_bytes > upper_bound:
            raise BootstrapFailure(
                "Android bandwidth cap evidence diverged: "
                f"admitted={admitted_bytes} expected_payload={len(fixtures) * expected_payload} "
                f"upper_bound={upper_bound} elapsed={transfer_seconds:.3f}"
            )
        if (
            terminal_bandwidth.get("active_downloads") != 0
            or terminal_bandwidth.get("active_waiters") != 0
            or terminal_bandwidth.get("queued") != 0
            or terminal_bandwidth.get("wait_high", 0) <= 0
            or terminal_bandwidth.get("burst", rate + 1) > rate
        ):
            raise BootstrapFailure(
                f"Android terminal bandwidth did not drain: {terminal_bandwidth}"
            )

        for fixture, output_root in zip(fixtures, output_roots, strict=True):
            for relative_path, _, padding in fixture_files():
                path = f"{output_root}/{relative_path}"
                exists = target.shell(["test", "-f", path], check=False).returncode == 0
                if padding:
                    if exists:
                        raise BootstrapFailure(f"padding file was created: {path}")
                    continue
                if not exists:
                    raise BootstrapFailure(f"concurrent product output is absent: {path}")
                digest = target.shell(["sha1sum", path]).stdout.split()[0]
                if digest != fixture.expected_file_hashes[relative_path]:
                    raise BootstrapFailure(f"concurrent product hash differs: {path}")
            if fixture.handle.status().total_upload <= 0:
                raise BootstrapFailure(f"host oracle uploaded no payload for {fixture.info_hash}")

        configured_seed = request_seed_admission_evidence(target, "configure_one")
        expected_seed = {
            "configured": 1,
            "effective": 1,
            "share": 200,
            "finished_ratio": 700,
            "finished_time": 86_400,
            "active": 1,
            "queued": 2,
            "inactive": 0,
            "ineligible": 0,
            "counted": 1,
            "exempt": 0,
        }
        if any(configured_seed.get(key) != value for key, value in expected_seed.items()):
            raise BootstrapFailure(
                f"Android configured seed admission diverged: {configured_seed}"
            )

        target.run(["logcat", "-c"], check=False)
        target.shell(["input", "keyevent", "KEYCODE_HOME"], check=False)
        wait_product_log(
            target,
            "product_shutdown_complete reason=lifecycle_idle",
            "default-off queued-seed shutdown",
            timeout=20,
        )
        wait_product_service_state(target, running=False)
        if product_has_ongoing_notification(target):
            raise BootstrapFailure(
                "default-off queued-seed shutdown retained the ongoing notification"
            )
        reopened_seed = request_seed_admission_evidence(target, "reopened_one")
        if any(reopened_seed.get(key) != value for key, value in expected_seed.items()):
            raise BootstrapFailure(
                f"Android reopened seed admission diverged: {reopened_seed}"
            )

        enabled = launch_product_lifecycle_evidence(target, "enable_background")
        seeded = launch_product_lifecycle_evidence(target, "enable_seeding")
        if enabled.get("effective") != "true" or seeded.get("keep_seeding") != "true":
            raise BootstrapFailure(
                "Android background seed admission did not enable: "
                f"background={enabled} seeding={seeded}"
            )
        background_seed = request_seed_admission_evidence(target, "background_one")
        if any(background_seed.get(key) != value for key, value in expected_seed.items()):
            raise BootstrapFailure(
                f"Android background seed admission diverged: {background_seed}"
            )
        target.run(["logcat", "-c"], check=False)
        target.shell(["input", "keyevent", "KEYCODE_HOME"], check=False)
        wait_product_log(
            target,
            "decision=retain_background_seeding",
            "queued-seed background admission",
            timeout=20,
        )
        wait_product_service_state(target, running=True, foreground=True)
        if not product_has_ongoing_notification(target):
            raise BootstrapFailure(
                "background queued-seed admission had no ongoing notification"
            )
        launch_product_lifecycle_evidence(target, "disable_seeding")
        target.run(["logcat", "-c"], check=False)
        target.shell(["input", "keyevent", "KEYCODE_HOME"], check=False)
        wait_product_log(
            target,
            "product_shutdown_complete reason=lifecycle_idle",
            "queued-seed background disable",
            timeout=20,
        )
        wait_product_service_state(target, running=False)
        launch_product_lifecycle_evidence(target, "disable_background")

        return {
            "target": target_kind,
            "profile": "product-concurrent-downloads",
            "run": ordinal,
            "identity": identity,
            "torrents": torrent_ids,
            "v1_info_hashes": [fixture.info_hash for fixture in fixtures],
            "active_admission": active,
            "terminal_admission": terminal,
            "seed_admission": {
                "visible": configured_seed,
                "reopened_background_disabled": reopened_seed,
                "background_enabled": background_seed,
                "background_retained": True,
                "background_disable_shutdown": True,
            },
            "bandwidth": {
                "configured": configured_bandwidth,
                "active": active_bandwidth,
                "terminal": terminal_bandwidth,
                "admitted_bytes": admitted_bytes,
                "upper_bound_bytes": upper_bound,
                "transfer_seconds": transfer_seconds,
            },
            "storage_metrics": storage_metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        for exact_path in output_roots + staging_roots + part_roots:
            target.shell(["rm", "-rf", exact_path], check=False)
        probe.remove_grant_folder(target, grant_storage)
        for transport in reversed(transports):
            transport.close()
        for fixture in fixtures:
            fixture.close()


def run_product_https_platform_trust_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    tracker_support: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-https-platform-trust requires SAF storage")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    invalid_info_hash = "11" * 20
    valid_origin_info_hash = "22" * 20
    ubuntu_info_hash = "62a4d9e139f3315f8716bcccca0cc984a9809da1"
    certificate_root = Path(
        tempfile.mkdtemp(prefix="rstorrent-android-platform-trust-")
    )
    controlled_tracker: Any | None = None
    tracker_transport: ReverseTransport | None = None
    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)

        controlled_tracker = tracker_support.ControlledHttpTracker(
            invalid_info_hash,
            1,
            https=True,
            certificate_root=certificate_root,
        )
        controlled_tracker.start()
        tracker_transport = ReverseTransport.create(
            target,
            target_kind,
            controlled_tracker.port,
            ordinal,
            slot=1,
        )
        invalid_url = controlled_tracker.url_for_port(tracker_transport.device_port)
        invalid_magnet = (
            f"magnet:?xt=urn:btih:{invalid_info_hash}"
            f"&dn=invalid-platform-trust&tr={quote(invalid_url, safe='')}"
        )
        launch_product_tracker_magnet(
            target,
            invalid_magnet,
            "system_trust",
            start_content=False,
        )
        invalid_logs = wait_product_tracker_row(
            target,
            invalid_info_hash,
            "ENCRYPTED_SYSTEM_TRUST",
            "RETRY_WAIT",
            error=True,
            timeout_seconds=30,
        )
        if controlled_tracker.requests:
            raise BootstrapFailure(
                "invalid Android platform-trust certificate reached HTTP"
            )
        if (
            "tracker_https_settings configured=SYSTEM_TRUST "
            "effective=SYSTEM_TRUST application=APPLIED" not in invalid_logs
        ):
            raise BootstrapFailure("Android system-trust policy was not effective")
        if not any(
            "error_detail=HTTP tracker request failed: "
            f"TLS failure: {category}" in invalid_logs
            for category in ("unknown_issuer", "certificate_rejected")
        ):
            raise BootstrapFailure(
                "Android untrusted certificate did not retain its stable TLS category"
            )
        target.shell(["am", "force-stop", PACKAGE], check=False)
        probe.remove_grant_folder(target, grant_storage)
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)

        ubuntu_tracker = "https://torrent.ubuntu.com/announce"
        ubuntu_magnet = (
            f"magnet:?xt=urn:btih:{ubuntu_info_hash}"
            "&dn=ubuntu-platform-trust"
            f"&tr={quote(ubuntu_tracker, safe='')}"
        )
        launch_product_tracker_magnet(
            target,
            ubuntu_magnet,
            "system_trust",
            start_content=False,
        )
        ubuntu_logs = wait_product_tracker_row(
            target,
            ubuntu_info_hash,
            "ENCRYPTED_SYSTEM_TRUST",
            "RETRY_WAIT",
            error=True,
            timeout_seconds=30,
        )
        public_error_marker = (
            "error_detail=HTTP tracker request failed: TLS failure: "
        )
        public_error_line = next(
            (line for line in ubuntu_logs.splitlines() if public_error_marker in line),
            None,
        )
        if public_error_line is None:
            raise BootstrapFailure("Ubuntu public smoke lacked a stable TLS category")
        public_tls_category = public_error_line.partition(public_error_marker)[2].strip()
        if public_tls_category not in {
            "unknown_issuer",
            "expired_or_not_yet_valid",
            "name_mismatch",
            "invalid_server_purpose",
            "certificate_rejected",
            "tls_protocol",
        }:
            raise BootstrapFailure("Ubuntu public smoke used an unknown TLS category")

        target.shell(["am", "force-stop", PACKAGE], check=False)
        probe.remove_grant_folder(target, grant_storage)
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        valid_origin = "https://example.com/announce"
        valid_origin_magnet = (
            f"magnet:?xt=urn:btih:{valid_origin_info_hash}"
            "&dn=valid-platform-trust"
            f"&tr={quote(valid_origin, safe='')}"
        )
        launch_product_tracker_magnet(
            target,
            valid_origin_magnet,
            "system_trust",
            start_content=False,
        )
        valid_logs = wait_product_tracker_row(
            target,
            valid_origin_info_hash,
            "ENCRYPTED_SYSTEM_TRUST",
            "RETRY_WAIT",
            error=True,
            timeout_seconds=30,
        )
        if "error_detail=HTTP tracker returned status 404" not in valid_logs:
            raise BootstrapFailure(
                "system-trusted Android origin did not reach its HTTP response"
            )

        grant_path = probe.grant_path(grant_storage)
        artifacts = target.shell(
            ["find", grant_path, "-mindepth", "1", "-maxdepth", "4", "-print"],
            timeout=15,
            check=False,
        ).stdout.strip()
        if artifacts:
            raise BootstrapFailure(
                "metadata-only Android platform-trust smoke created storage artifacts"
            )
        return {
            "target": target_kind,
            "profile": "product-https-platform-trust",
            "run": ordinal,
            "identity": identity,
            "invalid_chain_name": "rejected_before_http",
            "invalid_tracker_requests": len(controlled_tracker.requests),
            "valid_chain_name": "accepted_through_http_404",
            "valid_origin": "example.com",
            "public_tracker": "torrent.ubuntu.com",
            "public_info_hash": ubuntu_info_hash,
            "public_security": "encrypted_system_trust",
            "public_result": f"tls_{public_tls_category}",
            "start_content": False,
            "storage_artifacts": 0,
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        probe.remove_grant_folder(target, grant_storage)
        if tracker_transport is not None:
            tracker_transport.close()
        if controlled_tracker is not None:
            controlled_tracker.close()
        shutil.rmtree(certificate_root, ignore_errors=True)


def wait_pending_file_selection(
    target: Any,
    torrent_id: str,
    *,
    metadata: bool,
    awaiting: bool = True,
    timeout: float = 30,
) -> str:
    pattern = re.compile(
        rf"torrent={re.escape(torrent_id)} .*"
        rf"metadata={str(metadata).lower()} .*"
        rf"awaiting_selection={str(awaiting).lower()}\b"
    )
    deadline = time.monotonic() + timeout
    logs = ""
    while time.monotonic() < deadline:
        logs = product_logs(target)
        if any(pattern.search(line) for line in logs.splitlines()):
            return logs
        if "product service initialization failed" in logs:
            break
        time.sleep(0.1)
    raise BootstrapFailure(
        "timed out waiting for pending file selection "
        f"torrent={torrent_id} metadata={metadata} awaiting={awaiting}\n{logs}"
    )


def run_product_file_selection_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if target_kind not in ("avd", "chromeos"):
        raise BootstrapFailure(
            "product-file-selection requires an owned AVD or ChromeOS target"
        )
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-file-selection requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    fixture = SeedFixture.create(
        interop,
        f"{target_kind}-product-file-selection-{ordinal}",
        root_name=f"file-selection-{ordinal}",
    )
    peer_transport: ReverseTransport | None = None
    torrent_ids: list[str] = []
    selected_paths = {"wanted/start.bin", "tail.bin"}
    grant_root = probe.grant_path(grant_storage)
    output_root = f"{grant_root}/{fixture.name}"
    baseline_fds = 0
    fd_high_water = 0
    memory_baseline: dict[str, int] = {}
    memory_high_water = {"java_rss": 0, "native_rss": 0, "process_rss": 0}
    pre_restart_pid = ""
    recovery_pid = ""
    metrics: dict[str, int] = {}

    def sample_resources() -> None:
        nonlocal fd_high_water
        fd_high_water = max(fd_high_water, product_fd_count(target))
        current = product_memory_kib(target)
        for key, value in current.items():
            memory_high_water[key] = max(memory_high_water[key], value)

    def assert_no_payload_artifacts(torrent_id: str) -> None:
        paths = (
            output_root,
            f"{grant_root}/.{torrent_id}.rstorrent-staging",
            f"{grant_root}/.{torrent_id}.rstorrent-parts",
        )
        present = [
            path
            for path in paths
            if target.shell(["test", "-e", path], check=False).returncode == 0
        ]
        if present:
            raise BootstrapFailure(
                f"pending file selection created payload artifacts: {present}"
            )

    def verify_partial_output() -> None:
        for relative_path, _, padding in fixture_files():
            path = f"{output_root}/{relative_path}"
            exists = target.shell(["test", "-f", path], check=False).returncode == 0
            should_exist = relative_path in selected_paths and not padding
            if exists != should_exist:
                raise BootstrapFailure(
                    "partial file selection publication differs for "
                    f"{relative_path}: exists={exists} expected={should_exist}"
                )
            if should_exist:
                digest = target.shell(["sha1sum", path]).stdout.split()[0]
                if digest != fixture.expected_file_hashes[relative_path]:
                    raise BootstrapFailure(
                        f"partial file selection hash differs: {relative_path}"
                    )

    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)
        # The picker receipt can precede the storage projection consumed by
        # Add. Fence the same visible readiness that a real user depends on.
        wait_and_click_product_text(target, probe, "Add torrent")
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if any(node.attrib.get("text") == "Browse .torrent file"
                   and node.attrib.get("enabled") == "true"
                   for node in probe.ui_nodes(target)):
                break
            time.sleep(0.1)
        else:
            raise BootstrapFailure("Add did not observe the selected download folder")
        wait_and_click_product_text(target, probe, "Cancel")
        baseline_fds = product_fd_count(target)
        fd_high_water = baseline_fds
        memory_baseline = product_memory_kib(target)
        memory_high_water = dict(memory_baseline)
        peer_transport = ReverseTransport.create(
            target,
            target_kind,
            fixture.host_port,
            ordinal,
        )
        magnet = (
            f"magnet:?xt=urn:btih:{fixture.info_hash}"
            f"&dn={fixture.name}&x.pe=127.0.0.1:{peer_transport.device_port}"
        )
        add_count = product_add_count(target, fixture.info_hash)
        started = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_magnet",
                shlex.quote(magnet),
                "--ez",
                "product_await_file_selection",
                "true",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in started.stdout or "Error:" in started.stderr:
            raise BootstrapFailure("could not add pending file-selection magnet")
        torrent_id = wait_product_torrent_id(target, fixture.info_hash, add_count)
        torrent_ids.append(torrent_id)
        wait_pending_file_selection(target, torrent_id, metadata=False)
        wait_pending_file_selection(target, torrent_id, metadata=True)
        wait_product_text(target, probe, "Choose the files you want to download.")
        sample_resources()
        if fixture.handle.status().total_payload_upload != 0:
            raise BootstrapFailure("pending selection uploaded content before confirmation")
        assert_no_payload_artifacts(torrent_id)

        pre_restart_pid = target.shell(["pidof", PACKAGE], check=False).stdout.strip()
        target.shell(["am", "force-stop", PACKAGE], check=False)
        target.run(["logcat", "-c"], check=False)
        relaunched = target.shell(
            ["am", "start", "-W", "-n", ACTIVITY],
            timeout=30,
            check=False,
        )
        if "Error:" in relaunched.stdout or "Error:" in relaunched.stderr:
            raise BootstrapFailure("could not relaunch pending file selection")
        wait_pending_file_selection(target, torrent_id, metadata=True)
        wait_product_text(target, probe, "Choose the files you want to download.")
        recovery_pid = target.shell(["pidof", PACKAGE], check=False).stdout.strip()
        if not recovery_pid or recovery_pid == pre_restart_pid:
            raise BootstrapFailure(
                "pending selection did not recover under a replacement process"
            )
        if fixture.handle.status().total_payload_upload != 0:
            raise BootstrapFailure("recovered selection uploaded content before confirmation")
        assert_no_payload_artifacts(torrent_id)

        wait_and_click_product_text(target, probe, "None")
        wait_and_click_product_text(target, probe, "wanted/start.bin")
        wait_and_click_product_text(target, probe, "tail.bin", scroll=True)
        if any("change at most" in node.attrib.get("text", "")
               for node in probe.ui_nodes(target)):
            raise BootstrapFailure("valid file selection displayed an override-limit error")
        wait_product_text(target, probe, "2 of 6 selected")
        wait_and_click_product_text(target, probe, "Download")
        wait_pending_file_selection(
            target,
            torrent_id,
            metadata=True,
            awaiting=False,
        )
        metrics, completion_fd_high_water = wait_product_completion(
            target,
            torrent_id,
            baseline_fds,
            sample=sample_resources,
        )
        fd_high_water = max(fd_high_water, completion_fd_high_water)
        verify_partial_output()

        request_product_torrent_action(target, torrent_id, "force_recheck")
        verify_partial_output()
        request_product_torrent_action(target, torrent_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={torrent_id}",
            "partial selection cleanup",
        )
        assert_no_payload_artifacts(torrent_id)

        target.run(["logcat", "-c"], check=False)
        unknown_count = product_unknown_add_count(target)
        encoded = base64.b64encode(fixture.torrent_path.read_bytes()).decode("ascii")
        local = target.shell(
            [
                "am",
                "start",
                "-n",
                ACTIVITY,
                "--es",
                "product_torrent_base64",
                encoded,
                "--ez",
                "product_await_file_selection",
                "true",
            ],
            timeout=30,
            check=False,
        )
        if "Error:" in local.stdout or "Error:" in local.stderr:
            raise BootstrapFailure("could not add pending local torrent")
        local_id = wait_product_unknown_torrent_id(target, unknown_count)
        torrent_ids.append(local_id)
        wait_pending_file_selection(target, local_id, metadata=True)
        wait_and_click_product_text(target, probe, "Cancel")
        # Cancellation removes the row before the diagnostic snapshot is
        # projected, so its torrent field may already be `none`. Logcat was
        # cleared after the previous fixture's joined cleanup; this is the
        # sole pending add. Require cancellation and joined removal separately.
        wait_product_log(
            target,
            "diagnostic=pending_add_cancelled",
            "pending local torrent cancellation",
        )
        wait_product_log(
            target,
            "diagnostic=torrent_removal_completed",
            "joined pending local torrent cancellation",
        )
        assert_no_payload_artifacts(local_id)
        sample_resources()

        # Prove actual Compose -> UniFFI -> durable all consent while the seed
        # is unavailable for metadata, then release it and verify every file.
        fixture.handle.pause()
        target.run(["logcat", "-c"], check=False)
        all_count = product_add_count(target, fixture.info_hash)
        target.shell([
            "am", "start", "-n", ACTIVITY,
            "--es", "product_magnet", shlex.quote(magnet + "&so=0"),
            "--ez", "product_await_file_selection", "true",
        ], timeout=30)
        all_id = wait_product_torrent_id(target, fixture.info_hash, all_count)
        torrent_ids.append(all_id)
        wait_pending_file_selection(target, all_id, metadata=False)
        assert_no_payload_artifacts(all_id)
        wait_and_click_product_text(target, probe, "Download all")
        wait_pending_file_selection(target, all_id, metadata=False, awaiting=False)
        fixture.handle.resume()
        all_metrics, all_fd_high_water = wait_product_completion(
            target, all_id, baseline_fds, sample=sample_resources,
        )
        fd_high_water = max(fd_high_water, all_fd_high_water)
        verify_external_fixture_files(target, fixture, output_root)
        request_product_torrent_action(target, all_id, "remove")
        wait_product_log(target, f"saf_removal_confirmed torrent={all_id}", "all selection cleanup")
        assert_no_payload_artifacts(all_id)

        if fixture.handle.status().total_payload_upload <= 0:
            raise BootstrapFailure("file-selection oracle uploaded no selected payload")
        if any(item["owned_high_water"] > item["limit"] for item in (metrics, all_metrics)):
            raise BootstrapFailure("file selection exceeded the SAF handle bound")
        if not all(memory_high_water.values()):
            raise BootstrapFailure(
                f"file-selection memory evidence was incomplete: {memory_high_water}"
            )
        return {
            "target": target_kind,
            "profile": "product-file-selection",
            "run": ordinal,
            "identity": identity,
            "torrent_ids": torrent_ids,
            "v1_info_hash": fixture.info_hash,
            "content_name": fixture.name,
            "metadata_wait": "observed",
            "preconfirm_content_upload": 0,
            "process_recovery": {
                "before": pre_restart_pid,
                "after": recovery_pid,
            },
            "selection": {
                "base": "none",
                "selected_files": sorted(selected_paths),
                "selected_count": len(selected_paths),
                "selectable_count": 6,
                "skipped_files_absent": True,
            },
            "download_all_before_metadata": "confirmed",
            "download_all_source_selection": "explicit_all_overrides_so",
            "download_all_files": "hash_verified",
            "download_all_storage_metrics": all_metrics,
            "local_torrent_cancel": "joined_keep_payload",
            "catalog_page_high_water": 1,
            "draft_override_high_water": len(selected_paths),
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "final": product_fd_count(target),
            },
            "memory_kib": {
                "baseline": memory_baseline,
                "high_water": memory_high_water,
            },
            "force_recheck": "passed",
            "removal": "exact",
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        if peer_transport is not None:
            peer_transport.close()
        probe.remove_grant_folder(target, grant_storage)
        fixture.close()


def run_product_external_intake_profile(
    target: Any,
    target_kind: str,
    identity: dict[str, str],
    probe: ModuleType,
    interop: ModuleType,
    tracker_support: ModuleType,
    ordinal: int,
    storage: str,
) -> dict[str, Any]:
    if target_kind != "avd":
        raise BootstrapFailure("product-external-intake requires an owned AVD")
    if not storage.startswith("saf-"):
        raise BootstrapFailure("product-external-intake requires a SAF storage mode")
    grant_storage = "sdcard" if storage == "saf-sdcard" else "internal"
    fixture = SeedFixture.create(
        interop,
        f"{target_kind}-product-external-intake-{ordinal}",
    )
    test_package = external_fixture_package(target)
    authority = f"{test_package}.external-intake-fixture"
    grant_root = probe.grant_path(grant_storage)
    output_root = f"{grant_root}/{fixture.name}"
    peer_transport: ReverseTransport | None = None
    tracker_transport: ReverseTransport | None = None
    controlled_tracker: Any | None = None
    torrent_ids: list[str] = []
    baseline_fds = 0
    fd_high_water = 0
    metrics: dict[str, int] = {}
    memory_baseline: dict[str, int] = {}
    memory_high_water = {"java_rss": 0, "native_rss": 0, "process_rss": 0}
    privacy_token = "external-intake-private-197"
    privacy_magnet = (
        f"magnet:?xt=urn:btih:{'e' * 40}&dn={privacy_token}"
        f"&tr=https%3A%2F%2Fsecret.invalid%2F{privacy_token}"
    )
    try:
        clear_application(target)
        prepare_product_saf(target, probe, grant_storage)

        presented_count = external_log_count(target, "phase=presented", "kind=magnet")
        launch_external_magnet(target, privacy_magnet, cold=True)
        wait_external_log(
            target,
            presented_count,
            "phase=presented",
            "kind=magnet",
        )
        duplicate_count = external_log_count(
            target,
            "phase=duplicate",
            "disposition=coalesced",
        )
        launch_external_magnet(target, privacy_magnet, cold=False)
        wait_external_log(
            target,
            duplicate_count,
            "phase=duplicate",
            "disposition=coalesced",
        )
        cancelled_count = external_log_count(target, "phase=cancelled")
        wait_and_click_product_text(target, probe, "Cancel")
        wait_external_log(target, cancelled_count, "phase=cancelled")

        baseline_fds = product_fd_count(target)
        fd_high_water = baseline_fds
        memory_baseline = product_memory_kib(target)
        memory_high_water = dict(memory_baseline)
        peer_transport = ReverseTransport.create(
            target,
            target_kind,
            fixture.host_port,
            ordinal,
        )
        controlled_tracker = tracker_support.ControlledHttpTracker(
            fixture.info_hash,
            peer_transport.device_port,
        )
        controlled_tracker.start()
        tracker_transport = ReverseTransport.create(
            target,
            target_kind,
            controlled_tracker.port,
            ordinal,
            slot=1,
        )
        source = tracker_metainfo(
            fixture.torrent_path,
            controlled_tracker.url_for_port(tracker_transport.device_port),
        )

        presented_count = external_log_count(target, "phase=presented")
        duplicate_count = external_log_count(target, "phase=duplicate")
        launch_external_fixture(
            target,
            test_package,
            "valid",
            payload=source,
            repeat=2,
        )
        wait_external_log(target, presented_count, "phase=presented")
        wait_external_log(
            target,
            duplicate_count,
            "phase=duplicate",
            "disposition=coalesced",
        )
        success_count = external_log_count(target, "phase=success")
        wait_and_click_product_text(target, probe, "Choose files…")
        wait_external_log(
            target,
            success_count,
            "phase=success",
            "disposition=added",
        )
        paused_id = wait_product_view_torrent_id(target, fixture.info_hash)
        torrent_ids.append(paused_id)
        wait_and_click_product_text(target, probe, "None")
        wait_and_click_product_text(target, probe, "Add")
        wait_product_torrent_state(
            target,
            paused_id,
            state="PAUSED",
            description="paused external torrent",
        )

        already_count = external_log_count(
            target,
            "phase=duplicate",
            "disposition=already_present",
        )
        launch_external_fixture(target, test_package, "valid", payload=source)
        wait_and_click_product_text(target, probe, "Download all")
        wait_external_log(
            target,
            already_count,
            "phase=duplicate",
            "disposition=already_present",
        )
        request_product_torrent_action(target, paused_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={paused_id}",
            "external paused torrent removal",
        )

        success_count = external_log_count(target, "phase=success")
        launch_external_fixture(target, test_package, "valid", payload=source)
        wait_and_click_product_text(target, probe, "Download all")
        wait_external_log(
            target,
            success_count,
            "phase=success",
            "disposition=added",
        )
        started_id = wait_product_view_torrent_id(
            target,
            fixture.info_hash,
            excluding=set(torrent_ids),
        )
        torrent_ids.append(started_id)
        metrics, next_fd_high_water = wait_product_completion(
            target,
            started_id,
            baseline_fds,
        )
        fd_high_water = max(fd_high_water, next_fd_high_water)
        verify_external_fixture_files(target, fixture, output_root)
        request_product_torrent_action(target, started_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={started_id}",
            "external started torrent removal",
        )

        for fixture_case, terminal_reason in (
            ("empty", "reason=empty"),
            ("oversized", "reason=oversized"),
        ):
            terminal_count = external_log_count(
                target,
                "phase=terminal",
                terminal_reason,
            )
            launch_external_fixture(target, test_package, fixture_case)
            wait_and_click_product_text(target, probe, "Download all")
            wait_external_log(
                target,
                terminal_count,
                "phase=terminal",
                terminal_reason,
            )

        def sample_external_resources() -> None:
            nonlocal fd_high_water
            fd_high_water = max(fd_high_water, product_fd_count(target))
            current = product_memory_kib(target)
            for key, value in current.items():
                memory_high_water[key] = max(memory_high_water[key], value)

        source_read_count = external_log_count(
            target,
            "phase=source_read",
            "bytes=67108864",
        )
        terminal_count = external_log_count(
            target,
            "phase=terminal",
            "reason=invalid_or_engine_failure",
        )
        launch_external_fixture(target, test_package, "near-limit")
        wait_and_click_product_text(target, probe, "Download all")
        wait_external_log(
            target,
            terminal_count,
            "phase=terminal",
            "reason=invalid_or_engine_failure",
            sample=sample_external_resources,
        )
        source_read = wait_external_log(
            target,
            source_read_count,
            "phase=source_read",
            "bytes=67108864",
        )
        peak_match = re.search(r"\bpeak_source_bytes=(\d+)\b", source_read)
        if peak_match is None:
            raise BootstrapFailure("near-limit source read omitted its buffer high water")
        source_peak_bytes = int(peak_match.group(1))
        if source_peak_bytes > MAX_TORRENT_SOURCE_BYTES * 2 + 16 * 1024:
            raise BootstrapFailure("near-limit source buffer exceeded its ownership bound")

        for fixture_case in ("denied", "failing"):
            retry_count = external_log_count(target, "phase=retry")
            launch_external_fixture(target, test_package, fixture_case)
            wait_and_click_product_text(target, probe, "Download all")
            wait_external_log(target, retry_count, "phase=retry")
            terminal_count = external_log_count(target, "phase=terminal")
            wait_and_click_product_text(target, probe, "Retry")
            wait_external_log(target, terminal_count, "phase=terminal")

        cancelled_count = external_log_count(target, "phase=cancelled")
        launch_external_fixture(
            target,
            test_package,
            "delayed-once",
            payload=source,
        )
        wait_and_click_product_text(target, probe, "Download all")
        time.sleep(0.5)
        wait_and_click_product_text(target, probe, "Cancel")
        wait_external_log(target, cancelled_count, "phase=cancelled")

        retry_count = external_log_count(target, "phase=retry", "reason=timeout")
        launch_external_fixture(
            target,
            test_package,
            "delayed-once",
            payload=source,
        )
        wait_and_click_product_text(target, probe, "Download all")
        wait_external_log(
            target,
            retry_count,
            "phase=retry",
            "reason=timeout",
            timeout=40,
        )
        success_count = external_log_count(target, "phase=success")
        wait_and_click_product_text(target, probe, "Retry")
        wait_external_log(target, success_count, "phase=success")
        retried_id = wait_product_view_torrent_id(
            target,
            fixture.info_hash,
            excluding=set(torrent_ids),
        )
        torrent_ids.append(retried_id)
        retry_metrics, retry_fd_high_water = wait_product_completion(
            target,
            retried_id,
            baseline_fds,
        )
        if retry_metrics["limit"] != metrics["limit"]:
            raise BootstrapFailure("external intake SAF handle limit changed during run")
        metrics["owned_high_water"] = max(
            metrics["owned_high_water"],
            retry_metrics["owned_high_water"],
        )
        metrics["pending_high_water"] = max(
            metrics["pending_high_water"],
            retry_metrics["pending_high_water"],
        )
        fd_high_water = max(fd_high_water, retry_fd_high_water)
        verify_external_fixture_files(target, fixture, output_root)
        request_product_torrent_action(target, retried_id, "remove")
        wait_product_log(
            target,
            f"saf_removal_confirmed torrent={retried_id}",
            "retried external torrent removal",
        )

        rejected_count = external_log_count(
            target,
            "phase=rejected",
            "reason=directory",
        )
        launch_external_fixture(target, test_package, "directory")
        wait_external_log(target, rejected_count, "phase=rejected", "reason=directory")
        rejected_count = external_log_count(
            target,
            "phase=rejected",
            "reason=unsupported_content",
        )
        launch_external_fixture(
            target,
            test_package,
            "generic-rejected",
            mime_type="application/octet-stream",
        )
        wait_external_log(
            target,
            rejected_count,
            "phase=rejected",
            "reason=unsupported_content",
        )
        presented_count = external_log_count(target, "phase=presented")
        launch_external_fixture(
            target,
            test_package,
            "generic",
            mime_type="application/octet-stream",
        )
        wait_external_log(target, presented_count, "phase=presented")
        cancelled_count = external_log_count(target, "phase=cancelled")
        wait_and_click_product_text(target, probe, "Cancel")
        wait_external_log(target, cancelled_count, "phase=cancelled")

        fd_high_water = max(fd_high_water, product_fd_count(target))
        if (
            baseline_fds
            and fd_high_water - baseline_fds > MAX_EXTERNAL_INTAKE_FD_DELTA
        ):
            raise BootstrapFailure(
                "external intake descriptor delta exceeded its bounds: "
                f"baseline={baseline_fds} high_water={fd_high_water}"
            )
        settled_fds = product_fd_count(target)
        settle_deadline = time.monotonic() + 10
        while (
            baseline_fds
            and settled_fds - baseline_fds > MAX_EXTERNAL_INTAKE_SETTLED_FD_DELTA
            and time.monotonic() < settle_deadline
        ):
            time.sleep(0.2)
            settled_fds = product_fd_count(target)
        if (
            baseline_fds
            and settled_fds - baseline_fds > MAX_EXTERNAL_INTAKE_SETTLED_FD_DELTA
        ):
            raise BootstrapFailure(
                "external intake descriptors did not settle after terminal work: "
                f"baseline={baseline_fds} settled={settled_fds}"
            )
        if fixture.handle.status().total_upload <= 0:
            raise BootstrapFailure("external intake oracle uploaded no payload")
        if metrics["owned_high_water"] > metrics["limit"]:
            raise BootstrapFailure("external intake exceeded the SAF handle bound")
        if not all(memory_high_water.values()):
            raise BootstrapFailure(
                f"external intake memory evidence was incomplete: {memory_high_water}"
            )
        product_log = product_logs(target)
        if privacy_magnet in product_log or privacy_token in product_log or authority in product_log:
            raise BootstrapFailure("external intake source leaked into product diagnostics")
        private_leaks = private_app_source_leaks(
            target,
            [privacy_magnet.encode("utf-8"), authority.encode("utf-8")],
        )
        if private_leaks:
            raise BootstrapFailure(
                f"external intake source leaked into app-private files: {private_leaks}"
            )

        target.shell(["am", "force-stop", PACKAGE], check=False)
        grants = target.shell(["dumpsys", "package", PACKAGE], check=False).stdout
        if authority in grants:
            raise BootstrapFailure("temporary external content grant survived force-stop")

        return {
            "target": target_kind,
            "profile": "product-external-intake",
            "run": ordinal,
            "identity": identity,
            "torrent_ids": torrent_ids,
            "v1_info_hash": fixture.info_hash,
            "content_name": fixture.name,
            "outcomes": {
                "paused": "retained_without_start",
                "started": "complete",
                "already_present": "typed",
                "empty": "terminal",
                "oversized": "terminal",
                "denied": "retry_then_terminal",
                "failing": "retry_then_terminal",
                "delayed": "cancelled_then_timeout_retry_complete",
                "directory": "rejected",
                "generic_name": "accepted_then_cancelled",
                "generic_other": "rejected",
                "near_limit_unknown_length": "bounded_terminal",
                "cold_magnet": "presented",
                "warm_magnet": "coalesced",
            },
            "source_buffer": {
                "bytes": MAX_TORRENT_SOURCE_BYTES,
                "peak_owned_bytes": source_peak_bytes,
            },
            "memory_kib": {
                "baseline": memory_baseline,
                "high_water": memory_high_water,
            },
            "storage_metrics": metrics,
            "process_fds": {
                "baseline": baseline_fds,
                "high_water": fd_high_water,
                "settled": settled_fds,
                "final": product_fd_count(target),
            },
            "temporary_grant": "revoked_on_force_stop",
            "peer_connections": peer_count(fixture),
            "removal": "exact",
        }
    finally:
        target.shell(["am", "force-stop", PACKAGE], check=False)
        for torrent_id in torrent_ids:
            target.shell(
                [
                    "rm",
                    "-rf",
                    f"{grant_root}/.{torrent_id}.rstorrent-staging",
                ],
                check=False,
            )
            target.shell(
                ["rm", "-rf", f"{grant_root}/.{torrent_id}.rstorrent-parts"],
                check=False,
            )
        target.shell(["rm", "-rf", output_root], check=False)
        probe.remove_grant_folder(target, grant_storage)
        if tracker_transport is not None:
            tracker_transport.close()
        if controlled_tracker is not None:
            controlled_tracker.close()
        if peer_transport is not None:
            peer_transport.close()
        fixture.close()


def external_fixture_package(target: Any) -> str:
    listing = target.shell(["pm", "list", "instrumentation"], timeout=15)
    pattern = re.compile(r"instrumentation:([^/]+)/[^ ]+ \(target=([^)]+)\)")
    for test_package, target_package in pattern.findall(listing.stdout):
        if target_package == PACKAGE:
            return test_package
    raise BootstrapFailure("could not resolve the installed external-intake fixture package")


def launch_external_magnet(target: Any, magnet: str, *, cold: bool) -> None:
    if cold:
        target.shell(["am", "force-stop", PACKAGE], check=False)
    started = target.shell(
        [
            "am",
            "start",
            "-W",
            "-a",
            "android.intent.action.VIEW",
            "-c",
            "android.intent.category.BROWSABLE",
            "-d",
            shlex.quote(magnet),
        ],
        timeout=30,
        check=False,
    )
    if (
        "Error:" in started.stdout
        or "Error:" in started.stderr
        or PACKAGE not in started.stdout
    ):
        raise BootstrapFailure("implicit external magnet did not resolve to RSTorrent")


def launch_external_fixture(
    target: Any,
    test_package: str,
    fixture: str,
    *,
    mime_type: str | None = "application/x-bittorrent",
    payload: bytes | None = None,
    repeat: int = 1,
) -> None:
    target.shell(["am", "force-stop", test_package], check=False)
    component = (
        f"{test_package}/"
        "org.rstorrent.bootstrap.ExternalIntakeFixtureActivity"
    )
    command = [
        "am",
        "start",
        "-W",
        "-n",
        component,
        "--es",
        "target_package",
        PACKAGE,
        "--es",
        "fixture",
        fixture,
        "--ei",
        "repeat_count",
        str(repeat),
    ]
    if mime_type is not None:
        command.extend(["--es", "mime_type", mime_type])
    if payload is not None:
        command.extend(
            ["--es", "payload_base64", base64.b64encode(payload).decode("ascii")]
        )
    started = target.shell(command, timeout=30, check=False)
    if "Error:" in started.stdout or "Error:" in started.stderr:
        raise BootstrapFailure(f"could not launch external fixture {fixture}")


def wait_and_click_product_text(
    target: Any,
    probe: ModuleType,
    label: str,
    *,
    timeout: float = 15,
    scroll: bool = False,
) -> None:
    deadline = time.monotonic() + timeout
    visible: list[str] = []
    scrolls = 0
    while time.monotonic() < deadline:
        nodes = probe.ui_nodes(target)
        visible = [
            value
            for node in nodes
            for value in (
                node.attrib.get("text", "").strip(),
                node.attrib.get("content-desc", "").strip(),
            )
            if value
        ]
        if probe.click_from_nodes(target, nodes, [label]):
            return
        if scroll and scrolls < 8:
            for node in nodes:
                if node.attrib.get("scrollable") != "true":
                    continue
                bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.attrib.get("bounds", ""))
                if bounds:
                    left, top, right, bottom = map(int, bounds.groups())
                    x = (left + right) // 2
                    inset = max(1, (bottom - top) // 5)
                    target.shell(["input", "swipe", str(x), str(bottom - inset),
                                  str(x), str(top + inset), "300"])
                    scrolls += 1
                    break
        time.sleep(0.2)
    raise BootstrapFailure(
        f"could not click product UI action {label!r}; visible={visible!r}\n"
        f"{product_logs(target)}"
    )


def external_log_count(target: Any, *markers: str) -> int:
    return sum(
        1
        for line in product_logs(target).splitlines()
        if "external_intake " in line and all(marker in line for marker in markers)
    )


def wait_external_log(
    target: Any,
    previous_count: int,
    *markers: str,
    timeout: float = 45,
    sample: Any | None = None,
) -> str:
    deadline = time.monotonic() + timeout
    logs = ""
    while time.monotonic() < deadline:
        if sample is not None:
            sample()
        logs = product_logs(target)
        matches = [
            line
            for line in logs.splitlines()
            if "external_intake " in line
            and all(marker in line for marker in markers)
        ]
        if len(matches) > previous_count:
            return matches[-1]
        if "product service initialization failed" in logs:
            break
        time.sleep(0.1)
    raise BootstrapFailure(
        "timed out waiting for external intake "
        f"markers={markers!r}\n{logs}"
    )


def wait_product_view_torrent_id(
    target: Any,
    info_hash: str,
    *,
    excluding: set[str] | None = None,
    timeout: float = 20,
) -> str:
    pattern = re.compile(
        rf"torrent=(t1-[0-9a-f]{{32}}) v1={re.escape(info_hash)}\b"
    )
    excluded = excluding or set()
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for torrent_id in reversed(pattern.findall(product_logs(target))):
            if torrent_id not in excluded:
                return torrent_id
        time.sleep(0.1)
    raise BootstrapFailure("timed out waiting for the external torrent projection")


def tracker_metainfo(source: Path, announce_url: str) -> bytes:
    import libtorrent as lt

    metainfo = lt.bdecode(source.read_bytes())
    metainfo[b"announce"] = announce_url.encode("utf-8")
    return bytes(lt.bencode(metainfo))


def verify_external_fixture_files(
    target: Any,
    fixture: SeedFixture,
    output_root: str,
) -> None:
    for relative_path, _, padding in fixture_files():
        path = f"{output_root}/{relative_path}"
        exists = target.shell(["test", "-f", path], check=False).returncode == 0
        if padding:
            if exists:
                raise BootstrapFailure(
                    f"external intake created padding file {relative_path}"
                )
            continue
        if not exists:
            raise BootstrapFailure(f"external intake output is absent: {relative_path}")
        digest = target.shell(["sha1sum", path]).stdout.split()[0]
        if digest != fixture.expected_file_hashes[relative_path]:
            raise BootstrapFailure(
                f"external intake output hash differs: {relative_path}"
            )


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        choices=["avd", "chromeos", "pixel7a", "motox4"],
        required=True,
    )
    parser.add_argument("--avd", default="jstorrent-tablet")
    parser.add_argument("--avd-api", choices=["28", "34", "35"], default="34")
    parser.add_argument("--runs", type=int, choices=range(1, 6), default=1)
    parser.add_argument(
        "--storage",
        choices=["private", "saf-internal", "saf-sdcard"],
        default="private",
    )
    parser.add_argument(
        "--profile",
        action="append",
        choices=PROFILE_CHOICES,
        dest="profiles",
    )
    parser.add_argument("--no-build", action="store_true")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    if arguments.storage == "saf-sdcard" and arguments.target != "motox4":
        print("SAF removable storage is available only on motox4", file=sys.stderr)
        return 1
    ensure_interop_environment()
    (
        probe,
        interop,
        tracker_support,
        duplex_support,
        pure_v2_support,
        hybrid_support,
    ) = load_support()
    profiles = arguments.profiles or ["success"]
    apk = (
        android_root() / "app" / "build" / "outputs" / "apk" / "debug" /
        "app-debug.apk"
        if arguments.no_build
        else build_apk()
    )
    if not apk.is_file():
        print(f"bootstrap APK is unavailable at {apk}", file=sys.stderr)
        return 1

    test_apk: Path | None = None
    if "product-external-intake" in profiles:
        test_apk = (
            android_root()
            / "app"
            / "build"
            / "outputs"
            / "apk"
            / "androidTest"
            / "debug"
            / "app-debug-androidTest.apk"
            if arguments.no_build
            else build_android_test_apk()
        )
        if not test_apk.is_file():
            print(f"external-intake fixture APK is unavailable at {test_apk}", file=sys.stderr)
            return 1
    avd_session = None
    target = None
    installed_test_package: str | None = None
    results: list[dict[str, Any]] = []
    failure: BaseException | None = None
    try:
        if arguments.target == "avd":
            avd_session = probe.start_avd(arguments.avd, arguments.avd_api)
            target = avd_session.target
        elif arguments.target == "chromeos":
            target = probe.prepare_chromeos()
        elif arguments.target == "pixel7a":
            target = probe.prepare_pixel()
        else:
            target = probe.prepare_moto()
        identity = probe.verify_target(
            target,
            arguments.target,
            arguments.avd_api,
        )
        if arguments.storage != "private":
            identity.update(
                probe.verify_storage(
                    target,
                    arguments.target,
                    "sdcard"
                    if arguments.storage == "saf-sdcard"
                    else "internal",
                )
            )
        probe.install_apk(target, arguments.target, apk)
        if test_apk is not None:
            probe.install_apk(target, arguments.target, test_apk)
            installed_test_package = external_fixture_package(target)

        for profile in profiles:
            repetitions = (
                arguments.runs
                if profile
                in (
                    "success",
                    "product-data-reset",
                    "product-dynamic-saf",
                    "product-hybrid-saf",
                    "product-pure-v2-saf",
                    "product-identity-reset",
                    "product-incomplete-duplex",
                    "product-notifications",
                    "product-https-tracker",
                    "product-mse",
                    "product-concurrent-downloads",
                    "product-unmetered-network",
                    "product-background-lifecycle",
                    "product-external-intake",
                    "product-file-selection",
                    "product-media-playback",
                )
                else 1
            )
            for ordinal in range(1, repetitions + 1):
                if profile == "cancellation":
                    result = run_cancellation_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "preexisting-artifacts":
                    result = run_preexisting_profile(
                        target,
                        arguments.target,
                        identity,
                        interop,
                        ordinal,
                    )
                elif profile == "product-data-reset":
                    result = run_product_data_reset_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-dynamic-saf":
                    result = run_product_dynamic_saf_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-pure-v2-saf":
                    result = run_product_pure_v2_saf_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        tracker_support,
                        pure_v2_support,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-hybrid-saf":
                    result = run_product_hybrid_saf_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        pure_v2_support,
                        hybrid_support,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-identity-reset":
                    result = run_product_dynamic_saf_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                        arguments.storage,
                        identity_reset=True,
                    )
                elif profile == "product-saf-grant-repair":
                    result = run_product_saf_grant_repair_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        arguments.storage,
                    )
                elif profile == "product-notifications":
                    result = run_product_notifications_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-incomplete-duplex":
                    result = run_product_incomplete_duplex_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        duplex_support,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-https-tracker":
                    result = run_product_dynamic_saf_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                        arguments.storage,
                        tracker_support,
                    )
                elif profile == "product-https-platform-trust":
                    result = run_product_https_platform_trust_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        tracker_support,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-mse":
                    result = run_product_mse_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                    )
                elif profile == "product-concurrent-downloads":
                    result = run_product_concurrent_downloads_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                    )
                elif profile == "product-ipv6-policy":
                    result = run_product_ipv6_policy_profile(
                        target,
                        arguments.target,
                        identity,
                        ordinal,
                    )
                elif profile == "product-unmetered-network":
                    result = run_product_unmetered_network_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-background-lifecycle":
                    result = run_product_background_lifecycle_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-external-intake":
                    result = run_product_external_intake_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        tracker_support,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-file-selection":
                    result = run_product_file_selection_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        ordinal,
                        arguments.storage,
                    )
                elif profile == "product-media-playback":
                    result = run_product_media_playback_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        duplex_support,
                        ordinal,
                        arguments.storage,
                    )
                else:
                    result = run_standard_profile(
                        target,
                        arguments.target,
                        identity,
                        probe,
                        interop,
                        profile,
                        ordinal,
                        arguments.storage,
                    )
                results.append(result)
                print(json.dumps(result, sort_keys=True), flush=True)
    except BaseException as error:
        failure = error
    finally:
        if target is not None:
            target.shell(["am", "force-stop", PACKAGE], check=False)
            target.shell(["pm", "clear", PACKAGE], check=False)
            target.run(["reverse", "--remove-all"], timeout=15, check=False)
            if installed_test_package is not None:
                target.run(
                    ["uninstall", installed_test_package],
                    timeout=30,
                    check=False,
                )
            target.run(["uninstall", PACKAGE], timeout=30, check=False)
        if avd_session is not None:
            avd_session.close()

    if failure is not None:
        print(f"bootstrap failed: {failure}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "target": arguments.target,
                "profiles": profiles,
                "storage": arguments.storage,
                "results": len(results),
                "result": "pass",
                "cleanup": "ok",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
