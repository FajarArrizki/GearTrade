/**
 * Live Trading Executor
 * Real order execution via Hyperliquid API
 */

import { Signal, Order, OrderStatus, OrderType, PositionState, ExitReason } from '../types'
import { fetchHyperliquid } from '../data-fetchers/hyperliquid'
import { getHyperliquidWalletApiKey, getHyperliquidAccountAddress } from '../config'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

export interface LiveExecutorConfig {
  tradesFile: string
  orderFillTimeoutMs: number
  retryOnTimeout: boolean
  maxRetries: number
}

export interface HyperliquidOrder {
  a: number // Asset index
  b: boolean // Buy or sell (true = buy)
  p: string // Price (string for precision)
  s: number // Size
  r: boolean // Reduce only
  t?: { // Order type
    limit?: { tif: 'Gtc' | 'Ioc' | 'Alo' }
  }
}

/**
 * Live executor for real trading via Hyperliquid API
 * Note: This is a placeholder - actual implementation requires EIP-712 signing
 */
export class LiveExecutor {
  private config: LiveExecutorConfig
  private pendingOrders: Map<string, Order>
  private apiErrorCount: number
  private apiRequestCount: number

  constructor(config: LiveExecutorConfig) {
    this.config = config
    this.pendingOrders = new Map()
    this.apiErrorCount = 0
    this.apiRequestCount = 0
  }

  /**
   * Execute real entry order via Hyperliquid API
   */
  async executeEntry(signal: Signal, currentPrice: number): Promise<Order> {
    const orderId = `live_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const quantity = signal.quantity || 0

    // CRITICAL FIX: Validate confidence before execution (double check)
    // Accept only signals with confidence >= 60% (range: 60% - 100%)
    // Reject signals with confidence < 60% (0% - 59.99%)
    const confidence = signal.confidence || 0
    if (confidence < 0.60) {
      console.log(`\x1b[31m❌ LIVE EXECUTOR REJECT: ${signal.coin} - Confidence ${(confidence * 100).toFixed(1)}% < 60% (too low, filter out)\x1b[0m`)
      return {
        id: orderId,
        symbol: signal.coin || '',
        side: signal.signal === 'buy_to_enter' ? 'LONG' : 'SHORT',
        type: 'MARKET',
        quantity,
        price: currentPrice,
        status: 'REJECTED',
        submittedAt: Date.now(),
        rejectedReason: `Confidence too low: ${(confidence * 100).toFixed(1)}% < 60% (minimum required: 60%)`
      }
    }

    // Pre-execution checks
    const preCheck = await this.preExecutionChecks(signal, quantity)
    if (!preCheck.passed) {
      return {
        id: orderId,
        symbol: signal.coin || '',
        side: signal.signal === 'buy_to_enter' ? 'LONG' : 'SHORT',
        type: 'MARKET',
        quantity,
        price: currentPrice,
        status: 'REJECTED',
        submittedAt: Date.now(),
        rejectedReason: preCheck.reason
      }
    }

    try {
      // Submit order to Hyperliquid
      const order = await this.submitOrder({
        symbol: signal.coin || '',
        side: signal.signal === 'buy_to_enter' ? 'LONG' : 'SHORT',
        quantity,
        type: 'MARKET',
        stopLoss: signal.stop_loss,
        takeProfit: signal.take_profit || signal.profit_target
      })

      // Wait for fill confirmation
      const filledOrder = await this.waitForFill(order, this.config.orderFillTimeoutMs)

      if (filledOrder.status === 'FILLED' || filledOrder.status === 'PARTIAL_FILLED') {
        // Save to file
        this.saveTradeToFile(filledOrder, 'ENTRY')
      }

      this.apiRequestCount++
      return filledOrder
    } catch (error) {
      this.apiErrorCount++
      const errorMsg = error instanceof Error ? error.message : String(error)
      return {
        id: orderId,
        symbol: signal.coin || '',
        side: signal.signal === 'buy_to_enter' ? 'LONG' : 'SHORT',
        type: 'MARKET',
        quantity,
        price: currentPrice,
        status: 'REJECTED',
        submittedAt: Date.now(),
        rejectedReason: `Order submission failed: ${errorMsg}`
      }
    }
  }

  /**
   * Execute real exit order via Hyperliquid API
   */
  async executeExit(
    position: PositionState,
    exitSize: number,
    exitReason: ExitReason,
    currentPrice: number
  ): Promise<Order> {
    const orderId = `live_exit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const symbol = position.symbol || position.coin || ''
    const totalQuantity = Math.abs(position.quantity)
    const closeQuantity = totalQuantity * (exitSize / 100)

    try {
      // Submit close order to Hyperliquid
      const order = await this.submitOrder({
        symbol,
        side: 'CLOSE',
        quantity: closeQuantity,
        type: 'MARKET',
        reduceOnly: true
      })

      // Wait for fill confirmation
      const filledOrder = await this.waitForFill(order, this.config.orderFillTimeoutMs)

      if (filledOrder.status === 'FILLED' || filledOrder.status === 'PARTIAL_FILLED') {
        // Save to file
        this.saveTradeToFile(filledOrder, 'EXIT', {
          exitReason,
          originalQuantity: totalQuantity,
          exitSizePct: exitSize
        })
      }

      this.apiRequestCount++
      return filledOrder
    } catch (error) {
      this.apiErrorCount++
      const errorMsg = error instanceof Error ? error.message : String(error)
      return {
        id: orderId,
        symbol,
        side: 'CLOSE',
        type: 'MARKET',
        quantity: closeQuantity,
        price: currentPrice,
        status: 'REJECTED',
        submittedAt: Date.now(),
        rejectedReason: `Exit order submission failed: ${errorMsg}`
      }
    }
  }

  /**
   * Submit order to Hyperliquid API
   * Note: This requires EIP-712 signing with wallet API key
   */
  private async submitOrder(params: {
    symbol: string
    side: 'LONG' | 'SHORT' | 'CLOSE'
    quantity: number
    type: OrderType
    stopLoss?: number
    takeProfit?: number
    reduceOnly?: boolean
  }): Promise<Order> {
    // TODO: Implement actual Hyperliquid order submission with EIP-712 signing
    // This is a placeholder - actual implementation requires:
    // 1. EIP-712 domain and message structure
    // 2. Signing with wallet private key
    // 3. Sending to /exchange endpoint

    const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // For now, return pending order (would be replaced with actual API call)
    const order: Order = {
      id: orderId,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      status: 'PENDING',
      submittedAt: Date.now(),
      stopLoss: params.stopLoss,
      takeProfit: params.takeProfit
    }

    this.pendingOrders.set(orderId, order)

    // Simulate API call (replace with actual Hyperliquid API call)
    console.warn('⚠️  Live executor: Order submission not yet implemented. Requires EIP-712 signing.')

    return order
  }

  /**
   * Wait for order fill confirmation
   */
  private async waitForFill(order: Order, timeoutMs: number): Promise<Order> {
    const startTime = Date.now()
    const pollInterval = 1000 // Poll every 1 second

    while (Date.now() - startTime < timeoutMs) {
      // TODO: Poll Hyperliquid API for order status
      // For now, simulate immediate fill
      await new Promise(resolve => setTimeout(resolve, pollInterval))

      // Check order status (would query Hyperliquid API)
      const updatedOrder = this.pendingOrders.get(order.id)
      if (updatedOrder && updatedOrder.status !== 'PENDING') {
        return updatedOrder
      }

      // Simulate fill after 2 seconds (remove in actual implementation)
      if (Date.now() - startTime > 2000) {
        return {
          ...order,
          status: 'FILLED',
          filledQuantity: order.quantity,
          filledPrice: order.price || 0,
          filledAt: Date.now()
        }
      }
    }

    // Timeout - order not filled
    if (this.config.retryOnTimeout) {
      // Retry logic would go here
      console.warn(`⚠️  Order ${order.id} timeout, retry not yet implemented`)
    }

    return {
      ...order,
      status: 'TIMEOUT',
      rejectedReason: `Order timeout after ${timeoutMs}ms`
    }
  }

  /**
   * Pre-execution checks
   */
  private async preExecutionChecks(
    signal: Signal,
    quantity: number
  ): Promise<{ passed: boolean; reason?: string }> {
    // Check API connection
    const walletApiKey = getHyperliquidWalletApiKey()
    if (!walletApiKey || walletApiKey.trim() === '') {
      return {
        passed: false,
        reason: 'Wallet API key not configured'
      }
    }

    // Check account address
    const accountAddress = getHyperliquidAccountAddress()
    if (!accountAddress) {
      return {
        passed: false,
        reason: 'Account address not configured'
      }
    }

    // TODO: Check available margin
    // TODO: Check risk limits
    // TODO: Check position limits

    return { passed: true }
  }

  /**
   * Get API error rate
   */
  getApiErrorRate(): number {
    if (this.apiRequestCount === 0) return 0
    return (this.apiErrorCount / this.apiRequestCount) * 100
  }

  /**
   * Reset API error tracking
   */
  resetApiErrorTracking(): void {
    this.apiErrorCount = 0
    this.apiRequestCount = 0
  }

  /**
   * Save trade to file
   */
  private saveTradeToFile(
    order: Order,
    type: 'ENTRY' | 'EXIT',
    metadata?: Record<string, any>
  ): void {
    try {
      const fileDir = path.dirname(this.config.tradesFile)
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true })
      }

      let trades: any[] = []
      if (fs.existsSync(this.config.tradesFile)) {
        const content = fs.readFileSync(this.config.tradesFile, 'utf-8')
        trades = JSON.parse(content)
      }

      const trade = {
        ...order,
        type,
        metadata,
        savedAt: Date.now()
      }

      trades.push(trade)
      fs.writeFileSync(this.config.tradesFile, JSON.stringify(trades, null, 2))
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`Failed to save live trade to file: ${errorMsg}`)
    }
  }
}
