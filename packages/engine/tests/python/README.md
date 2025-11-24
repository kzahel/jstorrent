# Python Integration Tests

## Setup

1. Create a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

   *Note: `libtorrent` might require system-level installation or building from source if a wheel is not available for your platform.*

## Running Tests

```bash
pytest
```
