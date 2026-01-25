# MyWallet Kubernetes Deployment Guide

This guide provides step-by-step instructions for deploying MyWallet to your Raspberry Pi K3s cluster.

## Prerequisites Checklist

- [ ] K3s cluster running on Raspberry Pi (arm64)
- [ ] kubectl configured and connected to your cluster
- [ ] Helm 3 installed
- [ ] GitHub account with Container Registry access
- [ ] Temporal Server running in `rocket` namespace
- [ ] nginx ingress controller installed
- [ ] cert-manager installed with Let's Encrypt issuer

## Deployment Steps

### Step 1: Build and Push Docker Images

#### Option A: Using GitHub Actions (Recommended)

1. Push your code to GitHub:
```bash
git add .
git commit -m "Add Kubernetes deployment configuration"
git push origin main
```

2. GitHub Actions will automatically build multi-arch images (amd64 + arm64) and push to GitHub Container Registry.

3. Monitor the build progress:
   - Go to your repository on GitHub
   - Click on "Actions" tab
   - Wait for the "Build and Push Multi-Arch Docker Images" workflow to complete

#### Option B: Manual Build with Docker Buildx

If you prefer to build locally:

```bash
# Ensure buildx is set up
docker buildx create --use

# Build and push Backend API
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/starlingilcruz/mywallet-backend-api:latest \
  -f packages/backend-apis/Dockerfile \
  --push .

# Build and push Temporal Worker
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/starlingilcruz/mywallet-temporal-worker:latest \
  -f packages/temporal-worker/Dockerfile \
  --push .
```

### Step 2: Configure GitHub Container Registry Access

```bash
# Create wallet namespace
kubectl create namespace wallet

# Create image pull secret (replace with your GitHub token)
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=starlingilcruz \
  --docker-password=YOUR_GITHUB_TOKEN \
  -n wallet
```

**To create a GitHub token:**
1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Select scope: `read:packages`
4. Copy the token

### Step 3: Configure Application Secrets

```bash
# Navigate to Helm chart directory
cd k8s/mywallet

# Copy the example secrets file
cp values-secrets.yaml.example values-secrets.yaml

# Edit with your actual credentials
vim values-secrets.yaml
```

**Required values in `values-secrets.yaml`:**

```yaml
secrets:
  mongodb:
    rootPassword: "YOUR-SECURE-MONGODB-PASSWORD"  # Create a strong password

  gmail:
    clientId: "YOUR-CLIENT-ID.apps.googleusercontent.com"
    clientSecret: "YOUR-GMAIL-CLIENT-SECRET"
    refreshToken: "YOUR-GMAIL-REFRESH-TOKEN"

  openai:
    apiKey: "sk-YOUR-OPENAI-API-KEY"
```

**Where to get these credentials:**
- **MongoDB password**: Create a strong password (e.g., use `openssl rand -base64 32`)
- **Gmail OAuth**: From Google Cloud Console (see Gmail setup docs)
- **OpenAI API Key**: From https://platform.openai.com/api-keys

### Step 4: Review and Customize values.yaml (Optional)

Edit `k8s/mywallet/values.yaml` if you need to customize:
- Resource limits (CPU/Memory)
- Image tags (use specific versions instead of `latest`)
- Domain name
- Storage size

### Step 5: Install the Helm Chart

```bash
# From the k8s/mywallet directory
helm install mywallet . \
  -n wallet \
  --create-namespace \
  -f values-secrets.yaml
```

### Step 6: Monitor Deployment

```bash
# Watch pods starting up
kubectl get pods -n wallet -w

# Expected pods:
# - mywallet-backend-api-xxx
# - mywallet-temporal-worker-xxx
# - mywallet-mongodb-0

# Check deployment status
kubectl rollout status deployment/mywallet-backend-api -n wallet
kubectl rollout status deployment/mywallet-temporal-worker -n wallet

# Check StatefulSet status
kubectl rollout status statefulset/mywallet-mongodb -n wallet
```

### Step 7: Verify Installation

```bash
# Check all resources
kubectl get all -n wallet

# Check persistent volumes
kubectl get pvc -n wallet

# Check ingress
kubectl get ingress -n wallet

# View logs
kubectl logs -n wallet -l app.kubernetes.io/name=backend-api --tail=50
kubectl logs -n wallet -l app.kubernetes.io/name=temporal-worker --tail=50
kubectl logs -n wallet mywallet-mongodb-0 --tail=50
```

### Step 8: Test the Deployment

```bash
# Test API health endpoint (external)
curl https://rocketbyte.duckdns.org/api/health

# Expected response: {"status":"ok","timestamp":"..."}

# Test from inside the cluster
kubectl run curl-test --image=curlimages/curl -i --tty --rm -n wallet \
  -- curl http://mywallet-backend-api:3000/api/health
```

### Step 9: Verify Database Initialization

```bash
# Connect to MongoDB
kubectl exec -it mywallet-mongodb-0 -n wallet -- \
  mongosh -u admin -p YOUR_MONGODB_PASSWORD

# In the MongoDB shell:
use mywallet
show collections
# Should see: transactions, email_patterns, budgets

db.transactions.getIndexes()
# Should see indexes on emailId, transactionDate, etc.

exit
```

### Step 10: Check Temporal Connection

```bash
# View worker logs to confirm Temporal connection
kubectl logs -n wallet -l app.kubernetes.io/name=temporal-worker --tail=100

# Should see messages like:
# "✅ Connected to Temporal"
# "👂 Workers polling for tasks on queue: email-processing-queue"

# Access Temporal UI
kubectl port-forward -n rocket svc/temporal-ui 8080:8080

# Open http://localhost:8080 in your browser
# Navigate to Workflows → should see your workflows
```

## Troubleshooting

### Pods Not Starting

```bash
# Describe pod to see events
kubectl describe pod <pod-name> -n wallet

# Common issues:
# - ImagePullBackOff: Check ghcr-secret is created correctly
# - CrashLoopBackOff: Check logs for application errors
# - Pending: Check if PVC can be bound (storage class exists)
```

### ImagePullBackOff

```bash
# Verify secret exists
kubectl get secret ghcr-secret -n wallet

# If needed, delete and recreate
kubectl delete secret ghcr-secret -n wallet
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=starlingilcruz \
  --docker-password=YOUR_GITHUB_TOKEN \
  -n wallet
```

### MongoDB Connection Issues

```bash
# Check if MongoDB is running
kubectl get pod mywallet-mongodb-0 -n wallet

# Check MongoDB logs
kubectl logs mywallet-mongodb-0 -n wallet

# Test MongoDB connection from another pod
kubectl run mongodb-test --image=mongo:7.0 -i --tty --rm -n wallet \
  -- mongosh mongodb://admin:YOUR_PASSWORD@mywallet-mongodb:27017
```

### Init Containers Stuck

```bash
# Check init container logs
kubectl logs <pod-name> -n wallet -c wait-for-mongodb
kubectl logs <pod-name> -n wallet -c wait-for-temporal

# Verify MongoDB service exists
kubectl get svc mywallet-mongodb -n wallet

# Verify Temporal is accessible
kubectl run netcat-test --image=busybox -i --tty --rm -n wallet \
  -- nc -zv temporal-frontend.rocket.svc.cluster.local 7233
```

### Ingress Not Working

```bash
# Check ingress status
kubectl get ingress -n wallet
kubectl describe ingress mywallet-backend-api -n wallet

# Verify nginx ingress controller is running
kubectl get pods -n ingress-nginx

# Check cert-manager for TLS certificate
kubectl get certificate -n wallet
kubectl describe certificate ssl-cert-prod -n wallet
```

## Upgrading

```bash
# Pull latest changes
git pull

# Build and push new images (or wait for GitHub Actions)

# Upgrade the release
helm upgrade mywallet ./k8s/mywallet \
  -n wallet \
  -f k8s/mywallet/values-secrets.yaml

# Watch the rollout
kubectl rollout status deployment/mywallet-backend-api -n wallet
kubectl rollout status deployment/mywallet-temporal-worker -n wallet
```

## Rollback

```bash
# View release history
helm history mywallet -n wallet

# Rollback to previous version
helm rollback mywallet -n wallet

# Rollback to specific revision
helm rollback mywallet 1 -n wallet
```

## Uninstalling

```bash
# Uninstall the Helm release
helm uninstall mywallet -n wallet

# Delete persistent data (optional - WARNING: This deletes all data!)
kubectl delete pvc -n wallet --all

# Delete namespace (optional)
kubectl delete namespace wallet
```

## Maintenance Tasks

### View Resource Usage

```bash
# Pod resource usage
kubectl top pods -n wallet

# Node resource usage
kubectl top nodes
```

### Backup MongoDB

```bash
# Create a backup job
kubectl run mongodb-backup --image=mongo:7.0 -n wallet --rm -i --tty \
  -- mongodump --uri="mongodb://admin:PASSWORD@mywallet-mongodb:27017" \
    --out=/backup --gzip

# For production, consider setting up a CronJob for automated backups
```

### Scale Deployments

```bash
# Scale backend API (if you have resources)
kubectl scale deployment mywallet-backend-api -n wallet --replicas=2

# Scale worker (if you have resources)
kubectl scale deployment mywallet-temporal-worker -n wallet --replicas=2
```

### View Events

```bash
# Recent events in wallet namespace
kubectl get events -n wallet --sort-by='.lastTimestamp' | tail -20
```

## Performance Optimization

### For Raspberry Pi Clusters

1. **Monitor resource usage** regularly with `kubectl top`
2. **Adjust resource limits** in `values.yaml` based on actual usage
3. **Consider single replicas** for API and Worker to conserve resources
4. **Use PriorityClasses** for critical workloads if needed
5. **Monitor MongoDB storage** and adjust PVC size if needed

### Resource Limits Template

```yaml
# In values.yaml
backend:
  resources:
    requests:
      cpu: 100m      # Reduce if needed
      memory: 128Mi  # Reduce if needed
    limits:
      cpu: 300m
      memory: 256Mi

worker:
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 300m
      memory: 256Mi
```

## Next Steps

1. **Set up Gmail Push Notifications**: Configure Gmail to send push notifications to your webhook
2. **Configure DuckDNS**: Ensure rocketbyte.duckdns.org points to your cluster
3. **Monitor Logs**: Set up log aggregation if needed
4. **Set up Alerts**: Configure monitoring and alerting for production use
5. **Backup Strategy**: Implement regular MongoDB backups

## Support

For issues and questions:
- GitHub Issues: https://github.com/starlingilcruz/mywallet/issues
- Documentation: See PROJECT.md and README.md

## Useful Commands Reference

```bash
# Quick status check
kubectl get all -n wallet

# All logs at once
kubectl logs -n wallet -l app.kubernetes.io/instance=mywallet --all-containers=true

# Port forward to Temporal UI
kubectl port-forward -n rocket svc/temporal-ui 8080:8080

# Exec into backend pod
kubectl exec -it -n wallet deployment/mywallet-backend-api -- /bin/sh

# Describe all resources
kubectl describe all -n wallet
```
