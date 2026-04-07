#!/bin/bash
echo "=== ai-agents logs (last 50 lines) ==="
kubectl logs -n ai-platform -l app=ai-agents --tail=50

echo ""
echo "=== Port-forward setup for MCP test ==="
echo "Run these in separate terminals:"
echo "  kubectl port-forward -n ai-platform svc/ai-agents 8000:80 &"
echo "  kubectl port-forward -n ai-platform svc/data-mcp 8080:80 &"
