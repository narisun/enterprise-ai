"""Regression test: setup_checkpointer awaits .setup() on Postgres saver (P0).

Locks the contract added by the existing fix so future refactors cannot
quietly remove the .setup() call. The first multi-turn request against
an empty Postgres would otherwise fail with 'relation does not exist'.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.unit


async def test_setup_is_awaited_when_present():
    """A checkpointer that exposes .setup() must have it awaited."""
    fake_saver = MagicMock()
    fake_saver.setup = AsyncMock()

    with patch(
        "platform_sdk.agent.make_checkpointer",
        return_value=fake_saver,
    ):
        from platform_sdk.agent import setup_checkpointer

        result = await setup_checkpointer()

    assert result is fake_saver
    fake_saver.setup.assert_awaited_once()


async def test_setup_skipped_when_absent():
    """A checkpointer without .setup() must not crash (in-memory savers)."""
    bare_saver = object()  # no .setup attribute

    with patch(
        "platform_sdk.agent.make_checkpointer",
        return_value=bare_saver,
    ):
        from platform_sdk.agent import setup_checkpointer

        result = await setup_checkpointer()

    assert result is bare_saver  # returned as-is; no crash


async def test_setup_called_before_returning():
    """The saver must be returned only AFTER .setup() completes."""
    call_order: list[str] = []

    fake_saver = MagicMock()

    async def _record_setup():
        call_order.append("setup")

    fake_saver.setup = AsyncMock(side_effect=_record_setup)

    with patch(
        "platform_sdk.agent.make_checkpointer",
        return_value=fake_saver,
    ):
        from platform_sdk.agent import setup_checkpointer

        await setup_checkpointer()
        call_order.append("returned")

    assert call_order == ["setup", "returned"], (
        f"setup_checkpointer must await setup() before returning; got order: {call_order}"
    )
