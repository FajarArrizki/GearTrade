import React, { useEffect, useRef } from 'react'

interface TickerItem {
  symbol: string
  price: number
  changePercent: number
}

const TICKER_DATA: TickerItem[] = [
  { symbol: 'BTCUSDT', price: 61076.83, changePercent: 0.25 },
  { symbol: 'ETHUSDT', price: 3100.50, changePercent: 2.32 },
  { symbol: 'SOLUSDT', price: 150.00, changePercent: 7.81 },
  { symbol: 'BNBUSDT', price: 580.25, changePercent: 1.15 },
  { symbol: 'XRPUSDT', price: 0.62, changePercent: -0.10 },
  { symbol: 'DOGEUSDT', price: 0.085, changePercent: 0.71 },
  { symbol: '1000BONKUSDT', price: 0.010243, changePercent: 0.205 },
  { symbol: 'LISTAUSDT', price: 0.2161, changePercent: 7.996 },
  { symbol: 'ZKUSDT', price: 0.04954, changePercent: 7.81 },
  { symbol: 'TRUMPUSDT', price: 7.012, changePercent: 1.29 },
  { symbol: 'FARTCOINUSDT', price: 0.2539, changePercent: 0.71 },
  { symbol: 'ENAUSDT', price: 0.2737, changePercent: 2.32 },
  { symbol: 'MOODENGUSDT', price: 0.07826, changePercent: 0.669 },
  { symbol: 'NEIROUSDT', price: 0.0001329, changePercent: 1.373 },
  { symbol: 'BUSDT', price: 0.1601, changePercent: 10.153 },
  { symbol: 'USD1USDT', price: 0.9990, changePercent: 0.00 },
  { symbol: 'SAHARAUSDT', price: 0.08124, changePercent: 2.602 },
  { symbol: 'PUMPUSDT', price: 0.003076, changePercent: -0.10 },
  { symbol: 'AAPLUSDT', price: 266.02, changePercent: -1.00 },
]

function formatPrice(price: number): string {
  if (price >= 1000) {
    return price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }
  if (price >= 1) {
    return price.toFixed(4)
  }
  if (price >= 0.001) {
    return price.toFixed(6)
  }
  return price.toFixed(8)
}

function formatChange(change: number): string {
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}%`
}

export default function CryptoTicker() {
  const tickerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ticker = tickerRef.current
    const container = containerRef.current
    if (!ticker || !container) return

    // Wait for content to render, then start animation
    const initAnimation = () => {
      // Calculate width after content is rendered
      const firstChild = ticker.firstElementChild as HTMLElement
      if (!firstChild) {
        requestAnimationFrame(initAnimation)
        return
      }

      const tickerWidth = ticker.scrollWidth / 2
      if (tickerWidth === 0) {
        requestAnimationFrame(initAnimation)
        return
      }

      let scrollPosition = 0
      const speed = 0.5 // Adjust speed here (pixels per frame)

      const animate = () => {
        scrollPosition -= speed
        if (Math.abs(scrollPosition) >= tickerWidth) {
          scrollPosition = 0
        }
        ticker.style.transform = `translateX(${scrollPosition}px)`
        requestAnimationFrame(animate)
      }

      requestAnimationFrame(animate)
    }

    const animationId = requestAnimationFrame(initAnimation)

    return () => {
      cancelAnimationFrame(animationId)
    }
  }, [])

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t border-border overflow-hidden">
      <div ref={containerRef} className="overflow-hidden">
        <div
          ref={tickerRef}
          className="flex items-center gap-4 whitespace-nowrap"
          style={{ willChange: 'transform' }}
        >
          {/* Render twice for seamless loop */}
          {[...Array(2)].map((_, loopIndex) => (
            <React.Fragment key={loopIndex}>
              {TICKER_DATA.map((item, index) => {
                const isPositive = item.changePercent >= 0
                const isNeutral = item.changePercent === 0
                const isLast = index === TICKER_DATA.length - 1 && loopIndex === 1
                return (
                  <React.Fragment key={`${loopIndex}-${index}`}>
                    <div className="flex items-center gap-2 shrink-0 py-2">
                      <span className="text-sm font-medium text-foreground whitespace-nowrap">{item.symbol}</span>
                      <span className="text-sm text-foreground whitespace-nowrap">${formatPrice(item.price)}</span>
                      <span
                        className={`text-sm font-medium whitespace-nowrap ${
                          isNeutral
                            ? 'text-foreground'
                            : isPositive
                              ? 'text-emerald-600'
                              : 'text-red-600'
                        }`}
                      >
                        {formatChange(item.changePercent)}
                      </span>
                    </div>
                    {!isLast && <span className="text-muted-foreground shrink-0">--</span>}
                  </React.Fragment>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

