"""RM Prep Agent — Service class extending the Agent base class."""
from platform_sdk import MCPConfig
from platform_sdk.base import Agent


class RmPrepAgentService(Agent):
    """RM Prep Agent — AI-powered meeting preparation for Relationship Managers.

    This service encapsulates:
    - MCPConfig loading from environment
    - AgentConfig loading (inherited from Agent base class)
    - Service identity (name, config)
    - Environment helpers (is_dev_env, environment)
    """

    def __init__(self, name: str = "rm-prep-agent", *, config=None) -> None:
        """
        Initialize the RM Prep Agent Service.

        Args:
            name: The agent service name.
            config: Optional AgentConfig to inject. If not provided, will load from environment.
        """
        self._mcp_config = MCPConfig.from_env()
        super().__init__(name, config=config)

    @property
    def mcp_config(self) -> MCPConfig:
        """Get the MCP configuration."""
        return self._mcp_config

    @property
    def environment(self) -> str:
        """Get the environment name (local, dev, prod, etc.)."""
        return self._mcp_config.environment

    def is_dev_env(self) -> bool:
        """Check if running in a development environment (local or dev)."""
        return self.environment in ("local", "dev")
