# MyWallet Helm Chart

Helm chart for deploying MyWallet to Kubernetes with Temporal workflows.

## Architecture

### Components
- **Backend API**: Express REST API for email management and webhooks (port 3000)
- **Temporal Worker**: Background workflow processor for email processing
- **MongoDB**: Application database with persistent storage (port 27017)

### External Dependencies
- **Temporal Server**: `temporal-frontend.rocket.svc.cluster.local:7233` (existing)
- **Temporal UI**: `temporal-ui.rocket.svc.cluster.local:8080` (existing)

## Prerequisites

1. **Kubernetes Cluster**: K3s cluster running on Raspberry Pi (arm64)
2. **kubectl**: Configured to access your cluster
3. **Helm 3**: Installed on your machine
4. **GitHub Container Registry Access**: For pulling Docker images
5. **Temporal Server**: Running in the `rocket` namespace
6. **Ingress Controller**: nginx ingress controller installed
7. **Cert Manager**: For Let's Encrypt TLS certificates

## Quick Start

### 1. Create GitHub Container Registry Secret

```bash
# Create wallet namespace
kubectl create namespace wallet

# Create image pull secret
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=YOUR_GITHUB_USERNAME \
  --docker-password=YOUR_GITHUB_TOKEN \
  -n wallet
```

### 2. Configure Secrets

```bash
# Copy the example secrets file
cp values-secrets.yaml.example values-secrets.yaml

# Edit with your actual secrets
vim values-secrets.yaml
```

Required secrets:
- MongoDB root password
- Gmail OAuth credentials (client ID, client secret, refresh token)
- OpenAI API key

### 3. Install the Chart

```bash
# Install with custom values
helm install mywallet . \
  -n wallet \
  --create-namespace \
  -f values-secrets.yaml

# Watch the deployment
kubectl get pods -n wallet -w
```

### 4. Verify Installation

```bash
# Check pod status
kubectl get pods -n wallet

# Check services
kubectl get svc -n wallet

# Check ingress
kubectl get ingress -n wallet

# Test API health endpoint
curl https://rocketbyte.duckdns.org/api/health
```

## Configuration

### values.yaml

The `values.yaml` file contains all configuration options. Key sections:

#### Global Configuration
```yaml
global:
  namespace: wallet
  domain: rocketbyte.duckdns.org
  storageClass: local-path
```

#### Backend API
```yaml
backend:
  enabled: true
  replicaCount: 1
  image:
    repository: ghcr.io/[username]/mywallet-backend-api
    tag: "1.0.0"
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
```

#### Temporal Worker
```yaml
worker:
  enabled: true
  replicaCount: 1
  image:
    repository: ghcr.io/[username]/mywallet-temporal-worker
    tag: "1.0.0"
```

#### MongoDB
```yaml
mongodb:
  enabled: true
  persistence:
    enabled: true
    size: 10Gi
```

### values-secrets.yaml

Sensitive configuration that should NOT be committed to git:

```yaml
secrets:
  mongodb:
    rootPassword: "your-secure-password"
  gmail:
    clientId: "xxx.apps.googleusercontent.com"
    clientSecret: "your-secret"
    refreshToken: "your-token"
  openai:
    apiKey: "sk-xxx"
```

## Accessing the Application

### API Endpoints

```bash
# Health check
curl https://rocketbyte.duckdns.org/api/health

# Gmail webhook (used by Gmail push notifications)
https://rocketbyte.duckdns.org/api/gmail/webhook
```

### Temporal UI

```bash
# Port forward to Temporal UI
kubectl port-forward -n rocket svc/temporal-ui 8080:8080

# Open in browser
open http://localhost:8080
```

### MongoDB

```bash
# Connect to MongoDB pod
kubectl exec -it mongodb-0 -n wallet -- mongosh -u admin -p YOUR_PASSWORD

# List databases
show dbs

# Use mywallet database
use mywallet

# List collections
show collections
```

## Monitoring

### Pod Logs

```bash
# Backend API logs
kubectl logs -n wallet -l app.kubernetes.io/name=backend-api -f

# Temporal Worker logs
kubectl logs -n wallet -l app.kubernetes.io/name=temporal-worker -f

# MongoDB logs
kubectl logs -n wallet mongodb-0 -f
```

### Resource Usage

```bash
# Pod resource usage
kubectl top pods -n wallet

# Node resource usage
kubectl top nodes
```

### Events

```bash
# Recent events in wallet namespace
kubectl get events -n wallet --sort-by='.lastTimestamp'
```

## Troubleshooting

### Pods Not Starting

```bash
# Check pod status
kubectl get pods -n wallet

# Describe pod for events
kubectl describe pod <pod-name> -n wallet

# Check logs
kubectl logs <pod-name> -n wallet
```

### ImagePullBackOff

```bash
# Verify image pull secret exists
kubectl get secret ghcr-secret -n wallet

# Recreate secret if needed
kubectl delete secret ghcr-secret -n wallet
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=YOUR_USERNAME \
  --docker-password=YOUR_TOKEN \
  -n wallet
```

### MongoDB Connection Issues

```bash
# Check MongoDB pod is running
kubectl get pod mongodb-0 -n wallet

# Check MongoDB service
kubectl get svc mongodb -n wallet

# Test connection from another pod
kubectl run -it --rm debug --image=mongo:7.0 --restart=Never -n wallet \
  -- mongosh mongodb://admin:PASSWORD@mongodb:27017
```

### Temporal Connection Issues

```bash
# Verify Temporal is running in rocket namespace
kubectl get pods -n rocket | grep temporal

# Test connectivity from wallet namespace
kubectl run -it --rm debug --image=busybox --restart=Never -n wallet \
  -- nc -zv temporal-frontend.rocket.svc.cluster.local 7233
```

## Upgrading

```bash
# Pull latest changes
git pull

# Upgrade the release
helm upgrade mywallet . \
  -n wallet \
  -f values-secrets.yaml

# Watch rollout
kubectl rollout status deployment/backend-api -n wallet
kubectl rollout status deployment/temporal-worker -n wallet
```

## Rollback

```bash
# List releases
helm list -n wallet

# Rollback to previous version
helm rollback mywallet -n wallet

# Rollback to specific revision
helm rollback mywallet 1 -n wallet
```

## Uninstalling

```bash
# Uninstall the release
helm uninstall mywallet -n wallet

# Delete PVCs (if you want to delete data)
kubectl delete pvc -n wallet --all

# Delete namespace
kubectl delete namespace wallet
```

## Development

### Template Validation

```bash
# Lint the chart
helm lint .

# Render templates locally
helm template mywallet . -n wallet -f values-secrets.yaml

# Dry run installation
helm install mywallet . -n wallet --dry-run --debug -f values-secrets.yaml
```

### Testing Changes

```bash
# Install with test values
helm install mywallet-test . -n wallet-test --create-namespace -f values-secrets.yaml

# Clean up test
helm uninstall mywallet-test -n wallet-test
kubectl delete namespace wallet-test
```

## Security Considerations

1. **Secrets Management**: Never commit `values-secrets.yaml` to git
2. **TLS**: All external traffic uses HTTPS with Let's Encrypt certificates
3. **Network Policies**: Consider implementing NetworkPolicies for pod-to-pod communication
4. **RBAC**: Chart uses minimal required permissions
5. **Security Context**: Pods run as non-root user
6. **Image Scanning**: Regularly scan images for vulnerabilities

## Performance Tuning

### Resource Limits

Adjust based on your Raspberry Pi cluster capacity:

```yaml
backend:
  resources:
    requests:
      cpu: 200m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi
```

### MongoDB Tuning

```yaml
mongodb:
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 2Gi

  persistence:
    size: 10Gi  # Adjust based on data volume
```

## Support

For issues and questions:
- GitHub Issues: https://github.com/starlingilcruz/mywallet/issues
- Documentation: See PROJECT.md in repository root

## License

See LICENSE file in repository root.
