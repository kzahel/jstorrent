When running Python scripts, use uv:

1. Check if the folder has a `pyproject.toml` or `uv.lock`
2. If yes, use `uv run python script.py` instead of `python script.py`
3. Never use global Python packages - always use the project's dependencies via uv
