import time
import sys
from jst import JSTEngine, EngineNotRunning, EngineAlreadyRunning

def run_test():
    # Port for the RPC server
    port = 3003
    
    engine = None
    try:
        print("Starting JSTEngine...")
        # JSTEngine now spawns the process and starts the engine automatically
        engine = JSTEngine(port=port)
        print("JSTEngine started.")

        # Test status (should be running)
        print("Testing status...")
        st = engine.status()
        print(f"Status: {st}")
        if st.get("running") is not True:
            raise AssertionError("Expected running: true")

        # Test double start (should raise or be handled)
        # Since JSTEngine starts in init, calling start_engine again should raise EngineAlreadyRunning
        print("Testing double start...")
        try:
            engine.start_engine()
            raise AssertionError("Should have raised EngineAlreadyRunning")
        except EngineAlreadyRunning:
            print("Caught expected EngineAlreadyRunning")

        # Test add magnet
        print("Testing add_magnet...")
        magnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fexplodie.org%3A6969&tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337'
        tid = engine.add_magnet(magnet)
        print(f"Added torrent: {tid}")

        # Test get_torrent_status
        print(f"Testing get_torrent_status for {tid}...")
        ts = engine.get_torrent_status(tid)
        print(f"Torrent Status: {ts}")
        if ts["id"] != tid:
            raise AssertionError("Torrent ID mismatch")

        # Test wait_for_state (downloading)
        print("Testing wait_for_state 'downloading'...")
        engine.wait_for_state(tid, "downloading", timeout=5)
        print("Reached state 'downloading'")

        # Test stop engine (but keep process)
        print("Testing stop_engine...")
        engine.stop_engine()

        # Test status (should be not running)
        print("Testing status...")
        st = engine.status()
        print(f"Status: {st}")
        if st.get("running") is not False:
            raise AssertionError("Expected running: false")
            
        # Test double stop (should raise)
        print("Testing double stop...")
        try:
            engine.stop_engine()
            raise AssertionError("Should have raised EngineNotRunning")
        except EngineNotRunning:
            print("Caught expected EngineNotRunning")

        print("All tests passed!")

    except Exception as e:
        print(f"Test failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        print("Shutting down engine...")
        if engine:
            engine.close()

if __name__ == "__main__":
    run_test()
