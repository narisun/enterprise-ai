import sys
from pathlib import Path

# Ensure `src.server` resolves when pytest rootdir is the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent))
