import pytest
from jst import EngineNotRunning, EngineAlreadyRunning


def test_jst_adapter(engine):
    """Test JSTEngine adapter lifecycle and basic operations."""
    # Test status (should be running)
    st = engine.status()
    assert st.get("running") is True, "Expected running: true"

    # Test double start - should raise EngineAlreadyRunning
    with pytest.raises(EngineAlreadyRunning):
        engine.start_engine()

    # Test add magnet
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

    # Test get_torrent_status
    ts = engine.get_torrent_status(tid)
    assert ts["id"] == tid, "Torrent ID mismatch"

    # Test wait_for_state (downloading)
    engine.wait_for_state(tid, "downloading", timeout=5)

    # Test stop engine
    engine.stop_engine()

    # Test status (should be not running)
    st = engine.status()
    assert st.get("running") is False, "Expected running: false"

    # Test double stop - should raise EngineNotRunning
    with pytest.raises(EngineNotRunning):
        engine.stop_engine()

