// API configuration
// BACKEND DISABLED - Frontend only mode
// const API_BASE_URL = process.env.NODE_ENV === 'production' 
//   ? '/api' 
//   : '/api'  // Use proxy, don't hardcode port

// Hardcoded user for paper trading (matches backend initialization)
const HARDCODED_USERNAME = 'default'

// DUMMY DATA - Backend disabled, return mock responses for design mode
let dummyPromptTemplates: PromptTemplate[] = [
  {
    id: 1,
    key: 'default',
    name: 'Default Equity Prompt',
    description: 'Base trading prompt with risk guidance',
    templateText: `Analyze the provided account snapshot and market data.\n- Recommend a single action (buy/sell/hold)\n- Include clear reasoning and risk assessment\n- Respect max leverage of 3x`,
    systemTemplateText: 'You are a disciplined portfolio manager focused on risk-adjusted returns.',
    updatedBy: 'system',
    updatedAt: new Date().toISOString(),
  },
  {
    id: 2,
    key: 'hyperliquid',
    name: 'Hyperliquid Pro Prompt',
    description: 'Optimized prompt for Hyperliquid perpetual trading',
    templateText: `Given Hyperliquid orderbook and funding data:\n- Identify best symbol to trade now\n- Specify entry price, stop loss, take profit\n- Explain leverage choice and risk guardrails`,
    systemTemplateText: 'You are an advanced crypto derivatives strategist with leverage-awareness.',
    updatedBy: 'system',
    updatedAt: new Date().toISOString(),
  },
]

let dummyPromptBindings: PromptBinding[] = [
  {
    id: 1,
    accountId: 1,
    accountName: 'Demo AI Trader',
    accountModel: 'gpt',
    promptTemplateId: 1,
    promptKey: 'default',
    promptName: 'Default Equity Prompt',
    updatedBy: 'system',
    updatedAt: new Date().toISOString(),
  },
]

let dummyHyperliquidWatchlist = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'AVAXUSDT']

const createDummyResponse = (data: any): Response =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

// Helper function for making API requests
// BACKEND DISABLED - Returns dummy data for design
export async function apiRequest(
  endpoint: string, 
  options: RequestInit = {}
): Promise<Response> {
  console.log('DUMMY API call →', endpoint, options.method || 'GET')
  return createDummyResponse({ message: 'Backend disabled - dummy data' })
}

// Specific API functions
export async function checkRequiredConfigs() {
  const response = await apiRequest('/config/check-required')
  return response.json()
}

// Crypto-specific API functions
export async function getCryptoSymbols() {
  const response = await apiRequest('/crypto/symbols')
  return response.json()
}

export async function getCryptoPrice(symbol: string) {
  const response = await apiRequest(`/crypto/price/${symbol}`)
  return response.json()
}

export async function getCryptoMarketStatus(symbol: string) {
  const response = await apiRequest(`/crypto/status/${symbol}`)
  return response.json()
}

export async function getPopularCryptos() {
  const response = await apiRequest('/crypto/popular')
  return response.json()
}

// AI Decision Log interfaces and functions
export interface AIDecision {
  id: number
  account_id: number
  decision_time: string
  reason: string
  operation: string
  symbol?: string
  prev_portion: number
  target_portion: number
  total_balance: number
  executed: string
  order_id?: number
}

export interface AIDecisionFilters {
  operation?: string
  symbol?: string
  executed?: boolean
  start_date?: string
  end_date?: string
  limit?: number
}

export async function getAIDecisions(accountId: number, filters?: AIDecisionFilters): Promise<AIDecision[]> {
  const params = new URLSearchParams()
  if (filters?.operation) params.append('operation', filters.operation)
  if (filters?.symbol) params.append('symbol', filters.symbol)
  if (filters?.executed !== undefined) params.append('executed', filters.executed.toString())
  if (filters?.start_date) params.append('start_date', filters.start_date)
  if (filters?.end_date) params.append('end_date', filters.end_date)
  if (filters?.limit) params.append('limit', filters.limit.toString())
  
  const queryString = params.toString()
  const endpoint = `/accounts/${accountId}/ai-decisions${queryString ? `?${queryString}` : ''}`
  
  const response = await apiRequest(endpoint)
  return response.json()
}

export async function getAIDecisionById(accountId: number, decisionId: number): Promise<AIDecision> {
  const response = await apiRequest(`/accounts/${accountId}/ai-decisions/${decisionId}`)
  return response.json()
}

export async function getAIDecisionStats(accountId: number, days?: number): Promise<{
  total_decisions: number
  executed_decisions: number
  execution_rate: number
  operations: { [key: string]: number }
  avg_target_portion: number
}> {
  const params = days ? `?days=${days}` : ''
  const response = await apiRequest(`/accounts/${accountId}/ai-decisions/stats${params}`)
  return response.json()
}

// User authentication interfaces
export interface User {
  id: number
  username: string
  email?: string
  is_active: boolean
}

export interface UserAuthResponse {
  user: User
  session_token: string
  expires_at: string
}

// Trading Account management functions
export interface TradingAccount {
  id: number
  user_id: number
  name: string  // Display name (e.g., "GPT Trader", "Claude Analyst")
  model?: string  // AI model (e.g., "gpt-4-turbo")
  base_url?: string  // API endpoint
  api_key?: string  // API key (masked in responses)
  initial_capital: number
  current_cash: number
  frozen_cash: number
  account_type: string  // "AI" or "MANUAL"
  is_active: boolean
  auto_trading_enabled?: boolean
}

export interface TradingAccountCreate {
  name: string
  model?: string
  base_url?: string
  api_key?: string
  initial_capital?: number
  account_type?: string
  auto_trading_enabled?: boolean
}

export interface TradingAccountUpdate {
  name?: string
  model?: string
  base_url?: string
  api_key?: string
  auto_trading_enabled?: boolean
}

export type StrategyTriggerMode = 'realtime' | 'interval' | 'tick_batch'

export interface StrategyConfig {
  trigger_mode: StrategyTriggerMode
  interval_seconds?: number | null
  tick_batch_size?: number | null
  enabled: boolean
  last_trigger_at?: string | null
}

export interface StrategyConfigUpdate {
  trigger_mode: StrategyTriggerMode
  interval_seconds?: number | null
  tick_batch_size?: number | null
  enabled: boolean
}

// Prompt templates & bindings
export interface PromptTemplate {
  id: number
  key: string
  name: string
  description?: string | null
  templateText: string
  systemTemplateText: string
  updatedBy?: string | null
  updatedAt?: string | null
}

export interface PromptBinding {
  id: number
  accountId: number
  accountName: string
  accountModel?: string | null
  promptTemplateId: number
  promptKey: string
  promptName: string
  updatedBy?: string | null
  updatedAt?: string | null
}

export interface PromptListResponse {
  templates: PromptTemplate[]
  bindings: PromptBinding[]
}

export interface PromptTemplateUpdateRequest {
  templateText: string
  description?: string
  updatedBy?: string
}

export interface PromptBindingUpsertRequest {
  id?: number
  accountId: number
  promptTemplateId: number
  updatedBy?: string
}

export async function getPromptTemplates(): Promise<PromptListResponse> {
  return {
    templates: dummyPromptTemplates,
    bindings: dummyPromptBindings,
  }
}

export async function updatePromptTemplate(
  key: string,
  payload: PromptTemplateUpdateRequest,
): Promise<PromptTemplate> {
  const existing = dummyPromptTemplates.find((tpl) => tpl.key === key)
  if (!existing) {
    throw new Error(`Template ${key} not found`)
  }

  const updated: PromptTemplate = {
    ...existing,
    templateText: payload.templateText,
    description: payload.description ?? existing.description,
    updatedBy: payload.updatedBy ?? 'ui',
    updatedAt: new Date().toISOString(),
  }

  dummyPromptTemplates = dummyPromptTemplates.map((tpl) =>
    tpl.key === key ? updated : tpl,
  )

  return updated
}

export async function restorePromptTemplate(
  key: string,
  updatedBy?: string,
): Promise<PromptTemplate> {
  const existing = dummyPromptTemplates.find((tpl) => tpl.key === key)
  if (!existing) throw new Error(`Template ${key} not found`)

  // For demo purposes, just reset to default string
  const restored: PromptTemplate = {
    ...existing,
    templateText: existing.systemTemplateText || existing.templateText,
    description: existing.description ?? 'Restored template',
    updatedBy: updatedBy ?? 'system',
    updatedAt: new Date().toISOString(),
  }

  dummyPromptTemplates = dummyPromptTemplates.map((tpl) =>
    tpl.key === key ? restored : tpl,
  )

  return restored
}

export async function upsertPromptBinding(
  payload: PromptBindingUpsertRequest,
): Promise<PromptBinding> {
  const prompt = dummyPromptTemplates.find((tpl) => tpl.id === payload.promptTemplateId)
  const account = (await getAccounts()).find((acc) => acc.id === payload.accountId)

  if (!prompt || !account) throw new Error('Invalid prompt or account selection')

  if (payload.id) {
    const idx = dummyPromptBindings.findIndex((binding) => binding.id === payload.id)
    if (idx !== -1) {
      dummyPromptBindings[idx] = {
        ...dummyPromptBindings[idx],
        accountId: account.id,
        accountName: account.name,
        accountModel: account.model,
        promptTemplateId: prompt.id,
        promptKey: prompt.key,
        promptName: prompt.name,
        updatedBy: payload.updatedBy ?? 'ui',
        updatedAt: new Date().toISOString(),
      }
      return dummyPromptBindings[idx]
    }
  }

  const newBinding: PromptBinding = {
    id: Date.now(),
    accountId: account.id,
    accountName: account.name,
    accountModel: account.model,
    promptTemplateId: prompt.id,
    promptKey: prompt.key,
    promptName: prompt.name,
    updatedBy: payload.updatedBy ?? 'ui',
    updatedAt: new Date().toISOString(),
  }

  dummyPromptBindings = [...dummyPromptBindings, newBinding]
  return newBinding
}

export async function deletePromptBinding(bindingId: number): Promise<void> {
  dummyPromptBindings = dummyPromptBindings.filter((binding) => binding.id !== bindingId)
}

export interface PromptPreviewRequest {
  promptTemplateKey: string
  accountIds: number[]
  symbols?: string[]
}

export interface PromptPreviewItem {
  accountId: number
  accountName: string
  symbols: string[]
  filledPrompt: string
}

export interface PromptPreviewResponse {
  previews: PromptPreviewItem[]
}

export async function previewPrompt(
  payload: PromptPreviewRequest,
): Promise<PromptPreviewResponse> {
  const templates = dummyPromptTemplates
  const template = templates.find((tpl) => tpl.key === payload.promptTemplateKey)
  const accounts = await getAccounts()

  if (!template) throw new Error('Template not found')

  const previews: PromptPreviewItem[] = accounts
    .filter((account) => payload.accountIds.includes(account.id))
    .map((account) => ({
      accountId: account.id,
      accountName: account.name,
      symbols: payload.symbols ?? ['BTC', 'ETH', 'SOL'],
      filledPrompt: `# Prompt for ${account.name}\n\n${template.templateText}\n\n- Account Cash: ${account.current_cash}\n- Model: ${account.model}\n- Symbols: ${(payload.symbols ?? ['BTC']).join(', ')}`,
    }))

  return { previews }
}


export async function loginUser(username: string, password: string): Promise<UserAuthResponse> {
  const response = await apiRequest('/users/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  return response.json()
}

export async function getUserProfile(sessionToken: string): Promise<User> {
  const response = await apiRequest(`/users/profile?session_token=${sessionToken}`)
  return response.json()
}

// Trading Account management functions (matching backend query parameter style)
export async function listTradingAccounts(sessionToken: string): Promise<TradingAccount[]> {
  const response = await apiRequest(`/accounts/?session_token=${sessionToken}`)
  return response.json()
}

export async function createTradingAccount(account: TradingAccountCreate, sessionToken: string): Promise<TradingAccount> {
  const response = await apiRequest(`/accounts/?session_token=${sessionToken}`, {
    method: 'POST',
    body: JSON.stringify(account),
  })
  return response.json()
}

export async function getAccountStrategy(accountId: number): Promise<StrategyConfig> {
  const response = await apiRequest(`/account/${accountId}/strategy`)
  return response.json()
}

export async function updateAccountStrategy(accountId: number, config: StrategyConfigUpdate): Promise<StrategyConfig> {
  const response = await apiRequest(`/account/${accountId}/strategy`, {
    method: 'PUT',
    body: JSON.stringify(config),
  })
  return response.json()
}

export async function updateTradingAccount(accountId: number, account: TradingAccountUpdate, sessionToken: string): Promise<TradingAccount> {
  const response = await apiRequest(`/accounts/${accountId}?session_token=${sessionToken}`, {
    method: 'PUT',
    body: JSON.stringify(account),
  })
  return response.json()
}

export async function deleteTradingAccount(accountId: number, sessionToken: string): Promise<void> {
  await apiRequest(`/accounts/${accountId}?session_token=${sessionToken}`, {
    method: 'DELETE',
  })
}

// DUMMY DATA - Backend disabled, return mock accounts
export async function getAccounts(): Promise<TradingAccount[]> {
  // Backend disabled - return dummy accounts
  return [
    {
      id: 1,
      user_id: 1,
      name: 'Demo AI Trader',
      model: 'gpt',
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-***dummy***',
      initial_capital: 10000,
      current_cash: 7500,
      frozen_cash: 500,
      account_type: 'AI',
      is_active: true,
      auto_trading_enabled: true,
    },
    {
      id: 2,
      user_id: 1,
      name: 'Claude Trader',
      model: 'claude',
      base_url: 'https://api.anthropic.com/v1',
      api_key: 'sk-ant-***dummy***',
      initial_capital: 15000,
      current_cash: 12000,
      frozen_cash: 0,
      account_type: 'AI',
      is_active: true,
      auto_trading_enabled: true,
    },
  ]
}

// DUMMY DATA - Backend disabled
export async function getOverview(): Promise<any> {
  return {
    account: {
      id: 1,
      user_id: 1,
      name: 'Demo AI Trader',
      account_type: 'AI',
      initial_capital: 10000,
      current_cash: 7500,
      frozen_cash: 500,
    },
    total_assets: 10500,
    positions_value: 3000,
  }
}

export async function createAccount(account: TradingAccountCreate): Promise<TradingAccount> {
  const response = await apiRequest('/account/', {
    method: 'POST',
    body: JSON.stringify({
      name: account.name,
      model: account.model,
      base_url: account.base_url,
      api_key: account.api_key,
      account_type: account.account_type || 'AI',
      initial_capital: account.initial_capital || 10000,
      auto_trading_enabled: account.auto_trading_enabled ?? true,
    })
  })
  return response.json()
}

export async function updateAccount(accountId: number, account: TradingAccountUpdate): Promise<TradingAccount> {
  const response = await apiRequest(`/account/${accountId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: account.name,
      model: account.model,
      base_url: account.base_url,
      api_key: account.api_key,
      auto_trading_enabled: account.auto_trading_enabled,
    })
  })
  return response.json()
}

export async function testLLMConnection(testData: {
  model?: string;
  base_url?: string;
  api_key?: string;
}): Promise<{ success: boolean; message: string; response?: any }> {
  const response = await apiRequest('/account/test-llm', {
    method: 'POST',
    body: JSON.stringify(testData)
  })
  return response.json()
}

// Alpha Arena aggregated feeds
export interface ArenaAccountMeta {
  account_id: number
  name: string
  model?: string | null
}

export interface ArenaTrade {
  trade_id: number
  order_id?: number | null
  order_no?: string | null
  account_id: number
  account_name: string
  model?: string | null
  side: string
  direction: string
  symbol: string
  market: string
  price: number
  quantity: number
  notional: number
  commission: number
  trade_time?: string | null
  wallet_address?: string | null
  market_type?: 'spot' | 'futures' | null
}

export interface ArenaTradesResponse {
  generated_at: string
  accounts: ArenaAccountMeta[]
  trades: ArenaTrade[]
}

// DUMMY DATA - Backend disabled, return mock trades
export async function getArenaTrades(params?: { limit?: number; account_id?: number; trading_mode?: string; wallet_address?: string }): Promise<ArenaTradesResponse> {
  // Backend disabled - return dummy trades
  const limit = params?.limit || 50
  const dummyTrades: ArenaTrade[] = [
    {
      trade_id: 1,
      order_id: 1,
      order_no: 'ORD-001',
      account_id: 1,
      account_name: 'GPT Trader',
      model: 'gpt',
      side: 'buy',
      direction: 'long',
      symbol: 'BTCUSDT',
      market: 'hyperliquid',
      price: 61500,
      quantity: 0.1,
      notional: 6150,
      commission: 6.15,
      trade_time: new Date().toISOString(),
      wallet_address: '0x1234567890123456789012345678901234567890',
      market_type: 'futures',
    },
    {
      trade_id: 2,
      order_id: 2,
      order_no: 'ORD-002',
      account_id: 1,
      account_name: 'GPT Trader',
      model: 'gpt',
      side: 'buy',
      direction: 'long',
      symbol: 'ETHUSDT',
      market: 'hyperliquid',
      price: 3250,
      quantity: 2.5,
      notional: 8125,
      commission: 8.13,
      trade_time: new Date(Date.now() - 3600000).toISOString(),
      wallet_address: '0x1234567890123456789012345678901234567890',
      market_type: 'spot',
    },
    {
      trade_id: 3,
      order_id: 3,
      order_no: 'ORD-003',
      account_id: 1,
      account_name: 'GPT Trader',
      model: 'gpt',
      side: 'buy',
      direction: 'long',
      symbol: 'SOLUSDT',
      market: 'hyperliquid',
      price: 152.5,
      quantity: 50,
      notional: 7625,
      commission: 7.63,
      trade_time: new Date(Date.now() - 7200000).toISOString(),
      wallet_address: '0x1234567890123456789012345678901234567890',
      market_type: 'spot',
    },
    {
      trade_id: 4,
      order_id: 4,
      order_no: 'ORD-004',
      account_id: 1,
      account_name: 'GPT Trader',
      model: 'gpt',
      side: 'sell',
      direction: 'short',
      symbol: 'BNBUSDT',
      market: 'hyperliquid',
      price: 575,
      quantity: 10,
      notional: 5750,
      commission: 5.75,
      trade_time: new Date(Date.now() - 10800000).toISOString(),
      wallet_address: '0x1234567890123456789012345678901234567890',
      market_type: 'spot',
    },
  ].slice(0, limit)

  return {
    generated_at: new Date().toISOString(),
    accounts: [
      {
        account_id: 1,
        name: 'GPT Trader',
        model: 'gpt',
      },
    ],
    trades: dummyTrades,
  }
}

export interface ArenaModelChatEntry {
  id: number
  account_id: number
  account_name: string
  model?: string | null
  operation: string
  symbol?: string | null
  reason: string
  executed: boolean
  prev_portion: number
  target_portion: number
  total_balance: number
  order_id?: number | null
  decision_time?: string | null
  trigger_mode?: StrategyTriggerMode | null
  strategy_enabled?: boolean
  last_trigger_at?: string | null
  trigger_latency_seconds?: number | null
  prompt_snapshot?: string | null
  reasoning_snapshot?: string | null
  decision_snapshot?: string | null
  wallet_address?: string | null
}

export interface ArenaModelChatResponse {
  generated_at: string
  entries: ArenaModelChatEntry[]
}

// DUMMY DATA - Backend disabled, return mock model chat
export async function getArenaModelChat(params?: { limit?: number; account_id?: number; trading_mode?: string; wallet_address?: string }): Promise<ArenaModelChatResponse> {
  // Backend disabled - return dummy model chat entries
  const limit = params?.limit || 50
  const dummyEntries: ArenaModelChatEntry[] = [
    {
      id: 1,
      account_id: 1,
      account_name: 'GPT Trader',
      model: 'gpt',
      operation: 'buy',
      symbol: 'BTCUSDT',
      reason: 'Strong bullish momentum detected with RSI at 65 and MACD crossing above signal line. Price action showing consolidation breakout pattern.',
      executed: true,
      prev_portion: 0,
      target_portion: 0.3,
      total_balance: 10000,
      order_id: 1,
      decision_time: new Date().toISOString(),
      trigger_mode: 'realtime',
      strategy_enabled: true,
      last_trigger_at: new Date().toISOString(),
      trigger_latency_seconds: 2.5,
      wallet_address: '0x1234567890123456789012345678901234567890',
    },
    {
      id: 2,
      account_id: 1,
      account_name: 'GPT Trader',
      model: 'gpt',
      operation: 'sell',
      symbol: 'ETHUSDT',
      reason: 'Price reached resistance level with overbought conditions. Taking profits on 50% of position to lock in gains.',
      executed: true,
      prev_portion: 0.5,
      target_portion: 0.2,
      total_balance: 10500,
      order_id: 2,
      decision_time: new Date(Date.now() - 3600000).toISOString(),
      trigger_mode: 'realtime',
      strategy_enabled: true,
      last_trigger_at: new Date(Date.now() - 3600000).toISOString(),
      trigger_latency_seconds: 1.8,
      wallet_address: '0x1234567890123456789012345678901234567890',
    },
    {
      id: 3,
      account_id: 1,
      account_name: 'GPT Trader',
      model: 'gpt',
      operation: 'hold',
      symbol: null,
      reason: 'Market conditions uncertain with mixed signals. Maintaining current position allocation until clearer trend emerges.',
      executed: false,
      prev_portion: 0.3,
      target_portion: 0.3,
      total_balance: 10050,
      order_id: null,
      decision_time: new Date(Date.now() - 1800000).toISOString(),
      trigger_mode: 'realtime',
      strategy_enabled: true,
      last_trigger_at: new Date(Date.now() - 1800000).toISOString(),
      trigger_latency_seconds: 3.2,
      wallet_address: '0x1234567890123456789012345678901234567890',
    },
  ].slice(0, limit)

  return {
    generated_at: new Date().toISOString(),
    entries: dummyEntries,
  }
}

export interface ArenaPositionItem {
  id: number
  symbol: string
  name: string
  market: string
  side: string
  quantity: number
  avg_cost: number
  current_price: number
  notional: number
  current_value: number
  unrealized_pnl: number
  leverage?: number | null
  margin_used?: number | null
  return_on_equity?: number | null
  percentage?: number | null
  margin_mode?: string | null
  liquidation_px?: number | null
  max_leverage?: number | null
  leverage_type?: string | null
}

export interface ArenaPositionsAccount {
  account_id: number
  account_name: string
  model?: string | null
  environment?: string | null
  wallet_address?: string | null
  total_unrealized_pnl: number
  available_cash: number
  used_margin?: number | null
  positions: ArenaPositionItem[]
  total_assets: number
  initial_capital: number
  total_return?: number | null
  margin_usage_percent?: number | null
  margin_mode?: string | null
}

export interface ArenaPositionsResponse {
  generated_at: string
  accounts: ArenaPositionsAccount[]
}

// DUMMY DATA - Backend disabled, return mock positions
export async function getArenaPositions(params?: { account_id?: number; trading_mode?: string }): Promise<ArenaPositionsResponse> {
  // Backend disabled - return dummy positions
  const dummyAccounts: ArenaPositionsAccount[] = [
    {
      account_id: 1,
      account_name: 'GPT Trader',
      model: 'gpt',
      environment: params?.trading_mode === 'testnet' ? 'testnet' : params?.trading_mode === 'mainnet' ? 'mainnet' : 'testnet',
      wallet_address: '0x1234567890123456789012345678901234567890',
      total_unrealized_pnl: 350.50,
      available_cash: 8500,
      used_margin: 1500,
      positions: [
        // Futures positions (with leverage)
        {
          id: 1,
          symbol: 'BTCUSDT',
          name: 'Bitcoin/USDT',
          market: 'hyperliquid',
          side: 'long',
          quantity: 0.1,
          avg_cost: 60000,
          current_price: 61500,
          notional: 6150,
          current_value: 6150,
          unrealized_pnl: 150,
          leverage: 5,
          margin_used: 1230,
          return_on_equity: 12.2,
          percentage: 2.5,
          margin_mode: 'cross',
          liquidation_px: 48000,
          max_leverage: 50,
          leverage_type: 'isolated',
        },
        // Spot positions (no leverage or leverage = 1)
        {
          id: 2,
          symbol: 'ETHUSDT',
          name: 'Ethereum/USDT',
          market: 'hyperliquid',
          side: 'buy',
          quantity: 2.5,
          avg_cost: 3200,
          current_price: 3250,
          notional: 8125,
          current_value: 8125,
          unrealized_pnl: 125,
          leverage: 1,
          margin_used: null,
          return_on_equity: 3.9,
          percentage: 3.3,
          margin_mode: null,
          liquidation_px: null,
          max_leverage: null,
          leverage_type: null,
        },
        {
          id: 3,
          symbol: 'SOLUSDT',
          name: 'Solana/USDT',
          market: 'hyperliquid',
          side: 'buy',
          quantity: 50,
          avg_cost: 150,
          current_price: 152.5,
          notional: 7625,
          current_value: 7625,
          unrealized_pnl: 125,
          leverage: null,
          margin_used: null,
          return_on_equity: 1.6,
          percentage: 3.1,
          margin_mode: null,
          liquidation_px: null,
          max_leverage: null,
          leverage_type: null,
        },
        {
          id: 4,
          symbol: 'BNBUSDT',
          name: 'BNB/USDT',
          market: 'hyperliquid',
          side: 'sell',
          quantity: 10,
          avg_cost: 580,
          current_price: 575,
          notional: 5750,
          current_value: 5750,
          unrealized_pnl: 50,
          leverage: 1,
          margin_used: null,
          return_on_equity: 0.9,
          percentage: 2.3,
          margin_mode: null,
          liquidation_px: null,
          max_leverage: null,
          leverage_type: null,
        },
      ],
      total_assets: 10050,
      initial_capital: 10000,
      total_return: 0.5,
      margin_usage_percent: 15.0,
      margin_mode: 'cross',
    },
  ]

  return {
    generated_at: new Date().toISOString(),
    accounts: dummyAccounts,
  }

  /* Original API call - disabled
  const search = new URLSearchParams()
  if (params?.account_id) search.append('account_id', params.account_id.toString())
  if (params?.trading_mode) search.append('trading_mode', params.trading_mode)
  const query = search.toString()
  const response = await apiRequest(`/arena/positions${query ? `?${query}` : ''}`)
  const data = await response.json()

  const accounts = Array.isArray(data.accounts)
    ? data.accounts.map((account: any) => ({
        account_id: Number(account.account_id),
        account_name: account.account_name ?? '',
        model: account.model ?? null,
        environment: account.environment ?? null,
        wallet_address: account.wallet_address ?? null,
        total_unrealized_pnl: Number(account.total_unrealized_pnl ?? 0),
        available_cash: Number(account.available_cash ?? 0),
        positions_value: Number(account.positions_value ?? account.used_margin ?? 0),
        used_margin: account.used_margin !== undefined ? Number(account.used_margin) : null,
        total_assets: Number(account.total_assets ?? 0),
        initial_capital: Number(account.initial_capital ?? 0),
        total_return:
          account.total_return !== undefined && account.total_return !== null
            ? Number(account.total_return)
            : null,
        margin_usage_percent:
          account.margin_usage_percent !== undefined && account.margin_usage_percent !== null
            ? Number(account.margin_usage_percent)
            : null,
        margin_mode: account.margin_mode ?? null,
        positions: Array.isArray(account.positions)
          ? account.positions.map((pos: any, idx: number) => ({
              id: pos.id ?? idx,
              symbol: pos.symbol ?? '',
              name: pos.name ?? '',
              market: pos.market ?? '',
              side: pos.side ?? '',
              quantity: Number(pos.quantity ?? 0),
              avg_cost: Number(pos.avg_cost ?? 0),
              current_price: Number(pos.current_price ?? 0),
              notional: Number(pos.notional ?? 0),
              current_value: Number(pos.current_value ?? 0),
              unrealized_pnl: Number(pos.unrealized_pnl ?? 0),
              leverage:
                pos.leverage !== undefined && pos.leverage !== null
                  ? Number(pos.leverage)
                  : null,
              margin_used:
                pos.margin_used !== undefined && pos.margin_used !== null
                  ? Number(pos.margin_used)
                  : null,
              return_on_equity:
                pos.return_on_equity !== undefined && pos.return_on_equity !== null
                  ? Number(pos.return_on_equity)
                  : null,
              percentage:
                pos.percentage !== undefined && pos.percentage !== null
                  ? Number(pos.percentage)
                  : null,
              margin_mode: pos.margin_mode ?? null,
              liquidation_px:
                pos.liquidation_px !== undefined && pos.liquidation_px !== null
                  ? Number(pos.liquidation_px)
                  : null,
              max_leverage:
                pos.max_leverage !== undefined && pos.max_leverage !== null
                  ? Number(pos.max_leverage)
                  : null,
              leverage_type: pos.leverage_type ?? null,
            }))
          : [],
      }))
    : []

  return {
    generated_at: data.generated_at ?? new Date().toISOString(),
    accounts,
  }
  */
}

export interface ArenaAnalyticsAccount {
  account_id: number
  account_name: string
  model?: string | null
  initial_capital: number
  current_cash: number
  positions_value: number
  total_assets: number
  total_pnl: number
  total_return_pct?: number | null
  total_fees: number
  trade_count: number
  total_volume: number
  first_trade_time?: string | null
  last_trade_time?: string | null
  biggest_gain: number
  biggest_loss: number
  win_rate?: number | null
  loss_rate?: number | null
  sharpe_ratio?: number | null
  balance_volatility: number
  decision_count: number
  executed_decisions: number
  decision_execution_rate?: number | null
  avg_target_portion?: number | null
  avg_decision_interval_minutes?: number | null
}

export interface ArenaAnalyticsSummary {
  total_assets: number
  total_pnl: number
  total_return_pct?: number | null
  total_fees: number
  total_volume: number
  average_sharpe_ratio?: number | null
}

export interface ArenaAnalyticsResponse {
  generated_at: string
  accounts: ArenaAnalyticsAccount[]
  summary: ArenaAnalyticsSummary
}

export async function getArenaAnalytics(params?: { account_id?: number }): Promise<ArenaAnalyticsResponse> {
  const search = new URLSearchParams()
  if (params?.account_id) search.append('account_id', params.account_id.toString())
  const query = search.toString()
  const response = await apiRequest(`/arena/analytics${query ? `?${query}` : ''}`)
  return response.json()
}

// Hyperliquid symbol configuration
export interface HyperliquidSymbolMeta {
  symbol: string
  name?: string
  type?: string
}

export interface HyperliquidAvailableSymbolsResponse {
  symbols: HyperliquidSymbolMeta[]
  updated_at?: string
  max_symbols: number
}

export interface HyperliquidWatchlistResponse {
  symbols: string[]
  max_symbols: number
}

export async function getHyperliquidAvailableSymbols(): Promise<HyperliquidAvailableSymbolsResponse> {
  return {
    symbols: dummyHyperliquidWatchlist.map((symbol) => ({
      symbol,
      name: `${symbol} Perp`,
      type: 'perpetual',
    })),
    updated_at: new Date().toISOString(),
    max_symbols: 8,
  }
}

export async function getHyperliquidWatchlist(): Promise<HyperliquidWatchlistResponse> {
  return {
    symbols: dummyHyperliquidWatchlist,
    max_symbols: 8,
  }
}

export async function updateHyperliquidWatchlist(symbols: string[]): Promise<HyperliquidWatchlistResponse> {
  dummyHyperliquidWatchlist = symbols.slice(0, 8)
  return getHyperliquidWatchlist()
}

// Legacy aliases for backward compatibility
export type AIAccount = TradingAccount
export type AIAccountCreate = TradingAccountCreate

// Updated legacy functions to use default mode for simulation
export const listAIAccounts = () => getAccounts()
export const createAIAccount = (account: any) => {
  console.warn("createAIAccount is deprecated. Use default mode or new trading account APIs.")
  return Promise.resolve({} as TradingAccount)
}
export const updateAIAccount = (id: number, account: any) => {
  console.warn("updateAIAccount is deprecated. Use default mode or new trading account APIs.")
  return Promise.resolve({} as TradingAccount)
}
export const deleteAIAccount = (id: number) => {
  console.warn("deleteAIAccount is deprecated. Use default mode or new trading account APIs.")
  return Promise.resolve()
}
