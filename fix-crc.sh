#!/bin/bash
set -e

echo "Detected version mismatch in OpenShift Local."
echo "Resetting the cluster to use the new bundle..."

# Delete the existing cluster
echo "Deleting existing cluster..."
crc delete -f

# Cleanup cached settings
echo "Cleaning up..."
crc cleanup

# Setup again (in case bundle needs to be unpacked)
echo "Setting up..."
crc setup

# Start the cluster
echo "Starting OpenShift Local..."
crc start

echo "--------------------------------------------------"
echo "Cluster started successfully!"
echo "Please run the following command to configure your shell:"
echo "eval \$(crc oc-env)"
echo "--------------------------------------------------"
echo "Then you can proceed with ./deploy-openshift.sh"
