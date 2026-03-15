# Ollama Deployment for Kubernetes

Ollama is deployed as a shared AI service that can be used by any application in the cluster.

## Deploy Ollama

```bash
# Deploy to cluster
kubectl apply -f ollama-deployment.yaml

# Wait for pod to be ready
kubectl wait --for=condition=ready pod -l app=ollama -n ai --timeout=5m

# Check status
kubectl get pods -n ai
```

## Pull Models

After deployment, pull the models you need:

```bash
# Pull a small model for testing (recommended for Raspberry Pi)
kubectl exec -n ai deployment/ollama -- ollama pull llama3.2:1b

# Or pull a larger model (requires more RAM)
kubectl exec -n ai deployment/ollama -- ollama pull llama3.2:3b

# List installed models
kubectl exec -n ai deployment/ollama -- ollama list
```

## Test Ollama

```bash
# Test with curl
kubectl run curl --image=curlimages/curl -i --tty --rm -n ai -- \
  curl -X POST http://ollama:11434/api/generate \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3.2:1b", "prompt": "Why is the sky blue?", "stream": false}'
```

## Access from MyWallet

Ollama is accessible at: `http://ollama.ai.svc.cluster.local:11434`

Update MyWallet to use Ollama:

```yaml
# In k8s/mywallet/values.yaml
app:
  ai:
    provider: ollama
    model: llama3.2:1b
    endpoint: http://ollama.ai.svc.cluster.local:11434
```

## Recommended Models for Raspberry Pi

- **llama3.2:1b** (1.3GB) - Smallest, fastest, good for simple tasks
- **llama3.2:3b** (2GB) - Better quality, still reasonable on Pi
- **qwen2.5:3b** (2.1GB) - Good alternative
- **phi3.5:mini** (2.2GB) - Microsoft's efficient model

**Avoid large models** (7B+) on Raspberry Pi due to memory constraints.

## Monitor Resources

```bash
# Check Ollama pod resources
kubectl top pod -n ai

# Check logs
kubectl logs -n ai -l app=ollama -f
```

## Uninstall

```bash
kubectl delete -f ollama-deployment.yaml
```

Note: This will delete the PVC and all downloaded models.
