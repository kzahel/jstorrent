import time
import os
from jst.engine import JSTEngine

MAGNET_LINK = "magnet:?xt=urn:btih:d69f9033168037e9d75e4e38d722282803112e41&dn=test_torrent"

def test_rpc_methods(engine):
    # Add torrent
    tid = engine.add_magnet(MAGNET_LINK)
    
    # Wait for it to be added
    time.sleep(1)
    
    # Test get_peer_info
    peers = engine.get_peer_info(tid)
    assert peers["ok"]
    assert isinstance(peers["peers"], list)
    
    # Test get_piece_availability
    avail = engine.get_piece_availability(tid)
    assert avail["ok"]
    assert isinstance(avail["availability"], list)
    
    # Test set_max_peers
    res = engine.set_max_peers(tid, 10)
    assert res["ok"]
    
    # Test get_download_rate
    rate = engine.get_download_rate(tid)
    assert isinstance(rate, (int, float))
    
    # Test get_logs
    logs = engine.get_logs()
    assert logs["ok"]
    assert isinstance(logs["logs"], list)
    # We should have some logs from startup
    assert len(logs["logs"]) > 0
    
    # Test force_disconnect_peer (mock call since we might not have peers)
    # Just check if it doesn't crash
    res = engine.force_disconnect_peer(tid, "1.2.3.4", 1234)
    assert res["ok"]

if __name__ == "__main__":
    # Manual run
    eng = JSTEngine(verbose=True)
    try:
        test_rpc_methods(eng)
        print("All RPC tests passed!")
    finally:
        eng.close()
