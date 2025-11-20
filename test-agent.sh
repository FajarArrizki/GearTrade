#!/bin/bash

# Test AI Agent Script
# This script tests the AI agent locally to verify it's working

echo "🧪 Testing AI Agent..."
echo ""

# Check if .dev.vars exists
if [ ! -f .dev.vars ]; then
    echo "❌ .dev.vars file not found!"
    echo "Creating .dev.vars from .vars-example..."
    cp .vars-example .dev.vars
    echo "✅ Created .dev.vars"
    echo "⚠️  Please edit .dev.vars and add your AI_PROVIDER_API_KEY"
    echo ""
    exit 1
fi

# Check if AI_PROVIDER_API_KEY is set
if ! grep -q "AI_PROVIDER_API_KEY=" .dev.vars || grep -q "AI_PROVIDER_API_KEY=$" .dev.vars; then
    echo "❌ AI_PROVIDER_API_KEY not set in .dev.vars"
    echo "Please add your API key to .dev.vars"
    echo ""
    exit 1
fi

echo "✅ Configuration files found"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    pnpm install
    echo ""
fi

echo "🚀 Starting development server..."
echo "⚠️  This will start the agent on http://localhost:8787"
echo "⚠️  Press Ctrl+C to stop"
echo ""

# Start the dev server in the background
pnpm dev &
DEV_PID=$!

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 5

# Test the agent endpoint
echo ""
echo "🧪 Testing agent endpoint..."
echo ""

SESSION_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo "test-session-$(date +%s)")

RESPONSE=$(curl -s -X POST "http://localhost:8787/agent/chat/$SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Hello! Can you respond with just the word TEST if you can hear me?"
      }
    ]
  }' \
  --max-time 30)

if [ $? -eq 0 ]; then
    echo "✅ Agent responded!"
    echo ""
    echo "Response:"
    echo "$RESPONSE" | head -c 500
    echo ""
    echo ""
    
    if echo "$RESPONSE" | grep -q "TEST\|test\|Hello\|hello"; then
        echo "🎉 SUCCESS: AI Agent is working!"
    else
        echo "⚠️  Agent responded but response may be unexpected"
        echo "Full response saved to agent-test-response.txt"
        echo "$RESPONSE" > agent-test-response.txt
    fi
else
    echo "❌ Failed to get response from agent"
    echo "Check if the server is running on http://localhost:8787"
fi

# Cleanup
echo ""
echo "🛑 Stopping development server..."
kill $DEV_PID 2>/dev/null || true

echo ""
echo "✅ Test complete!"
















