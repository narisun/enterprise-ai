"""Portfolio Watch Agent Service — extends Agent base class with DI pattern."""
from typing import Optional

from platform_sdk import AgentConfig, MCPConfig
from platform_sdk.base import Agent


class PortfolioWatchService(Agent):
    """Portfolio Watch Agent — Morgan the AI Portfolio Watch Officer."""

    def __init__(self, name: str = "portfolio-watch-agent", *, config: Optional[AgentConfig] = None) -> None:
        """
        Initialize the Portfolio Watch Service.

        Args:
            name: The service name (default: "portfolio-watch-agent")
            config: Optional AgentConfig to inject. If not provided, will load from environment.
        """
        self._mcp_config = MCPConfig.from_env()
        super().__init__(name, config=config)

    @property
    def mcp_config(self) -> MCPConfig:
        """Get the MCP configuration."""
        return self._mcp_config
