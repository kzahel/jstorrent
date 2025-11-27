# Python Integration Tests

## Setup

1. Create a virtual environment and install dependencies:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -e .
   ```

   Or with `uv` (faster):
   ```bash
   uv venv .venv
   source .venv/bin/activate
   uv pip install -e .
   ```

   *Note: `libtorrent` might require system-level installation or building from source if a wheel is not available for your platform.*

## Running Tests

```bash
pytest
```
