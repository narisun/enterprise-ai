# Container Image Security Policy

## Image Pinning

All Dockerfiles MUST pin base images by SHA256 digest to prevent supply chain attacks.

### Current Base Images (update digests after scanning)

```dockerfile
# Python 3.11 slim — pin to specific digest
# To find current digest: docker pull python:3.11-slim && docker inspect --format='{{index .RepoDigests 0}}' python:3.11-slim
FROM python:3.11-slim@sha256:<REPLACE_WITH_CURRENT_DIGEST>
```

### Scanning Requirements

1. **ECR Image Scanning**: Enable enhanced scanning on all ECR repositories
2. **CI Pipeline**: Add Trivy scan step before push (see ci-deploy.yml)
3. **Admission Control**: Deploy OPA Gatekeeper with image digest policy

### Rotation Procedure

1. Pull new base image: `docker pull python:3.11-slim`
2. Get digest: `docker inspect --format='{{index .RepoDigests 0}}' python:3.11-slim`
3. Run Trivy scan: `trivy image python:3.11-slim@sha256:<digest>`
4. Update all Dockerfiles with new digest
5. Run full CI pipeline to verify no regressions
6. Sign images with cosign: `cosign sign <ecr-url>/<image>@sha256:<digest>`

### Third-Party Images

| Image | Current Tag | Action Required |
|-------|-------------|-----------------|
| python:3.11-slim | floating tag | Pin by digest |
| ghcr.io/berriai/litellm:main-stable | floating tag | Mirror to ECR, pin by digest |
| redis:7.2-alpine | floating tag | Pin by digest |
| openpolicyagent/opa:0.65.0-debug | version tag | Pin by digest |
| grafana/grafana:latest | floating tag | Pin to specific version + digest |
