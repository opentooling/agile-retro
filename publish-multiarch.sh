#!/bin/bash
set -e

# Default values
IMAGE_NAME="agile-retro"
TAG="latest"
REGISTRY=""

# Help function
show_help() {
    echo "Usage: ./publish-multiarch.sh [options]"
    echo ""
    echo "Options:"
    echo "  -i, --image     Image name (default: agile-retro)"
    echo "  -t, --tag       Image tag (default: latest)"
    echo "  -r, --registry  Registry URL (e.g., docker.io/username or ghcr.io/username)"
    echo "  -h, --help      Show this help message"
    echo ""
    echo "Example:"
    echo "  ./publish-multiarch.sh --registry docker.io/johndoe --tag v1.0.0"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--image)
            IMAGE_NAME="$2"
            shift 2
            ;;
        -t|--tag)
            TAG="$2"
            shift 2
            ;;
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check if registry is provided
if [ -z "$REGISTRY" ]; then
    echo "Error: Registry must be provided."
    echo "Please provide a registry using -r or --registry (e.g., docker.io/yourusername)"
    exit 1
fi

FULL_IMAGE_NAME="$REGISTRY/$IMAGE_NAME:$TAG"

echo "🚀 Preparing to build and push multi-arch image: $FULL_IMAGE_NAME"
echo "   Platforms: linux/amd64, linux/arm64"

# Check if buildx builder exists, if not create one
if ! docker buildx inspect agile-retro-builder > /dev/null 2>&1; then
    echo "📦 Creating new buildx builder 'agile-retro-builder'..."
    docker buildx create --name agile-retro-builder --driver docker-container --bootstrap
fi

echo "🔨 Building and pushing..."
docker buildx use agile-retro-builder
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "$FULL_IMAGE_NAME" \
  --push \
  .

echo "✅ Successfully published multi-arch image to $FULL_IMAGE_NAME"
