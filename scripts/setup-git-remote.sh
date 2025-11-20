#!/bin/bash

# Script to setup git remote with GitHub token
# Usage: ./scripts/setup-git-remote.sh

if [ ! -f .github.token ]; then
    echo "Error: .github.token file not found!"
    echo "Please create .github.token file with your GitHub token"
    exit 1
fi

GITHUB_TOKEN=$(cat .github.token | tr -d '\n\r ')

if [ -z "$GITHUB_TOKEN" ]; then
    echo "Error: GitHub token is empty!"
    exit 1
fi

# Remove existing origin if it exists
git remote remove origin 2>/dev/null

# Add remote with token
git remote add origin "https://${GITHUB_TOKEN}@github.com/FajarArrizki/GearTrade.git"

echo "Git remote configured successfully!"
echo "You can now use: git push, git pull, etc."

