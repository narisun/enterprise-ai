import sys
from pathlib import Path

# Make tools/shared importable before the helper itself is loaded.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from shared._pytest_setup import setup_tool_pytest_env  # noqa: E402

setup_tool_pytest_env(__file__)

# Pre-import so patch("src.server._opa") can resolve the module.
import src.server  # noqa: E402, F401
