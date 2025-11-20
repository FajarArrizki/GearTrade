import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { Toaster, toast } from 'react-hot-toast'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RainbowKitProvider } from '@rainbow-me/rainbowkit'
import '@rainbow-me/rainbowkit/styles.css'
import { config } from '@/lib/wagmi'

// Global error handler for debugging
window.addEventListener('error', (event) => {
  console.error('Global error caught:', event.error)
  console.error('Error stack:', event.error?.stack)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
})

// BACKEND DISABLED - Frontend only mode
// WebSocket connection disabled
// Create a module-level WebSocket singleton to avoid duplicate connections in React StrictMode
let __WS_SINGLETON__: WebSocket | null = null;

const resolveWsUrl = () => {
  // Backend disabled - WebSocket not available
  throw new Error('Backend is disabled. WebSocket connections are not available in frontend-only mode.')
  // if (typeof window === 'undefined') return 'ws://localhost:5611/ws'
  // const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  // return `${protocol}//${window.location.host}/ws`
}


import Header from '@/components/layout/Header'
import ComprehensiveView from '@/components/portfolio/ComprehensiveView'
import PromptManager from '@/components/prompt/PromptManager'
import TraderManagement from '@/components/trader/TraderManagement'
import Leaderboard from '@/components/leaderboard/Leaderboard'
// Remove CallbackPage import - handle inline
import { AIDecision, getAccounts } from '@/lib/api'
import { ArenaDataProvider } from '@/contexts/ArenaDataContext'
import { TradingModeProvider, useTradingMode } from '@/contexts/TradingModeContext'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import CryptoTicker from '@/components/portfolio/CryptoTicker'

interface User {
  id: number
  username: string
}

interface Account {
  id: number
  user_id: number
  name: string
  account_type: string
  initial_capital: number
  current_cash: number
  frozen_cash: number
}

interface Overview {
  account: Account
  total_assets: number
  positions_value: number
  portfolio?: {
    total_assets: number
    positions_value: number
  }
}
interface Position { id: number; account_id: number; symbol: string; name: string; market: string; quantity: number; available_quantity: number; avg_cost: number; last_price?: number | null; market_value?: number | null }
interface Order { id: number; order_no: string; symbol: string; name: string; market: string; side: string; order_type: string; price?: number; quantity: number; filled_quantity: number; status: string }
interface Trade { id: number; order_id: number; account_id: number; symbol: string; name: string; market: string; side: string; price: number; quantity: number; commission: number; trade_time: string }

const PAGE_TITLES: Record<string, string> = {
  comprehensive: 'Trade',
  leaderboard: 'Leaderboard',
  'prompt-management': 'Prompt Templates',
  'trader-management': 'AI Trader Management',
}

// DUMMY DATA - Backend disabled, using mock data for design
const DUMMY_USER: User = {
  id: 1,
  username: 'demo_user',
}

const DUMMY_ACCOUNT: Account = {
  id: 1,
  user_id: 1,
  name: 'Demo AI Trader',
  account_type: 'AI',
  initial_capital: 10000,
  current_cash: 7500,
  frozen_cash: 500,
}

const DUMMY_OVERVIEW: Overview = {
  account: DUMMY_ACCOUNT,
  total_assets: 10500,
  positions_value: 3000,
  portfolio: {
    total_assets: 10500,
    positions_value: 3000,
  },
}

const DUMMY_POSITIONS: Position[] = [
  {
    id: 1,
    account_id: 1,
    symbol: 'BTCUSDT',
    name: 'Bitcoin/USDT',
    market: 'crypto',
    quantity: 0.5,
    available_quantity: 0.5,
    avg_cost: 60000,
    last_price: 62000,
    market_value: 31000,
  },
  {
    id: 2,
    account_id: 1,
    symbol: 'ETHUSDT',
    name: 'Ethereum/USDT',
    market: 'crypto',
    quantity: 10,
    available_quantity: 10,
    avg_cost: 3000,
    last_price: 3100,
    market_value: 31000,
  },
]

const DUMMY_ORDERS: Order[] = [
  {
    id: 1,
    order_no: 'ORD-001',
    symbol: 'BTCUSDT',
    name: 'Bitcoin/USDT',
    market: 'crypto',
    side: 'buy',
    order_type: 'limit',
    price: 61500,
    quantity: 0.1,
    filled_quantity: 0,
    status: 'pending',
  },
]

const DUMMY_TRADES: Trade[] = [
  {
    id: 1,
    order_id: 1,
    account_id: 1,
    symbol: 'BTCUSDT',
    name: 'Bitcoin/USDT',
    market: 'crypto',
    side: 'buy',
    price: 60000,
    quantity: 0.5,
    commission: 30,
    trade_time: new Date().toISOString(),
  },
]

const DUMMY_AI_DECISIONS: AIDecision[] = [
  {
    id: 1,
    account_id: 1,
    decision_time: new Date().toISOString(),
    reason: 'Strong bullish signal detected from RSI and MACD indicators',
    operation: 'buy',
    symbol: 'BTCUSDT',
    prev_portion: 0,
    target_portion: 0.3,
    total_balance: 10000,
    executed: 'yes',
    order_id: 1,
  },
  {
    id: 2,
    account_id: 1,
    decision_time: new Date(Date.now() - 3600000).toISOString(),
    reason: 'Price consolidation observed, reducing position size',
    operation: 'sell',
    symbol: 'ETHUSDT',
    prev_portion: 0.5,
    target_portion: 0.2,
    total_balance: 10500,
    executed: 'yes',
    order_id: 2,
  },
]

const DUMMY_ACCOUNTS: any[] = [
  {
    id: 1,
    name: 'Demo AI Trader',
    model: 'gpt-4',
    account_type: 'AI',
    initial_capital: 10000,
    current_cash: 7500,
    is_active: true,
    auto_trading_enabled: true,
  },
  {
    id: 2,
    name: 'Claude Trader',
    model: 'claude-sonnet-4',
    account_type: 'AI',
    initial_capital: 15000,
    current_cash: 12000,
    is_active: true,
    auto_trading_enabled: true,
  },
]

const queryClient = new QueryClient()

function App() {
  const { tradingMode } = useTradingMode()
  const { setUser: setAuthUser } = useAuth()
  // DUMMY DATA - Backend disabled, using mock data
  const [user, setUser] = useState<User | null>(DUMMY_USER)
  const [account, setAccount] = useState<Account | null>(DUMMY_ACCOUNT)
  const [overview, setOverview] = useState<Overview | null>(DUMMY_OVERVIEW)
  const [positions, setPositions] = useState<Position[]>(DUMMY_POSITIONS)
  const [orders, setOrders] = useState<Order[]>(DUMMY_ORDERS)
  const [trades, setTrades] = useState<Trade[]>(DUMMY_TRADES)
  const [aiDecisions, setAiDecisions] = useState<AIDecision[]>(DUMMY_AI_DECISIONS)
  // DUMMY DATA - Generate dummy asset curve data for chart
  const generateDummyAssetCurves = (): any[] => {
    const now = Date.now()
    const curves: any[] = []
    const initialValue = 10000
    
    // Generate 24 hours of 5-minute data points (288 points)
    for (let i = 287; i >= 0; i--) {
      const timestamp = now - (i * 5 * 60 * 1000)
      const hoursAgo = i / 12
      const variation = Math.sin(hoursAgo * 0.5) * 500 + Math.random() * 200 - 100
      const totalAssets = initialValue + variation + (hoursAgo * 50)
      
      curves.push({
        timestamp,
        datetime_str: new Date(timestamp).toISOString(),
        date: new Date(timestamp).toISOString().split('T')[0],
        account_id: 1,
        total_assets: Math.max(9500, totalAssets),
        cash: 7500,
        positions_value: totalAssets - 7500,
        is_initial: i === 287,
        user_id: 1,
        username: 'GPT Trader',
      })
    }
    return curves
  }
  const [allAssetCurves, setAllAssetCurves] = useState<any[]>(generateDummyAssetCurves())
  
  // Initialize currentPage from URL
  const getInitialPage = (): string => {
    if (typeof window === 'undefined') return 'comprehensive'
    const pathname = window.location.pathname
    const pathParts = pathname.split('/').filter(Boolean)
    const pageFromPath = pathParts[0] || 'comprehensive'
    
    const pageMap: Record<string, string> = {
      'leaderboard': 'leaderboard',
      'prompt-management': 'prompt-management',
      'trader-management': 'trader-management',
      '': 'comprehensive',
    }
    
    return pageMap[pageFromPath] || 'comprehensive'
  }
  
  const [currentPage, setCurrentPage] = useState<string>(getInitialPage())
  const tradingModeRef = useRef(tradingMode)

  // Handle page routing from URL pathname
  useEffect(() => {
    const pathname = window.location.pathname

    // Handle OAuth callback
    if (pathname === '/callback') {
      const handleCallback = async () => {
        try {
          const urlParams = new URLSearchParams(window.location.search)
          const sessionParam = urlParams.get('session')

          const { decodeArenaSession, exchangeCodeForToken, getUserInfo } = await import('@/lib/auth')
          const Cookies = await import('js-cookie')

          if (sessionParam) {
            const session = decodeArenaSession(sessionParam)
            if (!session || !session.token.access_token) {
              console.error('Invalid session payload received')
              toast.error('Login failed: Invalid session payload')
              window.location.href = '/'
              return
            }

            Cookies.default.set('arena_token', session.token.access_token, { expires: 7 })
            Cookies.default.set('arena_user', JSON.stringify(session.user), { expires: 7 })
            setAuthUser(session.user)
            toast.success('Login successful!')
            window.location.href = '/'
            return
          }

          // Handle direct token parameter (from Casdoor relay)
          const tokenParam = urlParams.get('token')
          if (tokenParam) {
            console.log('[Callback] Received token from relay server, length:', tokenParam.length)

            try {
              // Fetch user info with the token
              const userData = await getUserInfo(tokenParam)
              if (!userData) {
                console.error('[Callback] Failed to get user information')
                toast.error('Login failed: Unable to get user information')
                window.location.href = '/'
                return
              }

              // Save token and user data
              Cookies.default.set('arena_token', tokenParam, { expires: 7 })
              Cookies.default.set('arena_user', JSON.stringify(userData), { expires: 7 })
              setAuthUser(userData)
              toast.success('Login successful!')
              window.location.href = '/'
              return
            } catch (err) {
              console.error('[Callback] Error processing token:', err)
              toast.error('Login failed: Unable to process token')
              window.location.href = '/'
              return
            }
          }

          const code = urlParams.get('code')
          const state = urlParams.get('state')

          if (!code) {
            console.error('No authorization code received')
            toast.error('Login failed: No authorization code received')
            window.location.href = '/'
            return
          }

          const accessToken = await exchangeCodeForToken(code, state || '')
          if (!accessToken) {
            console.error('Failed to get access token')
            toast.error('Login failed: Unable to get access token')
            window.location.href = '/'
            return
          }

          const userData = await getUserInfo(accessToken)
          if (!userData) {
            console.error('Failed to get user information')
            toast.error('Login failed: Unable to get user information')
            window.location.href = '/'
            return
          }

          Cookies.default.set('arena_token', accessToken, { expires: 7 })
          Cookies.default.set('arena_user', JSON.stringify(userData), { expires: 7 })
          setAuthUser(userData)
          toast.success('Login successful!')
          window.location.href = '/'
        } catch (err) {
          console.error('Callback error:', err)
          toast.error('Login error occurred')
          window.location.href = '/'
        }
      }

      handleCallback()
      return
    }

    // Extract page from pathname
    const pathParts = pathname.split('/').filter(Boolean)
    const pageFromPath = pathParts[0] || 'comprehensive'
    
    // Map path to page ID
    const pageMap: Record<string, string> = {
      'leaderboard': 'leaderboard',
      'prompt-management': 'prompt-management',
      'trader-management': 'trader-management',
      '': 'comprehensive',
    }
    
    const mappedPage = pageMap[pageFromPath] || 'comprehensive'
    
    if (mappedPage !== currentPage) {
      setCurrentPage(mappedPage)
    }

    // Handle browser back/forward buttons
    const handlePopState = (event: PopStateEvent) => {
      const pathname = window.location.pathname
      const pathParts = pathname.split('/').filter(Boolean)
      const pageFromPath = pathParts[0] || 'comprehensive'
      
      const pageMap: Record<string, string> = {
        'leaderboard': 'leaderboard',
        'prompt-management': 'prompt-management',
        'trader-management': 'trader-management',
        '': 'comprehensive',
      }
      
      const mappedPage = pageMap[pageFromPath] || 'comprehensive'
      setCurrentPage(mappedPage)
    }

    window.addEventListener('popstate', handlePopState)
    
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [currentPage])
  const [accountRefreshTrigger, setAccountRefreshTrigger] = useState<number>(0)
  // DUMMY DATA - Backend disabled, WebSocket disabled
  const wsRef = useRef<WebSocket | null>(null)
  const [accounts, setAccounts] = useState<any[]>(DUMMY_ACCOUNTS)
  const [accountsLoading, setAccountsLoading] = useState<boolean>(false)

  useEffect(() => {
    tradingModeRef.current = tradingMode
  }, [tradingMode])

  useEffect(() => {
    // BACKEND DISABLED - WebSocket connection disabled
    console.warn('Backend is disabled. WebSocket features are not available in frontend-only mode.')
    return
    /* WebSocket code disabled - backend not available
    let reconnectTimer: NodeJS.Timeout | null = null
    let ws = __WS_SINGLETON__
    const created = !ws || ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED
    
    const connectWebSocket = () => {
      try {
        ws = new WebSocket(resolveWsUrl())
        __WS_SINGLETON__ = ws
        wsRef.current = ws
        
        const handleOpen = () => {
          console.log('WebSocket connected')
          // Start with hardcoded default user for paper trading
          ws!.send(JSON.stringify({
            type: 'bootstrap',
            username: 'default',
            initial_capital: 10000,
            trading_mode: tradingMode
          }))
        }
        
        const handleMessage = (e: MessageEvent) => {
          try {
            const msg = JSON.parse(e.data)
            if (msg.type === 'bootstrap_ok') {
              if (msg.user) {
                setUser(msg.user)
              }
              if (msg.account) {
                setAccount(msg.account)
                // Only request snapshot for paper mode
                if (tradingMode === 'paper') {
                  ws!.send(JSON.stringify({
                    type: 'get_snapshot',
                    trading_mode: tradingMode
                  }))
                }
              }
              // refresh accounts list once bootstrapped
              refreshAccounts()
            } else if (msg.type === 'snapshot') {
              // Process snapshot data (backend already filters by trading mode)
              if (msg.overview) setOverview(msg.overview)
              if (msg.positions) setPositions(msg.positions)
              if (msg.orders) setOrders(msg.orders)
              if (msg.trades) setTrades(msg.trades)
              if (msg.ai_decisions) setAiDecisions(msg.ai_decisions)
              if (msg.all_asset_curves) setAllAssetCurves(msg.all_asset_curves)
              const currentMode = tradingModeRef.current
              const messageMode = msg.trading_mode as string | undefined
              if (
                currentMode !== 'paper' &&
                (messageMode === undefined || messageMode === currentMode)
              ) {
                setHyperliquidRefreshKey(prev => prev + 1)
              }
            } else if (msg.type === 'trades') {
              setTrades(msg.trades || [])
            } else if (msg.type === 'order_filled') {
              toast.success('Order filled')
              const env = tradingMode === 'testnet' || tradingMode === 'mainnet' ? tradingMode : undefined
              ws!.send(JSON.stringify({
                type: 'get_snapshot',
                trading_mode: tradingMode
              }))
              ws!.send(JSON.stringify({
                type: 'get_asset_curve',
                timeframe: '5m',
                trading_mode: tradingMode,
                ...(env ? { environment: env } : {})
              }))
            } else if (msg.type === 'order_pending') {
              toast('Order placed, waiting for fill', { icon: '⏳' })
              const env = tradingMode === 'testnet' || tradingMode === 'mainnet' ? tradingMode : undefined
              ws!.send(JSON.stringify({
                type: 'get_snapshot',
                trading_mode: tradingMode
              }))
              ws!.send(JSON.stringify({
                type: 'get_asset_curve',
                timeframe: '5m',
                trading_mode: tradingMode,
                ...(env ? { environment: env } : {})
              }))
            } else if (msg.type === 'user_switched') {
              setUser(msg.user)
            } else if (msg.type === 'account_switched') {
              setAccount(msg.account)
              refreshAccounts()
            } else if (msg.type === 'trade_update') {
              // Real-time trade update - prepend to trades list
              setTrades(prev => [msg.trade, ...prev].slice(0, 100))
              toast.success('New trade executed!', { duration: 2000 })
            } else if (msg.type === 'position_update') {
              // Real-time position update
              setPositions(msg.positions || [])
            } else if (msg.type === 'model_chat_update') {
              // Real-time AI decision update - prepend to AI decisions list
              setAiDecisions(prev => [msg.decision, ...prev].slice(0, 100))
            } else if (msg.type === 'asset_curve_update') {
              // Real-time asset curve update
              setAllAssetCurves(msg.data || [])
              const currentMode = tradingModeRef.current
              const messageMode = msg.trading_mode as string | undefined
              if (
                currentMode !== 'paper' &&
                (messageMode === undefined || messageMode === currentMode)
              ) {
                setHyperliquidRefreshKey(prev => prev + 1)
              }
            } else if (msg.type === 'asset_curve_data') {
              setAllAssetCurves(msg.data || [])
              const currentMode = tradingModeRef.current
              const messageMode = msg.trading_mode as string | undefined
              if (
                currentMode !== 'paper' &&
                (messageMode === undefined || messageMode === currentMode)
              ) {
                setHyperliquidRefreshKey(prev => prev + 1)
              }
            } else if (msg.type === 'error') {
              console.error(msg.message)
              toast.error(msg.message || 'Order error')
            }
          } catch (err) {
            console.error('Failed to parse WebSocket message:', err)
          }
        }
        
        const handleClose = (event: CloseEvent) => {
          console.log('WebSocket closed:', event.code, event.reason)
          __WS_SINGLETON__ = null
          if (wsRef.current === ws) wsRef.current = null
          
          // Attempt to reconnect after 3 seconds if the close wasn't intentional
          if (event.code !== 1000 && event.code !== 1001) {
            reconnectTimer = setTimeout(() => {
              console.log('Attempting to reconnect WebSocket...')
              connectWebSocket()
            }, 3000)
          }
        }
        
        const handleError = (event: Event) => {
          console.error('WebSocket error:', event)
          // Don't show toast for every error to avoid spam
          // toast.error('Connection error')
        }

        ws.addEventListener('open', handleOpen)
        ws.addEventListener('message', handleMessage)
        ws.addEventListener('close', handleClose)
        ws.addEventListener('error', handleError)
        
        return () => {
          ws?.removeEventListener('open', handleOpen)
          ws?.removeEventListener('message', handleMessage)
          ws?.removeEventListener('close', handleClose)
          ws?.removeEventListener('error', handleError)
        }
      } catch (err) {
        console.error('Failed to create WebSocket:', err)
        // Retry connection after 5 seconds
        reconnectTimer = setTimeout(connectWebSocket, 5000)
      }
    }
    
    if (created) {
      connectWebSocket()
    } else {
      wsRef.current = ws
    }

    return () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }
      // Don't close the socket in cleanup to avoid issues with React StrictMode
    }
    */
  }, [])

  // DUMMY DATA - Backend disabled, using mock data
  const refreshAccounts = async () => {
    // Backend disabled - using dummy data
    setAccounts(DUMMY_ACCOUNTS)
    setAccountsLoading(false)
  }

  // Fetch accounts on mount and when settings updated
  useEffect(() => {
    // Backend disabled - using dummy data
    setAccounts(DUMMY_ACCOUNTS)
    setAccountsLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountRefreshTrigger])

  // DUMMY DATA - Backend disabled, no WebSocket refresh
  // Refresh data when trading mode changes
  useEffect(() => {
    // Backend disabled - using dummy data
    console.log('Trading mode changed to:', tradingMode)
  }, [tradingMode, account])

  // DUMMY DATA - Backend disabled, no auto-refresh
  // Auto-refresh via WebSocket every 30 seconds (no console spam)
  useEffect(() => {
    // Backend disabled - no auto-refresh
    return () => {}
  }, [account, tradingMode])

  // DUMMY DATA - Backend disabled, mock functions
  const placeOrder = (payload: any) => {
    console.log('DUMMY: placeOrder called with:', payload)
    toast('DUMMY: Order would be placed (backend disabled)', { icon: '📝' })
  }

  const switchUser = (username: string) => {
    console.log('DUMMY: switchUser called with:', username)
    toast('DUMMY: User switch (backend disabled)', { icon: '👤' })
  }

  const switchAccount = (accountId: number) => {
    console.log('DUMMY: switchAccount called with:', accountId)
    const selectedAccount = DUMMY_ACCOUNTS.find(acc => acc.id === accountId)
    if (selectedAccount) {
      setAccount({
        id: selectedAccount.id,
        user_id: 1,
        name: selectedAccount.name,
        account_type: selectedAccount.account_type,
        initial_capital: selectedAccount.initial_capital,
        current_cash: selectedAccount.current_cash,
        frozen_cash: 0,
      })
      toast('DUMMY: Account switched (backend disabled)', { icon: '🔄' })
    }
  }

  const handleAccountUpdated = () => {
    // DUMMY DATA - Backend disabled
    console.log('DUMMY: handleAccountUpdated called')
    setAccountRefreshTrigger(prev => prev + 1)
  }

  // DUMMY DATA - Always use dummy overview
  const effectiveOverview = overview || DUMMY_OVERVIEW

  // DUMMY DATA - Never show loading screen, always use dummy data
  // if (!user || !account || (!effectiveOverview && tradingMode === 'paper')) return <div className="p-8">Connecting to trading server...</div>

  const renderMainContent = () => {
    // DUMMY DATA - Backend disabled, mock refresh
    const refreshData = () => {
      console.log('DUMMY: refreshData called')
      toast('DUMMY: Data refresh (backend disabled)', { icon: '🔄' })
    }

    return (
      <main className={`flex-1 overflow-hidden flex flex-col ${currentPage === 'prompt-management' || currentPage === 'leaderboard' ? 'p-0 h-full' : 'p-4 min-h-0'}`} style={currentPage === 'prompt-management' || currentPage === 'leaderboard' ? { height: '100%', maxHeight: 'none', minHeight: 0 } : {}}>

        {currentPage === 'comprehensive' && (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden pr-1">
            <ComprehensiveView
              overview={effectiveOverview}
              positions={positions}
              orders={orders}
              trades={trades}
              aiDecisions={aiDecisions}
              allAssetCurves={allAssetCurves}
              wsRef={wsRef}
              onSwitchUser={switchUser}
              onSwitchAccount={switchAccount}
              onRefreshData={refreshData}
              accountRefreshTrigger={accountRefreshTrigger}
              accounts={accounts}
              loadingAccounts={accountsLoading}
              onPageChange={handlePageChange}
            />
          </div>
        )}

        {currentPage === 'leaderboard' && (
          <div className="flex-1 flex flex-col overflow-hidden w-full" style={{ height: '100%', maxHeight: 'none', minHeight: 0 }}>
            <Leaderboard />
          </div>
        )}

        {currentPage === 'prompt-management' && (
          <div className="flex-1 flex flex-col overflow-hidden w-full" style={{ height: '100%', maxHeight: 'none', minHeight: 0 }}>
            <PromptManager />
          </div>
        )}

        {currentPage === 'trader-management' && (
          <TraderManagement />
        )}
      </main>
    )
  }

  // Always use "Trade" as title
  const pageTitle = 'Trade'

  // Handle page change and update URL
  const handlePageChange = useCallback((page: string) => {
    setCurrentPage(page)
    
    // Update URL pathname without hash
    const pathMap: Record<string, string> = {
      'comprehensive': '/',
      'leaderboard': '/leaderboard',
      'prompt-management': '/prompt-management',
      'trader-management': '/trader-management',
    }
    
    const newPath = pathMap[page] || '/'
    
    // Use history.pushState to update URL without reload
    window.history.pushState({ page }, '', newPath)
  }, [])

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <Header
        title={pageTitle}
        currentAccount={account}
        showAccountSelector={currentPage === 'comprehensive'}
        currentPage={currentPage}
        onPageChange={handlePageChange}
      />
      <div className={`flex-1 flex flex-col overflow-hidden pt-[72px] ${currentPage === 'comprehensive' ? 'pb-12' : ''}`} style={currentPage === 'prompt-management' || currentPage === 'leaderboard' ? { height: 'calc(100vh - 72px)', maxHeight: 'none', minHeight: 0 } : {}}>
        <div className={`${currentPage === 'prompt-management' || currentPage === 'leaderboard' ? 'flex-1 overflow-hidden h-full' : 'flex-1 overflow-y-auto'}`} style={currentPage === 'prompt-management' || currentPage === 'leaderboard' ? { height: '100%', maxHeight: 'none', minHeight: 0 } : {}}>
          {renderMainContent()}
        </div>
      </div>
      {/* Only show CryptoTicker on home (comprehensive) page */}
      {currentPage === 'comprehensive' && <CryptoTicker />}
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <AuthProvider>
            <TradingModeProvider>
              <ArenaDataProvider>
                <Toaster position="top-right" />
                <App />
              </ArenaDataProvider>
            </TradingModeProvider>
          </AuthProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
