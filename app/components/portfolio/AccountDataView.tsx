import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AssetCurveWithData from './AssetCurveWithData'
import HyperliquidSummary from './HyperliquidSummary'
import StrategyPanel from '@/components/portfolio/StrategyPanel'
import {
  AIDecision,
  ArenaPositionItem,
  ArenaPositionsAccount,
  getArenaPositions,
  ArenaTrade,
  getArenaTrades,
  ArenaAccountMeta,
} from '@/lib/api'
import AlphaArenaFeed from './AlphaArenaFeed'
import ArenaAnalyticsFeed from './ArenaAnalyticsFeed'
import FlipNumber from './FlipNumber'
import RealtimePrice from './RealtimePrice'
import { useTradingMode, TradingType } from '@/contexts/TradingModeContext'
import { Card } from '@/components/ui/card'
import { getModelLogo } from './logoAssets'
import HighlightWrapper from './HighlightWrapper'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'react-hot-toast'

// Helper function for symbol badge
function renderSymbolBadge(symbol?: string, size: 'sm' | 'md' = 'md') {
  if (!symbol) return null
  const text = symbol.slice(0, 4).toUpperCase()
  const baseClasses = 'inline-flex items-center justify-center rounded bg-muted text-muted-foreground font-semibold'
  const sizeClasses = size === 'sm' ? 'h-4 w-4 text-[9px]' : 'h-5 w-5 text-[10px]'
  return <span className={`${baseClasses} ${sizeClasses}`}>{text}</span>
}

function formatPercent(value?: number | null) {
  if (value === undefined || value === null) return '—'
  return `${(value * 100).toFixed(2)}%`
}

function formatDate(value?: string | null) {
  if (!value) return 'N/A'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Completed Trades Section Component
function CompletedTradesSectionComponent({
  trades,
  loading,
  selectedAccount,
  refreshKey,
}: {
  trades: ArenaTrade[]
  loading: boolean
  selectedAccount?: number | 'all'
  refreshKey?: number
}) {
  const filteredTrades = useMemo(() => {
    if (selectedAccount === 'all') return trades
    return trades.filter(t => t.account_id === selectedAccount)
  }, [trades, selectedAccount])

  const seenTradeIdsRef = useRef<Set<number>>(new Set())

  if (loading && filteredTrades.length === 0) {
    return (
      <div className="p-6">
        <div className="text-xs text-muted-foreground">Loading trades...</div>
      </div>
    )
  }

  if (filteredTrades.length === 0) {
    return (
      <div className="p-6">
        <div className="text-xs text-muted-foreground">No recent trades found.</div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
        {filteredTrades.map((trade) => {
          const modelLogo = getModelLogo(trade.account_name || trade.model)
          const isNew = !seenTradeIdsRef.current.has(trade.trade_id)
          if (isNew) {
            seenTradeIdsRef.current.add(trade.trade_id)
          }
          return (
            <HighlightWrapper key={`${trade.trade_id}-${trade.trade_time}`} isNew={isNew}>
              <div className="border border-border bg-muted/40 rounded px-4 py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                  <div className="flex items-center gap-2">
                    {modelLogo && (
                      <img
                        src={modelLogo.src}
                        alt={modelLogo.alt}
                        className="h-5 w-5 rounded-full object-contain bg-background"
                        loading="lazy"
                      />
                    )}
                    <span className="font-semibold text-foreground">{trade.account_name}</span>
                  </div>
                  <span>{formatDate(trade.trade_time)}</span>
                </div>
                <div className="text-sm text-foreground flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{trade.account_name}</span>
                  <span>completed a</span>
                  <span className={`px-2 py-1 rounded text-xs font-bold ${
                    trade.side === 'BUY' || trade.side.toLowerCase() === 'buy'
                      ? 'bg-emerald-100 text-emerald-800'
                      : trade.side === 'CLOSE'
                      ? 'bg-orange-100 text-orange-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {trade.side}
                  </span>
                  <span>trade on</span>
                  <span className="flex items-center gap-2 font-semibold">
                    {renderSymbolBadge(trade.symbol)}
                    {trade.symbol}
                  </span>
                  {trade.market_type && (
                    <span className={`px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wide ${
                      trade.market_type === 'spot'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-purple-100 text-purple-800'
                    }`}>
                      {trade.market_type}
                    </span>
                  )}
                  <span>!</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="block text-[10px] uppercase tracking-wide">Price</span>
                    <span className="font-medium text-foreground">
                      <FlipNumber value={trade.price} prefix="$" decimals={2} />
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wide">Quantity</span>
                    <span className="font-medium text-foreground">
                      <FlipNumber value={trade.quantity} decimals={4} />
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wide">Notional</span>
                    <span className="font-medium text-foreground">
                      <FlipNumber value={trade.notional} prefix="$" decimals={2} />
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wide">Commission</span>
                    <span className="font-medium text-foreground">
                      <FlipNumber value={trade.commission} prefix="$" decimals={2} />
                    </span>
                  </div>
                </div>
              </div>
            </HighlightWrapper>
          )
        })}
    </div>
  )
}

// Positions Section Component
function PositionsSectionComponent({
  positions,
  loading,
  selectedAccount,
  refreshKey,
  onRefresh,
  onCloseAll,
  onClosePosition,
}: {
  positions: ArenaPositionsAccount[]
  loading: boolean
  selectedAccount?: number | 'all'
  refreshKey?: number
  onRefresh?: () => void
  onCloseAll?: () => void
  onClosePosition?: (accountId: number, positionId: number, symbol: string) => void
}) {
  const { tradingType } = useTradingMode()
  
  const filteredPositions = useMemo(() => {
    if (selectedAccount === 'all') return positions
    return positions.filter(p => p.account_id === selectedAccount)
  }, [positions, selectedAccount])

  // Filter positions by trading type (spot vs futures)
  // Spot positions typically don't have leverage, Futures positions have leverage
  const filteredByType = useMemo(() => {
    return filteredPositions.map(account => ({
      ...account,
      positions: account.positions.filter(position => {
        if (tradingType === 'spot') {
          // Spot: positions without leverage or with leverage = 1
          return !position.leverage || position.leverage === 1
        } else {
          // Futures: positions with leverage > 1
          return position.leverage && position.leverage > 1
        }
      })
    })).filter(account => account.positions.length > 0)
  }, [filteredPositions, tradingType])

  if (loading && filteredByType.length === 0) {
    return (
      <div className="p-6">
        <div className="text-xs text-muted-foreground">Loading positions…</div>
      </div>
    )
  }

  if (filteredByType.length === 0) {
    return (
      <div className="p-6">
        <div className="text-xs text-muted-foreground">No active {tradingType} positions currently.</div>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      {filteredByType.map((snapshot) => {
        const marginUsageClass =
          snapshot.margin_usage_percent !== undefined && snapshot.margin_usage_percent !== null
            ? snapshot.margin_usage_percent >= 75
              ? 'text-red-600'
              : snapshot.margin_usage_percent >= 50
                ? 'text-amber-600'
                : 'text-emerald-600'
            : 'text-muted-foreground'
        return (
          <Card key={snapshot.account_id} className="border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="text-sm font-semibold uppercase tracking-wide text-foreground">
                  {snapshot.account_name}
                </div>
                {snapshot.environment && (
                  <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {snapshot.environment}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs uppercase tracking-wide text-muted-foreground">
                <div>
                  <span className="block text-[10px] text-muted-foreground">Total Equity</span>
                  <span className="font-semibold text-foreground">
                    <FlipNumber value={snapshot.total_assets} prefix="$" decimals={2} />
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-muted-foreground">Available Cash</span>
                  <span className="font-semibold text-foreground">
                    <FlipNumber value={snapshot.available_cash} prefix="$" decimals={2} />
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-muted-foreground">Used Margin</span>
                  <span className="font-semibold text-foreground">
                    <FlipNumber value={snapshot.used_margin ?? 0} prefix="$" decimals={2} />
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-muted-foreground">Margin Usage</span>
                  <span className={`font-semibold ${marginUsageClass}`}>
                    {snapshot.margin_usage_percent !== undefined && snapshot.margin_usage_percent !== null
                      ? `${snapshot.margin_usage_percent.toFixed(2)}%`
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-muted-foreground">Unrealized P&L</span>
                  <span className={`font-semibold ${snapshot.total_unrealized_pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    <FlipNumber value={snapshot.total_unrealized_pnl} prefix="$" decimals={2} />
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] text-muted-foreground">Total Return</span>
                  <span className={`font-semibold ${snapshot.total_return && snapshot.total_return >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatPercent(snapshot.total_return)}
                  </span>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="flex items-center justify-between gap-3 px-4 py-2 bg-muted/50 border-b border-border">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Positions
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onRefresh}
                    disabled={loading}
                    className="text-xs h-8"
                  >
                    Refresh
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={onCloseAll}
                    disabled={loading || snapshot.positions.length === 0}
                    className="text-xs h-8 w-20"
                  >
                    Close All
                  </Button>
                </div>
              </div>
              {tradingType === 'spot' ? (
                // Spot Trading Table
                <table className="min-w-[800px] divide-y divide-border w-full">
                  <thead className="bg-muted/50">
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 text-left">Side</th>
                      <th className="px-4 py-2 text-left">Coin</th>
                      <th className="px-4 py-2 text-left">Size</th>
                      <th className="px-4 py-2 text-left">Entry / Current</th>
                      <th className="px-4 py-2 text-left">Current Value</th>
                      <th className="px-4 py-2 text-left">Unreal P&L</th>
                      <th className="px-4 py-2 text-left">Portfolio %</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-xs text-muted-foreground">
                    {snapshot.positions.map((position, idx) => {
                      const portfolioPercent =
                        position.percentage !== undefined && position.percentage !== null
                          ? position.percentage * 100
                          : null
                      const unrealizedDecimals =
                        Math.abs(position.unrealized_pnl) < 1 ? 4 : 2
                      return (
                        <tr key={`${position.symbol}-${idx}`}>
                          <td className="px-4 py-2 font-semibold text-foreground">{position.side}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2 font-semibold text-foreground">
                              {renderSymbolBadge(position.symbol, 'sm')}
                              {position.symbol}
                            </div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{position.market}</div>
                          </td>
                          <td className="px-4 py-2">
                            <FlipNumber value={position.quantity} decimals={4} />
                          </td>
                          <td className="px-4 py-2">
                            <div className="text-foreground font-semibold">
                              <FlipNumber value={position.avg_cost} prefix="$" decimals={2} />
                            </div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              <FlipNumber value={position.current_price} prefix="$" decimals={2} />
                            </div>
                          </td>
                          <td className="px-4 py-2">
                            <FlipNumber value={position.current_value} prefix="$" decimals={2} />
                          </td>
                          <td className={`px-4 py-2 font-semibold ${position.unrealized_pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            <FlipNumber value={position.unrealized_pnl} prefix="$" decimals={unrealizedDecimals} />
                          </td>
                          <td className="px-4 py-2">
                            {portfolioPercent !== null ? `${portfolioPercent.toFixed(2)}%` : '—'}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => onClosePosition?.(snapshot.account_id, position.id, position.symbol)}
                              disabled={loading}
                              className="text-xs h-8 w-20"
                            >
                              Close
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                // Futures Trading Table
                <table className="min-w-[980px] divide-y divide-border w-full">
                  <thead className="bg-muted/50">
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-2 text-left">Side</th>
                      <th className="px-4 py-2 text-left">Coin</th>
                      <th className="px-4 py-2 text-left">Size</th>
                      <th className="px-4 py-2 text-left">Entry / Current</th>
                      <th className="px-4 py-2 text-left">Leverage</th>
                      <th className="px-4 py-2 text-left">Margin Used</th>
                      <th className="px-4 py-2 text-left">Notional</th>
                      <th className="px-4 py-2 text-left">Current Value</th>
                      <th className="px-4 py-2 text-left">Unreal P&L</th>
                      <th className="px-4 py-2 text-left">Portfolio %</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-xs text-muted-foreground">
                    {snapshot.positions.map((position, idx) => {
                      const leverageLabel =
                        position.leverage && position.leverage > 0
                          ? `${position.leverage.toFixed(2)}x`
                          : '—'
                      const marginUsed = position.margin_used ?? 0
                      const roePercent =
                        position.return_on_equity !== undefined && position.return_on_equity !== null
                          ? position.return_on_equity * 100
                          : null
                      const portfolioPercent =
                        position.percentage !== undefined && position.percentage !== null
                          ? position.percentage * 100
                          : null
                      const unrealizedDecimals =
                        Math.abs(position.unrealized_pnl) < 1 ? 4 : 2
                      return (
                        <tr key={`${position.symbol}-${idx}`}>
                          <td className="px-4 py-2 font-semibold text-foreground">{position.side}</td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2 font-semibold text-foreground">
                              {renderSymbolBadge(position.symbol, 'sm')}
                              {position.symbol}
                            </div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{position.market}</div>
                          </td>
                          <td className="px-4 py-2">
                            <FlipNumber value={position.quantity} decimals={4} />
                          </td>
                          <td className="px-4 py-2">
                            <div className="text-foreground font-semibold">
                              <FlipNumber value={position.avg_cost} prefix="$" decimals={2} />
                            </div>
                            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              <FlipNumber value={position.current_price} prefix="$" decimals={2} />
                            </div>
                          </td>
                          <td className="px-4 py-2">{leverageLabel}</td>
                          <td className="px-4 py-2">
                            <FlipNumber value={marginUsed} prefix="$" decimals={2} />
                          </td>
                          <td className="px-4 py-2">
                            <FlipNumber value={position.notional} prefix="$" decimals={2} />
                          </td>
                          <td className="px-4 py-2">
                            <FlipNumber value={position.current_value} prefix="$" decimals={2} />
                          </td>
                          <td className={`px-4 py-2 font-semibold ${position.unrealized_pnl >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            <div>
                              <FlipNumber value={position.unrealized_pnl} prefix="$" decimals={unrealizedDecimals} />
                            </div>
                            {roePercent !== null && (
                              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                {roePercent.toFixed(2)}%
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2">
                            {portfolioPercent !== null ? `${portfolioPercent.toFixed(2)}%` : '—'}
                          </td>
                          <td className="px-4 py-2 text-right">
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => onClosePosition?.(snapshot.account_id, position.id, position.symbol)}
                              disabled={loading}
                              className="text-xs h-8 w-20"
                            >
                              Close
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
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
}

interface Position {
  id: number
  account_id?: number
  user_id?: number
  symbol: string
  name: string
  market: string
  quantity: number
  available_quantity: number
  avg_cost: number
  last_price?: number | null
  market_value?: number | null
}

interface Order {
  id: number
  order_no: string
  symbol: string
  name: string
  market: string
  side: string
  order_type: string
  price?: number
  quantity: number
  filled_quantity: number
  status: string
}

interface Trade {
  id: number
  order_id: number
  account_id?: number
  user_id?: number
  symbol: string
  name: string
  market: string
  side: string
  price: number
  quantity: number
  commission: number
  trade_time: string
}

interface AccountDataViewProps {
  overview: Overview | null
  positions: Position[]
  orders: Order[]
  trades: Trade[]
  aiDecisions: AIDecision[]
  allAssetCurves: any[]
  wsRef?: React.MutableRefObject<WebSocket | null>
  onSwitchAccount: (accountId: number) => void
  onRefreshData: () => void
  accountRefreshTrigger?: number
  showAssetCurves?: boolean
  showStrategyPanel?: boolean
  accounts?: any[]
  loadingAccounts?: boolean
}

function formatCurrency(value?: number | null, fractionDigits = 2) {
  if (value === undefined || value === null || Number.isNaN(value)) return '$0.00'
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: Math.max(2, fractionDigits),
  })}`
}

const SUPPORTED_SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE'] as const

export default function AccountDataView(props: AccountDataViewProps) {
  const {
    overview,
    positions,
    allAssetCurves,
    wsRef,
    onSwitchAccount,
    accountRefreshTrigger,
    showAssetCurves = true,
    showStrategyPanel = false,
  } = props
  const { tradingMode } = useTradingMode()
  const [selectedArenaAccount, setSelectedArenaAccount] = useState<number | 'all'>('all')
  const [globalPositionSnapshots, setGlobalPositionSnapshots] = useState<ArenaPositionsAccount[]>([])
  const [globalTrades, setGlobalTrades] = useState<ArenaTrade[]>([])
  const [loadingTrades, setLoadingTrades] = useState(false)
  const [loadingPositions, setLoadingPositions] = useState(false)
  const [realtimeTotals, setRealtimeTotals] = useState<{
    available_cash: number
    frozen_cash: number
    positions_value: number
    total_assets: number
  } | null>(null)
  const [realtimeSymbolTotals, setRealtimeSymbolTotals] = useState<Record<string, number> | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const currentAccountId = overview?.account?.id ?? null

  useEffect(() => {
    let isMounted = true

    const loadGlobalSnapshots = async () => {
      try {
        setLoadingPositions(true)
        const response = await getArenaPositions({ trading_mode: tradingMode })
        if (isMounted) {
          setGlobalPositionSnapshots(response.accounts ?? [])
        }
      } catch (err) {
        console.error('Failed to load global arena positions for overview:', err)
        toast.error('Failed to load positions')
      } finally {
        if (isMounted) {
          setLoadingPositions(false)
        }
      }
    }

    const loadGlobalTrades = async () => {
      try {
        setLoadingTrades(true)
        const response = await getArenaTrades({ limit: 100, trading_mode: tradingMode })
        if (isMounted) {
          setGlobalTrades(response.trades ?? [])
        }
      } catch (err) {
        console.error('Failed to load global arena trades for overview:', err)
      } finally {
        if (isMounted) {
          setLoadingTrades(false)
        }
      }
    }

    loadGlobalSnapshots()
    loadGlobalTrades()
    const intervalId = setInterval(() => {
      loadGlobalSnapshots()
      loadGlobalTrades()
    }, 60_000)

    return () => {
      isMounted = false
      clearInterval(intervalId)
    }
  }, [accountRefreshTrigger, tradingMode])

  useEffect(() => {
    if (!wsRef?.current) return

    const handleMessage = (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data)
        if (message?.type === 'arena_asset_update') {
          if (message.totals) {
            setRealtimeTotals({
              available_cash: Number(message.totals.available_cash ?? 0),
              frozen_cash: Number(message.totals.frozen_cash ?? 0),
              positions_value: Number(message.totals.positions_value ?? 0),
              total_assets: Number(message.totals.total_assets ?? 0),
            })
          }
          if (message.symbols) {
            const nextSymbols: Record<string, number> = {}
            Object.entries(message.symbols).forEach(([key, value]) => {
              nextSymbols[key.toUpperCase()] = Number(value ?? 0)
            })
            setRealtimeSymbolTotals(nextSymbols)
          }
        }
      } catch {
        // Ignore non-JSON messages
      }
    }

    const ws = wsRef.current
    ws.addEventListener('message', handleMessage)

    return () => {
      ws.removeEventListener('message', handleMessage)
    }
  }, [wsRef])

  // Handle refresh positions
  const handleRefreshPositions = useCallback(async () => {
    try {
      setLoadingPositions(true)
      const response = await getArenaPositions({ trading_mode: tradingMode })
      setGlobalPositionSnapshots(response.accounts ?? [])
      toast.success('Positions refreshed')
    } catch (err) {
      console.error('Failed to refresh positions:', err)
      toast.error('Failed to refresh positions')
    } finally {
      setLoadingPositions(false)
    }
  }, [tradingMode])

  // Handle close single position
  const handleClosePosition = useCallback(async (accountId: number, positionId: number, symbol: string) => {
    if (!confirm(`Are you sure you want to close position ${symbol}?`)) {
      return
    }

    try {
      setLoadingPositions(true)
      // DUMMY: Backend disabled - show toast message
      toast.success(`DUMMY: Closing position ${symbol} (backend disabled)`)
      
      // In real implementation, this would call API to close the position
      // await closePosition({ account_id: accountId, position_id: positionId, trading_mode: tradingMode })
      
      // Refresh positions after closing
      await handleRefreshPositions()
    } catch (err) {
      console.error('Failed to close position:', err)
      toast.error(`Failed to close position ${symbol}`)
    } finally {
      setLoadingPositions(false)
    }
  }, [handleRefreshPositions, tradingMode])

  // Handle close all positions
  const handleCloseAllPositions = useCallback(async () => {
    const totalPositions = globalPositionSnapshots.reduce((sum, account) => sum + account.positions.length, 0)
    
    if (totalPositions === 0) {
      toast.error('No positions to close')
      return
    }

    if (!confirm(`Are you sure you want to close all ${totalPositions} position(s)?`)) {
      return
    }

    try {
      setLoadingPositions(true)
      // DUMMY: Backend disabled - show toast message
      toast.success(`DUMMY: Closing all ${totalPositions} position(s) (backend disabled)`)
      
      // In real implementation, this would call API to close all positions
      // await closeAllPositions({ trading_mode: tradingMode })
      
      // Refresh positions after closing
      await handleRefreshPositions()
    } catch (err) {
      console.error('Failed to close all positions:', err)
      toast.error('Failed to close all positions')
    } finally {
      setLoadingPositions(false)
    }
  }, [globalPositionSnapshots, handleRefreshPositions, tradingMode])

  useEffect(() => {
    if (!currentAccountId) return
    if (selectedArenaAccount === 'all') return
    if (selectedArenaAccount !== currentAccountId) {
      setSelectedArenaAccount(currentAccountId)
    }
  }, [currentAccountId, selectedArenaAccount])

  const handleArenaAccountChange = useCallback((value: number | 'all') => {
    setSelectedArenaAccount(value)
    if (value !== 'all' && currentAccountId !== value) {
      onSwitchAccount(value)
    }
  }, [onSwitchAccount, currentAccountId])

  const handleStrategyAccountChange = useCallback((accountId: number) => {
    setSelectedArenaAccount(accountId)
    if (currentAccountId !== accountId) {
      onSwitchAccount(accountId)
    }
  }, [onSwitchAccount, currentAccountId])

  const strategyAccounts = useMemo(() => {
    if (!props.accounts || props.accounts.length === 0) return []
    return props.accounts.map((account: any) => ({
      id: account.id,
      name: account.name || account.username || `Trader ${account.id}`,
      model: account.model ?? null,
    }))
  }, [props.accounts])

  const accountPositionSummaries = useMemo(() => {
    const accountId = overview?.account?.id ?? null
    const aggregates = new Map<string, number>()

    positions.forEach((position) => {
      if (accountId && position.account_id && position.account_id !== accountId) {
        return
      }

      const marketValue =
        position.current_value ??
        position.market_value ??
        (position.last_price !== undefined && position.last_price !== null
          ? position.last_price * position.quantity
          : position.avg_cost * position.quantity)

      const symbol = position.symbol?.toUpperCase()
      if (!symbol || !SUPPORTED_SYMBOLS.includes(symbol as typeof SUPPORTED_SYMBOLS[number])) {
        return
      }

      const existing = aggregates.get(symbol) ?? 0
      aggregates.set(symbol, existing + (marketValue || 0))
    })

    return SUPPORTED_SYMBOLS.map((symbol) => ({
      symbol,
      marketValue: aggregates.get(symbol) ?? 0,
    }))
  }, [positions, overview?.account?.id])

  const globalPositionSummaries = useMemo(() => {
    if (!globalPositionSnapshots.length) {
      return []
    }

    const aggregates = new Map<string, number>()

    globalPositionSnapshots.forEach((snapshot) => {
      snapshot.positions.forEach((position: ArenaPositionItem) => {
        const symbol = position.symbol?.toUpperCase()
        if (!symbol || !SUPPORTED_SYMBOLS.includes(symbol as typeof SUPPORTED_SYMBOLS[number])) {
          return
        }
        const currentValue = Number(
          position.current_value ??
          position.notional ??
          0,
        )

        const existing = aggregates.get(symbol) ?? 0
        aggregates.set(symbol, existing + currentValue)
      })
    })

    return SUPPORTED_SYMBOLS.map((symbol) => ({
      symbol,
      marketValue: aggregates.get(symbol) ?? 0,
    }))
  }, [globalPositionSnapshots])

  const positionSummaries = useMemo(() => {
    if (realtimeSymbolTotals) {
      return SUPPORTED_SYMBOLS.map((symbol) => ({
        symbol,
        marketValue: realtimeSymbolTotals[symbol] ?? 0,
      }))
    }
    if (globalPositionSummaries.length > 0) {
      return globalPositionSummaries
    }
    return accountPositionSummaries
  }, [realtimeSymbolTotals, globalPositionSummaries, accountPositionSummaries])

  const accountPositionsValue = useMemo(() => {
    if (overview?.positions_value !== undefined && overview.positions_value !== null) {
      return overview.positions_value
    }
    return accountPositionSummaries.reduce((acc, position) => acc + position.marketValue, 0)
  }, [overview?.positions_value, accountPositionSummaries])

  const accountAvailableCash = overview?.account?.current_cash ?? 0
  const accountFrozenCash = overview?.account?.frozen_cash ?? 0
  const accountTotalAssets =
    overview?.total_assets ?? accountAvailableCash + accountFrozenCash + accountPositionsValue

  const aggregatedTotals = useMemo(() => {
    if (realtimeTotals) {
      return {
        availableCash: realtimeTotals.available_cash,
        frozenCash: realtimeTotals.frozen_cash,
        positionsValue: realtimeTotals.positions_value,
        totalAssets: realtimeTotals.total_assets,
      }
    }

    const hasGlobalSnapshots = globalPositionSnapshots.length > 0
    const accountsList = props.accounts ?? []
    const hasAccountsList = accountsList.length > 0

    const globalAvailableCash = hasGlobalSnapshots
      ? globalPositionSnapshots.reduce(
          (acc, snapshot) => acc + (snapshot.available_cash ?? 0),
          0,
        )
      : 0

    const globalPositionsValue = hasGlobalSnapshots
      ? globalPositionSnapshots.reduce((acc, snapshot) => {
          // Use positions_value from API if available (Hyperliquid provides accurate real-time value)
          // Otherwise fall back to summing individual position values
          const snapshotTotal = snapshot.positions_value !== undefined
            ? snapshot.positions_value
            : snapshot.positions.reduce((sum, position: ArenaPositionItem) => {
                const currentValue = Number(
                  position.current_value ?? position.notional ?? 0,
                )
                return sum + currentValue
              }, 0)
          return acc + snapshotTotal
        }, 0)
      : 0

    const globalFrozenCash = hasAccountsList
      ? accountsList.reduce(
          (acc: number, account: any) => acc + Number(account.frozen_cash ?? 0),
          0,
        )
      : 0

    if (!hasGlobalSnapshots && !hasAccountsList) {
      return {
        availableCash: accountAvailableCash,
        frozenCash: accountFrozenCash,
        positionsValue: accountPositionsValue,
        totalAssets: accountTotalAssets,
      }
    }

    const availableCashTotal = hasGlobalSnapshots ? globalAvailableCash : accountAvailableCash
    const positionsValueTotal = hasGlobalSnapshots ? globalPositionsValue : accountPositionsValue
    const frozenCashTotal = hasAccountsList ? globalFrozenCash : (hasGlobalSnapshots ? 0 : accountFrozenCash)
    const totalAssetsTotal = availableCashTotal + frozenCashTotal + positionsValueTotal

    return {
      availableCash: availableCashTotal,
      frozenCash: frozenCashTotal,
      positionsValue: positionsValueTotal,
      totalAssets: totalAssetsTotal,
    }
  }, [
    globalPositionSnapshots,
    props.accounts,
    accountAvailableCash,
    accountFrozenCash,
    accountPositionsValue,
    accountTotalAssets,
    realtimeTotals,
  ])

  if (!overview) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading account data...</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col space-y-6 min-h-0">

      {/* Main Content */}
      <div className={`grid gap-6 ${showAssetCurves ? 'grid-cols-4' : 'grid-cols-1'} h-full min-h-0 items-start`}>
          {/* Asset Curves */}
          {showAssetCurves && (
            <div className="col-span-3 min-h-0 flex flex-col gap-4">
              <div className="h-[75vh] min-h-[320px] max-h-[800px] min-w-[400px] max-w-full border border-border rounded-lg bg-card shadow-sm px-4 py-3 flex flex-col gap-4">
                <AssetCurveWithData
                  data={allAssetCurves}
                  wsRef={wsRef}
                  highlightAccountId={selectedArenaAccount}
                  onHighlightAccountChange={handleArenaAccountChange}
                />
              </div>
              {/* DUMMY DATA - Always show Hyperliquid disabled message */}
              <HyperliquidSummary
                accountId={overview?.account?.id || 1}
                refreshKey={accountRefreshTrigger}
              />
              {/* Positions and Completed Trades section moved below chart */}
              <Tabs defaultValue="positions" className="flex-1 flex flex-col min-h-0">
                <TabsList className="grid grid-cols-2 gap-0 border border-border bg-muted text-foreground">
                  <TabsTrigger value="positions" className="data-[state=active]:bg-background data-[state=active]:text-foreground border-r border-border text-[10px] md:text-xs">
                    POSITIONS
                  </TabsTrigger>
                  <TabsTrigger value="completed-trades" className="data-[state=active]:bg-background data-[state=active]:text-foreground text-[10px] md:text-xs">
                    COMPLETED TRADES
                  </TabsTrigger>
                </TabsList>
                <div className="flex-1 border border-t-0 border-border bg-card min-h-0 flex flex-col overflow-hidden">
                  <TabsContent value="positions" className="flex-1 h-0 overflow-y-auto mt-0">
                    <PositionsSectionComponent
                      refreshKey={accountRefreshTrigger}
                      selectedAccount={selectedArenaAccount}
                      positions={globalPositionSnapshots}
                      loading={loadingPositions}
                      onRefresh={handleRefreshPositions}
                      onCloseAll={handleCloseAllPositions}
                      onClosePosition={handleClosePosition}
                    />
                  </TabsContent>
                  <TabsContent value="completed-trades" className="flex-1 h-0 overflow-y-auto mt-0">
                    <CompletedTradesSectionComponent
                      refreshKey={accountRefreshTrigger}
                      selectedAccount={selectedArenaAccount}
                      trades={globalTrades}
                      loading={loadingTrades}
                    />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          )}
          
          {/* Always show HyperliquidSummary even if showAssetCurves is false */}
          {!showAssetCurves && (
            <HyperliquidSummary
              accountId={overview?.account?.id || 1}
              refreshKey={accountRefreshTrigger}
            />
          )}

          {/* Tabs and Strategy Panel */}
          <div className={`${showAssetCurves ? 'col-span-1' : 'col-span-1'} min-h-0 flex flex-col gap-4`}>
          {/* Model Chat */}
          <div className={`h-[75vh] min-h-[320px] max-h-[800px] min-w-0 overflow-hidden border border-border rounded-lg bg-card shadow-sm px-4 py-3 flex flex-col gap-4`}>
            {showAssetCurves ? (
              <AlphaArenaFeed
                refreshKey={accountRefreshTrigger}
                wsRef={wsRef}
                selectedAccount={selectedArenaAccount}
                onSelectedAccountChange={handleArenaAccountChange}
              />
            ) : (
              <ArenaAnalyticsFeed
                refreshKey={accountRefreshTrigger}
                selectedAccount={selectedArenaAccount}
                onSelectedAccountChange={handleArenaAccountChange}
              />
            )}
          </div>

          {showStrategyPanel && overview?.account && (
            <div className="overflow-hidden min-h-0">
              <StrategyPanel
                accountId={overview.account.id}
                accountName={overview.account.name}
                refreshKey={accountRefreshTrigger}
                accounts={strategyAccounts}
                onAccountChange={handleStrategyAccountChange}
                accountsLoading={props.loadingAccounts}
              />
            </div>
          )}

          {/* Start Trade Button, Settings Icon, and Account Information */}
          {showAssetCurves && (
            <div className="flex flex-col gap-4 flex-1 min-h-0 border border-border rounded-lg bg-card shadow-sm px-4 py-3">
              {/* Buttons */}
              <div className="flex items-center gap-3">
                <Button 
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={() => {
                    // Handle start trade action
                    console.log('Start trade clicked')
                  }}
                >
                  Start Trade
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10"
                  onClick={() => setIsSettingsOpen(true)}
                >
                  <Settings className="h-5 w-5" />
                </Button>
              </div>

              {/* Cash Available, Frozen Cash, Positions Value, Total Assets */}
              <div className="space-y-6">
                {/* Cash Available and Frozen Cash */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Cash Available</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Cash Available</span>
                      <span className="text-sm font-medium text-foreground">
                        <FlipNumber value={8500} prefix="$" decimals={2} />
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Frozen Cash</span>
                      <span className="text-sm font-medium text-foreground">
                        <FlipNumber value={0} prefix="$" decimals={2} />
                      </span>
                    </div>
                  </div>
                </div>

                {/* Positions Value and Total Assets */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Positions Value</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Positions Value</span>
                      <span className="text-sm font-medium text-foreground">
                        <FlipNumber value={6150} prefix="$" decimals={2} />
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Total Assets</span>
                      <span className="text-sm font-medium text-foreground">
                        <FlipNumber value={14650} prefix="$" decimals={2} />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

      {/* Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trading Settings</DialogTitle>
            <DialogDescription>
              Configure your trading parameters and preferences.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              Settings content will go here...
            </p>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  )
}

