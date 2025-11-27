import pytest
from jst import JSTEngine


@pytest.fixture
def engine(tmp_path):
    """Pytest fixture that provides a JSTEngine instance with automatic cleanup.
    
    The engine binds to a random available port (port=0) and the actual port
    can be accessed via engine.rpc_port.
    """
    download_dir = str(tmp_path / "downloads")
    eng = JSTEngine(download_dir=download_dir)
    yield eng
    eng.close()


@pytest.fixture
def engine_factory(tmp_path):
    """Factory fixture for creating JSTEngine instances with custom config.
    
    Use this when you need to specify a custom download directory or other options.
    All created engines are automatically cleaned up after the test.
    
    Usage:
        def test_something(engine_factory):
            engine = engine_factory(download_dir="/custom/path")
            # ... test code ...
    """
    engines = []
    
    def _create_engine(**kwargs):
        eng = JSTEngine(**kwargs)
        engines.append(eng)
        return eng
    
    yield _create_engine
    
    # Cleanup all created engines
    for eng in engines:
        eng.close()
