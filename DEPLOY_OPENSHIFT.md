# Deploying Agile Retro to Local OpenShift

This guide helps you deploy the Agile Retro application to your local OpenShift cluster (e.g., CRC, Minishift, or a local cluster).

## Prerequisites

- `oc` CLI tool installed and configured.
- `helm` CLI tool installed.
- You are logged in to your OpenShift cluster (`oc login ...`).

## Deployment Steps

### 1. Create a Project

Create a new project (namespace) for the application:

```bash
oc new-project agile-retro
```

### 2. Build and Push the Image

You have two main options: using OpenShift's Source-to-Image (S2I) or building locally and pushing to the internal registry.

#### Option A: Binary Build (Recommended for local dev)

This uploads your local source code to OpenShift to build the image.

1.  Create a build config:
    ```bash
    oc new-build --binary --name=agile-retro --strategy=docker
    ```

2.  Start the build using the current directory:
    ```bash
    oc start-build agile-retro --from-dir=. --follow
    ```

#### Option B: Docker Build & Push

If you prefer building with Docker/Podman:

1.  Login to the OpenShift registry (you might need to expose it first):
    ```bash
    docker login -u $(oc whoami) -p $(oc whoami -t) $(oc registry info)
    ```
2.  Build and push:
    ```bash
    docker build -t $(oc registry info)/agile-retro/agile-retro:latest .
    docker push $(oc registry info)/agile-retro/agile-retro:latest
    ```

### 3. Deploy with Helm

Once the image is ready, deploy the application using the Helm chart.

1.  **Update Dependencies** (if any):
    ```bash
    helm dependency update charts/agile-retro
    ```

2.  **Install/Upgrade the Chart**:
    
    We need to tell Helm to use the image stream we just created.
    
    ```bash
    helm upgrade --install agile-retro ./charts/agile-retro \
      --set image.repository=image-registry.openshift-image-registry.svc:5000/agile-retro/agile-retro \
      --set image.tag=latest \
      --set openshift.route.enabled=true
    ```

    *Note: The image repository URL might vary. If you used Option A, the image is typically available at `image-registry.openshift-image-registry.svc:5000/<project>/<name>` within the cluster.*

### 4. Access the Application

Get the Route URL:

```bash
oc get route agile-retro
```

Open the URL in your browser.

## Configuration

You can configure authentication and other settings in `charts/agile-retro/values.yaml` or by passing `--set` flags to Helm.

Example enabling Google Auth:

```bash
helm upgrade --install agile-retro ./charts/agile-retro \
  --set auth.google.enabled=true \
  --set auth.google.clientId="YOUR_CLIENT_ID" \
  --set auth.google.clientSecret="YOUR_CLIENT_SECRET"
```

## Troubleshooting

### Version Mismatch Error
If you see an error like `Bundle ... was requested, but the existing VM is using ...`, it means your CRC version has been updated but the VM is old.

Run the included fix script to reset your cluster:
```bash
./fix-crc.sh
```
This will delete the existing cluster and start a fresh one with the correct version.
