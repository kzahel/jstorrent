import sys
from jst import JSTEngine

def run_test():
    # Choose a port for the RPC server
    port = 3002

    print("Starting JSTEngine...")
    engine = JSTEngine(port=port)
    print("JSTEngine started.")

    try:
        # Status should be running because JSTEngine starts the engine in __init__
        print("Checking engine status...")
        status = engine.status()
        print(f"Status: {status}")
        if status.get("running") is not True:
            raise AssertionError("Expected running: true after JSTEngine init")

        # Add a magnet
        print("Adding magnet torrent...")
        magnet = (
            "magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&"
            "tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&"
            "tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&"
            "tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&"
            "tr=udp%3A%2F%2Fexplodie.org%3A6969&"
            "tr=udp%3A%2F%2Ftracker.empire-js.us%3A1337"
        )
        tid = engine.add_magnet(magnet)
        if not tid:
            raise AssertionError("No torrent ID returned")
        print(f"Added torrent id: {tid}")

        # Fetch torrent status
        print("Fetching torrent status...")
        tstatus = engine.get_torrent_status(tid)
        print(f"Torrent Status: {tstatus}")
        if tstatus.get("id") != tid:
            raise AssertionError("Torrent ID mismatch")

        # Stop engine
        print("Stopping engine...")
        engine.stop_engine()
        status = engine.status()
        print(f"Status after stop: {status}")
        if status.get("running") is not False:
            raise AssertionError("Expected running: false after stop")

        print("All tests passed!")

    except Exception as e:
        print(f"Test failed: {e}")
        sys.exit(1)
    finally:
        print("Closing JSTEngine...")
        engine.close()

if __name__ == "__main__":
    run_test()
