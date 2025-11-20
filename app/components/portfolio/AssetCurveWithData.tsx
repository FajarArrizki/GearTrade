import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import { Card } from '@/components/ui/card'
import { getModelChartLogo } from './logoAssets'
import { useTradingMode } from '@/contexts/TradingModeContext'

interface AssetCurveData {
  timestamp?: number
  datetime_str?: string
  date?: string
  account_id: number
  total_assets: number
  cash: number
  positions_value: number
  is_initial?: boolean
  user_id: number
  username: string
}

interface AssetCurveProps {
  data?: AssetCurveData[]
  wsRef?: React.MutableRefObject<WebSocket | null>
  highlightAccountId?: number | 'all'
  onHighlightAccountChange?: (accountId: number | 'all') => void
}

type Timeframe = '5m' | '1h' | '1d'
const DEFAULT_TIMEFRAME: Timeframe = '5m'
const CACHE_STALE_MS = 45_000

const TIME_RANGE_OPTIONS = [
  { id: 'all', label: 'ALL' },
  { id: '24h', label: '24H' },
] as const

type TimeRange = typeof TIME_RANGE_OPTIONS[number]['id']

const TIME_RANGE_MS: Record<Exclude<TimeRange, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
}

const formatDisplayValue = (value: number, mode: 'balance' | 'percentage'): string => {
  if (mode === 'percentage') {
    const sign = value >= 0 ? '+' : ''
    return `${sign}${value.toFixed(2)}%`
  }

  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`

  if (value >= 1_000) {
    const thousands = value / 1_000
    const precision =
      value % 1_000 === 0
        ? 0
        : thousands >= 100
          ? 0
          : thousands >= 10
            ? 1
            : 2
    return `$${thousands.toFixed(precision)}K`
  }

  return `$${value.toFixed(0)}`
}

const parsePointTimestamp = (value?: string | number): number | null => {
  if (value == null) return null
  if (typeof value === 'number') {
    return value <= 10_000_000_000 ? value * 1000 : value
  }
  if (/^\d+$/.test(value)) {
    const numeric = Number(value)
    return value.length <= 10 ? numeric * 1000 : numeric
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

interface TimeframeCacheEntry {
  data: AssetCurveData[]
  lastFetched: number
  initialized: boolean
}

export default function AssetCurve({
  data: initialData,
  wsRef,
  highlightAccountId,
  onHighlightAccountChange
}: AssetCurveProps) {
  const { tradingMode } = useTradingMode()
  const prevTradingMode = useRef(tradingMode)
  const timeframe: Timeframe = DEFAULT_TIMEFRAME
  // Backend disabled - initialize with initialData if available
  const [data, setData] = useState<AssetCurveData[]>(initialData && initialData.length > 0 ? initialData : [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, setIsInitialized] = useState(initialData && initialData.length > 0 ? true : false)
  const cacheRef = useState(new Map<string, TimeframeCacheEntry>())[0]
  const [liveAccountTotals, setLiveAccountTotals] = useState<Map<number, number>>(new Map())
  const [logoPulseMap, setLogoPulseMap] = useState<Map<number, number>>(new Map())
  const [hoveredAccountId, setHoveredAccountId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<'balance' | 'percentage'>('balance')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')

  const storeCache = useCallback((tf: Timeframe, nextData: AssetCurveData[]) => {
    const cacheKey = `${tf}_${tradingMode}`
    cacheRef.set(cacheKey, {
      data: nextData,
      lastFetched: Date.now(),
      initialized: true,
    })
  }, [cacheRef, tradingMode])

  const primeFromCache = useCallback((tf: Timeframe) => {
    const cacheKey = `${tf}_${tradingMode}`
    const cached = cacheRef.get(cacheKey)
    if (!cached) return false
    setData(cached.data)
    setLoading(false)
    setError(null)
    setIsInitialized(prev => prev || cached.initialized)
    return true
  }, [cacheRef, tradingMode])

  // Listen for WebSocket asset curve updates
  useEffect(() => {
    if (!wsRef?.current) return

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg?.type === 'arena_asset_update' && msg.accounts) {
          const accountsToPulse: number[] = []
          setLiveAccountTotals((prev) => {
            const next = new Map(prev)
            ;(msg.accounts as Array<{ account_id: number; total_assets?: number }>).forEach(
              (account) => {
                if (account?.account_id == null) {
                  return
                }
                const nextValue = Number(account.total_assets ?? 0)
                const previousValue = prev.get(account.account_id)
                if (previousValue !== undefined && previousValue !== nextValue) {
                  accountsToPulse.push(account.account_id)
                }
                next.set(account.account_id, nextValue)
              },
            )
            return next
          })
          if (accountsToPulse.length) {
            setLogoPulseMap((prev) => {
              const updated = new Map(prev)
              accountsToPulse.forEach((accountId) => {
                const current = updated.get(accountId) ?? 0
                updated.set(accountId, current + 1)
              })
              return updated
            })
          }
        }
        if (msg.type === 'asset_curve_data' || msg.type === 'asset_curve_update') {
          const tf = (msg.timeframe as Timeframe) ?? timeframe
          const nextData = msg.data || []
          storeCache(tf, nextData)
          if (tf === timeframe) {
            setData(nextData)
            if (msg.type === 'asset_curve_data') {
              setLoading(false)
              setError(null)
            }
            setIsInitialized(true)
          }
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err)
      }
    }

    wsRef.current.addEventListener('message', handleMessage)

    return () => {
      wsRef.current?.removeEventListener('message', handleMessage)
    }
  }, [wsRef, timeframe, storeCache])

  // Clear data when trading mode changes
  useEffect(() => {
    if (prevTradingMode.current !== null && prevTradingMode.current !== tradingMode) {
      setData([])
      setLiveAccountTotals(new Map())
      cacheRef.clear()
    }
    prevTradingMode.current = tradingMode
  }, [tradingMode, cacheRef])

  // Backend disabled - update data when initialData changes
  useEffect(() => {
    if (initialData && initialData.length > 0) {
      // Always use initialData when available (backend disabled)
      setData(initialData)
      setIsInitialized(true)
      setLoading(false)
      setError(null)
    }
  }, [initialData])

  // Request data when timeframe or trading_mode changes
  useEffect(() => {
    const cacheKey = `${timeframe}_${tradingMode}`
    const cached = cacheRef.get(cacheKey)
    const isFresh = cached ? Date.now() - cached.lastFetched < CACHE_STALE_MS : false
    const hadCache = primeFromCache(timeframe)

    if (isFresh) return

    // Backend disabled - use initialData directly if WebSocket not available
    const isWebSocketAvailable = wsRef?.current && wsRef.current.readyState === WebSocket.OPEN
    
    if (!isWebSocketAvailable && initialData && initialData.length > 0) {
      // Use initialData when WebSocket is not available (backend disabled)
      setData(initialData)
      setIsInitialized(true)
      setLoading(false)
      setError(null)
      if (!hadCache) {
        storeCache(timeframe, initialData)
      }
      return
    }

    if (isWebSocketAvailable && wsRef.current) {
      if (!hadCache) setLoading(true)
      setError(null)
      wsRef.current.send(JSON.stringify({
        type: 'get_asset_curve',
        timeframe,
        trading_mode: tradingMode,
      }))
    } else if (!hadCache && initialData && initialData.length > 0) {
      setData(initialData)
      setIsInitialized(true)
      storeCache(timeframe, initialData)
    }
  }, [timeframe, tradingMode, wsRef, initialData, primeFromCache, storeCache, cacheRef])

  if (!data || data.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center h-96">
          <div className="text-muted-foreground">
            {loading ? 'Loading...' : error || 'No asset data available'}
          </div>
        </div>
      </Card>
    )
  }

  const colors = [
    '#f7931a', '#627eea', '#9945ff', '#f3ba2f', '#23292f', '#c2a633',
    '#000000', '#333333'
  ]

  // Split processedData into stable and live parts to reduce re-renders
  const baseProcessedData = useMemo(() => {
    if (!data || data.length === 0) {
      return { chartData: [], accountSummaries: [], uniqueUsers: [], userAccountMap: new Map() }
    }

    const uniqueUsers = Array.from(new Set(data.map(item => item.username))).sort()
    const userAccountMap = new Map<string, number | undefined>()

    const groupedData = data.reduce((acc, item) => {
      const key = item.datetime_str || item.date || item.timestamp?.toString() || ''
      if (!acc[key]) acc[key] = { timestamp: key }

      const accountId = item.account_id
      if (!userAccountMap.has(item.username)) {
        userAccountMap.set(item.username, accountId)
      }

      acc[key][item.username] = item.total_assets ?? null
      return acc
    }, {} as Record<string, any>)

    const parseTimestamp = (value: string) => {
      if (/^\d+$/.test(value)) {
        const numeric = Number(value)
        const milliseconds = value.length <= 10 ? numeric * 1000 : numeric
        return new Date(milliseconds)
      }
      return new Date(value)
    }

    const timestamps = Object.keys(groupedData).sort((a, b) => {
      const dateA = parseTimestamp(a).getTime()
      const dateB = parseTimestamp(b).getTime()
      return dateA - dateB
    })

    const chartData = timestamps.map((ts) => {
      const date = parseTimestamp(ts)
      const formattedTime = date.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })

      const dataPoint: Record<string, number | null | string> = {
        timestamp: ts,
        formattedTime,
      }
      
      uniqueUsers.forEach((username) => {
        dataPoint[username] = groupedData[ts][username] ?? null
      })

      return dataPoint
    })

    const accountSummaries = uniqueUsers.map((username) => {
      const latestData = data
        .filter((item) => item.username === username)
        .sort((a, b) => {
          const dateA = new Date(a.datetime_str || a.date || 0).getTime()
          const dateB = new Date(b.datetime_str || b.date || 0).getTime()
          return dateB - dateA
        })[0]

      return {
        username,
        assets: latestData?.total_assets || 0,
        accountId: latestData?.account_id,
        logo: getModelChartLogo(username),
      }
    })

    return { chartData, accountSummaries, uniqueUsers, userAccountMap }
  }, [data, timeframe])

  // Apply live updates to the last data point only and convert to percentage if needed
  const processedData = useMemo(() => {
    const { chartData, accountSummaries, uniqueUsers, userAccountMap } = baseProcessedData

    // Create a copy of chartData and update only the last point with live data
    const updatedChartData = [...chartData]
    if (updatedChartData.length > 0) {
      const lastPoint = { ...updatedChartData[updatedChartData.length - 1] }
      uniqueUsers.forEach((username) => {
        const accountId = userAccountMap.get(username)
        if (accountId !== undefined && accountId !== null) {
          const liveOverride = liveAccountTotals.get(accountId)
          if (liveOverride !== undefined) {
            lastPoint[username] = liveOverride
          }
        }
      })
      updatedChartData[updatedChartData.length - 1] = lastPoint
    }

    // Convert to percentage if viewMode is percentage
    let finalChartData: Record<string, number | null | string>[] = updatedChartData
    if (viewMode === 'percentage' && updatedChartData.length > 0) {
      // Calculate baseline (first value) for each user
      const baselines = new Map<string, number>()
      uniqueUsers.forEach((username) => {
        const firstValue = updatedChartData.find(point => 
          typeof (point as Record<string, any>)[username] === 'number' && (point as Record<string, any>)[username] !== null
        )?.[username] as number | undefined
        if (typeof firstValue === 'number') {
          baselines.set(username, firstValue)
        }
      })

      // Convert all values to percentage change from baseline
      finalChartData = updatedChartData.map(point => {
        const convertedPoint: Record<string, number | null | string> = { ...point }
        uniqueUsers.forEach((username) => {
          const value = (point as Record<string, any>)[username] as number | null | undefined
          const baseline = baselines.get(username)
          if (typeof value === 'number' && typeof baseline === 'number' && baseline > 0) {
            convertedPoint[username] = ((value - baseline) / baseline) * 100
          } else {
            convertedPoint[username] = null
          }
        })
        return convertedPoint
      })
    }

    // Update account summaries with live data
    const updatedAccountSummaries = accountSummaries.map(account => {
      const liveOverride = account.accountId !== undefined ? liveAccountTotals.get(account.accountId) : undefined
      return {
        ...account,
        assets: liveOverride ?? account.assets
      }
    })

    return {
      chartData: finalChartData,
      accountSummaries: updatedAccountSummaries,
      uniqueUsers
    }
  }, [baseProcessedData, liveAccountTotals, viewMode])

  const { chartData, accountSummaries, uniqueUsers } = processedData

  const activeChartData = useMemo(() => {
    if (!chartData.length || timeRange === 'all') return chartData
    const rangeMs = TIME_RANGE_MS[timeRange as Exclude<TimeRange, 'all'>]
    if (!rangeMs) return chartData
    const now = Date.now()
    const filtered = chartData.filter((point) => {
      const ts = parsePointTimestamp(point.timestamp as string | number | undefined)
      if (!ts) return false
      return now - ts <= rangeMs
    })
    return filtered.length ? filtered : chartData
  }, [chartData, timeRange])

  const handleLegendClick = useCallback((accountId: number | 'all') => {
    if (!onHighlightAccountChange) return
    const current = highlightAccountId ?? 'all'
    if (current === accountId) {
      onHighlightAccountChange('all')
    } else {
      onHighlightAccountChange(accountId)
    }
  }, [onHighlightAccountChange, highlightAccountId])

  const handleChartClick = useCallback(() => {
    if (highlightAccountId && highlightAccountId !== 'all') {
      onHighlightAccountChange?.('all')
    }
  }, [highlightAccountId, onHighlightAccountChange])

  const activeLegendAccountId =
    highlightAccountId && highlightAccountId !== 'all' ? highlightAccountId : null

  // Calculate Y-axis domain with single trader scaling
  const yAxisDomain = useMemo(() => {
    if (!activeChartData.length) return viewMode === 'percentage' ? [-50, 50] : [0, 100000]

    let min = Infinity
    let max = -Infinity

    // If single trader is selected, only consider that trader's data
    const usersToConsider = activeLegendAccountId
      ? uniqueUsers.filter(username => {
          const account = accountSummaries.find(acc => acc.username === username)
          return account?.accountId === activeLegendAccountId
        })
      : uniqueUsers

    activeChartData.forEach(point => {
      usersToConsider.forEach(username => {
        const value = (point as Record<string, any>)[username] as number | null | undefined
        if (typeof value === 'number' && !isNaN(value)) {
          min = Math.min(min, value)
          max = Math.max(max, value)
        }
      })
    })

    if (min === Infinity || max === -Infinity) {
      return viewMode === 'percentage' ? [-50, 50] : [0, 100000]
    }

    // Use different padding for single trader vs all traders view
    const range = max - min
    const paddingPercent = activeLegendAccountId ? 0.15 : 0.05 // 15% for single trader, 5% for all traders
    const padding = viewMode === 'percentage' 
      ? Math.max(range * paddingPercent, 5) // 5% minimum padding for percentage
      : Math.max(range * paddingPercent, 50)

    const paddedMin = viewMode === 'percentage' ? min - padding : Math.max(0, min - padding)
    const paddedMax = max + padding

    return [paddedMin, paddedMax]
  }, [activeChartData, uniqueUsers, activeLegendAccountId, accountSummaries, highlightAccountId, viewMode])

  const accountMeta = useMemo(() => {
    const meta = new Map<string, { accountId?: number; color: string; logo?: { src: string; alt: string; color?: string } }>()
    uniqueUsers.forEach((username, index) => {
      const account = accountSummaries.find(acc => acc.username === username)
      const chartLogo = getModelChartLogo(username)
      const color = chartLogo.color || colors[index % colors.length]
      meta.set(username, {
        accountId: account?.accountId,
        color,
        logo: account?.logo,
      })
    })
    return meta
  }, [uniqueUsers, accountSummaries])

  const renderTerminalDot = useCallback((username: string, color: string) => {
    const meta = accountMeta.get(username)
    const accountId = meta?.accountId
    const logo = meta?.logo

    return (props: { cx?: number; cy?: number; index?: number; value?: number; payload?: any }) => {
      const { cx, cy, index, value } = props
      if (cx == null || cy == null || index == null || index !== activeChartData.length - 1) {
        return <g />
      }
      if (!meta || !logo) return <g />

      // Single trader view: hide others completely
      if (activeLegendAccountId && accountId !== activeLegendAccountId) {
        return <g />
      }

      const isHovered = hoveredAccountId === accountId
      const shouldHighlight = !hoveredAccountId || isHovered
      const pulseIteration = accountId != null ? logoPulseMap.get(accountId) ?? 0 : 0

      const size = 32 // 固定大小，不再缩放
      const logoX = cx - size / 2
      const logoY = cy - size / 2
      const labelX = cx + size / 2 + 2
      const labelY = cy - 15

      const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!meta.accountId) return
        handleLegendClick(meta.accountId)
      }

      const handleMouseEnter = () => {
        if (meta.accountId) setHoveredAccountId(meta.accountId)
      }

      const handleMouseLeave = () => {
        setHoveredAccountId(null)
      }

      return (
        <g>
          {pulseIteration > 0 && (
            <circle
              cx={cx}
              cy={cy}
              r={size / 2}
              fill={color}
              className="pointer-events-none animate-ping-logo"
            />
          )}
          <foreignObject
            x={logoX}
            y={logoY}
            width={size}
            height={size}
            style={{ overflow: 'visible', pointerEvents: 'auto' }}
          >
            <div
              style={{
                width: size,
                height: size,
                borderRadius: '50%',
                opacity: shouldHighlight ? 1 : 0.4,
                cursor: meta.accountId ? 'pointer' : 'default',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: color,
              }}
              onClick={handleClick}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <img
                src={logo.src}
                alt={logo.alt}
                style={{
                  width: size - 6,
                  height: size - 6,
                  borderRadius: '50%',
                  objectFit: 'contain',
                }}
              />
            </div>
          </foreignObject>

          <foreignObject
            x={labelX}
            y={labelY}
            width={110}
            height={22}
            style={{ overflow: 'visible', pointerEvents: 'none' }}
          >
            <div
              className="px-3 py-0.5 text-[11px] font-semibold tracking-[0.08em]"
              style={{
                backgroundColor: color,
                color: '#fff',
                boxShadow: '0 6px 12px rgba(0,0,0,0.16)',
                opacity: shouldHighlight ? 1 : 0.45,
                borderRadius: '9999px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                whiteSpace: 'nowrap',
                minWidth: '72px',
                maxWidth: '100px',
              }}
            >
              {formatDisplayValue(typeof value === 'number' ? value : 0, viewMode)}
            </div>
          </foreignObject>
        </g>
      )
    }
  }, [accountMeta, activeChartData.length, activeLegendAccountId, logoPulseMap, handleLegendClick, hoveredAccountId, viewMode])

  // Custom Cursor Component (vertical dashed line)
  const CustomCursor = useCallback(({ points, height }: any) => {
    if (!points || points.length === 0) return null
    const point = points[0]
    const chartHeight = height || 600 // Use provided height or default
    const color = '#2DA987' // Default teal color (can be made dynamic if needed)
    
    return (
      <line
        x1={point.x}
        y1={0}
        x2={point.x}
        y2={chartHeight}
        stroke={color}
        strokeWidth={1}
        strokeDasharray="4 4"
        opacity={0.5}
      />
    )
  }, [])

  // Custom Tooltip Component
  const CustomTooltip = useCallback(({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null

    const data = payload[0]
    const value = data?.value
    // Get color from the line data, fallback to default teal
    const color = data?.color || '#2DA987'

    if (typeof value !== 'number') return null

    const displayValue = formatDisplayValue(value, viewMode)

    return (
      <div
        style={{
          backgroundColor: color,
          color: '#ffffff',
          padding: '4px 12px',
          borderRadius: '6px',
          fontSize: '12px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          display: 'inline-block',
        }}
      >
        {displayValue}
      </div>
    )
  }, [viewMode])

  return (
    <div className="h-full min-h-[320px] max-h-[800px] min-w-[400px] max-w-full flex flex-col m-[1px]">
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 relative min-h-[300px] max-h-[780px]">
          {/* View Mode Toggle - Top Left */}
          {!loading && activeChartData.length > 0 && (
            <div
              className="absolute z-10 flex items-center justify-between pointer-events-none"
              style={{ top: '0px', left: '0px', right: '0px' }}
            >
              <div className="pointer-events-auto">
                <div className="flex border border-black rounded-md overflow-hidden bg-white shadow-sm">
                  <button
                    onClick={() => setViewMode('balance')}
                    className={`px-3 py-1 text-xs font-semibold tracking-[0.15em] transition-colors uppercase ${
                      viewMode === 'balance'
                        ? 'bg-white text-black'
                        : 'bg-black text-white'
                    }`}
                    title="View in Balance"
                  >
                    $
                  </button>
                  <button
                    onClick={() => setViewMode('percentage')}
                    className={`px-3 py-1 text-xs font-semibold tracking-[0.15em] transition-colors uppercase ${
                      viewMode === 'percentage'
                        ? 'bg-white text-black'
                        : 'bg-black text-white'
                    }`}
                    title="View in Percentage"
                  >
                    %
                  </button>
                </div>
              </div>

              <p className="text-[11px] font-black tracking-[0.35em] uppercase text-center whitespace-nowrap">
                Average Total Account Value
              </p>

              <div className="pointer-events-auto">
                <div className="flex border border-black rounded-md overflow-hidden bg-white shadow-sm">
                  {TIME_RANGE_OPTIONS.map((option) => {
                    const isActive = timeRange === option.id
                    return (
                      <button
                        key={option.id}
                        onClick={() => setTimeRange(option.id)}
                        className={`px-3 py-1 text-xs font-semibold tracking-[0.15em] transition-colors uppercase ${
                          isActive ? 'bg-black text-white' : 'bg-white text-black'
                        }`}
                        title={`Show ${option.label} data`}
                      >
                        {option.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-muted-foreground">Loading...</div>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                <LineChart
                  data={activeChartData}
                  margin={{ top: 50, right: 100, left: 1, bottom: 1 }}
                  onClick={handleChartClick}
                  onMouseLeave={() => setHoveredAccountId(null)}
                  style={{ outline: 'none' }}
                  tabIndex={-1}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" strokeWidth={0.5} />
                  <XAxis
                    dataKey="formattedTime"
                    stroke="#333333"
                    fontSize={12}
                    tickMargin={5}
                    interval={Math.ceil(activeChartData.length / 6)}
                  />
                  <YAxis
                    stroke="#333333"
                    fontSize={12}
                    domain={yAxisDomain}
                    tickMargin={10}
                    minTickGap={20}
                    tickFormatter={(value) => {
                      const num = Number(value)
                      return formatDisplayValue(num, viewMode)
                    }}
                  />
                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={<CustomCursor />}
                  />
                  {uniqueUsers
                    .filter(username => {
                      if (!activeLegendAccountId) return true
                      const account = accountSummaries.find(acc => acc.username === username)
                      return account?.accountId === activeLegendAccountId
                    })
                    .map((username) => {
                      const meta = accountMeta.get(username)
                      const color = meta?.color || '#666666'
                      const accountId = meta?.accountId
                      const isHovered = hoveredAccountId === accountId
                      const isHighlighted = !hoveredAccountId || isHovered

                      return (
                        <Line
                          key={username}
                          type="monotone"
                          dataKey={username}
                          stroke={color}
                          strokeWidth={isHighlighted ? 2.5 : 1}
                          dot={renderTerminalDot(username, color)}
                          activeDot={false}
                          connectNulls={false}
                          name={(username || 'NA').replace('default_', '').toUpperCase()}
                          strokeOpacity={isHighlighted ? 1 : 0.3}
                          isAnimationActive={false}
                          onMouseEnter={() => accountId && setHoveredAccountId(accountId)}
                          onMouseLeave={() => setHoveredAccountId(null)}
                          onClick={() => accountId && handleLegendClick(accountId)}
                        />
                      )
                    })}
                </LineChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>


    </div>
  )
}
