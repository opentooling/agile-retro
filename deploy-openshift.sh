#!/bin/bash
set -e

APP_NAME="agile-retro"
PROJECT_NAME="agile-retro"

echo "Deploying $APP_NAME to OpenShift..."

# Ensure we are logged in
if ! oc whoami &> /dev/null; then
    echo "Error: You must be logged in to OpenShift (oc login)"
    exit 1
fi

# Create namespace/project
if oc api-resources | grep -q "projects.project.openshift.io"; then
    # Full OpenShift
    if ! oc get project "$PROJECT_NAME" &> /dev/null; then
        echo "Creating project $PROJECT_NAME..."
        oc new-project "$PROJECT_NAME"
    else
        echo "Using project $PROJECT_NAME"
        oc project "$PROJECT_NAME"
    fi
else
    # MicroShift / Kubernetes
    echo "Detected MicroShift/Kubernetes (no Project API). Using Namespaces."
    if ! oc get namespace "$PROJECT_NAME" &> /dev/null; then
        echo "Creating namespace $PROJECT_NAME..."
        oc create namespace "$PROJECT_NAME"
    fi
    echo "Switching to namespace $PROJECT_NAME..."
    oc config set-context --current --namespace="$PROJECT_NAME"
fi

# Check if OpenShift Build API is available
if oc api-resources | grep -q "build.openshift.io"; then
    echo "OpenShift Build API detected."
    
    # Check if build config exists, if not create it
    if ! oc get bc "$APP_NAME" &> /dev/null; then
        echo "Creating BuildConfig..."
        oc new-build --binary --name="$APP_NAME" --strategy=docker
    fi

    # Start build
    echo "Starting build..."
    oc start-build "$APP_NAME" --from-dir=. --follow
    
    IMAGE_REPO="image-registry.openshift-image-registry.svc:5000/$PROJECT_NAME/$APP_NAME"
    IMAGE_TAG="latest"

else
    echo "MicroShift/Kubernetes detected (No Build API)."
    echo "Falling back to local build & push to ephemeral registry (ttl.sh)."
    
    # Check for docker or podman
    if command -v docker &> /dev/null; then
        CONTAINER_CLI="docker"
    elif command -v podman &> /dev/null; then
        CONTAINER_CLI="podman"
    else
        echo "Error: Neither docker nor podman found. Cannot build image locally."
        exit 1
    fi

    # Generate a unique image name for ttl.sh (valid for 2 hours)
    UUID=$(uuidgen | tr '[:upper:]' '[:lower:]')
    IMAGE_REPO="ttl.sh/${APP_NAME}-${UUID}"
    IMAGE_TAG="2h"
    FULL_IMAGE="${IMAGE_REPO}:${IMAGE_TAG}"

    echo "Building image: $FULL_IMAGE using $CONTAINER_CLI"
    $CONTAINER_CLI build --no-cache -t "$FULL_IMAGE" .
    
    echo "Pushing image to ttl.sh..."
    $CONTAINER_CLI push "$FULL_IMAGE"
    
    echo "Image pushed successfully."
fi

# Deploy with Helm
echo "Deploying with Helm..."
helm upgrade --install "$APP_NAME" ./charts/agile-retro \
    --namespace "$PROJECT_NAME" \
    --set image.repository="$IMAGE_REPO" \
    --set image.tag="$IMAGE_TAG" \
    --set openshift.route.enabled=true

echo "Deployment complete!"
echo "Waiting for pod to be ready..."
oc rollout status deployment/"$APP_NAME"

ROUTE_URL=$(oc get route "$APP_NAME" -o jsonpath='{.spec.host}')
echo ""
echo "Application is running at: http://$ROUTE_URL"
