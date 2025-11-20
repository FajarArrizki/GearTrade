# Test AI Agent - Panduan Testing

## ⚠️ Masalah Saat Ini

TradingAgent memvalidasi semua environment variables di constructor, termasuk contract addresses. Jika addresses masih `0x0000...`, validation akan gagal.

## ✅ Solusi: Test dengan SimplePromptAgent (Chat Only)

Untuk testing AI agent chat functionality saja, kita bisa pakai **SimplePromptAgent** yang lebih simple dan tidak butuh trading features.

### Step 1: Setup .dev.vars

```bash
# Copy dari example
cp .vars-example .dev.vars
```

### Step 2: Edit .dev.vars

```bash
AI_PROVIDER_API_KEY=your_api_key_here
MODEL_ID=glm-4.5
AI_PROVIDER=zai
```

**Atau untuk Anthropic:**
```bash
AI_PROVIDER_API_KEY=sk-ant-api03-...
MODEL_ID=claude-3-haiku-20240307
AI_PROVIDER=anthropic
```

### Step 3: Modifikasi Sementara untuk Testing

Kita perlu modifikasi sementara untuk skip TradingAgent validation, atau pakai endpoint yang pakai SimplePromptAgent.

**Opsi A: Buat endpoint test yang pakai SimplePromptAgent**

Atau lebih mudah, kita bisa **temporarily comment out validation** atau set dummy valid addresses.

### Step 4: Set Dummy Valid Addresses (Temporary)

Edit `wrangler.jsonc` dan set addresses ke dummy valid addresses (bukan zero address):

```jsonc
"vars": {
  "SESSION_REGISTRY_ADDRESS": "0x1111111111111111111111111111111111111111",
  "TRADING_VAULT_ADDRESS": "0x2222222222222222222222222222222222222222",
}
```

**Note**: Ini hanya untuk testing chat. Trading functionality tidak akan bekerja dengan addresses dummy.

### Step 5: Set Dummy Private Keys (Temporary)

Untuk testing chat saja, kita perlu set dummy private keys juga:

```bash
# Set dummy private keys untuk testing (format harus valid)
# Di .dev.vars atau via wrangler secret
AGENT_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000001
HYPERLIQUID_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000002
```

**Atau lebih baik**: Modify validation untuk allow missing/optional fields untuk testing mode.

## 🧪 Step 6: Test Agent

```bash
# Start dev server
pnpm dev

# Test dengan curl (di terminal lain)
curl -X POST http://localhost:8787/agent/chat/test-session \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Hello! Can you respond with just the word TEST?"
      }
    ]
  }'
```

## 🔧 Solusi Lebih Baik: Buat Test Mode

Lebih baik kita buat mode testing yang skip validation untuk fields yang tidak diperlukan untuk chat.

Mari kita buat modifikasi untuk allow testing mode.
