# Setup Guide

## 1. Environment Configuration

### Root Directory (.env)

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# AI Provider Configuration
AI_PROVIDER=anthropic
AI_PROVIDER_API_KEY=sk-ant-api03-...  # Your Anthropic API key
MODEL_ID=claude-sonnet-4-20250514

# Blockchain Configuration
ARBITRUM_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc  # Or use Alchemy/Infura
PRIVATE_KEY=0x...  # Your deployer private key (without 0x prefix)
AGENT_PRIVATE_KEY=0x...  # Agent's private key for signing transactions

# Contract Addresses (fill after deployment)
SESSION_REGISTRY_ADDRESS=0x...
TRADING_VAULT_ADDRESS=0x...
MOCK_USDC_ADDRESS=0x...

# Hyperliquid Configuration
HYPERLIQUID_BASE_URL=wss://api.hyperliquid.xyz
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz

# Deployment Configuration
DEPLOYER_ADDRESS=0x...  # Your deployer address
TREASURY_ADDRESS=0x...  # Treasury address for fees
ADMIN_ADDRESS=0x...  # Admin address
UPGRADER_ADDRESS=0x...  # Upgrader address (can be same as admin)
AGENT_ADDRESS=0x...  # Agent address (will be granted AGENT_ROLE)

# Etherscan (for verification)
ARBISCAN_API_KEY=your_arbiscan_api_key
```

### Contract Directory (geartradecontract/.env)

```bash
cd geartradecontract
cp .env.example .env
```

Edit `geartradecontract/.env`:

```bash
# Foundry Deployment Configuration
PRIVATE_KEY=0x...  # Same as root .env PRIVATE_KEY
RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
CHAIN_ID=421614

# Contract Addresses (fill after deployment)
MOCK_USDC_ADDRESS=
TRADING_VAULT_IMPL_ADDRESS=
TRADING_VAULT_PROXY_ADDRESS=
SESSION_REGISTRY_IMPL_ADDRESS=
SESSION_REGISTRY_PROXY_ADDRESS=

# Etherscan Verification
ARBISCAN_API_KEY=your_arbiscan_api_key

# Admin Addresses
DEPLOYER_ADDRESS=0x...
TREASURY_ADDRESS=0x...
ADMIN_ADDRESS=0x...
UPGRADER_ADDRESS=0x...
AGENT_ADDRESS=0x...
```

## 2. Get RPC URLs

### Free RPC Options:

1. **Arbitrum Sepolia Public RPC:**
   ```
   https://sepolia-rollup.arbitrum.io/rpc
   ```

2. **Alchemy (Recommended):**
   - Sign up at https://www.alchemy.com/
   - Create new app → Arbitrum Sepolia
   - Copy HTTP URL: `https://arb-sepolia.g.alchemy.com/v2/YOUR_API_KEY`

3. **Infura:**
   - Sign up at https://www.infura.io/
   - Create new project → Arbitrum Sepolia
   - Copy endpoint: `https://arbitrum-sepolia.infura.io/v3/YOUR_PROJECT_ID`

## 3. Get Private Keys

⚠️ **SECURITY WARNING:** Never commit private keys to git!

### For Testing:
- Use a test account with minimal funds
- Generate a new account: `cast wallet new`
- Fund with Sepolia ETH from faucet

### For Production:
- Use hardware wallet or secure key management
- Consider using EigenCloud TEE deployment (see DEPLOYMENT.md)

## 4. Get API Keys

### Anthropic API Key:
1. Sign up at https://console.anthropic.com/
2. Go to API Keys section
3. Create new key
4. Copy and paste to `AI_PROVIDER_API_KEY`

### Arbiscan API Key (for verification):
1. Sign up at https://arbiscan.io/
2. Go to API-KEYs section
3. Create new API key
4. Copy and paste to `ARBISCAN_API_KEY`

## 5. Verify Setup

```bash
# Check if .env files exist
ls -la .env geartradecontract/.env

# Check if variables are loaded (don't show actual values)
grep -v "^#" .env | grep -v "^$" | cut -d'=' -f1
```

## 6. Next Steps

After configuring `.env` files:

1. **Deploy Contracts:**
   ```bash
   cd geartradecontract
   source .env  # Load environment variables
   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
   ```

2. **Update Contract Addresses:**
   - Copy deployed addresses from deployment output
   - Update both `.env` files with contract addresses

3. **Deploy Agent:**
   ```bash
   pnpm deploy
   ```

## Troubleshooting

### .env file not found
- Make sure you're in the correct directory
- Check if `.env.example` exists
- Copy it: `cp .env.example .env`

### RPC URL errors
- Verify RPC URL is correct
- Check if you have internet connection
- Try different RPC provider

### Private key format
- Foundry expects private key without `0x` prefix
- Or use `0x` prefix, Foundry will handle it
- Make sure key is 64 hex characters

### Contract addresses not updating
- Check deployment output carefully
- Verify addresses are valid (start with 0x, 42 chars)
- Restart agent after updating addresses

