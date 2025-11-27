import pytest


def test_btengine_http_rpc(engine):
    """Test BtEngine HTTP RPC basic operations."""
    # Status should be running because JSTEngine starts the engine in __init__
    status = engine.status()
    assert status.get("running") is True, "Expected running: true after JSTEngine init"

    # Add a magnet
    magnet = (
        "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&"
        "tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&"
        "tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&"
        "tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&"
        "tr=udp%3A%2F%2Fexplodie.org%3A6969&"
        "tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337"
    )
    tid = engine.add_magnet(magnet)
    assert tid, "No torrent ID returned"

    # Fetch torrent status
    tstatus = engine.get_torrent_status(tid)
    assert tstatus.get("id") == tid, "Torrent ID mismatch"

    # Stop engine
    engine.stop_engine()
    status = engine.status()
    assert status.get("running") is False, "Expected running: false after stop"
