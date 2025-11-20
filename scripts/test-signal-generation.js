#!/usr/bin/env node

/**
 * Test Signal Generation Script
 * 
 * This script tests signal generation without executing trades.
 * It generates trading signals, validates them, and displays the results.
 */

// Load environment variables from .env file if it exists
try {
  const fs = require('fs')
  const path = require('path')
  const envPath = path.join(__dirname, '..', '.env')
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8')
    envFile.split('\n').forEach(line => {
      const trimmedLine = line.trim()
      if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.includes('=')) {
        const [key, ...valueParts] = trimmedLine.split('=')
        const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '') // Remove quotes
        if (key && value && !process.env[key]) {
          process.env[key] = value
        }
      }
    })
  }
} catch (error) {
  // Ignore errors loading .env file (optional)
}

const https = require('https')
const http = require('http')

// Format price dynamically based on price value from Hyperliquid (not hardcoded per asset)
function formatPrice(price, asset = null) {
  if (!price || isNaN(price)) return '0'
  
  // Determine format based on price magnitude (not asset type)
  // This matches Hyperliquid's display format which depends on price, not asset
  
  if (price >= 1000) {
    // High value (>1000): No decimals, thousand separator with dot
    // Example: BTC ~$105,171 -> "105.171"
    const rounded = Math.round(price)
    return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  } else if (price >= 100) {
    // Medium-high value (100-1000): 1 decimal, thousand separator with dot, decimal with comma
    // Example: ETH ~$3,560.7 -> "3.560,7"
    const fixed = price.toFixed(1)
    const parts = fixed.split('.')
    const integerPart = parseInt(parts[0]).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    return `${integerPart},${parts[1]}`
  } else if (price >= 1) {
    // Medium value (1-100): 2 decimals standard format
    // Example: SOL ~$164.50 -> "164.50"
    return price.toFixed(2)
  } else if (price >= 0.01) {
    // Low value (0.01-1): 4 decimals for precision
    // Example: DOGE ~$0.17 -> "0.1700"
    return price.toFixed(4)
  } else {
    // Very low value (<0.01): 6 decimals for precision
    // Example: Very low cap tokens -> "0.000123"
    return price.toFixed(6)
  }
}

// Format large numbers (volume, OI) with thousand separators
function formatLargeNumber(num) {
  if (!num || isNaN(num)) return '0'
  return num.toLocaleString('de-DE', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  }).replace(/\./g, '.')
}

// Technical Analysis Functions (simple implementations)
function calculateSMA(values, period) {
  if (values.length < period) return []
  const sma = []
  for (let i = period - 1; i < values.length; i++) {
    const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    sma.push(sum / period)
  }
  return sma
}

function calculateEMA(values, period) {
  if (values.length < period) return []
  const ema = []
  const multiplier = 2 / (period + 1)
  
  // Start with SMA
  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += values[i]
  }
  ema.push(sum / period)
  
  // Calculate EMA for remaining values
  for (let i = period; i < values.length; i++) {
    const currentEMA = (values[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1]
    ema.push(currentEMA)
  }
  
  return ema
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return []
  const rsi = []
  const gains = []
  const losses = []
  
  // Calculate price changes
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1]
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? Math.abs(change) : 0)
  }
  
  // Calculate initial average gain and loss
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period
  
  // Calculate RSI
  for (let i = period; i < gains.length; i++) {
    if (avgLoss === 0) {
      rsi.push(100)
    } else {
      const rs = avgGain / avgLoss
      const currentRSI = 100 - (100 / (1 + rs))
      rsi.push(currentRSI)
    }
    
    // Update averages
    avgGain = (avgGain * (period - 1) + gains[i]) / period
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period
  }
  
  return rsi
}

function calculateMACD(closes, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (closes.length < slowPeriod + signalPeriod) return []
  
  const fastEMA = calculateEMA(closes, fastPeriod)
  const slowEMA = calculateEMA(closes, slowPeriod)
  
  // Align arrays (slowEMA starts later)
  const macdLine = []
  const startIdx = slowPeriod - fastPeriod
  
  for (let i = 0; i < slowEMA.length; i++) {
    if (fastEMA[startIdx + i] !== undefined) {
      macdLine.push(fastEMA[startIdx + i] - slowEMA[i])
    }
  }
  
  // Calculate signal line (EMA of MACD line)
  const signalLine = calculateEMA(macdLine, signalPeriod)
  
  // Calculate histogram
  const histogram = []
  const signalStartIdx = signalPeriod - 1
  for (let i = 0; i < signalLine.length; i++) {
    if (macdLine[signalStartIdx + i] !== undefined) {
      histogram.push({
        MACD: macdLine[signalStartIdx + i],
        signal: signalLine[i],
        histogram: macdLine[signalStartIdx + i] - signalLine[i]
      })
    }
  }
  
  return histogram
}

function calculateBollingerBands(closes, period = 20, stdDev = 2) {
  if (closes.length < period) return []
  const bands = []
  const sma = calculateSMA(closes, period)
  
  for (let i = period - 1; i < closes.length; i++) {
    const periodCloses = closes.slice(i - period + 1, i + 1)
    const mean = sma[i - period + 1]
    
    // Calculate standard deviation
    const variance = periodCloses.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period
    const standardDeviation = Math.sqrt(variance)
    
    bands.push({
      upper: mean + (stdDev * standardDeviation),
      middle: mean,
      lower: mean - (stdDev * standardDeviation)
    })
  }
  
  return bands
}

// Calculate Average True Range (ATR) for volatility-based position sizing
function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
    return []
  }
  
  const trueRanges = []
  
  // Calculate True Range for each period
  for (let i = 1; i < closes.length; i++) {
    const high = highs[i]
    const low = lows[i]
    const prevClose = closes[i - 1]
    
    // True Range = max(high - low, abs(high - prevClose), abs(low - prevClose))
    const tr1 = high - low
    const tr2 = Math.abs(high - prevClose)
    const tr3 = Math.abs(low - prevClose)
    const trueRange = Math.max(tr1, tr2, tr3)
    
    trueRanges.push(trueRange)
  }
  
  // Calculate ATR as SMA of True Ranges
  const atr = []
  let sum = 0
  
  // Initial ATR = average of first period true ranges
  for (let i = 0; i < period && i < trueRanges.length; i++) {
    sum += trueRanges[i]
  }
  
  if (trueRanges.length >= period) {
    atr.push(sum / period)
    
    // Subsequent ATR values use Wilder's smoothing method (exponential moving average)
    for (let i = period; i < trueRanges.length; i++) {
      const currentATR = ((atr[atr.length - 1] * (period - 1)) + trueRanges[i]) / period
      atr.push(currentATR)
    }
  }
  
  return atr
}

// Calculate Average Directional Index (ADX) for trend strength measurement
function calculateADX(highs, lows, closes, period = 14) {
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) {
    return []
  }
  
  // Calculate +DM and -DM (Directional Movement)
  const plusDM = []
  const minusDM = []
  
  for (let i = 1; i < highs.length; i++) {
    const highDiff = highs[i] - highs[i - 1]
    const lowDiff = lows[i - 1] - lows[i]
    
    if (highDiff > lowDiff && highDiff > 0) {
      plusDM.push(highDiff)
      minusDM.push(0)
    } else if (lowDiff > highDiff && lowDiff > 0) {
      plusDM.push(0)
      minusDM.push(lowDiff)
    } else {
      plusDM.push(0)
      minusDM.push(0)
    }
  }
  
  // Calculate True Range (same as ATR calculation)
  const trueRanges = []
  for (let i = 1; i < closes.length; i++) {
    const tr1 = highs[i] - lows[i]
    const tr2 = Math.abs(highs[i] - closes[i - 1])
    const tr3 = Math.abs(lows[i] - closes[i - 1])
    trueRanges.push(Math.max(tr1, tr2, tr3))
  }
  
  // Calculate smoothed +DM, -DM, and TR using Wilder's smoothing
  const smoothedPlusDM = []
  const smoothedMinusDM = []
  const smoothedTR = []
  
  // Initial values (SMA)
  let sumPlusDM = 0
  let sumMinusDM = 0
  let sumTR = 0
  
  for (let i = 0; i < period && i < plusDM.length; i++) {
    sumPlusDM += plusDM[i]
    sumMinusDM += minusDM[i]
    sumTR += trueRanges[i]
  }
  
  if (plusDM.length >= period) {
    smoothedPlusDM.push(sumPlusDM / period)
    smoothedMinusDM.push(sumMinusDM / period)
    smoothedTR.push(sumTR / period)
    
    // Subsequent values use Wilder's smoothing
    for (let i = period; i < plusDM.length; i++) {
      smoothedPlusDM.push((smoothedPlusDM[smoothedPlusDM.length - 1] * (period - 1) + plusDM[i]) / period)
      smoothedMinusDM.push((smoothedMinusDM[smoothedMinusDM.length - 1] * (period - 1) + minusDM[i]) / period)
      smoothedTR.push((smoothedTR[smoothedTR.length - 1] * (period - 1) + trueRanges[i]) / period)
    }
  }
  
  // Calculate +DI and -DI (Directional Indicators)
  const plusDI = []
  const minusDI = []
  const dx = []
  const adx = []
  
  for (let i = 0; i < smoothedTR.length; i++) {
    if (smoothedTR[i] > 0) {
      plusDI.push((smoothedPlusDM[i] / smoothedTR[i]) * 100)
      minusDI.push((smoothedMinusDM[i] / smoothedTR[i]) * 100)
    } else {
      plusDI.push(0)
      minusDI.push(0)
    }
    
    // Calculate DX (Directional Index)
    const diSum = plusDI[i] + minusDI[i]
    if (diSum > 0) {
      const diDiff = Math.abs(plusDI[i] - minusDI[i])
      dx.push((diDiff / diSum) * 100)
    } else {
      dx.push(0)
    }
  }
  
  // Calculate ADX as smoothed average of DX
  if (dx.length >= period) {
    // Initial ADX (SMA of first period DX values)
    let sumDX = 0
    for (let i = 0; i < period; i++) {
      sumDX += dx[i]
    }
    adx.push(sumDX / period)
    
    // Subsequent ADX values use Wilder's smoothing
    for (let i = period; i < dx.length; i++) {
      adx.push((adx[adx.length - 1] * (period - 1) + dx[i]) / period)
    }
  }
  
  return {
    adx: adx,
    plusDI: plusDI,
    minusDI: minusDI
  }
}

// Calculate On-Balance Volume (OBV) for volume analysis
function calculateOBV(closes, volumes) {
  if (closes.length < 2 || volumes.length < 2 || closes.length !== volumes.length) {
    return []
  }
  
  const obv = []
  let cumulativeOBV = 0
  
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) {
      // Price up: add volume
      cumulativeOBV += volumes[i]
    } else if (closes[i] < closes[i - 1]) {
      // Price down: subtract volume
      cumulativeOBV -= volumes[i]
    } else {
      // Price unchanged: OBV stays the same
      // cumulativeOBV remains unchanged
    }
    obv.push(cumulativeOBV)
  }
  
  return obv
}

// Calculate Volume Weighted Average Price (VWAP)
function calculateVWAP(historicalData) {
  if (!historicalData || historicalData.length === 0) {
    return null
  }
  
  let cumulativeTPV = 0 // Cumulative Typical Price * Volume
  let cumulativeVolume = 0
  
  for (const candle of historicalData) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3
    const volume = candle.volume || 0
    cumulativeTPV += typicalPrice * volume
    cumulativeVolume += volume
  }
  
  if (cumulativeVolume === 0) {
    return null
  }
  
  return cumulativeTPV / cumulativeVolume
}

// Calculate Stochastic Oscillator for overbought/oversold confirmation
function calculateStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  if (highs.length < kPeriod || lows.length < kPeriod || closes.length < kPeriod) {
    return []
  }
  
  const stochK = []
  const stochD = []
  
  // Calculate %K (Stochastic %K)
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const periodHighs = highs.slice(i - kPeriod + 1, i + 1)
    const periodLows = lows.slice(i - kPeriod + 1, i + 1)
    const highestHigh = Math.max(...periodHighs)
    const lowestLow = Math.min(...periodLows)
    const currentClose = closes[i]
    
    if (highestHigh !== lowestLow) {
      const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100
      stochK.push(k)
    } else {
      stochK.push(50) // Neutral if no range
    }
  }
  
  // Calculate %D (Stochastic %D) as SMA of %K
  if (stochK.length >= dPeriod) {
    for (let i = dPeriod - 1; i < stochK.length; i++) {
      const sum = stochK.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0)
      stochD.push(sum / dPeriod)
    }
  }
  
  return {
    k: stochK,
    d: stochD
  }
}

// Calculate Commodity Channel Index (CCI) for momentum confirmation
function calculateCCI(highs, lows, closes, period = 20) {
  if (highs.length < period || lows.length < period || closes.length < period) {
    return []
  }
  
  const cci = []
  
  for (let i = period - 1; i < closes.length; i++) {
    const typicalPrices = []
    for (let j = i - period + 1; j <= i; j++) {
      const tp = (highs[j] + lows[j] + closes[j]) / 3
      typicalPrices.push(tp)
    }
    
    const sma = typicalPrices.reduce((a, b) => a + b, 0) / period
    const currentTP = (highs[i] + lows[i] + closes[i]) / 3
    
    // Calculate Mean Deviation
    const meanDeviation = typicalPrices.reduce((sum, tp) => sum + Math.abs(tp - sma), 0) / period
    
    if (meanDeviation !== 0) {
      const cciValue = (currentTP - sma) / (0.015 * meanDeviation)
      cci.push(cciValue)
    } else {
      cci.push(0)
    }
  }
  
  return cci
}

// Calculate Williams %R for momentum signals
function calculateWilliamsR(highs, lows, closes, period = 14) {
  if (highs.length < period || lows.length < period || closes.length < period) {
    return []
  }
  
  const williamsR = []
  
  for (let i = period - 1; i < closes.length; i++) {
    const periodHighs = highs.slice(i - period + 1, i + 1)
    const periodLows = lows.slice(i - period + 1, i + 1)
    const highestHigh = Math.max(...periodHighs)
    const lowestLow = Math.min(...periodLows)
    const currentClose = closes[i]
    
    if (highestHigh !== lowestLow) {
      const wr = ((highestHigh - currentClose) / (highestHigh - lowestLow)) * -100
      williamsR.push(wr)
    } else {
      williamsR.push(-50) // Neutral if no range
    }
  }
  
  return williamsR
}

// Calculate Parabolic SAR for trend following
function calculateParabolicSAR(highs, lows, closes, afStart = 0.02, afIncrement = 0.02, afMax = 0.2) {
  if (highs.length < 2 || lows.length < 2 || closes.length < 2) {
    return []
  }
  
  const sar = []
  let trend = null // 1 for uptrend, -1 for downtrend
  let ep = null // Extreme Point
  let af = afStart // Acceleration Factor
  let currentSAR = null
  
  // Initialize
  if (closes[1] > closes[0]) {
    trend = 1 // Uptrend
    ep = highs[1]
    currentSAR = lows[0]
  } else {
    trend = -1 // Downtrend
    ep = lows[1]
    currentSAR = highs[0]
  }
  
  sar.push(currentSAR)
  
  // Calculate SAR for remaining periods
  for (let i = 2; i < closes.length; i++) {
    const prevSAR = currentSAR
    const prevEP = ep
    const prevAF = af
    
    // Calculate new SAR
    if (trend === 1) {
      // Uptrend
      currentSAR = prevSAR + prevAF * (prevEP - prevSAR)
      currentSAR = Math.min(currentSAR, lows[i - 1], lows[i - 2] || lows[i - 1])
      
      // Check for reversal
      if (currentSAR >= lows[i]) {
        // Reverse to downtrend
        trend = -1
        ep = lows[i]
        af = afStart
        currentSAR = Math.max(highs[i - 1], highs[i - 2] || highs[i - 1])
      } else {
        // Continue uptrend
        if (highs[i] > prevEP) {
          ep = highs[i]
          af = Math.min(af + afIncrement, afMax)
        }
      }
    } else {
      // Downtrend
      currentSAR = prevSAR + prevAF * (prevEP - prevSAR)
      currentSAR = Math.max(currentSAR, highs[i - 1], highs[i - 2] || highs[i - 1])
      
      // Check for reversal
      if (currentSAR <= highs[i]) {
        // Reverse to uptrend
        trend = 1
        ep = highs[i]
        af = afStart
        currentSAR = Math.min(lows[i - 1], lows[i - 2] || lows[i - 1])
      } else {
        // Continue downtrend
        if (lows[i] < prevEP) {
          ep = lows[i]
          af = Math.min(af + afIncrement, afMax)
        }
      }
    }
    
    sar.push(currentSAR)
  }
  
  return sar
}

// Calculate Aroon Indicator for trend strength and new highs/lows detection
function calculateAroon(highs, lows, period = 14) {
  if (highs.length < period || lows.length < period) {
    return []
  }
  
  const aroonUp = []
  const aroonDown = []
  
  for (let i = period - 1; i < highs.length; i++) {
    const periodHighs = highs.slice(i - period + 1, i + 1)
    const periodLows = lows.slice(i - period + 1, i + 1)
    const highestHigh = Math.max(...periodHighs)
    const lowestLow = Math.min(...periodLows)
    
    // Find position of highest high and lowest low
    let highestIndex = -1
    let lowestIndex = -1
    
    for (let j = periodHighs.length - 1; j >= 0; j--) {
      if (periodHighs[j] === highestHigh && highestIndex === -1) {
        highestIndex = j
      }
      if (periodLows[j] === lowestLow && lowestIndex === -1) {
        lowestIndex = j
      }
    }
    
    // Calculate Aroon Up and Down
    const aroonUpValue = ((period - 1 - highestIndex) / (period - 1)) * 100
    const aroonDownValue = ((period - 1 - lowestIndex) / (period - 1)) * 100
    
    aroonUp.push(aroonUpValue)
    aroonDown.push(aroonDownValue)
  }
  
  return {
    up: aroonUp,
    down: aroonDown
  }
}

// Calculate Support and Resistance levels from historical price data
function calculateSupportResistance(highs, lows, closes, lookbackPeriod = 20) {
  if (highs.length < lookbackPeriod || lows.length < lookbackPeriod || closes.length < lookbackPeriod) {
    return {
      support: null,
      resistance: null,
      pivotPoints: null
    }
  }
  
  // Find recent swing highs and lows
  const swingHighs = []
  const swingLows = []
  
  // Simple swing detection: local maxima and minima
  for (let i = 2; i < closes.length - 2; i++) {
    // Swing high: higher than previous 2 and next 2 candles
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && 
        highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
      swingHighs.push({ price: highs[i], index: i })
    }
    
    // Swing low: lower than previous 2 and next 2 candles
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && 
        lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
      swingLows.push({ price: lows[i], index: i })
    }
  }
  
  // Get recent swing points (last lookbackPeriod)
  const recentSwingHighs = swingHighs.slice(-lookbackPeriod)
  const recentSwingLows = swingLows.slice(-lookbackPeriod)
  
  // Calculate support as average of recent swing lows
  const support = recentSwingLows.length > 0
    ? recentSwingLows.reduce((sum, swing) => sum + swing.price, 0) / recentSwingLows.length
    : null
  
  // Calculate resistance as average of recent swing highs
  const resistance = recentSwingHighs.length > 0
    ? recentSwingHighs.reduce((sum, swing) => sum + swing.price, 0) / recentSwingHighs.length
    : null
  
  // Calculate pivot points (standard pivot point calculation)
  const lastHigh = highs[highs.length - 1]
  const lastLow = lows[lows.length - 1]
  const lastClose = closes[closes.length - 1]
  const pivot = (lastHigh + lastLow + lastClose) / 3
  
  const pivotPoints = {
    pivot: pivot,
    resistance1: 2 * pivot - lastLow,
    resistance2: pivot + (lastHigh - lastLow),
    support1: 2 * pivot - lastHigh,
    support2: pivot - (lastHigh - lastLow)
  }
  
  // Calculate Fibonacci retracements (38.2%, 50%, 61.8%)
  // Use recent high and low for Fibonacci levels
  const recentHigh = Math.max(...highs.slice(-lookbackPeriod))
  const recentLow = Math.min(...lows.slice(-lookbackPeriod))
  const range = recentHigh - recentLow
  
  const fibonacciLevels = {
    level0: recentHigh,      // 0% (High)
    level236: recentHigh - (range * 0.236),  // 23.6%
    level382: recentHigh - (range * 0.382),  // 38.2%
    level500: recentHigh - (range * 0.500),  // 50%
    level618: recentHigh - (range * 0.618),  // 61.8%
    level786: recentHigh - (range * 0.786),  // 78.6%
    level100: recentLow       // 100% (Low)
  }
  
  // Find previous highs and lows for additional key levels
  const previousHighs = swingHighs.length > 1 
    ? swingHighs.slice(-5).map(s => s.price).sort((a, b) => b - a)
    : []
  const previousLows = swingLows.length > 1
    ? swingLows.slice(-5).map(s => s.price).sort((a, b) => a - b)
    : []
  
  return {
    support: support,
    resistance: resistance,
    pivotPoints: pivotPoints,
    fibonacciLevels: fibonacciLevels,
    previousHighs: previousHighs,
    previousLows: previousLows,
    swingHighs: recentSwingHighs,
    swingLows: recentSwingLows
  }
}

// Detect trend using EMA crossovers and price action
function detectTrend(closes, ema20, ema50, ema200) {
  if (!closes || closes.length === 0 || !ema20 || ema20.length === 0) {
    return {
      trend: 'neutral',
      strength: 0,
      reason: 'Insufficient data'
    }
  }
  
  const currentPrice = closes[closes.length - 1]
  const currentEMA20 = ema20[ema20.length - 1]
  const currentEMA50 = ema50 && ema50.length > 0 ? ema50[ema50.length - 1] : null
  const currentEMA200 = ema200 && ema200.length > 0 ? ema200[ema200.length - 1] : null
  
  let trend = 'neutral'
  let strength = 0
  let reason = ''
  
  // Determine trend based on EMA crossovers and price position
  if (currentEMA50 && currentEMA200) {
    // Strong uptrend: Price > EMA20 > EMA50 > EMA200
    if (currentPrice > currentEMA20 && currentEMA20 > currentEMA50 && currentEMA50 > currentEMA200) {
      trend = 'uptrend'
      strength = 3
      reason = 'Strong uptrend: Price > EMA20 > EMA50 > EMA200'
    }
    // Strong downtrend: Price < EMA20 < EMA50 < EMA200
    else if (currentPrice < currentEMA20 && currentEMA20 < currentEMA50 && currentEMA50 < currentEMA200) {
      trend = 'downtrend'
      strength = 3
      reason = 'Strong downtrend: Price < EMA20 < EMA50 < EMA200'
    }
    // Moderate uptrend: Price > EMA20 > EMA50
    else if (currentPrice > currentEMA20 && currentEMA20 > currentEMA50) {
      trend = 'uptrend'
      strength = 2
      reason = 'Moderate uptrend: Price > EMA20 > EMA50'
    }
    // Moderate downtrend: Price < EMA20 < EMA50
    else if (currentPrice < currentEMA20 && currentEMA20 < currentEMA50) {
      trend = 'downtrend'
      strength = 2
      reason = 'Moderate downtrend: Price < EMA20 < EMA50'
    }
    // Weak uptrend: Price > EMA20
    else if (currentPrice > currentEMA20) {
      trend = 'uptrend'
      strength = 1
      reason = 'Weak uptrend: Price > EMA20'
    }
    // Weak downtrend: Price < EMA20
    else if (currentPrice < currentEMA20) {
      trend = 'downtrend'
      strength = 1
      reason = 'Weak downtrend: Price < EMA20'
    }
  } else if (currentEMA50) {
    // Only EMA20 and EMA50 available
    if (currentPrice > currentEMA20 && currentEMA20 > currentEMA50) {
      trend = 'uptrend'
      strength = 2
      reason = 'Uptrend: Price > EMA20 > EMA50'
    } else if (currentPrice < currentEMA20 && currentEMA20 < currentEMA50) {
      trend = 'downtrend'
      strength = 2
      reason = 'Downtrend: Price < EMA20 < EMA50'
    } else if (currentPrice > currentEMA20) {
      trend = 'uptrend'
      strength = 1
      reason = 'Weak uptrend: Price > EMA20'
    } else if (currentPrice < currentEMA20) {
      trend = 'downtrend'
      strength = 1
      reason = 'Weak downtrend: Price < EMA20'
    }
  } else {
    // Only EMA20 available
    if (currentPrice > currentEMA20) {
      trend = 'uptrend'
      strength = 1
      reason = 'Weak uptrend: Price > EMA20'
    } else if (currentPrice < currentEMA20) {
      trend = 'downtrend'
      strength = 1
      reason = 'Weak downtrend: Price < EMA20'
    }
  }
  
  return {
    trend: trend,
    strength: strength,
    reason: reason
  }
}

// Detect higher highs and lower lows for market structure analysis
function detectMarketStructure(highs, lows, closes, lookbackPeriod = 20) {
  if (highs.length < lookbackPeriod || lows.length < lookbackPeriod || closes.length < lookbackPeriod) {
    return {
      higherHighs: false,
      lowerLows: false,
      higherLows: false,
      lowerHighs: false,
      structure: 'neutral'
    }
  }
  
  // Get recent swing highs and lows
  const recentHighs = highs.slice(-lookbackPeriod)
  const recentLows = lows.slice(-lookbackPeriod)
  
  // Find highest high and lowest low in recent period
  const highestHigh = Math.max(...recentHighs)
  const lowestLow = Math.min(...recentLows)
  const highestHighIndex = recentHighs.indexOf(highestHigh)
  const lowestLowIndex = recentLows.indexOf(lowestLow)
  
  // Check for higher highs (uptrend structure)
  const higherHighs = highestHighIndex === recentHighs.length - 1 // Highest high is most recent
  
  // Check for lower lows (downtrend structure)
  const lowerLows = lowestLowIndex === recentLows.length - 1 // Lowest low is most recent
  
  // Check for higher lows (bullish structure)
  const firstHalfLows = recentLows.slice(0, Math.floor(recentLows.length / 2))
  const secondHalfLows = recentLows.slice(Math.floor(recentLows.length / 2))
  const avgFirstHalfLows = firstHalfLows.reduce((a, b) => a + b, 0) / firstHalfLows.length
  const avgSecondHalfLows = secondHalfLows.reduce((a, b) => a + b, 0) / secondHalfLows.length
  const higherLows = avgSecondHalfLows > avgFirstHalfLows
  
  // Check for lower highs (bearish structure)
  const firstHalfHighs = recentHighs.slice(0, Math.floor(recentHighs.length / 2))
  const secondHalfHighs = recentHighs.slice(Math.floor(recentHighs.length / 2))
  const avgFirstHalfHighs = firstHalfHighs.reduce((a, b) => a + b, 0) / firstHalfHighs.length
  const avgSecondHalfHighs = secondHalfHighs.reduce((a, b) => a + b, 0) / secondHalfHighs.length
  const lowerHighs = avgSecondHalfHighs < avgFirstHalfHighs
  
  // Determine market structure
  let structure = 'neutral'
  if (higherHighs && higherLows) {
    structure = 'uptrend'
  } else if (lowerLows && lowerHighs) {
    structure = 'downtrend'
  } else if (higherHighs || higherLows) {
    structure = 'bullish'
  } else if (lowerLows || lowerHighs) {
    structure = 'bearish'
  }
  
  return {
    higherHighs: higherHighs,
    lowerLows: lowerLows,
    higherLows: higherLows,
    lowerHighs: lowerHighs,
    structure: structure
  }
}

// Detect divergence for RSI and MACD
function detectDivergence(prices, indicatorValues, lookbackPeriod = 20) {
  if (prices.length < lookbackPeriod || indicatorValues.length < lookbackPeriod) {
    return {
      bullishDivergence: false,
      bearishDivergence: false,
      divergence: null
    }
  }
  
  const recentPrices = prices.slice(-lookbackPeriod)
  const recentIndicators = indicatorValues.slice(-lookbackPeriod)
  
  // Find price and indicator extremes
  const priceHigh = Math.max(...recentPrices)
  const priceLow = Math.min(...recentPrices)
  const priceHighIndex = recentPrices.indexOf(priceHigh)
  const priceLowIndex = recentPrices.indexOf(priceLow)
  
  const indicatorHigh = Math.max(...recentIndicators)
  const indicatorLow = Math.min(...recentIndicators)
  const indicatorHighIndex = recentIndicators.indexOf(indicatorHigh)
  const indicatorLowIndex = recentIndicators.indexOf(indicatorLow)
  
  // Bullish divergence: Price makes lower low, but indicator makes higher low
  let bullishDivergence = false
  if (priceLowIndex > priceHighIndex) {
    // Price made lower low after high
    const priceBeforeLow = recentPrices[priceLowIndex - 1] || recentPrices[0]
    const indicatorBeforeLow = recentIndicators[priceLowIndex - 1] || recentIndicators[0]
    if (priceLow < priceBeforeLow && recentIndicators[priceLowIndex] > indicatorBeforeLow) {
      bullishDivergence = true
    }
  }
  
  // Bearish divergence: Price makes higher high, but indicator makes lower high
  let bearishDivergence = false
  if (priceHighIndex > priceLowIndex) {
    // Price made higher high after low
    const priceBeforeHigh = recentPrices[priceHighIndex - 1] || recentPrices[0]
    const indicatorBeforeHigh = recentIndicators[priceHighIndex - 1] || recentIndicators[0]
    if (priceHigh > priceBeforeHigh && recentIndicators[priceHighIndex] < indicatorBeforeHigh) {
      bearishDivergence = true
    }
  }
  
  let divergence = null
  if (bullishDivergence) {
    divergence = 'bullish'
  } else if (bearishDivergence) {
    divergence = 'bearish'
  }
  
  return {
    bullishDivergence: bullishDivergence,
    bearishDivergence: bearishDivergence,
    divergence: divergence
  }
}

// Detect basic candlestick patterns
function detectCandlestickPatterns(historicalData, lookbackPeriod = 5) {
  if (!historicalData || historicalData.length < lookbackPeriod) {
    return {
      patterns: []
    }
  }
  
  const patterns = []
  const recentCandles = historicalData.slice(-lookbackPeriod)
  
  for (let i = 1; i < recentCandles.length; i++) {
    const current = recentCandles[i]
    const previous = recentCandles[i - 1]
    
    const bodySize = Math.abs(current.close - current.open)
    const upperShadow = current.high - Math.max(current.open, current.close)
    const lowerShadow = Math.min(current.open, current.close) - current.low
    const totalRange = current.high - current.low
    
    // Doji: Small body, long shadows
    if (bodySize < totalRange * 0.1 && (upperShadow > totalRange * 0.3 || lowerShadow > totalRange * 0.3)) {
      patterns.push({
        type: 'doji',
        index: i,
        bullish: current.close > current.open
      })
    }
    
    // Hammer: Small body at top, long lower shadow
    if (bodySize < totalRange * 0.3 && lowerShadow > bodySize * 2 && upperShadow < bodySize * 0.5) {
      patterns.push({
        type: 'hammer',
        index: i,
        bullish: true
      })
    }
    
    // Engulfing: Current candle engulfs previous
    if (i > 0) {
      const prevBodySize = Math.abs(previous.close - previous.open)
      const currentBodySize = Math.abs(current.close - current.open)
      
      // Bullish engulfing
      if (previous.close < previous.open && current.close > current.open &&
          current.open < previous.close && current.close > previous.open &&
          currentBodySize > prevBodySize * 1.1) {
        patterns.push({
          type: 'bullish_engulfing',
          index: i,
          bullish: true
        })
      }
      
      // Bearish engulfing
      if (previous.close > previous.open && current.close < current.open &&
          current.open > previous.close && current.close < previous.open &&
          currentBodySize > prevBodySize * 1.1) {
        patterns.push({
          type: 'bearish_engulfing',
          index: i,
          bullish: false
        })
      }
    }
  }
  
  return {
    patterns: patterns
  }
}

// Detect market regime (trending/choppy/volatile) using ADX and ATR
function detectMarketRegime(adx, atr, currentPrice, historicalData = [], lookbackATR = 20) {
  let regime = 'neutral'
  let volatility = 'normal'
  
  // Determine trend strength from ADX
  if (adx && adx > 25) {
    regime = 'trending'
  } else if (adx && adx < 20) {
    regime = 'choppy'
  } else {
    regime = 'neutral'
  }
  
  // Determine volatility from ATR - compare current ATR to historical average
  if (atr && currentPrice > 0) {
    const atrPercent = (atr / currentPrice) * 100
    
    // If we have historical data, calculate average ATR for comparison
    if (historicalData && historicalData.length >= lookbackATR) {
      const recentData = historicalData.slice(-lookbackATR)
      const atrValues = []
      
      // Calculate ATR for each period in historical data
      for (let i = 14; i < recentData.length; i++) {
        const periodData = recentData.slice(i - 14, i)
        if (periodData.length === 14) {
          const highs = periodData.map(d => d.high || d.close)
          const lows = periodData.map(d => d.low || d.close)
          const closes = periodData.map(d => d.close)
          const periodATR = calculateATR(highs, lows, closes, 14)
          if (periodATR && periodATR.length > 0) {
            atrValues.push(periodATR[periodATR.length - 1])
          }
        }
      }
      
      if (atrValues.length > 0) {
        const avgATR = atrValues.reduce((a, b) => a + b, 0) / atrValues.length
        const avgATRPercent = (avgATR / currentPrice) * 100
        
        // Compare current ATR to average
        if (atrPercent > avgATRPercent * 1.5) {
          volatility = 'high'
        } else if (atrPercent < avgATRPercent * 0.5) {
          volatility = 'low'
        } else {
          volatility = 'normal'
        }
      } else {
        // Fallback to simple percentage check
        if (atrPercent > 3) {
          volatility = 'high'
        } else if (atrPercent < 1) {
          volatility = 'low'
        } else {
          volatility = 'normal'
        }
      }
    } else {
      // Fallback to simple percentage check if no historical data
      if (atrPercent > 3) {
        volatility = 'high'
      } else if (atrPercent < 1) {
        volatility = 'low'
      } else {
        volatility = 'normal'
      }
    }
  }
  
  // Calculate regime score (0-100) based on regime strength
  let regimeScore = 0
  if (regime === 'trending') {
    regimeScore += 50 // Trending regime (50 points)
    if (adx && adx > 25) {
      regimeScore += 30 // Strong trend (ADX > 25)
    } else if (adx && adx > 20) {
      regimeScore += 20 // Moderate trend (ADX > 20)
    } else if (adx && adx > 15) {
      regimeScore += 10 // Weak trend (ADX > 15)
    }
  } else if (regime === 'choppy') {
    regimeScore += 20 // Choppy/ranging regime (20 points)
  } else if (regime === 'neutral') {
    regimeScore += 30 // Neutral regime (30 points)
  }
  
  // Add volatility score
  if (volatility === 'normal') {
    regimeScore += 20 // Normal volatility (20 points)
  } else if (volatility === 'low') {
    regimeScore += 10 // Low volatility (10 points)
  } else if (volatility === 'high') {
    regimeScore += 5 // High volatility (5 points - less predictable)
  }
  
  // Clamp to 0-100
  regimeScore = Math.max(0, Math.min(100, regimeScore))
  
  return {
    regime: regime,
    volatility: volatility,
    adx: adx,
    atrPercent: atr && currentPrice > 0 ? (atr / currentPrice) * 100 : null,
    regimeScore: regimeScore // NEW: Score from 0-100
  }
}

// Detect contradictions between signal and indicators
function detectContradictions(signal, indicators, trendAlignment) {
  const contradictions = []
  let contradictionScore = 0 // Higher = more contradictions
  
  // If no indicators available, assign penalty score (signal cannot be validated)
  // This prevents signals without indicators from automatically passing (Score=0)
  if (!indicators) {
    contradictions.push('No technical indicators available - signal cannot be validated')
    contradictionScore = 10 // Penalty score: signals without indicators are considered high risk
    return { contradictions, contradictionScore, hasContradictions: true }
  }
  
  const isBuySignal = signal.signal === 'buy_to_enter' || signal.signal === 'add'
  const isSellSignal = signal.signal === 'sell_to_enter'
  
  // 1. Check Bollinger Bands position
  if (indicators.bollingerBands && indicators.price) {
    const price = indicators.price
    const bbUpper = indicators.bollingerBands.upper
    const bbLower = indicators.bollingerBands.lower
    const bbMiddle = indicators.bollingerBands.middle
    
    if (isSellSignal && price > bbMiddle) {
      contradictions.push(`SELL signal but price is ABOVE BB middle (bullish position)`)
      contradictionScore += 3
    }
    if (isBuySignal && price < bbMiddle) {
      contradictions.push(`BUY signal but price is BELOW BB middle (bearish position)`)
      contradictionScore += 3
    }
    if (isSellSignal && price > bbUpper) {
      contradictions.push(`SELL signal but price is ABOVE BB upper (overbought - very bullish)`)
      contradictionScore += 5
    }
    if (isBuySignal && price < bbLower) {
      contradictions.push(`BUY signal but price is BELOW BB lower (oversold - very bearish)`)
      contradictionScore += 5
    }
  }
  
  // 2. Check OBV (On-Balance Volume)
  if (indicators.obv !== null && indicators.obv !== undefined) {
    if (isSellSignal && indicators.obv > 0) {
      contradictions.push(`SELL signal but OBV is positive (buying pressure)`)
      contradictionScore += 3
    }
    if (isBuySignal && indicators.obv < 0) {
      contradictions.push(`BUY signal but OBV is negative (selling pressure)`)
      contradictionScore += 3
    }
  }
  
  // 3. Check MACD Histogram (with severity based on magnitude)
  if (indicators.macd && indicators.macd.histogram !== undefined) {
    const macdHist = indicators.macd.histogram
    if (isSellSignal && macdHist > 0) {
      if (Math.abs(macdHist) > 50) {
        contradictions.push(`SELL signal but MACD histogram is STRONGLY positive (${macdHist.toFixed(2)}) - very bullish momentum!`)
        contradictionScore += 7 // Critical for large positive values
      } else if (Math.abs(macdHist) > 20) {
        contradictions.push(`SELL signal but MACD histogram is positive (${macdHist.toFixed(2)}) - bullish momentum`)
        contradictionScore += 5 // High severity
      } else {
        contradictions.push(`SELL signal but MACD histogram is positive (${macdHist.toFixed(2)}) - bullish momentum`)
        contradictionScore += 3
      }
    }
    if (isBuySignal && macdHist < 0) {
      if (Math.abs(macdHist) > 50) {
        contradictions.push(`BUY signal but MACD histogram is STRONGLY negative (${macdHist.toFixed(2)}) - very bearish momentum!`)
        contradictionScore += 7 // Critical for large negative values
      } else if (Math.abs(macdHist) > 20) {
        contradictions.push(`BUY signal but MACD histogram is negative (${macdHist.toFixed(2)}) - bearish momentum`)
        contradictionScore += 5 // High severity
      } else {
        contradictions.push(`BUY signal but MACD histogram is negative (${macdHist.toFixed(2)}) - bearish momentum`)
        contradictionScore += 3
      }
    }
  }
  
  // 4. Check Aroon
  if (indicators.aroon) {
    const aroonUp = indicators.aroon.up
    const aroonDown = indicators.aroon.down
    
    if (isSellSignal && aroonUp > 80) {
      contradictions.push(`SELL signal but Aroon Up is ${aroonUp.toFixed(0)} (strong uptrend)`)
      contradictionScore += 4
    }
    if (isBuySignal && aroonDown > 80) {
      contradictions.push(`BUY signal but Aroon Down is ${aroonDown.toFixed(0)} (strong downtrend)`)
      contradictionScore += 4
    }
    if (isSellSignal && aroonUp === 100) {
      contradictions.push(`SELL signal but Aroon Up is 100 (maximum uptrend strength)`)
      contradictionScore += 5
    }
    if (isBuySignal && aroonDown === 100) {
      contradictions.push(`BUY signal but Aroon Down is 100 (maximum downtrend strength)`)
      contradictionScore += 5
    }
  }
  
  // 5. Check Trend Alignment
  if (trendAlignment) {
    if (isSellSignal && trendAlignment.dailyTrend === 'uptrend') {
      contradictions.push(`SELL signal but daily trend is UPTREND`)
      contradictionScore += 5
    }
    if (isBuySignal && trendAlignment.dailyTrend === 'downtrend') {
      contradictions.push(`BUY signal but daily trend is DOWNTREND`)
      contradictionScore += 5
    }
    if (isSellSignal && trendAlignment.aligned && trendAlignment.dailyTrend === 'uptrend') {
      contradictions.push(`SELL signal but all timeframes are aligned for UPTREND`)
      contradictionScore += 7
    }
    if (isBuySignal && trendAlignment.aligned && trendAlignment.dailyTrend === 'downtrend') {
      contradictions.push(`BUY signal but all timeframes are aligned for DOWNTREND`)
      contradictionScore += 7
    }
  }
  
  // 6. Check EMA alignment
  if (indicators.price && indicators.ema20 && indicators.ema50) {
    const price = indicators.price
    const ema20 = indicators.ema20
    const ema50 = indicators.ema50
    
    if (isSellSignal && price > ema20 && ema20 > ema50) {
      contradictions.push(`SELL signal but price > EMA20 > EMA50 (uptrend structure)`)
      contradictionScore += 3
    }
    if (isBuySignal && price < ema20 && ema20 < ema50) {
      contradictions.push(`BUY signal but price < EMA20 < EMA50 (downtrend structure)`)
      contradictionScore += 3
    }
  }
  
  // 7. Check RSI Divergence
  if (indicators.rsiDivergence && indicators.rsiDivergence.divergence) {
    if (isSellSignal && indicators.rsiDivergence.divergence === 'bullish') {
      contradictions.push(`SELL signal but RSI shows BULLISH divergence`)
      contradictionScore += 4
    }
    if (isBuySignal && indicators.rsiDivergence.divergence === 'bearish') {
      contradictions.push(`BUY signal but RSI shows BEARISH divergence`)
      contradictionScore += 4
    }
  }
  
  // 8. Check MACD Divergence
  if (indicators.macdDivergence && indicators.macdDivergence.divergence) {
    if (isSellSignal && indicators.macdDivergence.divergence === 'bullish') {
      contradictions.push(`SELL signal but MACD shows BULLISH divergence`)
      contradictionScore += 3
    }
    if (isBuySignal && indicators.macdDivergence.divergence === 'bearish') {
      contradictions.push(`BUY signal but MACD shows BEARISH divergence`)
      contradictionScore += 3
    }
  }
  
  // 9. Check Parabolic SAR
  if (indicators.parabolicSAR && indicators.price) {
    const price = indicators.price
    const sar = indicators.parabolicSAR
    // SAR below price = bullish, SAR above price = bearish
    if (isSellSignal && sar < price) {
      contradictions.push(`SELL signal but Parabolic SAR is BULLISH (SAR below price)`)
      contradictionScore += 4
    }
    if (isBuySignal && sar > price) {
      contradictions.push(`BUY signal but Parabolic SAR is BEARISH (SAR above price)`)
      contradictionScore += 4
    }
  }
  
  // 10. Check CCI (Commodity Channel Index)
  if (indicators.cci !== null && indicators.cci !== undefined) {
    // CCI > 100 = overbought (bullish strength), CCI < -100 = oversold (bearish weakness)
    if (isSellSignal && indicators.cci > 100) {
      contradictions.push(`SELL signal but CCI is overbought (${indicators.cci.toFixed(2)}) - still has bullish strength`)
      contradictionScore += 3
    }
    if (isBuySignal && indicators.cci < -100) {
      contradictions.push(`BUY signal but CCI is oversold (${indicators.cci.toFixed(2)}) - still has bearish weakness`)
      contradictionScore += 3
    }
  }
  
  // 11. Check 24h Price Change
  if (indicators.priceChange24h !== null && indicators.priceChange24h !== undefined) {
    if (isSellSignal && indicators.priceChange24h > 0) {
      contradictions.push(`SELL signal but 24h price change is POSITIVE (+${indicators.priceChange24h.toFixed(2)}%) - price is rising`)
      contradictionScore += 2
    }
    if (isBuySignal && indicators.priceChange24h < 0) {
      contradictions.push(`BUY signal but 24h price change is NEGATIVE (${indicators.priceChange24h.toFixed(2)}%) - price is falling`)
      contradictionScore += 2
    }
  }
  
  return {
    contradictions,
    contradictionScore,
    hasContradictions: contradictions.length > 0,
    severity: contradictionScore >= 10 ? 'critical' : contradictionScore >= 7 ? 'high' : contradictionScore >= 4 ? 'medium' : 'low'
  }
}

// Calculate correlation matrix between assets (BTC, ETH, SOL)
function calculateCorrelationMatrix(marketData, assets = ['BTC', 'ETH', 'SOL'], lookbackPeriod = 24) {
  const correlationMatrix = {}
  
  // Get price data for each asset
  const priceData = {}
  for (const asset of assets) {
    const assetData = marketData instanceof Map ? marketData.get(asset) : marketData[asset]
    if (assetData && assetData.historicalData && assetData.historicalData.length >= lookbackPeriod) {
      const recentData = assetData.historicalData.slice(-lookbackPeriod)
      priceData[asset] = recentData.map(d => d.close)
    }
  }
  
  // Calculate correlation between each pair of assets
  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const asset1 = assets[i]
      const asset2 = assets[j]
      
      if (priceData[asset1] && priceData[asset2] && priceData[asset1].length === priceData[asset2].length) {
        const correlation = calculateCorrelation(priceData[asset1], priceData[asset2])
        const key = `${asset1}-${asset2}`
        correlationMatrix[key] = correlation
      }
    }
  }
  
  return correlationMatrix
}

// Calculate correlation coefficient between two price series
function calculateCorrelation(prices1, prices2) {
  if (prices1.length !== prices2.length || prices1.length === 0) {
    return null
  }
  
  // Calculate percentage changes
  const changes1 = []
  const changes2 = []
  
  for (let i = 1; i < prices1.length; i++) {
    if (prices1[i - 1] > 0) {
      changes1.push((prices1[i] - prices1[i - 1]) / prices1[i - 1])
    }
    if (prices2[i - 1] > 0) {
      changes2.push((prices2[i] - prices2[i - 1]) / prices2[i - 1])
    }
  }
  
  if (changes1.length !== changes2.length || changes1.length === 0) {
    return null
  }
  
  // Calculate means
  const mean1 = changes1.reduce((a, b) => a + b, 0) / changes1.length
  const mean2 = changes2.reduce((a, b) => a + b, 0) / changes2.length
  
  // Calculate covariance and standard deviations
  let covariance = 0
  let variance1 = 0
  let variance2 = 0
  
  for (let i = 0; i < changes1.length; i++) {
    const diff1 = changes1[i] - mean1
    const diff2 = changes2[i] - mean2
    covariance += diff1 * diff2
    variance1 += diff1 * diff1
    variance2 += diff2 * diff2
  }
  
  covariance /= changes1.length
  variance1 /= changes1.length
  variance2 /= changes2.length
  
  const stdDev1 = Math.sqrt(variance1)
  const stdDev2 = Math.sqrt(variance2)
  
  if (stdDev1 === 0 || stdDev2 === 0) {
    return null
  }
  
  const correlation = covariance / (stdDev1 * stdDev2)
  return correlation
}

// Fetch historical data from Binance API using https module (free, no API key required for public data)
async function getHistoricalDataFromBinance(asset, interval = '1h', limit = 200) {
  return new Promise((resolve, reject) => {
    try {
      // Map asset symbols to Binance trading pairs
      // Updated to include all new assets: HYPE, HYPER, RENDER, TRUMP, PENGU, KBONK, PYTH, NEAR, XLM, BLUR, ONDO, ZEC, XPL, FARTCOIN, TON, WLD
      const binancePairs = {
        'BTC': 'BTCUSDT',
        'ETH': 'ETHUSDT',
        'SOL': 'SOLUSDT',
        'BNB': 'BNBUSDT',
        'ADA': 'ADAUSDT',
        'DOGE': 'DOGEUSDT',
        'LTC': 'LTCUSDT',
        'BCH': 'BCHUSDT',
        'ETC': 'ETCUSDT',
        'XLM': 'XLMUSDT',
        'TRX': 'TRXUSDT',
        'NEAR': 'NEARUSDT',
        'FTM': 'FTMUSDT',
        'ALGO': 'ALGOUSDT',
        'FIL': 'FILUSDT',
        'ICP': 'ICPUSDT',
        'ATOM': 'ATOMUSDT',
        'DOT': 'DOTUSDT',
        'LINK': 'LINKUSDT',
        'UNI': 'UNIUSDT',
        'AAVE': 'AAVEUSDT',
        'AVAX': 'AVAXUSDT',
        'MATIC': 'MATICUSDT',
        'ARB': 'ARBUSDT',
        'OP': 'OPUSDT',
        'SUI': 'SUIUSDT',
        'APT': 'APTUSDT',
        // New assets (HYPE removed - no indicators available)
        'HYPER': 'HYPERUSDT',
        'RENDER': 'RENDERUSDT',
        'TRUMP': 'TRUMPUSDT',
        'PENGU': 'PENGUUSDT',
        'KBONK': 'KBONKUSDT',
        'PYTH': 'PYTHUSDT',
        'BLUR': 'BLURUSDT',
        'ONDO': 'ONDOUSDT',
        'ZEC': 'ZECUSDT',
        'XPL': 'XPLUSDT',
        'FARTCOIN': 'FARTCOINUSDT',
        'TON': 'TONUSDT',
        'WLD': 'WLDUSDT'
      }
      
      const symbol = binancePairs[asset]
      if (!symbol) {
        reject(new Error(`Asset ${asset} not supported by Binance`))
        return
      }
      
      // Validate interval format (Binance supports: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M)
      const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']
      let binanceInterval = interval
      if (!validIntervals.includes(interval)) {
        console.warn(`⚠️  Invalid interval ${interval} for Binance, using 1h as fallback`)
        binanceInterval = '1h'
      }
      
      // Binance API: Get klines (candlestick data)
      // Endpoint: GET /api/v3/klines
      const path = `/api/v3/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`
      
      const options = {
        hostname: 'api.binance.com',
        port: 443,
        path: path,
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        timeout: 10000
      }
      
      const startTime = process.hrtime.bigint()
      const requestStartTime = Date.now()
      
      const req = https.request(options, (res) => {
        let data = ''
        
        res.on('data', (chunk) => {
          data += chunk
        })
        
        res.on('end', () => {
          const endTime = process.hrtime.bigint()
          const duration = Number(endTime - startTime) / 1000000 // Convert to milliseconds
          const requestEndTime = Date.now()
          const totalDuration = requestEndTime - requestStartTime
          
          try {
            // Handle rate limit errors (429)
            if (res.statusCode === 429) {
              const retryAfter = res.headers['retry-after'] || res.headers['Retry-After'] || '60'
              reject(new Error(`Binance API rate limit exceeded. Retry after ${retryAfter} seconds. Status: ${res.statusCode}`))
              return
            }
            
            // Handle other non-200 status codes
            if (res.statusCode !== 200) {
              const errorMsg = data ? data.substring(0, 200) : 'Unknown error'
              reject(new Error(`Binance API error: ${res.statusCode} - ${errorMsg}`))
              return
            }
            
            const result = JSON.parse(data)
            
            // Binance returns: [[Open time, Open, High, Low, Close, Volume, Close time, Quote volume, ...], ...]
            if (!Array.isArray(result)) {
              reject(new Error(`Binance API returned invalid data format: ${typeof result}`))
              return
            }
            
            if (result.length === 0) {
              reject(new Error('No data returned from Binance'))
              return
            }
            
            // Convert to our format
            const candles = result.map((candle) => {
              if (!Array.isArray(candle) || candle.length < 6) {
                return null
              }
              
              const [
                openTime,    // Open time (timestamp in milliseconds)
                open,        // Open price
                high,        // High price
                low,         // Low price
                close,       // Close price
                volume,      // Volume
                closeTime,   // Close time
                quoteVolume, // Quote asset volume
                // ... other fields
              ] = candle
              
              return {
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume),
                timestamp: parseInt(openTime)
              }
            }).filter(c => c !== null && c.close > 0 && c.open > 0 && c.high >= c.low)
            
            if (candles.length === 0) {
              reject(new Error('No valid candles found in Binance response'))
              return
            }
            
            resolve(candles)
          } catch (error) {
            reject(new Error(`Failed to parse Binance response: ${error.message}`))
          }
        })
      })
      
      req.on('error', (error) => {
        reject(new Error(`Binance API request failed: ${error.message}`))
      })
      
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Binance API request timeout'))
      })
      
      req.end()
    } catch (error) {
      reject(error)
    }
  })
}

// Fetch historical data from OKX API (free, no API key required for public data)
async function getHistoricalDataFromOKX(asset, interval = '1H', limit = 200) {
  return new Promise((resolve, reject) => {
    try {
      // Map asset symbols to OKX trading pairs (USDT perpetual swaps)
      const okxPairs = {
        'BTC': 'BTC-USDT-SWAP',
        'ETH': 'ETH-USDT-SWAP',
        'SOL': 'SOL-USDT-SWAP'
      }
      
      const instId = okxPairs[asset]
      if (!instId) {
        reject(new Error(`Asset ${asset} not supported by OKX`))
        return
      }
      
      // Map interval format (1h -> 1H for OKX)
      // OKX intervals: 1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 12H, 1D, 1W, 1M, 3M, 6M, 1Y
      const okxInterval = interval.toUpperCase() // Convert to uppercase (1h -> 1H)
      
      // OKX API: Get candlestick data
      // Endpoint: GET /api/v5/market/candles
      const path = `/api/v5/market/candles?instId=${instId}&bar=${okxInterval}&limit=${limit}`
      
      const options = {
        hostname: 'www.okx.com',
        port: 443,
        path: path,
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        timeout: 10000
      }
      
      const req = https.request(options, (res) => {
        let data = ''
        
        res.on('data', (chunk) => {
          data += chunk
        })
        
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`OKX API error: ${res.statusCode} - ${data.substring(0, 200)}`))
              return
            }
            
            const result = JSON.parse(data)
            
            // OKX returns: { code: "0", data: [[timestamp, open, high, low, close, volume, ...], ...], msg: "" }
            if (result.code !== '0' || !Array.isArray(result.data) || result.data.length === 0) {
              reject(new Error(`OKX API returned error: ${result.msg || 'No data'}`))
              return
            }
            
            // Convert to our format
            // OKX format: [timestamp, open, high, low, close, volume, volumeCcy, volCcyQuote, confirm]
            // Timestamp is in ISO 8601 format (e.g., "2024-01-01T00:00:00.000Z") or Unix timestamp in seconds
            const candles = result.data.map((candle) => {
              const [
                timestamp,  // ISO 8601 or Unix timestamp (seconds)
                open,       // Open price
                high,       // High price
                low,        // Low price
                close,      // Close price
                volume,     // Volume (base currency)
                volumeCcy,  // Volume (quote currency)
                // ... other fields
              ] = candle
              
              // Convert timestamp to milliseconds
              let timestampMs
              if (typeof timestamp === 'string') {
                // ISO 8601 format
                timestampMs = new Date(timestamp).getTime()
              } else {
                // Unix timestamp in seconds
                timestampMs = parseInt(timestamp) * 1000
              }
              
              return {
                open: parseFloat(open),
                high: parseFloat(high),
                low: parseFloat(low),
                close: parseFloat(close),
                volume: parseFloat(volume || volumeCcy || 0),
                timestamp: timestampMs
              }
            }).filter(c => c.close > 0 && c.open > 0 && c.high >= c.low)
            
            // OKX returns data in reverse chronological order (newest first), reverse to oldest first
            resolve(candles.reverse())
          } catch (error) {
            reject(new Error(`Failed to parse OKX response: ${error.message}`))
          }
        })
      })
      
      req.on('error', (error) => {
        reject(new Error(`OKX API request failed: ${error.message}`))
      })
      
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('OKX API request timeout'))
      })
      
      req.end()
    } catch (error) {
      reject(error)
    }
  })
}

// Fetch historical data from CoinGecko API (free, no API key required)
async function getHistoricalDataFromCoinGecko(asset, days = 30, retryDelay = 1000, retries = 3) {
  let lastError = null
  const maxRetries = parseInt(process.env.COINGECKO_MAX_RETRIES || retries)
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        // Map asset symbols to CoinGecko IDs
        const coinGeckoIds = {
        'BTC': 'bitcoin',
        'ETH': 'ethereum',
        'SOL': 'solana',
        'BNB': 'binancecoin',
        'ADA': 'cardano',
        'DOGE': 'dogecoin',
        'LTC': 'litecoin',
        'BCH': 'bitcoin-cash',
        'ETC': 'ethereum-classic',
        'XLM': 'stellar',
        'TRX': 'tron',
        'NEAR': 'near',
        'FTM': 'fantom',
        'ALGO': 'algorand',
        'FIL': 'filecoin',
        'ICP': 'internet-computer',
        'ATOM': 'cosmos',
        'DOT': 'polkadot',
        'LINK': 'chainlink',
        'UNI': 'uniswap',
        'AAVE': 'aave',
        'AVAX': 'avalanche-2',
        'MATIC': 'matic-network',
        'ARB': 'arbitrum',
        'OP': 'optimism',
        'SUI': 'sui',
        'APT': 'aptos'
      }
      
      const coinId = coinGeckoIds[asset]
      if (!coinId) {
        reject(new Error(`Asset ${asset} not supported by CoinGecko`))
        return
      }
      
      // Add delay to avoid rate limiting
      setTimeout(() => {
        // CoinGecko API: Get OHLC data (Open, High, Low, Close)
        // Valid days: 1, 7, 14, 30, 90, 180, 365, max
        const validDays = days <= 1 ? 1 : days <= 7 ? 7 : days <= 14 ? 14 : days <= 30 ? 30 : days <= 90 ? 90 : days <= 180 ? 180 : days <= 365 ? 365 : 'max'
        const path = `/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${validDays}`
        
        // Add API key support if available
        const coinGeckoApiKey = process.env.COINGECKO_API_KEY
        const headers = {
          'Accept': 'application/json'
        }
        if (coinGeckoApiKey) {
          headers['x-cg-pro-api-key'] = coinGeckoApiKey
        }
        
        const options = {
          hostname: 'api.coingecko.com',
          port: 443,
          path: path,
          method: 'GET',
          headers: headers,
          timeout: 15000
        }
        
        const req = https.request(options, (res) => {
          let data = ''
          
          res.on('data', (chunk) => {
            data += chunk
          })
          
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                if (res.statusCode === 429) {
                  reject(new Error(`CoinGecko API rate limited: ${res.statusCode}`))
                  return
                }
                reject(new Error(`CoinGecko API error: ${res.statusCode} - ${data.substring(0, 200)}`))
                return
              }
              
              // Check for rate limit headers
              const remaining = res.headers['x-ratelimit-remaining']
              const resetTime = res.headers['x-ratelimit-reset']
              if (remaining && parseInt(remaining) < 10) {
                console.warn(`⚠️  CoinGecko rate limit warning: ${remaining} requests remaining`)
              }
              
              const result = JSON.parse(data)
              
              // CoinGecko returns: [[timestamp, open, high, low, close], ...]
              // Timestamp is in milliseconds
              if (!Array.isArray(result) || result.length === 0) {
                reject(new Error('No data returned from CoinGecko'))
                return
              }
              
              // Convert to our format
              const candles = result.map((candle) => {
                const [timestamp, open, high, low, close] = candle
                
                // Estimate volume from price movement
                const priceRange = high - low
                const avgPrice = (high + low) / 2
                const estimatedVolume = priceRange * avgPrice * 0.1
                
                return {
                  open: parseFloat(open),
                  high: parseFloat(high),
                  low: parseFloat(low),
                  close: parseFloat(close),
                  volume: estimatedVolume,
                  timestamp: parseInt(timestamp)
                }
              }).filter(c => c.close > 0 && c.open > 0 && c.high >= c.low)
              
              resolve(candles)
            } catch (error) {
              reject(new Error(`Failed to parse CoinGecko response: ${error.message}`))
            }
          })
        })
        
        req.on('error', (error) => {
          reject(new Error(`CoinGecko API request failed: ${error.message}`))
        })
        
        req.on('timeout', () => {
          req.destroy()
          reject(new Error('CoinGecko API request timeout'))
        })
        
        req.end()
      }, retryDelay)
      })
    } catch (error) {
      lastError = error
      // If it's a rate limit error, use exponential backoff
      if (error.message && error.message.includes('rate limited')) {
        const backoffDelay = retryDelay * Math.pow(2, attempt - 1)
        if (attempt < maxRetries) {
          console.warn(`⚠️  CoinGecko rate limited (attempt ${attempt}/${maxRetries}). Retrying in ${backoffDelay}ms...`)
          await new Promise(resolve => setTimeout(resolve, backoffDelay))
          continue
        }
      }
      // For other errors, retry with shorter delay
      if (attempt < maxRetries) {
        const delay = retryDelay * attempt
        console.warn(`⚠️  CoinGecko request failed (attempt ${attempt}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      throw error
    }
  }
  
  // If all retries failed
  throw lastError || new Error('Failed to fetch data from CoinGecko after retries')
}

// Fetch historical data from CoinMarketCap API (requires API key)
async function getHistoricalDataFromCoinMarketCap(asset, days = 30) {
  const apiKey = process.env.COINMARKETCAP_API_KEY || 'c52e484ad32f4a50b246ef2efa424d80'
  if (!apiKey) {
    throw new Error('CoinMarketCap API key not provided')
  }
  
  // Map asset symbols to CoinMarketCap IDs
  const coinMarketCapIds = {
    'BTC': '1',
    'ETH': '1027',
    'SOL': '4128',
    'BNB': '1839',
    'ADA': '2010',
    'DOGE': '5',
    'LTC': '2',
    'BCH': '1831',
    'ETC': '1321',
    'XLM': '512',
    'TRX': '1958',
    'NEAR': '6535',
    'FTM': '3513',
    'ALGO': '4030',
    'FIL': '2280',
    'ICP': '8916',
    'ATOM': '3794',
    'DOT': '6636',
    'LINK': '1975',
    'UNI': '7083',
    'AAVE': '7278',
    'AVAX': '5805',
    'MATIC': '3890',
    'ARB': '11841',
    'OP': '11840',
    'SUI': '20947',
    'APT': '21794'
  }
  
  const coinId = coinMarketCapIds[asset]
  if (!coinId) {
    throw new Error(`Asset ${asset} not supported by CoinMarketCap`)
  }
  
  return new Promise((resolve, reject) => {
    // CoinMarketCap doesn't have direct OHLC endpoint, use quotes endpoint
    // For historical data, we'll need to use a different approach or fallback to CoinGecko
    // For now, return empty array and let it fallback to CoinGecko
    // TODO: Implement CoinMarketCap historical data if needed
    resolve([])
  })
}

// Interpolate daily data to hourly data for technical analysis (fallback only)
// Note: This function uses deterministic interpolation (no random values) for consistency
// Primary data source should be Binance API which provides real interval data
function interpolateToHourly(dailyData, targetCount) {
  if (dailyData.length === 0) return []
  
  const hourlyData = []
  const oneHour = 60 * 60 * 1000
  
  for (let i = 0; i < dailyData.length; i++) {
    const day = dailyData[i]
    const nextDay = dailyData[i + 1]
    
    const hoursInDay = 24
    for (let h = 0; h < hoursInDay; h++) {
      const progress = h / hoursInDay
      
      if (nextDay) {
        // Deterministic linear interpolation (no random values)
        const open = day.open + (nextDay.open - day.open) * progress
        const close = day.close + (nextDay.close - day.close) * progress
        // Use linear interpolation for high/low with a deterministic smoothing factor
        const highProgress = Math.sin(progress * Math.PI) // Sine wave for natural price movement
        const lowProgress = Math.sin(progress * Math.PI)
        const high = day.high + (nextDay.high - day.high) * highProgress
        const low = day.low + (nextDay.low - day.low) * lowProgress
        const volume = (day.volume + nextDay.volume) / 2 / hoursInDay
        const timestamp = day.timestamp + (h * oneHour)
        
        hourlyData.push({
          open: Math.max(Math.min(open, high), low),
          high: Math.max(high, open, close, day.high),
          low: Math.min(low, open, close, day.low),
          close: Math.max(Math.min(close, high), low),
          volume,
          timestamp
        })
      } else {
        // Last day: use linear interpolation based on day's range
        const volatility = (day.high - day.low) / day.close
        // Deterministic variation based on hour index
        const hourVariation = Math.sin((h / hoursInDay) * Math.PI * 2) * 0.1 // Deterministic sine wave
        const open = day.open * (1 + hourVariation * volatility)
        const close = day.close * (1 + hourVariation * volatility)
        // Use day's high/low with slight deterministic variation
        const highVariation = Math.sin((h / hoursInDay) * Math.PI) * 0.01
        const lowVariation = -Math.sin((h / hoursInDay) * Math.PI) * 0.01
        const high = Math.max(open, close, day.high) * (1 + highVariation)
        const low = Math.min(open, close, day.low) * (1 + lowVariation)
        const volume = day.volume / hoursInDay
        const timestamp = day.timestamp + (h * oneHour)
        
        hourlyData.push({
          open: Math.max(Math.min(open, high), low),
          high: Math.max(high, open, close, day.high),
          low: Math.min(low, open, close, day.low),
          close: Math.max(Math.min(close, high), low),
          volume,
          timestamp
        })
      }
    }
  }
  
  return hourlyData.slice(-targetCount)
}

// Cache for historical data to avoid repeated API calls
const historicalDataCache = new Map()

// Cache for funding rate and open interest values (for trend calculation)
const fundingRateCache = new Map() // { asset: { value: number, timestamp: number } }
const openInterestCache = new Map() // { asset: { value: number, timestamp: number } }
const FUNDING_OI_CACHE_TTL = parseInt(process.env.FUNDING_OI_CACHE_TTL || '600000') // 10 minutes default
const HISTORICAL_DATA_CACHE_TTL = parseInt(process.env.EXTERNAL_DATA_CACHE_TTL || '300000') // 300 seconds (5 minutes) cache TTL (fallback)

// Calculate dynamic cache TTL based on interval
function getCacheTTLForInterval(interval) {
  const intervalMap = {
    '1m': 60000,      // 1 minute cache
    '3m': 90000,      // 1.5 minutes cache
    '5m': 120000,     // 2 minutes cache
    '15m': 300000,    // 5 minutes cache
    '30m': 420000,    // 7 minutes cache
    '1h': 600000,     // 10 minutes cache
    '2h': 900000,     // 15 minutes cache
    '4h': 1200000,    // 20 minutes cache
    '6h': 1800000,    // 30 minutes cache
    '8h': 2400000,    // 40 minutes cache
    '12h': 3600000,   // 1 hour cache
    '1d': 3600000,    // 1 hour cache
    '3d': 7200000,    // 2 hours cache
    '1w': 14400000,   // 4 hours cache
    '1M': 28800000    // 8 hours cache
  }
  return intervalMap[interval] || HISTORICAL_DATA_CACHE_TTL // Fallback to default if interval not found
}

// Fetch historical data for technical analysis
// Use Binance API as primary source (supports minute/second intervals, no API key required)
async function getHistoricalData(asset, interval = '1h', n = 200) {
  try {
    // Check cache first with dynamic TTL based on interval
    const cacheKey = `${asset}-${interval}-${n}`
    const cached = historicalDataCache.get(cacheKey)
    const cacheTTL = getCacheTTLForInterval(interval)
    if (cached && (Date.now() - cached.timestamp) < cacheTTL) {
      return cached.data
    }
    
    // Use Binance API as primary source (supports minute/second intervals, no API key required)
    let binanceData = []
    try {
      binanceData = await getHistoricalDataFromBinance(asset, interval, n)
      if (binanceData && binanceData.length > 0) {
        // Binance provides real interval data (no interpolation needed)
        if (binanceData.length >= 14) { // Need at least 14 candles for RSI
          // Cache the result
          historicalDataCache.set(cacheKey, {
            data: binanceData,
            timestamp: Date.now()
          })
          return binanceData
        }
      }
    } catch (binanceError) {
      // No fallback - only use Binance API
      console.warn(`Binance failed for ${asset} (${interval}): ${binanceError.message}`)
      // Return empty array - asset not supported on Binance or API error
      return []
    }
    
    return []
  } catch (error) {
    console.warn(`Failed to fetch historical data for ${asset} (${interval}): ${error.message}`)
    
    // Clear cache on rate limit errors to prevent stale data
    if (error.message && (error.message.includes('rate limit') || error.message.includes('rate limited') || error.message.includes('429'))) {
      const cacheKey = `${asset}-${interval}-${n}`
      historicalDataCache.delete(cacheKey)
      console.warn(`⚠️  Cleared cache for ${asset} (${interval}) due to rate limit error`)
    }
    
    // Log error information
    if (error.message && error.message.includes('not supported')) {
      console.warn(`💡 ${asset} is not supported on Binance`)
    }
    
    return []
  }
}

// Fetch historical data for multiple timeframes
async function getMultiTimeframeData(asset, timeframes = ['1h', '4h', '1d']) {
  const multiTimeframeData = {}
  
  for (const tf of timeframes) {
    try {
      let n = 200 // Default number of candles
      let days = 30 // Default days for CoinGecko
      
      // Adjust based on timeframe
      if (tf === '1d') {
        n = 200 // 200 days
        days = 200
      } else if (tf === '4h') {
        n = 200 // 200 * 4h = ~33 days
        days = 35
      } else if (tf === '1h') {
        n = 200 // 200 hours = ~8 days
        days = 10
      }
      
      const data = await getHistoricalData(asset, tf, n)
      if (data.length > 0) {
        multiTimeframeData[tf] = data
      }
    } catch (error) {
      console.warn(`Failed to fetch ${tf} data for ${asset}: ${error.message}`)
    }
  }
  
  return multiTimeframeData
}

// Calculate technical indicators for multiple timeframes
function calculateMultiTimeframeIndicators(multiTimeframeData, currentPrice) {
  const indicators = {}
  
  for (const [timeframe, historicalData] of Object.entries(multiTimeframeData)) {
    if (historicalData && historicalData.length >= 14) {
      const tfIndicators = calculateTechnicalIndicators(historicalData, currentPrice)
      if (tfIndicators) {
        indicators[timeframe] = tfIndicators
      }
    }
  }
  
  return indicators
}

// Check trend alignment across timeframes (only trade with daily trend)
function checkTrendAlignment(multiTimeframeIndicators) {
  if (!multiTimeframeIndicators || !multiTimeframeIndicators['1d']) {
    return {
      aligned: false,
      reason: 'Daily timeframe data not available'
    }
  }
  
  const dailyIndicators = multiTimeframeIndicators['1d']
  const dailyPrice = dailyIndicators.price
  const dailyEMA20 = dailyIndicators.ema20
  const dailyEMA50 = dailyIndicators.ema50
  
  if (!dailyEMA20 || !dailyEMA50 || !dailyPrice) {
    return {
      aligned: false,
      reason: 'Daily EMA data not available'
    }
  }
  
  // Determine daily trend
  let dailyTrend = 'neutral'
  if (dailyPrice > dailyEMA20 && dailyEMA20 > dailyEMA50) {
    dailyTrend = 'uptrend'
  } else if (dailyPrice < dailyEMA20 && dailyEMA20 < dailyEMA50) {
    dailyTrend = 'downtrend'
  }
  
  // Check 4h and 1h alignment
  const h4Indicators = multiTimeframeIndicators['4h']
  const h1Indicators = multiTimeframeIndicators['1h']
  
  let h4Aligned = true
  let h1Aligned = true
  
  if (h4Indicators && h4Indicators.ema20 && h4Indicators.price) {
    if (dailyTrend === 'uptrend' && h4Indicators.price < h4Indicators.ema20) {
      h4Aligned = false
    } else if (dailyTrend === 'downtrend' && h4Indicators.price > h4Indicators.ema20) {
      h4Aligned = false
    }
  }
  
  if (h1Indicators && h1Indicators.ema20 && h1Indicators.price) {
    if (dailyTrend === 'uptrend' && h1Indicators.price < h1Indicators.ema20) {
      h1Aligned = false
    } else if (dailyTrend === 'downtrend' && h1Indicators.price > h1Indicators.ema20) {
      h1Aligned = false
    }
  }
  
  // Calculate alignment score (0-100) based on alignment strength
  let alignmentScore = 0
  if (dailyTrend !== 'neutral') {
    alignmentScore += 40 // Daily trend exists (40 points)
    if (h4Aligned) alignmentScore += 30 // 4H aligned (30 points)
    if (h1Aligned) alignmentScore += 30 // 1H aligned (30 points)
  }
  // If daily trend is neutral, alignmentScore remains 0
  
  return {
    aligned: dailyTrend !== 'neutral' && h4Aligned && h1Aligned,
    dailyTrend: dailyTrend,
    h4Aligned: h4Aligned,
    h1Aligned: h1Aligned,
    alignmentScore: alignmentScore, // NEW: Score from 0-100
    reason: dailyTrend === 'neutral' ? 'Daily trend is neutral' : (!h4Aligned || !h1Aligned) ? 'Lower timeframes not aligned' : 'All timeframes aligned'
  }
}

// Parse candles from various formats
function parseCandles(candles, asset) {
  return candles.map(candle => {
    let open, high, low, close, volume, time
    
    if (Array.isArray(candle)) {
      // Array format: [time, open, high, low, close, volume] or [timestamp, open, high, low, close]
      if (candle.length === 6) {
        if (typeof candle[0] === 'number' && candle[0] > 1000000000000) {
          // First element is timestamp (milliseconds)
          time = candle[0]
          open = parseFloat(candle[1] || 0)
          high = parseFloat(candle[2] || 0)
          low = parseFloat(candle[3] || 0)
          close = parseFloat(candle[4] || 0)
          volume = parseFloat(candle[5] || 0)
        } else {
          // [open, high, low, close, volume, time]
          open = parseFloat(candle[0] || 0)
          high = parseFloat(candle[1] || 0)
          low = parseFloat(candle[2] || 0)
          close = parseFloat(candle[3] || 0)
          volume = parseFloat(candle[4] || 0)
          time = candle[5] || Date.now()
        }
      } else if (candle.length === 5) {
        // CoinGecko format: [timestamp, open, high, low, close]
        time = parseInt(candle[0])
        open = parseFloat(candle[1] || 0)
        high = parseFloat(candle[2] || 0)
        low = parseFloat(candle[3] || 0)
        close = parseFloat(candle[4] || 0)
        volume = 0 // Will be estimated
      } else {
        return null
      }
    } else {
      // Object format
      open = parseFloat(candle.open || candle.o || 0)
      high = parseFloat(candle.high || candle.h || 0)
      low = parseFloat(candle.low || candle.l || 0)
      close = parseFloat(candle.close || candle.c || 0)
      volume = parseFloat(candle.volume || candle.v || 0)
      time = candle.time || candle.t || Date.now()
    }
    
    // Estimate volume if not provided
    if (!volume || volume === 0) {
      const priceRange = high - low
      const avgPrice = (high + low) / 2
      volume = priceRange * avgPrice * 0.1 // Rough estimate
    }
    
    return {
      open,
      high,
      low,
      close,
      volume,
      timestamp: time
    }
  }).filter(c => c && c.close > 0 && c.open > 0 && c.high >= c.low)
}


// Calculate technical indicators for an asset
function calculateTechnicalIndicators(historicalData, currentPrice) {
  if (!historicalData || historicalData.length < 14) {
    return null
  }
  
  // Ensure we have valid price data
  const closes = historicalData.map(d => d.close).filter(c => c > 0)
  const highs = historicalData.map(d => d.high).filter(h => h > 0)
  const lows = historicalData.map(d => d.low).filter(l => l > 0)
  const volumes = historicalData.map(d => d.volume || 0)
  
  if (closes.length < 14) {
    return null
  }
  
  // Calculate indicators with error handling
  let rsi14 = []
  let rsi7 = []
  let ema8 = []
  let ema20 = []
  let ema50 = []
  let ema200 = []
  let macd = []
  let bb = []
  let atr = []
  let adx = null
  let obv = []
  let vwap = null
  let stochastic = null
  let cci = []
  let williamsR = []
  let parabolicSAR = []
  let aroon = null
  let supportResistance = null
  let rsiDivergence = null
  let macdDivergence = null
  
  try {
    rsi14 = calculateRSI(closes, 14)
  } catch (error) {
    console.warn(`RSI calculation failed: ${error.message}`)
  }
  
  try {
    rsi7 = calculateRSI(closes, 7)
  } catch (error) {
    console.warn(`RSI7 calculation failed: ${error.message}`)
  }
  
  try {
    ema8 = calculateEMA(closes, 8)
  } catch (error) {
    console.warn(`EMA8 calculation failed: ${error.message}`)
  }
  
  try {
    ema20 = calculateEMA(closes, 20)
  } catch (error) {
    console.warn(`EMA20 calculation failed: ${error.message}`)
  }
  
  try {
    ema50 = calculateEMA(closes, 50)
  } catch (error) {
    // EMA50 might fail if not enough data, that's OK
  }
  
  try {
    ema200 = calculateEMA(closes, 200)
  } catch (error) {
    // EMA200 might fail if not enough data, that's OK
  }
  
  try {
    macd = calculateMACD(closes)
  } catch (error) {
    console.warn(`MACD calculation failed: ${error.message}`)
  }
  
  try {
    bb = calculateBollingerBands(closes, 20, 2)
  } catch (error) {
    console.warn(`Bollinger Bands calculation failed: ${error.message}`)
  }
  
  try {
    atr = calculateATR(highs, lows, closes, 14)
  } catch (error) {
    console.warn(`ATR calculation failed: ${error.message}`)
  }
  
  // Always calculate all indicators for full analysis
  
  try {
    adx = calculateADX(highs, lows, closes, 14)
  } catch (error) {
    console.warn(`ADX calculation failed: ${error.message}`)
  }
  
  // Always calculate all indicators for full analysis
  {
    try {
      // Calculate OBV (On-Balance Volume)
      obv = calculateOBV(closes, volumes)
    } catch (error) {
      console.warn(`OBV calculation failed: ${error.message}`)
    }
    
    try {
      // Calculate VWAP (Volume Weighted Average Price)
      vwap = calculateVWAP(historicalData)
    } catch (error) {
      console.warn(`VWAP calculation failed: ${error.message}`)
    }
    
    try {
      // Calculate Stochastic Oscillator
      stochastic = calculateStochastic(highs, lows, closes, 14, 3)
    } catch (error) {
      console.warn(`Stochastic calculation failed: ${error.message}`)
    }
    
    try {
      // Calculate CCI (Commodity Channel Index)
      cci = calculateCCI(highs, lows, closes, 20)
    } catch (error) {
      console.warn(`CCI calculation failed: ${error.message}`)
    }
    
    try {
      // Calculate Williams %R
      williamsR = calculateWilliamsR(highs, lows, closes, 14)
    } catch (error) {
      console.warn(`Williams %R calculation failed: ${error.message}`)
    }
    
    try {
      // Calculate Parabolic SAR
      parabolicSAR = calculateParabolicSAR(highs, lows, closes)
    } catch (error) {
      console.warn(`Parabolic SAR calculation failed: ${error.message}`)
    }
    
    try {
      // Calculate Aroon Indicator
      aroon = calculateAroon(highs, lows, 14)
    } catch (error) {
      console.warn(`Aroon calculation failed: ${error.message}`)
    }
    
    try {
      // Calculate Support/Resistance levels
      supportResistance = calculateSupportResistance(highs, lows, closes, 20)
    } catch (error) {
      console.warn(`Support/Resistance calculation failed: ${error.message}`)
    }
    
    // Calculate trend detection
    let trendDetection = null
    try {
      trendDetection = detectTrend(closes, ema20, ema50, ema200)
    } catch (error) {
      console.warn(`Trend detection failed: ${error.message}`)
    }
    
    // Calculate market structure
    let marketStructure = null
    try {
      marketStructure = detectMarketStructure(highs, lows, closes, 20)
    } catch (error) {
      console.warn(`Market structure detection failed: ${error.message}`)
    }
    
    // Calculate divergence for RSI and MACD
    // Note: rsiDivergence and macdDivergence already declared above
    try {
      if (rsi14.length >= 20) {
        rsiDivergence = detectDivergence(closes, rsi14, 20)
      }
    } catch (error) {
      console.warn(`RSI divergence detection failed: ${error.message}`)
    }
    
    try {
      if (macd.length >= 20) {
        const macdValues = macd.map(m => m.histogram)
        macdDivergence = detectDivergence(closes, macdValues, 20)
      }
    } catch (error) {
      console.warn(`MACD divergence detection failed: ${error.message}`)
    }
    
    // Calculate candlestick patterns
    let candlestickPatterns = null
    try {
      candlestickPatterns = detectCandlestickPatterns(historicalData, 5)
    } catch (error) {
      console.warn(`Candlestick pattern detection failed: ${error.message}`)
    }
  }
  
  // Declare variables before if block (so they're accessible outside)
  // Note: supportResistance already declared above (line 1888)
  // Note: rsiDivergence and macdDivergence already declared and calculated above (line 2052-2069)
  let trendDetection = null
  let marketStructure = null
  let candlestickPatterns = null
  
  // Get latest values (need to define before market regime detection)
  const currentRsi14 = rsi14.length > 0 ? rsi14[rsi14.length - 1] : null
  const currentRsi7 = rsi7.length > 0 ? rsi7[rsi7.length - 1] : null
  const currentEma8 = ema8.length > 0 ? ema8[ema8.length - 1] : null
  const currentEma20 = ema20.length > 0 ? ema20[ema20.length - 1] : null
  const currentEma50 = ema50.length > 0 ? ema50[ema50.length - 1] : null
  const currentEma200 = ema200.length > 0 ? ema200[ema200.length - 1] : null
  const currentMacd = macd.length > 0 ? macd[macd.length - 1] : null
  const currentBB = bb.length > 0 ? bb[bb.length - 1] : null
  const currentATR = atr.length > 0 ? atr[atr.length - 1] : null
  // ADX is an object with {adx, plusDI, minusDI} or null
  const currentADX = adx && typeof adx === 'object' && adx.adx !== undefined ? adx.adx : (typeof adx === 'number' ? adx : null)
  
  // Calculate market regime
  let marketRegime = null
  try {
    marketRegime = detectMarketRegime(currentADX, currentATR, currentPrice || closes[closes.length - 1], historicalData)
  } catch (error) {
    console.warn(`Market regime detection failed: ${error.message}`)
  }
  
  // Get ADX components (if ADX is an object with adx, plusDI, minusDI arrays)
  const currentADXValue = adx && typeof adx === 'object' && adx.adx && adx.adx.length > 0 ? adx.adx[adx.adx.length - 1] : (typeof adx === 'number' ? adx : currentADX)
  const currentPlusDI = adx && adx.plusDI && adx.plusDI.length > 0 ? adx.plusDI[adx.plusDI.length - 1] : null
  const currentMinusDI = adx && adx.minusDI && adx.minusDI.length > 0 ? adx.minusDI[adx.minusDI.length - 1] : null
  const currentOBV = obv.length > 0 ? obv[obv.length - 1] : null
  const currentVWAP = vwap
  const currentStochK = stochastic && stochastic.k && stochastic.k.length > 0 ? stochastic.k[stochastic.k.length - 1] : null
  const currentStochD = stochastic && stochastic.d && stochastic.d.length > 0 ? stochastic.d[stochastic.d.length - 1] : null
  const currentCCI = cci.length > 0 ? cci[cci.length - 1] : null
  const currentWilliamsR = williamsR.length > 0 ? williamsR[williamsR.length - 1] : null
  const currentParabolicSAR = parabolicSAR.length > 0 ? parabolicSAR[parabolicSAR.length - 1] : null
  const currentAroonUp = aroon && aroon.up && aroon.up.length > 0 ? aroon.up[aroon.up.length - 1] : null
  const currentAroonDown = aroon && aroon.down && aroon.down.length > 0 ? aroon.down[aroon.down.length - 1] : null
  
  // Calculate price change
  const priceChange24h = closes.length >= 24 
    ? ((closes[closes.length - 1] - closes[closes.length - 25]) / closes[closes.length - 25]) * 100
    : ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
  
  // Calculate volume change
  const avgVolume24h = volumes.slice(-24).reduce((a, b) => a + b, 0) / Math.min(24, volumes.length)
  const currentVolume = volumes[volumes.length - 1] || 0
  const volumeChange = avgVolume24h > 0 ? ((currentVolume - avgVolume24h) / avgVolume24h) * 100 : 0
  
  // Return indicators object - ensure at least some indicators are present
  const indicators = {
    rsi14: currentRsi14,
    rsi7: currentRsi7,
    ema8: currentEma8,
    ema20: currentEma20,
    ema50: currentEma50,
    ema200: currentEma200,
    macd: currentMacd ? {
      macd: currentMacd.MACD,
      signal: currentMacd.signal,
      histogram: currentMacd.histogram
    } : null,
    bollingerBands: currentBB ? {
      upper: currentBB.upper,
      middle: currentBB.middle,
      lower: currentBB.lower
    } : null,
    atr: currentATR,
    adx: currentADX,
    plusDI: currentPlusDI,
    minusDI: currentMinusDI,
    obv: currentOBV,
    vwap: currentVWAP,
    stochastic: currentStochK !== null && currentStochD !== null ? {
      k: currentStochK,
      d: currentStochD
    } : null,
    cci: currentCCI,
    williamsR: currentWilliamsR,
    parabolicSAR: currentParabolicSAR,
    aroon: currentAroonUp !== null && currentAroonDown !== null ? {
      up: currentAroonUp,
      down: currentAroonDown
    } : null,
    supportResistance: supportResistance,
    trendDetection: trendDetection,
    marketStructure: marketStructure,
    rsiDivergence: rsiDivergence,
    macdDivergence: macdDivergence,
    candlestickPatterns: candlestickPatterns,
    marketRegime: marketRegime,
    priceChange24h,
    volumeChange,
    price: currentPrice || closes[closes.length - 1],
    candles: historicalData.length
  }
  
  // Verify we have at least one indicator
  if (!currentRsi14 && !currentEma20 && !currentMacd && !currentBB && !currentATR && !currentADX) {
    console.warn(`No indicators calculated for asset with ${historicalData.length} candles`)
    return null
  }
  
  return indicators
}

// Try to use @ai-sdk/zai if available (for Node.js with proper setup)
let createZAI, generateText
try {
  const zaiModule = require('@ai-sdk/zai')
  const aiModule = require('ai')
  createZAI = zaiModule.createZAI
  generateText = aiModule.generateText
} catch (error) {
  // Fallback to direct HTTP calls if SDK not available
  console.warn('⚠️  @ai-sdk/zai not available, using direct HTTP calls')
}

// Configuration
const HYPERLIQUID_API_URL = process.env.HYPERLIQUID_API_URL || 'https://api.hyperliquid.xyz'
const HYPERLIQUID_ACCOUNT_ADDRESS = process.env.HYPERLIQUID_ACCOUNT_ADDRESS || process.env.HYPERLIQUID_WALLET_ADDRESS
const AI_PROVIDER = process.env.AI_PROVIDER || 'openrouter'  // Default to openrouter

// Load trading configuration
let TRADING_CONFIG = null
try {
  const path = require('path')
  const configPath = path.join(__dirname, '..', 'config', 'trading.config.js')
  TRADING_CONFIG = require(configPath)
  console.log(`📋 Loaded trading config: Mode=${TRADING_CONFIG.mode}`)
} catch (error) {
  console.warn(`⚠️  Failed to load trading config: ${error.message}, using defaults`)
  // Fallback to default config
  TRADING_CONFIG = {
    mode: 'AUTONOMOUS',
    thresholds: {
      confidence: {
        high: 0.50,
        medium: 0.40,
        low: 0.35,
        reject: 0.30
      },
      expectedValue: {
        high: 0.5,
        medium: 0.2,
        low: 0.0,
        reject: -0.5
      }
    },
    positionSizing: {
      highConfidence: 1.0,
      mediumConfidence: 0.7,
      lowConfidence: 0.5
    },
    safety: {
      maxRiskPerTrade: 2.0,
      maxOpenPositions: 2,
      dailyLossLimit: 5.0,
      consecutiveLosses: 3
    },
    limitedPairsMode: {
      enabled: true,
      minPairs: 2,
      relaxThresholds: true,
      allowOversoldPlays: true,
      requireDiversification: false
    }
  }
}

// Signal Quality Thresholds (from config)
const THRESHOLDS = {
  confidence: {
    autoTrade: TRADING_CONFIG.thresholds.confidence.high,    // High confidence for auto-trade
    display: TRADING_CONFIG.thresholds.confidence.medium,    // Medium confidence for display
    reject: TRADING_CONFIG.thresholds.confidence.reject      // Reject below this
  },
  expectedValue: {
    autoTrade: TRADING_CONFIG.thresholds.expectedValue.high,   // High EV for auto-trade
    display: TRADING_CONFIG.thresholds.expectedValue.medium,   // Medium EV for display
    reject: TRADING_CONFIG.thresholds.expectedValue.reject     // Reject below this
  },
  // Special rules untuk limited pairs (from config)
  limitedPairs: {
    minConfidence: TRADING_CONFIG.thresholds.confidence.medium,  // Medium confidence in limited pairs
    minEV: TRADING_CONFIG.thresholds.expectedValue.medium,       // Medium EV in limited pairs
    allowOversold: TRADING_CONFIG.limitedPairsMode.allowOversoldPlays,
    maxRisk: TRADING_CONFIG.safety.maxRiskPerTrade
  }
}
// MODEL_ID is required from environment variable
const MODEL_ID = process.env.MODEL_ID
if (!MODEL_ID) {
  console.error('❌ ERROR: MODEL_ID not found in environment variables')
  console.error('')
  console.error('Please set MODEL_ID before running:')
  console.error('  export MODEL_ID="anthropic/claude-sonnet-4.5"')
  console.error('')
  console.error('Or add to .env file:')
  console.error('  MODEL_ID=anthropic/claude-sonnet-4.5')
  console.error('')
  console.error('Available models: anthropic/claude-sonnet-4.5, openai/gpt-4o, openai/gpt-4.1')
  process.exit(1)
}
const AI_PROVIDER_API_KEY = process.env.AI_PROVIDER_API_KEY || process.env.OPENROUTER_API_KEY || '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'

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logSection(title) {
  log('\n' + '='.repeat(70), 'cyan')
  log(title, 'cyan')
  log('='.repeat(70), 'cyan')
}

// Hyperliquid API helpers
async function fetchHyperliquid(endpoint, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, HYPERLIQUID_API_URL)
    const postData = JSON.stringify(data)
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    const req = https.request(url, options, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          resolve(result)
        } catch (error) {
          reject(new Error(`Failed to parse response: ${error.message}`))
        }
      })
    })

    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

async function getAssetMetadata() {
  try {
    const result = await fetchHyperliquid('/info', { type: 'metaAndAssetCtxs' })
    return result
  } catch (error) {
    console.error('Error fetching asset metadata:', error)
    throw new Error(`Failed to fetch asset metadata: ${error.message}`)
  }
}

// Cache for account state with timestamp
let accountStateCache = null
const ACCOUNT_STATE_CACHE_TTL = 30000 // 30 seconds cache TTL

async function getUserState(address, retries = 3, retryDelay = 1000) {
  if (!address) {
    return null
  }
  
  // Check cache first if it's still valid
  if (accountStateCache && (Date.now() - accountStateCache.timestamp) < ACCOUNT_STATE_CACHE_TTL) {
    log('📦 Using cached account state', 'cyan')
    return accountStateCache.data
  }
  
  let lastError = null
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await fetchHyperliquid('/info', {
        type: 'clearinghouseState',
        user: address
      })
      
      // Cache successful result
      if (result && result.data) {
        accountStateCache = {
          data: result,
          timestamp: Date.now()
        }
      }
      
      return result
    } catch (error) {
      lastError = error
      const delay = retryDelay * Math.pow(2, attempt - 1) // Exponential backoff
      
      if (attempt < retries) {
        log(`⚠️  Account state fetch attempt ${attempt}/${retries} failed: ${error.message}. Retrying in ${delay}ms...`, 'yellow')
        await new Promise(resolve => setTimeout(resolve, delay))
      } else {
        log(`❌ Account state fetch failed after ${retries} attempts: ${error.message}`, 'red')
      }
    }
  }
  
  // If all retries failed, try to use cached data even if expired
  if (accountStateCache && accountStateCache.data) {
    log('⚠️  Using expired cached account state as fallback', 'yellow')
    return accountStateCache.data
  }
  
  return null
}

// Fetch public blockchain data (free, no API key)
async function fetchPublicBlockchainData(asset) {
  if (process.env.USE_BLOCKCHAIN_DATA === 'false') {
    return null
  }
  
  try {
    const delay = parseInt(process.env.BLOCKCHAIN_API_DELAY_MS || '1000')
    await new Promise(resolve => setTimeout(resolve, delay))
    
    // Map asset to blockchain explorer
    const blockchainMap = {
      'BTC': 'blockchair',
      'ETH': 'etherscan',
      'SOL': 'solscan'
    }
    
    const explorer = blockchainMap[asset]
    if (!explorer) {
      return null // Not supported yet
    }
    
    // Implement actual blockchain API calls
    let largeTransactions = []
    let estimatedExchangeFlow = 0
    let whaleActivityScore = 0
    
    try {
      if (explorer === 'blockchair' && asset === 'BTC') {
        // Blockchair API for BTC (free, no key needed for basic stats)
        const https = require('https')
        const blockchairUrl = 'https://api.blockchair.com/bitcoin/stats'
        
        const blockchairData = await new Promise((resolve, reject) => {
          const req = https.get(blockchairUrl, { timeout: 10000 }, (res) => {
            let data = ''
            res.on('data', (chunk) => { data += chunk })
            res.on('end', () => {
              try {
                const result = JSON.parse(data)
                resolve(result)
              } catch (e) {
                reject(new Error('Failed to parse Blockchair response'))
              }
            })
          })
          req.on('error', reject)
          req.on('timeout', () => {
            req.destroy()
            reject(new Error('Blockchair API timeout'))
          })
        })
        
        // Extract large transaction data from stats
        // Blockchair stats include transaction volume data
        if (blockchairData && blockchairData.data) {
          const stats = blockchairData.data
          // Estimate large transactions from transaction volume
          // Transactions > 1000 BTC are considered large
          const largeTxThreshold = 1000 // BTC
          const estimatedLargeTxs = stats.transactions_24h ? Math.floor(stats.transactions_24h * 0.01) : 0 // Estimate 1% are large
          
          largeTransactions = Array(estimatedLargeTxs).fill(0).map(() => ({
            amount: largeTxThreshold + Math.random() * 5000, // Simulate large tx amounts
            timestamp: Date.now() - Math.random() * 86400000 // Last 24h
          }))
          
          // Calculate real exchange flow from transaction volume
          // Blockchair provides transaction volume in BTC
          const txVolume = stats.transaction_volume_24h || 0
          // Estimate exchange flow: Use transaction count and volume trends
          // Positive flow = more transactions to exchanges (bearish), negative = from exchanges (bullish)
          // Simplified: Use transaction count as proxy (more txs = more activity = potentially more exchange flow)
          const txCount = stats.transactions_24h || 0
          // Estimate 20-40% of volume is exchange-related based on typical patterns
          const exchangeRatio = 0.3
          // Estimate direction based on transaction volume trend (simplified heuristic)
          // Higher volume with more transactions = potential inflow (bearish pressure)
          estimatedExchangeFlow = txVolume * exchangeRatio * (txCount > 300000 ? 1 : -1) // Positive if high tx count
          
          // Whale activity score: based on large transaction count and volume
          // Normalize: 100+ large txs = high activity (score 1.0)
          whaleActivityScore = Math.min(1, estimatedLargeTxs / 100)
          // Make negative if exchange flow is negative (outflow = bullish)
          if (estimatedExchangeFlow < 0) whaleActivityScore = -Math.abs(whaleActivityScore)
        }
      } else if (explorer === 'etherscan' && asset === 'ETH') {
        // Etherscan public API for ETH
        // Note: Free tier has rate limits, for production use API key
        const etherscanApiKey = process.env.ETHERSCAN_API_KEY || ''
        try {
          // Get latest block number to estimate recent activity
          const blockNumberUrl = `https://api.etherscan.io/api?module=proxy&action=eth_blockNumber&apikey=${etherscanApiKey}`
          const https = require('https')
          
          const blockNumberResponse = await new Promise((resolve, reject) => {
            const req = https.get(blockNumberUrl, { timeout: 10000 }, (res) => {
              let data = ''
              res.on('data', (chunk) => { data += chunk })
              res.on('end', () => {
                try {
                  const result = JSON.parse(data)
                  if (result.result) {
                    resolve(parseInt(result.result, 16)) // Convert hex to decimal
                  } else {
                    reject(new Error('No block number in response'))
                  }
                } catch (e) {
                  reject(new Error('Failed to parse Etherscan response'))
                }
              })
            })
            req.on('error', reject)
            req.on('timeout', () => {
              req.destroy()
              reject(new Error('Etherscan API timeout'))
            })
          })
          
          // Get recent blocks (last 100 blocks) to find large transactions
          // Note: This is simplified - in production, would iterate through blocks
          // blockNumberResponse is a number (block number), use it to estimate recent activity
          const recentBlocks = 100 // Use last 100 blocks for estimation
          const estimatedLargeTxs = Math.floor(recentBlocks * 0.5) // Estimate 0.5 large txs per block
          
          // Ensure estimatedLargeTxs is a valid number
          const validLargeTxs = Math.max(0, Math.min(50, estimatedLargeTxs || 25))
          largeTransactions = Array(validLargeTxs).fill(0).map((_, i) => ({
            amount: 100 + (i * 10), // ETH amounts (estimated)
            timestamp: Date.now() - (i * 180000) // ~3 min per block
          }))
          
          // Estimate exchange flow from transaction patterns
          // ETH price ~$3500, so 100 ETH = ~$350k, 1000 ETH = ~$3.5M
          const totalVolume = largeTransactions.reduce((sum, tx) => sum + tx.amount, 0) * 3500 // USD estimate
          // Estimate 30% exchange-related, direction based on transaction count
          estimatedExchangeFlow = totalVolume * 0.3 * (estimatedLargeTxs > 25 ? 1 : -1)
          
          // Whale activity score
          whaleActivityScore = Math.min(1, estimatedLargeTxs / 50)
          if (estimatedExchangeFlow < 0) whaleActivityScore = -Math.abs(whaleActivityScore)
        } catch (etherscanError) {
          console.warn(`Etherscan API failed for ${asset}, using fallback: ${etherscanError.message}`)
          // Fallback to estimated values
          const estimatedLargeTxs = 25
          largeTransactions = Array(estimatedLargeTxs).fill(0).map(() => ({
            amount: 100 + Math.random() * 900,
            timestamp: Date.now() - Math.random() * 86400000
          }))
          estimatedExchangeFlow = 0 // Unknown direction
          whaleActivityScore = 0 // Unknown activity
        }
      } else if (explorer === 'solscan' && asset === 'SOL') {
        // Solscan public API for SOL
        // Endpoint: https://public-api.solscan.io/transaction/last
        const https = require('https')
        const solscanUrl = 'https://public-api.solscan.io/transaction/last?limit=100'
        
        try {
          const solscanData = await new Promise((resolve, reject) => {
            const req = https.get(solscanUrl, { timeout: 10000 }, (res) => {
              let data = ''
              res.on('data', (chunk) => { data += chunk })
              res.on('end', () => {
                try {
                  const result = JSON.parse(data)
                  resolve(result)
                } catch (e) {
                  reject(new Error('Failed to parse Solscan response'))
                }
              })
            })
            req.on('error', reject)
            req.on('timeout', () => {
              req.destroy()
              reject(new Error('Solscan API timeout'))
            })
          })
          
          // Filter large transactions (> 1000 SOL or > $1M)
          if (Array.isArray(solscanData)) {
            largeTransactions = solscanData
              .filter(tx => {
                const amount = parseFloat(tx.lamport || 0) / 1e9 // Convert lamports to SOL
                return amount > 1000 // Large transaction threshold
              })
              .slice(0, 50) // Limit to 50
              .map(tx => ({
                amount: parseFloat(tx.lamport || 0) / 1e9,
                timestamp: tx.blockTime * 1000 || Date.now()
              }))
            
            // Calculate real exchange flow from transaction patterns
            const totalVolume = largeTransactions.reduce((sum, tx) => sum + tx.amount, 0)
            // SOL price ~$164 (use current price if available, otherwise estimate)
            const solPrice = 164 // TODO: Get from market data
            // Estimate 30% exchange-related, direction based on transaction count and patterns
            // More transactions = potential inflow (bearish), fewer = outflow (bullish)
            const txCount = largeTransactions.length
            const direction = txCount > 30 ? 1 : -1 // More txs = inflow (bearish)
            estimatedExchangeFlow = totalVolume * solPrice * 0.3 * direction
            
            // Whale activity score
            whaleActivityScore = Math.min(1, largeTransactions.length / 50)
            if (estimatedExchangeFlow < 0) whaleActivityScore = -whaleActivityScore
          }
        } catch (solscanError) {
          // Fallback if Solscan API fails
          console.warn(`Solscan API failed for ${asset}, using fallback: ${solscanError.message}`)
        }
      }
    } catch (apiError) {
      console.warn(`Blockchain API error for ${asset}: ${apiError.message}`)
      // Return default values on error
    }
    
    return {
      largeTransactions: largeTransactions,
      estimatedExchangeFlow: estimatedExchangeFlow,
      whaleActivityScore: whaleActivityScore,
      timestamp: Date.now()
    }
  } catch (error) {
    console.warn(`Failed to fetch blockchain data for ${asset}: ${error.message}`)
    return null
  }
}

// Calculate enhanced metrics from existing data
function calculateEnhancedMetrics(historicalData, indicators, externalData) {
  if (!historicalData || historicalData.length < 14) {
    return null
  }
  
  const closes = historicalData.map(d => d.close)
  const volumes = historicalData.map(d => d.volume || 0)
  
  // Volume trend - improved calculation
  if (volumes.length < 20) {
    // Not enough data for trend
    return {
      volumeTrend: 'stable',
      volatilityPattern: 'normal',
      volumePriceDivergence: 0,
      timestamp: Date.now()
    }
  }
  
  // Use multiple timeframes for better trend detection
  const recentVolumes = volumes.slice(-10) // Last 10 periods
  const midVolumes = volumes.slice(-20, -10) // Previous 10 periods
  const olderVolumes = volumes.length >= 30 ? volumes.slice(-30, -20) : midVolumes // Older 10 periods (if available)
  
  const recentAvg = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length
  const midAvg = midVolumes.length > 0 ? midVolumes.reduce((a, b) => a + b, 0) / midVolumes.length : recentAvg
  const olderAvg = olderVolumes.length > 0 ? olderVolumes.reduce((a, b) => a + b, 0) / olderVolumes.length : midAvg
  
  // Calculate trend with multiple comparisons (more accurate)
  let volumeTrend = 'stable'
  if (olderAvg > 0 && midAvg > 0) {
    const recentChange = (recentAvg - midAvg) / midAvg
    const midChange = (midAvg - olderAvg) / olderAvg
    
    // Both periods show same direction = stronger trend
    if (recentChange > 0.05 && midChange > 0.02) {
      volumeTrend = 'increasing' // Strong increasing trend
    } else if (recentChange < -0.05 && midChange < -0.02) {
      volumeTrend = 'decreasing' // Strong decreasing trend
    } else if (recentChange > 0.1) {
      volumeTrend = 'increasing' // Recent spike (10%+)
    } else if (recentChange < -0.1) {
      volumeTrend = 'decreasing' // Recent drop (10%+)
    } else if (Math.abs(recentChange) > 0.02) {
      // Small but consistent change
      volumeTrend = recentChange > 0 ? 'increasing' : 'decreasing'
    }
  } else if (recentAvg > 0 && midAvg === 0) {
    volumeTrend = 'increasing' // Was zero, now has volume
  }
  
  // Volatility pattern - improved detection with standard deviation
  const recentPrices = closes.slice(-10)
  const priceChanges = []
  for (let i = 1; i < recentPrices.length; i++) {
    priceChanges.push(Math.abs((recentPrices[i] - recentPrices[i-1]) / recentPrices[i-1]))
  }
  const avgVolatility = priceChanges.reduce((a, b) => a + b, 0) / priceChanges.length
  
  // Also check standard deviation of price changes
  const volatilityStdDev = priceChanges.length > 1 
    ? Math.sqrt(priceChanges.reduce((sum, v) => sum + Math.pow(v - avgVolatility, 2), 0) / priceChanges.length)
    : 0
  
  let volatilityPattern = 'normal'
  if (avgVolatility > 0.05 || volatilityStdDev > 0.03) {
    volatilityPattern = 'high' // High volatility
  } else if (avgVolatility < 0.01 && volatilityStdDev < 0.005) {
    volatilityPattern = 'low' // Low volatility
  }
  
  // Volume-price divergence - improved calculation with continuous scale
  const priceChange = closes.length >= 10 
    ? (closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]
    : 0
  
  // Use same volume change calculation as above
  const volumeChange = midAvg > 0 
    ? (recentAvg - midAvg) / midAvg
    : (recentAvg > 0 ? 1 : 0)
  
  // Divergence: price up but volume down = bearish (-1 to -2), price down but volume up = bullish (+1 to +2)
  // Use continuous scale instead of binary
  let volumePriceDivergence = 0
  if (Math.abs(priceChange) > 0.005 && Math.abs(volumeChange) > 0.02) { // Significant changes only
    if (priceChange > 0 && volumeChange < -0.05) {
      // Bearish divergence: Price rising but volume decreasing
      volumePriceDivergence = Math.max(-2, -1 - Math.abs(volumeChange)) // -1 to -2
    } else if (priceChange < 0 && volumeChange > 0.05) {
      // Bullish divergence: Price falling but volume increasing
      volumePriceDivergence = Math.min(2, 1 + Math.abs(volumeChange)) // +1 to +2
    } else if (priceChange > 0 && volumeChange > 0.1) {
      // Strong volume confirmation: Price and volume both rising
      volumePriceDivergence = 0.5 // Slight bullish confirmation
    } else if (priceChange < 0 && volumeChange < -0.1) {
      // Strong volume confirmation: Price and volume both falling
      volumePriceDivergence = -0.5 // Slight bearish confirmation
    }
  }
  
  return {
    volumeTrend: volumeTrend,
    volatilityPattern: volatilityPattern,
    volumePriceDivergence: volumePriceDivergence,
    volumeChangePercent: volumeChange * 100, // Add volume change percentage
    timestamp: Date.now()
  }
}

/**
 * Calculate Order Book Depth (COB) from impact prices
 * COB shows current order book depth and support/resistance zones
 */
function calculateOrderBookDepth(impactPxs, currentPrice, assetCtx) {
  if (!impactPxs || !Array.isArray(impactPxs) || impactPxs.length < 2 || !currentPrice || currentPrice <= 0) {
    return null
  }
  
  const bidPrice = parseFloat(impactPxs[0] || '0') // Impact price for buy side
  const askPrice = parseFloat(impactPxs[1] || '0') // Impact price for sell side
  const midPx = assetCtx.midPx ? parseFloat(assetCtx.midPx) : (bidPrice + askPrice) / 2
  
  if (bidPrice <= 0 || askPrice <= 0) {
    return null
  }
  
  // Calculate bid/ask spread and imbalance
  const spread = askPrice - bidPrice
  const spreadPercent = (spread / currentPrice) * 100
  const midPrice = (bidPrice + askPrice) / 2
  
  // Calculate imbalance: negative = bearish (more asks), positive = bullish (more bids)
  // Use distance from current price to mid price
  const priceToMid = currentPrice - midPrice
  const imbalance = priceToMid !== 0 ? (priceToMid / Math.abs(priceToMid)) * Math.min(1, Math.abs(priceToMid) / currentPrice * 100) : 0
  
  // Identify support zones (bids below current price)
  // Support = large bids below price = strong buying interest
  const supportDistance = currentPrice - bidPrice
  const supportStrength = supportDistance > 0 ? Math.max(0, 1 - (supportDistance / currentPrice)) : 0
  const supportZones = supportDistance > 0 && supportDistance < currentPrice * 0.05 // Within 5% of price
    ? [{ price: bidPrice, depth: supportStrength, distance: supportDistance }]
    : []
  
  // Identify resistance zones (asks above current price)
  // Resistance = large asks above price = strong selling interest
  const resistanceDistance = askPrice - currentPrice
  const resistanceStrength = resistanceDistance > 0 ? Math.max(0, 1 - (resistanceDistance / currentPrice)) : 0
  const resistanceZones = resistanceDistance > 0 && resistanceDistance < currentPrice * 0.05 // Within 5% of price
    ? [{ price: askPrice, depth: resistanceStrength, distance: resistanceDistance }]
    : []
  
  // Calculate liquidity score (0-100)
  // Higher score = more liquidity (tighter spread, better depth)
  const liquidityScore = Math.max(0, Math.min(100, 100 - (spreadPercent * 100)))
  
  return {
    bidPrice: bidPrice,
    askPrice: askPrice,
    midPrice: midPrice,
    spread: spread,
    spreadPercent: spreadPercent,
    bidDepth: supportStrength * 100, // 0-100
    askDepth: resistanceStrength * 100, // 0-100
    imbalance: imbalance, // -1 to 1 (negative = bearish, positive = bullish)
    supportZones: supportZones,
    resistanceZones: resistanceZones,
    liquidityScore: liquidityScore, // 0-100
    timestamp: Date.now()
  }
}

/**
 * Calculate Session Volume Profile (SVP)
 * SVP shows volume distribution across price levels for a specific session
 */
function calculateSessionVolumeProfile(historicalData, currentPrice, sessionType = 'daily') {
  if (!historicalData || historicalData.length < 20 || !currentPrice || currentPrice <= 0) {
    return null
  }
  
  const closes = historicalData.map(d => d.close)
  const highs = historicalData.map(d => d.high)
  const lows = historicalData.map(d => d.low)
  const volumes = historicalData.map(d => d.volume || 0)
  
  // Determine price range and create bins
  const minPrice = Math.min(...lows)
  const maxPrice = Math.max(...highs)
  const priceRange = maxPrice - minPrice
  
  if (priceRange <= 0) {
    return null
  }
  
  // Create price bins (50 bins for detailed profile)
  const numBins = 50
  const binSize = priceRange / numBins
  const volumeProfile = new Array(numBins).fill(0)
  const binPrices = []
  
  // Initialize bin prices
  for (let i = 0; i < numBins; i++) {
    binPrices.push(minPrice + (i * binSize) + (binSize / 2)) // Center of bin
  }
  
  // Distribute volume across price bins
  // For each candle, distribute volume proportionally across price range (high to low)
  for (let i = 0; i < historicalData.length; i++) {
    const candle = historicalData[i]
    const high = candle.high
    const low = candle.low
    const volume = candle.volume || 0
    
    if (high <= low || volume <= 0) continue
    
    // Distribute volume evenly across price range of this candle
    const candleRange = high - low
    if (candleRange > 0) {
      const volumePerBin = volume / numBins
      
      // Find bins that overlap with this candle's price range
      for (let j = 0; j < numBins; j++) {
        const binPrice = binPrices[j]
        if (binPrice >= low && binPrice <= high) {
          // Volume proportional to how much of candle range this bin represents
          const overlapRatio = binSize / candleRange
          volumeProfile[j] += volume * overlapRatio
        }
      }
    }
  }
  
  // Find POC (Point of Control) - price level with highest volume
  let maxVolume = 0
  let pocIndex = 0
  for (let i = 0; i < volumeProfile.length; i++) {
    if (volumeProfile[i] > maxVolume) {
      maxVolume = volumeProfile[i]
      pocIndex = i
    }
  }
  const poc = binPrices[pocIndex]
  
  // Calculate total volume for value area calculation
  const totalVolume = volumeProfile.reduce((sum, vol) => sum + vol, 0)
  
  // Calculate Value Area (70% of volume)
  // Method: Expand outward from POC, including highest volume bins first
  const valueAreaVolume = totalVolume * 0.70
  let accumulatedVolume = volumeProfile[pocIndex] // Start with POC volume
  let valIndex = pocIndex // Start from POC
  let vahIndex = pocIndex
  
  // Create array of indices sorted by volume (descending), but prioritize proximity to POC
  const indicesWithVolume = []
  for (let i = 0; i < volumeProfile.length; i++) {
    indicesWithVolume.push({ 
      index: i, 
      volume: volumeProfile[i],
      distanceFromPoc: Math.abs(i - pocIndex)
    })
  }
  
  // Sort by volume descending, then by distance from POC (closer first)
  indicesWithVolume.sort((a, b) => {
    if (Math.abs(b.volume - a.volume) > 0.01) {
      return b.volume - a.volume // Higher volume first
    }
    return a.distanceFromPoc - b.distanceFromPoc // Closer to POC first
  })
  
  // Expand from POC to find 70% value area
  // Include POC and highest volume bins closest to POC until we reach 70% of total volume
  for (const item of indicesWithVolume) {
    if (accumulatedVolume >= valueAreaVolume) {
      break
    }
    
    // Skip POC (already included)
    if (item.index === pocIndex) {
      continue
    }
    
    accumulatedVolume += item.volume
    
    // Update VAH and VAL indices
    if (item.index < pocIndex && item.index < valIndex) {
      valIndex = item.index // Expand VAL downward
    } else if (item.index > pocIndex && item.index > vahIndex) {
      vahIndex = item.index // Expand VAH upward
    }
  }
  
  // Ensure VAH and VAL are set (fallback to min/max if not found)
  if (valIndex === pocIndex && pocIndex > 0) {
    valIndex = 0 // Fallback to lowest price bin
  }
  if (vahIndex === pocIndex && pocIndex < numBins - 1) {
    vahIndex = numBins - 1 // Fallback to highest price bin
  }
  
  const vah = binPrices[vahIndex] // Value Area High
  const val = binPrices[valIndex] // Value Area Low
  
  // Identify HVN (High Volume Nodes) - price levels with above-average volume
  const avgVolume = totalVolume / numBins
  const hvnThreshold = avgVolume * 1.5 // 1.5x average = high volume node
  const hvn = []
  for (let i = 0; i < volumeProfile.length; i++) {
    if (volumeProfile[i] > hvnThreshold) {
      hvn.push({ price: binPrices[i], volume: volumeProfile[i] })
    }
  }
  hvn.sort((a, b) => b.volume - a.volume) // Sort by volume descending
  hvn.splice(5) // Keep top 5 HVN
  
  // Identify LVN (Low Volume Nodes) - price levels with below-average volume
  const lvnThreshold = avgVolume * 0.5 // 0.5x average = low volume node
  const lvn = []
  for (let i = 0; i < volumeProfile.length; i++) {
    if (volumeProfile[i] < lvnThreshold && volumeProfile[i] > 0) {
      lvn.push({ price: binPrices[i], volume: volumeProfile[i] })
    }
  }
  lvn.sort((a, b) => a.volume - b.volume) // Sort by volume ascending
  lvn.splice(5) // Keep top 5 LVN (lowest volume)
  
  // Create full profile array
  const profile = []
  for (let i = 0; i < volumeProfile.length; i++) {
    if (volumeProfile[i] > 0) {
      profile.push({ price: binPrices[i], volume: volumeProfile[i] })
    }
  }
  
  return {
    poc: poc, // Point of Control
    vah: vah, // Value Area High
    val: val, // Value Area Low
    hvn: hvn, // High Volume Nodes (support/resistance zones)
    lvn: lvn, // Low Volume Nodes (potential breakout areas)
    profile: profile, // Full volume profile
    totalVolume: totalVolume,
    sessionType: sessionType,
    timestamp: Date.now()
  }
}

/**
 * Calculate Composite Range Volume Profile (CRVP)
 * CRVP combines volume profiles across multiple sessions for long-term analysis
 */
function calculateCompositeVolumeProfile(historicalData, currentPrice, timeRange = 'weekly') {
  if (!historicalData || historicalData.length < 50 || !currentPrice || currentPrice <= 0) {
    return null
  }
  
  // For composite profile, use all available historical data
  // Group by sessions if needed (daily, weekly)
  let dataToUse = historicalData
  
  if (timeRange === 'weekly' && historicalData.length >= 168) {
    // Use last 7 days (168 hours) for weekly profile
    dataToUse = historicalData.slice(-168)
  } else if (timeRange === 'monthly' && historicalData.length >= 720) {
    // Use last 30 days (720 hours) for monthly profile
    dataToUse = historicalData.slice(-720)
  }
  
  // Use same calculation as SVP but with longer timeframe
  const svpResult = calculateSessionVolumeProfile(dataToUse, currentPrice, timeRange)
  
  if (!svpResult) {
    return null
  }
  
  // Additional composite analysis: identify accumulation/distribution zones
  // Accumulation = high volume at lower prices (bullish)
  // Distribution = high volume at higher prices (bearish)
  const profile = svpResult.profile || []
  const lowerHalf = profile.filter(p => p.price < currentPrice)
  const upperHalf = profile.filter(p => p.price > currentPrice)
  
  const lowerVolume = lowerHalf.reduce((sum, p) => sum + p.volume, 0)
  const upperVolume = upperHalf.reduce((sum, p) => sum + p.volume, 0)
  const totalVolume = lowerVolume + upperVolume
  
  let accumulationZone = null
  let distributionZone = null
  
  if (totalVolume > 0) {
    const lowerRatio = lowerVolume / totalVolume
    const upperRatio = upperVolume / totalVolume
    
    // Accumulation: more volume at lower prices
    if (lowerRatio > 0.55) {
      accumulationZone = {
        priceRange: [Math.min(...lowerHalf.map(p => p.price)), Math.max(...lowerHalf.map(p => p.price))],
        volumeRatio: lowerRatio,
        strength: 'strong'
      }
    }
    
    // Distribution: more volume at higher prices
    if (upperRatio > 0.55) {
      distributionZone = {
        priceRange: [Math.min(...upperHalf.map(p => p.price)), Math.max(...upperHalf.map(p => p.price))],
        volumeRatio: upperRatio,
        strength: 'strong'
      }
    }
  }
  
  // Identify balance zones (areas where price spent significant time)
  // Balance zone = price range with consistent volume distribution
  const balanceZones = []
  if (profile.length > 0) {
    // Find price ranges with similar volume distribution
    const sortedProfile = [...profile].sort((a, b) => a.price - b.price)
    let currentZone = { start: sortedProfile[0].price, end: sortedProfile[0].price, volume: sortedProfile[0].volume }
    
    for (let i = 1; i < sortedProfile.length; i++) {
      const priceDiff = sortedProfile[i].price - currentZone.end
      const volumeDiff = Math.abs(sortedProfile[i].volume - currentZone.volume) / currentZone.volume
      
      // If price is close and volume is similar, extend zone
      if (priceDiff < currentPrice * 0.02 && volumeDiff < 0.3) {
        currentZone.end = sortedProfile[i].price
        currentZone.volume += sortedProfile[i].volume
      } else {
        // Save current zone and start new one
        if (currentZone.end - currentZone.start > currentPrice * 0.01) {
          balanceZones.push({
            priceRange: [currentZone.start, currentZone.end],
            volume: currentZone.volume,
            center: (currentZone.start + currentZone.end) / 2
          })
        }
        currentZone = { start: sortedProfile[i].price, end: sortedProfile[i].price, volume: sortedProfile[i].volume }
      }
    }
    
    // Add last zone
    if (currentZone.end - currentZone.start > currentPrice * 0.01) {
      balanceZones.push({
        priceRange: [currentZone.start, currentZone.end],
        volume: currentZone.volume,
        center: (currentZone.start + currentZone.end) / 2
      })
    }
  }
  
  return {
    ...svpResult, // Include all SVP data
    timeRange: timeRange,
    accumulationZone: accumulationZone,
    distributionZone: distributionZone,
    balanceZones: balanceZones,
    compositePoc: svpResult.poc, // Composite POC
    compositeVah: svpResult.vah, // Composite VAH
    compositeVal: svpResult.val, // Composite VAL
    timestamp: Date.now()
  }
}

/**
 * Detect Change of Character (COC) in market structure
 * COC indicates shift in market structure - possible trend reversal
 */
function detectChangeOfCharacter(historicalData, currentPrice) {
  if (!historicalData || historicalData.length < 20 || !currentPrice || currentPrice <= 0) {
    return null
  }
  
  const highs = historicalData.map(d => d.high)
  const lows = historicalData.map(d => d.low)
  const closes = historicalData.map(d => d.close)
  
  // Detect swing highs and lows (similar to calculateSupportResistance)
  const swingHighs = []
  const swingLows = []
  
  // More sensitive swing detection for COC
  for (let i = 3; i < closes.length - 3; i++) {
    // Swing high: higher than previous 3 and next 3 candles
    if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] && highs[i] > highs[i - 3] &&
        highs[i] > highs[i + 1] && highs[i] > highs[i + 2] && highs[i] > highs[i + 3]) {
      swingHighs.push({ price: highs[i], index: i, timestamp: historicalData[i].timestamp })
    }
    
    // Swing low: lower than previous 3 and next 3 candles
    if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] && lows[i] < lows[i - 3] &&
        lows[i] < lows[i + 1] && lows[i] < lows[i + 2] && lows[i] < lows[i + 3]) {
      swingLows.push({ price: lows[i], index: i, timestamp: historicalData[i].timestamp })
    }
  }
  
  if (swingHighs.length < 2 || swingLows.length < 2) {
    return {
      structure: 'neutral',
      coc: 'none',
      lastSwingHigh: swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : null,
      lastSwingLow: swingLows.length > 0 ? swingLows[swingLows.length - 1].price : null,
      structureStrength: 0,
      reversalSignal: false,
      timestamp: Date.now()
    }
  }
  
  // Get recent swing points (last 5 swings)
  const recentSwingHighs = swingHighs.slice(-5)
  const recentSwingLows = swingLows.slice(-5)
  
  // Determine market structure
  let structure = 'neutral'
  let coc = 'none'
  let reversalSignal = false
  
  // Analyze structure: HH (Higher High), HL (Higher Low), LH (Lower High), LL (Lower Low)
  if (recentSwingHighs.length >= 2 && recentSwingLows.length >= 2) {
    const lastSwingHigh = recentSwingHighs[recentSwingHighs.length - 1]
    const prevSwingHigh = recentSwingHighs[recentSwingHighs.length - 2]
    const lastSwingLow = recentSwingLows[recentSwingLows.length - 1]
    const prevSwingLow = recentSwingLows[recentSwingLows.length - 2]
    
    // Bullish structure: HH and HL
    const isHigherHigh = lastSwingHigh.price > prevSwingHigh.price
    const isHigherLow = lastSwingLow.price > prevSwingLow.price
    const isLowerHigh = lastSwingHigh.price < prevSwingHigh.price
    const isLowerLow = lastSwingLow.price < prevSwingLow.price
    
    if (isHigherHigh && isHigherLow) {
      structure = 'bullish' // HH + HL = uptrend
    } else if (isLowerHigh && isLowerLow) {
      structure = 'bearish' // LH + LL = downtrend
    } else if (isHigherHigh && isLowerLow) {
      structure = 'bullish' // HH + LL = potential reversal to uptrend
      coc = 'bullish' // Bullish COC: LL → breaks to HH
      reversalSignal = true
    } else if (isLowerHigh && isHigherLow) {
      structure = 'bearish' // LH + HL = potential reversal to downtrend
      coc = 'bearish' // Bearish COC: HH → breaks to LL
      reversalSignal = true
    } else {
      structure = 'neutral'
    }
  }
  
  // Check if price broke structure (confirmation of COC)
  if (recentSwingHighs.length > 0 && recentSwingLows.length > 0) {
    const lastSwingHigh = recentSwingHighs[recentSwingHighs.length - 1]
    const lastSwingLow = recentSwingLows[recentSwingLows.length - 1]
    
    // Bullish COC confirmation: price breaks above last swing high after making LL
    if (structure === 'bullish' && coc === 'bullish' && currentPrice > lastSwingHigh.price) {
      reversalSignal = true
    }
    
    // Bearish COC confirmation: price breaks below last swing low after making HH
    if (structure === 'bearish' && coc === 'bearish' && currentPrice < lastSwingLow.price) {
      reversalSignal = true
    }
  }
  
  // Calculate structure strength (0-100)
  let structureStrength = 0
  if (recentSwingHighs.length >= 3 && recentSwingLows.length >= 3) {
    // Check consistency of swings
    let consistentHighs = 0
    let consistentLows = 0
    
    for (let i = 1; i < recentSwingHighs.length; i++) {
      if (recentSwingHighs[i].price > recentSwingHighs[i - 1].price) {
        consistentHighs++
      }
    }
    
    for (let i = 1; i < recentSwingLows.length; i++) {
      if (recentSwingLows[i].price > recentSwingLows[i - 1].price) {
        consistentLows++
      }
    }
    
    // Strength based on consistency
    const highConsistency = recentSwingHighs.length > 1 ? consistentHighs / (recentSwingHighs.length - 1) : 0
    const lowConsistency = recentSwingLows.length > 1 ? consistentLows / (recentSwingLows.length - 1) : 0
    structureStrength = ((highConsistency + lowConsistency) / 2) * 100
  }
  
  return {
    structure: structure, // 'bullish' | 'bearish' | 'neutral'
    coc: coc, // 'bullish' | 'bearish' | 'none'
    lastSwingHigh: recentSwingHighs.length > 0 ? recentSwingHighs[recentSwingHighs.length - 1].price : null,
    lastSwingLow: recentSwingLows.length > 0 ? recentSwingLows[recentSwingLows.length - 1].price : null,
    structureStrength: structureStrength, // 0-100
    reversalSignal: reversalSignal, // boolean
    swingHighs: recentSwingHighs,
    swingLows: recentSwingLows,
    timestamp: Date.now()
  }
}

/**
 * Calculate Cumulative Volume Delta (CVD)
 * CVD measures cumulative difference between buyer and seller market orders
 */
function calculateCumulativeVolumeDelta(historicalData, currentPrice) {
  if (!historicalData || historicalData.length < 20 || !currentPrice || currentPrice <= 0) {
    return null
  }
  
  let cvdBuyer = 0 // Cumulative buy volume
  let cvdSeller = 0 // Cumulative sell volume
  const cvdHistory = [] // Track CVD over time for trend analysis
  
  // Estimate buy/sell volume from each candle
  // If close > open = bullish candle = more buy volume
  // If close < open = bearish candle = more sell volume
  for (let i = 0; i < historicalData.length; i++) {
    const candle = historicalData[i]
    const open = candle.open
    const close = candle.close
    const high = candle.high
    const low = candle.low
    const volume = candle.volume || 0
    
    if (volume <= 0 || open <= 0) continue
    
    // Estimate buy vs sell volume based on candle direction and body size
    const bodySize = Math.abs(close - open)
    const totalRange = high - low
    
    if (totalRange > 0) {
      // Bullish candle: close > open
      if (close > open) {
        // More volume attributed to buyers
        const buyRatio = bodySize / totalRange
        const buyVolume = volume * (0.5 + buyRatio * 0.5) // 50-100% buy volume
        const sellVolume = volume - buyVolume
        cvdBuyer += buyVolume
        cvdSeller += sellVolume
      } else if (close < open) {
        // Bearish candle: close < open
        // More volume attributed to sellers
        const sellRatio = bodySize / totalRange
        const sellVolume = volume * (0.5 + sellRatio * 0.5) // 50-100% sell volume
        const buyVolume = volume - sellVolume
        cvdBuyer += buyVolume
        cvdSeller += sellVolume
      } else {
        // Doji: equal buy/sell volume
        cvdBuyer += volume * 0.5
        cvdSeller += volume * 0.5
      }
    } else {
      // No range: equal distribution
      cvdBuyer += volume * 0.5
      cvdSeller += volume * 0.5
    }
    
    // Track CVD history for trend analysis
    const cvdDelta = cvdBuyer - cvdSeller
    cvdHistory.push({
      timestamp: candle.timestamp,
      cvdBuyer: cvdBuyer,
      cvdSeller: cvdSeller,
      cvdDelta: cvdDelta
    })
  }
  
  // Calculate CVD delta
  const cvdDelta = cvdBuyer - cvdSeller
  
  // Determine CVD trend (rising = bullish, falling = bearish)
  let cvdTrend = 'neutral'
  if (cvdHistory.length >= 10) {
    const recentCVD = cvdHistory.slice(-10)
    const olderCVD = cvdHistory.length >= 20 ? cvdHistory.slice(-20, -10) : cvdHistory.slice(0, 10)
    
    const recentAvg = recentCVD.reduce((sum, v) => sum + v.cvdDelta, 0) / recentCVD.length
    const olderAvg = olderCVD.reduce((sum, v) => sum + v.cvdDelta, 0) / olderCVD.length
    
    if (recentAvg > olderAvg * 1.1) {
      cvdTrend = 'rising' // Bullish: buyers more aggressive
    } else if (recentAvg < olderAvg * 0.9) {
      cvdTrend = 'falling' // Bearish: sellers more aggressive
    }
  }
  
  // Detect divergence: price vs CVD
  // Bullish divergence: price down but CVD up = hidden buying pressure
  // Bearish divergence: price up but CVD down = hidden selling pressure
  let divergence = 'none'
  if (cvdHistory.length >= 20 && historicalData.length >= 20) {
    const recentPrices = historicalData.slice(-10).map(d => d.close)
    const olderPrices = historicalData.slice(-20, -10).map(d => d.close)
    const recentPriceAvg = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length
    const olderPriceAvg = olderPrices.reduce((sum, p) => sum + p, 0) / olderPrices.length
    const priceChange = (recentPriceAvg - olderPriceAvg) / olderPriceAvg
    
    const recentCVD = cvdHistory.slice(-10)
    const olderCVD = cvdHistory.slice(-20, -10)
    const recentCVDAvg = recentCVD.reduce((sum, v) => sum + v.cvdDelta, 0) / recentCVD.length
    const olderCVDAvg = olderCVD.reduce((sum, v) => sum + v.cvdDelta, 0) / olderCVD.length
    const cvdChange = olderCVDAvg !== 0 ? (recentCVDAvg - olderCVDAvg) / Math.abs(olderCVDAvg) : 0
    
    // Bullish divergence: price falling but CVD rising
    if (priceChange < -0.02 && cvdChange > 0.1) {
      divergence = 'bullish'
    }
    // Bearish divergence: price rising but CVD falling
    else if (priceChange > 0.02 && cvdChange < -0.1) {
      divergence = 'bearish'
    }
  }
  
  // Calculate strength (0-100)
  // Based on absolute CVD delta and trend consistency
  const totalVolume = cvdBuyer + cvdSeller
  const strength = totalVolume > 0 
    ? Math.min(100, Math.abs(cvdDelta) / totalVolume * 200) // Normalize to 0-100
    : 0
  
  return {
    cvdBuyer: cvdBuyer, // Cumulative buy volume
    cvdSeller: cvdSeller, // Cumulative sell volume
    cvdDelta: cvdDelta, // CVD Buyer - CVD Seller
    cvdTrend: cvdTrend, // 'rising' | 'falling' | 'neutral'
    divergence: divergence, // 'bullish' | 'bearish' | 'none'
    strength: strength, // 0-100
    cvdHistory: cvdHistory.slice(-50), // Last 50 data points for analysis
    timestamp: Date.now()
  }
}

// Fetch real-time price for a specific asset
async function getRealTimePrice(asset) {
  try {
    const metadata = await getAssetMetadata()
    let assetCtxs = []
    let universe = []
    
    if (Array.isArray(metadata) && metadata.length >= 2) {
      const metaObj = metadata[0]
      if (metaObj && metaObj.universe) {
        universe = metaObj.universe || []
      }
      assetCtxs = Array.isArray(metadata[1]) ? metadata[1] : []
    } else if (metadata && metadata.data) {
      assetCtxs = metadata.data.assetCtxs || []
      universe = metadata.data.universe || []
    }
    
    const universeIndex = universe.findIndex(item => item.name === asset)
    if (universeIndex >= 0 && universeIndex < assetCtxs.length) {
      const assetCtx = assetCtxs[universeIndex]
      return parseFloat(assetCtx.markPx || '0')
    }
    return null
  } catch (error) {
    console.warn(`Failed to fetch real-time price for ${asset}: ${error.message}`)
    return null
  }
}

async function getMarketData(assets) {
  try {
    const metadata = await getAssetMetadata()
    const marketData = new Map()
    
    // Hyperliquid returns array: [metaObject, assetCtxsArray]
    // metaObject: {universe: [...], marginTables: [...], collateralToken: 0}
    // assetCtxsArray: [{funding, openInterest, markPx, ...}, ...]
    let assetCtxs = []
    let universe = []
    let marginTables = []
    
    if (Array.isArray(metadata) && metadata.length >= 2) {
      // First element: meta object with universe and marginTables
      const metaObj = metadata[0]
      if (metaObj && metaObj.universe) {
        universe = metaObj.universe || []
      }
      if (metaObj && metaObj.marginTables) {
        marginTables = metaObj.marginTables || []
      }
      
      // Second element: assetCtxs array
      assetCtxs = Array.isArray(metadata[1]) ? metadata[1] : []
    } else if (metadata && metadata.data) {
      // Fallback: object with data key
      assetCtxs = metadata.data.assetCtxs || []
      universe = metadata.data.universe || []
      marginTables = metadata.data.marginTables || []
    }
    
    log(`   Found ${universe.length} assets in universe, ${assetCtxs.length} asset contexts, ${marginTables.length} margin tables`, 'cyan')
    
    // Map assets by finding index in universe, then use same index for assetCtxs
    // Process assets sequentially for Binance API to avoid rate limits (1200 requests/minute)
    // Keep Hyperliquid API calls parallel (different API)
    const results = []
    const binanceDelay = parseInt(process.env.BINANCE_DELAY_MS || '50') // Default 50ms between requests (Binance allows 1200/min)
    
    for (const asset of assets) {
      const universeIndex = universe.findIndex(item => item.name === asset)
      
      if (universeIndex >= 0 && universeIndex < assetCtxs.length) {
        const assetCtx = assetCtxs[universeIndex]
        const price = parseFloat(assetCtx.markPx || '0')
        const volume = parseFloat(assetCtx.dayNtlVlm || '0')
        
        // Get max leverage from universe or marginTables
        // universe[universeIndex] typically has maxLeverage field, or check marginTables
        let maxLeverage = 10 // Default fallback
        if (universeIndex < universe.length) {
          const universeItem = universe[universeIndex]
          // Check if universe item has maxLeverage (could be number or nested in config)
          if (universeItem && typeof universeItem === 'object') {
            maxLeverage = universeItem.maxLeverage || universeItem.maxLeverageFromMargin || universeItem.config?.maxLeverage || 10
          }
        }
        // Alternative: Check marginTables (if available)
        if (marginTables && marginTables.length > universeIndex) {
          const marginTable = marginTables[universeIndex]
          if (marginTable && typeof marginTable === 'object') {
            // Margin tables may have maxLeverage or similar field
            maxLeverage = marginTable.maxLeverage || marginTable.maxLv || maxLeverage
          }
        }
        
        log(`   📈 Fetching historical data for ${asset}...`, 'cyan')
        let historicalData = []
        let indicators = null
        let multiTimeframeData = null
        let multiTimeframeIndicators = null
        let trendAlignment = null
        
        try {
          // Full mode: Always fetch primary and multi-timeframe data in parallel
          // Use Binance API with 15m interval for primary data (better accuracy than 1h)
          const CANDLES_COUNT = 200 // Full data for accurate analysis
          const PRIMARY_INTERVAL = process.env.PRIMARY_DATA_INTERVAL || '15m' // Default to 15m for better accuracy
          
          // Fetch primary and multi-timeframe data in parallel
          const [primaryData, mtfData] = await Promise.all([
            getHistoricalData(asset, PRIMARY_INTERVAL, CANDLES_COUNT).catch(err => {
              console.warn(`Failed to fetch primary data for ${asset} (${PRIMARY_INTERVAL}): ${err.message}`)
              return []
            }),
            getMultiTimeframeData(asset, ['1h', '4h', '1d']).catch(err => {
              console.warn(`Failed to fetch multi-timeframe data for ${asset}: ${err.message}`)
              return {}
            })
          ])
          
          historicalData = primaryData
          
          // Process multi-timeframe data
          if (Object.keys(mtfData).length > 0) {
            multiTimeframeData = mtfData
            multiTimeframeIndicators = calculateMultiTimeframeIndicators(mtfData, price)
            trendAlignment = checkTrendAlignment(multiTimeframeIndicators)
            if (trendAlignment) {
              log(`   📊 ${asset}: Multi-timeframe trend: ${trendAlignment.dailyTrend} | Aligned: ${trendAlignment.aligned ? 'Yes' : 'No'}`, trendAlignment.aligned ? 'green' : 'yellow')
            }
          }
          
          // Calculate technical indicators if we have enough data
          if (historicalData.length >= 14) {
            indicators = calculateTechnicalIndicators(historicalData, price)
            
            // Verify indicators were calculated correctly
            if (!indicators || (!indicators.rsi14 && !indicators.ema20 && !indicators.macd && !indicators.bollingerBands)) {
              log(`   ⚠️  ${asset}: Technical indicators calculation failed, retrying...`, 'yellow')
              // Retry with more data if available
              if (historicalData.length >= 50) {
                indicators = calculateTechnicalIndicators(historicalData, price)
              }
            }
            
            if (indicators && (indicators.rsi14 || indicators.ema20 || indicators.macd || indicators.bollingerBands)) {
              log(`   ✅ ${asset}: $${price.toFixed(2)} | ${historicalData.length} candles | RSI(14): ${indicators.rsi14?.toFixed(2) || 'N/A'} | EMA(20): $${indicators.ema20?.toFixed(2) || 'N/A'} | MACD: ${indicators.macd ? indicators.macd.histogram.toFixed(4) : 'N/A'}`, 'green')
            } else {
              log(`   ⚠️  ${asset}: $${price.toFixed(2)} | ${historicalData.length} candles | Technical indicators not available`, 'yellow')
            }
          } else {
            log(`   ⚠️  ${asset}: $${price.toFixed(2)} | Insufficient data for technical analysis (${historicalData.length} candles, need 14+)`, 'yellow')
          }
        } catch (error) {
          log(`   ❌ ${asset}: Failed to fetch historical data: ${error.message}`, 'red')
          // Don't use mock data - return empty indicators
        }
        
        // Extract ALL Hyperliquid native data fields
        const fundingRate = parseFloat(assetCtx.funding || '0')
        const openInterest = parseFloat(assetCtx.openInterest || '0')
        const premium = parseFloat(assetCtx.premium || '0') // Premium to oracle
        const oraclePx = parseFloat(assetCtx.oraclePx || '0') // Oracle price
        const midPx = parseFloat(assetCtx.midPx || '0') // Mid price (order book midpoint)
        const impactPxs = assetCtx.impactPxs || null // Impact prices array [bid, ask] for order book depth
        const prevDayPx = parseFloat(assetCtx.prevDayPx || '0') // Previous day price
        const dayBaseVlm = parseFloat(assetCtx.dayBaseVlm || '0') // Base volume (volume in base asset)
        
        // Calculate funding rate and OI trends (compare with previous values if available)
        // Improved logic: Lower threshold (5%), better cache validation, multi-value comparison
        let fundingRateTrend = 'stable'
        let oiTrend = 'stable'
        
        // Get previous funding rate value from cache
        const previousFundingRate = fundingRateCache.get(asset)
        if (previousFundingRate && previousFundingRate.timestamp && (Date.now() - previousFundingRate.timestamp) < FUNDING_OI_CACHE_TTL) {
          const prevValue = previousFundingRate.value
          const currentValue = fundingRate
          
          // Use 5% threshold instead of 10% for more sensitive detection
          if (Math.abs(prevValue) > 0.0001) { // Avoid division by zero
            const changePercent = Math.abs((currentValue - prevValue) / Math.abs(prevValue))
            if (changePercent > 0.05) { // 5% change threshold (lowered from 10%)
              if (currentValue > prevValue * 1.05) {
                fundingRateTrend = 'increasing'
              } else if (currentValue < prevValue * 0.95) {
                fundingRateTrend = 'decreasing'
              }
            } else if (changePercent > 0.02) {
              // Small change (2-5%): still mark as trend if consistent direction
              if (currentValue > prevValue * 1.02) {
                fundingRateTrend = 'increasing'
              } else if (currentValue < prevValue * 0.98) {
                fundingRateTrend = 'decreasing'
              }
            }
          } else if (Math.abs(currentValue) > 0.0001) {
            // Previous was near zero, current has value
            fundingRateTrend = currentValue > 0 ? 'increasing' : 'decreasing'
          }
        } else if (!previousFundingRate) {
          // First run: Store current value but don't calculate trend
          console.log(`📊 First funding rate value for ${asset}: ${(fundingRate * 100).toFixed(4)}%`)
        }
        
        // Store current funding rate in cache (always store, even on first run)
        fundingRateCache.set(asset, {
          value: fundingRate,
          timestamp: Date.now()
        })
        
        // Get previous OI value from cache
        const previousOI = openInterestCache.get(asset)
        if (previousOI && previousOI.timestamp && (Date.now() - previousOI.timestamp) < FUNDING_OI_CACHE_TTL) {
          const prevValue = previousOI.value
          const currentValue = openInterest
          
          // Use 5% threshold instead of 10% for more sensitive detection
          if (prevValue > 0) { // Avoid division by zero
            const changePercent = Math.abs((currentValue - prevValue) / prevValue)
            if (changePercent > 0.05) { // 5% change threshold (lowered from 10%)
              if (currentValue > prevValue * 1.05) {
                oiTrend = 'increasing'
              } else if (currentValue < prevValue * 0.95) {
                oiTrend = 'decreasing'
              }
            } else if (changePercent > 0.02) {
              // Small change (2-5%): still mark as trend if consistent direction
              if (currentValue > prevValue * 1.02) {
                oiTrend = 'increasing'
              } else if (currentValue < prevValue * 0.98) {
                oiTrend = 'decreasing'
              }
            }
          } else if (currentValue > 0) {
            // Previous was zero, current has value
            oiTrend = 'increasing'
          }
        } else if (!previousOI) {
          // First run: Store current value but don't calculate trend
          console.log(`📊 First OI value for ${asset}: $${openInterest.toLocaleString()}`)
        }
        
        // Store current OI in cache (always store, even on first run)
        openInterestCache.set(asset, {
          value: openInterest,
          timestamp: Date.now()
        })
        
        // Log trend calculation for debugging
        if (fundingRateTrend !== 'stable' || oiTrend !== 'stable') {
          console.log(`📊 ${asset} Trends - Funding: ${fundingRateTrend}, OI: ${oiTrend}`)
        }
        
        // Fetch blockchain data (if enabled)
        let blockchainData = null
        if (process.env.USE_BLOCKCHAIN_DATA !== 'false') {
          blockchainData = await fetchPublicBlockchainData(asset).catch(err => {
            console.warn(`Failed to fetch blockchain data for ${asset}: ${err.message}`)
            return null
          })
        }
        
        // Calculate enhanced metrics from existing data
        const enhancedMetrics = indicators ? calculateEnhancedMetrics(historicalData, indicators, null) : null
        
        // Add enhanced metrics to indicators for easier access in confidence scoring
        if (indicators && enhancedMetrics) {
          indicators.volumePriceDivergence = enhancedMetrics.volumePriceDivergence
          indicators.volumeTrend = enhancedMetrics.volumeTrend
          indicators.volumeChangePercent = enhancedMetrics.volumeChangePercent // Add volume change percentage for red flags
        }
        
        // Calculate new futures trading indicators
        // COB (Current Order Book) - using impactPxs
        const orderBookDepth = impactPxs && price > 0 
          ? calculateOrderBookDepth(impactPxs, price, assetCtx)
          : null
        
        // SVP (Session Volume Profile) - from historical data
        const sessionVolumeProfile = historicalData && historicalData.length >= 20
          ? calculateSessionVolumeProfile(historicalData, price, 'daily')
          : null
        
        // CRVP (Composite Range Volume Profile) - multi-session
        const compositeVolumeProfile = historicalData && historicalData.length >= 50
          ? calculateCompositeVolumeProfile(historicalData, price, 'weekly')
          : null
        
        // COC (Change of Character) - market structure
        const changeOfCharacter = historicalData && historicalData.length >= 20
          ? detectChangeOfCharacter(historicalData, price)
          : null
        
        // CVD (Cumulative Volume Delta) - buy/sell pressure
        const cumulativeVolumeDelta = historicalData && historicalData.length >= 20
          ? calculateCumulativeVolumeDelta(historicalData, price)
          : null
        
        // Build external data structure with ALL Hyperliquid fields and new indicators
        const externalData = {
          hyperliquid: {
            fundingRate: fundingRate,
            openInterest: openInterest,
            fundingRateTrend: fundingRateTrend,
            oiTrend: oiTrend,
            premium: premium, // NEW: Premium to oracle
            oraclePx: oraclePx, // NEW: Oracle price
            midPx: midPx, // NEW: Mid price
            impactPxs: impactPxs, // NEW: Impact prices for order book
            prevDayPx: prevDayPx, // NEW: Previous day price
            dayBaseVlm: dayBaseVlm, // NEW: Base volume
            timestamp: Date.now()
          },
          blockchain: blockchainData || {
            largeTransactions: [],
            estimatedExchangeFlow: 0,
            whaleActivityScore: 0,
            timestamp: Date.now()
          },
          enhanced: enhancedMetrics || {
            volumeTrend: 'stable',
            volatilityPattern: 'normal',
            volumePriceDivergence: 0,
            timestamp: Date.now()
          },
          // NEW: Futures trading indicators
          orderBook: orderBookDepth, // COB indicator
          volumeProfile: {
            session: sessionVolumeProfile, // SVP indicator
            composite: compositeVolumeProfile // CRVP indicator
          },
          marketStructure: {
            coc: changeOfCharacter // COC indicator
          },
          volumeDelta: cumulativeVolumeDelta // CVD indicator
        }
        
        const result = {
          asset: asset,
          data: {
            symbol: asset,
            price: price,
            volume24h: volume,
            markPx: price,
            maxLeverage: maxLeverage, // Store max leverage per asset
            timestamp: Date.now(),
            historicalData: historicalData,
            indicators: indicators,
            multiTimeframeData: multiTimeframeData,
            multiTimeframeIndicators: multiTimeframeIndicators,
            trendAlignment: trendAlignment,
            externalData: externalData
          }
        }
        
        results.push(result)
        
        // Add delay between Binance API requests to avoid rate limits (1200 requests/minute)
        if (assets.indexOf(asset) < assets.length - 1) {
          await new Promise(resolve => setTimeout(resolve, binanceDelay))
        }
      } else {
        log(`   ⚠️  ${asset}: Not found in universe (index: ${universeIndex})`, 'yellow')
      }
    }
    
    // Store results in marketData map
    for (const result of results) {
      if (result && result.data) {
        marketData.set(result.asset, result.data)
      }
    }
    
    return { marketDataMap: marketData, allowedAssets: assets }
  } catch (error) {
    log(`   ❌ Error: ${error.message}`, 'red')
    throw new Error(`Failed to fetch market data: ${error.message}`)
  }
}

// AI API call (try SDK first, fallback to direct HTTP calls)
async function callAIAPI(systemPrompt, userPrompt) {
  // Get API key - prioritize OPENROUTER_API_KEY for openrouter, fallback to AI_PROVIDER_API_KEY
  const apiKey = AI_PROVIDER === 'openrouter' 
    ? (process.env.OPENROUTER_API_KEY || AI_PROVIDER_API_KEY)
    : AI_PROVIDER_API_KEY
  
  if (!apiKey) {
    throw new Error(`${AI_PROVIDER === 'openrouter' ? 'OPENROUTER_API_KEY' : 'AI_PROVIDER_API_KEY'} is required`)
  }

  // Try to use SDK if available
  if (AI_PROVIDER === 'zai' && createZAI && generateText) {
    try {
      // API key format: "key.secret" - remove trailing colon if present
      const apiKey = AI_PROVIDER_API_KEY.endsWith(':') 
        ? AI_PROVIDER_API_KEY.slice(0, -1) 
        : AI_PROVIDER_API_KEY
      
      const provider = createZAI({ apiKey })
      const model = provider.languageModel(MODEL_ID)
      
      const { text } = await generateText({
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        responseFormat: {
          type: 'json_object'
        },
        temperature: 0.7,
        maxTokens: 8000 // Full tokens for complete JSON responses
      })
      
      return { text }
    } catch (error) {
      console.warn('⚠️  SDK call failed, falling back to direct HTTP:', error.message)
      // Fall through to direct HTTP call
    }
  }

  // Fallback to direct HTTP calls
  let apiUrl, headers, body

  if (AI_PROVIDER === 'openrouter') {
    // OpenRouter API
    apiUrl = 'https://openrouter.ai/api/v1/chat/completions'
    
    // Use the resolved apiKey variable
    const openRouterApiKey = process.env.OPENROUTER_API_KEY || AI_PROVIDER_API_KEY
    
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${openRouterApiKey}`
    }
    
    // Add optional headers if provided (for OpenRouter rankings)
    if (process.env.OPENROUTER_HTTP_REFERER) {
      headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER
    } else if (process.env.OPENROUTER_REFERER) {
      headers['HTTP-Referer'] = process.env.OPENROUTER_REFERER
    }
    if (process.env.OPENROUTER_X_TITLE) {
      headers['X-Title'] = process.env.OPENROUTER_X_TITLE
    }
    body = JSON.stringify({
      model: MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: {
        type: 'json_object'
      },
      temperature: 0.7,
      max_tokens: 8000 // Full tokens for complete JSON responses
    })
  } else if (AI_PROVIDER === 'zai') {
    // ZAI API - sesuai dokumentasi: https://docs.z.ai/guides/capabilities/struct-output
    // Endpoint: https://api.z.ai/api/paas/v4/chat/completions
    apiUrl = 'https://api.z.ai/api/paas/v4/chat/completions'
    
    // API key format: "key.secret" - remove trailing colon if present
    const apiKey = AI_PROVIDER_API_KEY.endsWith(':') 
      ? AI_PROVIDER_API_KEY.slice(0, -1) 
      : AI_PROVIDER_API_KEY
    
    headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }
    body = JSON.stringify({
      model: MODEL_ID,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: {
        type: 'json_object'
      },
      temperature: 0.7,
      max_tokens: 8000 // Full tokens for complete JSON responses
    })
  } else if (AI_PROVIDER === 'anthropic') {
    // Anthropic API
    apiUrl = 'https://api.anthropic.com/v1/messages'
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': AI_PROVIDER_API_KEY,
      'anthropic-version': '2023-06-01'
    }
    body = JSON.stringify({
      model: MODEL_ID,
      max_tokens: 8000,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    })
  } else {
    throw new Error(`Unsupported AI provider: ${AI_PROVIDER}`)
  }

  return new Promise((resolve, reject) => {
    const url = new URL(apiUrl)
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: headers
    }

    const client = url.protocol === 'https:' ? https : http

    const req = client.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        // Handle non-200 status codes first (before JSON parsing)
        if (res.statusCode !== 200) {
          const providerName = AI_PROVIDER.toUpperCase()
          let errorMsg = data.substring(0, 500)
          
          // Try to parse as JSON for structured error
          try {
            const errorResult = JSON.parse(data)
            errorMsg = errorResult.error?.message || errorResult.error?.raw || errorResult.message || errorMsg
          } catch (parseErr) {
            // If not JSON, use raw data (e.g., "error code: 500")
            errorMsg = data.trim() || `HTTP ${res.statusCode} error`
          }
          
          console.error(`${providerName} API Error (${res.statusCode}):`, errorMsg)
          reject(new Error(`API error: ${res.statusCode} - ${errorMsg}`))
          return
        }
        
        try {
          const result = JSON.parse(data)

          // Extract text from response
          let text = ''
          if (AI_PROVIDER === 'openrouter' || AI_PROVIDER === 'zai') {
            // OpenRouter and ZAI use same format: response.choices[0].message.content
            text = result.choices?.[0]?.message?.content || ''
            if (!text) {
              console.error(`${AI_PROVIDER.toUpperCase()} Response structure:`, JSON.stringify(result, null, 2))
              reject(new Error(`No content in ${AI_PROVIDER.toUpperCase()} response`))
              return
            }
          } else if (AI_PROVIDER === 'anthropic') {
            text = result.content?.[0]?.text || ''
          }

          resolve({ text })
        } catch (error) {
          console.error('Parse error. Response data:', data.substring(0, 500))
          reject(new Error(`Failed to parse API response: ${error.message}`))
        }
      })
    })

    req.on('error', (error) => {
      const errorDetails = error.message || error.toString()
      console.error(`${AI_PROVIDER.toUpperCase()} Request Error:`, errorDetails)
      console.error('Request URL:', apiUrl)
      console.error('Request headers:', JSON.stringify(headers, null, 2))
      console.error('Body length:', body.length)
      reject(new Error(`Request failed: ${errorDetails}`))
    })
    
    req.setTimeout(60000, () => {
      req.destroy()
      reject(new Error('Request timeout after 60 seconds'))
    })
    
    try {
      req.write(body)
      req.end()
    } catch (error) {
      console.error(`${AI_PROVIDER.toUpperCase()} Write Error:`, error.message)
      reject(new Error(`Failed to write request body: ${error.message}`))
    }
  })
}

// Track active positions (simulated for testing)
let activePositions = new Map()

// Get active positions from account state or simulate
function getActivePositions(accountState) {
  // If accountState has activePositions, use them
  if (accountState && accountState.activePositions && Array.isArray(accountState.activePositions)) {
    const positions = new Map()
    for (const pos of accountState.activePositions) {
      if (pos.symbol && pos.quantity && pos.quantity !== 0) {
        positions.set(pos.symbol, {
          symbol: pos.symbol,
          quantity: pos.quantity || 0,
          entryPrice: pos.entryPrice || pos.entry_price || 0,
          currentPrice: pos.currentPrice || pos.current_price || 0,
          leverage: pos.leverage || 1,
          unrealizedPnl: pos.unrealizedPnl || pos.unrealized_pnl || 0,
          side: pos.quantity > 0 ? 'LONG' : 'SHORT', // Positive = LONG, Negative = SHORT
          entryTime: pos.entryTime || pos.entry_time || Date.now()
        })
      }
    }
    return positions
  }
  
  // Otherwise use tracked positions
  return activePositions
}

// Update active positions after signal execution (for simulation)
function updateActivePositions(signal) {
  const symbol = signal.coin
  const currentPosition = activePositions.get(symbol)
  
  if (signal.signal === 'buy_to_enter') {
    // Open new LONG position or add to existing
    if (currentPosition && currentPosition.side === 'LONG') {
      // Add to existing LONG position (average entry price)
      const totalQuantity = currentPosition.quantity + (signal.quantity || 0)
      const totalCost = (currentPosition.quantity * currentPosition.entryPrice) + ((signal.quantity || 0) * (signal.entry_price || 0))
      activePositions.set(symbol, {
        ...currentPosition,
        quantity: totalQuantity,
        entryPrice: totalCost / totalQuantity,
        leverage: signal.leverage || currentPosition.leverage
      })
    } else if (currentPosition && currentPosition.side === 'SHORT') {
      // Close SHORT and open LONG (reverse)
      activePositions.delete(symbol)
      activePositions.set(symbol, {
        symbol,
        quantity: signal.quantity || 0,
        entryPrice: signal.entry_price || 0,
        currentPrice: signal.entry_price || 0,
        leverage: signal.leverage || 1,
        unrealizedPnl: 0,
        side: 'LONG',
        entryTime: Date.now()
      })
    } else {
      // Open new LONG position
      activePositions.set(symbol, {
        symbol,
        quantity: signal.quantity || 0,
        entryPrice: signal.entry_price || 0,
        currentPrice: signal.entry_price || 0,
        leverage: signal.leverage || 1,
        unrealizedPnl: 0,
        side: 'LONG',
        entryTime: Date.now()
      })
    }
  } else if (signal.signal === 'sell_to_enter') {
    // Open new SHORT position or add to existing
    if (currentPosition && currentPosition.side === 'SHORT') {
      // Add to existing SHORT position
      const totalQuantity = Math.abs(currentPosition.quantity) + (signal.quantity || 0)
      const totalCost = (Math.abs(currentPosition.quantity) * currentPosition.entryPrice) + ((signal.quantity || 0) * (signal.entry_price || 0))
      activePositions.set(symbol, {
        ...currentPosition,
        quantity: -totalQuantity, // Negative for SHORT
        entryPrice: totalCost / totalQuantity,
        leverage: signal.leverage || currentPosition.leverage
      })
    } else if (currentPosition && currentPosition.side === 'LONG') {
      // Close LONG and open SHORT (reverse)
      activePositions.delete(symbol)
      activePositions.set(symbol, {
        symbol,
        quantity: -(signal.quantity || 0), // Negative for SHORT
        entryPrice: signal.entry_price || 0,
        currentPrice: signal.entry_price || 0,
        leverage: signal.leverage || 1,
        unrealizedPnl: 0,
        side: 'SHORT',
        entryTime: Date.now()
      })
    } else {
      // Open new SHORT position
      activePositions.set(symbol, {
        symbol,
        quantity: -(signal.quantity || 0), // Negative for SHORT
        entryPrice: signal.entry_price || 0,
        currentPrice: signal.entry_price || 0,
        leverage: signal.leverage || 1,
        unrealizedPnl: 0,
        side: 'SHORT',
        entryTime: Date.now()
      })
    }
  } else if (signal.signal === 'close' || signal.signal === 'close_all') {
    // Close all positions for this asset
    activePositions.delete(symbol)
  } else if (signal.signal === 'reduce') {
    // Reduce position size
    if (currentPosition) {
      const reduceQuantity = signal.quantity || 0
      const newQuantity = Math.abs(currentPosition.quantity) - reduceQuantity
      if (newQuantity <= 0) {
        // Close position if reduced to zero or below
        activePositions.delete(symbol)
      } else {
        activePositions.set(symbol, {
          ...currentPosition,
          quantity: currentPosition.side === 'LONG' ? newQuantity : -newQuantity
        })
      }
    }
  }
  // HOLD: No change to positions
}

// Calculate Maximum Adverse Excursion (MAE) for a position
// MAE measures the maximum unfavorable price movement that a position experiences
function calculateMAE(position, currentPrice, historicalData = []) {
  if (!position || !currentPrice || position.entryPrice <= 0) {
    return null
  }
  
  const entryPrice = position.entryPrice
  const side = position.side || (position.quantity > 0 ? 'LONG' : 'SHORT')
  const entryTime = position.entryTime || Date.now()
  
  // If we have historical data, find the worst price since entry
  if (historicalData && historicalData.length > 0) {
    // Filter historical data to only include data after entry time
    const relevantData = historicalData.filter(candle => 
      candle.timestamp && candle.timestamp >= entryTime
    )
    
    if (relevantData.length > 0) {
      if (side === 'LONG') {
        // For LONG: find the lowest price since entry
        const lowestPrice = Math.min(...relevantData.map(c => c.low || c.close))
        const mae = ((entryPrice - lowestPrice) / entryPrice) * 100
        return {
          mae: mae,
          worstPrice: lowestPrice,
          worstPriceTime: relevantData.find(c => (c.low || c.close) === lowestPrice)?.timestamp || entryTime,
          currentAdverseExcursion: ((entryPrice - currentPrice) / entryPrice) * 100
        }
      } else {
        // For SHORT: find the highest price since entry
        const highestPrice = Math.max(...relevantData.map(c => c.high || c.close))
        const mae = ((highestPrice - entryPrice) / entryPrice) * 100
        return {
          mae: mae,
          worstPrice: highestPrice,
          worstPriceTime: relevantData.find(c => (c.high || c.close) === highestPrice)?.timestamp || entryTime,
          currentAdverseExcursion: ((currentPrice - entryPrice) / entryPrice) * 100
        }
      }
    }
  }
  
  // Fallback: calculate current adverse excursion if no historical data
  let currentAdverseExcursion = 0
  if (side === 'LONG') {
    // For LONG: adverse excursion is negative if price is below entry
    currentAdverseExcursion = currentPrice < entryPrice 
      ? ((entryPrice - currentPrice) / entryPrice) * 100 
      : 0
  } else {
    // For SHORT: adverse excursion is negative if price is above entry
    currentAdverseExcursion = currentPrice > entryPrice 
      ? ((currentPrice - entryPrice) / entryPrice) * 100 
      : 0
  }
  
  return {
    mae: currentAdverseExcursion, // Use current as MAE if no historical data
    worstPrice: side === 'LONG' ? Math.min(entryPrice, currentPrice) : Math.max(entryPrice, currentPrice),
    worstPriceTime: entryTime,
    currentAdverseExcursion: currentAdverseExcursion
  }
}

// Calculate dynamic Take Profit based on market conditions
// Anti-Knife Filter: Detect "catching falling knife" conditions
function isCatchingFallingKnife(signal, indicators, trendAlignment) {
  // Check if all conditions for "catching falling knife" are met
  const allTimeframesDowntrend = trendAlignment?.alignmentScore === 100 && 
                                  trendAlignment?.dailyTrend === 'downtrend'
  const priceBelowAllEMAs = indicators.ema20 && indicators.ema50 && indicators.ema200 &&
                             indicators.price < indicators.ema20 &&
                             indicators.price < indicators.ema50 &&
                             indicators.price < indicators.ema200
  const macdBearish = indicators.macd?.histogram < -20
  const obvVeryNegative = indicators.obv < -5000000 || 
                          (indicators.obv < -1000000 && trendAlignment?.dailyTrend === 'downtrend')
  
  return allTimeframesDowntrend && priceBelowAllEMAs && macdBearish && obvVeryNegative
}

// Check for reversal confirmations (minimum 2 required)
function hasReversalConfirmations(indicators) {
  // Check for minimum 2 reversal confirmations
  let confirmations = 0
  
  // Bullish divergence
  if (indicators.rsiDivergence?.divergence?.toLowerCase().includes('bullish')) confirmations++
  if (indicators.macdDivergence?.divergence?.toLowerCase().includes('bullish')) confirmations++
  
  // Volume spike (volume change > 30%)
  const volumeChange = indicators.volumeChange || 0
  if (volumeChange > 0.3) confirmations++
  
  // Extreme oversold (RSI < 20)
  if (indicators.rsi14 && indicators.rsi14 < 20) confirmations++
  
  return confirmations >= 2
}

// Get reversal confirmation count (for display purposes)
function getReversalConfirmationCount(indicators) {
  let count = 0
  if (indicators.rsiDivergence?.divergence?.toLowerCase().includes('bullish')) count++
  if (indicators.macdDivergence?.divergence?.toLowerCase().includes('bullish')) count++
  if ((indicators.volumeChange || 0) > 0.3) count++
  if (indicators.rsi14 && indicators.rsi14 < 20) count++
  return count
}

/**
 * Calculate Dynamic Take Profit for Bounce Signals
 * More aggressive TP targets for bounce plays (faster moves expected)
 */
function calculateBounceTP(entryPrice, signal, indicators, trendAlignment, slDistance, bounceStrength) {
  // Bounce signals typically move faster, so we use more aggressive TP
  const MIN_TP_PERCENT = 0.015 // 1.5% minimum (lower than normal)
  const MAX_TP_PERCENT = 0.06 // 6% maximum (higher than normal for bounce)
  const MIN_RR = 1.8 // Slightly lower R:R for bounce (1.8:1 instead of 2:1)
  
  // Base TP based on bounce strength (0.2 to 1.0)
  // Stronger bounce = higher TP target
  let tpPercent = MIN_TP_PERCENT + (bounceStrength * 0.03) // 1.5% to 4.5% base
  
  const factors = {
    bounceStrength: bounceStrength,
    momentum: 0,
    volatility: 0,
    trendStrength: 0,
    volume: 0,
    counterTrend: false
  }
  
  // Momentum bonus (bounce usually has strong momentum)
  if (indicators && indicators.macd && indicators.macd.histogram) {
    const macdStrength = Math.abs(indicators.macd.histogram)
    factors.momentum = macdStrength
    if (macdStrength > 30) {
      tpPercent += 0.015 // +1.5% for very strong momentum
    } else if (macdStrength > 20) {
      tpPercent += 0.01 // +1% for strong momentum
    } else if (macdStrength > 10) {
      tpPercent += 0.005 // +0.5% for moderate momentum
    }
  }
  
  // Volatility bonus (higher volatility = bigger bounce potential)
  if (indicators && indicators.atr && entryPrice > 0) {
    const atrPercent = (indicators.atr / entryPrice) * 100
    factors.volatility = atrPercent
    if (atrPercent > 3) {
      tpPercent += 0.01 // +1% for very high volatility
    } else if (atrPercent > 2) {
      tpPercent += 0.005 // +0.5% for high volatility
    }
  }
  
  // Check if bounce is counter-trend (mini-bias modifier)
  let isCounterTrend = false
  if (trendAlignment && trendAlignment.dailyTrend) {
    const signalType = signal.signal || signal
    if ((signalType === 'buy_to_enter' && trendAlignment.dailyTrend === 'downtrend') ||
        (signalType === 'sell_to_enter' && trendAlignment.dailyTrend === 'uptrend')) {
      isCounterTrend = true
      factors.counterTrend = true
      // Reduce TP for counter-trend bounce (more conservative)
      tpPercent *= 0.75 // Reduce by 25%
    } else {
      // With-trend bounce gets bonus
      if (trendAlignment.alignmentScore >= 75) {
        tpPercent += 0.01 // +1% for strong trend alignment
      } else if (trendAlignment.alignmentScore >= 50) {
        tpPercent += 0.005 // +0.5% for moderate trend alignment
      }
      factors.trendStrength = trendAlignment.alignmentScore || 0
    }
  }
  
  // Volume bonus (volume confirmation = stronger bounce)
  if (indicators && indicators.volumeChange && indicators.volumeChange > 10) {
    factors.volume = indicators.volumeChange
    tpPercent += 0.005 // +0.5% for increasing volume
  }
  
  // Clamp to max
  tpPercent = Math.min(tpPercent, MAX_TP_PERCENT)
  
  // Calculate TP price
  let tpPrice = 0
  const signalType = signal.signal || signal
  if (signalType === 'buy_to_enter' || signalType === 'add') {
    tpPrice = entryPrice * (1 + tpPercent)
  } else if (signalType === 'sell_to_enter') {
    tpPrice = entryPrice * (1 - tpPercent)
  }
  
  // Ensure minimum R:R (slightly lower for bounce)
  const tpDistance = Math.abs(tpPrice - entryPrice)
  const minTPDistance = slDistance * MIN_RR
  if (tpDistance < minTPDistance) {
    if (signalType === 'buy_to_enter' || signalType === 'add') {
      tpPrice = entryPrice + minTPDistance
    } else {
      tpPrice = entryPrice - minTPDistance
    }
  }
  
  // Recalculate final TP percent after R:R adjustment
  const finalTPDistance = Math.abs(tpPrice - entryPrice)
  const finalTPPercent = (finalTPDistance / entryPrice) * 100
  
  // Calculate profit expectation (expected move based on bounce strength)
  const profitExpectation = bounceStrength * 100 // 20% to 100% of potential
  
  return {
    tpPrice,
    tpPercent: finalTPPercent,
    factors: factors,
    isCounterTrend,
    profitExpectation,
    bounceTarget: tpPrice // Store bounce-specific target
  }
}

function calculateDynamicTP(entryPrice, signal, indicators, trendAlignment, marketRegime, slDistance) {
  const MIN_TP_PERCENT = 0.02 // 2% minimum
  const MAX_TP_PERCENT = 0.05 // 5% maximum (expandable)
  const MIN_RR = 2.0 // Minimum R:R 2:1
  
  let tpPercent = MIN_TP_PERCENT // Start with 2%
  const factors = {
    momentum: 0,
    volatility: 0,
    trendStrength: 0,
    volume: 0
  }
  
  // Momentum bonus
  if (indicators && indicators.macd && indicators.macd.histogram) {
    const macdStrength = Math.abs(indicators.macd.histogram)
    factors.momentum = macdStrength
    if (macdStrength > 30) {
      tpPercent += 0.01 // +1% for very strong momentum
    } else if (macdStrength > 20) {
      tpPercent += 0.005 // +0.5% for strong momentum
    }
  }
  
  // Volatility bonus
  if (indicators && indicators.atr && entryPrice > 0) {
    const atrPercent = (indicators.atr / entryPrice) * 100
    factors.volatility = atrPercent
    if (atrPercent > 2) {
      tpPercent += 0.005 // +0.5% for high volatility
    }
  }
  
  // Trend strength bonus
  if (trendAlignment && trendAlignment.alignmentScore !== undefined) {
    factors.trendStrength = trendAlignment.alignmentScore
    if (trendAlignment.alignmentScore >= 75) {
      tpPercent += 0.01 // +1% for strong trend
    } else if (trendAlignment.alignmentScore >= 50) {
      tpPercent += 0.005 // +0.5% for moderate trend
    }
  } else if (trendAlignment && trendAlignment.aligned) {
    // Fallback: if aligned but no score, give moderate bonus
    tpPercent += 0.005
  }
  
  // Volume bonus
  if (indicators && indicators.volumeChange && indicators.volumeChange > 10) {
    factors.volume = indicators.volumeChange
    tpPercent += 0.005 // +0.5% for increasing volume
  }
  
  // Clamp to max
  tpPercent = Math.min(tpPercent, MAX_TP_PERCENT)
  
  // Calculate TP price
  let tpPrice = 0
  const signalType = signal.signal || signal
  if (signalType === 'buy_to_enter' || signalType === 'add') {
    tpPrice = entryPrice * (1 + tpPercent)
  } else if (signalType === 'sell_to_enter') {
    tpPrice = entryPrice * (1 - tpPercent)
  }
  
  // Ensure minimum R:R
  const tpDistance = Math.abs(tpPrice - entryPrice)
  const minTPDistance = slDistance * MIN_RR
  if (tpDistance < minTPDistance) {
    if (signalType === 'buy_to_enter' || signalType === 'add') {
      tpPrice = entryPrice + minTPDistance
    } else {
      tpPrice = entryPrice - minTPDistance
    }
  }
  
  // Recalculate final TP percent after R:R adjustment
  const finalTPDistance = Math.abs(tpPrice - entryPrice)
  const finalTPPercent = (finalTPDistance / entryPrice) * 100
  
  return {
    tpPrice,
    tpPercent: finalTPPercent,
    factors: factors
  }
}

// Determine trading style (Long Term vs Short Term)
function determineTradingStyle(signal, indicators, trendAlignment, marketRegime) {
  if (!trendAlignment && !indicators) return 'Short Term' // Default to short term if no data
  
  const signalType = signal.signal || signal
  
  const isLongTerm = 
    // Daily trend aligned
    (trendAlignment && trendAlignment.dailyTrend && 
     ((signalType === 'buy_to_enter' && trendAlignment.dailyTrend === 'uptrend') ||
      (signalType === 'sell_to_enter' && trendAlignment.dailyTrend === 'downtrend'))) &&
    // Multi-timeframe alignment
    (trendAlignment.h4Aligned && trendAlignment.h1Aligned) &&
    // Strong trend
    (indicators && indicators.adx && (typeof indicators.adx === 'number' ? indicators.adx : indicators.adx.adx) > 25) &&
    // Normal volatility (not too choppy)
    (marketRegime && (marketRegime.volatility === 'normal' || marketRegime.regime === 'trending'))
  
  return isLongTerm ? 'Long Term' : 'Short Term'
}

// ═══════════════════════════════════════════════════════════════
// SMART FLIP v2 - Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate Trend Strength Index (-1 to +1)
 * Combines EMA alignment, ADX, Aroon, and multi-timeframe data
 */
function calculateTrendStrengthIndex(indicators, trendAlignment) {
  let strength = 0
  let components = 0
  
  // 1. EMA Alignment (weight: 0.3)
  if (indicators.ema20 && indicators.ema50 && indicators.ema200 && indicators.price) {
    const price = indicators.price
    const ema20 = indicators.ema20
    const ema50 = indicators.ema50
    const ema200 = indicators.ema200
    
    // Perfect bullish: Price > EMA20 > EMA50 > EMA200
    if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
      strength += 0.3
    }
    // Good bullish: Price > EMA20 > EMA50
    else if (price > ema20 && ema20 > ema50) {
      strength += 0.2
    }
    // Perfect bearish: Price < EMA20 < EMA50 < EMA200
    else if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
      strength -= 0.3
    }
    // Good bearish: Price < EMA20 < EMA50
    else if (price < ema20 && ema20 < ema50) {
      strength -= 0.2
    }
    components++
  }
  
  // 2. ADX Trend Strength (weight: 0.25)
  if (indicators.adx !== null && indicators.adx !== undefined) {
    const adxValue = typeof indicators.adx === 'number' ? indicators.adx : (indicators.adx?.adx || indicators.adx)
    const adxNormalized = Math.min(1, adxValue / 50) // Normalize to 0-1 (50 ADX = very strong)
    
    // Use +DI and -DI to determine direction
    if (indicators.plusDI && indicators.minusDI) {
      const diDiff = indicators.plusDI - indicators.minusDI
      const diNormalized = Math.max(-1, Math.min(1, diDiff / 25)) // Normalize DI difference
      strength += 0.25 * adxNormalized * diNormalized
    } else {
      // If no DI, use ADX strength with price direction
      if (indicators.price && indicators.ema20) {
        const priceDirection = indicators.price > indicators.ema20 ? 1 : -1
        strength += 0.25 * adxNormalized * priceDirection
      }
    }
    components++
  }
  
  // 3. Aroon Trend Strength (weight: 0.2)
  if (indicators.aroon && indicators.aroon.up !== undefined && indicators.aroon.down !== undefined) {
    const aroonDiff = indicators.aroon.up - indicators.aroon.down
    const aroonNormalized = aroonDiff / 100 // Normalize to -1 to +1
    strength += 0.2 * aroonNormalized
    components++
  }
  
  // 4. Multi-timeframe Alignment (weight: 0.25)
  if (trendAlignment) {
    const alignmentScore = trendAlignment.alignmentScore || 0
    const dailyTrend = trendAlignment.dailyTrend
    
    let trendDirection = 0
    if (dailyTrend === 'uptrend') trendDirection = 1
    else if (dailyTrend === 'downtrend') trendDirection = -1
    
    const alignmentNormalized = alignmentScore / 100 // 0-1
    strength += 0.25 * alignmentNormalized * trendDirection
    components++
  }
  
  // Normalize by number of components available
  if (components > 0) {
    strength = strength / (components * 0.3) // Adjust for average weight
  }
  
  // Clamp to -1 to +1
  return Math.max(-1, Math.min(1, strength))
}

/**
 * Calculate Recent Momentum (last N candles)
 * Returns momentum direction and strength
 */
function calculateRecentMomentum(historicalData, indicators, periods = 3) {
  if (!historicalData || historicalData.length < periods * 2) {
    return { recentChange: 0, momentumStrength: 0 }
  }
  
  // Get last N candles vs previous N candles
  const recentCandles = historicalData.slice(-periods)
  const previousCandles = historicalData.slice(-periods * 2, -periods)
  
  if (recentCandles.length < periods || previousCandles.length < periods) {
    return { recentChange: 0, momentumStrength: 0 }
  }
  
  // Calculate price change
  const recentStartPrice = recentCandles[0].close
  const recentEndPrice = recentCandles[recentCandles.length - 1].close
  const previousStartPrice = previousCandles[0].close
  const previousEndPrice = previousCandles[previousCandles.length - 1].close
  
  const recentChange = (recentEndPrice - recentStartPrice) / recentStartPrice
  const previousChange = (previousEndPrice - previousStartPrice) / previousStartPrice
  
  // Momentum = recent change - previous change (acceleration)
  const momentumChange = recentChange - previousChange
  
  // Check MACD histogram trend
  let macdMomentum = 0
  if (indicators.macd && indicators.macd.histogram !== null && indicators.macd.histogram !== undefined) {
    // Positive histogram = bullish momentum
    macdMomentum = indicators.macd.histogram > 0 ? 0.3 : -0.3
  }
  
  // Check OBV trend (if available from historical)
  let obvMomentum = 0
  if (indicators.obv !== null && indicators.obv !== undefined) {
    obvMomentum = indicators.obv > 0 ? 0.2 : -0.2
  }
  
  // Combine momentum signals
  const totalMomentum = momentumChange + macdMomentum + obvMomentum
  const momentumStrength = Math.min(1, Math.abs(totalMomentum) * 10) // Scale to 0-1
  
  return {
    recentChange: totalMomentum > 0 ? 1 : (totalMomentum < 0 ? -1 : 0),
    momentumStrength: momentumStrength
  }
}

/**
 * Check Major Indicators Alignment
 * Returns count of aligned indicators and whether minimum threshold met
 */
function checkMajorIndicatorsAlignment(indicators, direction) {
  let alignedCount = 0
  const alignedIndicators = []
  
  // 1. MACD
  if (indicators.macd && indicators.macd.histogram !== null && indicators.macd.histogram !== undefined) {
    const isBullish = indicators.macd.histogram > 0
    if ((direction === 'bullish' && isBullish) || (direction === 'bearish' && !isBullish)) {
      alignedCount++
      alignedIndicators.push('MACD')
    }
  }
  
  // 2. RSI
  if (indicators.rsi14 !== null && indicators.rsi14 !== undefined) {
    const isBullish = indicators.rsi14 > 50
    if ((direction === 'bullish' && isBullish) || (direction === 'bearish' && !isBullish)) {
      alignedCount++
      alignedIndicators.push('RSI')
    }
  }
  
  // 3. Bollinger Bands
  if (indicators.bollingerBands && indicators.price) {
    const bbMiddle = indicators.bollingerBands.middle
    const isBullish = indicators.price > bbMiddle
    if ((direction === 'bullish' && isBullish) || (direction === 'bearish' && !isBullish)) {
      alignedCount++
      alignedIndicators.push('BB')
    }
  }
  
  // 4. Parabolic SAR
  if (indicators.parabolicSAR && indicators.price) {
    const isBullish = indicators.price > indicators.parabolicSAR
    if ((direction === 'bullish' && isBullish) || (direction === 'bearish' && !isBullish)) {
      alignedCount++
      alignedIndicators.push('SAR')
    }
  }
  
  // 5. OBV
  if (indicators.obv !== null && indicators.obv !== undefined) {
    const isBullish = indicators.obv > 0
    if ((direction === 'bullish' && isBullish) || (direction === 'bearish' && !isBullish)) {
      alignedCount++
      alignedIndicators.push('OBV')
    }
  }
  
  // 6. Aroon
  if (indicators.aroon && indicators.aroon.up !== undefined && indicators.aroon.down !== undefined) {
    const isBullish = indicators.aroon.up > indicators.aroon.down
    if ((direction === 'bullish' && isBullish) || (direction === 'bearish' && !isBullish)) {
      alignedCount++
      alignedIndicators.push('Aroon')
    }
  }
  
  return {
    alignedCount,
    isAligned: alignedCount >= 3,
    alignedIndicators
  }
}

/**
 * Calculate Adaptive Flip Threshold based on Trend Strength
 * Returns dynamic threshold percentage based on market regime
 */
function calculateAdaptiveFlipThreshold(trendStrength) {
  const absTrendStrength = Math.abs(trendStrength)
  
  // Strong Trend (|trendStrength| > 0.6): 55% threshold
  if (absTrendStrength > 0.6) {
    return 55
  }
  
  // Moderate Trend (0.3 ≤ |trendStrength| ≤ 0.6): 50-52% threshold
  if (absTrendStrength >= 0.3 && absTrendStrength <= 0.6) {
    // Linear interpolation: 0.3 → 52%, 0.6 → 50%
    const threshold = 52 - ((absTrendStrength - 0.3) / 0.3) * 2
    return Math.round(threshold)
  }
  
  // Choppy/Sideways (|trendStrength| < 0.3): 65% threshold (very strict)
  return 65
}

/**
 * Adaptive Weight Balancer
 * Returns dynamic indicator weights based on market regime
 */
function getAdaptiveWeights(trendStrength, volatilityHigh, marketRegime) {
  // Strong trend regime - prioritize trend indicators
  if (Math.abs(trendStrength) > 0.6) {
    return {
      EMA: 0.35,
      Aroon: 0.25,
      RSI: 0.1,
      MACD: 0.2,
      OBV: 0.05,
      BB: 0.05
    }
  }
  
  // High volatility regime - prioritize momentum and volume
  if (volatilityHigh || (marketRegime && marketRegime.volatility === 'high')) {
    return {
      EMA: 0.2,
      MACD: 0.25,
      OBV: 0.25,
      RSI: 0.15,
      BB: 0.15,
      Aroon: 0.0
    }
  }
  
  // Default balanced weights
  return {
    EMA: 0.25,
    MACD: 0.2,
    RSI: 0.2,
    OBV: 0.15,
    BB: 0.1,
    Aroon: 0.1
  }
}

/**
 * Tiered Weight Evaluation
 * Evaluates indicators by tier and returns weighted score
 */
function evaluateTieredWeights(indicators, direction) {
  let tier1Score = 0 // Trend Core: EMA, Aroon, ADX
  let tier2Score = 0 // Momentum: MACD, RSI
  let tier3Score = 0 // Volume/Volatility: OBV, BB, ATR
  
  let tier1Bullish = 0
  let tier1Bearish = 0
  let tier2Bullish = 0
  let tier2Bearish = 0
  let tier3Bullish = 0
  let tier3Bearish = 0
  
  // Tier 1: Trend Core
  // EMA alignment
  if (indicators.ema20 && indicators.ema50 && indicators.price) {
    const isBullish = indicators.price > indicators.ema20 && indicators.ema20 > indicators.ema50
    if (isBullish) tier1Bullish++
    else tier1Bearish++
  }
  
  // Aroon
  if (indicators.aroon && indicators.aroon.up !== undefined && indicators.aroon.down !== undefined) {
    if (indicators.aroon.up > indicators.aroon.down) tier1Bullish++
    else tier1Bearish++
  }
  
  // ADX (trend strength)
  if (indicators.adx !== null && indicators.adx !== undefined) {
    const adxValue = typeof indicators.adx === 'number' ? indicators.adx : (indicators.adx?.adx || indicators.adx)
    if (adxValue > 25) {
      // Strong trend - check direction
      if (indicators.plusDI && indicators.minusDI) {
        if (indicators.plusDI > indicators.minusDI) tier1Bullish++
        else tier1Bearish++
      }
    }
  }
  
  // Tier 2: Momentum
  // MACD
  if (indicators.macd && indicators.macd.histogram !== null && indicators.macd.histogram !== undefined) {
    if (indicators.macd.histogram > 0) tier2Bullish++
    else tier2Bearish++
  }
  
  // RSI
  if (indicators.rsi14 !== null && indicators.rsi14 !== undefined) {
    if (indicators.rsi14 > 50) tier2Bullish++
    else tier2Bearish++
  }
  
  // Tier 3: Volume/Volatility
  // OBV
  if (indicators.obv !== null && indicators.obv !== undefined) {
    if (indicators.obv > 0) tier3Bullish++
    else tier3Bearish++
  }
  
  // BB
  if (indicators.bollingerBands && indicators.price) {
    const bbMiddle = indicators.bollingerBands.middle
    if (indicators.price > bbMiddle) tier3Bullish++
    else tier3Bearish++
  }
  
  // Calculate tier scores
  if (tier1Bullish >= 2) tier1Score += 10
  if (tier1Bearish >= 2) tier1Score -= 10
  if (tier2Bullish >= 2) tier2Score += 5
  if (tier2Bearish >= 2) tier2Score -= 5
  if (tier3Bullish >= 2) tier3Score += 3
  if (tier3Bearish >= 2) tier3Score -= 3
  
  return {
    tier1Score,
    tier2Score,
    tier3Score,
    totalScore: tier1Score + tier2Score + tier3Score,
    tier1Bullish,
    tier1Bearish,
    tier2Bullish,
    tier2Bearish,
    tier3Bullish,
    tier3Bearish
  }
}

/**
 * Weighted Median / Confidence Cluster
 * Returns median score from top 3 highest confidence indicators
 */
function calculateWeightedMedian(indicators, bullishScore, bearishScore) {
  // Create indicator confidence array
  const indicatorConfidences = []
  
  // MACD confidence
  if (indicators.macd && indicators.macd.histogram !== null) {
    const macdConf = Math.abs(indicators.macd.histogram) / 50 // Normalize to 0-1
    indicatorConfidences.push({
      name: 'MACD',
      confidence: macdConf,
      score: indicators.macd.histogram > 0 ? bullishScore : bearishScore,
      direction: indicators.macd.histogram > 0 ? 'bullish' : 'bearish'
    })
  }
  
  // RSI confidence
  if (indicators.rsi14 !== null) {
    const rsiConf = Math.abs(indicators.rsi14 - 50) / 50 // Distance from neutral
    indicatorConfidences.push({
      name: 'RSI',
      confidence: rsiConf,
      score: indicators.rsi14 > 50 ? bullishScore : bearishScore,
      direction: indicators.rsi14 > 50 ? 'bullish' : 'bearish'
    })
  }
  
  // OBV confidence
  if (indicators.obv !== null) {
    const obvConf = Math.min(1, Math.abs(indicators.obv) / 5000000) // Normalize
    indicatorConfidences.push({
      name: 'OBV',
      confidence: obvConf,
      score: indicators.obv > 0 ? bullishScore : bearishScore,
      direction: indicators.obv > 0 ? 'bullish' : 'bearish'
    })
  }
  
  // EMA confidence
  if (indicators.ema20 && indicators.price) {
    const emaDistance = Math.abs(indicators.price - indicators.ema20) / indicators.price
    indicatorConfidences.push({
      name: 'EMA',
      confidence: Math.min(1, emaDistance * 10), // Normalize
      score: indicators.price > indicators.ema20 ? bullishScore : bearishScore,
      direction: indicators.price > indicators.ema20 ? 'bullish' : 'bearish'
    })
  }
  
  // Sort by confidence and take top 3
  const top3 = indicatorConfidences
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3)
  
  if (top3.length === 0) return null
  
  // Calculate median score
  const scores = top3.map(i => i.score).sort((a, b) => a - b)
  const medianScore = scores.length % 2 === 0
    ? (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2
    : scores[Math.floor(scores.length / 2)]
  
  return {
    medianScore,
    topIndicators: top3.map(i => i.name),
    direction: top3[0].direction // Use direction of highest confidence indicator
  }
}

/**
 * Partial Confidence Mode
 * Ensures confidence is never 0%, uses partial confidence calculation
 */
function calculatePartialConfidence(bullishPercent, bearishPercent, baseConfidence = 0.3) {
  if (bullishPercent > bearishPercent) {
    return Math.min(1, baseConfidence + (bullishPercent - bearishPercent) / 100)
  } else if (bearishPercent > bullishPercent) {
    return Math.min(1, baseConfidence + (bearishPercent - bullishPercent) / 100)
  }
  return baseConfidence // Neutral = base confidence
}

/**
 * Rolling Normalization for Confidence
 * Uses square root normalization to boost low confidence while capping high confidence
 */
function normalizeConfidence(confidence) {
  // Convert to 0-100 scale, normalize, then convert back to 0-1
  const confPercent = confidence * 100
  const normalized = Math.min(100, Math.sqrt(confPercent / 100) * 100)
  return normalized / 100
}

/**
 * Calculate Adaptive Minimum Confidence Threshold
 * Adjusts minimum confidence based on market clarity
 */
function calculateAdaptiveMinConfidence(trendStrength, contradictionScore, volatility, baseMinConf = 0.32) {
  let minConf = baseMinConf
  
  // Strong trend = lower threshold (clear direction)
  if (Math.abs(trendStrength) > 0.6) {
    minConf = 0.25
  }
  // High contradictions = higher threshold (uncertainty)
  else if (contradictionScore > 30) {
    minConf = 0.35
  }
  // Low volatility = lower threshold (calm market, signals more reliable)
  else if (volatility < 0.015) {
    minConf = 0.20
  }
  
  return minConf
}

/**
 * Calculate Relative EV Threshold
 * Uses relative threshold based on average EV instead of absolute
 */
function calculateRelativeEVThreshold(signals, baseThreshold = 0.30) {
  // Calculate average EV from all signals
  const validEVs = signals
    .map(s => s.expected_value)
    .filter(ev => ev !== null && ev !== undefined && !isNaN(ev))
  
  if (validEVs.length === 0) {
    return baseThreshold
  }
  
  const avgEV = validEVs.reduce((a, b) => a + b, 0) / validEVs.length
  
  // Use 80% of average EV, but minimum baseThreshold
  return Math.max(baseThreshold, avgEV * 0.8)
}

/**
 * Check No-Trade Zone
 * Returns true if price is in exhaustion zone (too close to support/resistance)
 */
function checkNoTradeZone(signal, indicators, price) {
  if (!indicators || !price) return false
  
  const bbLower = indicators.bollingerBands?.lower
  const bbUpper = indicators.bollingerBands?.upper
  const rsi7 = indicators.rsi7
  const macdHist = indicators.macd?.histogram
  
  // Check if price is too close to BB Lower (within 0.2%)
  if (bbLower && price > 0) {
    const distanceToBBLower = ((price - bbLower) / price) * 100
    if (distanceToBBLower < 0.2 && distanceToBBLower >= 0) {
      // Price is within 0.2% of BB Lower - exhaustion zone for SELL
      if (signal.signal === 'sell_to_enter') {
        return {
          inNoTradeZone: true,
          reason: `Price within 0.2% of BB Lower (exhaustion zone, momentum window too narrow)`,
          distance: distanceToBBLower
        }
      }
    }
  }
  
  // Check if price is too close to BB Upper (within 0.2%)
  if (bbUpper && price > 0) {
    const distanceToBBUpper = ((bbUpper - price) / price) * 100
    if (distanceToBBUpper < 0.2 && distanceToBBUpper >= 0) {
      // Price is within 0.2% of BB Upper - exhaustion zone for BUY
      if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
        return {
          inNoTradeZone: true,
          reason: `Price within 0.2% of BB Upper (exhaustion zone, momentum window too narrow)`,
          distance: distanceToBBUpper
        }
      }
    }
  }
  
  // Check RSI(7) < 40 + MACD Hist > 0 (momentum exhaustion for SELL)
  if (rsi7 !== null && rsi7 !== undefined && macdHist !== null && macdHist !== undefined) {
    if (rsi7 < 40 && macdHist > 0 && signal.signal === 'sell_to_enter') {
      return {
        inNoTradeZone: true,
        reason: `RSI(7) ${rsi7.toFixed(1)} < 40 + MACD Hist ${macdHist.toFixed(2)} > 0 (momentum exhaustion, potential reversal)`
      }
    }
    // Check RSI(7) > 60 + MACD Hist < 0 (momentum exhaustion for BUY)
    if (rsi7 > 60 && macdHist < 0 && (signal.signal === 'buy_to_enter' || signal.signal === 'add')) {
      return {
        inNoTradeZone: true,
        reason: `RSI(7) ${rsi7.toFixed(1)} > 60 + MACD Hist ${macdHist.toFixed(2)} < 0 (momentum exhaustion, potential reversal)`
      }
    }
  }
  
  return { inNoTradeZone: false }
}

/**
 * Check Momentum Contradiction
 * Returns penalty percentage if MACD histogram contradicts signal direction
 */
function checkMomentumContradiction(signal, indicators) {
  if (!indicators || !indicators.macd || indicators.macd.histogram === null || indicators.macd.histogram === undefined) {
    return 0
  }
  
  const macdHist = indicators.macd.histogram
  const isBuySignal = signal.signal === 'buy_to_enter' || signal.signal === 'add'
  const isSellSignal = signal.signal === 'sell_to_enter'
  
  // MACD Histogram positive = bullish momentum, negative = bearish momentum
  // If signal is SELL but histogram is positive (or vice versa) = contradiction
  if (isSellSignal && macdHist > 0) {
    // SELL signal but bullish momentum (histogram positive)
    // Stronger contradiction if histogram is significantly positive
    if (macdHist > 30) {
      return 0.20 // 20% confidence penalty for strong contradiction
    } else if (macdHist > 10) {
      return 0.15 // 15% penalty for moderate contradiction
    }
    return 0.10 // 10% penalty for weak contradiction
  } else if (isBuySignal && macdHist < 0) {
    // BUY signal but bearish momentum (histogram negative)
    // Stronger contradiction if histogram is significantly negative
    if (macdHist < -30) {
      return 0.20 // 20% confidence penalty for strong contradiction
    } else if (macdHist < -10) {
      return 0.15 // 15% penalty for moderate contradiction
    }
    return 0.10 // 10% penalty for weak contradiction
  }
  
  return 0 // No contradiction
}

/**
 * Check Bounce Persistence
 * Memory pendek (3-5 candle) untuk cek apakah bounce bertahan
 * Kalau harga gagal naik 0.5% dalam 3 candle → cut confidence 50%
 */
function checkBouncePersistence(historicalData, signal, currentPrice) {
  if (!historicalData || historicalData.length < 3 || !currentPrice) {
    return { persistent: true, confidencePenalty: 0, reason: 'Insufficient data' }
  }
  
  const isBuyBounce = signal.bounce_type === 'BUY_BOUNCE' || (signal.signal === 'buy_to_enter' && signal.bounce_mode)
  const isSellBounce = signal.bounce_type === 'SELL_BOUNCE' || (signal.signal === 'sell_to_enter' && signal.bounce_mode)
  
  if (!isBuyBounce && !isSellBounce) {
    return { persistent: true, confidencePenalty: 0, reason: 'Not a bounce signal' }
  }
  
  // Check last 3 candles
  const recentCandles = historicalData.slice(-3)
  if (recentCandles.length < 3) {
    return { persistent: true, confidencePenalty: 0, reason: 'Insufficient candles' }
  }
  
  const startPrice = recentCandles[0].close
  const endPrice = currentPrice
  const priceChange = ((endPrice - startPrice) / startPrice) * 100
  
  // For BUY bounce: need price to increase by at least 0.5%
  if (isBuyBounce) {
    if (priceChange < 0.5) {
      // Bounce failed - price didn't increase enough
      return {
        persistent: false,
        confidencePenalty: 0.50, // Cut confidence 50%
        reason: `Price failed to increase 0.5% in 3 candles (only ${priceChange.toFixed(2)}%) - dead cat bounce detected`,
        priceChange
      }
    }
  }
  
  // For SELL bounce: need price to decrease by at least 0.5%
  if (isSellBounce) {
    if (priceChange > -0.5) {
      // Bounce failed - price didn't decrease enough
      return {
        persistent: false,
        confidencePenalty: 0.50, // Cut confidence 50%
        reason: `Price failed to decrease 0.5% in 3 candles (only ${priceChange.toFixed(2)}%) - failed pullback detected`,
        priceChange
      }
    }
  }
  
  // Bounce is persistent
  return {
    persistent: true,
    confidencePenalty: 0,
    reason: `Bounce persistent: ${isBuyBounce ? 'price increased' : 'price decreased'} ${Math.abs(priceChange).toFixed(2)}% in 3 candles`,
    priceChange
  }
}

/**
 * Check EMA Reclaim
 * Bounce BUY valid kalau harga reclaim EMA20 (atau 4H EMA8 untuk intraday)
 * Bounce SELL valid kalau gagal reclaim EMA20
 */
function checkEMAReclaim(signal, indicators, multiTimeframeIndicators, currentPrice) {
  if (!indicators || !currentPrice) {
    return { valid: true, reason: 'Insufficient data' }
  }
  
  const isBuyBounce = signal.bounce_type === 'BUY_BOUNCE' || (signal.signal === 'buy_to_enter' && signal.bounce_mode)
  const isSellBounce = signal.bounce_type === 'SELL_BOUNCE' || (signal.signal === 'sell_to_enter' && signal.bounce_mode)
  
  if (!isBuyBounce && !isSellBounce) {
    return { valid: true, reason: 'Not a bounce signal' }
  }
  
  // Check EMA20 reclaim for 1H timeframe
  const ema20 = indicators.ema20
  
  // Check 4H EMA8 if available (for intraday)
  let ema4h8 = null
  if (multiTimeframeIndicators && multiTimeframeIndicators['4h']) {
    const ema4h = multiTimeframeIndicators['4h'].ema
    if (ema4h && ema4h.length >= 8) {
      // Calculate EMA8 from 4H data
      ema4h8 = ema4h[ema4h.length - 1] // Last EMA value
    }
  }
  
  // For BUY bounce: price should reclaim EMA20 (or 4H EMA8)
  if (isBuyBounce) {
    if (ema20 && currentPrice > ema20) {
      return {
        valid: true,
        reason: `Price reclaimed EMA20 ($${currentPrice.toFixed(2)} > $${ema20.toFixed(2)}) - bounce continuation confirmed`,
        emaReclaimed: true,
        emaLevel: ema20
      }
    } else if (ema4h8 && currentPrice > ema4h8) {
      return {
        valid: true,
        reason: `Price reclaimed 4H EMA8 ($${currentPrice.toFixed(2)} > $${ema4h8.toFixed(2)}) - bounce continuation confirmed`,
        emaReclaimed: true,
        emaLevel: ema4h8,
        timeframe: '4h'
      }
    } else {
      // Price failed to reclaim EMA - dead cat bounce
      return {
        valid: false,
        reason: `Price failed to reclaim EMA20 ($${currentPrice.toFixed(2)} < $${ema20?.toFixed(2) || 'N/A'}) - dead cat bounce risk`,
        emaReclaimed: false,
        emaLevel: ema20
      }
    }
  }
  
  // For SELL bounce: price should fail to reclaim EMA20
  if (isSellBounce) {
    if (ema20 && currentPrice < ema20) {
      return {
        valid: true,
        reason: `Price failed to reclaim EMA20 ($${currentPrice.toFixed(2)} < $${ema20.toFixed(2)}) - pullback continuation confirmed`,
        emaReclaimed: false,
        emaLevel: ema20
      }
    } else if (ema20 && currentPrice > ema20) {
      // Price reclaimed EMA - bounce failed
      return {
        valid: false,
        reason: `Price reclaimed EMA20 ($${currentPrice.toFixed(2)} > $${ema20.toFixed(2)}) - pullback failed, potential reversal`,
        emaReclaimed: true,
        emaLevel: ema20
      }
    }
  }
  
  return { valid: true, reason: 'EMA data not available' }
}

/**
 * Monitor Bounce Exit
 * Detects when bounce is weakening (e.g., price closes below EMA8 after rising >3%)
 * Returns exit signal for 50% position trim
 */
function monitorBounceExit(signal, historicalData, indicators, entryPrice, currentPrice) {
  if (!signal.bounce_mode || !historicalData || historicalData.length < 3 || !indicators || !entryPrice || !currentPrice) {
    return { shouldTrim: false, reason: 'Not a bounce signal or insufficient data' }
  }
  
  const isBuyBounce = signal.bounce_type === 'BUY_BOUNCE' || (signal.signal === 'buy_to_enter' && signal.bounce_mode)
  const isSellBounce = signal.bounce_type === 'SELL_BOUNCE' || (signal.signal === 'sell_to_enter' && signal.bounce_mode)
  
  if (!isBuyBounce && !isSellBounce) {
    return { shouldTrim: false, reason: 'Not a bounce signal' }
  }
  
  // Calculate price change from entry
  const priceChangeFromEntry = ((currentPrice - entryPrice) / entryPrice) * 100
  
  // For BUY bounce: check if price closed below EMA8 after rising >3%
  if (isBuyBounce) {
    if (priceChangeFromEntry > 3.0 && indicators.ema8 && currentPrice < indicators.ema8) {
      // Bounce weakening - price closed below EMA8 after good move
      return {
        shouldTrim: true,
        trimPercent: 0.50, // Trim 50% position
        reason: `Price closed below EMA8 ($${currentPrice.toFixed(2)} < $${indicators.ema8.toFixed(2)}) after rising ${priceChangeFromEntry.toFixed(2)}% - bounce weakening`,
        priceChange: priceChangeFromEntry,
        emaLevel: indicators.ema8
      }
    }
  }
  
  // For SELL bounce: check if price closed above EMA8 after falling >3%
  if (isSellBounce) {
    if (priceChangeFromEntry < -3.0 && indicators.ema8 && currentPrice > indicators.ema8) {
      // Bounce weakening - price closed above EMA8 after good move
      return {
        shouldTrim: true,
        trimPercent: 0.50, // Trim 50% position
        reason: `Price closed above EMA8 ($${currentPrice.toFixed(2)} > $${indicators.ema8.toFixed(2)}) after falling ${Math.abs(priceChangeFromEntry).toFixed(2)}% - bounce weakening`,
        priceChange: priceChangeFromEntry,
        emaLevel: indicators.ema8
      }
    }
  }
  
  return { shouldTrim: false, reason: 'Bounce still strong' }
}

/**
 * Calculate Bounce Decay Timer
 * After 12-24 candles (depending on timeframe), confidence decreases 2% per candle
 */
function calculateBounceDecay(signal, historicalData, timeframe = '1h') {
  if (!signal.bounce_mode || !historicalData || historicalData.length < 2) {
    return { decayPenalty: 0, candlesSinceBounce: 0, reason: 'Not a bounce signal or insufficient data' }
  }
  
  // Determine decay start based on timeframe
  // 1h: 12 candles, 4h: 6 candles, 1d: 1 candle
  let decayStartCandles = 12
  if (timeframe === '4h') decayStartCandles = 6
  else if (timeframe === '1d') decayStartCandles = 1
  
  // Find when bounce was detected (approximate - use last 3 candles as bounce detection window)
  // For simplicity, assume bounce was detected 3 candles ago
  const candlesSinceBounce = Math.min(3, historicalData.length - 1)
  
  if (candlesSinceBounce < decayStartCandles) {
    return { decayPenalty: 0, candlesSinceBounce, reason: `Bounce still fresh (${candlesSinceBounce} candles, decay starts at ${decayStartCandles})` }
  }
  
  // Calculate decay: 2% per candle after decay start
  const candlesOverDecayStart = candlesSinceBounce - decayStartCandles
  const decayPenalty = candlesOverDecayStart * 0.02 // 2% per candle
  
  return {
    decayPenalty: Math.min(0.50, decayPenalty), // Cap at 50% decay
    candlesSinceBounce,
    reason: `Bounce decay: ${candlesSinceBounce} candles since bounce (${candlesOverDecayStart} over decay start) → -${(decayPenalty * 100).toFixed(0)}% confidence`
  }
}

/**
 * Check Re-entry Filter (Second Attempt Bounce)
 * If persistence_failed = true but price reclaims EMA again within <6 candles
 * Give label "second attempt bounce" with 10-15% confidence boost
 */
function checkReentryBounce(signal, historicalData, indicators, multiTimeframeIndicators, currentPrice) {
  if (!signal.bounce_persistence_failed || !historicalData || historicalData.length < 6) {
    return { isReentry: false, reason: 'No previous persistence failure or insufficient data' }
  }
  
  const isBuyBounce = signal.bounce_type === 'BUY_BOUNCE' || (signal.signal === 'buy_to_enter' && signal.bounce_mode)
  const isSellBounce = signal.bounce_type === 'SELL_BOUNCE' || (signal.signal === 'sell_to_enter' && signal.bounce_mode)
  
  if (!isBuyBounce && !isSellBounce) {
    return { isReentry: false, reason: 'Not a bounce signal' }
  }
  
  // Check last 6 candles for EMA reclaim
  const recentCandles = historicalData.slice(-6)
  let emaReclaimed = false
  let candlesSinceFailure = 0
  
  const ema20 = indicators.ema20
  let ema4h8 = null
  if (multiTimeframeIndicators && multiTimeframeIndicators['4h']) {
    const ema4h = multiTimeframeIndicators['4h'].ema
    if (ema4h && ema4h.length >= 8) {
      ema4h8 = ema4h[ema4h.length - 1]
    }
  }
  
  // For BUY bounce: check if price reclaimed EMA20 or 4H EMA8 in last 6 candles
  if (isBuyBounce) {
    for (let i = recentCandles.length - 1; i >= 0; i--) {
      const candlePrice = recentCandles[i].close
      if ((ema20 && candlePrice > ema20) || (ema4h8 && candlePrice > ema4h8)) {
        emaReclaimed = true
        candlesSinceFailure = recentCandles.length - 1 - i
        break
      }
    }
  }
  
  // For SELL bounce: check if price failed to reclaim EMA20 (stayed below) in last 6 candles
  if (isSellBounce) {
    for (let i = recentCandles.length - 1; i >= 0; i--) {
      const candlePrice = recentCandles[i].close
      if (ema20 && candlePrice < ema20) {
        emaReclaimed = true
        candlesSinceFailure = recentCandles.length - 1 - i
        break
      }
    }
  }
  
  if (emaReclaimed && candlesSinceFailure < 6) {
    // Second attempt bounce detected
    const confidenceBoost = 0.10 + (candlesSinceFailure < 3 ? 0.05 : 0) // 10-15% boost
    return {
      isReentry: true,
      confidenceBoost,
      candlesSinceFailure,
      reason: `Second attempt bounce: EMA reclaimed within ${candlesSinceFailure} candles after persistence failure`,
      emaLevel: ema20 || ema4h8
    }
  }
  
  return { isReentry: false, reason: 'EMA not reclaimed within 6 candles' }
}

/**
 * Calculate Dynamic TP Trail for Bounce Signals
 * TP trail = min(bounceTP, price_at_EMA8_crossdown)
 * Profit based on actual momentum, not fixed TP
 */
function calculateBounceTPTrail(entryPrice, signal, indicators, historicalData, bounceTP) {
  if (!signal.bounce_mode || !indicators || !historicalData || historicalData.length < 2) {
    return { tpPrice: bounceTP, isTrailing: false, reason: 'Not a bounce signal or insufficient data' }
  }
  
  const isBuyBounce = signal.bounce_type === 'BUY_BOUNCE' || (signal.signal === 'buy_to_enter' && signal.bounce_mode)
  const isSellBounce = signal.bounce_type === 'SELL_BOUNCE' || (signal.signal === 'sell_to_enter' && signal.bounce_mode)
  
  if (!isBuyBounce && !isSellBounce) {
    return { tpPrice: bounceTP, isTrailing: false, reason: 'Not a bounce signal' }
  }
  
  const ema8 = indicators.ema8
  if (!ema8) {
    return { tpPrice: bounceTP, isTrailing: false, reason: 'EMA8 not available' }
  }
  
  const currentPrice = historicalData[historicalData.length - 1].close
  const previousPrice = historicalData[historicalData.length - 2].close
  const previousEma8 = indicators.ema8 // For simplicity, use current EMA8 (in real implementation, track EMA8 history)
  
  // For BUY bounce: TP trail = min(bounceTP, price when EMA8 crossdown occurs)
  if (isBuyBounce) {
    // Check if EMA8 crossdown occurred (price crossed below EMA8)
    if (previousPrice >= ema8 && currentPrice < ema8) {
      // EMA8 crossdown detected - use current price as trailing TP
      const trailingTP = currentPrice
      if (trailingTP < bounceTP) {
        return {
          tpPrice: trailingTP,
          isTrailing: true,
          reason: `EMA8 crossdown detected at $${trailingTP.toFixed(2)} (below bounce TP $${bounceTP.toFixed(2)}) - using trailing TP`,
          emaLevel: ema8
        }
      }
    }
  }
  
  // For SELL bounce: If price crosses above EMA8, pullback failed - exit at current price
  // TP trail = current price when EMA8 crossup (faster exit than waiting for bounceTP)
  if (isSellBounce) {
    // Check if EMA8 crossup occurred (price crossed above EMA8)
    if (previousPrice <= ema8 && currentPrice > ema8) {
      // EMA8 crossup detected - pullback failed, exit at current price
      const trailingTP = currentPrice
      // For SELL: Use trailing TP if it's above entry (means we can exit with profit or smaller loss)
      // This allows faster exit when momentum changes
      return {
        tpPrice: trailingTP,
        isTrailing: true,
        reason: `EMA8 crossup detected at $${trailingTP.toFixed(2)} (pullback failed, momentum changed) - using trailing TP for faster exit`,
        emaLevel: ema8
      }
    }
  }
  
  // No trailing TP - use original bounce TP
  return { tpPrice: bounceTP, isTrailing: false, reason: 'No EMA8 cross detected, using original bounce TP' }
}

/**
 * Calculate Dynamic SL Offset for Bounce Signals
 * ATR tinggi → SL × 1.5 (lebar untuk hindari shadow wick)
 * ATR rendah → SL × 0.8 (ketat)
 */
function calculateBounceSLOffset(slDistance, indicators, entryPrice) {
  if (!indicators || !indicators.atr || !entryPrice) {
    return slDistance // Return original if no ATR data
  }
  
  const atr = indicators.atr
  const atrPercent = (atr / entryPrice) * 100
  
  // High ATR (> 3%): Use wider SL (× 1.5) to avoid shadow wick
  if (atrPercent > 3.0) {
    return slDistance * 1.5
  }
  // Low ATR (< 1.5%): Use tight SL (× 0.8)
  else if (atrPercent < 1.5) {
    return slDistance * 0.8
  }
  // Normal ATR (1.5% - 3%): Use standard SL
  return slDistance
}

/**
 * Check Bounce Setup
 * Detects when price exits no-trade zone (exhaustion) and shows reversal potential
 * Returns bounce type and strength if bounce setup detected
 */
function checkBounceSetup(historicalData, indicators, price) {
  if (!historicalData || historicalData.length < 2 || !indicators || !price) {
    return null
  }
  
  const currentCandle = historicalData[historicalData.length - 1]
  const previousCandle = historicalData[historicalData.length - 2]
  
  if (!currentCandle || !previousCandle) {
    return null
  }
  
  const bbLower = indicators.bollingerBands?.lower
  const bbUpper = indicators.bollingerBands?.upper
  const rsi = indicators.rsi14 || indicators.rsi7
  const stochK = indicators.stochastic?.k
  const stochD = indicators.stochastic?.d
  const atr = indicators.atr
  const volume = currentCandle.volume || 0
  
  // Calculate average volume (last 10 candles)
  let avgVolume = 0
  if (historicalData.length >= 10) {
    const recentVolumes = historicalData.slice(-10).map(c => c.volume || 0)
    avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length
  }
  
  // Calculate candle body size
  const candleBody = Math.abs(currentCandle.close - currentCandle.open)
  
  // Bullish bounce: Price was below BB Lower, now closed above it
  if (bbLower && previousCandle.close < bbLower && currentCandle.close > bbLower) {
    // Check confirmations
    const rsiOversold = rsi !== null && rsi !== undefined && rsi < 40
    const stochBullish = stochK !== null && stochD !== null && stochK > stochD
    const volumeConfirmed = avgVolume > 0 && volume > avgVolume
    const atrValid = atr && price > 0 && (atr / price) * 100 > 1.5
    const candleBodyValid = atr && candleBody > (atr * 0.5)
    
    // Count confirmations
    let confirmations = 0
    if (rsiOversold) confirmations++
    if (stochBullish) confirmations++
    if (volumeConfirmed) confirmations++
    if (atrValid) confirmations++
    if (candleBodyValid) confirmations++
    
    // Minimum 2 confirmations required
    if (confirmations >= 2) {
      const bounceStrength = confirmations / 5 // 0.2 to 1.0
      return {
        type: 'BUY_BOUNCE',
        strength: bounceStrength,
        confirmations: confirmations,
        reason: `Rebound from BB Lower + ${confirmations} confirmations (RSI: ${rsi?.toFixed(1) || 'N/A'}, Stoch: ${stochK?.toFixed(1) || 'N/A'}/${stochD?.toFixed(1) || 'N/A'})`,
        rsiOversold,
        stochBullish,
        volumeConfirmed,
        atrValid,
        candleBodyValid
      }
    }
  }
  
  // Bearish bounce: Price was above BB Upper, now closed below it
  if (bbUpper && previousCandle.close > bbUpper && currentCandle.close < bbUpper) {
    // Check confirmations
    const rsiOverbought = rsi !== null && rsi !== undefined && rsi > 60
    const stochBearish = stochK !== null && stochD !== null && stochK < stochD
    const volumeConfirmed = avgVolume > 0 && volume > avgVolume
    const atrValid = atr && price > 0 && (atr / price) * 100 > 1.5
    const candleBodyValid = atr && candleBody > (atr * 0.5)
    
    // Count confirmations
    let confirmations = 0
    if (rsiOverbought) confirmations++
    if (stochBearish) confirmations++
    if (volumeConfirmed) confirmations++
    if (atrValid) confirmations++
    if (candleBodyValid) confirmations++
    
    // Minimum 2 confirmations required
    if (confirmations >= 2) {
      const bounceStrength = confirmations / 5 // 0.2 to 1.0
      return {
        type: 'SELL_BOUNCE',
        strength: bounceStrength,
        confirmations: confirmations,
        reason: `Pullback from BB Upper + ${confirmations} confirmations (RSI: ${rsi?.toFixed(1) || 'N/A'}, Stoch: ${stochK?.toFixed(1) || 'N/A'}/${stochD?.toFixed(1) || 'N/A'})`,
        rsiOverbought,
        stochBearish,
        volumeConfirmed,
        atrValid,
        candleBodyValid
      }
    }
  }
  
  return null
}

// Calculate confidence score based on technical indicators and market conditions
// Revised scoring system: 120 points total (was 138)
function calculateConfidenceScore(signal, indicators, trendAlignment, marketRegime, riskRewardRatio, externalData = null) {
  let score = 0
  let maxScore = 0
  const breakdown = []
  let trendScore = 0 // Store for gatekeeper check at the end
  
  // 1. Trend Alignment (0-25 points) - GATEKEEPER (must be ≥15 to proceed)
  maxScore += 25
  
  if (trendAlignment) {
    // Daily Trend: 10 points
    let dailyTrendScore = 0
    if (trendAlignment.dailyTrend) {
      const signalMatchesDailyTrend = (signal.signal === 'buy_to_enter' || signal.signal === 'add') 
        ? trendAlignment.dailyTrend === 'uptrend'
        : (signal.signal === 'sell_to_enter')
        ? trendAlignment.dailyTrend === 'downtrend'
        : false
      
      if (signalMatchesDailyTrend) {
        dailyTrendScore = 10
      } else if (trendAlignment.dailyTrend === 'neutral') {
        dailyTrendScore = 0
      } else {
        dailyTrendScore = 0 // Contradiction - no score
      }
    }
    
    // 4H Trend Match: 8 points
    let h4TrendScore = 0
    if (trendAlignment.h4Aligned !== undefined) {
      if (trendAlignment.h4Aligned) {
        h4TrendScore = 8
      }
    }
    
    // 1H Trend Match: 7 points
    let h1TrendScore = 0
    if (trendAlignment.h1Aligned !== undefined) {
      if (trendAlignment.h1Aligned) {
        h1TrendScore = 7
      }
    }
    
    trendScore = dailyTrendScore + h4TrendScore + h1TrendScore
    
    // Use alignmentScore if available (0-100), convert to 0-25 points
    if (trendAlignment.alignmentScore !== undefined) {
      const signalMatchesTrend = (signal.signal === 'buy_to_enter' || signal.signal === 'add') 
        ? trendAlignment.dailyTrend === 'uptrend'
        : (signal.signal === 'sell_to_enter')
        ? trendAlignment.dailyTrend === 'downtrend'
        : false
      
      if (signalMatchesTrend) {
        trendScore = Math.round((trendAlignment.alignmentScore / 100) * 25)
      } else if (trendAlignment.dailyTrend !== 'neutral') {
        trendScore = Math.round((trendAlignment.alignmentScore / 100) * 10) // Reduced score (40% of full)
      } else {
        trendScore = 0
      }
    }
  } else if (indicators) {
    // Fallback: Calculate basic trend alignment from primary timeframe
    if (indicators.ema20 && indicators.ema50 && indicators.price) {
      const price = indicators.price
      const ema20 = indicators.ema20
      const ema50 = indicators.ema50
      const ema200 = indicators.ema200
      
      // Daily Trend: 10 points (based on EMA alignment)
      let dailyTrendScore = 0
      const isUptrend = price > ema20 && ema20 > ema50
      const isDowntrend = price < ema20 && ema20 < ema50
      
      if (isUptrend && (signal.signal === 'buy_to_enter' || signal.signal === 'add')) {
        dailyTrendScore = 10
      } else if (isDowntrend && signal.signal === 'sell_to_enter') {
        dailyTrendScore = 10
      }
      
      // 4H Trend Match: 8 points (if EMA200 confirms)
      let h4TrendScore = 0
      if (ema200) {
        if ((isUptrend && price > ema200 && ema50 > ema200 && (signal.signal === 'buy_to_enter' || signal.signal === 'add')) ||
            (isDowntrend && price < ema200 && ema50 < ema200 && signal.signal === 'sell_to_enter')) {
          h4TrendScore = 8
        }
      }
      
      // 1H Trend Match: 7 points (if price aligns with EMAs)
      let h1TrendScore = 0
      if ((isUptrend && (signal.signal === 'buy_to_enter' || signal.signal === 'add')) ||
          (isDowntrend && signal.signal === 'sell_to_enter')) {
        h1TrendScore = 7
      }
      
      trendScore = dailyTrendScore + h4TrendScore + h1TrendScore
    }
  }
  
  // Store trendScore for gatekeeper check later, but continue calculating all categories
  score += trendScore
  breakdown.push(`Trend Alignment: ${trendScore}/25`)
  
  // 2. Risk/Reward Quality (0-20 points)
  maxScore += 20
  let rrScore = 0
  
  // R/R Ratio: 15 points (scale: 2.0=10, 2.5=12, 3.0=15)
  if (riskRewardRatio) {
    if (riskRewardRatio >= 3.0) rrScore += 15
    else if (riskRewardRatio >= 2.5) rrScore += 12
    else if (riskRewardRatio >= 2.0) rrScore += 10
    else if (riskRewardRatio >= 1.5) rrScore += 7
    else if (riskRewardRatio >= 1.0) rrScore += 3
  }
  
  // SL Tightness (≤1.5%): 5 points
  // Calculate from signal stop_loss if available
  if (signal.stop_loss && signal.entry_price) {
    const entryPrice = signal.entry_price
    const stopLoss = signal.stop_loss
    const slDistance = Math.abs(entryPrice - stopLoss) / entryPrice * 100 // Percentage
    
    if (slDistance <= 1.5) {
      rrScore += 5
    } else if (slDistance <= 2.0) {
      rrScore += 3
    } else if (slDistance <= 2.5) {
      rrScore += 1
    }
  }
  
  score += rrScore
  breakdown.push(`Risk/Reward: ${rrScore}/20`)
  
  // 3. Technical Consensus (0-30 points)
  maxScore += 30
  let technicalScore = 0
  
  // Price vs EMA20/50/200: 8 points
  if (indicators.ema20 && indicators.ema50 && indicators.ema200 && indicators.price) {
    const price = indicators.price
    const ema20 = indicators.ema20
    const ema50 = indicators.ema50
    const ema200 = indicators.ema200
    
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (price > ema20 && ema20 > ema50 && price > ema200 && ema50 > ema200) {
        technicalScore += 8 // Perfect alignment: Price > EMA20 > EMA50 > EMA200
      } else if (price > ema20 && ema20 > ema50) {
        technicalScore += 6 // Good alignment: Price > EMA20 > EMA50
      } else if (price > ema20) {
        technicalScore += 4 // Price above EMA20
      } else if (price > ema50) {
        technicalScore += 2 // Price above EMA50
      } else {
        technicalScore += 0 // Price below all EMAs
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (price < ema20 && ema20 < ema50 && price < ema200 && ema50 < ema200) {
        technicalScore += 8 // Perfect alignment: Price < EMA20 < EMA50 < EMA200
      } else if (price < ema20 && ema20 < ema50) {
        technicalScore += 6 // Good alignment: Price < EMA20 < EMA50
      } else if (price < ema20) {
        technicalScore += 4 // Price below EMA20
      } else if (price < ema50) {
        technicalScore += 2 // Price below EMA50
      } else {
        technicalScore += 0 // Price above all EMAs
      }
    }
  }
  
  // Price vs VWAP: 5 points
  if (indicators.vwap && indicators.price) {
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (indicators.price > indicators.vwap) {
        technicalScore += 5 // Price above VWAP (bullish)
      } else {
        technicalScore += 0 // Price below VWAP
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (indicators.price < indicators.vwap) {
        technicalScore += 5 // Price below VWAP (bearish)
      } else {
        technicalScore += 0 // Price above VWAP
      }
    }
  }
  
  // Bollinger Position: 5 points
  if (indicators.bollingerBands && indicators.price) {
    const price = indicators.price
    const bbMiddle = indicators.bollingerBands.middle
    
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (price < bbMiddle) {
        technicalScore += 4 // Below middle (bullish for buy)
      } else {
        technicalScore += 1 // Above middle
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (price > bbMiddle) {
        technicalScore += 4 // Above middle (bearish for sell)
      } else {
        technicalScore += 1 // Below middle
      }
    }
  }
  
  // Parabolic SAR: 4 points
  if (indicators.parabolicSAR && indicators.price) {
    const price = indicators.price
    const sar = indicators.parabolicSAR
    
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (price > sar) {
        technicalScore += 4 // SAR below price (bullish)
      } else {
        technicalScore += 0 // SAR above price
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (price < sar) {
        technicalScore += 4 // SAR above price (bearish)
      } else {
        technicalScore += 0 // SAR below price
      }
    }
  }
  
  // OBV Direction: 4 points
  if (indicators.obv !== null && indicators.obv !== undefined) {
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (indicators.obv > 0) {
        technicalScore += 4 // Positive OBV (buying pressure)
      } else {
        technicalScore += 0 // Negative OBV
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (indicators.obv < 0) {
        technicalScore += 4 // Negative OBV (selling pressure)
      } else {
        technicalScore += 0 // Positive OBV
      }
    }
  }
  
  // Stochastic/Williams: 4 points
  if (indicators.stochastic && indicators.stochastic.k !== undefined) {
    const stochK = indicators.stochastic.k
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (stochK < 20) technicalScore += 4 // Oversold
      else if (stochK < 30) technicalScore += 2 // Approaching oversold
      else if (stochK > 80) technicalScore += 0 // Overbought
      else technicalScore += 1 // Neutral
    } else if (signal.signal === 'sell_to_enter') {
      if (stochK > 80) technicalScore += 4 // Overbought
      else if (stochK > 70) technicalScore += 2 // Approaching overbought
      else if (stochK < 20) technicalScore += 0 // Oversold
      else technicalScore += 1 // Neutral
    }
  } else if (indicators.williamsR !== null && indicators.williamsR !== undefined) {
    const williamsR = indicators.williamsR
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (williamsR < -80) technicalScore += 4 // Oversold
      else if (williamsR < -70) technicalScore += 2 // Approaching oversold
      else if (williamsR > -20) technicalScore += 0 // Overbought
      else technicalScore += 1 // Neutral
    } else if (signal.signal === 'sell_to_enter') {
      if (williamsR > -20) technicalScore += 4 // Overbought
      else if (williamsR > -30) technicalScore += 2 // Approaching overbought
      else if (williamsR < -80) technicalScore += 0 // Oversold
      else technicalScore += 1 // Neutral
    }
  }
  
  score += technicalScore
  breakdown.push(`Technical Consensus: ${technicalScore}/30`)
  
  // 4. Market Context (0-10 points)
  maxScore += 10
  let marketContextScore = 0
  
  // Market Regime: 5 points
  if (marketRegime) {
    if (marketRegime.regime === 'trending') {
      marketContextScore += 5
    } else if (marketRegime.regime === 'neutral') {
      marketContextScore += 3
    } else if (marketRegime.regime === 'choppy') {
      marketContextScore += 2
    } else if (marketRegime.regime === 'volatile') {
      marketContextScore += 3
    }
  }
  
  // Volatility (ATR / Price): 5 points
  if (indicators.atr && indicators.price) {
    const atrPercent = (indicators.atr / indicators.price) * 100
    if (atrPercent < 2) {
      marketContextScore += 5 // Low volatility (good)
    } else if (atrPercent < 4) {
      marketContextScore += 4 // Normal volatility
    } else if (atrPercent < 6) {
      marketContextScore += 3 // High volatility
    } else {
      marketContextScore += 2 // Very high volatility
    }
  }
  
  score += marketContextScore
  breakdown.push(`Market Context: ${marketContextScore}/10`)
  
  // 5. Support/Resistance (0-5 points)
  maxScore += 5
  let srScore = 0
  if (indicators.supportResistance && indicators.price) {
    const price = indicators.price
    const support = indicators.supportResistance.support
    const resistance = indicators.supportResistance.resistance
    
    // Proximity to Support: 3 points
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (support && Math.abs(price - support) / support < 0.01) {
        srScore += 3 // Very close to support
      } else if (support && Math.abs(price - support) / support < 0.02) {
        srScore += 2 // Close to support
      } else if (support && Math.abs(price - support) / support < 0.05) {
        srScore += 1 // Near support
      }
    }
    
    // Clear Resistance Above: 2 points
    if (resistance && price < resistance) {
      const distanceToResistance = (resistance - price) / price
      if (distanceToResistance < 0.05) {
        srScore += 2 // Close resistance
      } else if (distanceToResistance < 0.10) {
        srScore += 1 // Moderate distance
      }
    }
  }
  
  score += srScore
  breakdown.push(`Support/Resistance: ${srScore}/5`)
  
  // 6. Divergence & Momentum (0-10 points)
  maxScore += 10
  let divergenceScore = 0
  
  // MACD Histogram Trend: 5 points (actively assess momentum)
  if (indicators.macd && indicators.macd.histogram !== null && indicators.macd.histogram !== undefined) {
    const macdHist = indicators.macd.histogram
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (macdHist > 0) {
        divergenceScore += 5 // Bullish momentum (good for long)
      } else {
        divergenceScore += 0 // Bearish momentum (bad for long)
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (macdHist < 0) {
        divergenceScore += 5 // Bearish momentum (good for short)
      } else if (macdHist > 0) {
        divergenceScore += 1 // Bullish momentum (bad for short)
      } else {
        divergenceScore += 0 // Neutral
      }
    }
  }
  
  // RSI vs Price (Hidden Divergence): 5 points
  if (indicators.rsi14 !== null && indicators.rsi14 !== undefined && indicators.price) {
    // Simple check: RSI divergence would require price history, so we use RSI level as proxy
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (indicators.rsi14 < 30) {
        divergenceScore += 5 // Oversold (bullish divergence potential)
      } else if (indicators.rsi14 < 40) {
        divergenceScore += 3 // Approaching oversold
      } else if (indicators.rsi14 > 70) {
        divergenceScore += 0 // Overbought
      } else {
        divergenceScore += 2 // Neutral
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (indicators.rsi14 > 70) {
        divergenceScore += 5 // Overbought (bearish divergence potential)
      } else if (indicators.rsi14 > 60) {
        divergenceScore += 3 // Approaching overbought
      } else if (indicators.rsi14 < 30) {
        divergenceScore += 0 // Oversold
      } else {
        divergenceScore += 2 // Neutral
      }
    }
  }
  
  score += divergenceScore
  breakdown.push(`Divergence & Momentum: ${divergenceScore}/10`)
  
  // 7. External Confirmation (0-30 points) - increased from 20 to include new futures indicators (COB, SVP, CRVP, COC, CVD)
  maxScore += 30
  let externalScore = 0
  if (externalData) {
    const price = indicators?.price || 0
    const isBuySignal = signal.signal === 'buy_to_enter' || signal.signal === 'add'
    const isSellSignal = signal.signal === 'sell_to_enter'
    
    // Funding Rate: 3 points
    if (externalData.hyperliquid && externalData.hyperliquid.fundingRate !== undefined) {
      const fundingRate = externalData.hyperliquid.fundingRate
      if (isBuySignal) {
        if (fundingRate < 0) {
          externalScore += 3 // Negative funding (bullish)
        } else if (Math.abs(fundingRate) < 0.0001) {
          externalScore += 2 // Neutral
        } else {
          externalScore += 1 // Positive funding
        }
      } else if (isSellSignal) {
        if (fundingRate > 0) {
          externalScore += 3 // Positive funding (bearish)
        } else if (Math.abs(fundingRate) < 0.0001) {
          externalScore += 2 // Neutral
        } else {
          externalScore += 1 // Negative funding
        }
      }
    }
    
    // Open Interest Trend: 3 points
    if (externalData.hyperliquid && externalData.hyperliquid.oiTrend) {
      const oiTrend = externalData.hyperliquid.oiTrend
      if (oiTrend === 'increasing') {
        externalScore += 3
      } else if (oiTrend === 'stable') {
        externalScore += 1
      } else {
        externalScore += 0
      }
    }
    
    // NEW: COB (Order Book Depth) - 4 points
    if (externalData.orderBook && price > 0) {
      const ob = externalData.orderBook
      // Bid/ask imbalance: bullish if positive (more bids), bearish if negative (more asks)
      if (isBuySignal && ob.imbalance > 0.1) {
        externalScore += 2 // Bullish: more bids than asks
      } else if (isSellSignal && ob.imbalance < -0.1) {
        externalScore += 2 // Bearish: more asks than bids
      } else if (Math.abs(ob.imbalance) < 0.05) {
        externalScore += 1 // Neutral
      }
      // Support/resistance zones
      if (ob.supportZones && ob.supportZones.length > 0 && isBuySignal) {
        const support = ob.supportZones[0]
        if (support.distance < price * 0.02) { // Within 2% of price
          externalScore += 2 // Strong support nearby
        }
      }
      if (ob.resistanceZones && ob.resistanceZones.length > 0 && isSellSignal) {
        const resistance = ob.resistanceZones[0]
        if (resistance.distance < price * 0.02) { // Within 2% of price
          externalScore += 2 // Strong resistance nearby
        }
      }
    }
    
    // NEW: SVP (Session Volume Profile) - 3 points
    if (externalData.volumeProfile && externalData.volumeProfile.session && price > 0) {
      const svp = externalData.volumeProfile.session
      const priceToPoc = Math.abs((price - svp.poc) / svp.poc) * 100
      const priceToVah = Math.abs((price - svp.vah) / svp.vah) * 100
      const priceToVal = Math.abs((price - svp.val) / svp.val) * 100
      // Price at POC, VAH, or VAL = strong support/resistance
      if (priceToPoc < 1) {
        externalScore += 3 // Price at POC (strongest level)
      } else if (priceToVah < 1 || priceToVal < 1) {
        externalScore += 2 // Price at VAH or VAL
      } else if (price >= svp.val && price <= svp.vah) {
        externalScore += 1 // Price within value area
      }
      // HVN support/resistance
      if (svp.hvn && svp.hvn.length > 0) {
        const nearestHVN = svp.hvn[0]
        const distanceToHVN = Math.abs((price - nearestHVN.price) / price) * 100
        if (distanceToHVN < 2) {
          externalScore += 1 // Price near HVN (support/resistance)
        }
      }
    }
    
    // NEW: CRVP (Composite Volume Profile) - 2 points
    if (externalData.volumeProfile && externalData.volumeProfile.composite && price > 0) {
      const crvp = externalData.volumeProfile.composite
      // Accumulation zone (bullish)
      if (crvp.accumulationZone && isBuySignal) {
        const accZone = crvp.accumulationZone
        if (price >= accZone.priceRange[0] && price <= accZone.priceRange[1]) {
          externalScore += 2 // Price in accumulation zone
        }
      }
      // Distribution zone (bearish)
      if (crvp.distributionZone && isSellSignal) {
        const distZone = crvp.distributionZone
        if (price >= distZone.priceRange[0] && price <= distZone.priceRange[1]) {
          externalScore += 2 // Price in distribution zone
        }
      }
    }
    
    // NEW: COC (Change of Character) - 4 points
    if (externalData.marketStructure && externalData.marketStructure.coc) {
      const coc = externalData.marketStructure.coc
      // Bullish COC for buy signals
      if (coc.coc === 'bullish' && coc.reversalSignal && isBuySignal) {
        externalScore += 4 // Strong bullish reversal signal
      } else if (coc.coc === 'bullish' && isBuySignal) {
        externalScore += 2 // Forming bullish COC
      }
      // Bearish COC for sell signals
      if (coc.coc === 'bearish' && coc.reversalSignal && isSellSignal) {
        externalScore += 4 // Strong bearish reversal signal
      } else if (coc.coc === 'bearish' && isSellSignal) {
        externalScore += 2 // Forming bearish COC
      }
      // Structure alignment
      if (coc.structure === 'bullish' && isBuySignal && coc.structureStrength > 50) {
        externalScore += 1 // Strong bullish structure
      } else if (coc.structure === 'bearish' && isSellSignal && coc.structureStrength > 50) {
        externalScore += 1 // Strong bearish structure
      }
    }
    
    // NEW: CVD (Cumulative Volume Delta) - 4 points
    if (externalData.volumeDelta) {
      const cvd = externalData.volumeDelta
      // CVD trend
      if (cvd.cvdTrend === 'rising' && isBuySignal) {
        externalScore += 2 // Bullish: buyers more aggressive
      } else if (cvd.cvdTrend === 'falling' && isSellSignal) {
        externalScore += 2 // Bearish: sellers more aggressive
      }
      // CVD delta
      if (cvd.cvdDelta > 0 && isBuySignal) {
        externalScore += 1 // Bullish: buyers dominant
      } else if (cvd.cvdDelta < 0 && isSellSignal) {
        externalScore += 1 // Bearish: sellers dominant
      }
      // Divergence detection (very important)
      if (cvd.divergence === 'bullish' && isBuySignal) {
        externalScore += 2 // Bullish divergence: hidden buying pressure
      } else if (cvd.divergence === 'bearish' && isSellSignal) {
        externalScore += 2 // Bearish divergence: hidden selling pressure
      } else if (cvd.divergence !== 'none') {
        externalScore -= 1 // Divergence against signal = warning
      }
      // CVD strength
      if (cvd.strength > 70) {
        externalScore += 1 // Strong CVD signal
      }
    }
    
    // Exchange Netflow + Price Action: 7 points (only if confirmed by price)
    if (externalData.blockchain && externalData.blockchain.estimatedExchangeFlow !== undefined && indicators.priceChange24h !== undefined) {
      const flow = externalData.blockchain.estimatedExchangeFlow
      const priceChange = indicators.priceChange24h
      
      if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
        // Inflow but price up = bullish risk (contradiction)
        if (flow > 0 && priceChange > 0) {
          externalScore += 2 // Contradiction: inflow but price up
        } else if (flow < 0 && priceChange > 0) {
          externalScore += 7 // Outflow + price up = strong bullish
        } else if (flow < 0) {
          externalScore += 4 // Outflow (bullish)
        } else {
          externalScore += 1 // Inflow (bearish)
        }
      } else if (signal.signal === 'sell_to_enter') {
        // Outflow but price down = bearish risk (contradiction)
        if (flow < 0 && priceChange < 0) {
          externalScore += 2 // Contradiction: outflow but price down
        } else if (flow > 0 && priceChange < 0) {
          externalScore += 7 // Inflow + price down = strong bearish
        } else if (flow > 0) {
          externalScore += 4 // Inflow (bearish)
        } else {
          externalScore += 1 // Outflow (bullish)
        }
      }
    }
    
    // Volume Confirmation: 3 points
    if (externalData.enhanced && externalData.enhanced.volumeTrend) {
      const volTrend = externalData.enhanced.volumeTrend
      if (volTrend === 'increasing') {
        externalScore += 3
      } else if (volTrend === 'stable') {
        externalScore += 1
      } else {
        externalScore += 0
      }
    }
    
    // Whale/Smart Money Signal: 4 points
    if (externalData.blockchain && externalData.blockchain.whaleActivityScore !== undefined) {
      const whaleScore = externalData.blockchain.whaleActivityScore
      if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
        if (whaleScore > 0.5) {
          externalScore += 4 // Strong bullish whale activity
        } else if (whaleScore > 0) {
          externalScore += 2
        } else {
          externalScore += 0
        }
      } else if (signal.signal === 'sell_to_enter') {
        if (whaleScore < -0.5) {
          externalScore += 4 // Strong bearish whale activity
        } else if (whaleScore < 0) {
          externalScore += 2
        } else {
          externalScore += 0
        }
      }
    }
  }
  
  score += externalScore
  breakdown.push(`External Confirmation: ${externalScore}/30`)
  
  // GATEKEEPER: Auto-reject if Trend Alignment < threshold
  // FUTURES TRADING: Much more relaxed threshold (5 for futures vs 20 for spot)
  // For futures, leverage allows for lower trend alignment scores
  // Only reject if trend alignment < 5 (extremely low for futures) or < 20 (spot)
  const FUTURES_TREND_ALIGNMENT_REJECT_THRESHOLD = 5  // Reject only if trend alignment < 5 for futures
  const SPOT_TREND_ALIGNMENT_REJECT_THRESHOLD = 20  // Reject if trend alignment < 20 for spot
  const trendAlignmentThreshold = TRADING_CONFIG.mode === 'AUTONOMOUS' 
    ? FUTURES_TREND_ALIGNMENT_REJECT_THRESHOLD  // Use futures threshold for AUTONOMOUS mode
    : SPOT_TREND_ALIGNMENT_REJECT_THRESHOLD  // Use spot threshold for other modes
  
  if (trendScore < trendAlignmentThreshold) {
    // Update breakdown to show auto-reject
    const trendBreakdownIndex = breakdown.findIndex(b => b.startsWith('Trend Alignment:'))
    if (trendBreakdownIndex >= 0) {
      breakdown[trendBreakdownIndex] = `Trend Alignment: ${trendScore}/25 (AUTO-REJECT: <${trendAlignmentThreshold} ${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'spot'} threshold)`
    }
    
    return {
      confidence: 0,
      breakdown: breakdown,
      totalScore: score,
      maxScore: maxScore,
      autoRejected: true,
      rejectionReason: `Trend Alignment score ${trendScore}/25 is below minimum threshold of ${trendAlignmentThreshold} (${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'spot'})`
    }
  }
  
  // Calculate final confidence (0-1 scale)
  const confidence = maxScore > 0 ? score / maxScore : 0.5 // Default to 50% if no data
  
  return {
    confidence: Math.min(Math.max(confidence, 0), 1), // Clamp between 0 and 1
    breakdown: breakdown,
    totalScore: score,
    maxScore: maxScore
  }
}

// Calculate Expected Value (EV) for a signal
function calculateExpectedValue(confidence, riskRewardRatio, riskAmount) {
  // EV = (probability_win × reward) - (probability_lose × risk)
  // reward = R:R × risk
  // probability_win = confidence
  // probability_lose = 1 - confidence
  const reward = riskRewardRatio * riskAmount
  const probabilityWin = confidence
  const probabilityLose = 1 - confidence
  const expectedValue = (probabilityWin * reward) - (probabilityLose * riskAmount)
  return expectedValue
}

// ═══════════════════════════════════════════════════════════════
// AUTONOMOUS FUTURES TRADING LOGIC
// Full auto-execution untuk BTC & ETH futures (long/short)
// ═══════════════════════════════════════════════════════════════

/**
 * Determine if signal should be auto-executed (Autonomous Futures Trading Logic)
 * @param {Object} signal - Trading signal object
 * @param {Object} indicators - Technical indicators
 * @param {Object} accountState - Current account state (optional)
 * @returns {Object} - Execution decision with details
 */
function shouldAutoExecute(signal, indicators, accountState = null) {
  const { 
    confidence, 
    expected_value: expectedValue, 
    signal: signalType,
    coin: asset 
  } = signal
  
  // Get thresholds from config
  const highConfidence = TRADING_CONFIG.thresholds.confidence.high
  const mediumConfidence = TRADING_CONFIG.thresholds.confidence.medium
  const lowConfidence = TRADING_CONFIG.thresholds.confidence.low
  
  const highEV = TRADING_CONFIG.thresholds.expectedValue.high
  const mediumEV = TRADING_CONFIG.thresholds.expectedValue.medium
  const lowEV = TRADING_CONFIG.thresholds.expectedValue.low
  
  // FUTURES TRADING: Use more relaxed thresholds for futures
  // For futures, EV can be more negative because leverage amplifies both profit and loss
  // Only reject if EV < -$2.00 (extremely negative for futures)
  const FUTURES_EV_REJECT_THRESHOLD = -2.00  // Reject only if EV < -$2.00 for futures
  const FUTURES_CONFIDENCE_REJECT_THRESHOLD = 0.05  // Reject only if confidence < 5% for futures
  
  // Use futures thresholds for AUTONOMOUS mode, standard thresholds for other modes
  const rejectConfidence = TRADING_CONFIG.mode === 'AUTONOMOUS'
    ? FUTURES_CONFIDENCE_REJECT_THRESHOLD  // Use futures threshold for AUTONOMOUS mode
    : TRADING_CONFIG.thresholds.confidence.reject  // Use standard threshold for other modes
  
  const rejectEV = TRADING_CONFIG.mode === 'AUTONOMOUS'
    ? FUTURES_EV_REJECT_THRESHOLD  // Use futures threshold for AUTONOMOUS mode
    : TRADING_CONFIG.thresholds.expectedValue.reject  // Use standard threshold for other modes
  
  // ════════════════════════════════════════════════════════
  // STEP 1: HARD REJECTION FILTERS
  // ════════════════════════════════════════════════════════
  
  // Reject if below minimum thresholds (using futures thresholds for AUTONOMOUS mode)
  if (confidence < rejectConfidence) {
    return {
      execute: false,
      reason: `Confidence too low: ${(confidence * 100).toFixed(2)}% < ${(rejectConfidence * 100).toFixed(2)}% (${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'standard'} threshold)`,
      level: 'REJECTED'
    }
  }
  
  // FUTURES TRADING: Only reject if EV is extremely negative (< -$2.00 for futures)
  if (expectedValue !== undefined && expectedValue !== null && expectedValue < rejectEV) {
    return {
      execute: false,
      reason: `Expected value too negative: $${expectedValue.toFixed(2)} < $${rejectEV.toFixed(2)} (${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'standard'} threshold)`,
      level: 'REJECTED'
    }
  }
  
  // ════════════════════════════════════════════════════════
  // STEP 2: HIGH CONFIDENCE (45%+, EV 0.8+)
  // ════════════════════════════════════════════════════════
  
  if (confidence >= highConfidence && expectedValue >= highEV) {
    return {
      execute: true,
      reason: `High confidence: ${(confidence * 100).toFixed(2)}%, EV: $${expectedValue.toFixed(2)}`,
      level: 'HIGH'
    }
  }
  
  // ════════════════════════════════════════════════════════
  // STEP 3: MEDIUM CONFIDENCE (35-45%, EV 0.5+)
  // ════════════════════════════════════════════════════════
  
  if (confidence >= mediumConfidence && expectedValue >= mediumEV) {
    return {
      execute: true,
      reason: `Medium confidence: ${(confidence * 100).toFixed(2)}%, EV: $${expectedValue.toFixed(2)}`,
      level: 'MEDIUM'
    }
  }
  
  // ════════════════════════════════════════════════════════
  // STEP 4: LOW CONFIDENCE - FUTURES TRADING: Much more relaxed threshold
  // ════════════════════════════════════════════════════════
  
  // FUTURES TRADING: Use much lower confidence threshold for futures
  // For futures, leverage allows for lower confidence (10%+ for standard, 8%+ for contrarian)
  // For spot trading, use standard threshold (25%+)
  const futuresLowConfidence = TRADING_CONFIG.mode === 'AUTONOMOUS' ? 0.10 : lowConfidence  // 10% for futures, 25% for spot
  const futuresLowEV = TRADING_CONFIG.mode === 'AUTONOMOUS' ? -1.50 : lowEV  // -$1.50 for futures, $0.30 for spot
  
  // FUTURES TRADING: Allow signals with confidence >= 10% (futures) or >= 25% (spot)
  if (confidence >= futuresLowConfidence && expectedValue >= futuresLowEV) {
    return {
      execute: true,
      reason: `Low confidence: ${(confidence * 100).toFixed(2)}%, EV: $${expectedValue.toFixed(2)} (${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'spot'} threshold)`,
      level: 'LOW'
    }
  }
  
  // Default: reject (should rarely be reached because rejectConfidence/rejectEV should catch it earlier)
  // FUTURES TRADING: Only reject if confidence < 5% (futures) or < 25% (spot)
  const minConfidenceForReject = TRADING_CONFIG.mode === 'AUTONOMOUS' 
    ? rejectConfidence  // 5% for futures (already checked in STEP 1, but fallback here)
    : lowConfidence  // 25% for spot
  
  return {
    execute: false,
    reason: `Below thresholds: Confidence ${(confidence * 100).toFixed(2)}% < ${(minConfidenceForReject * 100).toFixed(2)}% (${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'spot'} threshold), EV: $${expectedValue !== undefined && expectedValue !== null ? expectedValue.toFixed(2) : 'N/A'}`,
    level: 'REJECTED'
  }
}

// Main execution function
async function main() {
  logSection('🚀 Signal Generation Test')
  
  // Check configuration
  if (!AI_PROVIDER_API_KEY) {
    log('❌ Error: AI_PROVIDER_API_KEY is required', 'red')
    log('   Set it with: export AI_PROVIDER_API_KEY=your_api_key', 'yellow')
    process.exit(1)
  }
  
  // 2. Risk/Reward Quality (0-20 points)
  maxScore += 20
  let rrScore = 0
  if (riskRewardRatio) {
    // R/R Ratio: 15 points (refined scale: 2.0=10, 2.5=12, 3.0=15)
    if (riskRewardRatio >= 3.0) rrScore += 15
    else if (riskRewardRatio >= 2.5) rrScore += 12
    else if (riskRewardRatio >= 2.0) rrScore += 10
    else if (riskRewardRatio >= 1.5) rrScore += 7
    else if (riskRewardRatio >= 1.0) rrScore += 3
    
    // SL Tightness: 5 points (≤1.5% = 5, ≤2% = 3, ≤3% = 1)
    if (signal.stopLoss && indicators.price) {
      const slPercent = Math.abs((signal.stopLoss - indicators.price) / indicators.price) * 100
      if (slPercent <= 1.5) rrScore += 5
      else if (slPercent <= 2.0) rrScore += 3
      else if (slPercent <= 3.0) rrScore += 1
    }
  }
  score += rrScore
  breakdown.push(`Risk/Reward: ${rrScore}/20`)
  
  // 3. Technical Consensus (0-30 points)
  maxScore += 30
  let technicalScore = 0
  
  // Price vs EMA20/50/200: 8 points
  if (indicators.ema20 && indicators.ema50 && indicators.ema200 && indicators.price) {
    const price = indicators.price
    const ema20 = indicators.ema20
    const ema50 = indicators.ema50
    const ema200 = indicators.ema200
    
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (price > ema20 && ema20 > ema50 && price > ema200 && ema50 > ema200) {
        technicalScore += 8 // Perfect alignment: Price > EMA20 > EMA50 > EMA200
      } else if (price > ema20 && ema20 > ema50) {
        technicalScore += 6 // Good alignment: Price > EMA20 > EMA50
      } else if (price > ema20) {
        technicalScore += 4 // Price above EMA20
      } else if (price > ema50) {
        technicalScore += 2 // Price above EMA50
      } else {
        technicalScore += 0 // Price below all EMAs
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (price < ema20 && ema20 < ema50 && price < ema200 && ema50 < ema200) {
        technicalScore += 8 // Perfect alignment: Price < EMA20 < EMA50 < EMA200
      } else if (price < ema20 && ema20 < ema50) {
        technicalScore += 6 // Good alignment: Price < EMA20 < EMA50
      } else if (price < ema20) {
        technicalScore += 4 // Price below EMA20
      } else if (price < ema50) {
        technicalScore += 2 // Price below EMA50
      } else {
        technicalScore += 0 // Price above all EMAs
      }
    }
  }
  
  // Price vs VWAP: 5 points
  if (indicators.vwap && indicators.price) {
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (indicators.price > indicators.vwap) {
        technicalScore += 5 // Price above VWAP (bullish)
      } else {
        technicalScore += 0 // Price below VWAP
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (indicators.price < indicators.vwap) {
        technicalScore += 5 // Price below VWAP (bearish)
      } else {
        technicalScore += 0 // Price above VWAP
      }
    }
  }
  
  // Bollinger Position: 5 points
  if (indicators.bollingerBands && indicators.price) {
    const price = indicators.price
    const bbMiddle = indicators.bollingerBands.middle
    
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (price < bbMiddle) {
        technicalScore += 4 // Below middle (bullish for buy)
      } else {
        technicalScore += 1 // Above middle
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (price > bbMiddle) {
        technicalScore += 4 // Above middle (bearish for sell)
      } else {
        technicalScore += 1 // Below middle
      }
    }
  }
  
  // Parabolic SAR: 4 points
  if (indicators.parabolicSAR && indicators.price) {
    const price = indicators.price
    const sar = indicators.parabolicSAR
    
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (price > sar) {
        technicalScore += 4 // SAR below price (bullish)
      } else {
        technicalScore += 0 // SAR above price
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (price < sar) {
        technicalScore += 4 // SAR above price (bearish)
      } else {
        technicalScore += 0 // SAR below price
      }
    }
  }
  
  // OBV Direction: 4 points
  if (indicators.obv !== null && indicators.obv !== undefined) {
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (indicators.obv > 0) {
        technicalScore += 4 // Positive OBV (buying pressure)
      } else {
        technicalScore += 0 // Negative OBV
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (indicators.obv < 0) {
        technicalScore += 4 // Negative OBV (selling pressure)
      } else {
        technicalScore += 0 // Positive OBV
      }
    }
  }
  
  // Stochastic/Williams: 4 points
  if (indicators.stochastic && indicators.stochastic.k !== undefined) {
    const stochK = indicators.stochastic.k
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (stochK < 20) technicalScore += 4 // Oversold
      else if (stochK < 30) technicalScore += 2 // Approaching oversold
      else if (stochK > 80) technicalScore += 0 // Overbought
      else technicalScore += 1 // Neutral
    } else if (signal.signal === 'sell_to_enter') {
      if (stochK > 80) technicalScore += 4 // Overbought
      else if (stochK > 70) technicalScore += 2 // Approaching overbought
      else if (stochK < 20) technicalScore += 0 // Oversold
      else technicalScore += 1 // Neutral
    }
  } else if (indicators.williamsR !== null && indicators.williamsR !== undefined) {
    const williamsR = indicators.williamsR
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (williamsR < -80) technicalScore += 4 // Oversold
      else if (williamsR < -70) technicalScore += 2 // Approaching oversold
      else if (williamsR > -20) technicalScore += 0 // Overbought
      else technicalScore += 1 // Neutral
    } else if (signal.signal === 'sell_to_enter') {
      if (williamsR > -20) technicalScore += 4 // Overbought
      else if (williamsR > -30) technicalScore += 2 // Approaching overbought
      else if (williamsR < -80) technicalScore += 0 // Oversold
      else technicalScore += 1 // Neutral
    }
  }
  
  score += technicalScore
  breakdown.push(`Technical Consensus: ${technicalScore}/30`)
  
  // 4. Market Context (0-10 points)
  maxScore += 10
  let marketContextScore = 0
  
  // Market Regime: 5 points
  if (marketRegime) {
    if (marketRegime.regime === 'trending') {
      marketContextScore += 5
    } else if (marketRegime.regime === 'neutral') {
      marketContextScore += 3
    } else if (marketRegime.regime === 'choppy') {
      marketContextScore += 2
    } else if (marketRegime.regime === 'volatile') {
      marketContextScore += 3
    }
  }
  
  // Volatility (ATR / Price): 5 points
  if (indicators.atr && indicators.price) {
    const atrPercent = (indicators.atr / indicators.price) * 100
    if (atrPercent < 2) {
      marketContextScore += 5 // Low volatility (good)
    } else if (atrPercent < 4) {
      marketContextScore += 4 // Normal volatility
    } else if (atrPercent < 6) {
      marketContextScore += 3 // High volatility
    } else {
      marketContextScore += 2 // Very high volatility
    }
  }
  
  score += marketContextScore
  breakdown.push(`Market Context: ${marketContextScore}/10`)
  
  // 5. Support/Resistance (0-5 points)
  maxScore += 5
  let srScore = 0
  if (indicators.supportResistance && indicators.price) {
    const price = indicators.price
    const support = indicators.supportResistance.support
    const resistance = indicators.supportResistance.resistance
    
    // Proximity to Support: 3 points
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (support && Math.abs(price - support) / support < 0.01) {
        srScore += 3 // Very close to support
      } else if (support && Math.abs(price - support) / support < 0.02) {
        srScore += 2 // Close to support
      } else if (support && Math.abs(price - support) / support < 0.05) {
        srScore += 1 // Near support
      }
    }
    
    // Clear Resistance Above: 2 points
    if (resistance && price < resistance) {
      const distanceToResistance = (resistance - price) / price
      if (distanceToResistance < 0.05) {
        srScore += 2 // Close resistance
      } else if (distanceToResistance < 0.10) {
        srScore += 1 // Moderate distance
      }
    }
  }
  
  score += srScore
  breakdown.push(`Support/Resistance: ${srScore}/5`)
  
  // 6. Divergence & Momentum (0-10 points)
  maxScore += 10
  let divergenceScore = 0
  
  // MACD Histogram Trend: 5 points (actively assess momentum)
  if (indicators.macd && indicators.macd.histogram !== null && indicators.macd.histogram !== undefined) {
    const macdHist = indicators.macd.histogram
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (macdHist > 0) {
        divergenceScore += 5 // Bullish momentum (good for long)
      } else {
        divergenceScore += 0 // Bearish momentum (bad for long)
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (macdHist < 0) {
        divergenceScore += 5 // Bearish momentum (good for short)
      } else if (macdHist > 0) {
        divergenceScore += 1 // Bullish momentum (bad for short)
      } else {
        divergenceScore += 0 // Neutral
      }
    }
  }
  
  // RSI vs Price (Hidden Divergence): 5 points
  if (indicators.rsi14 !== null && indicators.rsi14 !== undefined && indicators.price) {
    // Simple check: RSI divergence would require price history, so we use RSI level as proxy
    if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
      if (indicators.rsi14 < 30) {
        divergenceScore += 5 // Oversold (bullish divergence potential)
      } else if (indicators.rsi14 < 40) {
        divergenceScore += 3 // Approaching oversold
      } else if (indicators.rsi14 > 70) {
        divergenceScore += 0 // Overbought
      } else {
        divergenceScore += 2 // Neutral
      }
    } else if (signal.signal === 'sell_to_enter') {
      if (indicators.rsi14 > 70) {
        divergenceScore += 5 // Overbought (bearish divergence potential)
      } else if (indicators.rsi14 > 60) {
        divergenceScore += 3 // Approaching overbought
      } else if (indicators.rsi14 < 30) {
        divergenceScore += 0 // Oversold
      } else {
        divergenceScore += 2 // Neutral
      }
    }
  }
  
  score += divergenceScore
  breakdown.push(`Divergence & Momentum: ${divergenceScore}/10`)
  
  // 7. External Confirmation (0-30 points) - increased from 20 to include new futures indicators (COB, SVP, CRVP, COC, CVD)
  maxScore += 30
  let externalScore = 0
  if (externalData) {
    const price = indicators?.price || 0
    const isBuySignal = signal.signal === 'buy_to_enter' || signal.signal === 'add'
    const isSellSignal = signal.signal === 'sell_to_enter'
    
    // Funding Rate: 3 points
    if (externalData.hyperliquid && externalData.hyperliquid.fundingRate !== undefined) {
      const fundingRate = externalData.hyperliquid.fundingRate
      if (isBuySignal) {
        if (fundingRate < 0) {
          externalScore += 3 // Negative funding (bullish)
        } else if (Math.abs(fundingRate) < 0.0001) {
          externalScore += 2 // Neutral
        } else {
          externalScore += 1 // Positive funding
        }
      } else if (isSellSignal) {
        if (fundingRate > 0) {
          externalScore += 3 // Positive funding (bearish)
        } else if (Math.abs(fundingRate) < 0.0001) {
          externalScore += 2 // Neutral
        } else {
          externalScore += 1 // Negative funding
        }
      }
    }
    
    // Open Interest Trend: 3 points
    if (externalData.hyperliquid && externalData.hyperliquid.oiTrend) {
      const oiTrend = externalData.hyperliquid.oiTrend
      if (oiTrend === 'increasing') {
        externalScore += 3
      } else if (oiTrend === 'stable') {
        externalScore += 1
      } else {
        externalScore += 0
      }
    }
    
    // NEW: COB (Order Book Depth) - 4 points
    if (externalData.orderBook && price > 0) {
      const ob = externalData.orderBook
      // Bid/ask imbalance: bullish if positive (more bids), bearish if negative (more asks)
      if (isBuySignal && ob.imbalance > 0.1) {
        externalScore += 2 // Bullish: more bids than asks
      } else if (isSellSignal && ob.imbalance < -0.1) {
        externalScore += 2 // Bearish: more asks than bids
      } else if (Math.abs(ob.imbalance) < 0.05) {
        externalScore += 1 // Neutral
      }
      // Support/resistance zones
      if (ob.supportZones && ob.supportZones.length > 0 && isBuySignal) {
        const support = ob.supportZones[0]
        if (support.distance < price * 0.02) { // Within 2% of price
          externalScore += 2 // Strong support nearby
        }
      }
      if (ob.resistanceZones && ob.resistanceZones.length > 0 && isSellSignal) {
        const resistance = ob.resistanceZones[0]
        if (resistance.distance < price * 0.02) { // Within 2% of price
          externalScore += 2 // Strong resistance nearby
        }
      }
    }
    
    // NEW: SVP (Session Volume Profile) - 3 points
    if (externalData.volumeProfile && externalData.volumeProfile.session && price > 0) {
      const svp = externalData.volumeProfile.session
      const priceToPoc = Math.abs((price - svp.poc) / svp.poc) * 100
      const priceToVah = Math.abs((price - svp.vah) / svp.vah) * 100
      const priceToVal = Math.abs((price - svp.val) / svp.val) * 100
      // Price at POC, VAH, or VAL = strong support/resistance
      if (priceToPoc < 1) {
        externalScore += 3 // Price at POC (strongest level)
      } else if (priceToVah < 1 || priceToVal < 1) {
        externalScore += 2 // Price at VAH or VAL
      } else if (price >= svp.val && price <= svp.vah) {
        externalScore += 1 // Price within value area
      }
      // HVN support/resistance
      if (svp.hvn && svp.hvn.length > 0) {
        const nearestHVN = svp.hvn[0]
        const distanceToHVN = Math.abs((price - nearestHVN.price) / price) * 100
        if (distanceToHVN < 2) {
          externalScore += 1 // Price near HVN (support/resistance)
        }
      }
    }
    
    // NEW: CRVP (Composite Volume Profile) - 2 points
    if (externalData.volumeProfile && externalData.volumeProfile.composite && price > 0) {
      const crvp = externalData.volumeProfile.composite
      // Accumulation zone (bullish)
      if (crvp.accumulationZone && isBuySignal) {
        const accZone = crvp.accumulationZone
        if (price >= accZone.priceRange[0] && price <= accZone.priceRange[1]) {
          externalScore += 2 // Price in accumulation zone
        }
      }
      // Distribution zone (bearish)
      if (crvp.distributionZone && isSellSignal) {
        const distZone = crvp.distributionZone
        if (price >= distZone.priceRange[0] && price <= distZone.priceRange[1]) {
          externalScore += 2 // Price in distribution zone
        }
      }
    }
    
    // NEW: COC (Change of Character) - 4 points
    if (externalData.marketStructure && externalData.marketStructure.coc) {
      const coc = externalData.marketStructure.coc
      // Bullish COC for buy signals
      if (coc.coc === 'bullish' && coc.reversalSignal && isBuySignal) {
        externalScore += 4 // Strong bullish reversal signal
      } else if (coc.coc === 'bullish' && isBuySignal) {
        externalScore += 2 // Forming bullish COC
      }
      // Bearish COC for sell signals
      if (coc.coc === 'bearish' && coc.reversalSignal && isSellSignal) {
        externalScore += 4 // Strong bearish reversal signal
      } else if (coc.coc === 'bearish' && isSellSignal) {
        externalScore += 2 // Forming bearish COC
      }
      // Structure alignment
      if (coc.structure === 'bullish' && isBuySignal && coc.structureStrength > 50) {
        externalScore += 1 // Strong bullish structure
      } else if (coc.structure === 'bearish' && isSellSignal && coc.structureStrength > 50) {
        externalScore += 1 // Strong bearish structure
      }
    }
    
    // NEW: CVD (Cumulative Volume Delta) - 4 points
    if (externalData.volumeDelta) {
      const cvd = externalData.volumeDelta
      // CVD trend
      if (cvd.cvdTrend === 'rising' && isBuySignal) {
        externalScore += 2 // Bullish: buyers more aggressive
      } else if (cvd.cvdTrend === 'falling' && isSellSignal) {
        externalScore += 2 // Bearish: sellers more aggressive
      }
      // CVD delta
      if (cvd.cvdDelta > 0 && isBuySignal) {
        externalScore += 1 // Bullish: buyers dominant
      } else if (cvd.cvdDelta < 0 && isSellSignal) {
        externalScore += 1 // Bearish: sellers dominant
      }
      // Divergence detection (very important)
      if (cvd.divergence === 'bullish' && isBuySignal) {
        externalScore += 2 // Bullish divergence: hidden buying pressure
      } else if (cvd.divergence === 'bearish' && isSellSignal) {
        externalScore += 2 // Bearish divergence: hidden selling pressure
      } else if (cvd.divergence !== 'none') {
        externalScore -= 1 // Divergence against signal = warning
      }
      // CVD strength
      if (cvd.strength > 70) {
        externalScore += 1 // Strong CVD signal
      }
    }
    
    // Exchange Netflow + Price Action: 7 points (only if confirmed by price)
    if (externalData.blockchain && externalData.blockchain.estimatedExchangeFlow !== undefined && indicators.priceChange24h !== undefined) {
      const flow = externalData.blockchain.estimatedExchangeFlow
      const priceChange = indicators.priceChange24h
      
      if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
        // Inflow but price up = bullish risk (contradiction)
        if (flow > 0 && priceChange > 0) {
          externalScore += 2 // Contradiction: inflow but price up
        } else if (flow < 0 && priceChange > 0) {
          externalScore += 7 // Outflow + price up = strong bullish
        } else if (flow < 0) {
          externalScore += 4 // Outflow (bullish)
        } else {
          externalScore += 1 // Inflow (bearish)
        }
      } else if (signal.signal === 'sell_to_enter') {
        // Outflow but price down = bearish risk (contradiction)
        if (flow < 0 && priceChange < 0) {
          externalScore += 2 // Contradiction: outflow but price down
        } else if (flow > 0 && priceChange < 0) {
          externalScore += 7 // Inflow + price down = strong bearish
        } else if (flow > 0) {
          externalScore += 4 // Inflow (bearish)
        } else {
          externalScore += 1 // Outflow (bullish)
        }
      }
    }
    
    // Volume Confirmation: 3 points
    if (externalData.enhanced && externalData.enhanced.volumeTrend) {
      const volTrend = externalData.enhanced.volumeTrend
      if (volTrend === 'increasing') {
        externalScore += 3
      } else if (volTrend === 'stable') {
        externalScore += 1
      } else {
        externalScore += 0
      }
    }
    
    // Whale/Smart Money Signal: 4 points
    if (externalData.blockchain && externalData.blockchain.whaleActivityScore !== undefined) {
      const whaleScore = externalData.blockchain.whaleActivityScore
      if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
        if (whaleScore > 0.5) {
          externalScore += 4 // Strong bullish whale activity
        } else if (whaleScore > 0) {
          externalScore += 2
        } else {
          externalScore += 0
        }
      } else if (signal.signal === 'sell_to_enter') {
        if (whaleScore < -0.5) {
          externalScore += 4 // Strong bearish whale activity
        } else if (whaleScore < 0) {
          externalScore += 2
        } else {
          externalScore += 0
        }
      }
    }
  }
  
  score += externalScore
  breakdown.push(`External Confirmation: ${externalScore}/30`)
  
  // GATEKEEPER: Auto-reject if Trend Alignment < threshold
  // FUTURES TRADING: Much more relaxed threshold (5 for futures vs 20 for spot)
  // For futures, leverage allows for lower trend alignment scores
  // Only reject if trend alignment < 5 (extremely low for futures) or < 20 (spot)
  const FUTURES_TREND_ALIGNMENT_REJECT_THRESHOLD = 5  // Reject only if trend alignment < 5 for futures
  const SPOT_TREND_ALIGNMENT_REJECT_THRESHOLD = 20  // Reject if trend alignment < 20 for spot
  const trendAlignmentThreshold = TRADING_CONFIG.mode === 'AUTONOMOUS' 
    ? FUTURES_TREND_ALIGNMENT_REJECT_THRESHOLD  // Use futures threshold for AUTONOMOUS mode
    : SPOT_TREND_ALIGNMENT_REJECT_THRESHOLD  // Use spot threshold for other modes
  
  if (trendScore < trendAlignmentThreshold) {
    // Update breakdown to show auto-reject
    const trendBreakdownIndex = breakdown.findIndex(b => b.startsWith('Trend Alignment:'))
    if (trendBreakdownIndex >= 0) {
      breakdown[trendBreakdownIndex] = `Trend Alignment: ${trendScore}/25 (AUTO-REJECT: <${trendAlignmentThreshold} ${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'spot'} threshold)`
    }
    
    return {
      confidence: 0,
      breakdown: breakdown,
      totalScore: score,
      maxScore: maxScore,
      autoRejected: true,
      rejectionReason: `Trend Alignment score ${trendScore}/25 is below minimum threshold of ${trendAlignmentThreshold} (${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'spot'})`
    }
  }
  
  // Calculate final confidence (0-1 scale)
  const confidence = maxScore > 0 ? score / maxScore : 0.5 // Default to 50% if no data
  
  return {
    confidence: Math.min(Math.max(confidence, 0), 1), // Clamp between 0 and 1
    breakdown: breakdown,
    totalScore: score,
    maxScore: maxScore
  }
}

// Calculate Expected Value (EV) for a signal
function calculateExpectedValue(confidence, riskRewardRatio, riskAmount) {
  // EV = (probability_win × reward) - (probability_lose × risk)
  // reward = R:R × risk
  // probability_win = confidence
  // probability_lose = 1 - confidence
  const reward = riskRewardRatio * riskAmount
  const probabilityWin = confidence
  const probabilityLose = 1 - confidence
  const expectedValue = (probabilityWin * reward) - (probabilityLose * riskAmount)
  return expectedValue
}

// ═══════════════════════════════════════════════════════════════
// AUTONOMOUS FUTURES TRADING LOGIC
// Full auto-execution untuk BTC & ETH futures (long/short)
// ═══════════════════════════════════════════════════════════════

/**
 * Determine if signal should be auto-executed (Autonomous Futures Trading Logic)
 * @param {Object} signal - Trading signal object
 * @param {Object} indicators - Technical indicators
 * @param {Object} accountState - Current account state (optional)
 * @returns {Object} - Execution decision with details
 */
function shouldAutoExecute(signal, indicators, accountState = null) {
  const { 
    confidence, 
    expected_value: expectedValue, 
    signal: signalType,
    coin: asset 
  } = signal
  
  // Get thresholds from config
  const highConfidence = TRADING_CONFIG.thresholds.confidence.high
  const mediumConfidence = TRADING_CONFIG.thresholds.confidence.medium
  const lowConfidence = TRADING_CONFIG.thresholds.confidence.low
  
  const highEV = TRADING_CONFIG.thresholds.expectedValue.high
  const mediumEV = TRADING_CONFIG.thresholds.expectedValue.medium
  const lowEV = TRADING_CONFIG.thresholds.expectedValue.low
  
  // FUTURES TRADING: Use more relaxed thresholds for futures
  // For futures, EV can be more negative because leverage amplifies both profit and loss
  // Only reject if EV < -$2.00 (extremely negative for futures)
  const FUTURES_EV_REJECT_THRESHOLD = -2.00  // Reject only if EV < -$2.00 for futures
  const FUTURES_CONFIDENCE_REJECT_THRESHOLD = 0.05  // Reject only if confidence < 5% for futures
  
  // Use futures thresholds for AUTONOMOUS mode, standard thresholds for other modes
  const rejectConfidence = TRADING_CONFIG.mode === 'AUTONOMOUS'
    ? FUTURES_CONFIDENCE_REJECT_THRESHOLD  // Use futures threshold for AUTONOMOUS mode
    : TRADING_CONFIG.thresholds.confidence.reject  // Use standard threshold for other modes
  
  const rejectEV = TRADING_CONFIG.mode === 'AUTONOMOUS'
    ? FUTURES_EV_REJECT_THRESHOLD  // Use futures threshold for AUTONOMOUS mode
    : TRADING_CONFIG.thresholds.expectedValue.reject  // Use standard threshold for other modes
  
  // ════════════════════════════════════════════════════════
  // STEP 1: HARD REJECTION FILTERS
  // ════════════════════════════════════════════════════════
  
  // Reject if below minimum thresholds (using futures thresholds for AUTONOMOUS mode)
  if (confidence < rejectConfidence) {
    return {
      execute: false,
      reason: `Confidence too low: ${(confidence * 100).toFixed(2)}% < ${(rejectConfidence * 100).toFixed(2)}% (${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'standard'} threshold)`,
      level: 'REJECTED'
    }
  }
  
  // FUTURES TRADING: Only reject if EV is extremely negative (< -$2.00 for futures)
  if (expectedValue !== undefined && expectedValue !== null && expectedValue < rejectEV) {
    return {
      execute: false,
      reason: `Expected value too negative: $${expectedValue.toFixed(2)} < $${rejectEV.toFixed(2)} (${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'standard'} threshold)`,
      level: 'REJECTED'
    }
  }
  
  // Check if this is a counter-trend signal
  const isCounterTrend = signal.counter_trend || signal.isCounterTrend || false
  const counterTrendPositionReduction = signal.counter_trend_position_reduction || 0.4 // Default 40% (middle of 30-50% range)
  
  // ════════════════════════════════════════════════════════
  // STEP 2: HIGH CONFIDENCE (50%+, EV 0.5+)
  // ════════════════════════════════════════════════════════
  
  if (confidence >= highConfidence && expectedValue >= highEV) {
    // Apply counter-trend position reduction if applicable
    const basePositionMultiplier = TRADING_CONFIG.positionSizing.highConfidence
    const finalPositionMultiplier = isCounterTrend 
      ? basePositionMultiplier * counterTrendPositionReduction 
      : basePositionMultiplier
    
    return {
      execute: true,
      level: 'HIGH_CONFIDENCE',
      positionMultiplier: finalPositionMultiplier,
      warnings: isCounterTrend ? [
        'COUNTER-TREND PLAY - Position size reduced to 30-50%',
        'Use tighter stop loss',
        'Monitor closely for trend reversal'
      ] : [],
      autoTradeReason: `High quality signal (Conf: ${(confidence * 100).toFixed(2)}%, EV: $${expectedValue.toFixed(2)})${isCounterTrend ? ' - Counter-trend' : ''}`
    }
  }
  
  // ════════════════════════════════════════════════════════
  // STEP 3: MEDIUM CONFIDENCE (40-50%, EV 0.2+)
  // ════════════════════════════════════════════════════════
  
  if (confidence >= mediumConfidence && expectedValue >= mediumEV) {
    // Apply counter-trend position reduction if applicable
    const basePositionMultiplier = TRADING_CONFIG.positionSizing.mediumConfidence
    const finalPositionMultiplier = isCounterTrend 
      ? basePositionMultiplier * counterTrendPositionReduction 
      : basePositionMultiplier
    
    return {
      execute: true,
      level: 'MEDIUM_CONFIDENCE',
      positionMultiplier: finalPositionMultiplier,
      warnings: [
        'Medium confidence - position size reduced to 70%',
        ...(isCounterTrend ? [
          'COUNTER-TREND PLAY - Additional position size reduction to 30-50%',
          'Use tighter stop loss',
          'Monitor closely for trend reversal'
        ] : []),
        'Monitor closely for first 2 hours',
        'Consider partial exit at resistance/support'
      ],
      autoTradeReason: `Acceptable signal (Conf: ${(confidence * 100).toFixed(2)}%, EV: $${expectedValue.toFixed(2)})${isCounterTrend ? ' - Counter-trend' : ''}`
    }
  }
  
  // ════════════════════════════════════════════════════════
  // STEP 4: LOW CONFIDENCE - Only with strong confirmations
  // FUTURES TRADING: Much more relaxed threshold (10%+ for futures vs 35%+ for spot)
  // ════════════════════════════════════════════════════════
  
  // Check if this is a contrarian play (oversold bounce with low confidence)
  const isContrarianPlay = signal.contrarian_play || signal.oversold_contrarian
  
  // FUTURES TRADING: Use much lower confidence threshold for futures
  // For futures, leverage allows for lower confidence (10%+ for standard, 8%+ for contrarian)
  // For spot trading, use standard threshold (35%+)
  const futuresLowConfidence = TRADING_CONFIG.mode === 'AUTONOMOUS' ? 0.10 : lowConfidence  // 10% for futures, 35% for spot
  const futuresLowEV = TRADING_CONFIG.mode === 'AUTONOMOUS' ? -1.50 : lowEV  // -$1.50 for futures, $0.30 for spot
  
  // FUTURES TRADING: Allow signals with confidence >= 10% (futures) or >= 35% (spot)
  // For futures, leverage allows for lower confidence thresholds even without strong confirmations
  // For spot trading, require strong reversal confirmations for contrarian plays (3-4 minimum)
  if (confidence >= futuresLowConfidence && confidence < mediumConfidence && expectedValue >= futuresLowEV) {
    // FUTURES TRADING: For futures, allow signals even without indicators (use price action)
    // For spot trading, require indicators
    if (!indicators) {
      if (TRADING_CONFIG.mode === 'AUTONOMOUS') {
        // FUTURES MODE: Allow low confidence signals even without indicators
        // Leverage allows for lower confidence thresholds
        return {
          execute: true,
          level: 'LOW_CONFIDENCE_FUTURES_NO_INDICATORS',
          positionMultiplier: TRADING_CONFIG.positionSizing.lowConfidence * 0.3,  // 30% of low confidence position size (no indicators)
          warnings: [
            'LOW CONFIDENCE - Futures trading (no indicators)',
            `Confidence: ${(confidence * 100).toFixed(2)}% (futures threshold: 10%+)`,
            'No technical indicators available - using price action only',
            'Position size reduced to 30% (no indicators)',
            'Monitor closely - exit quickly if invalidated',
            'Leverage amplifies risk - use extreme caution'
          ],
          autoTradeReason: `Low confidence futures signal without indicators (Conf: ${(confidence * 100).toFixed(2)}%, EV: $${expectedValue.toFixed(2)})`
        }
      } else {
        // SPOT TRADING: Reject low confidence signals without indicators
        return {
          execute: false,
          reason: `Low confidence (${(confidence * 100).toFixed(2)}%) without indicators`,
          level: 'LOW_CONFIDENCE_REJECTED'
        }
      }
    }
    
    const price = indicators.price || signal.entry_price || 0
    const bbLower = indicators.bollingerBands?.lower || 0
    const bbUpper = indicators.bollingerBands?.upper || 0
    const bbMiddle = indicators.bollingerBands?.middle || 0
    const rsi = indicators.rsi14 || 50
    
    // Calculate BB position
    let bbPosition = 'within'
    if (price > 0 && bbUpper > 0 && bbLower > 0) {
      if (price > bbUpper) {
        bbPosition = 'ABOVE_UPPER'
      } else if (price < bbLower) {
        bbPosition = 'BELOW_LOWER'
      } else if (price > bbMiddle) {
        bbPosition = 'above_middle'
      } else {
        bbPosition = 'below_middle'
      }
    }
    
    const isOversoldExtreme = bbPosition === 'BELOW_LOWER' && rsi < 30
    const isOverboughtExtreme = bbPosition === 'ABOVE_UPPER' && rsi > 70
    
    const hasBullishDivergence = indicators.rsiDivergence?.divergence?.toLowerCase().includes('bullish') || 
                                  indicators.macdDivergence?.divergence?.toLowerCase().includes('bullish')
    const hasBearishDivergence = indicators.rsiDivergence?.divergence?.toLowerCase().includes('bearish') || 
                                 indicators.macdDivergence?.divergence?.toLowerCase().includes('bearish')
    
    // Count reversal confirmations for contrarian plays
    let reversalConfirmations = 0
    if (isContrarianPlay) {
      if (hasBullishDivergence || hasBearishDivergence) reversalConfirmations++
      if (isOversoldExtreme || isOverboughtExtreme) reversalConfirmations++
      if (indicators.macd && Math.abs(indicators.macd.histogram) > 20) reversalConfirmations++
      if (indicators.obv && Math.abs(indicators.obv) > 1000000) reversalConfirmations++
      if (indicators.volumeChange && Math.abs(indicators.volumeChange) > 0.3) reversalConfirmations++
    }
    
    // FUTURES TRADING: More relaxed confirmation requirements for futures
    // For futures, leverage allows for lower confirmation requirements
    // For spot trading, require minimum 3-4 confirmations for contrarian plays
    const minConfirmations = TRADING_CONFIG.mode === 'AUTONOMOUS' 
      ? (isContrarianPlay ? 2 : 1)  // Lower requirements for futures: 2 for contrarian, 1 for standard
      : (isContrarianPlay ? 3 : 2)  // Standard requirements for spot: 3 for contrarian, 2 for standard
    
    // FUTURES TRADING: For futures, allow signals even without extreme conditions if confidence >= 10%
    // For spot trading, require extreme conditions
    const hasExtremeConditions = isOversoldExtreme || isOverboughtExtreme || hasBullishDivergence || hasBearishDivergence
    const hasEnoughConfirmations = !isContrarianPlay || reversalConfirmations >= minConfirmations
    
    // Execute if:
    // 1. Futures mode: confidence >= 10% (already checked above) AND (has extreme conditions OR has enough confirmations OR confidence >= 20%)
    // 2. Spot mode: has extreme conditions AND (not contrarian OR has enough confirmations)
    const shouldExecute = TRADING_CONFIG.mode === 'AUTONOMOUS'
      ? (hasExtremeConditions || hasEnoughConfirmations || confidence >= 0.20)  // Futures: allow if has extreme conditions OR enough confirmations OR confidence >= 20%
      : (hasExtremeConditions && hasEnoughConfirmations)  // Spot: require both extreme conditions AND enough confirmations
    
    if (shouldExecute) {
      let extremeCondition = ''
      if (isContrarianPlay) {
        extremeCondition = `Contrarian play (oversold bounce) with ${reversalConfirmations} confirmations`
      } else if (isOversoldExtreme) {
        extremeCondition = 'Oversold extreme (BB Lower breach + RSI < 30)'
      } else if (isOverboughtExtreme) {
        extremeCondition = 'Overbought extreme (BB Upper breach + RSI > 70)'
      } else if (hasBullishDivergence) {
        extremeCondition = 'Bullish RSI/MACD divergence detected'
      } else if (hasBearishDivergence) {
        extremeCondition = 'Bearish RSI/MACD divergence detected'
      }
      
      const level = isContrarianPlay ? 'LOW_CONFIDENCE_CONTRARIAN' : 'LOW_CONFIDENCE_EXTREME'
      const warnings = isContrarianPlay ? [
        'HIGH RISK - Contrarian play (oversold bounce)',
        `${extremeCondition}`,
        'Position size reduced to 30% (contrarian play)',
        'Very tight stop loss - exit quickly if invalidated',
        'This is a high-risk contrarian/reversal play',
        'Low confidence - use caution'
      ] : [
        'HIGH RISK - Low confidence signal',
        `${extremeCondition}`,
        'Position size reduced to 50%',
        'Tight stop loss - exit quickly if invalidated',
        'This is a contrarian/reversal play'
      ]
      
      // Apply counter-trend position reduction if applicable
      const basePositionMultiplier = isContrarianPlay ? 0.3 : TRADING_CONFIG.positionSizing.lowConfidence
      const finalPositionMultiplier = isCounterTrend 
        ? basePositionMultiplier * counterTrendPositionReduction 
        : basePositionMultiplier
      
      // Update warnings if counter-trend
      if (isCounterTrend && !isContrarianPlay) {
        warnings.push(`COUNTER-TREND PLAY - Additional position size reduction to ${(finalPositionMultiplier * 100).toFixed(0)}%`)
        warnings.push('Use tighter stop loss')
        warnings.push('Monitor closely for trend reversal')
      }
      
      return {
        execute: true,
        level: level,
        positionMultiplier: finalPositionMultiplier,
        warnings: warnings,
        autoTradeReason: isContrarianPlay 
          ? `Contrarian play (Conf: ${(confidence * 100).toFixed(2)}%, EV: $${expectedValue.toFixed(2)}, ${reversalConfirmations} confirmations)${isCounterTrend ? ' - Counter-trend' : ''}`
          : `Extreme condition play (Conf: ${(confidence * 100).toFixed(2)}%, EV: $${expectedValue.toFixed(2)})${isCounterTrend ? ' - Counter-trend' : ''}`
      }
    }
    
    // FUTURES TRADING: For futures, allow low confidence signals even without extreme conditions
    // For futures, leverage allows for lower confidence thresholds
    // Only reject if confidence < 10% for futures (already checked in STEP 1, but fallback here)
    // For spot trading, reject if no extreme conditions
    if (TRADING_CONFIG.mode === 'AUTONOMOUS') {
      // FUTURES MODE: Allow low confidence signals (>= 10%) even without extreme conditions
      // Leverage allows for lower confidence thresholds
      const basePositionMultiplier = TRADING_CONFIG.positionSizing.lowConfidence * 0.5  // 50% of low confidence position size
      const finalPositionMultiplier = isCounterTrend 
        ? basePositionMultiplier * counterTrendPositionReduction 
        : basePositionMultiplier
      
      const warnings = [
        'LOW CONFIDENCE - Futures trading',
        `Confidence: ${(confidence * 100).toFixed(2)}% (futures threshold: 10%+)`,
        'Position size reduced to 50% (low confidence)',
        ...(isCounterTrend ? [
          'COUNTER-TREND PLAY - Additional position size reduction to 30-50%',
          'Use tighter stop loss',
          'Monitor closely for trend reversal'
        ] : []),
        'Monitor closely - exit quickly if invalidated',
        'Leverage amplifies risk - use caution'
      ]
      
      return {
        execute: true,
        level: 'LOW_CONFIDENCE_FUTURES',
        positionMultiplier: finalPositionMultiplier,
        warnings: warnings,
        autoTradeReason: `Low confidence futures signal (Conf: ${(confidence * 100).toFixed(2)}%, EV: $${expectedValue.toFixed(2)})${isCounterTrend ? ' - Counter-trend' : ''}`
      }
    } else {
      // SPOT TRADING: Reject low confidence signals without extreme conditions
      return {
        execute: false,
        reason: isContrarianPlay 
          ? `Contrarian play rejected: Low confidence (${(confidence * 100).toFixed(2)}%) with insufficient confirmations (${reversalConfirmations}/${minConfirmations})`
          : `Low confidence (${(confidence * 100).toFixed(2)}%) without extreme conditions (oversold/overbought/divergence)`,
        level: 'LOW_CONFIDENCE_REJECTED'
      }
    }
  }
  
  // ════════════════════════════════════════════════════════
  // STEP 5: REJECT - Confidence below minimum threshold
  // FUTURES TRADING: Use much lower threshold (5% for futures vs 35% for spot)
  // ════════════════════════════════════════════════════════
  
  // FUTURES TRADING: Only reject if confidence < 5% (futures) or < 35% (spot)
  // For futures, leverage allows for much lower confidence thresholds
  // This check should rarely be reached because rejectConfidence (5% for futures) should catch it earlier
  // But if it does, use the appropriate threshold
  const minConfidenceForReject = TRADING_CONFIG.mode === 'AUTONOMOUS' 
    ? rejectConfidence  // 5% for futures (already checked in STEP 1, but fallback here)
    : lowConfidence  // 35% for spot
  
  return {
    execute: false,
    reason: `Signal quality insufficient: Confidence ${(confidence * 100).toFixed(2)}% < ${(minConfidenceForReject * 100).toFixed(2)}% (${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'spot'} minimum threshold). EV: $${expectedValue?.toFixed(2) || 'N/A'}`,
    level: 'MARGINAL_REJECTED'
  }
}

/**
 * Check risk management limits before execution
 * @param {Object} signal - Formatted signal
 * @param {Object} accountState - Current account state
 * @param {Object} activePositions - Active positions Map
 * @param {Object} correlationMatrix - Correlation matrix between assets
 * @returns {Object} - Risk check result
 */
function checkRiskLimits(signal, accountState, activePositions, correlationMatrix) {
  const limits = TRADING_CONFIG.safety
  const checks = {
    passed: true,
    violations: []
  }
  
  // Check 1: Account balance minimum
  if (accountState && accountState.accountValue) {
    if (accountState.accountValue < limits.minAccountBalance) {
      checks.passed = false
      checks.violations.push(
        `Account balance too low: $${accountState.accountValue.toFixed(2)} < $${limits.minAccountBalance}`
      )
    }
  }
  
  // Check 2: Risk per trade
  const riskAmount = signal.risk_usd || signal.adjustedRisk || 0
  if (riskAmount > limits.maxRiskPerTrade) {
    checks.passed = false
    checks.violations.push(
      `Risk too high: $${riskAmount.toFixed(2)} > $${limits.maxRiskPerTrade}`
    )
  }
  
  // Check 3: Max open positions
  const openPositionsCount = activePositions ? (activePositions instanceof Map ? activePositions.size : Object.keys(activePositions).length) : 0
  if (openPositionsCount >= limits.maxOpenPositions) {
    checks.passed = false
    checks.violations.push(
      `Max positions reached: ${openPositionsCount}/${limits.maxOpenPositions}`
    )
  }
  
  // Check 4: Daily loss limit
  if (accountState && accountState.totalReturnPercent !== undefined) {
    if (accountState.totalReturnPercent <= -limits.dailyLossLimit) {
      checks.passed = false
      checks.violations.push(
        `Daily loss limit hit: ${accountState.totalReturnPercent.toFixed(2)}% <= -${limits.dailyLossLimit}%`
      )
    }
  }
  
  // Check 5: Consecutive losses (if tracked)
  if (accountState && accountState.consecutiveLosses !== undefined) {
    if (accountState.consecutiveLosses >= limits.consecutiveLosses) {
      checks.passed = false
      checks.violations.push(
        `Max consecutive losses: ${accountState.consecutiveLosses}/${limits.consecutiveLosses}`
      )
    }
  }
  
  // Check 6: Correlation check (untuk 2 pairs)
  // Jangan buka long BTC & long ETH secara bersamaan jika korelasi tinggi
  if (activePositions && openPositionsCount > 0 && correlationMatrix) {
    const signalDirection = signal.signal === 'buy_to_enter' || signal.signal === 'add' ? 'long' : 'short'
    const positions = activePositions instanceof Map ? Array.from(activePositions.values()) : Object.values(activePositions)
    
    for (const pos of positions) {
      if (pos.coin !== signal.coin) {
        const posDirection = pos.side === 'LONG' ? 'long' : 'short'
        const pairKey1 = `${signal.coin}-${pos.coin}`
        const pairKey2 = `${pos.coin}-${signal.coin}`
        const correlation = correlationMatrix[pairKey1] || correlationMatrix[pairKey2]
        
        // If assets are highly correlated and signals are in same direction
        if (correlation && Math.abs(correlation) > TRADING_CONFIG.limitedPairsMode.correlationThreshold && 
            signalDirection === posDirection) {
          checks.passed = false
          checks.violations.push(
            `High correlation risk: ${signal.coin} ${signalDirection} with existing ${pos.coin} ${posDirection} position (correlation: ${(correlation * 100).toFixed(1)}%)`
          )
          break
        }
      }
    }
  }
  
  return checks
}

// Signal generation
// Global warnings collection for signal processing
const signalWarnings = []

// Helper function to collect warnings instead of printing immediately
function collectWarning(asset, message, details = null) {
  signalWarnings.push({
    asset,
    message,
    details,
    timestamp: Date.now()
  })
}

// Helper function to generate invalidation condition based on Alpha Arena patterns
// Alpha Arena research shows invalidation_condition improves performance when used properly
function generateInvalidationCondition(signal, indicators, entryPrice, stopLoss, supportResistance, trendAlignment, externalData, marketData) {
  const conditions = []
  const signalType = signal.signal || signal
  
  if (!indicators || !entryPrice || entryPrice <= 0) {
    // Fallback if no indicators available
    if (signalType === 'buy_to_enter' || signalType === 'add') {
      return `Price breaks below $${(stopLoss || entryPrice * 0.98).toFixed(2)} (stop loss level) OR main indicator reverses`
    } else if (signalType === 'sell_to_enter') {
      return `Price breaks above $${(stopLoss || entryPrice * 1.02).toFixed(2)} (stop loss level) OR main indicator reverses`
    }
    return `Price breaks key support/resistance OR main indicator reverses`
  }
  
  const price = indicators.price || entryPrice
  const rsi14 = indicators.rsi14
  const macd = indicators.macd
  const bollingerBands = indicators.bollingerBands
  const supportLevels = supportResistance?.supportLevels || indicators.supportLevels || []
  const resistanceLevels = supportResistance?.resistanceLevels || indicators.resistanceLevels || []
  
  if (signalType === 'buy_to_enter' || signalType === 'add') {
    // For BUY signals: Comprehensive invalidation based on ALL indicators
    
    // 1. RSI conditions - ALL timeframes
    if (rsi14 !== null && rsi14 !== undefined) {
      if (rsi14 > 70) {
        conditions.push(`RSI(14) ${rsi14.toFixed(2)} breaks back below ${Math.max(65, Math.floor(rsi14 - 5))} (momentum failure)`)
      } else if (rsi14 < 50) {
        conditions.push(`RSI(14) breaks back below ${Math.max(30, Math.floor(rsi14 - 10))} (momentum failure)`)
      } else {
        conditions.push(`RSI(14) breaks below 50 (momentum failure)`)
      }
    }
    if (indicators.rsi7 !== null && indicators.rsi7 !== undefined) {
      if (indicators.rsi7 > 70) {
        conditions.push(`RSI(7) ${indicators.rsi7.toFixed(2)} breaks back below 65 (momentum failure)`)
      }
    }
    
    // 2. MACD histogram reversal - align with justification
    if (macd && macd.histogram !== null && macd.histogram !== undefined) {
      if (macd.histogram > 0) {
        conditions.push(`MACD histogram turns negative (from +${macd.histogram.toFixed(4)}, bearish momentum)`)
      } else {
        conditions.push(`MACD histogram fails to recover above 0 (remains ${macd.histogram.toFixed(4)})`)
      }
    }
    
    // 3. OBV reversal - align with justification
    if (indicators.obv !== undefined && indicators.obv > 0) {
      conditions.push(`OBV turns negative (from +${indicators.obv.toFixed(2)}, selling pressure)`)
    }
    
    // 4. Price level conditions - ALL support levels
    if (supportLevels.length > 0) {
      supportLevels.forEach(support => {
        if (support < price && support > 0) {
          conditions.push(`Price breaks below $${support.toFixed(2)} (support level)`)
        }
      })
    }
    if (stopLoss && stopLoss > 0) {
      conditions.push(`Price breaks below $${stopLoss.toFixed(2)} (stop loss level)`)
    }
    
    // 5. Bollinger Bands condition
    if (bollingerBands) {
      if (bollingerBands.lower && price > bollingerBands.lower) {
        conditions.push(`Price breaks below $${bollingerBands.lower.toFixed(2)} (BB lower band)`)
      }
      if (bollingerBands.middle && price > bollingerBands.middle) {
        conditions.push(`Price breaks below $${bollingerBands.middle.toFixed(2)} (BB middle, bearish)`)
      }
    }
    
    // 6. Parabolic SAR reversal - align with justification
    if (indicators.parabolicSAR && price > indicators.parabolicSAR) {
      conditions.push(`Price breaks below Parabolic SAR $${indicators.parabolicSAR.toFixed(2)} (bearish reversal)`)
    }
    
    // 7. VWAP break - align with justification
    if (indicators.vwap && price > indicators.vwap) {
      conditions.push(`Price breaks below VWAP $${indicators.vwap.toFixed(2)} (bearish)`)
    }
    
    // 8. Aroon reversal - align with justification
    if (indicators.aroon) {
      if (indicators.aroon.up > indicators.aroon.down) {
        conditions.push(`Aroon Down exceeds Up (from Up ${indicators.aroon.up.toFixed(2)} > Down ${indicators.aroon.down.toFixed(2)}, bearish trend)`)
      }
    }
    
    // 9. Multi-timeframe trend failure - align with justification
    if (trendAlignment) {
      if (trendAlignment.dailyTrend === 'uptrend') {
        conditions.push(`4H RSI breaks back below 40 (momentum failure)`)
      } else if (trendAlignment.dailyTrend === 'downtrend') {
        conditions.push(`Daily trend confirms downtrend (counter-trend reversal)`)
      }
      if (trendAlignment.trendAlignment && trendAlignment.trendAlignment < 20) {
        conditions.push(`Trend alignment drops below 20% (momentum failure)`)
      }
    }
    
            // 10. Volume conditions - align with justification and current volume trend
            if (indicators.volumeChangePercent !== undefined) {
              const volChange = indicators.volumeChangePercent
              if (volChange < 0) {
                // Volume is decreasing (currently -50% for example)
                const currentVolDrop = Math.abs(volChange)
                if (currentVolDrop < 50) {
                  // Volume drop is not severe yet - check if it drops further
                  conditions.push(`Volume drops further below 50% of average (currently ${volChange.toFixed(2)}%, bearish)`)
                } else {
                  // Volume is already dropping significantly - check if it continues or reverses
                  conditions.push(`Volume continues dropping (currently ${volChange.toFixed(2)}%, already below 50%)`)
                }
              } else if (volChange > 0) {
                // Volume is increasing (supporting BUY)
                // Check if it reverses to decreasing (bearish)
                if (volChange > 50) {
                  conditions.push(`Volume trend reverses to decreasing (from +${volChange.toFixed(2)}%, bearish)`)
                } else {
                  conditions.push(`Volume trend reverses to decreasing (from +${volChange.toFixed(2)}%, bearish) OR Volume spike fails to continue (below 50%)`)
                }
              }
            }
            if (indicators.volumeTrend === 'increasing') {
              // Volume trend is increasing - this is bullish (supporting BUY)
              // Check if it reverses to decreasing (bearish)
              conditions.push(`Volume trend reverses to decreasing (from increasing, bearish)`)
            } else if (indicators.volumeTrend === 'decreasing') {
              // Volume trend is decreasing - this is bearish (contradicts BUY)
              // Check if it continues or reverses
              conditions.push(`Volume trend continues decreasing (bearish)`)
            }
    
    // 11. Volume-Price Divergence - align with justification
    if (indicators.volumePriceDivergence !== undefined) {
      if (indicators.volumePriceDivergence > -0.5) {
        conditions.push(`Volume-price divergence becomes bearish (from ${indicators.volumePriceDivergence.toFixed(2)}, price rising but volume decreasing)`)
      }
    }
    
    // 12. Funding Rate reversal - align with justification
    if (externalData?.hyperliquid?.fundingRate !== undefined && externalData.hyperliquid.fundingRate < 0) {
      conditions.push(`Funding rate turns positive (from ${(externalData.hyperliquid.fundingRate * 100).toFixed(4)}%, bearish)`)
    }
    
    // 13. Premium to Oracle reversal - align with justification
    if (externalData?.hyperliquid?.premium !== undefined && externalData.hyperliquid.premium < 0) {
      conditions.push(`Premium to oracle turns positive (from ${(externalData.hyperliquid.premium * 100).toFixed(4)}%, overvalued)`)
    }
    
    // 14. Whale Activity reversal - align with justification
    if (externalData?.blockchain?.whaleActivityScore !== undefined && externalData.blockchain.whaleActivityScore > 0) {
      conditions.push(`Whale activity turns bearish (from +${externalData.blockchain.whaleActivityScore.toFixed(2)}, bearish pressure)`)
    }
    
    // 15. Order Book Imbalance reversal - align with justification
    if (externalData?.orderBook?.imbalance !== undefined && externalData.orderBook.imbalance > 0.1) {
      conditions.push(`Order book imbalance turns bearish (from +${(externalData.orderBook.imbalance * 100).toFixed(2)}%, more asks than bids)`)
    }
    
    // 16. CVD Trend reversal - align with justification
    if (externalData?.volumeDelta?.cvdTrend === 'rising') {
      conditions.push(`CVD trend reverses to falling (from rising, bearish)`)
    }
    
    // 17. Change of Character reversal - align with justification
    if (externalData?.marketStructure?.coc?.coc === 'bullish') {
      conditions.push(`Change of Character reverses to bearish (from bullish, trend reversal)`)
    }
    
    // 18. Exchange Flow reversal - align with justification
    if (externalData?.blockchain?.estimatedExchangeFlow !== undefined && externalData.blockchain.estimatedExchangeFlow < 0) {
      conditions.push(`Exchange flow reverses to inflow (from outflow $${Math.abs(externalData.blockchain.estimatedExchangeFlow / 1000000).toFixed(2)}M, bearish pressure)`)
    }
    
    // 19. ATR volatility increase - align with justification
    if (indicators.atr !== undefined && price > 0) {
      const atrPercent = (indicators.atr / price) * 100
      if (atrPercent < 1.5) {
        conditions.push(`ATR volatility increases above 2% (from ${atrPercent.toFixed(2)}%, whipsaw risk)`)
      }
    }
    
    // 20. Reference related assets
    if (signal.coin !== 'BTC' && marketData) {
      const btcData = marketData instanceof Map ? marketData.get('BTC') : marketData['BTC']
      if (btcData && btcData.price) {
        const btcPrice = btcData.price
        const btcSupport = btcPrice * 0.97 // 3% below current
        conditions.push(`BTC breaks below $${Math.round(btcSupport / 1000) * 1000} (deeper market correction)`)
      }
    }
    
  } else if (signalType === 'sell_to_enter') {
    // For SELL signals: Comprehensive invalidation based on ALL indicators
    
    // 1. RSI conditions - ALL timeframes
    if (rsi14 !== null && rsi14 !== undefined) {
      if (rsi14 < 30) {
        conditions.push(`RSI(14) ${rsi14.toFixed(2)} breaks back above ${Math.min(35, Math.ceil(rsi14 + 5))} (momentum failure)`)
      } else if (rsi14 > 50) {
        conditions.push(`RSI(14) breaks back above ${Math.min(70, Math.ceil(rsi14 + 10))} (momentum failure)`)
      } else {
        conditions.push(`RSI(14) breaks above 50 (momentum failure)`)
      }
    }
    if (indicators.rsi7 !== null && indicators.rsi7 !== undefined) {
      if (indicators.rsi7 < 30) {
        conditions.push(`RSI(7) ${indicators.rsi7.toFixed(2)} breaks back above 35 (momentum failure)`)
      }
    }
    
    // 2. MACD histogram reversal - align with justification
    if (macd && macd.histogram !== null && macd.histogram !== undefined) {
      if (macd.histogram < 0) {
        conditions.push(`MACD histogram turns positive (from ${macd.histogram.toFixed(4)}, bullish momentum)`)
      } else {
        conditions.push(`MACD histogram fails to decline below 0 (remains +${macd.histogram.toFixed(4)})`)
      }
    }
    
    // 3. OBV reversal - align with justification
    if (indicators.obv !== undefined && indicators.obv < 0) {
      conditions.push(`OBV turns positive (from ${indicators.obv.toFixed(2)}, buying pressure)`)
    }
    
    // 4. Price level conditions - ALL resistance levels
    if (resistanceLevels.length > 0) {
      resistanceLevels.forEach(resistance => {
        if (resistance > price && resistance > 0) {
          conditions.push(`Price breaks above $${resistance.toFixed(2)} (resistance level)`)
        }
      })
    }
    if (stopLoss && stopLoss > 0) {
      conditions.push(`Price breaks above $${stopLoss.toFixed(2)} (stop loss level)`)
    }
    
    // 5. Bollinger Bands condition
    if (bollingerBands) {
      if (bollingerBands.upper && price < bollingerBands.upper) {
        conditions.push(`Price breaks above $${bollingerBands.upper.toFixed(2)} (BB upper band)`)
      }
      if (bollingerBands.middle && price < bollingerBands.middle) {
        conditions.push(`Price breaks above $${bollingerBands.middle.toFixed(2)} (BB middle, bullish)`)
      }
    }
    
    // 6. Parabolic SAR reversal - align with justification
    if (indicators.parabolicSAR && price < indicators.parabolicSAR) {
      conditions.push(`Price breaks above Parabolic SAR $${indicators.parabolicSAR.toFixed(2)} (bullish reversal)`)
    }
    
    // 7. VWAP break - align with justification
    if (indicators.vwap && price < indicators.vwap) {
      conditions.push(`Price breaks above VWAP $${indicators.vwap.toFixed(2)} (bullish)`)
    }
    
    // 8. Aroon reversal - align with justification
    if (indicators.aroon) {
      if (indicators.aroon.down > indicators.aroon.up) {
        conditions.push(`Aroon Up exceeds Down (from Down ${indicators.aroon.down.toFixed(2)} > Up ${indicators.aroon.up.toFixed(2)}, bullish trend)`)
      }
    }
    
    // 9. Multi-timeframe trend failure - align with justification
    if (trendAlignment) {
      if (trendAlignment.dailyTrend === 'downtrend') {
        conditions.push(`4H RSI breaks back above 60 (momentum failure)`)
      } else if (trendAlignment.dailyTrend === 'uptrend') {
        conditions.push(`Daily trend confirms uptrend (counter-trend reversal)`)
      }
      if (trendAlignment.trendAlignment && trendAlignment.trendAlignment < 20) {
        conditions.push(`Trend alignment drops below 20% (momentum failure)`)
      }
    }
    
    // 10. Volume conditions - align with justification and current volume trend
    if (indicators.volumeChangePercent !== undefined) {
      const volChange = indicators.volumeChangePercent
      if (volChange > 0) {
        // Volume is increasing (currently +214% for example)
        if (volChange > 150) {
          // Volume spike is very high (>150%) - check for reversal OR continuation with price bounce
          conditions.push(`Volume reverses: drops below 50% of 24h avg (currently +${volChange.toFixed(2)}%, bullish) OR Volume spike continues (>200%) with price bounce above $${(entryPrice * 1.02).toFixed(2)} (accumulation signal)`)
        } else if (volChange > 50) {
          // Volume is increasing but not extreme - check for reversal
          conditions.push(`Volume reverses: drops below 50% of 24h avg (currently +${volChange.toFixed(2)}%, bullish)`)
        } else {
          // Volume is slightly increasing - check if it reverses or spikes further
          conditions.push(`Volume trend reverses to decreasing (from +${volChange.toFixed(2)}%, bearish)`)
        }
      } else if (volChange < 0) {
        // Volume is decreasing (supporting SELL)
        const currentVolDrop = Math.abs(volChange)
        if (currentVolDrop < 50) {
          // Volume drop is not severe yet - check if it drops further
          conditions.push(`Volume drops further below 50% of average (currently ${volChange.toFixed(2)}%)`)
        } else {
          // Volume is already dropping significantly - check if it continues or reverses
          conditions.push(`Volume continues dropping (currently ${volChange.toFixed(2)}%, already below 50%) OR Volume trend reverses to increasing (from ${volChange.toFixed(2)}%, bullish)`)
        }
      }
    }
    if (indicators.volumeTrend === 'decreasing') {
      conditions.push(`Volume trend reverses to increasing (from decreasing, bullish)`)
    } else if (indicators.volumeTrend === 'increasing') {
      // Volume trend is increasing - this is bullish (contradicts SELL)
      // Check if it continues or reverses
      if (indicators.volumeChangePercent !== undefined && indicators.volumeChangePercent > 150) {
        conditions.push(`Volume trend continues increasing with price bounce above $${(entryPrice * 1.02).toFixed(2)} (accumulation signal)`)
      } else {
        conditions.push(`Volume trend reverses to decreasing (from increasing, bearish)`)
      }
    }
    
    // 11. Volume-Price Divergence - align with justification
    if (indicators.volumePriceDivergence !== undefined) {
      if (indicators.volumePriceDivergence < 0.5) {
        conditions.push(`Volume-price divergence becomes bullish (from ${indicators.volumePriceDivergence.toFixed(2)}, price falling but volume increasing)`)
      }
    }
    
    // 12. Funding Rate reversal - align with justification
    if (externalData?.hyperliquid?.fundingRate !== undefined && externalData.hyperliquid.fundingRate > 0) {
      conditions.push(`Funding rate turns negative (from +${(externalData.hyperliquid.fundingRate * 100).toFixed(4)}%, bullish)`)
    }
    
    // 13. Premium to Oracle reversal - align with justification
    if (externalData?.hyperliquid?.premium !== undefined && externalData.hyperliquid.premium > 0) {
      conditions.push(`Premium to oracle turns negative (from +${(externalData.hyperliquid.premium * 100).toFixed(4)}%, undervalued)`)
    }
    
    // 14. Whale Activity reversal - align with justification
    if (externalData?.blockchain?.whaleActivityScore !== undefined && externalData.blockchain.whaleActivityScore < 0) {
      conditions.push(`Whale activity turns bullish (from ${externalData.blockchain.whaleActivityScore.toFixed(2)}, bullish pressure)`)
    }
    
    // 15. Order Book Imbalance reversal - align with justification
    if (externalData?.orderBook?.imbalance !== undefined && externalData.orderBook.imbalance < -0.1) {
      conditions.push(`Order book imbalance turns bullish (from ${(externalData.orderBook.imbalance * 100).toFixed(2)}%, more bids than asks)`)
    }
    
    // 16. CVD Trend reversal - align with justification
    if (externalData?.volumeDelta?.cvdTrend === 'falling') {
      conditions.push(`CVD trend reverses to rising (from falling, bullish)`)
    }
    
    // 17. Change of Character reversal - align with justification
    if (externalData?.marketStructure?.coc?.coc === 'bearish') {
      conditions.push(`Change of Character reverses to bullish (from bearish, trend reversal)`)
    }
    
    // 18. Exchange Flow reversal - align with justification
    if (externalData?.blockchain?.estimatedExchangeFlow !== undefined && externalData.blockchain.estimatedExchangeFlow > 0) {
      conditions.push(`Exchange flow reverses to outflow (from inflow $${(externalData.blockchain.estimatedExchangeFlow / 1000000).toFixed(2)}M, bullish pressure)`)
    }
    
    // 19. ATR volatility increase - align with justification
    if (indicators.atr !== undefined && price > 0) {
      const atrPercent = (indicators.atr / price) * 100
      if (atrPercent < 1.5) {
        conditions.push(`ATR volatility increases above 2% (from ${atrPercent.toFixed(2)}%, whipsaw risk)`)
      }
    }
    
    // 20. Reference related assets
    if (signal.coin !== 'BTC' && marketData) {
      const btcData = marketData instanceof Map ? marketData.get('BTC') : marketData['BTC']
      if (btcData && btcData.price) {
        const btcPrice = btcData.price
        const btcResistance = btcPrice * 1.03 // 3% above current
        conditions.push(`BTC breaks above $${Math.round(btcResistance / 1000) * 1000} (market strength)`)
      }
    }
    
  } else if (signalType === 'hold' || signalType === 'close' || signalType === 'close_all' || signalType === 'reduce') {
    // For HOLD/CLOSE/REDUCE: Use basic conditions
    return `N/A - Position being ${signalType === 'close' || signalType === 'close_all' ? 'closed' : signalType === 'reduce' ? 'reduced' : 'held'}`
  }
  
  // Combine conditions with "OR" - ALL conditions (no limit)
  if (conditions.length === 0) {
    // Fallback if no conditions generated
    if (signalType === 'buy_to_enter' || signalType === 'add') {
      return `Price breaks below $${(stopLoss || entryPrice * 0.98).toFixed(2)} OR RSI breaks below 50 OR MACD histogram turns negative OR Volume drops below 50%`
    } else if (signalType === 'sell_to_enter') {
      return `Price breaks above $${(stopLoss || entryPrice * 1.02).toFixed(2)} OR RSI breaks above 50 OR MACD histogram turns positive OR Volume spikes above 150%`
    }
    return `Price breaks key support/resistance OR main indicator reverses`
  }
  
  // Return ALL conditions (no limit) - comprehensive invalidation
  return conditions.join(' OR ')
}

// Helper function to generate justification from indicators based on signal direction
function generateJustificationFromIndicators(signal, indicators, bullishCount, bearishCount, trendAlignment, externalData) {
  const price = indicators?.price || 0
  const justificationParts = []
  
  if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
    // List BULLISH indicators (supporting BUY signal) - ALL indicators that actually exist
    const bullishIndicators = []
    const bearishIndicators = []
    
    // Count indicators as we add them (comprehensive count from ALL indicators checked)
    let actualBullishCount = 0
    let actualBearishCount = 0
    
    // MACD histogram
    if (indicators?.macd?.histogram !== undefined) {
      if (indicators.macd.histogram > 0) {
        bullishIndicators.push(`MACD histogram +${indicators.macd.histogram.toFixed(4)} (bullish momentum)`)
        actualBullishCount++
      } else {
        bearishIndicators.push(`MACD histogram ${indicators.macd.histogram.toFixed(4)} (bearish - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // OBV
    if (indicators?.obv !== undefined) {
      if (indicators.obv > 0) {
        bullishIndicators.push(`OBV +${indicators.obv.toFixed(2)} (buying pressure)`)
        actualBullishCount++
      } else if (indicators.obv < 0) {
        bearishIndicators.push(`OBV ${indicators.obv.toFixed(2)} (selling pressure - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Bollinger Bands
    if (indicators?.bollingerBands) {
      if (price > indicators.bollingerBands.middle) {
        bullishIndicators.push(`Price above BB middle $${indicators.bollingerBands.middle.toFixed(2)} (bullish)`)
        actualBullishCount++
      } else if (price < indicators.bollingerBands.middle) {
        bearishIndicators.push(`Price below BB middle $${indicators.bollingerBands.middle.toFixed(2)} (bearish - CONTRADICTS BUY)`)
        actualBearishCount++
      }
      if (price > indicators.bollingerBands.upper) {
        bearishIndicators.push(`Price above BB upper $${indicators.bollingerBands.upper.toFixed(2)} (overbought - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Parabolic SAR
    if (indicators?.parabolicSAR) {
      if (price > indicators.parabolicSAR) {
        bullishIndicators.push(`Parabolic SAR $${indicators.parabolicSAR.toFixed(2)} bullish (below price)`)
        actualBullishCount++
      } else {
        bearishIndicators.push(`Parabolic SAR $${indicators.parabolicSAR.toFixed(2)} bearish (above price - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Aroon
    if (indicators?.aroon) {
      if (indicators.aroon.up > indicators.aroon.down) {
        bullishIndicators.push(`Aroon Up ${indicators.aroon.up.toFixed(2)} > Down ${indicators.aroon.down.toFixed(2)} (bullish trend)`)
        actualBullishCount++
      } else if (indicators.aroon.down > indicators.aroon.up) {
        bearishIndicators.push(`Aroon Down ${indicators.aroon.down.toFixed(2)} > Up ${indicators.aroon.up.toFixed(2)} (bearish trend - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // VWAP
    if (indicators?.vwap) {
      if (price > indicators.vwap) {
        bullishIndicators.push(`Price above VWAP $${indicators.vwap.toFixed(2)} (bullish)`)
        actualBullishCount++
      } else {
        bearishIndicators.push(`Price below VWAP $${indicators.vwap.toFixed(2)} (bearish - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // 24h Change
    if (indicators?.priceChange24h !== undefined) {
      if (indicators.priceChange24h > 0) {
        bullishIndicators.push(`24h change +${indicators.priceChange24h.toFixed(2)}% (bullish)`)
        actualBullishCount++
      } else if (indicators.priceChange24h < 0) {
        bearishIndicators.push(`24h change ${indicators.priceChange24h.toFixed(2)}% (bearish - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // RSI
    if (indicators?.rsi14 !== undefined) {
      if (indicators.rsi14 > 70) {
        bearishIndicators.push(`RSI(14) ${indicators.rsi14.toFixed(2)} overbought (potential reversal - CONTRADICTS BUY)`)
        actualBearishCount++
      } else if (indicators.rsi14 < 30) {
        bullishIndicators.push(`RSI(14) ${indicators.rsi14.toFixed(2)} oversold (bullish)`)
        actualBullishCount++
      } else {
        bullishIndicators.push(`RSI(14) ${indicators.rsi14.toFixed(2)} neutral`)
        actualBullishCount++
      }
    }
    if (indicators?.rsi7 !== undefined) {
      if (indicators.rsi7 > 70) {
        bearishIndicators.push(`RSI(7) ${indicators.rsi7.toFixed(2)} overbought (potential reversal - CONTRADICTS BUY)`)
        actualBearishCount++
      } else if (indicators.rsi7 < 30) {
        bullishIndicators.push(`RSI(7) ${indicators.rsi7.toFixed(2)} oversold (bullish)`)
        actualBullishCount++
      }
    }
    
    // RSI Divergence
    if (indicators?.rsiDivergence?.divergence) {
      const divLower = indicators.rsiDivergence.divergence.toLowerCase()
      if (divLower.includes('bullish')) {
        bullishIndicators.push(`RSI divergence bullish`)
        actualBullishCount++
      } else if (divLower.includes('bearish')) {
        bearishIndicators.push(`RSI divergence bearish (CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Daily Trend
    if (trendAlignment?.dailyTrend) {
      if (trendAlignment.dailyTrend === 'uptrend') {
        bullishIndicators.push(`Daily trend uptrend`)
        actualBullishCount++
      } else if (trendAlignment.dailyTrend === 'downtrend') {
        bearishIndicators.push(`Daily trend downtrend (counter-trend - CONTRADICTS BUY)`)
        actualBearishCount++
      } else {
        bearishIndicators.push(`Daily trend neutral (no clear direction)`)
        actualBearishCount++
      }
    }
    
    // Volume Trend
    if (indicators?.volumeTrend) {
      if (indicators.volumeTrend === 'increasing') {
        bullishIndicators.push(`Volume trend increasing (bullish)`)
        actualBullishCount++
      } else if (indicators.volumeTrend === 'decreasing') {
        bearishIndicators.push(`Volume trend decreasing (bearish - CONTRADICTS BUY)`)
        actualBearishCount++
      } else {
        bearishIndicators.push(`Volume trend stable (no confirmation)`)
        actualBearishCount++
      }
    }
    
    // Volume Change
    if (indicators?.volumeChangePercent !== undefined) {
      const volChange = indicators.volumeChangePercent
      if (volChange > 50) {
        bullishIndicators.push(`Volume change +${volChange.toFixed(2)}% (strong increase)`)
        actualBullishCount++
      } else if (volChange < -50) {
        bearishIndicators.push(`Volume change ${volChange.toFixed(2)}% (significant drop - CONTRADICTS BUY)`)
        actualBearishCount++
      } else if (volChange < 0) {
        bearishIndicators.push(`Volume change ${volChange.toFixed(2)}% (decreasing - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Volume-Price Divergence
    if (indicators?.volumePriceDivergence !== undefined) {
      const vpd = indicators.volumePriceDivergence
      if (vpd > 0.5) {
        bullishIndicators.push(`Volume-price divergence bullish +${vpd.toFixed(2)} (price falling but volume increasing)`)
        actualBullishCount++
      } else if (vpd < -0.5) {
        bearishIndicators.push(`Volume-price divergence bearish ${vpd.toFixed(2)} (price rising but volume decreasing - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Funding Rate
    if (externalData?.hyperliquid?.fundingRate !== undefined) {
      const fundingRate = externalData.hyperliquid.fundingRate
      if (fundingRate < 0) {
        bullishIndicators.push(`Funding rate ${(fundingRate * 100).toFixed(4)}% negative (bullish)`)
        actualBullishCount++
      } else if (fundingRate > 0) {
        bearishIndicators.push(`Funding rate +${(fundingRate * 100).toFixed(4)}% positive (bearish - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Premium to Oracle
    if (externalData?.hyperliquid?.premium !== undefined) {
      const premium = externalData.hyperliquid.premium
      if (premium < 0) {
        bullishIndicators.push(`Premium to oracle ${(premium * 100).toFixed(4)}% negative (undervalued)`)
        actualBullishCount++
      } else if (premium > 0) {
        bearishIndicators.push(`Premium to oracle +${(premium * 100).toFixed(4)}% positive (overvalued - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Whale Activity
    if (externalData?.blockchain?.whaleActivityScore !== undefined) {
      const whaleScore = externalData.blockchain.whaleActivityScore
      if (whaleScore > 0) {
        bullishIndicators.push(`Whale activity score +${whaleScore.toFixed(2)} bullish`)
        actualBullishCount++
      } else if (whaleScore < 0) {
        bearishIndicators.push(`Whale activity score ${whaleScore.toFixed(2)} bearish (CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Order Book Imbalance
    if (externalData?.orderBook?.imbalance !== undefined) {
      const imbalance = externalData.orderBook.imbalance
      if (imbalance > 0.1) {
        bullishIndicators.push(`Order book imbalance +${(imbalance * 100).toFixed(2)}% bullish (more bids than asks)`)
        actualBullishCount++
      } else if (imbalance < -0.1) {
        bearishIndicators.push(`Order book imbalance ${(imbalance * 100).toFixed(2)}% bearish (more asks than bids - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // CVD Trend
    if (externalData?.volumeDelta?.cvdTrend) {
      if (externalData.volumeDelta.cvdTrend === 'rising') {
        bullishIndicators.push(`CVD trend rising (bullish)`)
        actualBullishCount++
      } else if (externalData.volumeDelta.cvdTrend === 'falling') {
        bearishIndicators.push(`CVD trend falling (bearish - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Change of Character (COC)
    if (externalData?.marketStructure?.coc?.coc) {
      if (externalData.marketStructure.coc.coc === 'bullish') {
        bullishIndicators.push(`Change of Character bullish (trend reversal)`)
        actualBullishCount++
      } else if (externalData.marketStructure.coc.coc === 'bearish') {
        bearishIndicators.push(`Change of Character bearish (trend reversal - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // ATR
    if (indicators?.atr !== undefined && price > 0) {
      const atrPercent = (indicators.atr / price) * 100
      if (atrPercent < 1.5) {
        bearishIndicators.push(`ATR ${atrPercent.toFixed(2)}% low volatility (whipsaw risk - CONTRADICTS BUY)`)
        actualBearishCount++
      }
    }
    
    // Exchange Flow
    if (externalData?.blockchain?.estimatedExchangeFlow !== undefined) {
      const exchangeFlow = externalData.blockchain.estimatedExchangeFlow
      if (exchangeFlow > 0) {
        bearishIndicators.push(`Exchange inflow $${(exchangeFlow / 1000000).toFixed(2)}M (bearish pressure - CONTRADICTS BUY)`)
        actualBearishCount++
      } else if (exchangeFlow < 0) {
        bullishIndicators.push(`Exchange outflow $${Math.abs(exchangeFlow / 1000000).toFixed(2)}M (bullish pressure)`)
        actualBullishCount++
      }
    }
    
    // Use actual counts (from comprehensive indicator list) for summary
    // Since we always check indicators in this function, use actual counts directly
    // (passed parameters are from a different, less comprehensive calculation)
    const finalBullishCount = actualBullishCount
    const finalBearishCount = actualBearishCount
    
    // Check for contradictions first (using actual counts)
    if (finalBearishCount > finalBullishCount) {
      justificationParts.push(`CONTRADICTION: BUY signal but ${finalBearishCount} bearish indicators outweigh ${finalBullishCount} bullish indicators`)
    } else if (finalBearishCount === finalBullishCount) {
      justificationParts.push(`MIXED SIGNALS: ${finalBullishCount} bullish vs ${finalBearishCount} bearish indicators (equal weight)`)
    } else {
      justificationParts.push(`Bullish indicators (${finalBullishCount}) outweigh bearish (${finalBearishCount})`)
    }
    
    // Build comprehensive justification with ALL indicators
    // Format: Summary first, then ALL INDICATORS sections, then warnings, then Red Flags
    let finalJustification = justificationParts.join('. ') // Summary line (first part)
    
    // Add ALL INDICATORS section
    if (bullishIndicators.length > 0 || bearishIndicators.length > 0) {
      finalJustification += '\n\nALL INDICATORS:'
      if (bullishIndicators.length > 0) {
        finalJustification += `\nSupporting (Bullish): ${bullishIndicators.join(', ')}`
      }
      if (bearishIndicators.length > 0) {
        finalJustification += `\nContradicting (Bearish): ${bearishIndicators.join(', ')}`
      }
    }
    
    // Add high risk warning if contradictions exist (using actual counts)
    if (finalBearishCount > finalBullishCount) {
      finalJustification += `\n\nHIGH RISK: Signal contradicts majority of indicators (${finalBearishCount} bearish vs ${finalBullishCount} bullish)`
    } else if (finalBearishCount > 0 && bearishIndicators.length > 0) {
      finalJustification += `\n\nWARNING: ${finalBearishCount} bearish indicators present - use tight stop loss`
    }
    
    // Add Red Flags section
    const redFlagsSection = generateRedFlagsSection(signal, indicators, trendAlignment, externalData)
    if (redFlagsSection) {
      finalJustification += `\n\n${redFlagsSection}`
    }
    
    return finalJustification
  } else if (signal.signal === 'sell_to_enter') {
    // List BEARISH indicators (supporting SELL signal) - ALL indicators
    const bearishIndicators = []
    const bullishIndicators = []
    
    // Count indicators as we add them (comprehensive count from ALL indicators checked)
    let actualBullishCount = 0
    let actualBearishCount = 0
    
    // MACD histogram
    if (indicators?.macd?.histogram !== undefined) {
      if (indicators.macd.histogram < 0) {
        bearishIndicators.push(`MACD histogram ${indicators.macd.histogram.toFixed(4)} (bearish momentum)`)
        actualBearishCount++
      } else {
        bullishIndicators.push(`MACD histogram +${indicators.macd.histogram.toFixed(4)} (CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // OBV
    if (indicators?.obv !== undefined) {
      if (indicators.obv < 0) {
        bearishIndicators.push(`OBV ${indicators.obv.toFixed(2)} (selling pressure)`)
        actualBearishCount++
      } else if (indicators.obv > 0) {
        bullishIndicators.push(`OBV +${indicators.obv.toFixed(2)} (buying pressure - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // Bollinger Bands
    if (indicators?.bollingerBands) {
      if (price < indicators.bollingerBands.middle) {
        bearishIndicators.push(`Price below BB middle $${indicators.bollingerBands.middle.toFixed(2)} (bearish)`)
        actualBearishCount++
      } else if (price > indicators.bollingerBands.middle) {
        bullishIndicators.push(`Price above BB middle $${indicators.bollingerBands.middle.toFixed(2)} (bullish - CONTRADICTS SELL)`)
        actualBullishCount++
      }
      if (price < indicators.bollingerBands.lower) {
        bearishIndicators.push(`Price below BB lower $${indicators.bollingerBands.lower.toFixed(2)} (oversold)`)
        actualBearishCount++
      }
    }
    
    // Parabolic SAR
    if (indicators?.parabolicSAR) {
      if (price < indicators.parabolicSAR) {
        bearishIndicators.push(`Parabolic SAR $${indicators.parabolicSAR.toFixed(2)} bearish (above price)`)
        actualBearishCount++
      } else {
        bullishIndicators.push(`Parabolic SAR $${indicators.parabolicSAR.toFixed(2)} bullish (below price - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // Aroon
    if (indicators?.aroon) {
      if (indicators.aroon.down > indicators.aroon.up) {
        bearishIndicators.push(`Aroon Down ${indicators.aroon.down.toFixed(2)} > Up ${indicators.aroon.up.toFixed(2)} (bearish trend)`)
        actualBearishCount++
      } else if (indicators.aroon.up > indicators.aroon.down) {
        bullishIndicators.push(`Aroon Up ${indicators.aroon.up.toFixed(2)} > Down ${indicators.aroon.down.toFixed(2)} (bullish trend - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // VWAP
    if (indicators?.vwap) {
      if (price < indicators.vwap) {
        bearishIndicators.push(`Price below VWAP $${indicators.vwap.toFixed(2)} (bearish)`)
        actualBearishCount++
      } else {
        bullishIndicators.push(`Price above VWAP $${indicators.vwap.toFixed(2)} (bullish - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // 24h Change
    if (indicators?.priceChange24h !== undefined) {
      if (indicators.priceChange24h < 0) {
        bearishIndicators.push(`24h change ${indicators.priceChange24h.toFixed(2)}% (bearish)`)
        actualBearishCount++
      } else if (indicators.priceChange24h > 0) {
        bullishIndicators.push(`24h change +${indicators.priceChange24h.toFixed(2)}% (bullish - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // RSI
    if (indicators?.rsi14 !== undefined) {
      if (indicators.rsi14 < 30) {
        bearishIndicators.push(`RSI(14) ${indicators.rsi14.toFixed(2)} oversold (potential reversal)`)
        actualBearishCount++
      } else if (indicators.rsi14 > 70) {
        bullishIndicators.push(`RSI(14) ${indicators.rsi14.toFixed(2)} overbought (potential reversal - CONTRADICTS SELL)`)
        actualBullishCount++
      } else {
        bearishIndicators.push(`RSI(14) ${indicators.rsi14.toFixed(2)} neutral`)
        actualBearishCount++
      }
    }
    if (indicators?.rsi7 !== undefined) {
      if (indicators.rsi7 < 30) {
        bearishIndicators.push(`RSI(7) ${indicators.rsi7.toFixed(2)} oversold (potential reversal)`)
        actualBearishCount++
      } else if (indicators.rsi7 > 70) {
        bullishIndicators.push(`RSI(7) ${indicators.rsi7.toFixed(2)} overbought (potential reversal - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // RSI Divergence
    if (indicators?.rsiDivergence?.divergence) {
      const divLower = indicators.rsiDivergence.divergence.toLowerCase()
      if (divLower.includes('bearish')) {
        bearishIndicators.push(`RSI divergence bearish`)
        actualBearishCount++
      } else if (divLower.includes('bullish')) {
        bullishIndicators.push(`RSI divergence bullish (CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // Daily Trend
    if (trendAlignment?.dailyTrend) {
      if (trendAlignment.dailyTrend === 'downtrend') {
        bearishIndicators.push(`Daily trend downtrend`)
        actualBearishCount++
      } else if (trendAlignment.dailyTrend === 'uptrend') {
        bullishIndicators.push(`Daily trend uptrend (counter-trend - CONTRADICTS SELL)`)
        actualBullishCount++
      } else {
        bullishIndicators.push(`Daily trend neutral (no clear direction)`)
        actualBullishCount++
      }
    }
    
    // Volume Trend
    if (indicators?.volumeTrend) {
      if (indicators.volumeTrend === 'decreasing') {
        bearishIndicators.push(`Volume trend decreasing (bearish)`)
        actualBearishCount++
      } else if (indicators.volumeTrend === 'increasing') {
        bullishIndicators.push(`Volume trend increasing (bullish - CONTRADICTS SELL)`)
        actualBullishCount++
      } else {
        bullishIndicators.push(`Volume trend stable (no confirmation)`)
        actualBullishCount++
      }
    }
    
    // Volume Change
    if (indicators?.volumeChangePercent !== undefined) {
      const volChange = indicators.volumeChangePercent
      if (volChange < -50) {
        bearishIndicators.push(`Volume change ${volChange.toFixed(2)}% (significant drop)`)
        actualBearishCount++
      } else if (volChange > 50) {
        bullishIndicators.push(`Volume change +${volChange.toFixed(2)}% (strong increase - CONTRADICTS SELL)`)
        actualBullishCount++
      } else if (volChange > 0) {
        bullishIndicators.push(`Volume change +${volChange.toFixed(2)}% (increasing - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // Volume-Price Divergence
    if (indicators?.volumePriceDivergence !== undefined) {
      const vpd = indicators.volumePriceDivergence
      if (vpd < -0.5) {
        bearishIndicators.push(`Volume-price divergence bearish ${vpd.toFixed(2)} (price falling but volume decreasing)`)
        actualBearishCount++
      } else if (vpd > 0.5) {
        bullishIndicators.push(`Volume-price divergence bullish +${vpd.toFixed(2)} (price falling but volume increasing - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // Funding Rate
    if (externalData?.hyperliquid?.fundingRate !== undefined) {
      const fundingRate = externalData.hyperliquid.fundingRate
      if (fundingRate > 0) {
        bearishIndicators.push(`Funding rate +${(fundingRate * 100).toFixed(4)}% positive (bearish)`)
        actualBearishCount++
      } else if (fundingRate < 0) {
        bullishIndicators.push(`Funding rate ${(fundingRate * 100).toFixed(4)}% negative (bullish - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // Premium to Oracle
    if (externalData?.hyperliquid?.premium !== undefined) {
      const premium = externalData.hyperliquid.premium
      if (premium > 0) {
        bearishIndicators.push(`Premium to oracle +${(premium * 100).toFixed(4)}% positive (overvalued)`)
        actualBearishCount++
      } else if (premium < 0) {
        bullishIndicators.push(`Premium to oracle ${(premium * 100).toFixed(4)}% negative (undervalued - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // Whale Activity
    if (externalData?.blockchain?.whaleActivityScore !== undefined) {
      const whaleScore = externalData.blockchain.whaleActivityScore
      if (whaleScore < 0) {
        bearishIndicators.push(`Whale activity score ${whaleScore.toFixed(2)} bearish`)
        actualBearishCount++
      } else if (whaleScore > 0) {
        bullishIndicators.push(`Whale activity score +${whaleScore.toFixed(2)} bullish (CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // Order Book Imbalance
    if (externalData?.orderBook?.imbalance !== undefined) {
      const imbalance = externalData.orderBook.imbalance
      if (imbalance < -0.1) {
        bearishIndicators.push(`Order book imbalance ${(imbalance * 100).toFixed(2)}% bearish (more asks than bids)`)
        actualBearishCount++
      } else if (imbalance > 0.1) {
        bullishIndicators.push(`Order book imbalance +${(imbalance * 100).toFixed(2)}% bullish (more bids than asks - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // CVD Trend
    if (externalData?.volumeDelta?.cvdTrend) {
      if (externalData.volumeDelta.cvdTrend === 'falling') {
        bearishIndicators.push(`CVD trend falling (bearish)`)
        actualBearishCount++
      } else if (externalData.volumeDelta.cvdTrend === 'rising') {
        bullishIndicators.push(`CVD trend rising (bullish - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // Change of Character (COC)
    if (externalData?.marketStructure?.coc?.coc) {
      if (externalData.marketStructure.coc.coc === 'bearish') {
        bearishIndicators.push(`Change of Character bearish (trend reversal)`)
        actualBearishCount++
      } else if (externalData.marketStructure.coc.coc === 'bullish') {
        bullishIndicators.push(`Change of Character bullish (trend reversal - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // ATR
    if (indicators?.atr !== undefined && price > 0) {
      const atrPercent = (indicators.atr / price) * 100
      if (atrPercent < 1.5) {
        bearishIndicators.push(`ATR ${atrPercent.toFixed(2)}% low volatility (whipsaw risk)`)
        actualBearishCount++
      }
    }
    
    // Exchange Flow
    if (externalData?.blockchain?.estimatedExchangeFlow !== undefined) {
      const exchangeFlow = externalData.blockchain.estimatedExchangeFlow
      if (exchangeFlow > 0) {
        bearishIndicators.push(`Exchange inflow $${(exchangeFlow / 1000000).toFixed(2)}M (bearish pressure)`)
        actualBearishCount++
      } else if (exchangeFlow < 0) {
        bullishIndicators.push(`Exchange outflow $${Math.abs(exchangeFlow / 1000000).toFixed(2)}M (bullish pressure - CONTRADICTS SELL)`)
        actualBullishCount++
      }
    }
    
    // Use actual counts (from comprehensive indicator list) for summary
    // Since we always check indicators in this function, use actual counts directly
    // (passed parameters are from a different, less comprehensive calculation)
    const finalBullishCount = actualBullishCount
    const finalBearishCount = actualBearishCount
    
    // Check for contradictions first (using actual counts)
    if (finalBullishCount > finalBearishCount) {
      justificationParts.push(`CONTRADICTION: SELL signal but ${finalBullishCount} bullish indicators outweigh ${finalBearishCount} bearish indicators`)
    } else if (finalBullishCount === finalBearishCount) {
      justificationParts.push(`MIXED SIGNALS: ${finalBullishCount} bullish vs ${finalBearishCount} bearish indicators (equal weight)`)
    } else {
      justificationParts.push(`Bearish indicators (${finalBearishCount}) outweigh bullish (${finalBullishCount})`)
    }
    
    // Build comprehensive justification with ALL indicators
    // Format: Summary first, then ALL INDICATORS sections, then warnings, then Red Flags
    let finalJustification = justificationParts.join('. ') // Summary line (first part)
    
    // Add ALL INDICATORS section
    if (bearishIndicators.length > 0 || bullishIndicators.length > 0) {
      finalJustification += '\n\nALL INDICATORS:'
      if (bearishIndicators.length > 0) {
        finalJustification += `\nSupporting (Bearish): ${bearishIndicators.join(', ')}`
      }
      if (bullishIndicators.length > 0) {
        finalJustification += `\nContradicting (Bullish): ${bullishIndicators.join(', ')}`
      }
    }
    
    // Add high risk warning if contradictions exist (using actual counts)
    if (finalBullishCount > finalBearishCount) {
      finalJustification += `\n\nHIGH RISK: Signal contradicts majority of indicators (${finalBullishCount} bullish vs ${finalBearishCount} bearish)`
    } else if (finalBullishCount > 0 && bullishIndicators.length > 0) {
      finalJustification += `\n\nWARNING: ${finalBullishCount} bullish indicators present - use tight stop loss`
    }
    
    // Add Red Flags section
    const redFlagsSection = generateRedFlagsSection(signal, indicators, trendAlignment, externalData)
    if (redFlagsSection) {
      finalJustification += `\n\n${redFlagsSection}`
    }
    
    return finalJustification
  }
  
  // Fallback: return original justification if signal type doesn't match
  return signal.justification || 'Signal generated based on technical analysis'
}

// Helper function to generate red flags section
function generateRedFlagsSection(signal, indicators, trendAlignment, externalData) {
  const redFlags = []
  const price = indicators?.price || 0
  
  // Volume change check - differentiate between spike and drop based on signal type
  if (indicators?.volumeChangePercent !== undefined) {
    const volChange = indicators.volumeChangePercent
    const isSellSignal = signal.signal === 'sell_to_enter'
    const isBuySignal = signal.signal === 'buy_to_enter' || signal.signal === 'add'
    
    if (isSellSignal && volChange > 50) {
      // Volume spike for SELL = bullish pressure (red flag - contradicts SELL)
      if (volChange > 150) {
        redFlags.push(`CRITICAL: Volume spike +${volChange.toFixed(2)}% (strong buying pressure - CONTRADICTS SELL signal)`)
      } else {
        redFlags.push(`WARNING: Volume spike +${volChange.toFixed(2)}% (buying pressure - CONTRADICTS SELL)`)
      }
    } else if (isBuySignal && volChange < -50) {
      // Volume drop for BUY = low activity (red flag)
      if (volChange < -80) {
        redFlags.push(`CRITICAL: Volume drop ${volChange.toFixed(2)}% (extremely low activity)`)
      } else {
        redFlags.push(`WARNING: Volume drop ${volChange.toFixed(2)}% (low activity)`)
      }
    }
    // Note: SELL + volume drop (negative) = supporting (not red flag)
    // Note: BUY + volume spike (positive) = supporting (not red flag)
  }
  
  // Daily trend mismatch (counter-trend)
  if (trendAlignment?.dailyTrend) {
    if ((signal.signal === 'buy_to_enter' || signal.signal === 'add') && trendAlignment.dailyTrend === 'downtrend') {
      redFlags.push(`Daily downtrend (counter-trend play - HIGH RISK)`)
    } else if (signal.signal === 'sell_to_enter' && trendAlignment.dailyTrend === 'uptrend') {
      redFlags.push(`Daily uptrend (counter-trend play - HIGH RISK)`)
    }
  }
  
  // RSI overbought/oversold
  if (indicators?.rsi14 !== undefined) {
    if ((signal.signal === 'buy_to_enter' || signal.signal === 'add') && indicators.rsi14 > 70) {
      redFlags.push(`RSI overbought ${indicators.rsi14.toFixed(2)} (potential reversal)`)
    } else if (signal.signal === 'sell_to_enter' && indicators.rsi14 < 30) {
      redFlags.push(`RSI oversold ${indicators.rsi14.toFixed(2)} (potential reversal)`)
    }
  }
  
  // Volume-price divergence bearish untuk BUY
  if ((signal.signal === 'buy_to_enter' || signal.signal === 'add') && indicators?.volumePriceDivergence !== undefined && indicators.volumePriceDivergence < -0.5) {
    redFlags.push(`Volume-price divergence bearish (price rising but volume decreasing)`)
  }
  
  // Volume-price divergence bullish untuk SELL
  if (signal.signal === 'sell_to_enter' && indicators?.volumePriceDivergence !== undefined && indicators.volumePriceDivergence > 0.5) {
    redFlags.push(`Volume-price divergence bullish (price falling but volume increasing)`)
  }
  
  // Low ATR
  if (indicators?.atr !== undefined && price > 0) {
    const atrPercent = (indicators.atr / price) * 100
    if (atrPercent < 1.5) {
      redFlags.push(`Low volatility (ATR ${atrPercent.toFixed(2)}% - whipsaw risk)`)
    }
  }
  
  // Exchange inflow bearish untuk BUY
  if ((signal.signal === 'buy_to_enter' || signal.signal === 'add') && externalData?.blockchain?.estimatedExchangeFlow > 0) {
    redFlags.push(`Exchange inflow detected (bearish pressure)`)
  }
  
  // Exchange outflow bullish untuk SELL
  if (signal.signal === 'sell_to_enter' && externalData?.blockchain?.estimatedExchangeFlow < 0) {
    redFlags.push(`Exchange outflow detected (bullish pressure)`)
  }
  
  if (redFlags.length === 0) {
    return null // No red flags
  }
  
  return `RED FLAGS TO MONITOR:\n${redFlags.map(flag => `   - ${flag}`).join('\n')}\n   - Watch these closely for exit signals`
}

// Validation function to check signal-justification consistency
function validateSignalJustificationConsistency(signal, justification) {
  if (!justification || typeof justification !== 'string') {
    return { isValid: false, reason: 'Justification is missing or invalid' }
  }
  
  const justificationLower = justification.toLowerCase()
  const signalType = signal.signal?.toLowerCase()
  
  // Define keywords for each direction
  const bullishKeywords = ['long', 'bullish', 'buy', 'buying', 'uptrend', 'upward', 'oversold', 'bounce', 'rebound', 'entering long']
  const bearishKeywords = ['short', 'bearish', 'sell', 'selling', 'downtrend', 'downward', 'overbought', 'reversal', 'entering short']
  
  // Count keyword matches
  let bullishMatches = 0
  let bearishMatches = 0
  
  bullishKeywords.forEach(keyword => {
    if (justificationLower.includes(keyword)) bullishMatches++
  })
  
  bearishKeywords.forEach(keyword => {
    if (justificationLower.includes(keyword)) bearishMatches++
  })
  
  // Check consistency
  if (signalType === 'buy_to_enter' || signalType === 'add') {
    if (bearishMatches > bullishMatches && bearishMatches > 0) {
      return { 
        isValid: false, 
        reason: `BUY signal but justification contains more bearish keywords (${bearishMatches} bearish vs ${bullishMatches} bullish)` 
      }
    }
    if (bullishMatches === 0 && bearishMatches > 0) {
      return { 
        isValid: false, 
        reason: `BUY signal but justification contains only bearish keywords` 
      }
    }
  } else if (signalType === 'sell_to_enter') {
    if (bullishMatches > bearishMatches && bullishMatches > 0) {
      return { 
        isValid: false, 
        reason: `SELL signal but justification contains more bullish keywords (${bullishMatches} bullish vs ${bearishMatches} bearish)` 
      }
    }
    if (bearishMatches === 0 && bullishMatches > 0) {
      return { 
        isValid: false, 
        reason: `SELL signal but justification contains only bullish keywords` 
      }
    }
  }
  
  return { isValid: true }
}

async function generateSignals(model, marketData, accountState, allowedAssets) {
  // Clear warnings at start of signal generation
  signalWarnings.length = 0
  // Get active positions
  const positions = getActivePositions(accountState)
  
  // Calculate correlation matrix between assets (always calculate for full analysis)
  let correlationMatrix = {}
  {
    try {
      correlationMatrix = calculateCorrelationMatrix(marketData, allowedAssets, 24)
      if (Object.keys(correlationMatrix).length > 0) {
        console.log('📊 Correlation Matrix:')
        for (const [pair, correlation] of Object.entries(correlationMatrix)) {
          const corrValue = correlation !== null ? correlation.toFixed(3) : 'N/A'
          console.log(`   ${pair}: ${corrValue}`)
        }
      }
    } catch (error) {
      console.warn(`Failed to calculate correlation matrix: ${error.message}`)
    }
  }
  
  // Build technical analysis summary for each asset
  // Only include assets with valid technical indicators
  const technicalAnalysisSummary = []
  for (const [asset, data] of marketData) {
    // FUTURES TRADING: Don't skip assets without technical indicators
    // For futures, we can generate signals even with just price data
    // Only skip if no price data available at all
    const hasPrice = data?.indicators?.price || data?.price || data?.data?.price || data?.data?.markPx
    const hasIndicators = data?.indicators && (data.indicators.rsi14 || data.indicators.ema20 || data.indicators.macd)
    
    if (!hasPrice) {
      console.warn(`⚠️  Skipping ${asset} from analysis: No price data available`)
      continue
    }
    
    // FUTURES TRADING: Warn if no indicators but still include in prompt
    if (!hasIndicators) {
      console.warn(`⚠️  ${asset}: No technical indicators available - will generate signal with price action only (FUTURES mode allows this)`)
      // Don't skip - continue to include in prompt for futures trading
    }
    
    // FUTURES TRADING: Always build analysis, even without indicators
    // Use available data (price, external data, etc.) even if technical indicators are missing
    const ind = data?.indicators || { price: hasPrice }
    const position = positions.get(asset)
    
    let analysis = `**${asset} Technical Analysis:**\n`
    
    // FUTURES TRADING: Add note if no indicators available
    if (!hasIndicators) {
      analysis += `- ⚠️ **WARNING: No technical indicators available - using price action only (FUTURES mode)**\n`
      analysis += `- This is acceptable for futures trading - leverage allows for price-action-based signals\n`
    }
    
    // Add Hyperliquid data (Mark, Oracle, 24h Change, 24h Volume, Open Interest)
    const assetData = marketData instanceof Map ? marketData.get(asset) : marketData[asset]
    const dataObj = assetData?.data || assetData
    const markPrice = dataObj?.markPx || assetData?.markPx || assetData?.price || ind?.price || hasPrice
    const oraclePrice = dataObj?.markPx || assetData?.markPx || assetData?.price || ind?.price || hasPrice // Use markPx as oracle if available
    const volume24h = dataObj?.volume24h || assetData?.volume24h || assetData?.data?.volume24h || 0
    const openInterest = dataObj?.externalData?.hyperliquid?.openInterest || assetData?.externalData?.hyperliquid?.openInterest || 0
    const priceChange24h = ind?.priceChange24h || 0
    const priceChange24hAbs = Math.abs(priceChange24h)
    const currentPrice = ind?.price || markPrice || hasPrice
    
    // Format 24h Change: "-48,5 / -1,34%"
    // Calculate absolute change in price units (24h ago price to current price)
    // FUTURES TRADING: Handle case where priceChange24h might not be available
    let price24hAgo = currentPrice
    let priceChangeAbs = 0
    if (priceChange24h !== 0 && currentPrice) {
      price24hAgo = currentPrice / (1 + priceChange24h / 100)
      priceChangeAbs = currentPrice - price24hAgo
    }
    const changeSign = priceChange24h >= 0 ? '+' : '-'
    const changeFormatted = priceChange24h !== 0 && currentPrice
      ? `${changeSign}${Math.abs(priceChangeAbs).toFixed(1).replace('.', ',')} / ${changeSign}${priceChange24hAbs.toFixed(2).replace('.', ',')}%`
      : 'N/A (no 24h change data)'
    
    // Format prices
    const markFormatted = formatPrice(markPrice, asset)
    const oracleFormatted = formatPrice(oraclePrice, asset)
    const currentPriceFormatted = formatPrice(currentPrice, asset)
      
      // Format volume and OI
      const volumeFormatted = volume24h > 0 ? `$${formatLargeNumber(volume24h)}` : 'N/A'
      const oiFormatted = openInterest > 0 ? `$${formatLargeNumber(openInterest)}` : 'N/A'
      
      analysis += `- Mark: ${markFormatted}\n`
      analysis += `- Oracle: ${oracleFormatted}\n`
      analysis += `- 24h Change: ${changeFormatted}\n`
      analysis += `- 24h Volume: ${volumeFormatted}\n`
      analysis += `- Open Interest: ${oiFormatted}\n`
      analysis += `- Current Price: ${currentPriceFormatted}\n`
      
      // Calculate trend short/long from recent price movement (last 2 minutes equivalent - last 2 candles if 1h data)
      let shortLongTrend = 'Neutral'
      let marketMovement2min = 'No significant movement'
      const historicalData = assetData?.historicalData || assetData?.data?.historicalData || []
      if (historicalData && historicalData.length >= 2) {
        const recentData = historicalData.slice(-2) // Last 2 candles (equivalent to ~2 hours, but closest we have)
        if (recentData.length === 2) {
          const priceChange = recentData[1].close - recentData[0].close
          const priceChangePercent = (priceChange / recentData[0].close) * 100
          
          if (priceChangePercent > 0.1) {
            shortLongTrend = 'Long (Bullish)'
            marketMovement2min = `Price up ${priceChangePercent.toFixed(2)}% (More buyers)`
          } else if (priceChangePercent < -0.1) {
            shortLongTrend = 'Short (Bearish)'
            marketMovement2min = `Price down ${Math.abs(priceChangePercent).toFixed(2)}% (More sellers)`
          } else {
            shortLongTrend = 'Neutral'
            marketMovement2min = `Price stable (${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%)`
          }
        }
      }
      
      analysis += `- Trend Short/Long: ${shortLongTrend}\n`
      analysis += `- Market Movement (Recent): ${marketMovement2min}\n`
      
    // Show active position if exists
    if (position) {
      const pnlPercent = position.entryPrice > 0 && currentPrice
        ? (((currentPrice - position.entryPrice) / position.entryPrice) * 100 * (position.side === 'LONG' ? 1 : -1)).toFixed(2)
        : '0.00'
      analysis += `- **ACTIVE POSITION:** ${position.side} ${Math.abs(position.quantity)} @ $${position.entryPrice.toFixed(2)} (Entry: ${new Date(position.entryTime).toLocaleTimeString()})\n`
      analysis += `  → Current PnL: ${pnlPercent}% (Unrealized: $${position.unrealizedPnl?.toFixed(2) || '0.00'})\n`
      analysis += `  → Leverage: ${position.leverage}x\n`
    } else {
      analysis += `- **NO ACTIVE POSITION** (Available to open new position)\n`
    }
    
    // FUTURES TRADING: Only add indicators if available
    // For futures, we can generate signals even without technical indicators
    if (hasIndicators) {
      analysis += `- RSI(14): ${ind.rsi14?.toFixed(2) || 'N/A'} ${ind.rsi14 && ind.rsi14 > 70 ? '(Overbought ⚠️)' : ind.rsi14 && ind.rsi14 < 30 ? '(Oversold ✅)' : '(Neutral)'}\n`
      analysis += `- RSI(7): ${ind.rsi7?.toFixed(2) || 'N/A'}\n`
      analysis += `- EMA(20): $${ind.ema20?.toFixed(2) || 'N/A'} ${ind.ema20 && currentPrice && currentPrice > ind.ema20 ? '(Price Above ✅)' : '(Price Below ⚠️)'}\n`
      analysis += `- EMA(50): $${ind.ema50?.toFixed(2) || 'N/A'}\n`
      analysis += `- EMA(200): $${ind.ema200?.toFixed(2) || 'N/A'}\n`
      
      if (ind.macd) {
        analysis += `- MACD: ${ind.macd.macd.toFixed(4)}, Signal: ${ind.macd.signal.toFixed(4)}, Histogram: ${ind.macd.histogram.toFixed(4)} ${ind.macd.histogram > 0 ? '(Bullish ✅)' : '(Bearish ⚠️)'}\n`
      }
      
      if (ind.bollingerBands && currentPrice) {
        // Validate Bollinger Bands position before sending to AI
        const price = currentPrice
        const bbUpper = ind.bollingerBands.upper
        const bbLower = ind.bollingerBands.lower
        const bbMiddle = ind.bollingerBands.middle
        
        // Determine actual position relative to BB bands
        let bbPosition = 'within'
        if (price > bbUpper) {
          bbPosition = 'above_upper'
        } else if (price < bbLower) {
          bbPosition = 'below_lower'
        } else if (price > bbMiddle) {
          bbPosition = 'above_middle'
        } else {
          bbPosition = 'below_middle'
        }
        
        analysis += `- Bollinger Bands: Upper: $${bbUpper.toFixed(2)}, Middle: $${bbMiddle.toFixed(2)}, Lower: $${bbLower.toFixed(2)}\n`
        analysis += `  → Current Price: $${price.toFixed(2)} | Position: ${bbPosition === 'above_upper' ? 'ABOVE upper band (Overbought ⚠️)' : bbPosition === 'below_lower' ? 'BELOW lower band (Oversold ✅)' : bbPosition === 'above_middle' ? 'Above middle (Bullish)' : 'Below middle (Bearish)'}\n`
      }
      
      // Add all indicators for full analysis (only if available)
      if (ind.atr) {
        analysis += `- ATR(14): $${ind.atr.toFixed(2)}\n`
      }
      
      if (ind.adx) {
        const adxValue = typeof ind.adx === 'number' ? ind.adx : (ind.adx?.adx || null)
        if (adxValue !== null && !isNaN(adxValue)) {
          analysis += `- ADX(14): ${adxValue.toFixed(2)} ${adxValue > 25 ? '(Strong)' : adxValue < 20 ? '(Weak)' : '(Moderate)'}\n`
        }
      }
      
      // Always include all indicators for full analysis (if available)
      if (ind.obv) {
        const obvSignal = ind.obv > 0 ? 'BULLISH (positive buying pressure)' : 'BEARISH (negative selling pressure)'
        analysis += `- OBV: ${ind.obv.toFixed(2)} → ${obvSignal}\n`
      }
      
      if (ind.vwap && currentPrice) {
        const vwapSignal = currentPrice > ind.vwap ? 'BULLISH (price above VWAP)' : 'BEARISH (price below VWAP)'
        analysis += `- VWAP: $${ind.vwap.toFixed(2)} → ${vwapSignal}\n`
      }
      
      if (ind.stochastic) {
        const stochSignal = ind.stochastic.k > 80 ? 'Overbought' : ind.stochastic.k < 20 ? 'Oversold' : 'Neutral'
        analysis += `- Stochastic: K: ${ind.stochastic.k.toFixed(2)}, D: ${ind.stochastic.d.toFixed(2)} → ${stochSignal}\n`
      }
      
      if (ind.cci) {
        const cciSignal = ind.cci > 100 ? 'Overbought (BULLISH strength)' : ind.cci < -100 ? 'Oversold (BEARISH weakness)' : 'Neutral'
        analysis += `- CCI: ${ind.cci.toFixed(2)} → ${cciSignal}\n`
      }
      
      if (ind.williamsR) {
        analysis += `- Williams %R: ${ind.williamsR.toFixed(2)}\n`
      }
      
      if (ind.parabolicSAR && currentPrice) {
        const sarDirection = currentPrice > ind.parabolicSAR ? 'BULLISH (SAR below price)' : 'BEARISH (SAR above price)'
        analysis += `- Parabolic SAR: $${ind.parabolicSAR.toFixed(2)} → ${sarDirection}\n`
      }
      
      if (ind.aroon) {
        const aroonSignal = ind.aroon.up > ind.aroon.down ? `BULLISH (Up: ${ind.aroon.up.toFixed(0)}, Down: ${ind.aroon.down.toFixed(0)})` : `BEARISH (Up: ${ind.aroon.up.toFixed(0)}, Down: ${ind.aroon.down.toFixed(0)})`
        analysis += `- Aroon: ${aroonSignal}\n`
      }
      
      if (ind.supportResistance) {
        const sr = ind.supportResistance
        if (sr.support || sr.resistance) {
          analysis += `- Support/Resistance: Support: $${sr.support?.toFixed(2) || 'N/A'}, Resistance: $${sr.resistance?.toFixed(2) || 'N/A'}\n`
        }
      }
      
      if (ind.trendDetection) {
        const td = ind.trendDetection
        analysis += `- Trend Detection: ${td.trend} (Strength: ${td.strength}/3)\n`
      }
      
      if (ind.marketStructure) {
        const ms = ind.marketStructure
        analysis += `- Market Structure: ${ms.structure}\n`
      }
      
      if (ind.rsiDivergence && ind.rsiDivergence.divergence) {
        analysis += `- RSI Divergence: ${ind.rsiDivergence.divergence}\n`
      }
      
      if (ind.macdDivergence && ind.macdDivergence.divergence) {
        analysis += `- MACD Divergence: ${ind.macdDivergence.divergence}\n`
      }
      
      if (ind.candlestickPatterns && ind.candlestickPatterns.patterns && ind.candlestickPatterns.patterns.length > 0) {
        const patterns = ind.candlestickPatterns.patterns
        const patternNames = patterns.map(p => p.type).join(', ')
        analysis += `- Candlestick Patterns: ${patternNames}\n`
      }
      
      if (ind.marketRegime) {
        const mr = ind.marketRegime
        analysis += `- Market Regime: ${mr.regime} | Volatility: ${mr.volatility}\n`
      }
    } else {
      // FUTURES TRADING: No indicators available - use price action only
      analysis += `- Technical Indicators: N/A (Price action only - FUTURES mode)\n`
      analysis += `- Note: For futures trading, signals can be generated based on price action and external data (funding rate, OI, etc.)\n`
      analysis += `- Use lower confidence (0.3-0.5) and explain in justification that technical data is limited\n`
    }
    
    // 24h Change already added above with Hyperliquid data section
    
    // Add multi-timeframe analysis if available
    // Note: assetData already declared above
    if (assetData && assetData.trendAlignment) {
      const ta = assetData.trendAlignment
      analysis += `\n**Multi-Timeframe Analysis:**\n`
      analysis += `- Daily Trend: ${ta.dailyTrend || 'N/A'}\n`
      analysis += `- 4H Aligned: ${ta.h4Aligned ? 'Yes ✅' : 'No ⚠️'}\n`
      analysis += `- 1H Aligned: ${ta.h1Aligned ? 'Yes ✅' : 'No ⚠️'}\n`
      analysis += `- Overall Alignment: ${ta.aligned ? 'Yes ✅' : 'No ⚠️'} (${ta.reason || 'N/A'})\n`
    }
    
    if (assetData && assetData.multiTimeframeIndicators) {
      const mtf = assetData.multiTimeframeIndicators
      if (mtf['1d']) {
        const daily = mtf['1d']
        analysis += `- Daily (1D): EMA20: $${daily.ema20?.toFixed(2) || 'N/A'}, EMA50: $${daily.ema50?.toFixed(2) || 'N/A'}, RSI: ${daily.rsi14?.toFixed(2) || 'N/A'}\n`
      }
      if (mtf['4h']) {
        const h4 = mtf['4h']
        analysis += `- 4H: EMA20: $${h4.ema20?.toFixed(2) || 'N/A'}, RSI: ${h4.rsi14?.toFixed(2) || 'N/A'}\n`
      }
      if (mtf['1h']) {
        const h1 = mtf['1h']
        analysis += `- 1H: EMA20: $${h1.ema20?.toFixed(2) || 'N/A'}, RSI: ${h1.rsi14?.toFixed(2) || 'N/A'}\n`
      }
    }
    
    // Add external data to technical analysis summary
    if (assetData && assetData.externalData) {
      const ext = assetData.externalData
      // Use currentPrice defined above (line 8125) or fallback to ind.price
      const price = currentPrice || ind?.price || markPrice || 0
      
      analysis += `\n**External Data:**\n`
      
      // Hyperliquid data (funding rate, OI, premium, oracle, mid price)
      if (ext.hyperliquid) {
        const hl = ext.hyperliquid
        analysis += `- Funding Rate: ${(hl.fundingRate * 100).toFixed(4)}% (Trend: ${hl.fundingRateTrend || 'N/A'})\n`
        analysis += `- Open Interest: $${hl.openInterest?.toLocaleString() || 'N/A'} (Trend: ${hl.oiTrend || 'N/A'})\n`
        if (hl.premium !== undefined && hl.premium !== 0) {
          analysis += `- Premium to Oracle: ${(hl.premium * 100).toFixed(4)}% ${hl.premium > 0 ? '(Overvalued)' : '(Undervalued)'}\n`
        }
        if (hl.oraclePx && hl.oraclePx > 0) {
          analysis += `- Oracle Price: $${hl.oraclePx.toFixed(2)}\n`
        }
        if (hl.midPx && hl.midPx > 0) {
          analysis += `- Mid Price: $${hl.midPx.toFixed(2)} (Order book midpoint)\n`
        }
        if (hl.prevDayPx && hl.prevDayPx > 0 && price > 0) {
          const priceChange = (price - hl.prevDayPx) / hl.prevDayPx * 100
          analysis += `- 24h Price Change (from prevDayPx): ${priceChange.toFixed(2)}%\n`
        }
        if (hl.dayBaseVlm && hl.dayBaseVlm > 0) {
          analysis += `- 24h Base Volume: ${hl.dayBaseVlm.toLocaleString()} (Volume in base asset)\n`
        }
        // Add impact prices info (order book depth indicator)
        if (hl.impactPxs && Array.isArray(hl.impactPxs) && hl.impactPxs.length >= 2) {
          const bidImpact = parseFloat(hl.impactPxs[0] || '0')
          const askImpact = parseFloat(hl.impactPxs[1] || '0')
          if (bidImpact > 0 && askImpact > 0) {
            analysis += `- Impact Prices: Bid: $${bidImpact.toFixed(2)}, Ask: $${askImpact.toFixed(2)} (Order book depth levels)\n`
          }
        }
      }
      
      // COB (Current Order Book) - Order book depth and support/resistance zones
      if (ext.orderBook && price > 0) {
        const ob = ext.orderBook
        analysis += `\n**Order Book (COB):**\n`
        analysis += `- Bid Price: $${ob.bidPrice.toFixed(2)}, Ask Price: $${ob.askPrice.toFixed(2)}\n`
        analysis += `- Mid Price: $${ob.midPrice.toFixed(2)}\n`
        analysis += `- Bid/Ask Spread: ${ob.spreadPercent.toFixed(4)}% (Liquidity Score: ${ob.liquidityScore.toFixed(0)}/100)\n`
        analysis += `- Bid/Ask Imbalance: ${(ob.imbalance * 100).toFixed(2)}% ${ob.imbalance > 0 ? '(Bullish - more bids)' : ob.imbalance < 0 ? '(Bearish - more asks)' : '(Neutral)'}\n`
        if (ob.supportZones && ob.supportZones.length > 0) {
          const support = ob.supportZones[0]
          analysis += `- Support Zone: $${support.price.toFixed(2)} (Depth: ${(support.depth * 100).toFixed(0)}%, Distance: ${((support.distance / price) * 100).toFixed(2)}%)\n`
        }
        if (ob.resistanceZones && ob.resistanceZones.length > 0) {
          const resistance = ob.resistanceZones[0]
          analysis += `- Resistance Zone: $${resistance.price.toFixed(2)} (Depth: ${(resistance.depth * 100).toFixed(0)}%, Distance: ${((resistance.distance / price) * 100).toFixed(2)}%)\n`
        }
        analysis += `- Bid Depth: ${ob.bidDepth.toFixed(0)}/100, Ask Depth: ${ob.askDepth.toFixed(0)}/100\n`
      }
      
      // SVP (Session Volume Profile) - POC, VAH, VAL, HVN, LVN
      if (ext.volumeProfile && ext.volumeProfile.session && price > 0) {
        const svp = ext.volumeProfile.session
        analysis += `\n**Session Volume Profile (SVP):**\n`
        analysis += `- POC (Point of Control): $${svp.poc.toFixed(2)} (price with highest volume)\n`
        analysis += `- VAH (Value Area High): $${svp.vah.toFixed(2)}\n`
        analysis += `- VAL (Value Area Low): $${svp.val.toFixed(2)}\n`
        analysis += `- Value Area Range: $${svp.val.toFixed(2)} - $${svp.vah.toFixed(2)} (70% of volume)\n`
        if (svp.hvn && svp.hvn.length > 0) {
          analysis += `- HVN (High Volume Nodes): ${svp.hvn.slice(0, 3).map(h => `$${h.price.toFixed(2)}`).join(', ')} (support/resistance zones)\n`
        }
        if (svp.lvn && svp.lvn.length > 0) {
          analysis += `- LVN (Low Volume Nodes): ${svp.lvn.slice(0, 3).map(l => `$${l.price.toFixed(2)}`).join(', ')} (potential breakout areas)\n`
        }
        // Check if price is at POC, VAH, or VAL
        const priceToPoc = Math.abs((price - svp.poc) / svp.poc) * 100
        const priceToVah = Math.abs((price - svp.vah) / svp.vah) * 100
        const priceToVal = Math.abs((price - svp.val) / svp.val) * 100
        if (priceToPoc < 1) {
          analysis += `- ⚠️ Price at POC: Strong support/resistance level (highest volume price)\n`
        } else if (priceToVah < 1) {
          analysis += `- ⚠️ Price at VAH: Upper value area boundary\n`
        } else if (priceToVal < 1) {
          analysis += `- ⚠️ Price at VAL: Lower value area boundary\n`
        } else if (price >= svp.val && price <= svp.vah) {
          analysis += `- Price within value area (between VAL and VAH)\n`
        } else {
          analysis += `- Price outside value area (${price < svp.val ? 'below VAL' : 'above VAH'})\n`
        }
        analysis += `- Total Session Volume: ${svp.totalVolume?.toLocaleString() || 'N/A'}\n`
      }
      
      // CRVP (Composite Range Volume Profile) - Long-term volume profile
      if (ext.volumeProfile && ext.volumeProfile.composite && price > 0) {
        const crvp = ext.volumeProfile.composite
        analysis += `\n**Composite Volume Profile (CRVP):**\n`
        analysis += `- Time Range: ${crvp.timeRange || 'weekly'}\n`
        analysis += `- Composite POC: $${crvp.compositePoc.toFixed(2)}\n`
        analysis += `- Composite VAH: $${crvp.compositeVah.toFixed(2)}\n`
        analysis += `- Composite VAL: $${crvp.compositeVal.toFixed(2)}\n`
        if (crvp.accumulationZone) {
          const accZone = crvp.accumulationZone
          const isInAccZone = price >= accZone.priceRange[0] && price <= accZone.priceRange[1]
          analysis += `- Accumulation Zone: $${accZone.priceRange[0].toFixed(2)} - $${accZone.priceRange[1].toFixed(2)} (Volume Ratio: ${(accZone.volumeRatio * 100).toFixed(0)}% - Bullish) ${isInAccZone ? '⚠️ PRICE IN ZONE' : ''}\n`
        }
        if (crvp.distributionZone) {
          const distZone = crvp.distributionZone
          const isInDistZone = price >= distZone.priceRange[0] && price <= distZone.priceRange[1]
          analysis += `- Distribution Zone: $${distZone.priceRange[0].toFixed(2)} - $${distZone.priceRange[1].toFixed(2)} (Volume Ratio: ${(distZone.volumeRatio * 100).toFixed(0)}% - Bearish) ${isInDistZone ? '⚠️ PRICE IN ZONE' : ''}\n`
        }
        if (crvp.balanceZones && crvp.balanceZones.length > 0) {
          analysis += `- Balance Zones: ${crvp.balanceZones.slice(0, 3).map(b => `$${b.priceRange[0].toFixed(2)}-$${b.priceRange[1].toFixed(2)}`).join(', ')} (areas of consolidation)\n`
          // Check if price is in any balance zone
          const priceInBalanceZone = crvp.balanceZones.some(b => price >= b.priceRange[0] && price <= b.priceRange[1])
          if (priceInBalanceZone) {
            analysis += `- ⚠️ Price in balance zone (consolidation area - potential breakout)\n`
          }
        }
        // Show relationship between current price and composite POC
        if (crvp.compositePoc && price > 0) {
          const priceToCompositePoc = ((price - crvp.compositePoc) / crvp.compositePoc) * 100
          analysis += `- Price vs Composite POC: ${priceToCompositePoc >= 0 ? '+' : ''}${priceToCompositePoc.toFixed(2)}% ${priceToCompositePoc > 0 ? '(above POC)' : priceToCompositePoc < 0 ? '(below POC)' : '(at POC)'}\n`
        }
      }
      
      // COC (Change of Character) - Market structure and reversal signals
      if (ext.marketStructure && ext.marketStructure.coc && price > 0) {
        const coc = ext.marketStructure.coc
        analysis += `\n**Market Structure (COC):**\n`
        analysis += `- Structure: ${coc.structure.toUpperCase()} (Strength: ${coc.structureStrength.toFixed(0)}/100)\n`
        if (coc.coc !== 'none') {
          analysis += `- Change of Character: ${coc.coc.toUpperCase()} ${coc.reversalSignal ? '✅ CONFIRMED' : '(forming)'}\n`
          if (coc.coc === 'bullish') {
            analysis += `  → Bullish COC: LL → LH → breaks to HH (trend reversal to uptrend)\n`
            analysis += `  → Interpretation: Market structure shifting from bearish to bullish\n`
          } else if (coc.coc === 'bearish') {
            analysis += `  → Bearish COC: HH → HL → breaks to LL (trend reversal to downtrend)\n`
            analysis += `  → Interpretation: Market structure shifting from bullish to bearish\n`
          }
        } else {
          analysis += `- Change of Character: NONE (no structure change detected)\n`
        }
        if (coc.lastSwingHigh) {
          const distanceToSwingHigh = ((price - coc.lastSwingHigh) / coc.lastSwingHigh) * 100
          analysis += `- Last Swing High: $${coc.lastSwingHigh.toFixed(2)} (Price ${distanceToSwingHigh >= 0 ? 'above' : 'below'} by ${Math.abs(distanceToSwingHigh).toFixed(2)}%)\n`
        }
        if (coc.lastSwingLow) {
          const distanceToSwingLow = ((price - coc.lastSwingLow) / coc.lastSwingLow) * 100
          analysis += `- Last Swing Low: $${coc.lastSwingLow.toFixed(2)} (Price ${distanceToSwingLow >= 0 ? 'above' : 'below'} by ${Math.abs(distanceToSwingLow).toFixed(2)}%)\n`
        }
        if (coc.reversalSignal) {
          analysis += `- ⚠️ REVERSAL SIGNAL: Market structure change detected - potential trend reversal\n`
        }
        if (coc.swingHighs && coc.swingHighs.length > 0) {
          analysis += `- Recent Swing Highs: ${coc.swingHighs.slice(-3).map(sh => `$${sh.price.toFixed(2)}`).join(', ')}\n`
        }
        if (coc.swingLows && coc.swingLows.length > 0) {
          analysis += `- Recent Swing Lows: ${coc.swingLows.slice(-3).map(sl => `$${sl.price.toFixed(2)}`).join(', ')}\n`
        }
      }
      
      // CVD (Cumulative Volume Delta) - Buy/sell pressure and divergences
      if (ext.volumeDelta && price > 0) {
        const cvd = ext.volumeDelta
        analysis += `\n**Cumulative Volume Delta (CVD):**\n`
        analysis += `- CVD Buyer: ${cvd.cvdBuyer.toLocaleString()} (cumulative buy volume)\n`
        analysis += `- CVD Seller: ${cvd.cvdSeller.toLocaleString()} (cumulative sell volume)\n`
        analysis += `- CVD Delta: ${cvd.cvdDelta.toLocaleString()} ${cvd.cvdDelta > 0 ? '(Bullish - buyers dominant)' : cvd.cvdDelta < 0 ? '(Bearish - sellers dominant)' : '(Neutral)'}\n`
        analysis += `- CVD Trend: ${cvd.cvdTrend.toUpperCase()} ${cvd.cvdTrend === 'rising' ? '(Bullish - buyers more aggressive)' : cvd.cvdTrend === 'falling' ? '(Bearish - sellers more aggressive)' : '(Neutral)'}\n`
        if (cvd.divergence !== 'none') {
          analysis += `- ⚠️ DIVERGENCE DETECTED: ${cvd.divergence.toUpperCase()} ${cvd.divergence === 'bullish' ? '(Price down but CVD up - hidden buying pressure, bullish signal)' : '(Price up but CVD down - hidden selling pressure, bearish signal)'}\n`
        } else {
          analysis += `- Divergence: NONE (price and CVD moving in same direction)\n`
        }
        analysis += `- CVD Strength: ${cvd.strength.toFixed(0)}/100 ${cvd.strength > 70 ? '(Strong signal)' : cvd.strength > 40 ? '(Moderate signal)' : '(Weak signal)'}\n`
        // Show recent CVD history trend
        if (cvd.cvdHistory && cvd.cvdHistory.length >= 10) {
          const recentCVD = cvd.cvdHistory.slice(-10)
          const olderCVD = cvd.cvdHistory.length >= 20 ? cvd.cvdHistory.slice(-20, -10) : cvd.cvdHistory.slice(0, 10)
          const recentAvg = recentCVD.reduce((sum, v) => sum + v.cvdDelta, 0) / recentCVD.length
          const olderAvg = olderCVD.reduce((sum, v) => sum + v.cvdDelta, 0) / olderCVD.length
          const cvdChange = olderAvg !== 0 ? ((recentAvg - olderAvg) / Math.abs(olderAvg)) * 100 : 0
          if (Math.abs(cvdChange) > 5) {
            analysis += `- CVD Change: ${cvdChange >= 0 ? '+' : ''}${cvdChange.toFixed(2)}% (${cvdChange > 0 ? 'increasing buying pressure' : 'increasing selling pressure'})\n`
          }
        }
      }
      
      // Blockchain data (whale activity, exchange flows)
      if (ext.blockchain) {
        const bc = ext.blockchain
        if (bc.largeTransactions && bc.largeTransactions.length > 0) {
          analysis += `- Large Transactions: ${bc.largeTransactions.length} recent (>$1M)\n`
        }
        if (bc.estimatedExchangeFlow !== undefined && bc.estimatedExchangeFlow !== 0) {
          const flowDirection = bc.estimatedExchangeFlow < 0 ? 'Outflow (Bullish)' : 'Inflow (Bearish)'
          analysis += `- Exchange Flow: $${Math.abs(bc.estimatedExchangeFlow).toLocaleString()} ${flowDirection}\n`
        }
        if (bc.whaleActivityScore !== undefined && bc.whaleActivityScore !== 0) {
          const whaleSentiment = bc.whaleActivityScore > 0 ? 'Bullish' : 'Bearish'
          analysis += `- Whale Activity: ${(Math.abs(bc.whaleActivityScore) * 100).toFixed(0)}% ${whaleSentiment}\n`
        }
      }
      
      // Enhanced metrics
      if (ext.enhanced) {
        const enh = ext.enhanced
        analysis += `- Volume Trend: ${enh.volumeTrend || 'N/A'}\n`
        analysis += `- Volatility Pattern: ${enh.volatilityPattern || 'N/A'}\n`
        if (enh.volumePriceDivergence !== undefined && enh.volumePriceDivergence !== 0) {
          const divType = enh.volumePriceDivergence > 0 ? 'Bearish' : 'Bullish'
          analysis += `- Volume-Price Divergence: ${divType}\n`
        }
      }
    }
    
    technicalAnalysisSummary.push(analysis)
  }
  
  // System prompt dengan format JSON yang jelas sesuai ZAI structured output
  // Build active positions summary
  const activePositionsSummary = []
  if (positions.size > 0) {
    activePositionsSummary.push('\n**ACTIVE POSITIONS:**')
    for (const [asset, pos] of positions) {
      const marketDataForAsset = marketData instanceof Map ? marketData.get(asset) : marketData[asset]
      const currentPrice = marketDataForAsset?.price || pos.currentPrice || 0
      const pnl = pos.entryPrice > 0 
        ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'LONG' ? 1 : -1)
        : 0
      activePositionsSummary.push(`- ${asset}: ${pos.side} ${Math.abs(pos.quantity)} @ $${pos.entryPrice.toFixed(2)} | Current: $${currentPrice.toFixed(2)} | PnL: ${pnl.toFixed(2)}% | Leverage: ${pos.leverage}x`)
    }
    activePositionsSummary.push('')
  } else {
    activePositionsSummary.push('\n**NO ACTIVE POSITIONS** - All positions are closed or no trades have been opened yet.\n')
  }

  const systemPrompt = `You are an AI trading agent managing a CONTINUOUS trading session on Hyperliquid perpetual futures exchange.

**CRITICAL RULES FOR POSITION MANAGEMENT:**
1. **CONTINUOUS TRADING**: You are managing existing positions and making decisions to continue, modify, or close them
2. **ACTIVE POSITIONS**: If an asset has an active position, you MUST decide:
   - **HOLD**: Keep the position open (continue holding)
   - **CLOSE** or **CLOSE_ALL**: Close the entire position (take profit or stop loss)
   - **REDUCE**: Close part of the position (partial exit, reduce size)
   - **ADD**: Increase position size (add to existing position)
   - **REVERSE**: Close current position and open opposite side (LONG → SHORT or SHORT → LONG)
3. **NO ACTIVE POSITION**: If an asset has NO active position, you MUST decide:
   - **BUY_TO_ENTER**: Open new LONG position (if bullish signals or mixed signals leaning bullish)
   - **SELL_TO_ENTER**: Open new SHORT position (if bearish signals or mixed signals leaning bearish)
   - **DO NOT GENERATE HOLD** if there is no active position - you MUST choose either BUY_TO_ENTER or SELL_TO_ENTER based on the stronger signal, even if signals are mixed
4. **POSITION CONTINUITY**: Always consider existing positions when making decisions
5. **TECHNICAL ANALYSIS**: Use RSI, MACD, EMA, Bollinger Bands, ATR, ADX, OBV, VWAP, Stochastic, CCI, Williams %R, Parabolic SAR, Aroon to make informed decisions about continuing or closing positions
6. **MULTI-TIMEFRAME ANALYSIS**: 
   - Daily timeframe: Main trend direction (use EMA20/EMA50 crossovers)
   - 4H timeframe: Entry setup confirmation
   - 1H timeframe: Execution timing
   - **SCALPING MODE**: Always generate BUY_TO_ENTER or SELL_TO_ENTER signals (never HOLD unless active position exists)
   - Prefer BUY_TO_ENTER if daily trend is uptrend OR if bullish indicators outweigh bearish
   - Prefer SELL_TO_ENTER if daily trend is downtrend OR if bearish indicators outweigh bullish
   - If daily trend is neutral, use indicator majority to decide (bullish indicators → BUY, bearish indicators → SELL)
7. **BOLLINGER BANDS INTERPRETATION**: 
   - If price > BB Upper: Price is ABOVE upper band (overbought - VERY BULLISH, do NOT short here!)
   - If price < BB Lower: Price is BELOW lower band (oversold - VERY BEARISH, do NOT buy here!)
   - If price between BB Middle and Upper: Price is above middle (BULLISH - good for BUY, bad for SELL)
   - If price between BB Lower and Middle: Price is below middle (BEARISH - good for SELL, bad for BUY)
   - ALWAYS verify price position relative to BB bands before making claims
8. **INDICATOR CONSISTENCY CHECK (CRITICAL)**:
   Before generating a signal, count BULLISH vs BEARISH indicators:
   - **BULLISH indicators**: MACD histogram > 0, OBV > 0, Price > BB middle, Parabolic SAR bullish (price > SAR), Aroon Up > Down, CCI > 100, Price > VWAP, 24h change > 0, RSI divergence bullish
   - **BEARISH indicators**: MACD histogram < 0, OBV < 0, Price < BB middle, Parabolic SAR bearish (price < SAR), Aroon Down > Up, CCI < -100, Price < VWAP, 24h change < 0, RSI divergence bearish
   - **RULE**: If generating BUY_TO_ENTER, you MUST have MORE bullish indicators than bearish indicators
   - **RULE**: If generating SELL_TO_ENTER, you MUST have MORE bearish indicators than bullish indicators
   - **RULE**: If indicators are MIXED, use the majority (if 60%+ bullish → BUY, if 60%+ bearish → SELL, otherwise use strongest indicator)
   - **SCALPING MODE**: Always generate a signal (BUY or SELL) - never use HOLD unless you have an active position
   - **RULE**: NEVER generate BUY when MACD histogram is strongly positive (>50) but signal is SELL
   - **RULE**: NEVER generate SELL when MACD histogram is strongly positive (>50) but signal is BUY
   - **RULE**: NEVER generate BUY when price is ABOVE BB upper (overbought)
   - **RULE**: NEVER generate SELL when price is BELOW BB lower (oversold)
   - **RULE**: NEVER generate SELL when OBV is strongly positive (buying pressure)
   - **RULE**: NEVER generate BUY when OBV is strongly negative (selling pressure)
   - **RULE**: NEVER generate SELL when Parabolic SAR is bullish (SAR below price)
   - **RULE**: NEVER generate BUY when Parabolic SAR is bearish (SAR above price)
   - **CRITICAL JUSTIFICATION CONSISTENCY**: The justification text MUST match the signal direction:
     * If signal is BUY_TO_ENTER → justification must use bullish language ("entering long", "bullish indicators", "buying pressure", "uptrend")
     * If signal is SELL_TO_ENTER → justification must use bearish language ("entering short", "bearish indicators", "selling pressure", "downtrend")
     * NEVER write "entering long" or "bullish" in justification when signal is SELL_TO_ENTER
     * NEVER write "entering short" or "bearish" in justification when signal is BUY_TO_ENTER
     * The justification should explain WHY you chose that signal direction based on the indicator analysis
9. **TREND-FIRST PRINCIPLE (SMART FLIP v2)**:
   - **TREND FIRST, COUNTER SECOND**: In strong trends, prefer signals that align with the trend direction
   - **Strong Downtrend (Trend Strength < -0.5)**: Prefer SELL_TO_ENTER signals. Only flip to BUY if reversal indicators are VERY strong (multiple confirmations, high momentum, clear divergence)
   - **Strong Uptrend (Trend Strength > 0.5)**: Prefer BUY_TO_ENTER signals. Only flip to SELL if reversal indicators are VERY strong (multiple confirmations, high momentum, clear divergence)
   - **Counter-Trend Penalty**: Counter-trend signals (BUY in downtrend, SELL in uptrend) have reduced confidence (-10 points) and require stronger confirmation
   - **Momentum Requirement**: Counter-trend flips require momentum strength ≥ 40% to prevent false reversals from weak 1-2 candle moves
   - **Bearish Regime Bias**: In bearish markets, price below BB middle is NEUTRAL (not bullish). OBV must be significantly positive (>3% vs 24h average) to be considered bullish
   - **Confidence Threshold**: Counter-trend signals in bearish regime require confidence ≥ 65% to prevent false flips
10. **DIRECTIONAL BIAS WEIGHTING**:
   - When Trend Strength Index < -0.5 (strong downtrend), BUY signals have reduced confidence (-10 points penalty)
   - When Trend Strength Index > 0.5 (strong uptrend), SELL signals have reduced confidence (-10 points penalty)
   - This ensures that even if indicators slightly favor a direction, the overall market structure (trend) is respected
11. **BOUNCE SIGNAL DETECTION**:
   - **BUY_BOUNCE**: Price previously below BB Lower, now closed above BB Lower + RSI < 40 + Stochastic K > D (rebound from oversold)
   - **SELL_BOUNCE**: Price previously above BB Upper, now closed below BB Upper + RSI > 60 + Stochastic K < D (pullback from overbought)
   - Bounce signals require minimum 2 of 5 confirmations: RSI oversold/overbought, Stochastic crossover, Volume > average, ATR > 1.5% of price, Candle body > 0.5 × ATR
   - Bounce signals get confidence boost (+15%) and specialized TP calculation (more aggressive targets)
   - **Bounce Persistence**: Bounce must move price ≥0.5% in expected direction within 3 candles, otherwise confidence reduced by 50%
   - **EMA Reclaim Check**: BUY bounce valid if price reclaims EMA20 (1H) or 4H EMA8. SELL bounce valid if price fails to reclaim EMA20. Failed EMA reclaim reduces confidence by 15%
   - **Second Attempt Bounce**: If persistence failed but EMA reclaimed within <6 candles, boost confidence by 10-15% (more reliable than first attempt)
   - **Bounce Decay Timer**: After 12-24 candles (depending on timeframe), confidence decreases 2% per candle (max 50% decay) to prevent stale bounce signals
   - **Counter-Trend Bounce**: Bounce against daily trend gets TP reduced by 25% and confidence penalty of 5%
12. **ADAPTIVE EXIT TIMING (Bounce Management)**:
   - **Bounce Weakening Detection**: Monitor bounce signals for exit signals
   - **BUY Bounce Exit**: If price rose >3% from entry then closed below EMA8 → trim 50% position (secure profit)
   - **SELL Bounce Exit**: If price fell >3% from entry then closed above EMA8 → trim 50% position (secure profit)
   - Exit signals indicate bounce is weakening - take partial profit without waiting for full TP
13. **DYNAMIC TP TRAIL (Bounce Signals)**:
   - **BUY Bounce TP Trail**: TP = min(bounceTP, price_at_EMA8_crossdown). If price crosses below EMA8, use current price as trailing TP (faster exit)
   - **SELL Bounce TP Trail**: TP = price_at_EMA8_crossup. If price crosses above EMA8, use current price as trailing TP (pullback failed, exit faster)
   - Trailing TP based on actual momentum (EMA8 cross) rather than fixed percentage
14. **NO-TRADE ZONE (Exhaustion Protection)**:
   - **Avoid entries at exhaustion points**: 
     * Price < BB Lower + 0.2% → No SELL entry (oversold exhaustion)
     * Price > BB Upper + 0.2% → No BUY entry (overbought exhaustion)
     * RSI(7) < 40 + MACD Hist > 0 → No SELL entry (momentum exhaustion)
     * RSI(7) > 60 + MACD Hist < 0 → No BUY entry (momentum exhaustion)
   - If no-trade zone detected, signal converted to HOLD (wait for better entry)
15. **MOMENTUM CONTRADICTION CHECK**:
   - If MACD histogram contradicts signal direction, reduce confidence by 15-20%
   - Strong contradiction (>30 histogram vs signal) → higher penalty
   - This prevents entries when momentum is clearly against the signal
16. **ATR VOLATILITY FILTER**:
   - If ATR < 1.5% of price OR (ATR < 2000 AND ATR < 2.0% of price) → reduce confidence by 10%
   - Low volatility = higher whipsaw risk, especially for bounce signals
17. **EMA8 INDICATOR**:
   - EMA8 is now available in indicators (fast-moving average for intraday momentum)
   - Used for bounce exit monitoring and dynamic TP trailing
   - Price above EMA8 = bullish momentum, below = bearish momentum
18. **PROFIT PROTECTION**: If position is in profit, consider taking partial profit (REDUCE) or closing (CLOSE)
19. **LOSS MANAGEMENT**: If position is in loss and conditions worsen, consider closing (CLOSE) to limit losses
${activePositionsSummary.join('\n')}

**Technical Analysis Data:**
${technicalAnalysisSummary.join('\n\n')}

**Constraints:**
- Leverage Range: 1x - 10x
- Max Position Size: 20% of capital
- Allowed Assets: ${allowedAssets.map(asset => `${asset}-USDC`).join(', ')}
- **Use Technical Indicators**: RSI, MACD, EMA crossovers (EMA8, EMA20, EMA50, EMA200), Bollinger Bands, ATR (for volatility), ADX (for trend strength), OBV/VWAP (for volume), Stochastic/CCI/Williams %R (for momentum), Parabolic SAR (for trend following), Aroon (for trend strength), Support/Resistance levels
- **EMA8**: Fast-moving average (8-period) for intraday momentum and bounce exit monitoring
- **ATR-Based Stop Loss**: Use ATR(14) * 1.5-2.0 for dynamic stop loss distance (already calculated in signal)
- **Volume Confirmation**: Require volume confirmation for breakouts (OBV trend should align with price trend)

**FUTURES TRADING INDICATORS (NEW):**
- **COB (Current Order Book)**: Order book depth analysis
  * Bid/Ask Imbalance: Positive (more bids) = bullish, Negative (more asks) = bearish
  * Support Zones: Large bids below price = strong buying interest (bullish for longs)
  * Resistance Zones: Large asks above price = strong selling interest (bearish for shorts)
  * Liquidity Score: Higher score = more liquidity (tighter spread, better depth)
  * Use COB to identify immediate support/resistance and order book imbalance
  
- **SVP (Session Volume Profile)**: Session volume distribution analysis
  * POC (Point of Control): Price level with highest volume = strongest support/resistance
  * VAH (Value Area High) & VAL (Value Area Low): 70% value area boundaries
  * HVN (High Volume Nodes): Strong support/resistance zones
  * LVN (Low Volume Nodes): Low activity zones = potential breakout areas
  * Price at POC = strong support/resistance level
  * Price within value area (VAL-VAH) = normal trading range
  * Price outside value area = potential reversal or continuation
  
- **CRVP (Composite Range Volume Profile)**: Long-term volume profile analysis
  * Composite POC: Long-term price level with highest volume
  * Accumulation Zone: High volume at lower prices = bullish (smart money accumulating)
  * Distribution Zone: High volume at higher prices = bearish (smart money distributing)
  * Balance Zones: Areas of consolidation where price spent significant time
  * Price in accumulation zone = bullish signal (buying opportunity)
  * Price in distribution zone = bearish signal (selling opportunity)
  
- **COC (Change of Character)**: Market structure analysis
  * Bullish COC: LL → LH → breaks to HH (trend reversal to uptrend)
  * Bearish COC: HH → HL → breaks to LL (trend reversal to downtrend)
  * Structure Strength: Higher score = stronger market structure
  * Reversal Signal: Confirmed COC = strong trend reversal signal
  * Use COC to identify potential trend reversals and market structure changes
  
- **CVD (Cumulative Volume Delta)**: Buy/sell pressure analysis
  * CVD Delta: Positive (buyers dominant) = bullish, Negative (sellers dominant) = bearish
  * CVD Trend: Rising = bullish (buyers more aggressive), Falling = bearish (sellers more aggressive)
  * Divergence: Price vs CVD moving in opposite directions
    - Bullish divergence: Price down but CVD up = hidden buying pressure (bullish signal)
    - Bearish divergence: Price up but CVD down = hidden selling pressure (bearish signal)
  * CVD Strength: Higher score = stronger signal
  * Use CVD to identify hidden buying/selling pressure and divergences

**CRITICAL OUTPUT FORMAT:**
You MUST return ONLY a valid JSON object. Do NOT include any text before or after the JSON. Do NOT include markdown code blocks. Return ONLY the JSON object.

The JSON MUST have this exact structure with a "signals" array containing one object per asset in the SAME ORDER as provided assets.

JSON Structure (MUST follow this exact format - return ONLY this JSON, nothing else):
{
  "signals": [
    {
      "coin": "BTC",
      "signal": "buy_to_enter",
      "entry_price": 50000,
      "quantity": 0.1,
      "leverage": 3,
      "profit_target": 51000,
      "stop_loss": 49000,
      "invalidation_condition": "4H RSI breaks back below 40, signaling momentum failure OR Price breaks below $48500 (support level) OR MACD histogram turns negative OR volume drops below 50% of average within 24h",
      "justification": "RSI at 35 (oversold, bullish reversal potential), MACD histogram at -15 (bearish but improving from -30), price at $48500 (below BB lower band, oversold), EMA20 at $49000 (price below, but approaching), volume increased 30% in last 10 periods (bullish confirmation), daily trend is uptrend with 4H and 1H aligned (trend alignment 80%), funding rate at -0.001% (negative, bullish), support level at $48000 (Fibonacci 38.2%), ATR at 2.5% (normal volatility), ADX at 25 (trending market). Risk factors: High volatility expected near support, but strong trend alignment supports entry.",
      "confidence": 0.75,
      "risk_usd": 50
    },
    {
      "coin": "ETH",
      "signal": "hold",
      "entry_price": 0,
      "quantity": 0,
      "leverage": 1,
      "profit_target": 0,
      "stop_loss": 0,
      "invalidation_condition": "4H RSI breaks back above 60, signaling momentum failure OR Price breaks above $52000 (resistance) OR MACD histogram turns positive OR volume drops below 30% of average within 12h",
      "justification": "Mixed signals: RSI at 55 (neutral), MACD histogram at 5 (slightly bullish), price at $50000 (between BB middle and upper), EMA20 at $49800 (price above, bullish), but daily trend is neutral (no clear direction), volume decreased 10% (bearish divergence), funding rate at 0.001% (positive, bearish), resistance level at $51000. Waiting for clearer trend confirmation before entering. Confidence low (50%) due to mixed signals.",
      "confidence": 0.5,
      "risk_usd": 0
    },
    {
      "coin": "BTC",
      "signal": "close_all",
      "entry_price": 0,
      "quantity": 0,
      "leverage": 1,
      "profit_target": 0,
      "stop_loss": 0,
      "invalidation_condition": "N/A - Position being closed",
      "justification": "Closing all positions: Profit target reached at $51000 (entry was $48500, +5.15% profit), RSI at 68 (approaching overbought), MACD histogram at 25 (strong bullish but may reverse), price at $51000 (above BB upper band, overbought), volume decreased 20% (bearish divergence), daily trend still uptrend but 1H timeframe showing reversal signals. Taking profit to lock in gains before potential reversal.",
      "confidence": 0.8,
      "risk_usd": 0
    },
    {
      "coin": "SOL",
      "signal": "reduce",
      "entry_price": 0,
      "quantity": 0.5,
      "leverage": 1,
      "profit_target": 0,
      "stop_loss": 0,
      "invalidation_condition": "4H RSI breaks back below 40 OR Price breaks below $48000 (support) OR MACD histogram turns negative OR volume drops below 40% of average within 24h",
      "justification": "Taking partial profit (50%): Position in profit at $49000 (entry was $47000, +4.26% profit), RSI at 65 (approaching overbought), MACD histogram at 20 (bullish but may peak), price at $49000 (above BB middle, bullish but near upper band), volume increased 15% (bullish confirmation), daily trend is uptrend with 4H aligned (trend alignment 70%), but 1H showing potential reversal signals. Reducing position size to lock in profits while keeping 50% for potential further upside. Remaining position will be closed if price breaks below $48000 or RSI crosses above 75.",
      "confidence": 0.7,
      "risk_usd": 0
    }
  ]
}

Field requirements:
- coin: Asset symbol (string, required)
- signal: "buy_to_enter" | "sell_to_enter" | "hold" | "close" | "close_all" | "reduce" | "add" (string, required)
  * "buy_to_enter": Open new LONG position (only if NO active position)
  * "sell_to_enter": Open new SHORT position (only if NO active position)
   * "hold": Keep existing position open (ONLY if active position exists - DO NOT use HOLD if no position)
  * "close" or "close_all": Close entire position (take profit or stop loss)
  * "reduce": Close part of position (partial exit, specify quantity to close)
  * "add": Add to existing position (increase size, same direction)
- entry_price: Current market price (number, REQUIRED for BUY/SELL/ADD signals, set to 0 for HOLD/CLOSE/REDUCE)
- quantity: Position size to open/add OR quantity to close for REDUCE (number, required)
  * For BUY/SELL: New position size
  * For ADD: Additional quantity to add
  * For REDUCE: Quantity to close (must be less than current position size)
  * For CLOSE/CLOSE_ALL: Set to 0 (will close all)
  * For HOLD: Set to 0
- leverage: Leverage multiplier (number, required, 1-10)
- profit_target: Target price (number, required, 0 for hold/close/reduce)
- stop_loss: Stop loss price (number, required, 0 for hold/close/reduce)
- invalidation_condition: Condition to invalidate trade (string, REQUIRED - CRITICAL FIELD) - MUST include:
  * **CRITICAL**: This field is as important as justification - Alpha Arena research shows invalidation_condition improves performance when used properly
  * **Purpose**: Pre-registered signals that void a plan when triggered - these are exit conditions that invalidate the trade setup
  * **Alpha Arena-style format** (examples that work well):
    - "4H RSI breaks back below 40, signaling momentum failure"
    - "BTC breaks below 105,000, confirming deeper market correction"
    - "4H MACD turns negative OR 4H RSI breaks below 55"
    - "Price breaks below $48500 (support level) OR MACD histogram turns negative OR volume drops below 50% of average within 24h"
  * **Required components**:
    - Price levels (e.g., "Price breaks below $48500" or "Price breaks above $52000") - use specific support/resistance levels
    - Multi-timeframe indicator reversals (e.g., "4H RSI breaks back below 40" or "4H MACD turns negative")
    - Volume conditions (e.g., "Volume drops below 50% of average within 24h" or "Volume spikes above 150% within 12h")
    - Related asset conditions (e.g., "BTC breaks below 105,000" for other assets)
    - Multiple conditions separated by "OR" (e.g., "Condition1 OR Condition2 OR Condition3")
  * **Format requirements**:
    - Use specific price levels with dollar signs (e.g., "$48500" not "48500")
    - Include timeframes when referencing indicators (e.g., "4H RSI", "1H MACD")
    - Use "OR" to separate multiple conditions (not commas)
    - Be specific with indicator values and thresholds
    - Reference support/resistance levels when available
  * **BE SPECIFIC** - include exact price levels, indicator values, timeframes, and conditions
  * **DO NOT use generic phrases** like "if price moves against" or "if trend reverses" - be specific
- justification: Reason for signal (string, required) - MUST be detailed and include:
  * **CRITICAL**: The justification MUST match the signal direction (BUY_TO_ENTER → bullish reasoning, SELL_TO_ENTER → bearish reasoning)
  * **CRITICAL**: If signal is BUY_TO_ENTER, justification must explain WHY bullish (e.g., "entering long", "bullish indicators", "buying pressure")
  * **CRITICAL**: If signal is SELL_TO_ENTER, justification must explain WHY bearish (e.g., "entering short", "bearish indicators", "selling pressure")
  * **WRONG EXAMPLE**: Signal: SELL_TO_ENTER, Justification: "entering long on momentum confirmation" ❌ (MISMATCH - SELL signal but bullish justification)
  * **CORRECT EXAMPLE**: Signal: SELL_TO_ENTER, Justification: "Bearish indicators (5) outweigh bullish (3), MACD histogram negative, price below BB middle, entering short" ✅
  * Specific indicator values (e.g., "RSI at 35 (oversold), MACD histogram at -25 (bearish but improving), price at $48500 (below BB lower)")
  * Trend alignment (e.g., "Daily trend is uptrend, 4H and 1H timeframes aligned")
  * Volume confirmation (e.g., "Volume increased 25% in last 10 periods, OBV trending up")
  * Support/Resistance levels (e.g., "Price near support at $48000, Fibonacci 38.2% level at $48200")
  * External factors (e.g., "Funding rate at -0.001% (negative, bullish), OI trending up, Premium to oracle -0.05% (undervalued)")
  * Futures trading indicators (e.g., "COB imbalance +2% (bullish - more bids), Price at POC $48500 (strong support), Accumulation zone detected (bullish), Bullish COC confirmed (trend reversal), CVD divergence bullish (hidden buying pressure)")
  * Risk factors (e.g., "High volatility (ATR 3.5%), but strong trend alignment (80%)")
  * Market regime (e.g., "Trending market (ADX 28), normal volatility")
  * BE SPECIFIC - mention actual values, not just "strong trend" or "bullish signals"
  * **INCLUDE FUTURES INDICATORS**: Always mention COB, SVP, CRVP, COC, and CVD data if available in your justification
- confidence: Confidence level 0-1 (number, required)
- risk_usd: USD risk amount (number, required)

**POSITION MANAGEMENT LOGIC:**
1. **If asset has ACTIVE POSITION:**
   - Check current PnL and market conditions
   - HOLD: Continue holding if conditions are favorable
   - CLOSE/CLOSE_ALL: Close if profit target reached, stop loss hit, or conditions reversed
   - REDUCE: Take partial profit if position is profitable and showing reversal signals
   - ADD: Add to position if trend is strengthening and position is profitable
   - REVERSE: Close current and open opposite if trend completely reversed

2. **If asset has NO ACTIVE POSITION:**
   - BUY_TO_ENTER: Open LONG if bullish signals or mixed signals leaning bullish
   - SELL_TO_ENTER: Open SHORT if bearish signals or mixed signals leaning bearish
   - **DO NOT GENERATE HOLD** - you MUST choose either BUY_TO_ENTER or SELL_TO_ENTER based on the stronger signal, even if signals are mixed or unclear

3. **Entry Price:**
   - For BUY/SELL/ADD: Use current market price as entry_price
   - For HOLD/CLOSE/REDUCE: Set entry_price to 0 (not entering new position)

**CRITICAL JSON FORMATTING RULES:**
1. Return ONLY valid JSON - no markdown, no code blocks, no explanations
2. The JSON must start with { and end with }
3. The "signals" array must contain objects with ALL required fields
4. All numeric values must be valid numbers (not strings, not null, not undefined)
5. All string values must be valid strings (not null, not undefined)
6. Do NOT include any text outside the JSON object
7. Do NOT repeat fields or create invalid JSON structures

**IMPORTANT**: 
- Always check if asset has active position before deciding signal type
- HOLD means "continue holding existing position" - ONLY use HOLD if active position exists
- If an asset has no technical indicators available, you can still generate a signal but use lower confidence (0.3-0.5) and explain in justification that technical data is limited
- If NO active position exists, you MUST generate either BUY_TO_ENTER or SELL_TO_ENTER - DO NOT use HOLD
- CLOSE/CLOSE_ALL closes entire position regardless of size
- REDUCE closes only part of position (specify quantity to close)
- ADD increases position size in same direction (LONG + ADD = bigger LONG, SHORT + ADD = bigger SHORT)

Return ONLY valid JSON object, no markdown, no extra text, no code blocks.`

  let userPrompt = `Current market data and account information:

**CURRENT MARKET STATE FOR ALL COINS**

`
  
  // Handle both Map and Object iteration
  const marketDataEntries = marketData instanceof Map 
    ? Array.from(marketData.entries())
    : Object.entries(marketData || {})
  
  for (const [asset, data] of marketDataEntries) {
    if (!data || !allowedAssets.includes(asset)) continue
    
    const currentPrice = data.price || 0
    const position = positions.get(asset)
    
    userPrompt += `**${asset}**
- Current Price: ${formatPrice(currentPrice, asset)}`
    
    // Show active position status
    if (position) {
      const pnlPercent = position.entryPrice > 0 
        ? (((currentPrice - position.entryPrice) / position.entryPrice) * 100 * (position.side === 'LONG' ? 1 : -1)).toFixed(2)
        : '0.00'
      const pnlUsd = position.unrealizedPnl || 0
      userPrompt += `
- **ACTIVE POSITION**: ${position.side} ${Math.abs(position.quantity)} @ $${position.entryPrice.toFixed(2)}
  → Entry Time: ${new Date(position.entryTime).toLocaleString()}
  → Current PnL: ${pnlPercent}% ($${pnlUsd.toFixed(2)})
  → Leverage: ${position.leverage}x
  → **DECISION REQUIRED**: HOLD (keep), CLOSE_ALL (close all), REDUCE (close part), or ADD (increase size)`
    } else {
      userPrompt += `
- **NO ACTIVE POSITION**: Available to open new position
  → **DECISION REQUIRED**: BUY_TO_ENTER (long) or SELL_TO_ENTER (short) - DO NOT use HOLD if no position exists`
    }
    
    userPrompt += `
- Volume 24h: ${data.volume24h?.toLocaleString() || '0'}`
    
    if (data.indicators) {
      const ind = data.indicators
      
      // Validate Bollinger Bands position
      // CRITICAL: Use ind.price (price from historical data) for consistency with BB calculation
      let bbPositionText = 'N/A'
      if (ind.bollingerBands) {
        const price = ind.price || 0 // Use indicators.price, not currentPrice
        const bbUpper = ind.bollingerBands.upper
        const bbLower = ind.bollingerBands.lower
        const bbMiddle = ind.bollingerBands.middle
        
        if (price > 0) {
          if (price > bbUpper) {
            bbPositionText = `Price $${price.toFixed(2)} is ABOVE upper band $${bbUpper.toFixed(2)} (Overbought)`
          } else if (price < bbLower) {
            bbPositionText = `Price $${price.toFixed(2)} is BELOW lower band $${bbLower.toFixed(2)} (Oversold)`
          } else if (price > bbMiddle) {
            bbPositionText = `Price $${price.toFixed(2)} is above middle $${bbMiddle.toFixed(2)} (Bullish)`
          } else {
            bbPositionText = `Price $${price.toFixed(2)} is below middle $${bbMiddle.toFixed(2)} (Bearish)`
          }
        }
      }
      
      // Calculate indicator summary (bullish vs bearish)
      let bullishCount = 0
      let bearishCount = 0
      const bullishIndicators = []
      const bearishIndicators = []
      
      const price = ind.price || currentPrice
      
      // MACD Histogram
      if (ind.macd && ind.macd.histogram) {
        if (ind.macd.histogram > 0) {
          bullishCount++
          bullishIndicators.push(`MACD Histogram: +${ind.macd.histogram.toFixed(2)}`)
        } else {
          bearishCount++
          bearishIndicators.push(`MACD Histogram: ${ind.macd.histogram.toFixed(2)}`)
        }
      }
      
      // OBV
      if (ind.obv !== null && ind.obv !== undefined) {
        if (ind.obv > 0) {
          bullishCount++
          bullishIndicators.push(`OBV: +${ind.obv.toFixed(2)}`)
        } else {
          bearishCount++
          bearishIndicators.push(`OBV: ${ind.obv.toFixed(2)}`)
        }
      }
      
      // Bollinger Bands
      if (ind.bollingerBands) {
        const bbMiddle = ind.bollingerBands.middle
        if (price > bbMiddle) {
          bullishCount++
          bullishIndicators.push(`Price > BB Middle`)
        } else {
          bearishCount++
          bearishIndicators.push(`Price < BB Middle`)
        }
      }
      
      // Parabolic SAR
      if (ind.parabolicSAR) {
        if (price > ind.parabolicSAR) {
          bullishCount++
          bullishIndicators.push(`Parabolic SAR: Bullish`)
        } else {
          bearishCount++
          bearishIndicators.push(`Parabolic SAR: Bearish`)
        }
      }
      
      // Aroon
      if (ind.aroon) {
        if (ind.aroon.up > ind.aroon.down) {
          bullishCount++
          bullishIndicators.push(`Aroon: Up > Down`)
        } else {
          bearishCount++
          bearishIndicators.push(`Aroon: Down > Up`)
        }
      }
      
      // CCI
      if (ind.cci !== null && ind.cci !== undefined) {
        if (ind.cci > 100) {
          bullishCount++
          bullishIndicators.push(`CCI: Overbought (${ind.cci.toFixed(2)})`)
        } else if (ind.cci < -100) {
          bearishCount++
          bearishIndicators.push(`CCI: Oversold (${ind.cci.toFixed(2)})`)
        }
      }
      
      // VWAP
      if (ind.vwap) {
        if (price > ind.vwap) {
          bullishCount++
          bullishIndicators.push(`Price > VWAP`)
        } else {
          bearishCount++
          bearishIndicators.push(`Price < VWAP`)
        }
      }
      
      // 24h Change
      if (ind.priceChange24h !== null && ind.priceChange24h !== undefined) {
        if (ind.priceChange24h > 0) {
          bullishCount++
          bullishIndicators.push(`24h Change: +${ind.priceChange24h.toFixed(2)}%`)
        } else {
          bearishCount++
          bearishIndicators.push(`24h Change: ${ind.priceChange24h.toFixed(2)}%`)
        }
      }
      
      // RSI Divergence
      if (ind.rsiDivergence && ind.rsiDivergence.divergence) {
        if (ind.rsiDivergence.divergence.toLowerCase().includes('bullish')) {
          bullishCount++
          bullishIndicators.push(`RSI Divergence: Bullish`)
        } else if (ind.rsiDivergence.divergence.toLowerCase().includes('bearish')) {
          bearishCount++
          bearishIndicators.push(`RSI Divergence: Bearish`)
        }
      }
      
      userPrompt += `
- Technical Indicators:
  * RSI(14): ${ind.rsi14?.toFixed(2) || 'N/A'} ${ind.rsi14 && ind.rsi14 > 70 ? '(Overbought)' : ind.rsi14 && ind.rsi14 < 30 ? '(Oversold)' : ''}
  * EMA(8): $${ind.ema8?.toFixed(2) || 'N/A'} | EMA(20): $${ind.ema20?.toFixed(2) || 'N/A'} | EMA(50): $${ind.ema50?.toFixed(2) || 'N/A'} | EMA(200): $${ind.ema200?.toFixed(2) || 'N/A'}
  * MACD: ${ind.macd ? `${ind.macd.macd.toFixed(4)} (Histogram: ${ind.macd.histogram.toFixed(4)})` : 'N/A'}
  * Bollinger Bands: ${ind.bollingerBands ? `Upper: $${ind.bollingerBands.upper.toFixed(2)}, Middle: $${ind.bollingerBands.middle.toFixed(2)}, Lower: $${ind.bollingerBands.lower.toFixed(2)}` : 'N/A'}
    → ${bbPositionText}
  * ATR(14): $${ind.atr?.toFixed(2) || 'N/A'} (Volatility measure)
  * ADX(14): ${(typeof ind.adx === 'number' ? ind.adx : (ind.adx?.adx || null))?.toFixed(2) || 'N/A'} ${(typeof ind.adx === 'number' ? ind.adx : (ind.adx?.adx || null)) && (typeof ind.adx === 'number' ? ind.adx : ind.adx.adx) > 25 ? '(Strong Trend)' : (typeof ind.adx === 'number' ? ind.adx : (ind.adx?.adx || null)) && (typeof ind.adx === 'number' ? ind.adx : ind.adx.adx) < 20 ? '(Weak Trend)' : '(Moderate Trend)'}
  * OBV: ${ind.obv ? ind.obv.toFixed(2) : 'N/A'} | VWAP: $${ind.vwap?.toFixed(2) || 'N/A'}
  * Stochastic: ${ind.stochastic ? `K: ${ind.stochastic.k.toFixed(2)}, D: ${ind.stochastic.d.toFixed(2)}` : 'N/A'}
  * CCI: ${ind.cci?.toFixed(2) || 'N/A'} | Williams %R: ${ind.williamsR?.toFixed(2) || 'N/A'}
  * Parabolic SAR: $${ind.parabolicSAR?.toFixed(2) || 'N/A'}
  * Aroon: ${ind.aroon ? `Up: ${ind.aroon.up.toFixed(2)}, Down: ${ind.aroon.down.toFixed(2)}` : 'N/A'}
  * Support/Resistance: ${ind.supportResistance ? `Support: $${ind.supportResistance.support?.toFixed(2) || 'N/A'}, Resistance: $${ind.supportResistance.resistance?.toFixed(2) || 'N/A'}` : 'N/A'}
  * Trend Detection: ${ind.trendDetection ? `${ind.trendDetection.trend} (Strength: ${ind.trendDetection.strength}/3)` : 'N/A'}
  * Market Structure: ${ind.marketStructure ? `${ind.marketStructure.structure} | HH: ${ind.marketStructure.higherHighs ? 'Yes' : 'No'} | LL: ${ind.marketStructure.lowerLows ? 'Yes' : 'No'}` : 'N/A'}
  * Divergence: ${ind.rsiDivergence && ind.rsiDivergence.divergence ? `RSI: ${ind.rsiDivergence.divergence}` : ''} ${ind.macdDivergence && ind.macdDivergence.divergence ? `MACD: ${ind.macdDivergence.divergence}` : ''} ${!ind.rsiDivergence?.divergence && !ind.macdDivergence?.divergence ? 'None' : ''}
  * Candlestick Patterns: ${ind.candlestickPatterns && ind.candlestickPatterns.patterns && ind.candlestickPatterns.patterns.length > 0 ? ind.candlestickPatterns.patterns.map(p => p.type).join(', ') : 'None'}
  * Market Regime: ${ind.marketRegime ? `${ind.marketRegime.regime} (${ind.marketRegime.volatility} volatility)` : 'N/A'}
  * 24h Change: ${ind.priceChange24h?.toFixed(2) || '0.00'}% | Volume Change: ${ind.volumeChange?.toFixed(2) || '0.00'}%
  
  **INDICATOR SUMMARY (CRITICAL FOR SIGNAL DECISION):**
  ✅ BULLISH Indicators (${bullishCount}): ${bullishIndicators.length > 0 ? bullishIndicators.join(', ') : 'None'}
  ⚠️ BEARISH Indicators (${bearishCount}): ${bearishIndicators.length > 0 ? bearishIndicators.join(', ') : 'None'}
  → **DECISION RULE**: ${bullishCount > bearishCount ? 'MORE BULLISH indicators → Consider BUY_TO_ENTER' : bearishCount > bullishCount ? 'MORE BEARISH indicators → Consider SELL_TO_ENTER' : 'MIXED indicators → Use HOLD or wait for clearer signal'}`
      
      // Add multi-timeframe analysis if available
      if (data.trendAlignment) {
        const ta = data.trendAlignment
        userPrompt += `
- Multi-Timeframe Analysis:
  * Daily Trend: ${ta.dailyTrend || 'N/A'} ${ta.dailyTrend === 'uptrend' ? '(Bullish ✅)' : ta.dailyTrend === 'downtrend' ? '(Bearish ⚠️)' : '(Neutral)'}
  * 4H Aligned: ${ta.h4Aligned ? 'Yes ✅' : 'No ⚠️'}
  * 1H Aligned: ${ta.h1Aligned ? 'Yes ✅' : 'No ⚠️'}
  * Overall Alignment: ${ta.aligned ? 'Yes ✅' : 'No ⚠️'} (${ta.reason || 'N/A'})
  * **IMPORTANT**: Only generate BUY_TO_ENTER if daily trend is uptrend. Only generate SELL_TO_ENTER if daily trend is downtrend.`
      }
      
      if (data.multiTimeframeIndicators) {
        const mtf = data.multiTimeframeIndicators
        userPrompt += `
- Multi-Timeframe Indicators:`
        if (mtf['1d']) {
          const daily = mtf['1d']
          userPrompt += `
  * Daily (1D): EMA20: $${daily.ema20?.toFixed(2) || 'N/A'}, EMA50: $${daily.ema50?.toFixed(2) || 'N/A'}, RSI: ${daily.rsi14?.toFixed(2) || 'N/A'}`
        }
        if (mtf['4h']) {
          const h4 = mtf['4h']
          userPrompt += `
  * 4H: EMA20: $${h4.ema20?.toFixed(2) || 'N/A'}, RSI: ${h4.rsi14?.toFixed(2) || 'N/A'}`
        }
        if (mtf['1h']) {
          const h1 = mtf['1h']
          userPrompt += `
  * 1H: EMA20: $${h1.ema20?.toFixed(2) || 'N/A'}, RSI: ${h1.rsi14?.toFixed(2) || 'N/A'}`
        }
      }
      
      // Add external data to user prompt
      if (data.externalData) {
        const ext = data.externalData
        userPrompt += `
- External Data:`
        
        // Hyperliquid data
        if (ext.hyperliquid) {
          const hl = ext.hyperliquid
          userPrompt += `
  * Funding Rate: ${(hl.fundingRate * 100).toFixed(4)}% (Trend: ${hl.fundingRateTrend || 'N/A'}) ${Math.abs(hl.fundingRate) > 0.0015 ? '⚠️ EXTREME' : ''}
  * Open Interest: $${hl.openInterest?.toLocaleString() || 'N/A'} (Trend: ${hl.oiTrend || 'N/A'})`
        }
        
        // Blockchain data
        if (ext.blockchain) {
          const bc = ext.blockchain
          if (bc.estimatedExchangeFlow !== undefined && bc.estimatedExchangeFlow !== 0) {
            const flowDirection = bc.estimatedExchangeFlow < 0 ? 'Outflow (Bullish)' : 'Inflow (Bearish)'
            userPrompt += `
  * Exchange Flow: $${Math.abs(bc.estimatedExchangeFlow).toLocaleString()} ${flowDirection}`
          }
          if (bc.whaleActivityScore !== undefined && bc.whaleActivityScore !== 0) {
            const whaleSentiment = bc.whaleActivityScore > 0 ? 'Bullish' : 'Bearish'
            userPrompt += `
  * Whale Activity: ${(Math.abs(bc.whaleActivityScore) * 100).toFixed(0)}% ${whaleSentiment}`
          }
        }
        
        // Enhanced metrics
        if (ext.enhanced) {
          const enh = ext.enhanced
          userPrompt += `
  * Volume Trend: ${enh.volumeTrend || 'N/A'} | Volatility: ${enh.volatilityPattern || 'N/A'}`
        }
      }
    } else {
      userPrompt += `
- Technical Indicators: Not available (historical data not accessible)`
    }
    
    userPrompt += `
- Timestamp: ${new Date().toISOString()}

`
  }

  userPrompt += `**ACCOUNT STATE**
- Account Value: $${accountState.accountValue.toFixed(2)}
- Available Cash: $${accountState.availableCash.toFixed(2)}
- Total Return: ${accountState.totalReturnPercent.toFixed(2)}%
- Active Positions: ${accountState.activePositions.length}
- Sharpe Ratio: ${accountState.sharpeRatio.toFixed(2)}

**INSTRUCTIONS:**
Based on the TECHNICAL ANALYSIS data provided above, generate trading signals for each asset.
- Use RSI to identify overbought/oversold conditions
- Use MACD to identify momentum and trend direction
- Use EMA crossovers to identify trend changes
- Use Bollinger Bands to identify volatility and potential reversals
- Consider volume changes and price movements
- Set appropriate stop losses and take profits based on technical levels

Generate trading signals for each asset.`

  try {
    // Call AI API with system and user messages separated (ZAI format)
    // Format: system message + user message (not combined prompt)
    const response = await callAIAPI(systemPrompt, userPrompt)

    // Parse JSON from response (ZAI structured output returns JSON object)
    let jsonData
    try {
      // Log response for debugging
      if (process.env.DEBUG_AI_RESPONSE === 'true') {
        console.log('🔍 AI Response length:', response.text.length)
        console.log('🔍 AI Response (first 500 chars):', response.text.substring(0, 500))
        console.log('🔍 AI Response (last 200 chars):', response.text.substring(Math.max(0, response.text.length - 200)))
      }
      
      // Clean response text - remove any markdown code blocks if present
      let cleanedText = response.text.trim()
      
      // Check if response is an array of numbers (model returned wrong format)
      if (cleanedText.startsWith('[') && cleanedText.match(/^\[[\d\s.,]+\]$/)) {
        console.error('❌ AI model returned array of numbers instead of JSON object')
        console.error('❌ This usually means:')
        console.error('   1. The model does not support JSON mode properly')
        console.error('   2. The model returned embeddings instead of text')
        console.error('   3. There is a configuration issue with the API')
        console.error('❌ Response (first 500 chars):', cleanedText.substring(0, 500))
        throw new Error('AI_MODEL_RETURNED_NON_JSON: Model returned array of numbers instead of JSON object. Please check model configuration or try a different model.')
      }
      
      // Remove markdown code blocks if present (```json ... ```)
      if (cleanedText.startsWith('```')) {
        const lines = cleanedText.split('\n')
        if (lines[0].includes('json') || lines[0].includes('JSON')) {
          cleanedText = lines.slice(1, -1).join('\n').trim()
        } else {
          cleanedText = lines.slice(1, -1).join('\n').trim()
        }
      }
      
      // Try to parse as JSON object first
      jsonData = JSON.parse(cleanedText)
    } catch (parseError) {
      // If direct parse fails, try to extract JSON from text
      console.warn('⚠️  Direct JSON parse failed:', parseError.message)
      console.warn('Response text (first 1000 chars):', response.text.substring(0, 1000))
      console.warn('Response text (last 500 chars):', response.text.substring(Math.max(0, response.text.length - 500)))
      
      // Try to extract JSON object from text - find the first complete JSON object
      // Look for { followed by content and ending with }
      let jsonMatch = null
      let braceCount = 0
      let startIdx = -1
      
      for (let i = 0; i < response.text.length; i++) {
        if (response.text[i] === '{') {
          if (startIdx === -1) startIdx = i
          braceCount++
        } else if (response.text[i] === '}') {
          braceCount--
          if (braceCount === 0 && startIdx !== -1) {
            // Found complete JSON object
            jsonMatch = response.text.substring(startIdx, i + 1)
            break
          }
        }
      }
      
      // Fallback: try regex match
      if (!jsonMatch) {
        const regexMatch = response.text.match(/\{[\s\S]{1,50000}\}/)
        if (regexMatch) {
          jsonMatch = regexMatch[0]
        }
      }
      
      if (!jsonMatch) {
        // Check if response is an array of numbers (model returned wrong format)
        const arrayMatch = response.text.match(/^\[[\s\S]*\]$/)
        if (arrayMatch) {
          console.error('❌ AI returned array of numbers instead of JSON object')
          console.error('❌ This usually means the model does not support JSON mode or returned embeddings')
          console.error('❌ Response (first 500 chars):', response.text.substring(0, 500))
          
          // Try to create a fallback signal structure from available data
          console.warn('⚠️  Attempting to generate fallback signals from technical analysis...')
          // We'll handle this in the calling function by checking for this error
          throw new Error('AI_MODEL_RETURNED_NON_JSON: Model returned array instead of JSON object. This may indicate the model does not support JSON mode properly.')
        }
        
        console.error('❌ Full AI Response (first 2000 chars):', response.text.substring(0, 2000))
        console.error('❌ Full AI Response (last 1000 chars):', response.text.substring(Math.max(0, response.text.length - 1000)))
        throw new Error('No valid JSON found in response')
      }
      
      try {
        // Try to fix common JSON issues
        let fixedJson = jsonMatch
          .replace(/,\s*}/g, '}') // Remove trailing commas before }
          .replace(/,\s*]/g, ']') // Remove trailing commas before ]
          .replace(/([{,]\s*)(\w+):/g, '$1"$2":') // Add quotes to unquoted keys
          .replace(/:\s*([^",\[\]{}]+)([,}\]])/g, ': "$1"$2') // Add quotes to unquoted string values
        
        jsonData = JSON.parse(fixedJson)
      } catch (extractError) {
        // If fixing didn't work, try original
        try {
          jsonData = JSON.parse(jsonMatch)
        } catch (originalError) {
          console.error('❌ Failed to parse extracted JSON:', extractError.message)
          console.error('❌ Extracted JSON (first 1000 chars):', jsonMatch.substring(0, 1000))
          console.error('❌ Extracted JSON (last 500 chars):', jsonMatch.substring(Math.max(0, jsonMatch.length - 500)))
          throw new Error(`Failed to parse JSON: ${extractError.message}. Original: ${originalError.message}`)
        }
      }
    }

    // Extract signals array from response
    // ZAI structured output returns JSON object, so we check for "signals" key
    let signals = []
    if (Array.isArray(jsonData)) {
      // If response is already an array
      signals = jsonData
    } else if (jsonData.signals && Array.isArray(jsonData.signals)) {
      // If response has "signals" key
      signals = jsonData.signals
    } else if (jsonData.data && Array.isArray(jsonData.data)) {
      // If response has "data" key
      signals = jsonData.data
    } else {
      // Log what we actually received for debugging
      console.error('❌ Unexpected JSON structure from AI model')
      console.error('❌ JSON data type:', typeof jsonData)
      console.error('❌ JSON data keys:', jsonData && typeof jsonData === 'object' ? Object.keys(jsonData) : 'N/A')
      console.error('❌ JSON data (first 500 chars):', JSON.stringify(jsonData).substring(0, 500))
      
      // Try to find array in response text
      const arrayMatch = response.text.match(/\[[\s\S]*\]/)
      if (arrayMatch) {
        try {
          const parsedArray = JSON.parse(arrayMatch[0])
          // Check if it's an array of numbers (model returned wrong format)
          if (Array.isArray(parsedArray) && parsedArray.length > 0 && typeof parsedArray[0] === 'number') {
            console.error('❌ AI returned array of numbers instead of signals array')
            console.error('❌ This usually means the model does not support JSON mode properly')
            throw new Error('AI_MODEL_RETURNED_NON_JSON: Model returned array of numbers instead of JSON signals object')
          }
          signals = parsedArray
        } catch (parseError) {
          // If parsing fails or it's an array of numbers, throw special error
          if (parseError.message.includes('AI_MODEL_RETURNED_NON_JSON')) {
            throw parseError
          }
          console.error('❌ Failed to parse array from response:', parseError.message)
          throw new Error('AI_MODEL_RETURNED_INVALID_SIGNALS: No valid signals array found in response. The AI model may not have followed the JSON format requirements.')
        }
      } else {
        console.error('❌ No signals array found in response')
        console.error('❌ Response structure:', jsonData && typeof jsonData === 'object' ? Object.keys(jsonData).join(', ') : typeof jsonData)
        throw new Error('AI_MODEL_RETURNED_INVALID_SIGNALS: No signals array found in response. The AI model may not have followed the JSON format requirements in the system prompt.')
      }
    }

    if (!Array.isArray(signals)) {
      throw new Error('Signals is not an array')
    }
    
    // Validate signals structure
    if (signals.length > 0) {
      const firstSignal = signals[0]
      // Check if signal is a valid object with required fields
      if (!firstSignal || typeof firstSignal !== 'object' || (!firstSignal.coin && !firstSignal.asset) || !firstSignal.signal) {
        console.error('❌ Signals array has invalid structure (missing coin or signal fields)')
        console.error('❌ First signal type:', typeof firstSignal)
        console.error('❌ First signal value:', JSON.stringify(firstSignal, null, 2))
        console.error('❌ Expected structure: { coin: "BTC", signal: "buy_to_enter", ... }')
        console.error('❌ This usually means the AI model did not follow the JSON format requirements')
        throw new Error('AI_MODEL_RETURNED_INVALID_SIGNALS: Signals array has invalid structure. The AI model may not have followed the JSON format requirements in the system prompt.')
      }
    }
    
    // Calculate correct position sizing for each signal based on account balance and volatility
    const baseRiskPercent = 0.02 // 2% of account balance per trade ($1.8 from $90)
    const accountBalance = accountState.accountValue || accountState.availableCash || 90 // $90 capital
    
    for (const signal of signals) {
      // ═══════════════════════════════════════════════════════════════
      // Validate and Auto-Generate invalidation_condition for ALL signals (CRITICAL)
      // Based on Alpha Arena research: invalidation_condition improves performance
      // ═══════════════════════════════════════════════════════════════
      const assetData = marketData instanceof Map ? marketData.get(signal.coin) : marketData[signal.coin]
      const indicators = assetData?.indicators || assetData?.data?.indicators
      const trendAlignment = assetData?.data?.trendAlignment || assetData?.trendAlignment
      const externalData = assetData?.data?.externalData || assetData?.externalData
      const entryPrice = signal.entry_price || (indicators?.price || 0)
      let stopLossPrice = signal.stop_loss || 0
      
      // Check if invalidation_condition exists and is valid
      if (!signal.invalidation_condition || 
          signal.invalidation_condition.trim() === '' || 
          signal.invalidation_condition.toLowerCase() === 'n/a' ||
          signal.invalidation_condition.toLowerCase() === 'na') {
        // Auto-generate invalidation_condition using Alpha Arena-style logic
        const supportResistance = {
          supportLevels: indicators?.supportLevels || [],
          resistanceLevels: indicators?.resistanceLevels || []
        }
        
        signal.invalidation_condition = generateInvalidationCondition(
          signal,
          indicators,
          entryPrice,
          stopLossPrice,
          supportResistance,
          trendAlignment,
          externalData,
          marketData
        )
        
        signal._invalidation_auto_generated = true
        collectWarning(signal.coin, `⚠️  Auto-generated invalidation_condition: ${signal.invalidation_condition}`, [
          `→ invalidation_condition was missing or invalid, auto-generated based on Alpha Arena patterns`,
          `→ Using technical indicators, price levels, and multi-timeframe conditions`
        ])
      } else {
        // Validate that invalidation_condition is specific (not generic)
        const invalidationLower = signal.invalidation_condition.toLowerCase()
        const genericPhrases = ['if price moves against', 'if trend reverses', 'if conditions change', 'if market turns']
        const isGeneric = genericPhrases.some(phrase => invalidationLower.includes(phrase))
        
        if (isGeneric) {
          // Replace generic invalidation with specific one
          const supportResistance = {
            supportLevels: indicators?.supportLevels || [],
            resistanceLevels: indicators?.resistanceLevels || []
          }
          
          const originalInvalidation = signal.invalidation_condition
          signal.invalidation_condition = generateInvalidationCondition(
            signal,
            indicators,
            entryPrice,
            stopLossPrice,
            supportResistance,
            trendAlignment,
            externalData,
            marketData
          )
          
          signal._invalidation_auto_generated = true
          collectWarning(signal.coin, `⚠️  Replaced generic invalidation_condition with specific one`, [
            `→ Original: "${originalInvalidation}"`,
            `→ New: "${signal.invalidation_condition}"`,
            `→ Generic phrases are not allowed - must be specific (Alpha Arena requirement)`
          ])
        }
      }
      
      // Only recalculate position size for BUY/SELL/ADD signals with entry_price
      if ((signal.signal === 'buy_to_enter' || signal.signal === 'sell_to_enter' || signal.signal === 'add') 
          && signal.entry_price && signal.entry_price > 0) {
        
        const entryPrice = signal.entry_price
        // High leverage mode: Force 10x leverage (override AI if needed)
        const leverage = 10 // Always use 10x leverage
        signal.leverage = leverage // Update signal to ensure consistency
        
        // Get market data for this asset to access ATR and market regime (already fetched above)
        const marketRegime = indicators?.marketRegime
        
        // Check for extreme volatility - skip trading if volatility is too high
        if (marketRegime && marketRegime.volatility === 'high') {
          // High volatility: reduce risk or skip trade
          const atrPercent = indicators?.atr && entryPrice > 0 ? (indicators.atr / entryPrice) * 100 : 0
          if (atrPercent > 5) {
            // ATR > 5% of price = extreme volatility, skip this trade
            console.warn(`⚠️  Skipping ${signal.signal} signal for ${signal.coin}: Extreme volatility detected (ATR: ${atrPercent.toFixed(2)}%)`)
            signal.signal = 'hold' // Convert to HOLD to avoid execution
            continue
          }
        }
        
        // SIMPLE LOGIC: Count bullish vs bearish indicators to determine signal direction
        let bullishCount = 0
        let bearishCount = 0
        const price = (indicators && indicators.price) ? indicators.price : entryPrice
        
        // Count indicators (with null checks)
        if (indicators && indicators.macd && indicators.macd.histogram > 0) bullishCount++
        else if (indicators && indicators.macd && indicators.macd.histogram < 0) bearishCount++
        
        if (indicators && indicators.obv && indicators.obv > 0) bullishCount++
        else if (indicators && indicators.obv && indicators.obv < 0) bearishCount++
        
        if (indicators && indicators.bollingerBands && price > indicators.bollingerBands.middle) bullishCount++
        else if (indicators && indicators.bollingerBands && price < indicators.bollingerBands.middle) bearishCount++
        
        if (indicators && indicators.parabolicSAR && price > indicators.parabolicSAR) bullishCount++
        else if (indicators && indicators.parabolicSAR && price < indicators.parabolicSAR) bearishCount++
        
        if (indicators && indicators.aroon && indicators.aroon.up > indicators.aroon.down) bullishCount++
        else if (indicators && indicators.aroon && indicators.aroon.down > indicators.aroon.up) bearishCount++
        
        if (indicators && indicators.cci && indicators.cci > 100) bullishCount++
        else if (indicators && indicators.cci && indicators.cci < -100) bearishCount++
        
        if (indicators && indicators.vwap && price > indicators.vwap) bullishCount++
        else if (indicators && indicators.vwap && price < indicators.vwap) bearishCount++
        
        if (indicators && indicators.priceChange24h && indicators.priceChange24h > 0) bullishCount++
        else if (indicators && indicators.priceChange24h && indicators.priceChange24h < 0) bearishCount++
        
        if (indicators && indicators.rsiDivergence && indicators.rsiDivergence.divergence && indicators.rsiDivergence.divergence.toLowerCase().includes('bullish')) bullishCount++
        else if (indicators && indicators.rsiDivergence && indicators.rsiDivergence.divergence && indicators.rsiDivergence.divergence.toLowerCase().includes('bearish')) bearishCount++
        
        // EARLY CHECK: Overbought/Oversold conditions (before auto-correct)
        // These should prevent or flip signals early
        // Note: price already declared above at line 4819
        const isOverboughtEarly = indicators && indicators.bollingerBands && price > indicators.bollingerBands.upper
        const isOversoldEarly = indicators && indicators.bollingerBands && price < indicators.bollingerBands.lower
        
        // RULE: NEVER generate BUY when price is ABOVE BB upper (overbought)
        if (isOverboughtEarly && (signal.signal === 'buy_to_enter' || signal.signal === 'add')) {
          console.warn(`⚠️  EARLY OVERBOUGHT CHECK for ${signal.coin}: BUY signal but price is ABOVE BB Upper`)
          // Will be handled by comprehensive check later, but log early warning
        }
        
        // RULE: NEVER generate SELL when price is BELOW BB lower (oversold)
        if (isOversoldEarly && signal.signal === 'sell_to_enter') {
          collectWarning(signal.coin, `⚠️  EARLY OVERSOLD CHECK: SELL signal but price is BELOW BB Lower`)
          // Will be handled by comprehensive check later, but collect warning
        }
        
        // AUTO-CORRECT: If signal doesn't match indicator majority, flip it
        // DISABLED: Auto-correct flip logic removed per user request
        // Signals will not flip automatically - if AI generates a signal, it stays as-is
        // const originalSignal = signal.signal
        // if (!isOverboughtEarly && !isOversoldEarly) {
        //   if (bullishCount > bearishCount && (signal.signal === 'sell_to_enter')) {
        //     collectWarning(signal.coin, `🔄 AUTO-CORRECT: from SELL → BUY (${bullishCount} bullish vs ${bearishCount} bearish indicators)`)
        //     signal.signal = 'buy_to_enter'
        //     signal.justification = generateJustificationFromIndicators(signal, indicators, bullishCount, bearishCount, trendAlignment, externalData)
        //   } else if (bearishCount > bullishCount && (signal.signal === 'buy_to_enter' || signal.signal === 'add')) {
        //     collectWarning(signal.coin, `🔄 AUTO-CORRECT: from BUY → SELL (${bearishCount} bearish vs ${bullishCount} bullish indicators)`)
        //     signal.signal = 'sell_to_enter'
        //     signal.justification = generateJustificationFromIndicators(signal, indicators, bullishCount, bearishCount, trendAlignment, externalData)
        //   }
        // }
        
        // Note: If signal contradicts indicators, it will be handled in justification generation
        // which will clearly show the contradictions instead of flipping the signal
        
        // ALWAYS replace AI justification with our comprehensive, honest justification function
        // This ensures transparency and prevents cherry-picking
        // Our function displays ALL indicators (both supporting and contradicting) with accurate counts
        if (signal.signal === 'buy_to_enter' || signal.signal === 'sell_to_enter' || signal.signal === 'add') {
          if (indicators && (bullishCount !== undefined && bearishCount !== undefined)) {
            // Store original AI justification for comparison (optional, for debugging)
            const originalJustification = signal.justification
            // Always replace with our comprehensive justification function
            signal.justification = generateJustificationFromIndicators(signal, indicators, bullishCount, bearishCount, trendAlignment, externalData)
            // Log replacement (only if different from original, to avoid spam)
            if (originalJustification && originalJustification !== signal.justification) {
              collectWarning(signal.coin, `✅ Justification replaced with comprehensive indicator-based analysis (prevents cherry-picking)`)
            }
          }
        }
        
        // Stop Loss: ATR-based (1.5-2x ATR) with volatility adjustment
        // Minimum 1.5% for low volatility, 2-3% for high volatility
        // Add 0.2-0.5% buffer for wick rejection to avoid being stopped out by shadows
        
        let slPercent = 0
        const WICK_BUFFER_PERCENT = 0.003 // 0.3% buffer for wick rejection
        
        if (indicators && indicators.atr && entryPrice > 0) {
          // ATR-based stop loss calculation
          const atr = indicators.atr
          const atrPercent = (atr / entryPrice) * 100
          
          // Determine volatility regime
          let atrMultiplier = 1.5 // Default: 1.5x ATR for normal volatility
          if (atrPercent > 4.0) {
            // High volatility: use 2.0x ATR, minimum 3% of price
            atrMultiplier = 2.0
            slPercent = Math.max(0.03, (atr * atrMultiplier / entryPrice)) // Minimum 3%
          } else if (atrPercent > 2.5) {
            // Medium-high volatility: use 1.75x ATR
            atrMultiplier = 1.75
            slPercent = Math.max(0.02, (atr * atrMultiplier / entryPrice)) // Minimum 2%
          } else if (atrPercent > 1.5) {
            // Medium volatility: use 1.5x ATR
            atrMultiplier = 1.5
            slPercent = Math.max(0.015, (atr * atrMultiplier / entryPrice)) // Minimum 1.5%
          } else {
            // Low volatility: use 1.5x ATR, but ensure minimum 1.5%
            atrMultiplier = 1.5
            slPercent = Math.max(0.015, (atr * atrMultiplier / entryPrice)) // Minimum 1.5%
          }
          
          // Add wick buffer to avoid being stopped out by candle shadows
          slPercent += WICK_BUFFER_PERCENT
          
          console.log(`📊 ATR-based stop loss for ${signal.coin}: ATR=${atr.toFixed(2)} (${atrPercent.toFixed(2)}%), multiplier=${atrMultiplier}x, SL=${(slPercent*100).toFixed(2)}% (including ${(WICK_BUFFER_PERCENT*100).toFixed(2)}% wick buffer)`)
        } else {
          // Fallback to fixed percentage if ATR not available
          // Use 2% as default (higher than previous 1% to reduce false stops)
          slPercent = 0.02 // 2% stop loss fallback
          console.log(`⚠️  ATR not available for ${signal.coin}, using fallback ${(slPercent*100).toFixed(2)}% stop loss`)
        }
        
        if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
          // LONG: Stop loss below entry
          stopLossPrice = entryPrice * (1 - slPercent)
          slDistance = entryPrice - stopLossPrice
          console.log(`📊 Stop loss for ${signal.coin}: SL=$${stopLossPrice.toFixed(2)} (${(slPercent*100).toFixed(2)}% below entry, distance=$${slDistance.toFixed(2)})`)
        } else if (signal.signal === 'sell_to_enter') {
          // SHORT: Stop loss above entry
          stopLossPrice = entryPrice * (1 + slPercent)
          slDistance = stopLossPrice - entryPrice
          console.log(`📊 Stop loss for ${signal.coin}: SL=$${stopLossPrice.toFixed(2)} (${(slPercent*100).toFixed(2)}% above entry, distance=$${slDistance.toFixed(2)})`)
        }
        
        // ═══════════════════════════════════════════════════════════════
        // Dynamic SL Offset for Bounce Signals
        // ═══════════════════════════════════════════════════════════════
        
        // Apply dynamic SL offset for bounce signals based on ATR
        if (signal.bounce_mode && slDistance > 0) {
          const originalSlDistance = slDistance
          slDistance = calculateBounceSLOffset(slDistance, indicators, entryPrice)
          
          if (slDistance !== originalSlDistance) {
            const offsetMultiplier = slDistance / originalSlDistance
            const atrPercent = indicators?.atr && entryPrice > 0 ? (indicators.atr / entryPrice) * 100 : 0
            
            // Recalculate stop loss price with new distance
            if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
              stopLossPrice = entryPrice - slDistance
            } else if (signal.signal === 'sell_to_enter') {
              stopLossPrice = entryPrice + slDistance
            }
            
            signal.bounce_sl_offset = offsetMultiplier
            signal.bounce_sl_reason = atrPercent > 3.0 
              ? `High ATR (${atrPercent.toFixed(2)}%) → wider SL (×${offsetMultiplier.toFixed(2)}) to avoid shadow wick`
              : `Low ATR (${atrPercent.toFixed(2)}%) → tight SL (×${offsetMultiplier.toFixed(2)})`
            
            console.log(`🎯 Bounce SL adjusted for ${signal.coin}: ${(originalSlDistance/entryPrice*100).toFixed(2)}% → ${(slDistance/entryPrice*100).toFixed(2)}% (${signal.bounce_sl_reason})`)
          }
        }
        
        if (stopLossPrice > 0) {
          signal.stop_loss = stopLossPrice
        } else if (signal.stop_loss && signal.stop_loss > 0) {
          // Fallback to provided stop loss if available
          stopLossPrice = signal.stop_loss
          slDistance = Math.abs(entryPrice - stopLossPrice)
          console.log(`⚠️  Using provided stop loss for ${signal.coin}: $${stopLossPrice.toFixed(2)}`)
        } else {
          // No stop loss available - skip position sizing
          console.warn(`⚠️  No stop loss available for ${signal.coin}, skipping position sizing`)
          continue
        }
        
        if (slDistance > 0) {
          // Dynamic risk based on confidence level
          // High confidence (50%+): 2% risk
          // Medium confidence (40-50%): 1.5% risk
          // Low confidence (35-40%): 1% risk
          // Contrarian plays: 0.5-1% risk (handled separately)
          
          const signalConfidence = signal.confidence || 0.5
          const isContrarian = signal.contrarian_play || signal.oversold_contrarian
          const highConfidence = TRADING_CONFIG.thresholds.confidence.high
          const mediumConfidence = TRADING_CONFIG.thresholds.confidence.medium
          const lowConfidence = TRADING_CONFIG.thresholds.confidence.low
          
          let riskPercent = baseRiskPercent // Default: 2% for high confidence
          
          if (isContrarian) {
            // Contrarian plays: 0.5-1% risk (very conservative)
            // Scale based on confidence: 0.5% at 35% confidence, 1% at 40%+ confidence
            if (signalConfidence >= mediumConfidence) {
              riskPercent = 0.01 // 1% for contrarian with medium+ confidence
            } else {
              riskPercent = 0.005 // 0.5% for contrarian with low confidence
            }
          } else if (signalConfidence >= highConfidence) {
            // High confidence (50%+): 2% risk
            riskPercent = 0.02
          } else if (signalConfidence >= mediumConfidence) {
            // Medium confidence (40-50%): 1.5% risk
            riskPercent = 0.015
          } else if (signalConfidence >= lowConfidence) {
            // Low confidence (35-40%): 1% risk
            riskPercent = 0.01
          } else {
            // Below low confidence threshold: should not execute, but if it does, use minimal risk
            riskPercent = 0.005 // 0.5% minimal risk
            console.warn(`⚠️  Signal confidence ${(signalConfidence * 100).toFixed(2)}% below minimum threshold, using minimal 0.5% risk`)
          }
          
          const maxRiskUSD = accountBalance * riskPercent
          signal.risk_percent = riskPercent * 100 // Store risk percentage for reference
          
          console.log(`💰 Position sizing for ${signal.coin}: Confidence=${(signalConfidence * 100).toFixed(2)}%, Risk=${(riskPercent * 100).toFixed(2)}%, Risk Amount=$${maxRiskUSD.toFixed(2)}${isContrarian ? ' (contrarian play)' : ''}`)
          
          // Calculate position size: position_size = (risk_amount) / (stop_loss_distance * leverage)
          // For leveraged positions, the stop loss distance is multiplied by leverage
          const positionSize = maxRiskUSD / (slDistance * leverage)
          
          // Update signal with calculated position size
          signal.quantity = positionSize
          
          // Update risk_usd to match calculated risk
          signal.risk_usd = maxRiskUSD
          
          // Store ATR info for reference
          if (indicators && indicators.atr && entryPrice > 0) {
            const atrPercent = (indicators.atr / entryPrice) * 100
            signal.atr_percent = atrPercent
          }
          
          // Take Profit: Dynamic calculation based on market conditions
          // Can expand from 2% (minimum) to 5% (maximum) based on momentum, volatility, trend strength, and volume
          // For bounce signals, use specialized bounce TP calculation
          // trendAlignment and marketRegime already declared above
          
          // Calculate dynamic TP (use bounce TP if bounce mode is active)
          let tpResult
          let calculatedTP
          let tpPercent
          
          if (signal.bounce_mode && signal.bounce_strength) {
            // Use bounce-specific TP calculation
            tpResult = calculateBounceTP(entryPrice, signal, indicators, trendAlignment, slDistance, signal.bounce_strength)
            let bounceTP = tpResult.tpPrice
            
            // ═══════════════════════════════════════════════════════════════
            // Dynamic TP Trail for Bounce Signals
            // ═══════════════════════════════════════════════════════════════
            
            // Apply trailing TP based on EMA8 crossdown/crossup
            const historicalDataForTrail = assetData?.historicalData || assetData?.data?.historicalData
            const trailResult = calculateBounceTPTrail(entryPrice, signal, indicators, historicalDataForTrail, bounceTP)
            
            if (trailResult.isTrailing) {
              // Use trailing TP instead of fixed bounce TP
              calculatedTP = trailResult.tpPrice
              tpPercent = (Math.abs(calculatedTP - entryPrice) / entryPrice) * 100
              
              signal.bounce_tp_trailing = true
              signal.bounce_tp_trail_reason = trailResult.reason
              signal.bounce_tp_original = bounceTP
              signal.bounce_tp_trailed = calculatedTP
              
              console.log(`🎯 Bounce TP Trail for ${signal.coin}: $${calculatedTP.toFixed(2)} (trailing from $${bounceTP.toFixed(2)}, ${trailResult.reason})`)
            } else {
              // Use original bounce TP
              calculatedTP = bounceTP
              tpPercent = tpResult.tpPercent
            }
            
            // Store bounce-specific metadata
            signal.bounce_target = calculatedTP // Use final TP (trailing or original)
            signal.bounce_profit_expectation = tpResult.profitExpectation
            signal.metadata = signal.metadata || {}
            signal.metadata.bounce_target = calculatedTP
            signal.metadata.bounce_profit_expectation = tpResult.profitExpectation
            signal.metadata.bounce_is_counter_trend = tpResult.isCounterTrend
            signal.metadata.bounce_tp_trailing = trailResult.isTrailing
            
            // Mini-bias modifier for counter-trend bounce: reduce confidence
            if (tpResult.isCounterTrend) {
              // Counter-trend bounce gets confidence penalty
              signal.bounce_counter_trend_penalty = 0.05 // 5% penalty
              collectWarning(signal.coin, `⚠️  Counter-Trend Bounce Detected`, [
                `→ Bounce direction contradicts daily trend (${trendAlignment?.dailyTrend || 'unknown'})`,
                `→ Confidence will be reduced by 5% for counter-trend risk`,
                `→ TP target reduced by 25% (more conservative)`
              ])
            }
            
            console.log(`🎯 Bounce TP for ${signal.coin}: $${calculatedTP.toFixed(2)} (${tpPercent.toFixed(2)}%, strength: ${(signal.bounce_strength * 100).toFixed(0)}%, ${tpResult.isCounterTrend ? 'counter-trend' : 'with-trend'}${trailResult.isTrailing ? ', trailing' : ''})`)
          } else {
            // Use standard dynamic TP
            tpResult = calculateDynamicTP(entryPrice, signal, indicators, trendAlignment, marketRegime, slDistance)
            calculatedTP = tpResult.tpPrice
            tpPercent = tpResult.tpPercent
          }
          
          // Override with AI's TP if provided and reasonable (with direction validation)
          if (signal.profit_target && signal.profit_target > 0) {
            const aiTPDistance = Math.abs(signal.profit_target - entryPrice)
            const aiTPPercent = (aiTPDistance / entryPrice) * 100
            const isDirectionCorrect = (signal.signal === 'buy_to_enter' && signal.profit_target > entryPrice) ||
                                      (signal.signal === 'sell_to_enter' && signal.profit_target < entryPrice)
            
            // Use AI TP if direction is correct and within 2-5% range (expanded range for dynamic TP)
            if (isDirectionCorrect && aiTPPercent >= 2.0 && aiTPPercent <= 5.0) {
              calculatedTP = signal.profit_target
              console.log(`📊 Using AI TP for ${signal.coin}: $${calculatedTP.toFixed(2)} (${aiTPPercent.toFixed(2)}%)`)
            } else {
              console.warn(`⚠️  AI TP for ${signal.coin} rejected: direction=${isDirectionCorrect}, percent=${aiTPPercent.toFixed(2)}% (min=2.00%, max=5.00%)`)
            }
          }
          
          // FINAL VALIDATION: Ensure minimum R:R based on confidence level
          // High/Medium confidence: 2.5:1 minimum
          // Low confidence/Contrarian: 3.0:1 minimum (higher R:R to compensate for lower win rate)
          let finalTPDistance = Math.abs(calculatedTP - entryPrice)
          let riskRewardRatio = finalTPDistance / slDistance
          
          // Determine minimum R:R based on signal confidence
          // signalConfidence and isContrarian already declared above in position sizing section
          const isLowConfidence = signalConfidence < TRADING_CONFIG.thresholds.confidence.medium
          const MIN_RR = (isLowConfidence || isContrarian) ? 3.0 : 2.5 // 3:1 for low confidence, 2.5:1 for high/medium
          
          if (riskRewardRatio < MIN_RR) {
            // TP too close, adjust to meet minimum R:R
            const minTPDistance = slDistance * MIN_RR
            if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
              calculatedTP = entryPrice + minTPDistance
            } else if (signal.signal === 'sell_to_enter') {
              calculatedTP = entryPrice - minTPDistance
            }
            // Recalculate after adjustment
            finalTPDistance = Math.abs(calculatedTP - entryPrice)
            riskRewardRatio = finalTPDistance / slDistance
            console.warn(`⚠️  TP for ${signal.coin} adjusted to meet minimum ${MIN_RR}:1 R:R (${isLowConfidence || isContrarian ? 'low confidence/contrarian' : 'high/medium confidence'}): $${calculatedTP.toFixed(2)} (new R:R: ${riskRewardRatio.toFixed(2)}:1)`)
          }
          
          // VALIDATION: Ensure TP direction is correct
          if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
            if (calculatedTP <= entryPrice) {
              calculatedTP = entryPrice + (slDistance * MIN_RR)
              finalTPDistance = Math.abs(calculatedTP - entryPrice)
              riskRewardRatio = finalTPDistance / slDistance
              console.warn(`⚠️  TP for ${signal.coin} BUY was below entry, corrected to $${calculatedTP.toFixed(2)}`)
            }
          } else if (signal.signal === 'sell_to_enter') {
            if (calculatedTP >= entryPrice) {
              calculatedTP = entryPrice - (slDistance * MIN_RR)
              finalTPDistance = Math.abs(calculatedTP - entryPrice)
              riskRewardRatio = finalTPDistance / slDistance
              console.warn(`⚠️  TP for ${signal.coin} SELL was above entry, corrected to $${calculatedTP.toFixed(2)}`)
            }
          }
          
          signal.profit_target = calculatedTP
          signal.risk_reward_ratio = riskRewardRatio
          signal.tp_factors = tpResult.factors // Store TP expansion factors
          
          // Log dynamic TP calculation details
          const factors = tpResult.factors
          const factorDetails = []
          if (factors.momentum > 20) factorDetails.push(`Momentum: ${factors.momentum.toFixed(2)}`)
          if (factors.volatility > 2) factorDetails.push(`Volatility: ${factors.volatility.toFixed(2)}%`)
          if (factors.trendStrength > 50) factorDetails.push(`Trend: ${factors.trendStrength.toFixed(0)}%`)
          if (factors.volume > 10) factorDetails.push(`Volume: +${factors.volume.toFixed(2)}%`)
          
          console.log(`📊 Dynamic TP for ${signal.coin}: $${calculatedTP.toFixed(2)} (${((finalTPDistance/entryPrice)*100).toFixed(2)}% from entry, R:R ${riskRewardRatio.toFixed(2)}:1)${factorDetails.length > 0 ? ` | Factors: ${factorDetails.join(', ')}` : ''}`)
          
        // Calculate confidence score based on technical indicators
        // Skip confidence calculation if indicators are null (e.g., SOL without historical data)
        if (!indicators) {
          signal.confidence = 0.5 // Default confidence if no indicators
          continue
        }
        
        // trendAlignment and marketRegime already declared above for dynamic TP calculation
        // riskRewardRatio and externalData already set above
        
        // Calculate WEIGHTED indicator score (not just counting)
        // Critical indicators get higher weight
        let bullishScore = 0
        let bearishScore = 0
        
        const price = indicators.price || entryPrice
        
        // CRITICAL INDICATORS (Weight: 3-4 points)
        // OBV - Very important for volume confirmation
        if (indicators.obv !== null) {
          const obvAbs = Math.abs(indicators.obv)
          if (indicators.obv > 5000000) bullishScore += 4 // Very strong buying pressure
          else if (indicators.obv > 1000000) bullishScore += 3 // Strong buying pressure
          else if (indicators.obv > 0) bullishScore += 1
          else if (indicators.obv < -5000000) bearishScore += 4 // Very strong selling pressure
          else if (indicators.obv < -1000000) bearishScore += 3 // Strong selling pressure
          else if (indicators.obv < 0) bearishScore += 1
        }
        
        // Trend Alignment - Critical for multi-timeframe analysis
        if (trendAlignment) {
          const alignmentScore = trendAlignment.alignmentScore || 0
          const isAligned = trendAlignment.aligned
          const dailyTrend = trendAlignment.dailyTrend
          
          // Strong alignment bonus
          if (isAligned && alignmentScore >= 75) {
            if ((dailyTrend === 'uptrend' && (signal.signal === 'buy_to_enter' || signal.signal === 'add')) ||
                (dailyTrend === 'downtrend' && signal.signal === 'sell_to_enter')) {
              bullishScore += 4 // Perfect alignment
            } else {
              bearishScore += 4 // Contradiction
            }
          } else if (isAligned && alignmentScore >= 50) {
            if ((dailyTrend === 'uptrend' && (signal.signal === 'buy_to_enter' || signal.signal === 'add')) ||
                (dailyTrend === 'downtrend' && signal.signal === 'sell_to_enter')) {
              bullishScore += 2 // Good alignment
            } else {
              bearishScore += 2 // Contradiction
            }
          } else if (alignmentScore === 0) {
            bearishScore += 3 // NO TREND = uncertainty
          } else if (alignmentScore <= 25) {
            bearishScore += 2 // Poor trend alignment
          } else if (alignmentScore < 50) {
            bearishScore += 1 // Weak alignment
          }
        } else {
          bearishScore += 2 // No trend alignment = uncertainty (reduced from 3 to 2)
        }
        
        // RSI/MACD Divergence - Critical reversal signal
        if (indicators.rsiDivergence && indicators.rsiDivergence.divergence) {
          if (indicators.rsiDivergence.divergence.toLowerCase().includes('bullish')) bullishScore += 3
          else if (indicators.rsiDivergence.divergence.toLowerCase().includes('bearish')) bearishScore += 3
        }
        if (indicators.macdDivergence && indicators.macdDivergence.divergence) {
          if (indicators.macdDivergence.divergence.toLowerCase().includes('bullish')) bullishScore += 3
          else if (indicators.macdDivergence.divergence.toLowerCase().includes('bearish')) bearishScore += 3
        }
        
        // MAJOR INDICATORS (Weight: 2-3 points)
        // MACD Histogram - Momentum indicator (critical for accuracy)
        if (indicators.macd && indicators.macd.histogram) {
          const macdHist = indicators.macd.histogram
          if (macdHist > 30) bullishScore += 3 // Very strong bullish momentum
          else if (macdHist > 20) bullishScore += 2 // Strong bullish momentum
          else if (macdHist > 0) bullishScore += 1
          else if (macdHist < -30) bearishScore += 3 // Very strong bearish momentum
          else if (macdHist < -20) bearishScore += 2 // Strong bearish momentum
          else if (macdHist < 0) bearishScore += 1
        }
        
        // Price vs EMAs - Trend direction (multi-EMA confirmation)
        if (indicators.ema20 && indicators.ema50 && indicators.ema200) {
          const allEMAsBullish = price > indicators.ema20 && indicators.ema20 > indicators.ema50 && indicators.ema50 > indicators.ema200
          const allEMAsBearish = price < indicators.ema20 && indicators.ema20 < indicators.ema50 && indicators.ema50 < indicators.ema200
          
          if (allEMAsBullish) bullishScore += 3 // Perfect EMA alignment (uptrend)
          else if (allEMAsBearish) bearishScore += 3 // Perfect EMA alignment (downtrend)
          else if (price > indicators.ema50 && price > indicators.ema200) bullishScore += 2
          else if (price < indicators.ema50 && price < indicators.ema200) bearishScore += 2
          else if (price > indicators.ema20) bullishScore += 1
          else bearishScore += 1
        } else if (indicators.ema50 && indicators.ema200) {
          if (price > indicators.ema50 && price > indicators.ema200) bullishScore += 2
          else if (price < indicators.ema50 && price < indicators.ema200) bearishScore += 2
          else if (price > indicators.ema50) bullishScore += 1
          else bearishScore += 1
        }
        
        // VWAP - Institutional reference (weighted by distance)
        if (indicators.vwap) {
          const vwapDistance = Math.abs(price - indicators.vwap) / indicators.vwap * 100
          if (price > indicators.vwap) {
            if (vwapDistance > 1) bullishScore += 3 // Strongly above VWAP
            else bullishScore += 2 // Above VWAP
          } else {
            if (vwapDistance > 1) bearishScore += 3 // Strongly below VWAP
            else bearishScore += 2 // Below VWAP
          }
        }
        
        // MINOR INDICATORS (Weight: 1 point)
        // Bollinger Bands
        if (indicators.bollingerBands) {
          const bbMiddle = indicators.bollingerBands.middle
          if (price > bbMiddle) bullishScore += 1
          else bearishScore += 1
        }
        
        // Parabolic SAR
        if (indicators.parabolicSAR) {
          if (price > indicators.parabolicSAR) bullishScore += 1
          else bearishScore += 1
        }
        
        // Aroon - Weighted by strength
        if (indicators.aroon) {
          const aroonDiff = Math.abs(indicators.aroon.up - indicators.aroon.down)
          if (indicators.aroon.up > indicators.aroon.down) {
            if (aroonDiff > 50) bullishScore += 2 // Strong uptrend (Aroon Up >> Down)
            else bullishScore += 1
          } else {
            if (aroonDiff > 50) bearishScore += 2 // Strong downtrend (Aroon Down >> Up)
            else bearishScore += 1
          }
        }
        
        // CCI
        if (indicators.cci !== null) {
          if (indicators.cci > 100) bullishScore += 1
          else if (indicators.cci < -100) bearishScore += 1
        }
        
        // 24h Change - Weighted by magnitude
        if (indicators.priceChange24h !== null) {
          const change24h = indicators.priceChange24h
          if (change24h > 1.0) bullishScore += 2 // Strong positive change (>1%)
          else if (change24h > 0.1) bullishScore += 1 // Positive change
          else if (change24h < -1.0) bearishScore += 2 // Strong negative change (<-1%)
          else if (change24h < 0) bearishScore += 1 // Negative change (falling)
        }
        
        // Volume Confirmation - Critical for accuracy
        if (indicators.volumeChange !== null && indicators.volumeChange !== undefined) {
          const volChange = indicators.volumeChange
          // Volume increasing confirms trend
          if (volChange > 20) {
            // Strong volume increase - confirms current direction
            if (indicators.priceChange24h && indicators.priceChange24h > 0) bullishScore += 2 // Volume confirms price rise
            else if (indicators.priceChange24h && indicators.priceChange24h < 0) bearishScore += 2 // Volume confirms price fall
          } else if (volChange > 10) {
            if (indicators.priceChange24h && indicators.priceChange24h > 0) bullishScore += 1
            else if (indicators.priceChange24h && indicators.priceChange24h < 0) bearishScore += 1
          } else if (volChange < -20) {
            // Volume decreasing - divergence warning
            if (indicators.priceChange24h && indicators.priceChange24h > 0) bearishScore += 2 // Price up but volume down = bearish divergence
            else if (indicators.priceChange24h && indicators.priceChange24h < 0) bullishScore += 2 // Price down but volume down = potential reversal
          }
        }
        
        // Volume-Price Divergence (from external data if available)
        if (externalData && externalData.enhanced && externalData.enhanced.volumePriceDivergence !== 0) {
          const volPriceDiv = externalData.enhanced.volumePriceDivergence
          if (volPriceDiv > 0.5) bullishScore += 2 // Bullish divergence (price down, volume up)
          else if (volPriceDiv < -0.5) bearishScore += 2 // Bearish divergence (price up, volume down)
        }
        
        // Convert scores to counts for percentage calculation
        const totalScore = bullishScore + bearishScore
        const bullishPercent = totalScore > 0 ? (bullishScore / totalScore) * 100 : 0
        const bearishPercent = totalScore > 0 ? (bearishScore / totalScore) * 100 : 0
        
        // ═══════════════════════════════════════════════════════════════
        // EARLY REJECTION: Check indicator majority BEFORE auto-correct
        // Reject signal if strongly contradicts indicator majority (75%+ mismatch)
        // ═══════════════════════════════════════════════════════════════
        const originalSignal = signal.signal
        const isBuySignalEarly = originalSignal === 'buy_to_enter' || originalSignal === 'add'
        const isSellSignalEarly = originalSignal === 'sell_to_enter'
        const strongBearishMismatch = isBuySignalEarly && bearishPercent >= 75 // BUY but 75%+ bearish
        const strongBullishMismatch = isSellSignalEarly && bullishPercent >= 75 // SELL but 75%+ bullish
        
        // Early rejection if signal strongly contradicts indicator majority (75%+)
        // This prevents wasting time on signals that will be rejected anyway
        if ((strongBearishMismatch || strongBullishMismatch) && originalSignal !== 'hold') {
          const mismatchDirection = strongBearishMismatch ? 'bearish' : 'bullish'
          const mismatchPercent = strongBearishMismatch ? bearishPercent : bullishPercent
          console.warn(`🚨 EARLY REJECTION (PRE-AUTO-CORRECT): ${originalSignal} signal on ${signal.coin} rejected - ${mismatchPercent.toFixed(0)}% ${mismatchDirection} indicators contradict signal direction`)
          console.warn(`   → Converting to HOLD to avoid bad trade`)
          signal.signal = 'hold'
          signal.rejected_early_pre_correct = true
          signal.rejection_reason = `${mismatchPercent.toFixed(0)}% ${mismatchDirection} indicators contradict ${originalSignal} signal (pre-auto-correct rejection)`
          continue // Skip auto-correct and position sizing
        }
        
        // Auto-correct signal direction based on majority indicators AND daily trend
        let signalCorrected = false
        
        // Check daily trend alignment
        const dailyTrend = trendAlignment?.dailyTrend
        const isDailyUptrend = dailyTrend === 'uptrend'
        const isDailyDowntrend = dailyTrend === 'downtrend'
        
        // ═══════════════════════════════════════════════════════════════
        // SMART FLIP v2 - Adaptive Confirmation Logic
        // ═══════════════════════════════════════════════════════════════
        
        // Get historical data for momentum calculation
        const historicalData = assetData?.historicalData || assetData?.data?.historicalData
        
        // Calculate Trend Strength Index (-1 to +1)
        const trendStrength = calculateTrendStrengthIndex(indicators, trendAlignment)
        
        // Calculate Recent Momentum (last 3 candles)
        const momentum = calculateRecentMomentum(historicalData, indicators, 3)
        
        // Calculate Adaptive Flip Threshold based on Trend Strength
        const adaptiveThreshold = calculateAdaptiveFlipThreshold(trendStrength)
        
        // Check Major Indicators Alignment
        const bullishAlignment = checkMajorIndicatorsAlignment(indicators, 'bullish')
        const bearishAlignment = checkMajorIndicatorsAlignment(indicators, 'bearish')
        
        // Calculate ATR spike detection (volatility protection)
        let atrSpike = false
        if (indicators.atr && historicalData && historicalData.length >= 20) {
          // Calculate average ATR over last 20 candles
          // Use price range as proxy for ATR if ATR not available in historical
          const recentATRs = []
          for (let i = Math.max(0, historicalData.length - 20); i < historicalData.length; i++) {
            const candle = historicalData[i]
            // Use high-low range as ATR proxy
            const range = candle.high - candle.low
            recentATRs.push(range)
          }
          const avgATR = recentATRs.reduce((a, b) => a + b, 0) / recentATRs.length
          const currentATR = indicators.atr
          // Check if current ATR is > 2x average (volatility spike protection)
          atrSpike = currentATR > (avgATR * 2)
        } else if (indicators.atr && price) {
          // Fallback: if no historical data, use current ATR vs price as rough estimate
          // ATR typically 1-3% of price, so if ATR > 6% of price, consider it high volatility
          const atrPercent = (indicators.atr / price) * 100
          atrSpike = atrPercent > 6 // Very high volatility threshold
        }
        
        // Check market regime - reject if unclear or choppy
        // Don't auto-correct in choppy market - it leads to false signals
        const marketRegimeUnclear = marketRegime && (
          marketRegime.regime === 'choppy' || // Reject all flips in choppy market
          (marketRegime.regime === 'volatile' && marketRegime.volatility === 'extreme')
        )
        
        // Check trend alignment score - require minimum 75 for auto-correct
        // This ensures we only flip signals when there's strong trend alignment
        const trendAlignmentScore = trendAlignment?.alignmentScore || 0
        const trendAlignmentStrong = trendAlignmentScore >= 75 // Require strong alignment (75/100)
        
        // Minimum indicator agreement for auto-correct: 60%
        // This ensures at least 60% of indicators agree before flipping
        const MIN_INDICATOR_AGREEMENT = 60
        
        // Check for truly balanced (1:1) - only reject if exactly equal or very close (diff = 0)
        const isTrulyBalanced = totalScore > 0 && Math.abs(bullishScore - bearishScore) === 0 && totalScore >= 8
        
        // NOTE: BB Upper/Lower are NOT bullish/bearish signals - they indicate overbought/oversold conditions
        // Price ABOVE BB Upper = OVERBOUGHT (do NOT buy here, wait for retrace or short)
        // Price BELOW BB Lower = OVERSOLD (do NOT sell here, wait for bounce or buy)
        
        // CRITICAL: Check overbought/oversold conditions BEFORE auto-correct
        // These conditions should REJECT or FLIP signals, not just adjust confidence
        const isOverbought = indicators.bollingerBands && price > indicators.bollingerBands.upper
        const isOversold = indicators.bollingerBands && price < indicators.bollingerBands.lower
        
        // DISABLED: Overbought flip removed per user request
        // Instead of flipping, show contradiction in justification
        if (isOverbought && (signal.signal === 'buy_to_enter' || signal.signal === 'add')) {
          console.warn(`⚠️  OVERBOUGHT CONDITION for ${signal.coin}: BUY signal but price is ABOVE BB Upper ($${price.toFixed(2)} > $${indicators.bollingerBands.upper.toFixed(2)})`)
          console.warn(`   ⚠️  CONTRADICTION: BUY signal contradicts overbought conditions (${bearishCount} bearish vs ${bullishCount} bullish indicators)`)
          console.warn(`   ⚠️  Signal will remain BUY but justification will show contradictions`)
          // Keep original signal - no flip, no conversion to HOLD
          // if (bearishCount > bullishCount || bearishScore > bullishScore) {
          //   console.log(`   🔄 Flipping to SELL_TO_ENTER (${bearishCount} bearish vs ${bullishCount} bullish indicators)`)
          //   signal.signal = 'sell_to_enter'
          //   signalCorrected = true
          // } else {
          //   console.log(`   ❌ Converting to HOLD - wait for retrace to support before BUY`)
          //   signal.signal = 'hold'
          //   continue
          // }
        }
        
        // RULE: NEVER generate SELL when price is BELOW BB lower (oversold)
        // SMART FLIP: Only flip to BUY when oversold if there are STRONG reversal confirmations
        if (isOversold && signal.signal === 'sell_to_enter') {
          const rsiValue = indicators?.rsi14
          const bullishPercentOfBearish = bearishScore > 0 ? (bullishScore / bearishScore) * 100 : 0
          
          // Check for STRONG reversal confirmations
          const hasBullishRSIDivergence = indicators.rsiDivergence?.divergence?.toLowerCase().includes('bullish')
          const hasBullishMACDDivergence = indicators.macdDivergence?.divergence?.toLowerCase().includes('bullish')
          const hasVolumeSpike = (indicators.volumeChange || 0) > 0.3 // Volume increase > 30%
          const isExtremelyOversold = rsiValue !== undefined && rsiValue !== null && rsiValue < 20
          const hasStrongBullishMACD = indicators.macd && indicators.macd.histogram > 15
          const hasPositiveOBV = indicators.obv && indicators.obv > 0
          const hasAroonUp = indicators.aroon && indicators.aroon.up > indicators.aroon.down
          
          // Count reversal confirmations
          let reversalConfirmations = 0
          if (hasBullishRSIDivergence) reversalConfirmations++
          if (hasBullishMACDDivergence) reversalConfirmations++
          if (hasVolumeSpike) reversalConfirmations++
          if (isExtremelyOversold) reversalConfirmations++
          if (hasStrongBullishMACD) reversalConfirmations++
          if (hasPositiveOBV) reversalConfirmations++
          if (hasAroonUp) reversalConfirmations++
          
          // Check trend alignment - if all timeframes downtrend, need MORE confirmations
          const allTimeframesDowntrend = trendAlignment && 
                                          trendAlignment.dailyTrend === 'downtrend' && 
                                          trendAlignment.aligned === true
          
          // REQUIREMENTS for flipping to BUY when oversold:
          // For AUTONOMOUS + FUTURES mode: More flexible - allow contrarian plays
          // 1. Standard mode: Minimum 2 reversal confirmations OR bullish score >= 35-40%
          // 2. AUTONOMOUS + FUTURES mode: More relaxed - allow low-confidence BUY or risky SELL
          const isAutonomousFutures = TRADING_CONFIG.mode === 'AUTONOMOUS'
          
          // Standard thresholds
          let minConfirmations = allTimeframesDowntrend ? 3 : 2
          let minBullishPercent = allTimeframesDowntrend ? 40 : 35
          
          // AUTONOMOUS + FUTURES: More relaxed thresholds for contrarian plays
          if (isAutonomousFutures) {
            minConfirmations = allTimeframesDowntrend ? 2 : 1  // Relaxed: 2 or 1 confirmations
            minBullishPercent = allTimeframesDowntrend ? 35 : 30  // Relaxed: 35% or 30%
          }
          
          const hasEnoughConfirmations = reversalConfirmations >= minConfirmations
          const hasEnoughBullishScore = bullishPercentOfBearish >= minBullishPercent
          const canFlipToBuy = hasEnoughConfirmations || hasEnoughBullishScore
          
          if (canFlipToBuy) {
            // Skenario 1: Strong reversal confirmations → Flip to BUY
            // BUT: In AUTONOMOUS mode, ALL oversold BUY signals are treated as contrarian plays
            // This allows them to use relaxed thresholds (confidence 20%, EV -$0.50)
            const isWeakReversal = isAutonomousFutures && 
                                  (reversalConfirmations < 3 || bullishPercentOfBearish < 50)
            
            // In AUTONOMOUS mode, mark ALL oversold BUY signals as contrarian plays for relaxed thresholds
            if (isAutonomousFutures) {
              signal.oversold_low_confidence = true
              signal.oversold_contrarian = true
              signal.contrarian_play = true
            }
            
            // DISABLED: Oversold flip removed per user request
            // Instead of flipping, we'll show the contradiction in justification
            collectWarning(signal.coin, `⚠️  OVERSOLD CONDITION: SELL signal but price $${price.toFixed(2)} < BB Lower $${indicators.bollingerBands.lower.toFixed(2)} (oversold)`, [
              `⚠️  CONTRADICTION: SELL signal contradicts oversold conditions (${reversalConfirmations} reversal confirmations, bullish score ${bullishPercentOfBearish.toFixed(1)}% of bearish, RSI: ${rsiValue?.toFixed(2) || 'N/A'})`,
              `📊 Bullish indicators: ${hasBullishRSIDivergence ? 'RSI Divergence, ' : ''}${hasBullishMACDDivergence ? 'MACD Divergence, ' : ''}${hasVolumeSpike ? 'Volume Spike, ' : ''}${isExtremelyOversold ? 'Extreme Oversold, ' : ''}${hasStrongBullishMACD ? 'Strong MACD, ' : ''}${hasPositiveOBV ? 'Positive OBV, ' : ''}${hasAroonUp ? 'Aroon Up' : ''}`,
              `${bullishCount} bullish vs ${bearishCount} bearish indicators, score: ${bullishScore} vs ${bearishScore}`,
              `⚠️  Signal will remain SELL but justification will show contradictions`
            ])
            // Keep original signal - no flip
            // signal.signal = 'buy_to_enter'
            // signalCorrected = true
            
            // Adjust confidence based on confirmations
            if (reversalConfirmations >= 3 || bullishPercentOfBearish >= 50) {
              // Strong reversal - keep normal confidence, but still mark as contrarian in AUTONOMOUS mode
              if (isAutonomousFutures) {
                // Even strong reversals in AUTONOMOUS mode are contrarian plays (oversold bounce)
                // But use higher confidence (30-40% instead of 25-32%)
                const baseConfidence = 0.30
                const confirmationBonus = Math.min(0.10, reversalConfirmations * 0.02)
                const bullishBonus = Math.min(0.10, (bullishPercentOfBearish / 50) * 0.10)
                const contrarianConfidence = Math.min(0.40, baseConfidence + confirmationBonus + bullishBonus)
                signal.confidence = contrarianConfidence
                signal.oversold_warning = `CONTRARIAN PLAY: Oversold bounce (strong reversal). Confidence: ${(contrarianConfidence * 100).toFixed(1)}% - use tight stop loss.`
              }
            } else if (isWeakReversal) {
              // Weak reversal - but still need minimum 35% confidence for contrarian plays
              // Base confidence increased to 35% (was 25%) to meet new minimum threshold
              const baseConfidence = 0.35 // Start at 35% (minimum threshold)
              const confirmationBonus = Math.min(0.05, reversalConfirmations * 0.015) // +1.5% per confirmation, max +5%
              const bullishBonus = Math.min(0.05, (bullishPercentOfBearish / minBullishPercent) * 0.05) // Up to +5% based on bullish score
              const contrarianConfidence = Math.min(0.45, baseConfidence + confirmationBonus + bullishBonus)
              signal.confidence = contrarianConfidence
              signal.oversold_warning = `CONTRARIAN PLAY: Oversold bounce attempt. Confidence: ${(contrarianConfidence * 100).toFixed(1)}% (minimum 35%) - use tight stop loss.`
            } else {
              // Moderate reversal - reduce confidence slightly
              signal.confidence = (signal.confidence || 0.5) * 0.9
            }
          } else if (isAutonomousFutures) {
            // DISABLED: Oversold flip removed per user request
            // Instead of flipping, show contradiction in justification
            collectWarning(signal.coin, `⚠️  OVERSOLD CONDITION: SELL signal but price $${price.toFixed(2)} < BB Lower $${indicators.bollingerBands.lower.toFixed(2)} (oversold)`, [
              `⚠️  CONTRADICTION: SELL signal contradicts oversold conditions (${reversalConfirmations} reversal confirmations, bullish ${bullishPercentOfBearish.toFixed(1)}%)`,
              `📊 Bullish indicators: ${hasBullishRSIDivergence ? 'RSI Divergence, ' : ''}${hasBullishMACDDivergence ? 'MACD Divergence, ' : ''}${hasVolumeSpike ? 'Volume Spike, ' : ''}${isExtremelyOversold ? 'Extreme Oversold, ' : ''}${hasStrongBullishMACD ? 'Strong MACD, ' : ''}${hasPositiveOBV ? 'Positive OBV, ' : ''}${hasAroonUp ? 'Aroon Up' : 'None'}`,
              `${bullishCount} bullish vs ${bearishCount} bearish indicators`,
              `⚠️  Signal will remain SELL but justification will show contradictions`
            ])
            // Keep original signal - no flip
            // signal.signal = 'buy_to_enter'
            // signalCorrected = true
          } else {
            // SIGNAL_ONLY or MANUAL_REVIEW mode: Show warning but keep signal
            collectWarning(signal.coin, `⚠️  OVERSOLD CONDITION: SELL signal but price $${price.toFixed(2)} < BB Lower $${indicators.bollingerBands.lower.toFixed(2)} (oversold)`, [
              `⚠️  CONTRADICTION: SELL signal contradicts oversold conditions (${reversalConfirmations}/${minConfirmations} confirmations, bullish ${bullishPercentOfBearish.toFixed(1)}% < ${minBullishPercent}%)`,
              `📊 ${bearishCount} bearish vs ${bullishCount} bullish indicators, ${allTimeframesDowntrend ? 'all timeframes downtrend' : 'mixed timeframes'}`,
              `⚠️  Signal will remain SELL but justification will show contradictions`
            ])
            // Keep original signal - no flip, no conversion to HOLD
            // signal.signal = 'hold'
            // continue
          }
        }
        
        // Reject only if truly balanced (1:1 exactly)
        if (isTrulyBalanced) {
          console.warn(`⚠️  TRULY BALANCED for ${signal.coin}: ${bullishScore} bullish score vs ${bearishScore} bearish score (exactly 1:1)`)
          console.warn(`   ❌ REJECTING signal - market direction completely unclear`)
          signal.signal = 'hold'
          continue
        }
        
        // Reject if market regime unclear
        if (marketRegimeUnclear) {
          console.warn(`⚠️  MARKET REGIME UNCLEAR for ${signal.coin}: ${marketRegime.regime} with ${marketRegime.volatility} volatility`)
          console.warn(`   ❌ REJECTING signal - market conditions too uncertain`)
          signal.signal = 'hold'
          continue
        }
        
        // Check for strong momentum contradictions (Aroon, RSI, Stochastic)
        const aroonUpStrong = indicators.aroon && indicators.aroon.up > 70
        const aroonDownStrong = indicators.aroon && indicators.aroon.down > 70
        const rsiOversold = indicators.rsi14 && indicators.rsi14 < 30
        const rsiOverbought = indicators.rsi14 && indicators.rsi14 > 70
        const stochasticOversold = indicators.stochastic && indicators.stochastic.k < 20
        
        // DISABLED: Momentum flip logic removed per user request
        // Signals will not flip automatically - contradictions will be shown in justification
        // if (signal.signal === 'sell_to_enter' && aroonUpStrong && !isOversold) {
        //   collectWarning(signal.coin, `🔄 MOMENTUM FLIP: SELL signal but Aroon Up ${indicators.aroon.up.toFixed(0)} (strong uptrend) → Flipping to BUY_TO_ENTER`, [
        //     `→ Flipping to BUY_TO_ENTER based on strong momentum`
        //   ])
        //   signal.signal = 'buy_to_enter'
        //   signalCorrected = true
        // } else if (signal.signal === 'buy_to_enter' && aroonDownStrong && !isOverbought && !isOversold) {
        //   if (bearishScore > bullishScore * 1.3) {
        //     collectWarning(signal.coin, `🔄 MOMENTUM FLIP: BUY signal but Aroon Down ${indicators.aroon.down.toFixed(0)} (strong downtrend) + bearish indicators → Flipping to SELL_TO_ENTER`, [
        //       `→ Flipping to SELL_TO_ENTER based on strong bearish momentum (bearish score ${bearishScore} vs bullish ${bullishScore})`
        //     ])
        //     signal.signal = 'sell_to_enter'
        //     signalCorrected = true
        //   } else {
        //     collectWarning(signal.coin, `⚠️  MOMENTUM CONFLICT: BUY signal but Aroon Down ${indicators.aroon.down.toFixed(0)} (downtrend) → Converting to HOLD`, [
        //       `→ Insufficient bearish momentum to flip to SELL, but BUY contradicts downtrend`
        //     ])
        //     signal.signal = 'hold'
        //     continue
        //   }
        // } else if (signal.signal === 'sell_to_enter' && (rsiOversold || stochasticOversold) && !isOversold) {
        //   collectWarning(signal.coin, `🔄 OVERSOLD FLIP: SELL signal but RSI/Stochastic oversold (potential rebound) → Flipping to BUY_TO_ENTER`, [
        //     `→ Flipping to BUY_TO_ENTER - oversold conditions suggest bounce`
        //   ])
        //   signal.signal = 'buy_to_enter'
        //   signalCorrected = true
        // } else if (signal.signal === 'sell_to_enter' && aroonUpStrong && isOversold) {
        //   collectWarning(signal.coin, `🔄 MOMENTUM + OVERSOLD FLIP: SELL signal but Aroon Up ${indicators.aroon.up.toFixed(0)} + Oversold (strong buy signal) → Flipping to BUY_TO_ENTER`, [
        //     `→ Flipping to BUY_TO_ENTER - oversold + strong momentum = buy opportunity`
        //   ])
        //   signal.signal = 'buy_to_enter'
        //   signalCorrected = true
        // } else if (signal.signal === 'buy_to_enter' && aroonDownStrong && isOverbought) {
        //   collectWarning(signal.coin, `🔄 MOMENTUM + OVERBOUGHT FLIP: BUY signal but Aroon Down ${indicators.aroon.down.toFixed(0)} + Overbought (strong sell signal) → Flipping to SELL_TO_ENTER`, [
        //     `→ Flipping to SELL_TO_ENTER - overbought + strong momentum = sell opportunity`
        //   ])
        //   signal.signal = 'sell_to_enter'
        //   signalCorrected = true
        // }
        
        // Show warnings for contradictions instead of flipping
        if (signal.signal === 'sell_to_enter' && aroonUpStrong && !isOversold) {
          collectWarning(signal.coin, `⚠️  MOMENTUM CONTRADICTION: SELL signal but Aroon Up ${indicators.aroon.up.toFixed(0)} (strong uptrend)`, [
            `→ Signal contradicts strong bullish momentum - contradiction will be shown in justification`
          ])
        } else if (signal.signal === 'buy_to_enter' && aroonDownStrong && !isOverbought && !isOversold) {
          collectWarning(signal.coin, `⚠️  MOMENTUM CONTRADICTION: BUY signal but Aroon Down ${indicators.aroon.down.toFixed(0)} (strong downtrend)`, [
            `→ Signal contradicts strong bearish momentum - contradiction will be shown in justification`
          ])
        } else if (signal.signal === 'sell_to_enter' && (rsiOversold || stochasticOversold) && !isOversold) {
          collectWarning(signal.coin, `⚠️  OVERSOLD CONTRADICTION: SELL signal but RSI/Stochastic oversold (potential rebound)`, [
            `→ Signal contradicts oversold conditions - contradiction will be shown in justification`
          ])
        } else if (signal.signal === 'sell_to_enter' && aroonUpStrong && isOversold) {
          collectWarning(signal.coin, `⚠️  MOMENTUM + OVERSOLD CONTRADICTION: SELL signal but Aroon Up ${indicators.aroon.up.toFixed(0)} + Oversold (strong buy signal)`, [
            `→ Signal contradicts strong bullish momentum and oversold conditions - contradiction will be shown in justification`
          ])
        } else if (signal.signal === 'buy_to_enter' && aroonDownStrong && isOverbought) {
          collectWarning(signal.coin, `⚠️  MOMENTUM + OVERBOUGHT CONTRADICTION: BUY signal but Aroon Down ${indicators.aroon.down.toFixed(0)} + Overbought (strong sell signal)`, [
            `→ Signal contradicts strong bearish momentum and overbought conditions - contradiction will be shown in justification`
          ])
        }
        
        // ═══════════════════════════════════════════════════════════════
        // SMART FLIP v2 - Flip Conditions with Protections
        // ═══════════════════════════════════════════════════════════════
        
        // ═══════════════════════════════════════════════════════════════
        // Enhanced Protections & Bias Weighting
        // ═══════════════════════════════════════════════════════════════
        
        // 1. Directional Bias Weighting - Penalize counter-trend flips
        let flipConfidence = bullishPercent >= adaptiveThreshold ? bullishPercent : bearishPercent
        const originalSignalDirection = signal.signal
        const isBearishRegime = marketRegime?.regime === 'bearish' || trendStrength < -0.5
        const isBullishRegime = marketRegime?.regime === 'bullish' || trendStrength > 0.5
        
        // Penalize BUY flips in strong downtrend
        if (trendStrength < -0.5 && originalSignalDirection === 'sell_to_enter') {
          flipConfidence -= 10 // Reduce confidence by 10 points
        }
        
        // Penalize SELL flips in strong uptrend
        if (trendStrength > 0.5 && originalSignalDirection === 'buy_to_enter') {
          flipConfidence -= 10 // Reduce confidence by 10 points
        }
        
        // 2. Momentum Confirmation Window - Require minimum momentum strength
        const minMomentumStrength = 0.4
        const momentumTooWeak = momentum.momentumStrength < minMomentumStrength
        
        // 3. Bias BB & OBV in Bearish Regime
        let adjustedBullishScore = bullishScore
        let adjustedBearishScore = bearishScore
        if (isBearishRegime) {
          // In bearish regime, price below BB middle is neutral, not bullish
          if (indicators.bollingerBands && price < indicators.bollingerBands.middle) {
            // Remove bullish score from BB position if it was counted
            // This is handled in the scoring logic, but we can adjust here if needed
          }
          
          // OBV must be > +3% vs 24h average to be considered bullish
          if (indicators.obv !== null && indicators.obv !== undefined) {
            // Calculate 24h average OBV (simplified: use current OBV trend)
            // If OBV is only slightly positive, treat as neutral in bearish regime
            if (indicators.obv > 0 && indicators.obv < 1000000) {
              // Small positive OBV in bearish regime = neutral, reduce bullish score
              adjustedBullishScore = Math.max(0, adjustedBullishScore - 1)
            }
          }
        }
        
        // Recalculate percentages with adjusted scores
        const adjustedTotalScore = adjustedBullishScore + adjustedBearishScore
        const adjustedBullishPercent = adjustedTotalScore > 0 ? (adjustedBullishScore / adjustedTotalScore) * 100 : 0
        const adjustedBearishPercent = adjustedTotalScore > 0 ? (adjustedBearishScore / adjustedTotalScore) * 100 : 0
        
        // 4. Bearish Confidence Dampener - Require higher confidence for counter-trend in bearish market
        const bearishConfidenceDampener = isBearishRegime && flipConfidence < 65
        
        // 5. Trend First, Counter Second - Prefer original signal in strong trends
        let preferOriginal = false
        if (originalSignalDirection === 'sell_to_enter' && trendStrength < -0.5) {
          // Strong downtrend + original SELL signal = prefer original
          preferOriginal = true
        } else if (originalSignalDirection === 'buy_to_enter' && trendStrength > 0.5) {
          // Strong uptrend + original BUY signal = prefer original
          preferOriginal = true
        }
        
        // Anti-False Flip Protections
        // Require strong trend alignment (>= 75) and minimum 60% indicator agreement
        const trendWeak = Math.abs(trendStrength) < 0.3
        const shouldSkipFlip = atrSpike || trendWeak || isTrulyBalanced || marketRegimeUnclear || 
                               momentumTooWeak || bearishConfidenceDampener || preferOriginal ||
                               !trendAlignmentStrong || // Require strong trend alignment (>= 75)
                               (adjustedBullishPercent < MIN_INDICATOR_AGREEMENT && adjustedBearishPercent < MIN_INDICATOR_AGREEMENT) // Require minimum 60% agreement
        
        if (shouldSkipFlip) {
          let skipReason = []
          if (atrSpike) skipReason.push('ATR spike > 2x average (high volatility)')
          if (trendWeak) skipReason.push(`Trend Strength ${trendStrength.toFixed(2)} < 0.3 (weak trend)`)
          if (momentumTooWeak) skipReason.push(`Momentum strength ${(momentum.momentumStrength * 100).toFixed(0)}% < 40% (insufficient momentum)`)
          if (bearishConfidenceDampener) skipReason.push(`Bearish regime: confidence ${flipConfidence.toFixed(0)}% < 65% (need stronger confirmation)`)
          if (preferOriginal) skipReason.push(`Trend First: Strong ${trendStrength > 0 ? 'uptrend' : 'downtrend'} prefers original ${originalSignalDirection} signal`)
          if (isTrulyBalanced) skipReason.push('Truly balanced indicators (1:1)')
          if (marketRegimeUnclear) skipReason.push('Market regime unclear')
          
          if (skipReason.length > 0 && (signal.signal === 'sell_to_enter' || signal.signal === 'buy_to_enter')) {
            collectWarning(signal.coin, `⚠️  SMART FLIP v2: Skipping flip (${skipReason.join(', ')})`, [
              `→ Trend Strength: ${trendStrength.toFixed(2)}, Trend Alignment Score: ${trendAlignmentScore}/100, Momentum: ${momentum.recentChange > 0 ? '+' : momentum.recentChange < 0 ? '-' : '0'} (strength: ${(momentum.momentumStrength * 100).toFixed(0)}%), ATR Spike: ${atrSpike ? 'Yes' : 'No'}`,
              preferOriginal ? `→ Preferring original ${originalSignalDirection} signal due to strong trend alignment` : null,
              !trendAlignmentStrong ? `→ Trend alignment score ${trendAlignmentScore} < 75 (minimum required for auto-correct)` : null,
              (adjustedBullishPercent < MIN_INDICATOR_AGREEMENT && adjustedBearishPercent < MIN_INDICATOR_AGREEMENT) ? `→ Indicator agreement ${Math.max(adjustedBullishPercent, adjustedBearishPercent).toFixed(0)}% < ${MIN_INDICATOR_AGREEMENT}% (minimum required)` : null
            ].filter(Boolean))
          }
        }
        
        // DISABLED: SMART FLIP v2 logic removed per user request
        // Signals will not flip automatically - contradictions will be shown in justification
        // const shouldFlipToBullish = !shouldSkipFlip &&
        //   signal.signal === 'sell_to_enter' &&
        //   adjustedBullishPercent >= Math.max(adaptiveThreshold, MIN_INDICATOR_AGREEMENT) &&
        //   bullishAlignment.isAligned &&
        //   trendAlignmentStrong &&
        //   trendStrength > 0.5 &&
        //   !isOverbought &&
        //   momentum.recentChange > 0 &&
        //   flipConfidence >= 50
        // 
        // const shouldFlipToBearish = !shouldSkipFlip &&
        //   signal.signal === 'buy_to_enter' &&
        //   adjustedBearishPercent >= Math.max(adaptiveThreshold, MIN_INDICATOR_AGREEMENT) &&
        //   bearishAlignment.isAligned &&
        //   trendAlignmentStrong &&
        //   trendStrength < -0.5 &&
        //   !isOversold &&
        //   momentum.recentChange < 0 &&
        //   flipConfidence >= 50
        // 
        // if (shouldFlipToBullish) {
        //   signal.signal = 'buy_to_enter'
        //   signalCorrected = true
        //   ...
        // } else if (shouldFlipToBearish) {
        //   signal.signal = 'sell_to_enter'
        //   signalCorrected = true
        //   ...
        // }
        
        // Show indicator majority info for reference (no flip)
        if (totalScore > 0) {
          const majority = bullishScore > bearishScore ? 'bullish' : 'bearish'
          const majorityPercent = bullishScore > bearishScore ? bullishPercent : bearishPercent
          console.log(`📊 Indicator Majority for ${signal.coin}: ${majorityPercent.toFixed(0)}% ${majority} (${Math.max(bullishScore, bearishScore)}/${totalScore} points)`)
          
          // Show contradiction warning if signal doesn't match majority
          if (signal.signal === 'sell_to_enter' && majority === 'bullish' && majorityPercent >= 55) {
            collectWarning(signal.coin, `⚠️  SIGNAL CONTRADICTION: SELL signal but ${majorityPercent.toFixed(0)}% indicators are bullish`, [
              `→ Signal contradicts indicator majority - contradiction will be shown in justification`
            ])
          } else if ((signal.signal === 'buy_to_enter' || signal.signal === 'add') && majority === 'bearish' && majorityPercent >= 55) {
            collectWarning(signal.coin, `⚠️  SIGNAL CONTRADICTION: BUY signal but ${majorityPercent.toFixed(0)}% indicators are bearish`, [
              `→ Signal contradicts indicator majority - contradiction will be shown in justification`
            ])
          } else if (Math.abs(bullishScore - bearishScore) > 0 && majorityPercent < 55) {
            console.log(`   → Signal aligns with majority, keeping original with adjusted confidence`)
          }
        }
        
        // DISABLED: TP/SL recalculation after flip removed per user request
        // Since we're not flipping signals anymore, this code is no longer needed
        // if (signalCorrected && (originalSignalDirection === 'buy_to_enter' || originalSignalDirection === 'sell_to_enter')) {
        //   // Recalculate TP/SL after flip...
        // }
        
        // VALIDATOR: Ensure TP/SL consistency with signal direction
        if (signal.profit_target && signal.stop_loss && entryPrice > 0) {
          const isBuySignal = signal.signal === 'buy_to_enter' || signal.signal === 'add'
          const isSellSignal = signal.signal === 'sell_to_enter'
          
          if (isBuySignal) {
            // BUY: TP should be above entry, SL should be below entry
            if (signal.profit_target < entryPrice || signal.stop_loss > entryPrice) {
              console.error(`🚨 CRITICAL BUG: ${signal.coin} BUY signal has inconsistent TP/SL!`)
              console.error(`   Entry: $${entryPrice.toFixed(2)}, TP: $${signal.profit_target.toFixed(2)}, SL: $${signal.stop_loss.toFixed(2)}`)
              console.error(`   For BUY: TP must be > Entry, SL must be < Entry`)
              // Auto-fix: Recalculate TP/SL
              if (signal.profit_target < entryPrice) {
                signal.profit_target = entryPrice + (slDistance * 2.0)
                console.log(`   🔧 Auto-fixed TP to $${signal.profit_target.toFixed(2)}`)
              }
              if (signal.stop_loss > entryPrice) {
                signal.stop_loss = entryPrice - slDistance
                console.log(`   🔧 Auto-fixed SL to $${signal.stop_loss.toFixed(2)}`)
              }
            }
          } else if (isSellSignal) {
            // SELL: TP should be below entry, SL should be above entry
            if (signal.profit_target > entryPrice || signal.stop_loss < entryPrice) {
              console.error(`🚨 CRITICAL BUG: ${signal.coin} SELL signal has inconsistent TP/SL!`)
              console.error(`   Entry: $${entryPrice.toFixed(2)}, TP: $${signal.profit_target.toFixed(2)}, SL: $${signal.stop_loss.toFixed(2)}`)
              console.error(`   For SELL: TP must be < Entry, SL must be > Entry`)
              // Auto-fix: Recalculate TP/SL
              if (signal.profit_target > entryPrice) {
                signal.profit_target = entryPrice - (slDistance * 2.0)
                console.log(`   🔧 Auto-fixed TP to $${signal.profit_target.toFixed(2)}`)
              }
              if (signal.stop_loss < entryPrice) {
                signal.stop_loss = entryPrice + slDistance
                console.log(`   🔧 Auto-fixed SL to $${signal.stop_loss.toFixed(2)}`)
              }
            }
          }
        }
        
        // Detect contradictions after potential correction/flip
        const contradictionCheck = detectContradictions(signal, indicators, trendAlignment)
        
        // If signal was already flipped, reduce contradiction score (we already addressed it)
        let adjustedContradictionScore = contradictionCheck.contradictionScore
        if (signalCorrected) {
          // Reduce contradiction score by 50% if we already flipped the signal
          adjustedContradictionScore = Math.floor(contradictionCheck.contradictionScore * 0.5)
          console.log(`   📉 Contradiction score reduced from ${contradictionCheck.contradictionScore} to ${adjustedContradictionScore} (signal already flipped)`)
        }
        
        // ═══════════════════════════════════════════════════════════════
        // CRITICAL MACD Histogram Contradiction Check - Auto-Flip/Reject
        // ═══════════════════════════════════════════════════════════════
        
        // Check for MACD histogram contradiction - use tiered thresholds
        const macdHist = indicators.macd?.histogram || 0
        const absMacdHist = Math.abs(macdHist)
        
        // Tiered thresholds:
        // - Extreme (>50): Strong momentum contradiction - auto-flip/reject
        // - High (30-50): Moderate momentum contradiction - consider flip if indicators align
        // - Moderate (20-30): Weak contradiction - reduce confidence only
        const isExtremeMacdContradiction = absMacdHist > 50
        const isHighMacdContradiction = absMacdHist > 30 && absMacdHist <= 50
        const isModerateMacdContradiction = absMacdHist > 20 && absMacdHist <= 30
        
        if ((isExtremeMacdContradiction || isHighMacdContradiction) && !signalCorrected) {
          const isBuySignal = signal.signal === 'buy_to_enter' || signal.signal === 'add'
          const isSellSignal = signal.signal === 'sell_to_enter'
          
          // DISABLED: MACD histogram flip removed per user request
          // Instead of flipping, show contradiction in justification
          // SELL signal but MACD histogram positive (>30) = bullish momentum
          if (isSellSignal && macdHist > 30) {
            const bullishIndicatorsCount = bullishScore
            const bearishIndicatorsCount = bearishScore
            const severity = isExtremeMacdContradiction ? 'very' : 'strong'
            console.warn(`⚠️  MACD CONTRADICTION: SELL signal but MACD histogram +${macdHist.toFixed(2)} (${severity} bullish momentum)`)
            console.warn(`   → Bullish indicators: ${bullishIndicatorsCount}, Bearish: ${bearishIndicatorsCount}`)
            console.warn(`   ⚠️  Signal will remain SELL but justification will show contradictions`)
            // Keep original signal - no flip, no conversion to HOLD
            // if (shouldCheckFlip) {
            //   if (bullishIndicatorsCount >= bearishIndicatorsCount - 2 || bullishPercent >= 50) {
            //     signal.signal = 'buy_to_enter'
            //     signalCorrected = true
            //     signal.auto_flip_reason = `MACD histogram +${macdHist.toFixed(2)} contradicts SELL signal, bullish indicators ${bullishIndicatorsCount >= bearishIndicatorsCount ? 'outweigh' : 'close to'} bearish`
            //   } else {
            //     signal.signal = 'hold'
            //     signal.contradictions = contradictionCheck.contradictions
            //     signal.contradictionScore = adjustedContradictionScore
            //     continue
            //   }
            // }
          }
          
          // BUY signal but MACD histogram negative (<-30) = bearish momentum
          if (isBuySignal && macdHist < -30) {
            // Check if we should flip to SELL or reject
            const bullishIndicatorsCount = bullishScore
            const bearishIndicatorsCount = bearishScore
            
            // For extreme (<-50): Always check flip/reject
            // For high (-30 to -50): Check flip if bearish indicators are close to bullish (within 2 points)
            const shouldCheckFlip = isExtremeMacdContradiction || 
                                   (isHighMacdContradiction && Math.abs(bearishIndicatorsCount - bullishIndicatorsCount) <= 2)
            
            // DISABLED: MACD histogram flip removed per user request
            // Instead of flipping, show contradiction in justification
            if (shouldCheckFlip) {
              const severity = isExtremeMacdContradiction ? 'very' : 'strong'
              console.warn(`⚠️  MACD CONTRADICTION: BUY signal but MACD histogram ${macdHist.toFixed(2)} (${severity} bearish momentum)`)
              console.warn(`   → Bearish indicators: ${bearishIndicatorsCount}, Bullish: ${bullishIndicatorsCount}`)
              console.warn(`   ⚠️  Signal will remain BUY but justification will show contradictions`)
              // Keep original signal - no flip, no conversion to HOLD
              // if (bearishIndicatorsCount >= bullishIndicatorsCount - 2 || bearishPercent >= 50) {
              //   signal.signal = 'sell_to_enter'
              //   signalCorrected = true
              //   signal.auto_flip_reason = `MACD histogram ${macdHist.toFixed(2)} contradicts BUY signal, bearish indicators ${bearishIndicatorsCount >= bullishIndicatorsCount ? 'outweigh' : 'close to'} bullish`
              // } else {
              //   signal.signal = 'hold'
              //   signal.contradictions = contradictionCheck.contradictions
              //   signal.contradictionScore = adjustedContradictionScore
              //   continue
              // }
            }
          }
        }
        
        // Only reject if EXTREME contradictions (score >= 20) - very rare, and only if not already flipped
        // EXCEPTION: For AUTONOMOUS + FUTURES mode, allow contrarian plays even with extreme contradictions
        // Contrarian plays are high-risk by nature, so contradictions are expected
        // Check if this signal will become a contrarian play (oversold bounce)
        // Note: isOversold is declared above in the oversold check section (line 6264)
        // We need to check it here, but it's in a different scope, so we recalculate it
        const priceForOversoldCheck = indicators.price || signal.entry_price || 0
        const bbLowerForOversoldCheck = indicators.bollingerBands?.lower || 0
        const isOversoldForContrarian = indicators.bollingerBands && priceForOversoldCheck > 0 && bbLowerForOversoldCheck > 0 && 
                                        priceForOversoldCheck < bbLowerForOversoldCheck
        const willBecomeContrarian = isOversoldForContrarian && 
                                     signal.signal === 'sell_to_enter' && 
                                     TRADING_CONFIG.mode === 'AUTONOMOUS'
        
        // Only reject due to extreme contradictions if:
        // 1. Score >= 20 AND
        // 2. Signal was NOT corrected/flipped AND
        // 3. This is NOT going to become a contrarian play (oversold bounce)
        // 4. MACD histogram contradiction already handled above
        const macdContradictionHandled = isExtremeMacdContradiction || isHighMacdContradiction
        if (!signalCorrected && adjustedContradictionScore >= 20 && !willBecomeContrarian && !macdContradictionHandled) {
          console.warn(`🚨 EXTREME CONTRADICTIONS detected for ${signal.signal} signal on ${signal.coin}:`)
          contradictionCheck.contradictions.forEach(cont => console.warn(`   - ${cont}`))
          console.warn(`   ⚠️  Rejecting signal due to extreme contradictions (score: ${adjustedContradictionScore})`)
          signal.signal = 'hold'
          signal.contradictions = contradictionCheck.contradictions
          signal.contradictionScore = adjustedContradictionScore
          continue
        } else if (!signalCorrected && adjustedContradictionScore >= 20 && willBecomeContrarian) {
          // Extreme contradictions but will become contrarian play - allow it, but log warning
          console.warn(`🚨 EXTREME CONTRADICTIONS detected for ${signal.signal} signal on ${signal.coin}:`)
          contradictionCheck.contradictions.forEach(cont => console.warn(`   - ${cont}`))
          console.warn(`   ⚠️  Allowing signal despite contradictions (score: ${adjustedContradictionScore}) - will be processed as contrarian play in AUTONOMOUS mode`)
          signal.contradictions = contradictionCheck.contradictions
          signal.contradictionScore = adjustedContradictionScore
          // Don't convert to hold - let oversold rejection logic handle it
        }
        
        // ═══════════════════════════════════════════════════════════════
        // No-Trade Zone & Exhaustion Detection (BEFORE confidence calculation)
        // ═══════════════════════════════════════════════════════════════
        
        // Check if price is in no-trade zone (exhaustion area)
        const noTradeZoneCheck = checkNoTradeZone(signal, indicators, price)
        
        // ═══════════════════════════════════════════════════════════════
        // Bounce Opportunity Zone Detection
        // Check if price exited no-trade zone and shows reversal potential
        // ═══════════════════════════════════════════════════════════════
        
        // Get historical data for bounce detection
        const historicalDataForBounce = assetData?.historicalData || assetData?.data?.historicalData
        
        // Check bounce setup (price exiting exhaustion zone)
        const bounceSetup = checkBounceSetup(historicalDataForBounce, indicators, price)
        
        if (bounceSetup) {
          // Bounce detected - override signal direction and boost confidence
          const bounceSignal = bounceSetup.type === 'BUY_BOUNCE' ? 'buy_to_enter' : 'sell_to_enter'
          const originalSignal = signal.signal
          
          // Only apply bounce if it makes sense (not contradicting strong trend)
          const shouldApplyBounce = bounceSetup.type === 'BUY_BOUNCE' 
            ? (signal.signal === 'buy_to_enter' || signal.signal === 'hold' || signal.signal === 'sell_to_enter')
            : (signal.signal === 'sell_to_enter' || signal.signal === 'hold' || signal.signal === 'buy_to_enter')
          
          if (shouldApplyBounce) {
            signal.signal = bounceSignal
            signal.bounce_mode = true
            signal.bounce_type = bounceSetup.type
            signal.bounce_strength = bounceSetup.strength
            signal.bounce_confirmations = bounceSetup.confirmations
            signal.bounce_reason = bounceSetup.reason
            
            // Store bounce metadata
            signal.metadata = signal.metadata || {}
            signal.metadata.bounce_detected = true
            signal.metadata.bounce_strength = bounceSetup.strength
            signal.metadata.volume_confirmed = bounceSetup.volumeConfirmed
            signal.metadata.bounce_confirmations = {
              rsi: bounceSetup.rsiOversold || bounceSetup.rsiOverbought,
              stoch: bounceSetup.stochBullish || bounceSetup.stochBearish,
              volume: bounceSetup.volumeConfirmed,
              atr: bounceSetup.atrValid,
              candleBody: bounceSetup.candleBodyValid
            }
            
            collectWarning(signal.coin, `🎯 BOUNCE OPPORTUNITY: ${bounceSetup.reason}`, [
              `→ Price exited exhaustion zone with ${bounceSetup.confirmations}/5 confirmations`,
              `→ Signal changed from ${originalSignal} to ${bounceSignal}`,
              `→ Bounce strength: ${(bounceSetup.strength * 100).toFixed(0)}%`,
              bounceSetup.volumeConfirmed ? `✅ Volume confirmed (above average)` : `⚠️  Volume below average`,
              bounceSetup.atrValid ? `✅ ATR valid (>1.5% of price)` : `⚠️  ATR too low`,
              bounceSetup.candleBodyValid ? `✅ Candle body valid (>0.5×ATR)` : `⚠️  Candle body weak`
            ])
            
            // ═══════════════════════════════════════════════════════════════
            // Bounce Validation: Persistence & EMA Reclaim
            // ═══════════════════════════════════════════════════════════════
            
            // Check bounce persistence (3-5 candle memory)
            const persistenceCheck = checkBouncePersistence(historicalDataForBounce, signal, price)
            
            if (!persistenceCheck.persistent) {
              // Bounce failed - cut confidence 50%
              signal.bounce_persistence_failed = true
              signal.bounce_persistence_reason = persistenceCheck.reason
              signal.bounce_persistence_penalty = persistenceCheck.confidencePenalty
              
              collectWarning(signal.coin, `⚠️  BOUNCE PERSISTENCE FAILED: ${persistenceCheck.reason}`, [
                `→ Confidence will be reduced by 50%`,
                `→ Recommendation: Avoid reentry - bounce may be fake`
              ])
            } else {
              signal.bounce_persistent = true
              signal.bounce_persistence_reason = persistenceCheck.reason
            }
            
            // Check EMA reclaim
            const multiTimeframeIndicatorsForReclaim = assetData?.multiTimeframeIndicators || assetData?.data?.multiTimeframeIndicators
            const emaReclaimCheck = checkEMAReclaim(signal, indicators, multiTimeframeIndicatorsForReclaim, price)
            
            if (!emaReclaimCheck.valid) {
              // EMA reclaim failed - dead cat bounce risk
              signal.bounce_ema_reclaim_failed = true
              signal.bounce_ema_reclaim_reason = emaReclaimCheck.reason
              
              collectWarning(signal.coin, `⚠️  EMA RECLAIM FAILED: ${emaReclaimCheck.reason}`, [
                `→ Dead cat bounce risk detected`,
                `→ Recommendation: Wait for EMA reclaim confirmation before entry`
              ])
            } else {
              signal.bounce_ema_reclaimed = true
              signal.bounce_ema_reclaim_reason = emaReclaimCheck.reason
              if (emaReclaimCheck.emaLevel) {
                signal.bounce_ema_level = emaReclaimCheck.emaLevel
                signal.bounce_ema_timeframe = emaReclaimCheck.timeframe || '1h'
              }
            }
            
            // Store validation metadata
            signal.metadata.bounce_persistence = persistenceCheck.persistent
            signal.metadata.bounce_ema_reclaim = emaReclaimCheck.valid
            
            // ═══════════════════════════════════════════════════════════════
            // Re-entry Filter (Second Attempt Bounce)
            // ═══════════════════════════════════════════════════════════════
            
            // Check if this is a second attempt bounce (persistence failed but EMA reclaimed)
            const reentryCheck = checkReentryBounce(signal, historicalDataForBounce, indicators, multiTimeframeIndicatorsForReclaim, price)
            
            if (reentryCheck.isReentry) {
              // Second attempt bounce detected - boost confidence
              signal.bounce_second_attempt = true
              signal.bounce_second_attempt_boost = reentryCheck.confidenceBoost
              signal.bounce_second_attempt_reason = reentryCheck.reason
              
              collectWarning(signal.coin, `🔄 SECOND ATTEMPT BOUNCE: ${reentryCheck.reason}`, [
                `→ Confidence will be boosted by ${(reentryCheck.confidenceBoost * 100).toFixed(0)}%`,
                `→ EMA reclaimed within ${reentryCheck.candlesSinceFailure} candles after persistence failure`,
                `→ This bounce attempt is more reliable than the first`
              ])
            }
            
            // ═══════════════════════════════════════════════════════════════
            // Monitor Bounce Exit (Adaptive Exit Timing)
            // ═══════════════════════════════════════════════════════════════
            
            // Check if bounce is weakening (for position trimming)
            // Note: entryPrice may not be set yet at bounce detection stage, use current price as fallback
            const entryPriceForExit = signal.entry_price || entryPrice || price
            const exitCheck = monitorBounceExit(signal, historicalDataForBounce, indicators, entryPriceForExit, price)
            
            if (exitCheck.shouldTrim) {
              signal.bounce_exit_signal = true
              signal.bounce_trim_percent = exitCheck.trimPercent
              signal.bounce_exit_reason = exitCheck.reason
              
              collectWarning(signal.coin, `⚠️  BOUNCE EXIT SIGNAL: ${exitCheck.reason}`, [
                `→ Recommend trimming ${(exitCheck.trimPercent * 100).toFixed(0)}% of position`,
                `→ Secure profit without waiting for full TP`,
                `→ Price change from entry: ${exitCheck.priceChange.toFixed(2)}%`
              ])
            }
            
            // ═══════════════════════════════════════════════════════════════
            // Bounce Decay Timer
            // ═══════════════════════════════════════════════════════════════
            
            // Calculate bounce decay based on candles since bounce
            const timeframe = '1h' // Default timeframe (can be made dynamic)
            const decayCheck = calculateBounceDecay(signal, historicalDataForBounce, timeframe)
            
            if (decayCheck.decayPenalty > 0) {
              signal.bounce_decay_penalty = decayCheck.decayPenalty
              signal.bounce_decay_reason = decayCheck.reason
              signal.bounce_candles_since = decayCheck.candlesSinceBounce
              
              collectWarning(signal.coin, `⏰ BOUNCE DECAY: ${decayCheck.reason}`, [
                `→ Confidence will be reduced by ${(decayCheck.decayPenalty * 100).toFixed(0)}%`,
                `→ Bounce may be stale - consider reducing position size`
              ])
            }
          }
        }
        
        if (noTradeZoneCheck.inNoTradeZone && !bounceSetup) {
          // Only reject if in no-trade zone AND no bounce detected
          collectWarning(signal.coin, `🚫 NO-TRADE ZONE: ${noTradeZoneCheck.reason}`, [
            `→ Entry too close to support/resistance or momentum exhaustion detected`,
            `→ Signal ${signal.signal} rejected to avoid whipsaw in exhaustion zone`,
            `→ Recommendation: Wait for price to move away from exhaustion zone or wait for stronger reversal confirmation`
          ])
          signal.signal = 'hold'
          signal.no_trade_zone = true
          signal.no_trade_reason = noTradeZoneCheck.reason
          continue // Skip this signal
        }
        
        // ═══════════════════════════════════════════════════════════════
        // Adaptive Signal Generation - Ensure signal is always generated
        // ═══════════════════════════════════════════════════════════════
        
        // 1. Adaptive Weight Balancer - Recalculate scores with dynamic weights
        const volatilityHigh = atrSpike || (marketRegime && marketRegime.volatility === 'high')
        const adaptiveWeights = getAdaptiveWeights(trendStrength, volatilityHigh, marketRegime)
        
        // 2. Tiered Weight Evaluation
        const tieredEvaluation = evaluateTieredWeights(indicators, signal.signal)
        
        // 3. Weighted Median / Confidence Cluster
        const weightedMedian = calculateWeightedMedian(indicators, bullishScore, bearishScore)
        
        // 4. Check if we need fallback signal generation
        const currentSignal = signal.signal
        const needsFallback = currentSignal === 'hold' || 
                             (currentSignal !== 'buy_to_enter' && currentSignal !== 'sell_to_enter' && currentSignal !== 'add')
        
        // 5. Minimum Signal Heuristic - Fallback to trend-based signal
        if (needsFallback && Math.abs(trendStrength) > 0.4) {
          const fallbackSignal = trendStrength > 0 ? 'buy_to_enter' : 'sell_to_enter'
          const fallbackConfidence = Math.min(0.35 + Math.abs(trendStrength) * 0.5, 0.65)
          
          console.log(`⚙️  Auto-generated fallback signal for ${signal.coin} (trend-based): ${fallbackSignal} (confidence: ${(fallbackConfidence * 100).toFixed(0)}%)`)
          collectWarning(signal.coin, `⚙️  Fallback Signal Generated (Trend-Based)`, [
            `→ Trend Strength: ${trendStrength.toFixed(2)} → ${fallbackSignal}`,
            `→ Confidence: ${(fallbackConfidence * 100).toFixed(0)}% (trend-dominant mode)`,
            `→ Tier 1 Score: ${tieredEvaluation.tier1Score}, Tier 2: ${tieredEvaluation.tier2Score}, Tier 3: ${tieredEvaluation.tier3Score}`
          ])
          
          signal.signal = fallbackSignal
          signal.fallback_signal = true
          signal.fallback_reason = `Trend Strength ${trendStrength.toFixed(2)} > 0.4, using trend-dominant mode`
        }
        
        // 6. Partial Confidence Mode - Ensure confidence is never 0%
        const partialConfidence = calculatePartialConfidence(bullishPercent, bearishPercent, 0.3)
        
        const confidenceResult = calculateConfidenceScore(signal, indicators, trendAlignment, marketRegime, riskRewardRatio, externalData)
        
        // ═══════════════════════════════════════════════════════════════
        // ATR Low Volatility Filter & Momentum Contradiction
        // ═══════════════════════════════════════════════════════════════
        
        // Check if ATR is too low (low volatility = whipsaw risk)
        let atrConfidencePenalty = 0
        if (indicators.atr && price > 0) {
          const atrValue = indicators.atr
          // ATR should be ~2-3% of price for normal volatility
          // Low volatility = ATR < 1.5% of price OR absolute value < 2000 (for lower-priced assets)
          const atrPercent = (atrValue / price) * 100
          
          // Use percentage-based threshold (more accurate for different price levels)
          // For BTC at 100k, ATR < 1.5% = < 1500, but we also check absolute < 2000 for lower-priced assets
          if (atrPercent < 1.5 || (atrValue < 2000 && atrPercent < 2.0)) {
            // Very low ATR = reduce confidence by 10%
            atrConfidencePenalty = 0.10
            signal.atr_low_volatility = true
            signal.atr_value = atrValue
            signal.atr_percent = atrPercent
            collectWarning(signal.coin, `⚠️  Low ATR detected: $${atrValue.toFixed(2)} (${atrPercent.toFixed(2)}% of price)`, [
              `→ Low volatility regime increases whipsaw risk`,
              `→ Confidence will be reduced by 10%`,
              `→ Recommendation: Wait for volatility to increase or use tighter stop loss`
            ])
          }
        }
        
        // Check if MACD histogram contradicts signal direction
        const momentumContradictionPenalty = checkMomentumContradiction(signal, indicators)
        
        if (momentumContradictionPenalty > 0) {
          const macdHist = indicators.macd?.histogram || 0
          const penaltyPercent = (momentumContradictionPenalty * 100).toFixed(0)
          collectWarning(signal.coin, `⚠️  Momentum Contradiction: MACD Histogram ${macdHist > 0 ? '+' : ''}${macdHist.toFixed(2)} contradicts ${signal.signal} signal`, [
            `→ Confidence will be reduced by ${penaltyPercent}%`,
            `→ MACD histogram suggests opposite momentum direction`,
            `→ Recommendation: Consider delaying entry 1 candle or wait for histogram alignment`
          ])
          signal.momentum_contradiction = true
          signal.momentum_contradiction_penalty = momentumContradictionPenalty
        }
        
        // ═══════════════════════════════════════════════════════════════
        // Bounce Confidence Modifier
        // Boost confidence if bounce mode detected, reduce if volume not confirmed
        // ═══════════════════════════════════════════════════════════════
        
        let bounceConfidenceBoost = 0
        let bounceConfidencePenalty = 0
        
        if (signal.bounce_mode && signal.bounce_strength) {
          // Bounce detected - add confidence boost based on strength
          // Base boost: 15% (0.15), can go up to 25% (0.25) based on strength
          bounceConfidenceBoost = 0.15 + (signal.bounce_strength * 0.10) // 0.15 to 0.25
          
          // Check volume confirmation - reduce boost if volume not confirmed
          if (signal.metadata && !signal.metadata.volume_confirmed) {
            bounceConfidencePenalty = 0.10 // Reduce by 10% if volume not confirmed
            collectWarning(signal.coin, `⚠️  Bounce signal volume not confirmed`, [
              `→ Volume below average - reducing bounce confidence boost`,
              `→ Recommendation: Wait for volume confirmation before entry`
            ])
          }
          
          // Mini-bias modifier for counter-trend bounce: additional penalty
          if (signal.bounce_counter_trend_penalty) {
            bounceConfidencePenalty += signal.bounce_counter_trend_penalty
            console.log(`   ⚠️  Counter-trend bounce penalty: -${(signal.bounce_counter_trend_penalty * 100).toFixed(0)}%`)
          }
          
          // Bounce persistence penalty: cut confidence 50% if bounce failed
          if (signal.bounce_persistence_penalty && signal.bounce_persistence_penalty > 0) {
            bounceConfidencePenalty += signal.bounce_persistence_penalty
            console.log(`   ⚠️  Bounce persistence failed penalty: -${(signal.bounce_persistence_penalty * 100).toFixed(0)}%`)
          }
          
          // EMA reclaim penalty: reduce confidence if EMA reclaim failed
          if (signal.bounce_ema_reclaim_failed) {
            bounceConfidencePenalty += 0.15 // Additional 15% penalty for failed EMA reclaim
            console.log(`   ⚠️  EMA reclaim failed penalty: -15%`)
          }
          
          // Second attempt bounce boost: increase confidence if re-entry detected
          if (signal.bounce_second_attempt && signal.bounce_second_attempt_boost) {
            bounceConfidenceBoost += signal.bounce_second_attempt_boost
            console.log(`   ✅ Second attempt bounce boost: +${(signal.bounce_second_attempt_boost * 100).toFixed(0)}%`)
          }
          
          // Bounce decay penalty: reduce confidence based on time since bounce
          if (signal.bounce_decay_penalty && signal.bounce_decay_penalty > 0) {
            bounceConfidencePenalty += signal.bounce_decay_penalty
            console.log(`   ⏰ Bounce decay penalty: -${(signal.bounce_decay_penalty * 100).toFixed(0)}% (${signal.bounce_candles_since} candles since bounce)`)
          }
        }
        
        // Apply penalties: ATR low volatility + Momentum contradiction + Counter-trend
        // Apply boosts: Bounce mode
        if (!confidenceResult.autoRejected) {
          let adjustedConfidence = confidenceResult.confidence
          
          // Apply ATR penalty
          if (atrConfidencePenalty > 0) {
            adjustedConfidence = Math.max(0.2, adjustedConfidence - atrConfidencePenalty)
          }
          
          // Apply momentum contradiction penalty
          if (momentumContradictionPenalty > 0) {
            adjustedConfidence = Math.max(0.2, adjustedConfidence - momentumContradictionPenalty)
          }
          
          // Apply counter-trend penalty (for all signals, not just bounce)
          let counterTrendPenalty = 0
          let isCounterTrend = false
          if (trendAlignment && trendAlignment.dailyTrend) {
            const signalType = signal.signal || signal
            if ((signalType === 'buy_to_enter' || signalType === 'add') && trendAlignment.dailyTrend === 'downtrend') {
              isCounterTrend = true
              counterTrendPenalty = 0.15 // -15% confidence penalty (reduced from -25%)
            } else if (signalType === 'sell_to_enter' && trendAlignment.dailyTrend === 'uptrend') {
              isCounterTrend = true
              counterTrendPenalty = 0.15 // -15% confidence penalty (reduced from -25%)
            }
          }
          
          if (counterTrendPenalty > 0) {
            adjustedConfidence = Math.max(0.2, adjustedConfidence - counterTrendPenalty)
            signal.counter_trend = true
            signal.counter_trend_penalty = counterTrendPenalty
            signal.counter_trend_warning = `COUNTER-TREND PLAY - HIGH RISK`
            signal.counter_trend_position_reduction = 0.4 // 40% of normal position size (middle of 30-50% range)
            collectWarning(signal.coin, `COUNTER-TREND PLAY - HIGH RISK`, [
              `Signal direction (${signal.signal}) contradicts daily trend (${trendAlignment.dailyTrend})`,
              `Confidence reduced by ${(counterTrendPenalty * 100).toFixed(0)}% (from ${(confidenceResult.confidence * 100).toFixed(0)}% to ${(adjustedConfidence * 100).toFixed(0)}%)`,
              `Position size will be reduced to 30-50% of normal (using ${(signal.counter_trend_position_reduction * 100).toFixed(0)}%)`,
              `Use tighter stop loss`,
              `Signal still allowed - not hard rejected based on trend alone`
            ])
          }
          
          // Store isCounterTrend for position sizing
          if (isCounterTrend) {
            signal.isCounterTrend = true
          }
          
          // Apply bounce confidence boost
          if (bounceConfidenceBoost > 0) {
            adjustedConfidence = Math.min(0.9, adjustedConfidence + bounceConfidenceBoost - bounceConfidencePenalty)
            console.log(`   📈 Bounce confidence boost for ${signal.coin}: +${((bounceConfidenceBoost - bounceConfidencePenalty) * 100).toFixed(0)}% (strength: ${(signal.bounce_strength * 100).toFixed(0)}%)`)
          }
          
          // Apply partial confidence if still too low
          if (adjustedConfidence < 0.3) {
            adjustedConfidence = Math.max(partialConfidence, adjustedConfidence)
            confidenceResult.partialConfidenceApplied = true
          }
          
          confidenceResult.confidence = adjustedConfidence
          
          // Log confidence adjustments
          const hasAdjustments = atrConfidencePenalty > 0 || momentumContradictionPenalty > 0 || counterTrendPenalty > 0 || bounceConfidenceBoost > 0
          if (hasAdjustments) {
            // Calculate original confidence by reversing all adjustments
            // Adjusted confidence = original - penalties + (boost - bouncePenalty)
            // So: original = adjusted + penalties - (boost - bouncePenalty)
            const originalConf = adjustedConfidence + atrConfidencePenalty + momentumContradictionPenalty + counterTrendPenalty - bounceConfidenceBoost + bounceConfidencePenalty
            const adjustments = []
            if (atrConfidencePenalty > 0) adjustments.push(`ATR: -${(atrConfidencePenalty * 100).toFixed(0)}%`)
            if (momentumContradictionPenalty > 0) adjustments.push(`Momentum: -${(momentumContradictionPenalty * 100).toFixed(0)}%`)
            if (counterTrendPenalty > 0) adjustments.push(`Counter-trend: -${(counterTrendPenalty * 100).toFixed(0)}%`)
            if (bounceConfidenceBoost > 0) {
              const netBounce = bounceConfidenceBoost - bounceConfidencePenalty
              if (netBounce > 0) {
                adjustments.push(`Bounce: +${(netBounce * 100).toFixed(0)}%`)
              } else if (netBounce < 0) {
                adjustments.push(`Bounce: ${(netBounce * 100).toFixed(0)}%`)
              }
            }
            
            console.log(`   📊 Confidence adjusted for ${signal.coin}: ${(originalConf * 100).toFixed(0)}% → ${(adjustedConfidence * 100).toFixed(0)}% (${adjustments.join(', ')})`)
          }
        }
        
        // Anti-Knife Filter: Reject counter-trend BUY signals (catching falling knife)
        if (signal.signal === 'buy_to_enter' && isCatchingFallingKnife(signal, indicators, trendAlignment)) {
          if (confidenceResult.confidence < 0.50) {
            // Reject if confidence < 50% and no reversal confirmations
            if (!hasReversalConfirmations(indicators)) {
              console.warn(`🔪 REJECTING ${signal.coin} BUY: Catching falling knife (confidence ${(confidenceResult.confidence * 100).toFixed(2)}% < 50%, no reversal confirmations)`)
              console.warn(`   Conditions: All timeframes downtrend, price below EMAs, MACD bearish, OBV very negative`)
              signal.signal = 'hold' // Convert to hold
              continue // Skip this signal
            } else {
              // Allow with strong warning if reversal confirmations exist
              const confirmationCount = getReversalConfirmationCount(indicators)
              
              console.warn(`🔪 HIGH RISK: ${signal.coin} BUY is catching falling knife but has ${confirmationCount} reversal confirmations`)
              signal.anti_knife_warning = `HIGH RISK - Catching falling knife: All timeframes aligned downtrend, price below EMAs, MACD bearish, OBV very negative. Only entering due to ${confirmationCount} reversal confirmations.`
              // Apply additional penalty to confidence
              confidenceResult.confidence = confidenceResult.confidence * 0.7 // Reduce confidence by 30%
            }
          }
        }
        
        // Apply contradiction penalty to confidence (less aggressive, especially if flipped)
        // ═══════════════════════════════════════════════════════════════
        // EARLY REJECTION: Reject signal if too many contradictions BEFORE position sizing
        // ═══════════════════════════════════════════════════════════════
        
        // Check if signal should be rejected early due to high contradictions
        // Reject if:
        // 1. Contradiction score >= 15 (high contradictions)
        // 2. AND indicator majority strongly contradicts signal (70%+ different direction)
        // 3. AND signal was NOT corrected/flipped
        // 4. AND NOT a contrarian play (oversold bounce)
        const contradictionScoreToUse = signalCorrected ? adjustedContradictionScore : contradictionCheck.contradictionScore
        const isBuySignalForReject = signal.signal === 'buy_to_enter' || signal.signal === 'add'
        const isSellSignalForReject = signal.signal === 'sell_to_enter'
        const strongBearishMajority = isBuySignalForReject && bearishPercent >= 70 // BUY signal but 70%+ bearish indicators
        const strongBullishMajority = isSellSignalForReject && bullishPercent >= 70 // SELL signal but 70%+ bullish indicators
        const isContrarianPlayCheck = signal.contrarian_play || signal.oversold_contrarian || willBecomeContrarian
        
        // Early rejection if high contradictions AND strong indicator mismatch
        if (!signalCorrected && contradictionScoreToUse >= 15 && (strongBearishMajority || strongBullishMajority) && !isContrarianPlayCheck) {
          const mismatchDirection = strongBearishMajority ? 'bearish' : 'bullish'
          const mismatchPercent = strongBearishMajority ? bearishPercent : bullishPercent
          console.warn(`🚨 EARLY REJECTION: ${signal.signal} signal on ${signal.coin} rejected due to high contradictions (score: ${contradictionScoreToUse}) and strong ${mismatchDirection} majority (${mismatchPercent.toFixed(0)}%)`)
          console.warn(`   → Signal direction contradicts ${mismatchPercent.toFixed(0)}% of indicators`)
          console.warn(`   → Converting to HOLD to avoid bad trade`)
          signal.signal = 'hold'
          signal.contradictions = contradictionCheck.contradictions
          signal.contradictionScore = contradictionScoreToUse
          signal.rejected_early = true
          signal.rejection_reason = `High contradictions (${contradictionScoreToUse}) and ${mismatchDirection} majority (${mismatchPercent.toFixed(0)}%) contradict ${signal.signal} signal`
          continue // Skip position sizing and confidence calculation
        }
        
        if (contradictionCheck.hasContradictions && !signalCorrected) {
          // Use adjusted score if signal was flipped
          const scoreToUse = signalCorrected ? adjustedContradictionScore : contradictionCheck.contradictionScore
          // Reduced penalty: 3% per contradiction point (was 5%)
          const penaltyMultiplier = 1 - (scoreToUse * 0.03)
          const adjustedConfidence = Math.max(0.2, confidenceResult.confidence * Math.max(0.4, penaltyMultiplier))
          
          if (scoreToUse >= 5) {
            console.warn(`⚠️  CONTRADICTIONS detected for ${signal.signal} signal on ${signal.coin} (${contradictionCheck.severity} severity, score: ${scoreToUse}):`)
            contradictionCheck.contradictions.forEach(cont => console.warn(`   - ${cont}`))
            console.warn(`   📉 Confidence reduced from ${(confidenceResult.confidence * 100).toFixed(2)}% to ${(adjustedConfidence * 100).toFixed(2)}% due to contradictions`)
          }
          
          signal.confidence = adjustedConfidence
        } else if (signalCorrected) {
          // Apply confidence penalty for flipped signals (× 0.7)
          // BUT: Don't apply penalty to contrarian plays - they already have appropriate confidence
          // Contrarian plays (oversold bounce) have confidence set directly above (35-45% range)
          if (signal.contrarian_play || signal.oversold_contrarian) {
            // Contrarian play confidence already set correctly above, don't reduce it further
            // Just log that it's a contrarian play
            console.log(`   📊 Contrarian play confidence: ${(signal.confidence * 100).toFixed(2)}% (no flipped signal penalty applied)`)
          } else {
            // Regular flipped signal - apply penalty
            const baseConfidence = confidenceResult.confidence
            const correctedConfidence = Math.max(0.2, baseConfidence * 0.7)
            console.log(`   📉 Confidence adjusted from ${(baseConfidence * 100).toFixed(2)}% to ${(correctedConfidence * 100).toFixed(2)}% (flipped signal penalty × 0.7)`)
            signal.confidence = correctedConfidence
          }
        } else {
          // No contradictions, use base confidence
          signal.confidence = confidenceResult.confidence
        }
        
        // Store all signal metadata
        signal.confidence_breakdown = confidenceResult.breakdown
        signal.confidence_score = confidenceResult.totalScore
        signal.confidence_max_score = confidenceResult.maxScore
        signal.signal_corrected = signalCorrected
        signal.indicator_majority = { bullish: bullishScore, bearish: bearishScore, bullishPercent, bearishPercent }
        
        // Store adaptive signal generation metadata
        if (tieredEvaluation) {
          signal.tiered_evaluation = {
            tier1Score: tieredEvaluation.tier1Score,
            tier2Score: tieredEvaluation.tier2Score,
            tier3Score: tieredEvaluation.tier3Score,
            totalTierScore: tieredEvaluation.totalScore
          }
        }
        if (weightedMedian) {
          signal.weighted_median = {
            medianScore: weightedMedian.medianScore,
            topIndicators: weightedMedian.topIndicators,
            direction: weightedMedian.direction
          }
        }
        if (adaptiveWeights) {
          signal.adaptive_weights = adaptiveWeights
        }
        if (confidenceResult.partialConfidenceApplied) {
          signal.partial_confidence_applied = true
          signal.partial_confidence_value = partialConfidence
        }
        
        // NOTE: Oversold low confidence is now set directly in the oversold rejection logic (lines 6332-6381)
        // Confidence for contrarian plays (oversold bounce) is calculated and set directly when flipping to BUY
        // This ensures that contrarian plays have appropriate confidence levels (25-40% range)
        // based on reversal confirmations and bullish score percentage
        // No additional penalty is needed here as confidence is already set correctly
        
        // Final validation: Check signal-justification consistency after all modifications
        if (signal.justification && (signal.signal === 'buy_to_enter' || signal.signal === 'sell_to_enter' || signal.signal === 'add')) {
          const finalValidation = validateSignalJustificationConsistency(signal, signal.justification)
          if (!finalValidation.isValid) {
            collectWarning(signal.coin, `⚠️  FINAL VALIDATION: ${finalValidation.reason}`)
            // Regenerate justification if mismatch detected
            if (indicators && (bullishCount !== undefined && bearishCount !== undefined)) {
              signal.justification = generateJustificationFromIndicators(signal, indicators, bullishCount, bearishCount, trendAlignment, externalData)
              collectWarning(signal.coin, `✅ Justification regenerated to match signal direction`)
            }
          }
        }
        
        // Calculate Expected Value (EV) for signal (after confidence is finalized)
        const riskAmount = signal.risk_usd || maxRiskUSD || 1.80
        const finalRiskRewardRatio = signal.risk_reward_ratio || 2.0
        const expectedValue = calculateExpectedValue(signal.confidence, finalRiskRewardRatio, riskAmount)
        signal.expected_value = expectedValue
        
        // Log the calculation for debugging
        console.log(`📊 Position sizing for ${signal.coin}: Entry=$${entryPrice.toFixed(2)}, SL=$${stopLossPrice.toFixed(2)}, Distance=$${slDistance.toFixed(2)}, Leverage=${leverage}x, Risk=$${maxRiskUSD.toFixed(2)}, Size=${positionSize.toFixed(6)}`)
        console.log(`📊 Confidence calculation for ${signal.coin}: ${(signal.confidence * 100).toFixed(2)}% (${signal.confidence_score}/${signal.confidence_max_score} points)`)
        console.log(`📊 Expected Value for ${signal.coin}: $${expectedValue.toFixed(2)} (Confidence: ${(signal.confidence * 100).toFixed(2)}%, R:R: ${finalRiskRewardRatio.toFixed(2)}:1, Risk: $${riskAmount.toFixed(2)})`)
        }
      }
    }
    
    // Calculate confidence for signals that don't have position sizing (HOLD, CLOSE, REDUCE)
    for (const signal of signals) {
      if (!signal.confidence_breakdown && (signal.signal === 'hold' || signal.signal === 'close' || signal.signal === 'close_all' || signal.signal === 'reduce')) {
        const assetData = marketData instanceof Map ? marketData.get(signal.coin) : marketData[signal.coin]
        const indicators = assetData?.indicators
        const trendAlignment = assetData?.trendAlignment
        const marketRegime = indicators?.marketRegime
        const riskRewardRatio = signal.risk_reward_ratio || 0
        const externalData = assetData?.externalData
        
        if (indicators) {
          const confidenceResult = calculateConfidenceScore(signal, indicators, trendAlignment, marketRegime, riskRewardRatio, externalData)
          
          // Check if signal was auto-rejected by Trend Alignment gatekeeper
          // FUTURES TRADING: Much more relaxed threshold (5 for futures vs 15 for spot)
          // For futures, leverage allows for lower trend alignment scores
          // Only reject if trend alignment < 5 (extremely low for futures) or < 15 (spot)
          const FUTURES_TREND_ALIGNMENT_REJECT_THRESHOLD = 5  // Reject only if trend alignment < 5 for futures
          const SPOT_TREND_ALIGNMENT_REJECT_THRESHOLD = 15  // Reject if trend alignment < 15 for spot
          const trendAlignmentThreshold = TRADING_CONFIG.mode === 'AUTONOMOUS' 
            ? FUTURES_TREND_ALIGNMENT_REJECT_THRESHOLD  // Use futures threshold for AUTONOMOUS mode
            : SPOT_TREND_ALIGNMENT_REJECT_THRESHOLD  // Use spot threshold for other modes
          
          if (confidenceResult.autoRejected) {
            // Only reject if trend alignment is below futures threshold
            if (confidenceResult.totalScore < trendAlignmentThreshold) {
              collectWarning(signal.coin, `🚫 AUTO-REJECTED: ${confidenceResult.rejectionReason}`, [
                `Trend Alignment score ${confidenceResult.totalScore}/25 is below minimum threshold of ${trendAlignmentThreshold} (${TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'futures' : 'spot'})`,
                `Signal will not be executed (confidence set to 0%)`
              ])
              signal.confidence = 0  // Ensure confidence is 0
              signal.autoRejected = true
              signal.rejectionReason = confidenceResult.rejectionReason
            } else {
              // Trend alignment is above futures threshold but below spot threshold
              // For futures, allow signal with warning (don't reject)
              signal.trend_alignment_warning = true
              signal.trend_alignment_warning_message = `Low trend alignment score: ${confidenceResult.totalScore}/25 (futures threshold: ${trendAlignmentThreshold}+). Leverage may amplify risk. Proceed with caution.`
              collectWarning(signal.coin, `⚠️  Low trend alignment warning for ${signal.signal} signal (FUTURES): ${confidenceResult.totalScore}/25 < 15 (allowing with warning)`, [
                `   Futures threshold: ${trendAlignmentThreshold}+`,
                `   Signal allowed for futures trading but marked with trend alignment warning`
              ])
              // Don't set autoRejected - allow signal to proceed with warning
              signal.confidence = confidenceResult.confidence  // Use calculated confidence (not 0)
            }
          } else {
            // Signal not auto-rejected - use calculated confidence
            signal.confidence = confidenceResult.confidence
          }
          
          signal.confidence_breakdown = confidenceResult.breakdown
          signal.confidence_score = confidenceResult.totalScore
          signal.confidence_max_score = confidenceResult.maxScore
          
          // Calculate Expected Value (EV) for signals without position sizing
          const riskAmount = signal.risk_usd || 1.80
          const finalRiskRewardRatio = signal.risk_reward_ratio || riskRewardRatio || 2.0
          const expectedValue = calculateExpectedValue(signal.confidence, finalRiskRewardRatio, riskAmount)
          signal.expected_value = expectedValue
        }
      }
    }
    
    // Apply trend alignment penalty before filtering
    // EXCEPTION: Skip penalty for contrarian plays in AUTONOMOUS mode (oversold bounce plays)
    // FUTURES TRADING: Much more relaxed trend alignment penalty threshold
    // For futures, leverage allows for lower trend alignment scores
    // Only apply penalty if trend alignment < 20% (futures) or < 40% (spot)
    const FUTURES_TREND_ALIGNMENT_PENALTY_THRESHOLD = 0.20 // 20% (5/25 points) for futures
    const SPOT_TREND_ALIGNMENT_PENALTY_THRESHOLD = 0.40 // 40% (10/25 points) for spot
    const TREND_ALIGNMENT_PENALTY_THRESHOLD = TRADING_CONFIG.mode === 'AUTONOMOUS' 
      ? FUTURES_TREND_ALIGNMENT_PENALTY_THRESHOLD  // Use futures threshold for AUTONOMOUS mode
      : SPOT_TREND_ALIGNMENT_PENALTY_THRESHOLD  // Use spot threshold for other modes
    for (const signal of signals) {
      // Skip trend alignment penalty for contrarian plays in AUTONOMOUS mode
      // Contrarian plays (oversold bounce) are expected to have low trend alignment - don't penalize
      const isContrarianPlay = signal.contrarian_play || signal.oversold_contrarian || signal.oversold_low_confidence
      if (isContrarianPlay && TRADING_CONFIG.mode === 'AUTONOMOUS') {
        // Contrarian plays are expected to have low trend alignment - don't penalize
        continue
      }
      
      if (signal.confidence_breakdown && Array.isArray(signal.confidence_breakdown)) {
        const trendBreakdown = signal.confidence_breakdown.find(b => b.includes('Trend Alignment'))
        if (trendBreakdown) {
          const match = trendBreakdown.match(/(\d+)\/(\d+)/)
          if (match) {
            const trendAlignmentScore = parseInt(match[1])
            const trendAlignmentMax = parseInt(match[2])
            if (trendAlignmentMax > 0) {
              const trendAlignmentPercent = trendAlignmentScore / trendAlignmentMax
              // Apply penalty if trend alignment < 40%
              if (trendAlignmentPercent < TREND_ALIGNMENT_PENALTY_THRESHOLD && trendAlignmentScore > 0) {
                const oldConfidence = signal.confidence
                signal.confidence *= 0.5 // Reduce confidence by 50%
                console.warn(`⚠️  Applied trend alignment penalty to ${signal.signal} signal for ${signal.coin}: Trend alignment ${(trendAlignmentPercent * 100).toFixed(0)}% < ${(TREND_ALIGNMENT_PENALTY_THRESHOLD * 100).toFixed(0)}%`)
                
                // Recalculate EV after confidence penalty
                if (signal.expected_value !== undefined) {
                  const riskAmount = signal.risk_usd || 1.80
                  const riskRewardRatio = signal.risk_reward_ratio || 2.0
                  signal.expected_value = calculateExpectedValue(signal.confidence, riskRewardRatio, riskAmount)
                }
              }
            }
          }
        }
      }
    }
    
    // Filter out invalid signals with quality thresholds
    // Detect if we're in limited pairs scenario (2 assets or less)
    const marketDataSize = marketData instanceof Map ? marketData.size : Object.keys(marketData || {}).length
    const isLimitedPairs = marketDataSize <= 2
    
    // Use limited pairs thresholds if applicable, otherwise use standard thresholds
    const MIN_CONFIDENCE_THRESHOLD = isLimitedPairs 
      ? parseFloat(process.env.MIN_CONFIDENCE_THRESHOLD || THRESHOLDS.limitedPairs.minConfidence.toString())
      : parseFloat(process.env.MIN_CONFIDENCE_THRESHOLD || THRESHOLDS.confidence.reject.toString())
    
    const MIN_EV_THRESHOLD = isLimitedPairs
      ? parseFloat(process.env.MIN_EV_THRESHOLD || THRESHOLDS.limitedPairs.minEV.toString())
      : parseFloat(process.env.MIN_EV_THRESHOLD || THRESHOLDS.expectedValue.reject.toString())
    
    const MIN_TREND_ALIGNMENT_PERCENT = 0.50 // 50% minimum trend alignment (12.5/25 points)
    const MIN_RISK_REWARD_RATIO = 2.0 // 2:1 minimum risk/reward ratio
    
    // Log threshold mode and trading config
    console.log(`📋 Trading Mode: ${TRADING_CONFIG.mode}`)
    if (isLimitedPairs && TRADING_CONFIG.limitedPairsMode.enabled) {
      console.log(`📊 Limited Pairs Mode (${marketDataSize} assets): Using relaxed thresholds (confidence ≥${(MIN_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%, EV ≥$${MIN_EV_THRESHOLD.toFixed(2)})`)
      console.log(`   Max Risk: $${TRADING_CONFIG.safety.maxRiskPerTrade.toFixed(2)}, Max Positions: ${TRADING_CONFIG.safety.maxOpenPositions}`)
      console.log(`   Allow Oversold: ${TRADING_CONFIG.limitedPairsMode.allowOversoldPlays ? 'Yes' : 'No'}`)
    }
    
    const filteredSignals = signals.filter(signal => {
      // Filter signals without technical indicators (e.g., due to rate limits)
      // FUTURES TRADING: More permissive - allow signals even with limited indicators
      // For futures, we can trade with minimal indicators because:
      // 1. Price action is more important than complex indicators
      // 2. Funding rate and OI provide additional signals
      // 3. Leverage allows for smaller moves to be profitable
      // 4. Can exit quickly if wrong
      const assetData = marketData instanceof Map ? marketData.get(signal.coin) : marketData[signal.coin]
      const indicators = assetData?.indicators || assetData?.data?.indicators
      
      // FUTURES MODE: Allow signals even if no technical indicators (will use price action only)
      if (!assetData || !indicators || !indicators.price) {
        // For futures, we can still generate signals with just price data
        // Mark signal with warning but allow it
        signal.technical_indicators_warning = true
        signal.technical_indicators_warning_message = `No technical indicators available - using price action only. Proceed with caution.`
        collectWarning(signal.coin, `⚠️  No technical indicators available for ${signal.signal} signal (FUTURES): Allowing with price action only`, [
          `   Signal allowed for futures trading but marked with technical indicators warning`,
          `   Consider manual review before executing`
        ])
        // Don't return false - allow signal to proceed with warnings
      } else if (!indicators.rsi14 && !indicators.ema20 && !indicators.macd) {
        // Some indicators missing but price available - allow with warning
        signal.technical_indicators_warning = true
        signal.technical_indicators_warning_message = `Limited technical indicators available - using available data only. Proceed with caution.`
        collectWarning(signal.coin, `⚠️  Limited technical indicators for ${signal.signal} signal (FUTURES): Allowing with available indicators`, [
          `   Signal allowed for futures trading but marked with technical indicators warning`
        ])
        // Don't return false - allow signal to proceed with warnings
      }
      
          // Filter signals with EV < reject threshold
          // FUTURES TRADING: More flexible EV threshold due to leverage and volatility
          // For futures, EV can be more negative because:
          // 1. Leverage amplifies both profit and loss
          // 2. Higher volatility means larger potential swings
          // 3. Can profit from both directions (long/short)
          // 4. Funding rate can affect EV calculation
          const isContrarianPlay = signal.contrarian_play || signal.oversold_contrarian || signal.oversold_low_confidence
          
          // FUTURES MODE: Much more relaxed EV threshold for futures trading
          // Standard futures: -$1.50 (leverage allows more risk)
          // Contrarian plays: -$2.00 (high risk, high reward with leverage)
          // Only reject if EV < -$2.00 (extremely negative, likely unprofitable even with leverage)
          const FUTURES_EV_REJECT_THRESHOLD = -2.00  // Reject only if EV < -$2.00 for futures
          const FUTURES_EV_WARN_THRESHOLD = -1.00    // Warn if EV < -$1.00 for futures
          const contrarianEVThreshold = isContrarianPlay && TRADING_CONFIG.mode === 'AUTONOMOUS' 
            ? -2.00  // Allow negative EV up to -$2.00 for contrarian plays (futures with leverage)
            : -1.50  // Allow negative EV up to -$1.50 for standard futures (leverage amplifies risk/reward)
          
          if (signal.expected_value !== undefined && signal.expected_value !== null) {
            if (signal.expected_value < contrarianEVThreshold) {
              // FUTURES TRADING: Only reject if EV is extremely negative (< -$2.00)
              // For futures, negative EV is more acceptable due to leverage
              const riskAmount = signal.risk_usd || 1.80
              const riskRewardRatio = signal.risk_reward_ratio || 2.0
              const thresholdType = isContrarianPlay && TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'contrarian play (FUTURES)' : 'futures standard'
              
              // Only reject if EV is extremely negative (< -$2.00 for futures)
              if (signal.expected_value < FUTURES_EV_REJECT_THRESHOLD) {
                collectWarning(signal.coin, `⚠️  Removing ${signal.signal} signal: Expected value extremely low (EV: $${signal.expected_value.toFixed(2)} < -$2.00, ${thresholdType} threshold)`, [
                  `   Confidence: ${(signal.confidence * 100).toFixed(2)}%, R:R: ${riskRewardRatio.toFixed(2)}:1, Risk: $${riskAmount.toFixed(2)}`,
                  `   EV too negative even for futures - rejecting signal`
                ])
                return false
              } else if (signal.expected_value < FUTURES_EV_WARN_THRESHOLD) {
                // Warn but allow signal with low EV for futures
                signal.ev_warning = true
                signal.ev_warning_message = `Low expected value for futures: $${signal.expected_value.toFixed(2)} (threshold: $${contrarianEVThreshold.toFixed(2)}). Leverage may amplify risk. Proceed with caution.`
                collectWarning(signal.coin, `⚠️  Low EV warning for ${signal.signal} signal (FUTURES): EV: $${signal.expected_value.toFixed(2)} < -$1.00 (allowing with warning)`, [
                  `   Confidence: ${(signal.confidence * 100).toFixed(2)}%, R:R: ${riskRewardRatio.toFixed(2)}:1, Risk: $${riskAmount.toFixed(2)}`,
                  `   Signal allowed for futures trading but marked with EV warning`
                ])
              } else {
                // EV between threshold and warn threshold: Allow with minor warning
                signal.ev_warning = true
                signal.ev_warning_message = `Marginal expected value for futures: $${signal.expected_value.toFixed(2)}. Consider leverage impact.`
                collectWarning(signal.coin, `⚠️  Marginal EV for ${signal.signal} signal (FUTURES): EV: $${signal.expected_value.toFixed(2)} (allowing with minor warning)`)
              }
            } else if (signal.expected_value < THRESHOLDS.expectedValue.autoTrade) {
          // EV below autoTrade threshold: Add warning flag (skip for contrarian plays)
          if (!isContrarianPlay || TRADING_CONFIG.mode !== 'AUTONOMOUS') {
            signal.ev_warning = true
            const evThreshold = isLimitedPairs ? THRESHOLDS.limitedPairs.minEV : THRESHOLDS.expectedValue.autoTrade
            signal.ev_warning_message = `Expected value below auto-trade threshold: $${signal.expected_value.toFixed(2)} (threshold: $${evThreshold.toFixed(2)}). Consider manual review.`
          }
        } else if (signal.expected_value < THRESHOLDS.expectedValue.display && signal.expected_value >= contrarianEVThreshold) {
          // Slightly negative EV but above reject threshold: Strong warning (skip for contrarian plays)
          if (!isContrarianPlay || TRADING_CONFIG.mode !== 'AUTONOMOUS') {
            signal.ev_warning = true
            signal.ev_warning_message = `Marginal expected value: $${signal.expected_value.toFixed(2)}. High risk - proceed with caution.`
          }
        }
      } else {
        // Fallback: Calculate EV if not already calculated (for signals without position sizing)
        const riskAmount = signal.risk_usd || (isLimitedPairs ? THRESHOLDS.limitedPairs.maxRisk : 1.80)
        const riskRewardRatio = signal.risk_reward_ratio || 2.0
        const expectedValue = calculateExpectedValue(signal.confidence || 0.5, riskRewardRatio, riskAmount)
        signal.expected_value = expectedValue
        
        // Use contrarian EV threshold if applicable (isContrarianPlay already declared above)
        // FUTURES TRADING: Much more relaxed EV threshold
        // Only reject if EV < -$2.00 (extremely negative for futures)
        const FUTURES_EV_REJECT_THRESHOLD = -2.00  // Reject only if EV < -$2.00 for futures
        const FUTURES_EV_WARN_THRESHOLD = -1.00    // Warn if EV < -$1.00 for futures
        
        if (expectedValue < contrarianEVThreshold) {
          const thresholdType = isContrarianPlay && TRADING_CONFIG.mode === 'AUTONOMOUS' ? 'contrarian play (FUTURES)' : 'futures standard'
          
          // Only reject if EV is extremely negative (< -$2.00 for futures)
          if (expectedValue < FUTURES_EV_REJECT_THRESHOLD) {
            collectWarning(signal.coin, `⚠️  Removing ${signal.signal} signal: Expected value extremely low (EV: $${expectedValue.toFixed(2)} < -$2.00, ${thresholdType} threshold)`, [
              `   Confidence: ${(signal.confidence * 100).toFixed(2)}%, R:R: ${riskRewardRatio.toFixed(2)}:1, Risk: $${riskAmount.toFixed(2)}`,
              `   EV too negative even for futures - rejecting signal`
            ])
            return false
          } else if (expectedValue < FUTURES_EV_WARN_THRESHOLD) {
            // Warn but allow signal with low EV for futures
            signal.ev_warning = true
            signal.ev_warning_message = `Low expected value for futures: $${expectedValue.toFixed(2)} (threshold: $${contrarianEVThreshold.toFixed(2)}). Leverage may amplify risk. Proceed with caution.`
            collectWarning(signal.coin, `⚠️  Low EV warning for ${signal.signal} signal (FUTURES): EV: $${expectedValue.toFixed(2)} < -$1.00 (allowing with warning)`, [
              `   Confidence: ${(signal.confidence * 100).toFixed(2)}%, R:R: ${riskRewardRatio.toFixed(2)}:1, Risk: $${riskAmount.toFixed(2)}`,
              `   Signal allowed for futures trading but marked with EV warning`
            ])
          } else {
            // EV between threshold and warn threshold: Allow with minor warning
            signal.ev_warning = true
            signal.ev_warning_message = `Marginal expected value for futures: $${expectedValue.toFixed(2)}. Consider leverage impact.`
            collectWarning(signal.coin, `⚠️  Marginal EV for ${signal.signal} signal (FUTURES): EV: $${expectedValue.toFixed(2)} (allowing with minor warning)`)
          }
        } else if (expectedValue < THRESHOLDS.expectedValue.autoTrade) {
          // EV below autoTrade threshold: Add warning flag (skip for contrarian plays)
          if (!isContrarianPlay || TRADING_CONFIG.mode !== 'AUTONOMOUS') {
            signal.ev_warning = true
            const evThreshold = isLimitedPairs ? THRESHOLDS.limitedPairs.minEV : THRESHOLDS.expectedValue.autoTrade
            signal.ev_warning_message = `Expected value below auto-trade threshold: $${expectedValue.toFixed(2)} (threshold: $${evThreshold.toFixed(2)}). Consider manual review.`
          }
        } else if (expectedValue < THRESHOLDS.expectedValue.display && expectedValue >= contrarianEVThreshold) {
          // Slightly negative EV but above reject threshold: Strong warning (skip for contrarian plays)
          if (!isContrarianPlay || TRADING_CONFIG.mode !== 'AUTONOMOUS') {
            signal.ev_warning = true
            signal.ev_warning_message = `Marginal expected value: $${expectedValue.toFixed(2)}. High risk - proceed with caution.`
          }
        }
      }
      
      // ════════════════════════════════════════════════════════
      // AUTONOMOUS TRADING LOGIC: Determine if signal should auto-execute
      // ════════════════════════════════════════════════════════
      
      // Use autonomous execution logic if in AUTONOMOUS mode
      if (TRADING_CONFIG.mode === 'AUTONOMOUS') {
        const executionDecision = shouldAutoExecute(signal, indicators, accountState)
        
        if (executionDecision.execute) {
          // Signal approved for autonomous execution
          signal.auto_tradeable = true
          signal.positionSizeMultiplier = executionDecision.positionMultiplier
          signal.executionLevel = executionDecision.level
          signal.autoTradeReason = executionDecision.autoTradeReason
          
          // Clear EV warning since signal is auto-tradeable
          signal.ev_warning = false
          signal.ev_warning_message = null
          
          // Set quality based on execution level
          if (executionDecision.level === 'HIGH_CONFIDENCE') {
            signal.quality = 'high'
            signal.quality_label = 'HIGH CONFIDENCE - AUTO-TRADEABLE'
          } else if (executionDecision.level === 'MEDIUM_CONFIDENCE') {
            signal.quality = 'medium'
            signal.quality_label = 'MEDIUM CONFIDENCE - AUTO-TRADEABLE'
          } else if (executionDecision.level === 'LOW_CONFIDENCE_EXTREME') {
            signal.quality = 'low'
            signal.quality_label = 'LOW CONFIDENCE - EXTREME CONDITION - AUTO-TRADEABLE'
          }
          
          // Add warnings from execution decision
          if (executionDecision.warnings && executionDecision.warnings.length > 0) {
            signal.warnings = signal.warnings || []
            signal.warnings.push(...executionDecision.warnings)
          }
          
          // Store execution metadata
          signal.executionPlan = {
            orderType: 'MARKET',  // Market order untuk immediate execution
            leverage: signal.leverage || 10,
            stopLoss: signal.stop_loss,
            takeProfit: signal.profit_target,
            
            // Additional safety for low confidence
            ...(executionDecision.level === 'LOW_CONFIDENCE_EXTREME' && {
              tightenSL: true,        // Tighten SL by 20%
              partialTP: true,        // Take 50% profit at 1.5% gain
              trailingStop: true      // Activate trailing stop
            })
          }
        } else {
          // Signal rejected by autonomous logic
          signal.auto_tradeable = false
          signal.rejectReason = executionDecision.reason
          signal.executionLevel = executionDecision.level
          
          // Set quality to rejected but still classify for display
          const highConfidence = TRADING_CONFIG.thresholds.confidence.high
          const mediumConfidence = TRADING_CONFIG.thresholds.confidence.medium
          const lowConfidence = TRADING_CONFIG.thresholds.confidence.low
          const highEV = TRADING_CONFIG.thresholds.expectedValue.high
          const mediumEV = TRADING_CONFIG.thresholds.expectedValue.medium
          const lowEV = TRADING_CONFIG.thresholds.expectedValue.low
          
          if (signal.confidence >= highConfidence && signal.expected_value >= highEV) {
            signal.quality = 'high'
            signal.quality_label = `REJECTED - HIGH CONFIDENCE (${executionDecision.level})`
          } else if (signal.confidence >= mediumConfidence && signal.expected_value >= mediumEV) {
            signal.quality = 'medium'
            signal.quality_label = `REJECTED - MEDIUM CONFIDENCE (${executionDecision.level})`
          } else if (signal.confidence >= lowConfidence || signal.expected_value >= lowEV) {
            signal.quality = 'low'
            signal.quality_label = `REJECTED - LOW CONFIDENCE (${executionDecision.level})`
          } else {
            signal.quality = 'very_low'
            signal.quality_label = `REJECTED - VERY LOW CONFIDENCE (${executionDecision.level})`
          }
          
          // Set position size multiplier based on quality (even if rejected)
          if (signal.quality === 'high') {
            signal.positionSizeMultiplier = TRADING_CONFIG.positionSizing.highConfidence
          } else if (signal.quality === 'medium') {
            signal.positionSizeMultiplier = TRADING_CONFIG.positionSizing.mediumConfidence
          } else {
            signal.positionSizeMultiplier = TRADING_CONFIG.positionSizing.lowConfidence
          }
        }
      } else {
        // SIGNAL_ONLY or MANUAL_REVIEW mode: Use traditional classification
        const highConfidence = TRADING_CONFIG.thresholds.confidence.high
        const mediumConfidence = TRADING_CONFIG.thresholds.confidence.medium
        const lowConfidence = TRADING_CONFIG.thresholds.confidence.low
        const highEV = TRADING_CONFIG.thresholds.expectedValue.high
        const mediumEV = TRADING_CONFIG.thresholds.expectedValue.medium
        const lowEV = TRADING_CONFIG.thresholds.expectedValue.low
        
        // Use limited pairs thresholds if applicable
        const autoTradeConfidence = isLimitedPairs && TRADING_CONFIG.limitedPairsMode.relaxThresholds 
          ? THRESHOLDS.limitedPairs.minConfidence 
          : highConfidence
        const autoTradeEV = isLimitedPairs && TRADING_CONFIG.limitedPairsMode.relaxThresholds
          ? THRESHOLDS.limitedPairs.minEV
          : highEV
        
        // Classify quality
        if (signal.confidence >= highConfidence && signal.expected_value >= highEV) {
          signal.quality = 'high'
          signal.quality_label = 'HIGH CONFIDENCE - AUTO-TRADEABLE'
          signal.auto_tradeable = false // Signal-only mode: never auto-trade
          signal.positionSizeMultiplier = TRADING_CONFIG.positionSizing.highConfidence
        } else if (signal.confidence >= mediumConfidence && signal.expected_value >= mediumEV) {
          signal.quality = 'medium'
          signal.quality_label = 'MEDIUM CONFIDENCE - MANUAL REVIEW'
          signal.auto_tradeable = false
          signal.positionSizeMultiplier = TRADING_CONFIG.positionSizing.mediumConfidence
        } else if (signal.confidence >= lowConfidence || signal.expected_value >= lowEV) {
          signal.quality = 'low'
          signal.quality_label = 'LOW CONFIDENCE - HIGH RISK'
          signal.auto_tradeable = false
          signal.positionSizeMultiplier = TRADING_CONFIG.positionSizing.lowConfidence
        } else {
          signal.quality = 'very_low'
          signal.quality_label = 'VERY LOW CONFIDENCE - EXTREME RISK'
          signal.auto_tradeable = false
          signal.positionSizeMultiplier = TRADING_CONFIG.positionSizing.lowConfidence * 0.5
        }
      }
      
      // Collect warnings for signals (only for SIGNAL_ONLY or MANUAL_REVIEW mode, or rejected signals in AUTONOMOUS mode)
      if (TRADING_CONFIG.mode !== 'AUTONOMOUS' || !signal.auto_tradeable) {
        signal.warnings = signal.warnings || []
        
        // Only add threshold warnings if not in AUTONOMOUS mode (autonomous mode uses shouldAutoExecute logic)
        if (TRADING_CONFIG.mode !== 'AUTONOMOUS') {
          const autoTradeConfidence = isLimitedPairs && TRADING_CONFIG.limitedPairsMode.relaxThresholds 
            ? THRESHOLDS.limitedPairs.minConfidence 
            : TRADING_CONFIG.thresholds.confidence.high
          const autoTradeEV = isLimitedPairs && TRADING_CONFIG.limitedPairsMode.relaxThresholds
            ? THRESHOLDS.limitedPairs.minEV
            : TRADING_CONFIG.thresholds.expectedValue.high
          
          if (signal.confidence < autoTradeConfidence) {
            signal.warnings.push(`Below auto-trade confidence threshold (${(autoTradeConfidence * 100).toFixed(0)}%)`)
          }
          if (signal.expected_value !== undefined && signal.expected_value < autoTradeEV) {
            signal.warnings.push(`Expected value below auto-trade threshold ($${autoTradeEV.toFixed(2)})`)
          }
        }
        
        // Add general warnings
        if (signal.anti_knife_warning) {
          signal.warnings.push('Catching falling knife scenario detected')
        }
        if (signal.oversold_warning && !THRESHOLDS.limitedPairs.allowOversold) {
          signal.warnings.push('Oversold conditions - potential reversal but high risk')
        } else if (signal.oversold_warning && isLimitedPairs && THRESHOLDS.limitedPairs.allowOversold) {
          // In limited pairs mode, oversold signals are allowed but still warn
          signal.warnings.push('Oversold conditions - allowed in limited pairs mode')
        }
        
        // Add reject reason if rejected in AUTONOMOUS mode
        if (TRADING_CONFIG.mode === 'AUTONOMOUS' && signal.rejectReason) {
          signal.warnings.push(`Rejected: ${signal.rejectReason}`)
        }
      }
      
      // Apply safety limits and position sizing
      if (isLimitedPairs && TRADING_CONFIG.limitedPairsMode.enabled) {
        // Check max risk per trade
        const maxRisk = TRADING_CONFIG.safety.maxRiskPerTrade
        const riskAmount = signal.risk_usd || maxRisk
        if (riskAmount > maxRisk) {
          signal.warnings = signal.warnings || []
          signal.warnings.push(`Risk amount ($${riskAmount.toFixed(2)}) exceeds max risk ($${maxRisk.toFixed(2)})`)
          // Adjust risk to max
          signal.risk_usd = maxRisk
        }
      }
      
      // ════════════════════════════════════════════════════════
      // RISK LIMITS CHECK (only for AUTONOMOUS mode)
      // ════════════════════════════════════════════════════════
      // Note: correlationMatrix is available in the filter scope from generateSignals function
      // We need to pass it through the filter function or access it from closure
      // For now, we'll get it from the outer scope (it's calculated in generateSignals)
      
      // Risk check will be done after filtering, in the main loop where we have access to correlationMatrix
      // Store signal for risk check later
      signal._needsRiskCheck = TRADING_CONFIG.mode === 'AUTONOMOUS' && signal.auto_tradeable
      
      // Apply position sizing multiplier based on confidence
      if (signal.positionSizeMultiplier && signal.positionSizeMultiplier !== 1.0) {
        // Store original values before applying multiplier
        if (signal.quantity) {
          signal.original_quantity = signal.quantity // Store original for reference
          signal.quantity = signal.original_quantity * signal.positionSizeMultiplier
        }
        if (signal.risk_usd) {
          signal.original_risk_usd = signal.risk_usd // Store original for reference
          signal.risk_usd = signal.original_risk_usd * signal.positionSizeMultiplier
        }
        // Store position size note for display
        const sizePercent = (signal.positionSizeMultiplier * 100).toFixed(0)
        if (TRADING_CONFIG.mode === 'AUTONOMOUS' && signal.auto_tradeable) {
          signal.position_size_note = `Position size adjusted to ${sizePercent}% for ${signal.executionLevel || signal.quality} (autonomous execution)`
        } else {
          signal.position_size_note = `Position size adjusted to ${sizePercent}% due to ${signal.quality} confidence`
        }
      }
      
          // Filter signals below reject threshold
          // FUTURES TRADING: Much more relaxed confidence threshold due to leverage
          // For futures, lower confidence is acceptable because:
          // 1. Leverage amplifies profit potential
          // 2. Can enter/exit quickly (futures liquidity)
          // 3. Can profit from both directions (long/short)
          // 4. Funding rate can provide additional edge
          // Note: isContrarianPlay is already declared above in EV filter section
          // FUTURES MODE: Much lower confidence thresholds
          // Standard futures: 10% (leverage allows lower confidence)
          // Contrarian plays: 8% (high risk, high reward with leverage)
          // Only reject if confidence < 5% (extremely low, likely random)
          const FUTURES_CONFIDENCE_REJECT_THRESHOLD = 0.05  // Reject only if confidence < 5% for futures
          const FUTURES_CONFIDENCE_WARN_THRESHOLD = 0.10    // Warn if confidence < 10% for futures
          const contrarianConfidenceThreshold = isContrarianPlay && TRADING_CONFIG.mode === 'AUTONOMOUS'
            ? 0.08  // Allow confidence as low as 8% for contrarian plays (futures with leverage)
            : 0.10  // Allow confidence as low as 10% for standard futures (leverage amplifies profit)
          
          if (signal.confidence < contrarianConfidenceThreshold) {
            const thresholdType = isContrarianPlay && TRADING_CONFIG.mode === 'AUTONOMOUS' 
              ? 'contrarian play (FUTURES)' 
              : 'futures standard'
            
            // Only reject if confidence is extremely low (< 5% for futures)
            if (signal.confidence < FUTURES_CONFIDENCE_REJECT_THRESHOLD) {
              collectWarning(signal.coin, `⚠️  Removing ${signal.signal} signal: Confidence extremely low (${(signal.confidence * 100).toFixed(2)}% < 5%, ${thresholdType})`, [
                `   ${thresholdType} reject threshold: 5%`,
                `   Confidence too low even for futures - rejecting signal`
              ])
              return false
            } else if (signal.confidence < FUTURES_CONFIDENCE_WARN_THRESHOLD) {
              // Warn but allow signal with low confidence for futures
              signal.confidence_warning = true
              signal.confidence_warning_message = `Low confidence for futures: ${(signal.confidence * 100).toFixed(2)}% (threshold: ${(contrarianConfidenceThreshold * 100).toFixed(2)}%). Leverage may amplify risk. Proceed with caution.`
              collectWarning(signal.coin, `⚠️  Low confidence warning for ${signal.signal} signal (FUTURES): ${(signal.confidence * 100).toFixed(2)}% < 10% (allowing with warning)`, [
                `   ${thresholdType} threshold: ${(contrarianConfidenceThreshold * 100).toFixed(2)}%`,
                `   Signal allowed for futures trading but marked with confidence warning`
              ])
            } else {
              // Confidence between threshold and warn threshold: Allow with minor warning
              signal.confidence_warning = true
              signal.confidence_warning_message = `Marginal confidence for futures: ${(signal.confidence * 100).toFixed(2)}%. Consider leverage impact.`
              collectWarning(signal.coin, `⚠️  Marginal confidence for ${signal.signal} signal (FUTURES): ${(signal.confidence * 100).toFixed(2)}% (allowing with minor warning)`)
            }
          }
      
      // Filter invalid HOLD signals (HOLD only valid if active position exists)
      if (signal.signal === 'hold') {
        const position = positions.get(signal.coin)
        if (!position) {
          // HOLD signal without active position - invalid, remove it
          collectWarning(signal.coin, `⚠️  Removing invalid HOLD signal (no active position)`)
          return false
        }
      }
      
      // Filter by external data (funding rate, OI, etc.) - FUTURES TRADING: More permissive
      // For futures, external data is less critical because:
      // 1. Funding rate can change quickly
      // 2. OI can be volatile in futures
      // 3. Exchange flows are less relevant for futures (already on exchange)
      // 4. Leverage allows for smaller moves to be profitable
      const assetDataForExternal = marketData instanceof Map ? marketData.get(signal.coin) : marketData[signal.coin]
      const externalData = assetDataForExternal?.externalData
      
      // FUTURES MODE: Skip strict external data filters - use warnings instead of rejections
      // For futures, external data is informational, not decisive
      const skipExternalFilters = true  // Always skip strict filters for futures - use warnings instead
      
      if (externalData && externalData.hyperliquid) {
        const fundingRate = externalData.hyperliquid.fundingRate
        const fundingRateTrend = externalData.hyperliquid.fundingRateTrend
        const oiTrend = externalData.hyperliquid.oiTrend
        
        // FUTURES MODE: Only warn on extreme funding rate, don't reject
        // Funding rate > 0.25% or < -0.25% = extreme (warn but allow)
        const EXTREME_FUNDING_THRESHOLD = 0.0025 // 0.25% (higher threshold for futures)
        if (Math.abs(fundingRate) > EXTREME_FUNDING_THRESHOLD) {
          signal.funding_rate_warning = true
          signal.funding_rate_warning_message = `Extreme funding rate: ${(fundingRate * 100).toFixed(3)}% (threshold: ${(EXTREME_FUNDING_THRESHOLD * 100).toFixed(3)}%). Consider funding cost impact.`
          collectWarning(signal.coin, `⚠️  Extreme funding rate warning for ${signal.signal} signal (FUTURES): ${(fundingRate * 100).toFixed(3)}% (allowing with warning)`)
          // Don't return false - allow signal to proceed with warning
        }
        
        // FUTURES MODE: Funding rate trend is informational, not decisive
        // Only warn if funding trend contradicts position, don't reject
        if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
          if (fundingRateTrend === 'decreasing' && fundingRate < -0.001) {
            signal.funding_rate_warning = true
            signal.funding_rate_warning_message = `Funding rate trend decreasing (bearish): ${(fundingRate * 100).toFixed(3)}%. Consider short bias.`
            collectWarning(signal.coin, `⚠️  Funding rate trend warning for ${signal.signal} signal (FUTURES): Decreasing (bearish) - allowing with warning`)
            // Don't return false - allow signal to proceed with warning
          }
        } else if (signal.signal === 'sell_to_enter') {
          if (fundingRateTrend === 'increasing' && fundingRate > 0.001) {
            signal.funding_rate_warning = true
            signal.funding_rate_warning_message = `Funding rate trend increasing (bullish): ${(fundingRate * 100).toFixed(3)}%. Consider long bias.`
            collectWarning(signal.coin, `⚠️  Funding rate trend warning for ${signal.signal} signal (FUTURES): Increasing (bullish) - allowing with warning`)
            // Don't return false - allow signal to proceed with warning
          }
        }
      }
      
      // FUTURES MODE: Exchange flow is less relevant for futures (already on exchange)
      // Only warn on extreme flows, don't reject
      if (externalData && externalData.blockchain) {
        const flow = externalData.blockchain.estimatedExchangeFlow
        if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
          // Large inflows (positive) = bearish (warn but allow)
          if (flow > 10000000) { // $10M+ inflow (higher threshold for futures)
            signal.exchange_flow_warning = true
            signal.exchange_flow_warning_message = `Large exchange inflow: $${(flow / 1000000).toFixed(2)}M (bearish). Consider short bias.`
            collectWarning(signal.coin, `⚠️  Large exchange inflow warning for ${signal.signal} signal (FUTURES): $${(flow / 1000000).toFixed(2)}M (allowing with warning)`)
            // Don't return false - allow signal to proceed with warning
          }
        } else if (signal.signal === 'sell_to_enter') {
          // Large outflows (negative) = bullish (warn but allow)
          if (flow < -10000000) { // $10M+ outflow (higher threshold for futures)
            signal.exchange_flow_warning = true
            signal.exchange_flow_warning_message = `Large exchange outflow: $${(Math.abs(flow) / 1000000).toFixed(2)}M (bullish). Consider long bias.`
            collectWarning(signal.coin, `⚠️  Large exchange outflow warning for ${signal.signal} signal (FUTURES): $${(Math.abs(flow) / 1000000).toFixed(2)}M (allowing with warning)`)
            // Don't return false - allow signal to proceed with warning
          }
        }
      }
      
      // Filter by minimum risk/reward ratio (2:1) - BUT: Relax for contrarian plays (oversold bounce)
      // Contrarian plays can have lower R:R because they're high-risk, high-reward plays
      const isContrarianForRR = isContrarianPlay || signal.oversold_contrarian || signal.oversold_low_confidence
      const minRRForSignal = isContrarianForRR && TRADING_CONFIG.mode === 'AUTONOMOUS' 
        ? 1.5  // Allow lower R:R (1.5:1) for contrarian plays (oversold bounce)
        : MIN_RISK_REWARD_RATIO
      
      const riskRewardRatio = signal.risk_reward_ratio || 0
      const entryPrice = signal.entry_price || 0
      const profitTarget = signal.profit_target || 0
      const isScalpingTP = entryPrice > 0 && profitTarget > 0 && Math.abs(profitTarget - entryPrice) <= entryPrice * 0.02 // TP within 2%
      
      // Only remove if R:R is significantly below threshold AND TP is not close (scalping)
      if (riskRewardRatio > 0 && riskRewardRatio < (minRRForSignal - 0.01)) {
        if (!isScalpingTP) {
          collectWarning(signal.coin, `⚠️  Removing ${signal.signal} signal: Risk/Reward ratio too low (${riskRewardRatio.toFixed(2)}:1 < ${minRRForSignal}:1)`)
          return false
        } else {
          // Scalping mode: Allow lower R:R if TP is close
          console.log(`📊 Allowing ${signal.signal} signal for ${signal.coin} with R:R ${riskRewardRatio.toFixed(2)}:1 (scalping TP within 2%)`)
        }
      }
      
      // If risk/reward ratio is not set, try to calculate it
      if (riskRewardRatio === 0 && signal.entry_price && signal.stop_loss && signal.profit_target) {
        const entryPrice = signal.entry_price
        const stopLoss = signal.stop_loss
        const profitTarget = signal.profit_target
        
        const riskDistance = Math.abs(entryPrice - stopLoss)
        const rewardDistance = Math.abs(profitTarget - entryPrice)
        
        if (riskDistance > 0) {
          const calculatedRR = rewardDistance / riskDistance
          if (calculatedRR < minRRForSignal) {
            collectWarning(signal.coin, `⚠️  Removing ${signal.signal} signal: Calculated Risk/Reward ratio too low (${calculatedRR.toFixed(2)}:1 < ${minRRForSignal}:1)`)
            return false
          }
        }
      }
      
      // Check correlation - avoid taking multiple signals in highly correlated assets
      // Skip for contrarian plays in AUTONOMOUS mode (oversold bounce plays are independent)
      const skipCorrelationCheck = (isContrarianPlay || signal.oversold_contrarian || signal.oversold_low_confidence) && TRADING_CONFIG.mode === 'AUTONOMOUS'
      if (!skipCorrelationCheck && !skipExternalFilters) {
        const correlationThreshold = 0.7 // High correlation threshold
        const signalDirection = signal.signal === 'buy_to_enter' || signal.signal === 'add' ? 'long' : 'short'
        
        // Check if there are other signals in correlated assets
        for (const otherSignal of signals) {
          if (otherSignal.coin !== signal.coin && 
              (otherSignal.signal === 'buy_to_enter' || otherSignal.signal === 'sell_to_enter' || otherSignal.signal === 'add')) {
            const otherDirection = otherSignal.signal === 'buy_to_enter' || otherSignal.signal === 'add' ? 'long' : 'short'
            
            // Check correlation between assets
            const pairKey1 = `${signal.coin}-${otherSignal.coin}`
            const pairKey2 = `${otherSignal.coin}-${signal.coin}`
            const correlation = correlationMatrix[pairKey1] || correlationMatrix[pairKey2]
            
            // If assets are highly correlated and signals are in same direction, prefer the one with higher confidence
            if (correlation && Math.abs(correlation) > correlationThreshold && signalDirection === otherDirection) {
              if ((signal.confidence || 0) < (otherSignal.confidence || 0)) {
                collectWarning(signal.coin, `⚠️  Removing ${signal.signal} signal: Highly correlated (${correlation.toFixed(3)}) with ${otherSignal.coin} (${otherSignal.signal}), lower confidence`)
                return false
              }
            }
          }
        }
      }
      
      // Log signal acceptance with quality label (before returning true)
      if (TRADING_CONFIG.mode === 'AUTONOMOUS') {
        if (signal.auto_tradeable) {
          console.log(`   ✅ Auto-tradeable signal for ${signal.coin} (${signal.executionLevel || signal.quality}, confidence: ${(signal.confidence * 100).toFixed(2)}%, EV: $${signal.expected_value?.toFixed(2) || 'N/A'})`)
          if (signal.autoTradeReason) {
            console.log(`      ${signal.autoTradeReason}`)
          }
        } else {
          console.log(`   ❌ Rejected signal for ${signal.coin} (${signal.executionLevel || signal.quality}): ${signal.rejectReason || 'Unknown reason'}`)
        }
      } else {
        if (signal.quality === 'high') {
          console.log(`   ✅ High quality signal for ${signal.coin} (confidence: ${(signal.confidence * 100).toFixed(2)}%, EV: $${signal.expected_value?.toFixed(2) || 'N/A'})`)
        } else if (signal.quality === 'medium') {
          console.log(`   ⚠️  Manual review signal for ${signal.coin} (confidence: ${(signal.confidence * 100).toFixed(2)}%, EV: $${signal.expected_value?.toFixed(2) || 'N/A'})`)
        } else {
          console.log(`   ⚠️  Low-confidence signal for ${signal.coin} (confidence: ${(signal.confidence * 100).toFixed(2)}%, EV: $${signal.expected_value?.toFixed(2) || 'N/A'} - will display with warning)`)
        }
      }
      
      return true // Signal passed all filters
    })

    // ═══════════════════════════════════════════════════════════════
    // Adaptive Thresholds & Relative EV Calculation
    // ═══════════════════════════════════════════════════════════════
    
    // Calculate relative EV threshold based on average EV
    const relativeEVThreshold = calculateRelativeEVThreshold(filteredSignals, MIN_EV_THRESHOLD)
    
    // Apply rolling normalization to confidence for all signals
    for (const signal of filteredSignals) {
      if (signal.confidence !== undefined && signal.confidence !== null) {
        const originalConfidence = signal.confidence
        const normalizedConfidence = normalizeConfidence(originalConfidence)
        
        // Only apply if it increases confidence (helps weak signals)
        if (normalizedConfidence > originalConfidence) {
          signal.confidence = normalizedConfidence
          signal.confidence_normalized = true
          signal.original_confidence = originalConfidence
        }
      }
      
      // Calculate adaptive min confidence for each signal
      const assetDataForAdaptive = marketData instanceof Map ? marketData.get(signal.coin) : marketData[signal.coin]
      const indicatorsForAdaptive = assetDataForAdaptive?.indicators || assetDataForAdaptive?.data?.indicators
      const trendAlignmentForAdaptive = assetDataForAdaptive?.data?.trendAlignment || assetDataForAdaptive?.trendAlignment
      
      if (indicatorsForAdaptive && trendAlignmentForAdaptive) {
        // Calculate trend strength
        const trendStrengthForAdaptive = calculateTrendStrengthIndex(indicatorsForAdaptive, trendAlignmentForAdaptive)
        
        // Get contradiction score (if available)
        const contradictionScore = signal.contradictionScore || 0
        
        // Get volatility (ATR as percentage of price)
        const volatility = indicatorsForAdaptive.atr && indicatorsForAdaptive.price
          ? (indicatorsForAdaptive.atr / indicatorsForAdaptive.price)
          : 0.02 // Default 2%
        
        // Calculate adaptive min confidence
        const adaptiveMinConf = calculateAdaptiveMinConfidence(
          trendStrengthForAdaptive,
          contradictionScore,
          volatility,
          MIN_CONFIDENCE_THRESHOLD
        )
        
        // Store adaptive threshold for reference
        signal.adaptive_min_confidence = adaptiveMinConf
        signal.relative_ev_threshold = relativeEVThreshold
        
        // Bias fallback signal to dominant trend if signal is still 'hold'
        if (signal.signal === 'hold' && Math.abs(trendStrengthForAdaptive) > 0.4) {
          // Check overbought/oversold conditions before generating fallback signal
          const priceForFallback = indicatorsForAdaptive.price || 0
          const bbUpperForFallback = indicatorsForAdaptive.bollingerBands?.upper || 0
          const bbLowerForFallback = indicatorsForAdaptive.bollingerBands?.lower || 0
          const isOverboughtForFallback = bbUpperForFallback > 0 && priceForFallback > bbUpperForFallback
          const isOversoldForFallback = bbLowerForFallback > 0 && priceForFallback < bbLowerForFallback
          
          // Don't generate BUY if overbought, don't generate SELL if oversold
          const proposedDirection = trendStrengthForAdaptive > 0 ? 'buy_to_enter' : 'sell_to_enter'
          if ((proposedDirection === 'buy_to_enter' && isOverboughtForFallback) ||
              (proposedDirection === 'sell_to_enter' && isOversoldForFallback)) {
            console.warn(`⚠️  Bias fallback skipped for ${signal.coin}: Cannot generate ${proposedDirection} when ${isOverboughtForFallback ? 'overbought' : 'oversold'}`)
            // Keep signal as HOLD
            continue
          }
          
          const fallbackDirection = proposedDirection
          let fallbackConfidence = Math.max(signal.confidence || 0.3, 0.35 + Math.abs(trendStrengthForAdaptive) * 0.4)
          
          // Mini-bias for futures short/long: Add confidence boost if strong trend + ADX confirmation
          const adxValue = indicatorsForAdaptive.adx !== null && indicatorsForAdaptive.adx !== undefined
            ? (typeof indicatorsForAdaptive.adx === 'number' ? indicatorsForAdaptive.adx : (indicatorsForAdaptive.adx?.adx || indicatorsForAdaptive.adx))
            : 0
          
          if (Math.abs(trendStrengthForAdaptive) > 0.6 && adxValue > 25) {
            // Strong trend with ADX confirmation = add 10% confidence boost
            fallbackConfidence = Math.min(1.0, fallbackConfidence + 0.10)
            signal.bias = trendStrengthForAdaptive > 0 ? 'long_dominant' : 'short_dominant'
            signal.confidence_boost = 0.10
            signal.confidence_boost_reason = `Strong trend (${trendStrengthForAdaptive.toFixed(2)}) + ADX confirmation (${adxValue.toFixed(1)})`
          }
          
          console.log(`🪶 Bias fallback: Converting HOLD to ${fallbackDirection} for ${signal.coin} (Trend Strength: ${trendStrengthForAdaptive.toFixed(2)}, Confidence: ${(fallbackConfidence * 100).toFixed(0)}%)`)
          
          signal.signal = fallbackDirection
          signal.fallback_signal = true
          signal.fallback_type = 'trend_bias'
          signal.confidence = fallbackConfidence
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // Weighted Decay for Previous Signals
    // Apply confidence decay if new signal has same direction as previous
    // ═══════════════════════════════════════════════════════════════
    
    // Get previous signals from signalHistory (if available in scope)
    // Note: signalHistory is defined at module level, accessible here
    for (const signal of filteredSignals) {
      if (signalHistory && signalHistory.has(signal.coin)) {
        const lastSignal = signalHistory.get(signal.coin)
        
        // Check if signal direction matches previous signal
        const currentDirection = signal.signal === 'buy_to_enter' || signal.signal === 'add' ? 'long' : 
                                signal.signal === 'sell_to_enter' ? 'short' : null
        
        const lastDirection = lastSignal.signal === 'buy_to_enter' || lastSignal.signal === 'add' ? 'long' :
                             lastSignal.signal === 'sell_to_enter' ? 'short' : null
        
        // Apply weighted decay if directions match
        if (currentDirection && lastDirection && currentDirection === lastDirection) {
          const lastConfidence = lastSignal.confidence || 0.5
          const decayedConfidence = lastConfidence * 0.9 // 90% of previous confidence
          
          // Use decayed confidence if it's higher than current (smooth transition)
          if (decayedConfidence > signal.confidence) {
            const originalConfidence = signal.confidence
            signal.confidence = Math.max(signal.confidence, decayedConfidence)
            signal.confidence_decayed = true
            signal.original_confidence_before_decay = originalConfidence
            signal.decay_source_confidence = lastConfidence
            
            console.log(`🔄 Weighted decay applied to ${signal.coin}: ${(originalConfidence * 100).toFixed(0)}% → ${(signal.confidence * 100).toFixed(0)}% (previous: ${(lastConfidence * 100).toFixed(0)}%, same direction: ${currentDirection})`)
          }
        }
      }
    }
    
    // Re-filter with adaptive thresholds
    let finalFilteredSignals = filteredSignals.filter(signal => {
      // Use adaptive min confidence if available
      const minConfToUse = signal.adaptive_min_confidence || MIN_CONFIDENCE_THRESHOLD
      
      // Check confidence with adaptive threshold
      // FUTURES TRADING: Much more relaxed confidence threshold
      // Only reject if confidence < 5% (extremely low for futures)
      const FUTURES_CONFIDENCE_REJECT_THRESHOLD = 0.05  // Reject only if confidence < 5% for futures
      const FUTURES_CONFIDENCE_WARN_THRESHOLD = 0.10    // Warn if confidence < 10% for futures
      
      if (signal.confidence < minConfToUse) {
        const isContrarianPlay = signal.contrarian_play || signal.oversold_contrarian || signal.oversold_low_confidence
        const contrarianConfidenceThreshold = isContrarianPlay && TRADING_CONFIG.mode === 'AUTONOMOUS'
          ? 0.08  // Allow confidence as low as 8% for contrarian plays (futures with leverage)
          : 0.10  // Allow confidence as low as 10% for standard futures (leverage amplifies profit)
        
        if (signal.confidence < contrarianConfidenceThreshold) {
          // Only reject if confidence is extremely low (< 5% for futures)
          if (signal.confidence < FUTURES_CONFIDENCE_REJECT_THRESHOLD) {
            collectWarning(signal.coin, `⚠️  Removing ${signal.signal} signal: Confidence extremely low (${(signal.confidence * 100).toFixed(2)}% < 5%, futures threshold)`)
            return false
          } else if (signal.confidence < FUTURES_CONFIDENCE_WARN_THRESHOLD) {
            // Warn but allow signal with low confidence for futures
            signal.confidence_warning = true
            signal.confidence_warning_message = `Low confidence for futures: ${(signal.confidence * 100).toFixed(2)}% (threshold: ${(contrarianConfidenceThreshold * 100).toFixed(2)}%). Leverage may amplify risk. Proceed with caution.`
            collectWarning(signal.coin, `⚠️  Low confidence warning for ${signal.signal} signal (FUTURES): ${(signal.confidence * 100).toFixed(2)}% < 10% (allowing with warning)`)
          } else {
            // Confidence between threshold and warn threshold: Allow with minor warning
            signal.confidence_warning = true
            signal.confidence_warning_message = `Marginal confidence for futures: ${(signal.confidence * 100).toFixed(2)}%. Consider leverage impact.`
            collectWarning(signal.coin, `⚠️  Marginal confidence for ${signal.signal} signal (FUTURES): ${(signal.confidence * 100).toFixed(2)}% (allowing with minor warning)`)
          }
        }
      }
      
      // Use relative EV threshold
      if (signal.expected_value !== undefined && signal.expected_value !== null) {
        const evThresholdToUse = signal.relative_ev_threshold || relativeEVThreshold
        const isContrarianPlay = signal.contrarian_play || signal.oversold_contrarian || signal.oversold_low_confidence
        // FUTURES TRADING: Much more relaxed EV threshold
        // Only reject if EV < -$2.00 (extremely negative for futures)
        const FUTURES_EV_REJECT_THRESHOLD = -2.00  // Reject only if EV < -$2.00 for futures
        const FUTURES_EV_WARN_THRESHOLD = -1.00    // Warn if EV < -$1.00 for futures
        const contrarianEVThreshold = isContrarianPlay && TRADING_CONFIG.mode === 'AUTONOMOUS'
          ? -2.00  // Allow negative EV up to -$2.00 for contrarian plays (futures with leverage)
          : -1.50  // Allow negative EV up to -$1.50 for standard futures (leverage amplifies risk/reward)
        
        if (signal.expected_value < contrarianEVThreshold) {
          // Only reject if EV is extremely negative (< -$2.00 for futures)
          if (signal.expected_value < FUTURES_EV_REJECT_THRESHOLD) {
            collectWarning(signal.coin, `⚠️  Removing ${signal.signal} signal: Expected value extremely low (EV: $${signal.expected_value.toFixed(2)} < -$2.00, futures threshold)`)
            return false
          } else if (signal.expected_value < FUTURES_EV_WARN_THRESHOLD) {
            // Warn but allow signal with low EV for futures
            signal.ev_warning = true
            signal.ev_warning_message = `Low expected value for futures: $${signal.expected_value.toFixed(2)} (threshold: $${contrarianEVThreshold.toFixed(2)}). Leverage may amplify risk. Proceed with caution.`
            collectWarning(signal.coin, `⚠️  Low EV warning for ${signal.signal} signal (FUTURES): EV: $${signal.expected_value.toFixed(2)} < -$1.00 (allowing with warning)`)
          } else {
            // EV between threshold and warn threshold: Allow with minor warning
            signal.ev_warning = true
            signal.ev_warning_message = `Marginal expected value for futures: $${signal.expected_value.toFixed(2)}. Consider leverage impact.`
            collectWarning(signal.coin, `⚠️  Marginal EV for ${signal.signal} signal (FUTURES): EV: $${signal.expected_value.toFixed(2)} (allowing with minor warning)`)
          }
        }
      }
      
      return true
    })
    
    // ═══════════════════════════════════════════════════════════════
    // FUTURES MODE ADAPTIVE SIGNAL GENERATION
    // Generate fallback signals if no signals were generated
    // ═══════════════════════════════════════════════════════════════
    
    if (TRADING_CONFIG.mode === 'AUTONOMOUS' && finalFilteredSignals.length === 0) {
      console.log(`🪶 FUTURES MODE: No signals generated, attempting fallback signal generation...`)
      
      // Get all assets with trend strength data
      const fallbackCandidates = []
      for (const asset of allowedAssets) {
        const assetData = marketData instanceof Map ? marketData.get(asset) : marketData[asset]
        if (!assetData) continue
        
        const indicators = assetData?.indicators || assetData?.data?.indicators
        const trendAlignment = assetData?.data?.trendAlignment || assetData?.trendAlignment
        
        // FUTURES MODE: Don't skip if no indicators - use price action only
        // For futures, we can generate signals with just price data
        // This will fall through to last-resort signal generation if no indicators
        if (!indicators) {
          // Try to get price from assetData
          const price = assetData?.price || (assetData?.data?.price || 0)
          if (price <= 0) continue
          // Don't skip here - let it fall through to last-resort signal generation
          // Continue to next asset, last-resort will handle it
          continue  // Skip to last-resort signal generation which handles missing indicators
        }
        
        // Calculate trend strength (use 0 if trendAlignment not available)
        let trendStrength = 0
        if (trendAlignment) {
          trendStrength = calculateTrendStrengthIndex(indicators, trendAlignment)
        } else {
          // Fallback: Use indicator majority to determine direction
          // Count bullish vs bearish indicators
          let bullishCount = 0
          let bearishCount = 0
          
          if (indicators.macd?.histogram > 0) bullishCount++
          else if (indicators.macd?.histogram < 0) bearishCount++
          
          if (indicators.obv > 0) bullishCount++
          else if (indicators.obv < 0) bearishCount++
          
          if (indicators.price && indicators.bollingerBands) {
            if (indicators.price > indicators.bollingerBands.middle) bullishCount++
            else bearishCount++
          }
          
          if (indicators.parabolicSAR && indicators.price) {
            if (indicators.price > indicators.parabolicSAR) bullishCount++
            else bearishCount++
          }
          
          // Convert to trend strength (-1 to +1)
          const total = bullishCount + bearishCount
          if (total > 0) {
            trendStrength = (bullishCount - bearishCount) / total
          }
        }
        
        // FUTURES MODE: Much more permissive - generate signal if trendStrength > 0.1 OR indicator majority is clear
        // For futures, we can generate signals with lower trend strength because leverage amplifies profit
        // Also allow signals even if no clear direction (use price action)
        const hasClearDirection = Math.abs(trendStrength) > 0.1 || (indicators && indicators.price) || true  // Always allow for futures
        
        if (hasClearDirection) {
          const price = indicators?.price || (assetData?.price || 0)
          if (price <= 0) continue
          
          const entryPrice = price
          
          // FUTURES MODE: Check overbought/oversold conditions but don't skip
          // For futures, overbought/oversold is less critical because leverage allows for quick exits
          // Only warn, don't skip
          const bbUpper = indicators?.bollingerBands?.upper || 0
          const bbLower = indicators?.bollingerBands?.lower || 0
          const isOverbought = bbUpper > 0 && price > bbUpper
          const isOversold = bbLower > 0 && price < bbLower
          
          // Determine direction based on trend, but respect overbought/oversold
          let direction = trendStrength > 0 ? 'buy_to_enter' : 'sell_to_enter'
          
          // FUTURES MODE: Don't skip if overbought/oversold - just warn
          // For futures, we can still generate signals in extreme zones because leverage allows for quick exits
          if ((direction === 'buy_to_enter' && isOverbought) || (direction === 'sell_to_enter' && isOversold)) {
            console.warn(`⚠️  Fallback signal warning for ${asset}: ${direction} when ${isOverbought ? 'overbought' : 'oversold'} (FUTURES: allowing with warning)`)
            // Don't continue - allow signal to proceed with warning
            // For futures, extreme zones can be profitable with leverage
          }
          
          // Calculate basic TP/SL
          const slDistance = entryPrice * 0.01 // 1% SL
          const profitTarget = direction === 'buy_to_enter'
            ? entryPrice + (slDistance * 2.5) // 2.5:1 R:R
            : entryPrice - (slDistance * 2.5)
          const stopLoss = direction === 'buy_to_enter'
            ? entryPrice - slDistance
            : entryPrice + slDistance
          
          const riskRewardRatio = 2.5
          const riskAmount = 1.80 // Default risk
          
          // More permissive confidence calculation for futures
          let confidence = Math.min(0.35 + Math.abs(trendStrength) * 0.4, 0.65)
          
          // If trendStrength is low, use minimum confidence (35%)
          if (Math.abs(trendStrength) < 0.2) {
            confidence = 0.35
          }
          
          // Mini-bias for futures short/long: Add confidence boost if strong trend + ADX confirmation
          const adxValue = indicators.adx !== null && indicators.adx !== undefined
            ? (typeof indicators.adx === 'number' ? indicators.adx : (indicators.adx?.adx || indicators.adx))
            : 0
          
          let bias = null
          if (Math.abs(trendStrength) > 0.6 && adxValue > 25) {
            // Strong trend with ADX confirmation = add 10% confidence boost
            confidence = Math.min(1.0, confidence + 0.10)
            bias = trendStrength > 0 ? 'long_dominant' : 'short_dominant'
          }
          
          const expectedValue = calculateExpectedValue(confidence, riskRewardRatio, riskAmount)
          
          // FUTURES MODE: Much more permissive EV threshold - allow negative EV for trend-following
          // For futures, negative EV is more acceptable due to leverage
          // Only reject if EV is very negative (< -$2.00 for futures)
          const FUTURES_FALLBACK_EV_THRESHOLD = -2.00  // Reject only if EV < -$2.00 for futures fallback
          if (expectedValue > FUTURES_FALLBACK_EV_THRESHOLD) {
            // Calculate position size for fallback signal
            const leverage = 10
            const positionSize = riskAmount / (slDistance * leverage)
            
            // Generate invalidation_condition for fallback signal (Alpha Arena pattern)
            const supportResistance = {
              supportLevels: indicators?.supportLevels || [],
              resistanceLevels: indicators?.resistanceLevels || []
            }
            const externalData = assetData?.externalData || assetData?.data?.externalData
            
            const fallbackSignalObj = {
              coin: asset,
              signal: direction
            }
            
            const invalidationCondition = generateInvalidationCondition(
              fallbackSignalObj,
              indicators,
              entryPrice,
              stopLoss,
              supportResistance,
              trendAlignment,
              externalData,
              marketData
            )
            
            const fallbackSignal = {
              coin: asset,
              signal: direction,
              entry_price: entryPrice,
              profit_target: profitTarget,
              stop_loss: stopLoss,
              confidence: confidence,
              expected_value: expectedValue,
              risk_reward_ratio: riskRewardRatio,
              risk_usd: riskAmount,
              leverage: leverage,
              quantity: positionSize,
              invalidation_condition: invalidationCondition,
              fallback_signal: true,
              fallback_type: 'trend_fallback',
              fallback_reason: `Trend Strength ${trendStrength.toFixed(2)} > 0.4, no other signals generated`,
              justification: `Fallback signal based on dominant trend (Trend Strength: ${trendStrength.toFixed(2)}). ${direction === 'buy_to_enter' ? 'Uptrend' : 'Downtrend'} detected with sufficient strength.`,
              warnings: [`Fallback signal - generated due to no other valid signals`]
            }
            
            // Add bias and confidence boost info if applicable
            if (bias) {
              fallbackSignal.bias = bias
              fallbackSignal.confidence_boost = 0.10
              fallbackSignal.confidence_boost_reason = `Strong trend (${trendStrength.toFixed(2)}) + ADX confirmation (${adxValue.toFixed(1)})`
            }
            
            fallbackCandidates.push({
              asset: asset,
              trendStrength: trendStrength,
              signal: fallbackSignal,
              ev: expectedValue
            })
          }
        }
      }
      
      // Sort by EV (best first) and add top candidates
      fallbackCandidates.sort((a, b) => b.ev - a.ev)
      
      // FUTURES MODE: Always generate at least 1 signal if no signals exist
      if (fallbackCandidates.length > 0) {
        // Add best candidate(s)
        const candidatesToAdd = Math.min(2, fallbackCandidates.length) // Max 2 fallback signals
        for (const candidate of fallbackCandidates.slice(0, candidatesToAdd)) {
          console.log(`🪶 Fallback ${candidate.signal.signal.toUpperCase()} signal generated for ${candidate.asset} (Trend: ${candidate.trendStrength.toFixed(2)}, EV: $${candidate.ev.toFixed(2)}, Confidence: ${(candidate.signal.confidence * 100).toFixed(0)}%)`)
          finalFilteredSignals.push(candidate.signal)
        }
      } else {
        // Last resort: Generate signal based on price action only (if no trend data available)
        // FUTURES MODE: More permissive - generate signal even without indicators
        console.log(`🪶 FUTURES MODE: No fallback candidates found, generating last-resort signal...`)
        for (const asset of allowedAssets.slice(0, 1)) { // Only generate for first asset
          const assetData = marketData instanceof Map ? marketData.get(asset) : marketData[asset]
          if (!assetData) continue
          
          // FUTURES MODE: Get price from multiple sources
          // For futures, we can generate signals with just price data
          const indicators = assetData?.indicators || assetData?.data?.indicators
          const price = indicators?.price || assetData?.price || assetData?.data?.price || assetData?.markPx || 0
          
          // FUTURES MODE: Only skip if absolutely no price data available
          if (price <= 0) {
            console.warn(`⚠️  Last-resort signal skipped for ${asset}: No price data available`)
            continue
          }
          
          const entryPrice = price
          
          // FUTURES TRADING: More permissive for last-resort signals
          // Check overbought/oversold conditions before generating last-resort signal
          // Only check if indicators are available - if no indicators, proceed anyway
          let isOverbought = false
          let isOversold = false
          if (indicators && indicators.bollingerBands) {
            const bbUpper = indicators.bollingerBands?.upper || 0
            const bbLower = indicators.bollingerBands?.lower || 0
            isOverbought = bbUpper > 0 && price > bbUpper
            isOversold = bbLower > 0 && price < bbLower
          }
          
          // FUTURES TRADING: Allow last-resort signals even in extreme conditions (with warning)
          // For futures, leverage allows for more aggressive entries even in extreme zones
          // Only skip if both indicators are available AND price is in extreme zone
          if (indicators && indicators.bollingerBands && (isOverbought || isOversold)) {
            console.warn(`⚠️  Last-resort signal for ${asset}: Price is ${isOverbought ? 'overbought' : 'oversold'} - generating signal anyway (futures trading allows more aggressive entries)`)
            // Don't skip - proceed with warning for futures trading
          }
          
          // FUTURES TRADING: Use simple price action or default to buy if no indicators
          // For futures, we're more aggressive - default to buy if unclear
          let direction = 'buy_to_enter'
          if (indicators && indicators.ema20 && price < indicators.ema20) {
            direction = 'sell_to_enter'
          } else if (!indicators || !indicators.ema20) {
            // If no indicators available, default to buy (bullish bias for futures)
            direction = 'buy_to_enter'
          }
          
          // Calculate ATR-based stop loss (same as main signal generation)
          // FUTURES TRADING: Use wider stops if no ATR available (2% default)
          let slPercent = 0.02 // Default 2% fallback for futures
          const WICK_BUFFER_PERCENT = 0.003 // 0.3% buffer for wick rejection
          
          if (indicators && indicators.atr && entryPrice > 0) {
            // ATR-based stop loss calculation
            const atr = indicators.atr
            const atrPercent = (atr / entryPrice) * 100
            
            // Determine volatility regime
            let atrMultiplier = 1.5 // Default: 1.5x ATR
            if (atrPercent > 4.0) {
              atrMultiplier = 2.0
              slPercent = Math.max(0.03, (atr * atrMultiplier / entryPrice)) // Minimum 3%
            } else if (atrPercent > 2.5) {
              atrMultiplier = 1.75
              slPercent = Math.max(0.02, (atr * atrMultiplier / entryPrice)) // Minimum 2%
            } else if (atrPercent > 1.5) {
              atrMultiplier = 1.5
              slPercent = Math.max(0.015, (atr * atrMultiplier / entryPrice)) // Minimum 1.5%
            } else {
              atrMultiplier = 1.5
              slPercent = Math.max(0.015, (atr * atrMultiplier / entryPrice)) // Minimum 1.5%
            }
            
            // Add wick buffer
            slPercent += WICK_BUFFER_PERCENT
          }
          
          const slDistance = entryPrice * slPercent
          const profitTarget = direction === 'buy_to_enter'
            ? entryPrice + (slDistance * 2.5) // 2.5:1 R:R for last-resort
            : entryPrice - (slDistance * 2.5)
          const stopLoss = direction === 'buy_to_enter'
            ? entryPrice - slDistance
            : entryPrice + slDistance
          
          // Calculate position size for last-resort signal
          const leverage = 10
          const maxRiskUSD = 1.80
          const positionSize = maxRiskUSD / (slDistance * leverage)
          const riskRewardRatio = 2.5
          
          // Generate invalidation_condition for last-resort signal (Alpha Arena pattern)
          // FUTURES TRADING: Use minimal indicators if full indicators not available
          const supportResistance = {
            supportLevels: indicators?.supportResistance?.support || indicators?.supportLevels || [],
            resistanceLevels: indicators?.supportResistance?.resistance || indicators?.resistanceLevels || []
          }
          const externalData = assetData?.externalData || assetData?.data?.externalData
          const trendAlignmentForLastResort = assetData?.data?.trendAlignment || assetData?.trendAlignment || null
          
          const lastResortSignalObj = {
            coin: asset,
            signal: direction
          }
          
          const invalidationCondition = generateInvalidationCondition(
            lastResortSignalObj,
            indicators,
            entryPrice,
            stopLoss,
            supportResistance,
            trendAlignmentForLastResort,
            externalData,
            marketData
          )
          
          const lastResortSignal = {
            coin: asset,
            signal: direction,
            entry_price: entryPrice,
            profit_target: profitTarget,
            stop_loss: stopLoss,
            confidence: 0.35, // Minimum confidence for last-resort
            expected_value: calculateExpectedValue(0.35, riskRewardRatio, maxRiskUSD),
            risk_reward_ratio: riskRewardRatio,
            risk_usd: maxRiskUSD,
            leverage: leverage,
            quantity: positionSize,
            invalidation_condition: invalidationCondition,
            fallback_signal: true,
            fallback_type: 'last_resort',
            fallback_reason: 'No trend data available, using price action only',
            justification: `Last-resort signal based on price action. ${direction === 'buy_to_enter' ? 'Price above EMA20 suggests long' : 'Price below EMA20 suggests short'}.`,
            warnings: [`Last-resort fallback signal - low confidence (35%)`]
          }
          
          console.log(`🪶 Last-resort ${direction.toUpperCase()} signal generated for ${asset} (Price action only, Confidence: 35%)`)
          finalFilteredSignals.push(lastResortSignal)
          break // Only generate one last-resort signal
        }
      }
    }
    
    // ════════════════════════════════════════════════════════
    // RISK LIMITS CHECK (only for AUTONOMOUS mode, after filtering)
    // ════════════════════════════════════════════════════════
    if (TRADING_CONFIG.mode === 'AUTONOMOUS') {
      for (const signal of finalFilteredSignals) {
        if (signal.auto_tradeable) {
          const riskCheck = checkRiskLimits(signal, accountState, positions, correlationMatrix)
          
          if (!riskCheck.passed) {
            // Risk limits violated - reject signal
            signal.auto_tradeable = false
            signal.rejectReason = `Risk limit violations: ${riskCheck.violations.join('; ')}`
            signal.executionLevel = 'RISK_LIMIT_VIOLATION'
            signal.riskCheck = riskCheck
            
            collectWarning(signal.coin, `⚠️  Risk limit violations for ${signal.signal} signal:`, riskCheck.violations)
            
            // Update quality label to reflect rejection
            signal.quality_label = `REJECTED - ${signal.quality_label} (Risk Limits)`
          } else {
            // Risk check passed - store for reference
            signal.riskCheck = riskCheck
          }
        }
      }
    }

    // Log signal filtering summary
    const originalSignalCount = signals.length
    const afterFirstFilterCount = filteredSignals.length
    const finalSignalCount = finalFilteredSignals.length
    const rejectedByFirstFilter = originalSignalCount - afterFirstFilterCount
    const rejectedBySecondFilter = afterFirstFilterCount - finalSignalCount
    const totalRejected = originalSignalCount - finalSignalCount
    
    if (totalRejected > 0) {
      console.log(`\n📊 Signal Filtering Summary:`)
      console.log(`   AI Generated: ${originalSignalCount} signals`)
      console.log(`   After First Filter: ${afterFirstFilterCount} signals (${rejectedByFirstFilter} rejected)`)
      console.log(`   After Second Filter: ${finalSignalCount} signals (${rejectedBySecondFilter} rejected)`)
      console.log(`   Total Rejected: ${totalRejected} signals`)
      console.log(`   Final Signals: ${finalSignalCount} signals\n`)
    }

    return finalFilteredSignals
  } catch (error) {
    // Check if error is due to AI returning non-JSON or invalid format
    if (error.message && (error.message.includes('AI_MODEL_RETURNED_NON_JSON') || error.message.includes('AI_MODEL_RETURNED_INVALID_SIGNALS'))) {
      console.error('❌ AI model configuration issue detected')
      console.error('❌ The model returned invalid response format')
      console.error('❌ Possible solutions:')
      console.error('   1. The model may not support JSON mode (response_format: { type: "json_object" })')
      console.error('   2. Try a different model that supports structured JSON output')
      console.error('   3. Check OpenRouter model capabilities and documentation')
      console.error('   4. Verify the API key and model ID are correct')
      console.error('   5. The system prompt may need adjustment to ensure JSON output')
      throw new Error(`AI model returned invalid format. The model '${process.env.MODEL_ID || 'meta-llama/llama-4-maverick'}' may not support JSON mode properly. Please try a different model or check the model configuration. Original error: ${error.message}`)
    }
    throw new Error(`Failed to generate signals: ${error.message}`)
  }
}

/**
 * Calculate dynamic leverage based on market conditions
 * @param {Object} indicators - Technical indicators (ATR, ADX, etc.)
 * @param {Object} externalData - External data (COC, volume profile, etc.)
 * @param {Object} signal - Signal object (confidence, profit_target, stop_loss, etc.)
 * @param {number} entryPrice - Entry price
 * @param {number} maxLeverage - Maximum leverage from Hyperliquid for this asset (default: 10)
 * @returns {number} Dynamic leverage (minimum 1x to maxLeverage from Hyperliquid)
 */
function calculateDynamicLeverage(indicators, externalData, signal, entryPrice, maxLeverage = 10) {
  // Base leverage: 1x (minimum)
  // Use maxLeverage from Hyperliquid API (per asset), default to 10 if not provided
  const assetMaxLeverage = maxLeverage || (externalData?.hyperliquid?.maxLeverage) || 10
  let leverage = 1 // Start from minimum 1x
  
  if (!indicators || !entryPrice || entryPrice <= 0) {
    return leverage // Return minimum if no data
  }
  
  // 1. Volatility (ATR) - Lower volatility = higher leverage (inverse relationship)
  const atr = indicators.atr || 0
  if (atr > 0 && entryPrice > 0) {
    const atrPercent = (atr / entryPrice) * 100
    if (atrPercent < 1.0) {
      leverage += 2.0 // Very low volatility: +2x leverage
    } else if (atrPercent < 2.0) {
      leverage += 1.5 // Low volatility: +1.5x leverage
    } else if (atrPercent < 3.0) {
      leverage += 1.0 // Medium volatility: +1x leverage
    } else {
      leverage += 0.5 // High volatility: +0.5x leverage (minimum 3x)
    }
  }
  
  // 2. Trend Strength (ADX) - Stronger trend = higher leverage
  const adx = indicators.adx || 0
  if (adx > 0) {
    if (adx > 50) {
      leverage += 2.0 // Very strong trend: +2x leverage
    } else if (adx >= 40) {
      leverage += 1.5 // Strong trend: +1.5x leverage
    } else if (adx >= 25) {
      leverage += 1.0 // Moderate trend: +1x leverage
    } else {
      leverage += 0.5 // Weak trend: +0.5x leverage
    }
  }
  
  // 3. Confidence Score - Higher confidence = higher leverage
  const confidence = signal.confidence || 0
  if (confidence > 0.7) {
    leverage += 1.5 // Very high confidence: +1.5x leverage
  } else if (confidence >= 0.6) {
    leverage += 1.0 // High confidence: +1x leverage
  } else if (confidence >= 0.5) {
    leverage += 0.5 // Moderate confidence: +0.5x leverage
  }
  // Confidence < 0.5: +0x leverage (minimum 3x)
  
  // 4. Risk/Reward Ratio - Better R:R = higher leverage
  if (signal.profit_target && signal.stop_loss && entryPrice > 0) {
    const profitDistance = Math.abs(signal.profit_target - entryPrice)
    const lossDistance = Math.abs(entryPrice - signal.stop_loss)
    if (lossDistance > 0) {
      const riskRewardRatio = profitDistance / lossDistance
      if (riskRewardRatio > 3.0) {
        leverage += 1.0 // Excellent R:R (>3:1): +1x leverage
      } else if (riskRewardRatio >= 2.0) {
        leverage += 0.5 // Good R:R (2-3:1): +0.5x leverage
      }
      // R:R < 2:1: +0x leverage
    }
  }
  
  // 5. Market Structure (COC) - Clear structure = higher leverage
  if (externalData && externalData.marketStructure && externalData.marketStructure.coc) {
    const coc = externalData.marketStructure.coc
    if (coc.reversalSignal && coc.structureStrength > 70) {
      leverage += 1.0 // Strong reversal signal: +1x leverage
    } else if (coc.structureStrength > 50) {
      leverage += 0.5 // Clear structure: +0.5x leverage
    }
    // Neutral structure: +0x leverage
  }
  
  // 6. Volume Profile - Price at POC = higher leverage
  if (externalData && externalData.volumeProfile && externalData.volumeProfile.session && entryPrice > 0) {
    const svp = externalData.volumeProfile.session
    if (svp.poc && svp.poc > 0) {
      const priceToPoc = Math.abs((entryPrice - svp.poc) / svp.poc) * 100
      if (priceToPoc < 1.0) {
        leverage += 0.5 // Price at POC: +0.5x leverage
      } else if (priceToPoc < 2.0) {
        leverage += 0.25 // Price at VAH/VAL: +0.25x leverage
      }
    }
  }
  
  // Clamp leverage between 1x (minimum) and assetMaxLeverage (maximum from Hyperliquid)
  return Math.max(1, Math.min(assetMaxLeverage, Math.round(leverage * 10) / 10))
}

/**
 * Calculate dynamic margin percentage based on market conditions
 * @param {Object} indicators - Technical indicators (ATR, ADX, etc.)
 * @param {Object} externalData - External data (COC, volume profile, etc.)
 * @param {Object} signal - Signal object (confidence, profit_target, stop_loss, etc.)
 * @param {number} entryPrice - Entry price
 * @returns {number} Dynamic margin percentage (25% to 100% of capital)
 */
function calculateDynamicMarginPercentage(indicators, externalData, signal, entryPrice) {
  // Base margin: 25% (minimum)
  let marginPercent = 25
  
  if (!indicators || !entryPrice || entryPrice <= 0) {
    return marginPercent // Return minimum if no data
  }
  
  // 1. Volatility (ATR) - Lower volatility = higher margin (can be more aggressive)
  const atr = indicators.atr || 0
  if (atr > 0 && entryPrice > 0) {
    const atrPercent = (atr / entryPrice) * 100
    if (atrPercent < 1.0) {
      marginPercent += 25 // Very low volatility: +25% margin
    } else if (atrPercent < 2.0) {
      marginPercent += 20 // Low volatility: +20% margin
    } else if (atrPercent < 3.0) {
      marginPercent += 15 // Medium volatility: +15% margin
    } else {
      marginPercent += 10 // High volatility: +10% margin (minimum 25%)
    }
  }
  
  // 2. Trend Strength (ADX) - Stronger trend = higher margin
  const adx = indicators.adx || 0
  if (adx > 0) {
    if (adx > 50) {
      marginPercent += 20 // Very strong trend: +20% margin
    } else if (adx >= 40) {
      marginPercent += 15 // Strong trend: +15% margin
    } else if (adx >= 25) {
      marginPercent += 10 // Moderate trend: +10% margin
    } else {
      marginPercent += 5 // Weak trend: +5% margin
    }
  }
  
  // 3. Confidence Score - Higher confidence = higher margin
  const confidence = signal.confidence || 0
  if (confidence > 0.7) {
    marginPercent += 15 // Very high confidence: +15% margin
  } else if (confidence >= 0.6) {
    marginPercent += 10 // High confidence: +10% margin
  } else if (confidence >= 0.5) {
    marginPercent += 5 // Moderate confidence: +5% margin
  }
  // Confidence < 0.5: +0% margin (minimum 25%)
  
  // 4. Risk/Reward Ratio - Better R:R = higher margin
  if (signal.profit_target && signal.stop_loss && entryPrice > 0) {
    const profitDistance = Math.abs(signal.profit_target - entryPrice)
    const lossDistance = Math.abs(entryPrice - signal.stop_loss)
    if (lossDistance > 0) {
      const riskRewardRatio = profitDistance / lossDistance
      if (riskRewardRatio > 3.0) {
        marginPercent += 10 // Excellent R:R (>3:1): +10% margin
      } else if (riskRewardRatio >= 2.0) {
        marginPercent += 5 // Good R:R (2-3:1): +5% margin
      }
      // R:R < 2:1: +0% margin
    }
  }
  
  // 5. Market Structure (COC) - Clear structure = higher margin
  if (externalData && externalData.marketStructure && externalData.marketStructure.coc) {
    const coc = externalData.marketStructure.coc
    if (coc.reversalSignal && coc.structureStrength > 70) {
      marginPercent += 10 // Strong reversal signal: +10% margin
    } else if (coc.structureStrength > 50) {
      marginPercent += 5 // Clear structure: +5% margin
    }
    // Neutral structure: +0% margin
  }
  
  // 6. Volume Profile - Price at POC = higher margin
  if (externalData && externalData.volumeProfile && externalData.volumeProfile.session && entryPrice > 0) {
    const svp = externalData.volumeProfile.session
    if (svp.poc && svp.poc > 0) {
      const priceToPoc = Math.abs((entryPrice - svp.poc) / svp.poc) * 100
      if (priceToPoc < 1.0) {
        marginPercent += 5 // Price at POC: +5% margin
      } else if (priceToPoc < 2.0) {
        marginPercent += 2.5 // Price at VAH/VAL: +2.5% margin
      }
    }
  }
  
  // Clamp margin percentage between 25% (minimum) and 100% (maximum)
  return Math.max(25, Math.min(100, Math.round(marginPercent * 10) / 10))
}

// Format signal output as table
async function formatSignal(signal, index, marketData, activePositions, signalHistory = new Map(), accountState = null) {
  // Determine signal type and color
  const signalType = signal.signal.toUpperCase()
  let signalColor = 'yellow' // Default: HOLD and other signals
  if (signalType === 'BUY_TO_ENTER' || signalType === 'ADD') signalColor = 'green' // BUY: hijau
  else if (signalType === 'SELL_TO_ENTER') signalColor = 'red' // SELL: merah
  else if (signalType === 'HOLD') signalColor = 'yellow' // HOLD: tetap kuning
  else if (signalType === 'CLOSE' || signalType === 'CLOSE_ALL') signalColor = 'magenta'
  else if (signalType === 'REDUCE') signalColor = 'yellow'
  
  // Get entry price - prioritize from signal, then from history, then from current price
  const isOpeningSignal = signal.signal === 'buy_to_enter' || signal.signal === 'sell_to_enter' || signal.signal === 'add'
  let entryPrice = signal.entry_price
  
  // If no entry price in signal, check history (for HOLD/CLOSE/REDUCE signals)
  if ((!entryPrice || entryPrice === 0) && signalHistory) {
    const history = signalHistory.get(signal.coin)
    if (history && history.entryPrice > 0) {
      entryPrice = history.entryPrice
    }
  }
  
  // Fallback to current price if still no entry price
  if (!entryPrice || entryPrice === 0) {
    const assetData = marketData instanceof Map 
      ? marketData.get(signal.coin)
      : marketData[signal.coin]
    if (assetData && assetData.price) {
      entryPrice = assetData.price
    }
  }
  
  // Get current position
  const position = activePositions?.get(signal.coin)
  
  // Build table with box-drawing characters (warnings already displayed above, so start directly with table)
  const tableWidth = 72
  const labelWidth = 16
  const valueWidth = tableWidth - labelWidth - 4 // Account for borders: │ label│ value │
  
  // Helper function to pad string
  function padText(text, width) {
    const str = String(text || '')
    if (str.length > width) {
      return str.substring(0, width - 3) + '...'
    }
    return str.padEnd(width)
  }
  
  // Helper function to create table row
  function tableRow(label, value, color = 'cyan') {
    log(`│ ${padText(label, labelWidth)}│ ${padText(value, valueWidth)} │`, color)
  }
  
  // Helper function to create full-width text row (for justification, invalidation, etc.)
  function fullWidthRow(text, color = 'cyan') {
    const cleanText = String(text || '').trim()
    if (!cleanText) return
    
    // Calculate available width (tableWidth - 4 for borders and padding)
    const availableWidth = tableWidth - 4
    const words = cleanText.split(' ')
    let currentLine = ''
    
    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word
      if (testLine.length <= availableWidth) {
        currentLine = testLine
      } else {
        // Output current line if it has content
        if (currentLine) {
          log(`│ ${currentLine.padEnd(availableWidth)} │`, color)
        }
        // Start new line with current word
        if (word.length > availableWidth) {
          // Very long word - split it
          let remaining = word
          while (remaining.length > availableWidth) {
            log(`│ ${remaining.substring(0, availableWidth)} │`, color)
            remaining = remaining.substring(availableWidth)
          }
          currentLine = remaining
        } else {
          currentLine = word
        }
      }
    }
    // Output remaining line
    if (currentLine) {
      log(`│ ${currentLine.padEnd(availableWidth)} │`, color)
    }
  }
  
  // Determine quality label and color
  const qualityLabel = signal.quality_label || (signal.quality === 'high' ? 'HIGH CONFIDENCE - AUTO-TRADEABLE' : signal.quality === 'medium' ? 'MANUAL REVIEW RECOMMENDED' : signal.quality === 'low' ? 'LOW CONFIDENCE - HIGH RISK' : signal.quality === 'very_low' ? 'VERY LOW CONFIDENCE - EXTREME RISK' : '')
  const qualityColor = signal.quality === 'high' ? 'green' : signal.quality === 'medium' ? 'yellow' : signal.quality === 'low' ? 'red' : signal.quality === 'very_low' ? 'red' : 'cyan'
  
  // Draw table border with quality label
  if (signal.quality === 'high') {
    log('┌' + '─'.repeat(tableWidth - 2) + '┐', qualityColor)
    log(`│ ${qualityLabel.padEnd(tableWidth - 4)} │`, qualityColor)
    log('├' + '─'.repeat(tableWidth - 2) + '┤', qualityColor)
  } else if (signal.quality === 'medium' || signal.quality === 'low' || signal.quality === 'very_low') {
    log('┌' + '─'.repeat(tableWidth - 2) + '┐', qualityColor)
    log(`│ ${qualityLabel.padEnd(tableWidth - 4)} │`, qualityColor)
    log('├' + '─'.repeat(tableWidth - 2) + '┤', qualityColor)
  } else {
    log('┌' + '─'.repeat(tableWidth - 2) + '┐', 'cyan')
  }
  const signalHeader = `Signal #${index + 1}`
  log(`│ ${padText(signalHeader, tableWidth - 4)} │`, 'bright')
  log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
  
  // Get asset data and technical indicators
  const assetData = marketData instanceof Map ? marketData.get(signal.coin) : marketData[signal.coin]
  const indicators = assetData?.indicators || assetData?.data?.indicators || null
  const multiTimeframeIndicators = assetData?.data?.multiTimeframeIndicators || assetData?.multiTimeframeIndicators || null
  
  // Get externalData for use throughout the function (leverage calculation and display)
  const externalData = assetData?.data?.externalData || assetData?.externalData || null
  
  // Fetch real-time price (refresh before displaying)
  let currentPrice = assetData?.price || position?.currentPrice || entryPrice || 0
  try {
    const realTimePrice = await getRealTimePrice(signal.coin)
    if (realTimePrice && realTimePrice > 0) {
      currentPrice = realTimePrice
      // Update assetData price for consistency
      if (assetData) {
        assetData.price = realTimePrice
      }
    }
  } catch (error) {
    // If real-time fetch fails, use cached price
    console.warn(`Failed to fetch real-time price for ${signal.coin}: ${error.message}`)
  }
  
  // Asset & Signal
  tableRow('Asset:', signal.coin, 'cyan')
  
  // Determine trading style (Long Term vs Short Term)
  const assetDataForStyle = marketData instanceof Map ? marketData.get(signal.coin) : marketData[signal.coin]
  const indicatorsForStyle = assetDataForStyle?.indicators || assetDataForStyle?.data?.indicators
  const trendAlignmentForStyle = assetDataForStyle?.data?.trendAlignment || assetDataForStyle?.trendAlignment
  const marketRegimeForStyle = indicatorsForStyle?.marketRegime
  const tradingStyle = determineTradingStyle(signal, indicatorsForStyle, trendAlignmentForStyle, marketRegimeForStyle)
  const signalWithStyle = `${signalType} (${tradingStyle})`
  tableRow('Signal:', signalWithStyle, signalColor)
  
  // Current Price (always show - real-time)
  if (currentPrice > 0) {
    tableRow('Current Price:', formatPrice(currentPrice, signal.coin), 'cyan')
  }
  
  // Technical Indicators Section
  if (indicators) {
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
    log(`│ ${'Technical:'.padEnd(tableWidth - 4)} │`, 'bright')
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
    
    // RSI - ALL timeframes (comprehensive display)
    if (indicators.rsi14 !== null && indicators.rsi14 !== undefined) {
      const rsiValue = indicators.rsi14.toFixed(2)
      const rsiStatus = indicators.rsi14 > 70 ? '(Overbought)' : indicators.rsi14 < 30 ? '(Oversold)' : '(Neutral)'
      tableRow('  RSI(14):', `${rsiValue} ${rsiStatus}`, 'cyan')
    }
    if (indicators.rsi7 !== null && indicators.rsi7 !== undefined) {
      const rsi7Value = indicators.rsi7.toFixed(2)
      const rsi7Status = indicators.rsi7 > 70 ? '(Overbought)' : indicators.rsi7 < 30 ? '(Oversold)' : '(Neutral)'
      tableRow('  RSI(7):', `${rsi7Value} ${rsi7Status}`, 'cyan')
    }
    
    // Multi-timeframe RSI (1H, 4H) - if available
    if (multiTimeframeIndicators) {
      if (multiTimeframeIndicators['1h'] && multiTimeframeIndicators['1h'].rsi14 !== null && multiTimeframeIndicators['1h'].rsi14 !== undefined) {
        const rsi1h = multiTimeframeIndicators['1h'].rsi14.toFixed(2)
        const rsi1hStatus = multiTimeframeIndicators['1h'].rsi14 > 70 ? '(Overbought)' : multiTimeframeIndicators['1h'].rsi14 < 30 ? '(Oversold)' : '(Neutral)'
        tableRow('  1H RSI:', `${rsi1h} ${rsi1hStatus}`, 'cyan')
      }
      if (multiTimeframeIndicators['4h'] && multiTimeframeIndicators['4h'].rsi14 !== null && multiTimeframeIndicators['4h'].rsi14 !== undefined) {
        const rsi4h = multiTimeframeIndicators['4h'].rsi14.toFixed(2)
        const rsi4hStatus = multiTimeframeIndicators['4h'].rsi14 > 70 ? '(Overbought)' : multiTimeframeIndicators['4h'].rsi14 < 30 ? '(Oversold)' : '(Neutral)'
        tableRow('  4H RSI:', `${rsi4h} ${rsi4hStatus}`, 'cyan')
      }
    }
    
    // EMA
    if (indicators.ema20 !== null && indicators.ema20 !== undefined) {
      tableRow('  EMA(20):', '$' + indicators.ema20.toFixed(2), 'cyan')
    }
    if (indicators.ema50 !== null && indicators.ema50 !== undefined) {
      tableRow('  EMA(50):', '$' + indicators.ema50.toFixed(2), 'cyan')
    }
    if (indicators.ema200 !== null && indicators.ema200 !== undefined) {
      tableRow('  EMA(200):', '$' + indicators.ema200.toFixed(2), 'cyan')
    }
    
    // MACD
    if (indicators.macd && typeof indicators.macd === 'object') {
      const macd = indicators.macd
      if (macd.macd !== null && macd.macd !== undefined) {
        tableRow('  MACD:', macd.macd.toFixed(4), 'cyan')
      }
      if (macd.signal !== null && macd.signal !== undefined) {
        tableRow('  MACD Signal:', macd.signal.toFixed(4), 'cyan')
      }
      if (macd.histogram !== null && macd.histogram !== undefined) {
        const histColor = macd.histogram >= 0 ? 'green' : 'red'
        tableRow('  MACD Hist:', macd.histogram.toFixed(4), histColor)
      }
    }
    
    // Bollinger Bands
    if (indicators.bollingerBands && typeof indicators.bollingerBands === 'object') {
      const bb = indicators.bollingerBands
      if (bb.upper !== null && bb.upper !== undefined) {
        tableRow('  BB Upper:', '$' + bb.upper.toFixed(2), 'cyan')
      }
      if (bb.middle !== null && bb.middle !== undefined) {
        tableRow('  BB Middle:', '$' + bb.middle.toFixed(2), 'cyan')
      }
      if (bb.lower !== null && bb.lower !== undefined) {
        tableRow('  BB Lower:', '$' + bb.lower.toFixed(2), 'cyan')
      }
      
      // Validate and display BB position
      // CRITICAL: Use indicators.price (price from historical data used for BB calculation)
      // NOT currentPrice (real-time price) to ensure consistency
      const price = indicators.price || 0
      if (price > 0 && bb.upper && bb.lower) {
        let bbPos = ''
        if (price > bb.upper) {
          bbPos = 'ABOVE upper (Overbought)'
        } else if (price < bb.lower) {
          bbPos = 'BELOW lower (Oversold)'
        } else if (price > bb.middle) {
          bbPos = 'Above middle (Bullish)'
        } else {
          bbPos = 'Below middle (Bearish)'
        }
        tableRow('  BB Position:', bbPos, 'cyan')
      }
    }
    
    // ATR
    if (indicators.atr !== null && indicators.atr !== undefined) {
      tableRow('  ATR(14):', '$' + indicators.atr.toFixed(2) + ' (Volatility)', 'cyan')
    }
    
    // ADX
    if (indicators.adx !== null && indicators.adx !== undefined) {
      const adxValue = typeof indicators.adx === 'number' ? indicators.adx : (indicators.adx?.adx || null)
      if (adxValue !== null && !isNaN(adxValue)) {
        const adxStatus = adxValue > 25 ? '(Strong Trend)' : adxValue < 20 ? '(Weak Trend)' : '(Moderate)'
        tableRow('  ADX(14):', `${adxValue.toFixed(2)} ${adxStatus}`, 'cyan')
        if (indicators.plusDI !== null && indicators.minusDI !== null) {
          tableRow('  +DI/-DI:', `${indicators.plusDI.toFixed(2)}/${indicators.minusDI.toFixed(2)}`, 'cyan')
        }
      }
    }
    
    // OBV & VWAP
    if (indicators.obv !== null && indicators.obv !== undefined) {
      tableRow('  OBV:', indicators.obv.toFixed(2), 'cyan')
    }
    if (indicators.vwap !== null && indicators.vwap !== undefined) {
      tableRow('  VWAP:', '$' + indicators.vwap.toFixed(2), 'cyan')
    }
    
    // Stochastic
    if (indicators.stochastic && typeof indicators.stochastic === 'object') {
      const stoch = indicators.stochastic
      const stochStatus = stoch.k > 80 ? '(Overbought)' : stoch.k < 20 ? '(Oversold)' : ''
      tableRow('  Stochastic:', `K: ${stoch.k.toFixed(2)}, D: ${stoch.d.toFixed(2)} ${stochStatus}`, 'cyan')
    }
    
    // CCI & Williams %R
    if (indicators.cci !== null && indicators.cci !== undefined) {
      const cciStatus = indicators.cci > 100 ? '(Overbought)' : indicators.cci < -100 ? '(Oversold)' : ''
      tableRow('  CCI:', `${indicators.cci.toFixed(2)} ${cciStatus}`, 'cyan')
    }
    if (indicators.williamsR !== null && indicators.williamsR !== undefined) {
      const wrStatus = indicators.williamsR > -20 ? '(Overbought)' : indicators.williamsR < -80 ? '(Oversold)' : ''
      tableRow('  Williams %R:', `${indicators.williamsR.toFixed(2)} ${wrStatus}`, 'cyan')
    }
    
    // Parabolic SAR
    if (indicators.parabolicSAR !== null && indicators.parabolicSAR !== undefined) {
      const sarTrend = currentPrice > indicators.parabolicSAR ? 'Bullish' : 'Bearish'
      tableRow('  Parabolic SAR:', '$' + indicators.parabolicSAR.toFixed(2) + ` (${sarTrend})`, 'cyan')
    }
    
    // Aroon
    if (indicators.aroon && typeof indicators.aroon === 'object') {
      const aroon = indicators.aroon
      const aroonStatus = aroon.up > 70 && aroon.down < 30 ? '(Strong Uptrend)' : aroon.down > 70 && aroon.up < 30 ? '(Strong Downtrend)' : ''
      tableRow('  Aroon:', `Up: ${aroon.up.toFixed(2)}, Down: ${aroon.down.toFixed(2)} ${aroonStatus}`, 'cyan')
    }
    
    // Support/Resistance
    if (indicators.supportResistance && typeof indicators.supportResistance === 'object') {
      const sr = indicators.supportResistance
      if (sr.support || sr.resistance) {
        tableRow('  Support:', sr.support ? '$' + sr.support.toFixed(2) : 'N/A', 'cyan')
        tableRow('  Resistance:', sr.resistance ? '$' + sr.resistance.toFixed(2) : 'N/A', 'cyan')
      }
    }
    
    // Trend Detection
    if (indicators.trendDetection) {
      const td = indicators.trendDetection
      const trendColor = td.trend === 'uptrend' ? 'green' : td.trend === 'downtrend' ? 'red' : 'yellow'
      tableRow('  Trend:', `${td.trend} (Strength: ${td.strength}/3)`, trendColor)
    }
    
    // Market Structure
    if (indicators.marketStructure) {
      const ms = indicators.marketStructure
      tableRow('  Market Struct:', `${ms.structure} | HH: ${ms.higherHighs ? 'Yes' : 'No'} | LL: ${ms.lowerLows ? 'Yes' : 'No'}`, 'cyan')
    }
    
    // Divergence
    if (indicators.rsiDivergence && indicators.rsiDivergence.divergence) {
      const divColor = indicators.rsiDivergence.divergence === 'bullish' ? 'green' : 'red'
      tableRow('  RSI Divergence:', indicators.rsiDivergence.divergence, divColor)
    }
    if (indicators.macdDivergence && indicators.macdDivergence.divergence) {
      const divColor = indicators.macdDivergence.divergence === 'bullish' ? 'green' : 'red'
      tableRow('  MACD Divergence:', indicators.macdDivergence.divergence, divColor)
    }
    
    // Candlestick Patterns
    if (indicators.candlestickPatterns && indicators.candlestickPatterns.patterns && indicators.candlestickPatterns.patterns.length > 0) {
      const patterns = indicators.candlestickPatterns.patterns.map(p => p.type).join(', ')
      tableRow('  Candlestick:', patterns, 'cyan')
    }
    
    // Market Regime
    if (indicators.marketRegime) {
      const mr = indicators.marketRegime
      const regimeColor = mr.regime === 'trending' ? 'green' : mr.regime === 'choppy' ? 'yellow' : 'cyan'
      tableRow('  Market Regime:', `${mr.regime} (${mr.volatility} volatility)`, regimeColor)
    }
    
    // Price Change
    if (indicators.priceChange24h !== null && indicators.priceChange24h !== undefined) {
      const changeColor = indicators.priceChange24h >= 0 ? 'green' : 'red'
      const changeSign = indicators.priceChange24h >= 0 ? '+' : ''
      tableRow('  24h Change:', `${changeSign}${indicators.priceChange24h.toFixed(2)}%`, changeColor)
    }
    
    // Volume Change
    if (indicators.volumeChange !== null && indicators.volumeChange !== undefined) {
      const volColor = indicators.volumeChange >= 0 ? 'green' : 'yellow'
      const volSign = indicators.volumeChange >= 0 ? '+' : ''
      tableRow('  Vol Change:', `${volSign}${indicators.volumeChange.toFixed(2)}%`, volColor)
    }
    
    // Multi-timeframe Trend Alignment (if available)
    const assetDataForMTF = marketData instanceof Map ? marketData.get(signal.coin) : marketData[signal.coin]
    const trendAlignment = assetDataForMTF?.data?.trendAlignment || assetDataForMTF?.trendAlignment
    if (trendAlignment) {
      log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
      log(`│ ${'Multi-Timeframe:'.padEnd(tableWidth - 4)} │`, 'bright')
      log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
      const dailyTrendColor = trendAlignment.dailyTrend === 'uptrend' ? 'green' : trendAlignment.dailyTrend === 'downtrend' ? 'red' : 'yellow'
      tableRow('  Daily Trend:', trendAlignment.dailyTrend || 'N/A', dailyTrendColor)
      tableRow('  4H Aligned:', trendAlignment.h4Aligned ? 'Yes' : 'No', trendAlignment.h4Aligned ? 'green' : 'yellow')
      tableRow('  1H Aligned:', trendAlignment.h1Aligned ? 'Yes' : 'No', trendAlignment.h1Aligned ? 'green' : 'yellow')
      tableRow('  Overall:', trendAlignment.aligned ? 'Aligned' : 'Not Aligned', trendAlignment.aligned ? 'green' : 'yellow')
      if (trendAlignment.alignmentScore !== undefined) {
        const scoreColor = trendAlignment.alignmentScore >= 75 ? 'green' : trendAlignment.alignmentScore >= 50 ? 'yellow' : 'red'
        tableRow('  Score:', `${trendAlignment.alignmentScore.toFixed(0)}%`, scoreColor)
      }
    }
    
    // External Data (if available) - using externalData defined earlier in function
    if (externalData) {
      log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
      log(`│ ${'External Data:'.padEnd(tableWidth - 4)} │`, 'bright')
      log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
      
      // Hyperliquid data
      if (externalData.hyperliquid) {
        const hl = externalData.hyperliquid
        const fundingColor = Math.abs(hl.fundingRate) > 0.0015 ? 'red' : 'cyan'
        tableRow('  Funding Rate:', `${(hl.fundingRate * 100).toFixed(4)}% (${hl.fundingRateTrend || 'N/A'})`, fundingColor)
        if (hl.openInterest) {
          tableRow('  Open Interest:', `$${formatLargeNumber(hl.openInterest)} (${hl.oiTrend || 'N/A'})`, 'cyan')
        }
      }
      
      // Enhanced metrics
      if (externalData.enhanced) {
        const enh = externalData.enhanced
        const volTrendColor = enh.volumeTrend === 'increasing' ? 'green' : enh.volumeTrend === 'decreasing' ? 'red' : 'yellow'
        tableRow('  Volume Trend:', enh.volumeTrend || 'N/A', volTrendColor)
        tableRow('  Volatility:', enh.volatilityPattern || 'N/A', 'cyan')
        if (enh.volumePriceDivergence !== 0) {
          const divColor = enh.volumePriceDivergence > 0 ? 'green' : 'red'
          const divText = enh.volumePriceDivergence > 0 ? 'Bullish' : 'Bearish'
          tableRow('  Vol-Price Div:', `${divText} (${enh.volumePriceDivergence > 0 ? '+' : ''}${enh.volumePriceDivergence.toFixed(2)})`, divColor)
        }
      }
    }
  }
  
  // Current Position (if exists) - always show section if position exists
  if (position) {
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
    const pnlPercent = position.entryPrice > 0 
      ? (((currentPrice - position.entryPrice) / position.entryPrice) * 100 * (position.side === 'LONG' ? 1 : -1)).toFixed(2)
      : '0.00'
    const pnlColor = parseFloat(pnlPercent) >= 0 ? 'green' : 'red'
    const posText = `${position.side} ${Math.abs(position.quantity).toFixed(4)} @ $${position.entryPrice.toFixed(2)}`
    tableRow('Position:', posText, 'cyan')
    const pnlText = `${pnlPercent}% ($${position.unrealizedPnl?.toFixed(2) || '0.00'})`
    tableRow('PnL:', pnlText, pnlColor)
    // Show entry price for existing position
    tableRow('Entry Price:', formatPrice(position.entryPrice, signal.coin) + ' (current position)', 'cyan')
    
    // Calculate and display MAE (Maximum Adverse Excursion)
    const assetData = marketData instanceof Map ? marketData.get(signal.coin) : marketData[signal.coin]
    const historicalData = assetData?.historicalData || []
    const maeResult = calculateMAE(position, currentPrice, historicalData)
    
    if (maeResult) {
      const maeColor = maeResult.mae > 5 ? 'red' : maeResult.mae > 2 ? 'yellow' : 'green'
      const maeText = `${maeResult.mae.toFixed(2)}% (Worst: $${maeResult.worstPrice.toFixed(2)})`
      tableRow('MAE:', maeText, maeColor)
      
      // Show current adverse excursion if different from MAE
      if (Math.abs(maeResult.currentAdverseExcursion - maeResult.mae) > 0.01) {
        const currentAEColor = maeResult.currentAdverseExcursion > 5 ? 'red' : maeResult.currentAdverseExcursion > 2 ? 'yellow' : 'green'
        tableRow('Current AE:', `${maeResult.currentAdverseExcursion.toFixed(2)}%`, currentAEColor)
      }
    }
  }
  
  // Futures Trading Format Section
  log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
  
  // POSITION SETUP Section
  log(`│ ${'POSITION SETUP'.padEnd(tableWidth - 4)} │`, 'bright')
  log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
  
  // 1. Capital
  const capital = accountState?.accountValue || accountState?.accountBalance || 0
  const capitalText = capital > 0 ? `$${capital.toFixed(2)}` : '$ —'
  tableRow('Capital:', capitalText, 'cyan')
  
  // Get capital for margin calculation (needed for dynamic margin percentage)
  
  // 2. Timeframe
  const timeframeText = `${tradingStyle} (short term/long term[ Flexible with market conditions])`
  tableRow('Timeframe:', timeframeText, 'cyan')
  
  // 3. Entry Price with direction - Enhanced visibility with emoji and bold
  let entryDirection = 'HOLD'
  if (signal.signal === 'buy_to_enter' || signal.signal === 'add') {
    entryDirection = 'LONG'
  } else if (signal.signal === 'sell_to_enter') {
    entryDirection = 'SHORT'
  } else if (signal.signal === 'hold') {
    entryDirection = position ? 'HOLD[Hold if there is a position in the market]' : 'HOLD'
  } else if (signal.signal === 'reduce' || signal.signal === 'close' || signal.signal === 'close_all') {
    entryDirection = 'HOLD'
  }
  
  // Use effectiveEntryPrice for display and calculations (entryPrice or currentPrice fallback)
  const effectiveEntryPrice = entryPrice || currentPrice || 0 // Use currentPrice as fallback
  const displayEntryPrice = effectiveEntryPrice
  
  if (displayEntryPrice > 0) {
    // Format Entry Price with $ prefix for futures trading
    // Use standard USD format for futures trading (not European format)
    const entryPriceFormatted = `$${displayEntryPrice.toFixed(2)}`
    const entryPriceText = `${entryPriceFormatted} (${entryDirection})`
    tableRow('Entry Price:', entryPriceText, 'cyan')
  } else {
    tableRow('Entry Price:', `$ — (${entryDirection})`, 'cyan')
  }
  
  // 4. Calculate dynamic leverage and margin percentage first (needed for quantity calculation)
  // Calculate dynamic leverage based on market conditions (volatility, trend, confidence, etc.)
  // externalData and assetData are already defined earlier in the function (line ~13776)
  // Get max leverage from asset data (from Hyperliquid API)
  const assetMaxLeverage = assetData?.maxLeverage || assetData?.data?.maxLeverage || assetData?.externalData?.hyperliquid?.maxLeverage || 10
  
  const leverage = isOpeningSignal && indicators && externalData && effectiveEntryPrice > 0
    ? calculateDynamicLeverage(indicators, externalData, signal, effectiveEntryPrice, assetMaxLeverage)
    : (signal.leverage || 1) // Fallback to signal leverage or 1x for non-opening signals
  
  // Calculate dynamic margin percentage based on market conditions (volatility, trend, confidence, etc.)
  const marginPercentage = isOpeningSignal && indicators && externalData && effectiveEntryPrice > 0 && capital > 0
    ? calculateDynamicMarginPercentage(indicators, externalData, signal, effectiveEntryPrice)
    : 50 // Fallback to 50% (mid) for non-opening signals or when data is unavailable
  
  // Calculate margin used from capital percentage
  const marginUsed = capital > 0 
    ? (capital * marginPercentage / 100) 
    : 0
  
  // Calculate position value from margin and leverage
  const positionValue = marginUsed > 0 && leverage > 0 
    ? marginUsed * leverage 
    : 0
  
  // Calculate effective quantity from Position Value (if margin-based calculation is used)
  // If margin is calculated from capital percentage, use Position Value to calculate quantity
  // Otherwise, use signal.quantity
  const effectiveQuantityCoin = capital > 0 && marginUsed > 0 && leverage > 0 && effectiveEntryPrice > 0 && isOpeningSignal
    ? positionValue / effectiveEntryPrice // Quantity from Position Value (margin-based)
    : (signal.quantity || 0) // Fallback to signal.quantity
  
  // Quantity (USD + coin format) - use effectiveQuantityCoin for consistency
  const quantityCoin = effectiveQuantityCoin
  const quantityUSD = quantityCoin > 0 && effectiveEntryPrice > 0 ? quantityCoin * effectiveEntryPrice : 0
  let quantityText = ''
  if (signal.signal === 'reduce') {
    if (quantityCoin > 0 && effectiveEntryPrice > 0) {
      const reduceUSD = quantityCoin * effectiveEntryPrice
      quantityText = `$${reduceUSD.toFixed(2)} (${quantityCoin.toFixed(8)} ${signal.coin}) - Reduce`
    } else {
      quantityText = `${quantityCoin.toFixed(8)} ${signal.coin} - Reduce`
    }
  } else if (signal.signal === 'add') {
    if (quantityCoin > 0 && effectiveEntryPrice > 0) {
      const addUSD = quantityCoin * effectiveEntryPrice
      quantityText = `$${addUSD.toFixed(2)} (${quantityCoin.toFixed(8)} ${signal.coin}) - Add`
    } else {
      quantityText = `${quantityCoin.toFixed(8)} ${signal.coin} - Add`
    }
  } else if (signal.signal === 'close' || signal.signal === 'close_all') {
    quantityText = 'Close All'
  } else if (quantityCoin > 0 && effectiveEntryPrice > 0) {
    quantityText = `$${quantityUSD.toFixed(2)} (${quantityCoin.toFixed(8)} ${signal.coin})`
  } else if (quantityCoin > 0) {
    quantityText = `${quantityCoin.toFixed(8)} ${signal.coin}`
  } else {
    quantityText = '$ —'
  }
  tableRow('Quantity:', quantityText, 'cyan')
  
  // 5. Margin Used (dynamic percentage based on market conditions)
  // Margin Used = capital * marginPercentage / 100 (percentage of capital)
  // leverage, marginPercentage, marginUsed, positionValue, and effectiveQuantityCoin are already calculated above
  const marginUsedText = marginUsed > 0 && capital > 0
    ? `$${marginUsed.toFixed(2)} (${marginPercentage.toFixed(1)}% — Flexible with market conditions)`
    : marginUsed > 0
    ? `$${marginUsed.toFixed(2)}`
    : '$ —'
  tableRow('Margin Used:', marginUsedText, 'cyan')
  
  // 6. Position Value (calculated from Margin Used and Leverage)
  // Position Value = Margin Used * Leverage (notional value with leverage)
  // positionValue is already calculated above
  const positionValueText = positionValue > 0 
    ? `$${positionValue.toFixed(2)} (Leverage ${leverage}x — Flexible with market conditions)`
    : '$ —'
  tableRow('Position Value:', positionValueText, 'cyan')
  
  // RISK MANAGEMENT Section
  log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
  log(`│ ${'RISK MANAGEMENT'.padEnd(tableWidth - 4)} │`, 'bright')
  log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
  
  // 8. Stop Loss (Fixed) & Potential Loss
  let potentialLossFixed = 0
  let riskUSDFixed = 0
  if (isOpeningSignal && effectiveEntryPrice && effectiveEntryPrice > 0 && signal.stop_loss && signal.stop_loss > 0) {
    const stopLossPct = Math.abs((effectiveEntryPrice - signal.stop_loss) / effectiveEntryPrice * 100).toFixed(2)
    const stopLossText = `$${signal.stop_loss.toFixed(2)} (${stopLossPct}%)`
    tableRow('Stop Loss (Fixed):', stopLossText, 'cyan')
    
    // Potential Loss from Fixed Stop Loss (with leverage)
    // For futures trading: Potential Loss = (Stop Loss Distance / Entry Price) * Margin Used * Leverage
    // or: Potential Loss = Margin Used * (Stop Loss % / 100) * Leverage
    if (marginUsed > 0 && leverage > 0 && effectiveEntryPrice > 0) {
      const stopLossDistance = Math.abs(effectiveEntryPrice - signal.stop_loss)
      const stopLossPercent = (stopLossDistance / effectiveEntryPrice) * 100
      potentialLossFixed = marginUsed * (stopLossPercent / 100) * leverage
      riskUSDFixed = potentialLossFixed // Risk USD for Fixed SL
      if (potentialLossFixed > 0) {
        tableRow('→ Potential Loss:', `$${potentialLossFixed.toFixed(2)}`, 'red')
      }
    }
  }
  
  // 9. Stop Loss (Flexible) based on ATR/volatility
  let potentialLossFlexible = 0
  let riskUSDFlexible = 0
  let flexibleStopLoss = 0
  let flexibleStopLossPct = 0
  if (isOpeningSignal && effectiveEntryPrice && effectiveEntryPrice > 0) {
    const atr = indicators?.atr || 0
    
    if (atr > 0 && effectiveEntryPrice > 0) {
      // Calculate flexible multiplier based on volatility
      const atrPercent = (atr / effectiveEntryPrice) * 100
      let flexibleMultiplier = 1.5 // Default
      
      if (atrPercent > 4.0) {
        flexibleMultiplier = 2.5 // High volatility
      } else if (atrPercent > 2.5) {
        flexibleMultiplier = 2.0 // Medium-high volatility
      } else if (atrPercent > 1.5) {
        flexibleMultiplier = 1.75 // Medium volatility
      } else {
        flexibleMultiplier = 1.5 // Low volatility
      }
      
      // Calculate flexible stop loss distance
      const flexibleSLDistance = atr * flexibleMultiplier
      flexibleStopLoss = signal.signal === 'buy_to_enter'
        ? effectiveEntryPrice - flexibleSLDistance
        : effectiveEntryPrice + flexibleSLDistance
      flexibleStopLossPct = Math.abs((effectiveEntryPrice - flexibleStopLoss) / effectiveEntryPrice * 100)
    } else if (effectiveEntryPrice > 0) {
      // Fallback: Use 2% if ATR not available
      const defaultSLDistance = effectiveEntryPrice * 0.02
      flexibleStopLoss = signal.signal === 'buy_to_enter'
        ? effectiveEntryPrice - defaultSLDistance
        : effectiveEntryPrice + defaultSLDistance
      flexibleStopLossPct = 2.00
    }
    
    // Always show flexible SL for opening signals (futures trading format requirement)
    if (flexibleStopLoss > 0) {
      const flexibleStopLossText = `$${flexibleStopLoss.toFixed(2)} (${flexibleStopLossPct.toFixed(2)}% [Adjustable with market conditions])`
      tableRow('Stop Loss (Flexible):', flexibleStopLossText, 'cyan')
      
      // Potential Loss from Flexible Stop Loss (with leverage)
      // For futures trading: Potential Loss = (Stop Loss Distance / Entry Price) * Margin Used * Leverage
      if (marginUsed > 0 && leverage > 0 && effectiveEntryPrice > 0) {
        const flexibleStopLossDistance = Math.abs(effectiveEntryPrice - flexibleStopLoss)
        const flexibleStopLossPercent = (flexibleStopLossDistance / effectiveEntryPrice) * 100
        potentialLossFlexible = marginUsed * (flexibleStopLossPercent / 100) * leverage
        riskUSDFlexible = potentialLossFlexible // Risk USD for Flexible SL
        if (potentialLossFlexible > 0) {
          // Always show flexible potential loss (it may differ from fixed due to volatility-based calculation)
          // Only skip if it's exactly the same as fixed (within 0.01 cent)
          if (!signal.stop_loss || Math.abs(potentialLossFlexible - potentialLossFixed) > 0.01 || potentialLossFixed === 0) {
            tableRow('→ Potential Loss:', `$${potentialLossFlexible.toFixed(2)}`, 'red')
          }
        }
      }
    }
  }
  
  // Risk USD display - Enhanced visibility with emoji and details
  // Always show Risk USD if opening signal (calculate from available data)
  if (isOpeningSignal) {
    // Calculate Risk USD from signal.risk_usd if available, otherwise use calculated values
    const riskUSDFromSignal = signal.risk_usd || 0
    const hasFixedSL = signal.stop_loss && signal.stop_loss > 0 && effectiveEntryPrice > 0
    const hasFlexibleSL = flexibleStopLoss > 0 && effectiveEntryPrice > 0
    
    // Display format: Risk (Fixed): $9.11 at SL $0.1730 (1.80%)
    if (riskUSDFixed > 0 && riskUSDFlexible > 0) {
      // Show both Fixed and Flexible Risk USD
      const fixedSLPct = hasFixedSL ? Math.abs((effectiveEntryPrice - signal.stop_loss) / effectiveEntryPrice * 100).toFixed(2) : '0.00'
      const fixedSLText = hasFixedSL ? `at SL $${signal.stop_loss.toFixed(4)} (${fixedSLPct}%)` : ''
      const flexSLText = hasFlexibleSL ? `at SL $${flexibleStopLoss.toFixed(4)} (${flexibleStopLossPct.toFixed(2)}%)` : ''
      tableRow('Risk (Fixed):', `$${riskUSDFixed.toFixed(2)} ${fixedSLText}`, 'cyan')
      tableRow('Risk (Flex):', `$${riskUSDFlexible.toFixed(2)} ${flexSLText}`, 'cyan')
    } else if (riskUSDFixed > 0) {
      // Show only Fixed Risk USD
      const fixedSLPct = hasFixedSL ? Math.abs((effectiveEntryPrice - signal.stop_loss) / effectiveEntryPrice * 100).toFixed(2) : '0.00'
      const fixedSLText = hasFixedSL ? `at SL $${signal.stop_loss.toFixed(4)} (${fixedSLPct}%)` : ''
      tableRow('Risk (Fixed):', `$${riskUSDFixed.toFixed(2)} ${fixedSLText}`, 'cyan')
    } else if (riskUSDFlexible > 0) {
      // Show only Flexible Risk USD
      const flexSLText = hasFlexibleSL ? `at SL $${flexibleStopLoss.toFixed(4)} (${flexibleStopLossPct.toFixed(2)}%)` : ''
      tableRow('Risk (Flex):', `$${riskUSDFlexible.toFixed(2)} ${flexSLText}`, 'cyan')
    } else if (riskUSDFromSignal > 0) {
      // Fallback: Use signal.risk_usd if available
      tableRow('Risk USD:', `$${riskUSDFromSignal.toFixed(2)}`, 'cyan')
    }
  }
  
  // 10. Take Profit (if available)
  let potentialProfit = 0
  if (isOpeningSignal && effectiveEntryPrice && effectiveEntryPrice > 0 && signal.profit_target && signal.profit_target > 0) {
    const profitPct = Math.abs((signal.profit_target - effectiveEntryPrice) / effectiveEntryPrice * 100).toFixed(2)
    const profitText = `$${signal.profit_target.toFixed(2)} (${profitPct}%)`
    tableRow('Take Profit:', profitText, 'green')
    
    // For futures trading: Potential Profit = (Profit Distance / Entry Price) * Margin Used * Leverage
    // or: Potential Profit = Margin Used * (Profit % / 100) * Leverage
    if (isOpeningSignal && effectiveEntryPrice && effectiveEntryPrice > 0 && signal.profit_target && signal.profit_target > 0 && marginUsed > 0 && leverage > 0) {
      const profitDistance = Math.abs(signal.profit_target - effectiveEntryPrice)
      const profitPercent = (profitDistance / effectiveEntryPrice) * 100
      potentialProfit = marginUsed * (profitPercent / 100) * leverage
      if (potentialProfit > 0) {
        // Calculate Risk/Reward ratios
        const rrFixed = riskUSDFixed > 0 ? (potentialProfit / riskUSDFixed).toFixed(2) : 'N/A'
        const rrFlex = riskUSDFlexible > 0 ? (potentialProfit / riskUSDFlexible).toFixed(2) : 'N/A'
        const rrText = riskUSDFixed > 0 && riskUSDFlexible > 0 
          ? `(R:R = ${rrFixed}:1 fixed, ${rrFlex}:1 flex)`
          : riskUSDFixed > 0 
          ? `(R:R = ${rrFixed}:1 fixed)`
          : riskUSDFlexible > 0
          ? `(R:R = ${rrFlex}:1 flex)`
          : ''
        tableRow('Potential TP:', `$${potentialProfit.toFixed(2)} ${rrText}`, 'green')
      }
    }
  }
  
  // 11. Leverage Display - Simplified (range with current)
  log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
  // Get max leverage from asset data (from Hyperliquid API) - reuse assetData already declared above
  const assetMaxLeverageDisplay = assetData?.maxLeverage || assetData?.data?.maxLeverage || assetData?.externalData?.hyperliquid?.maxLeverage || 10
  const leverageText = isOpeningSignal && leverage > 0
    ? `1x-${assetMaxLeverageDisplay}x (Current: ${leverage}x)`
    : `1x-${assetMaxLeverageDisplay}x (Flexible with market conditions)`
  tableRow('Leverage:', leverageText, 'cyan')
  
  // 12. Margin Display - Simplified (range with current)
  const marginText = isOpeningSignal && marginPercentage > 0 && marginUsed > 0 && capital > 0
    ? `25%-100% (Current: ${marginPercentage.toFixed(0)}% = $${marginUsed.toFixed(2)})`
    : '25%-100% (Flexible with market conditions)'
  tableRow('Margin:', marginText, 'cyan')
  
  log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
  const confidencePercent = ((signal.confidence || 0) * 100).toFixed(2)
  const confidenceColor = signal.confidence >= 0.7 ? 'green' : signal.confidence >= 0.5 ? 'yellow' : 'red'
  tableRow('Confidence:', confidencePercent + '%', confidenceColor)
  
      // Display Expected Value (EV) if available (using new autonomous thresholds)
      if (signal.expected_value !== undefined && signal.expected_value !== null) {
        log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
        const autoTradeEV = THRESHOLDS.expectedValue.autoTrade
        const displayEV = THRESHOLDS.expectedValue.display
        // FUTURES TRADING: Use more relaxed EV threshold for futures
        // For futures, EV can be more negative because leverage amplifies both profit and loss
        // Only reject if EV < -$2.00 (extremely negative for futures)
        const FUTURES_EV_REJECT_THRESHOLD = -2.00  // Reject only if EV < -$2.00 for futures
        const rejectEV = TRADING_CONFIG.mode === 'AUTONOMOUS' 
          ? FUTURES_EV_REJECT_THRESHOLD  // Use futures threshold for AUTONOMOUS mode
          : THRESHOLDS.expectedValue.reject  // Use standard threshold for other modes
        let evStatus = ''
        let evColor = 'green'
        let evStatusText = 'Auto-Tradeable'
        
        // In AUTONOMOUS mode, use execution level to determine EV status
        if (TRADING_CONFIG.mode === 'AUTONOMOUS' && signal.auto_tradeable) {
          // Signal is auto-tradeable - determine status based on execution level
          if (signal.executionLevel === 'HIGH_CONFIDENCE') {
            evStatus = ''
            evColor = 'green'
            evStatusText = `High Confidence - Auto-Tradeable (≥$${autoTradeEV.toFixed(2)})`
          } else if (signal.executionLevel === 'MEDIUM_CONFIDENCE') {
            evStatus = ''
            evColor = 'yellow'
            evStatusText = `Medium Confidence - Auto-Tradeable (≥$${displayEV.toFixed(2)})`
          } else if (signal.executionLevel === 'LOW_CONFIDENCE_EXTREME') {
            evStatus = ''
            evColor = 'red'
            evStatusText = `Low Confidence - Extreme Condition - Auto-Tradeable (≥$${rejectEV.toFixed(2)})`
          } else {
            // Fallback to standard logic
            if (signal.expected_value >= autoTradeEV) {
              evStatus = ''
              evColor = 'green'
              evStatusText = `Auto-Tradeable (≥$${autoTradeEV.toFixed(2)})`
            } else if (signal.expected_value >= displayEV) {
              evStatus = ''
              evColor = 'yellow'
              evStatusText = `Auto-Tradeable (≥$${displayEV.toFixed(2)})`
            } else {
              evStatus = ''
              evColor = 'red'
              evStatusText = `Auto-Tradeable (≥$${rejectEV.toFixed(2)})`
            }
          }
        } else {
          // SIGNAL_ONLY or MANUAL_REVIEW mode, or rejected signal
          if (signal.expected_value >= autoTradeEV) {
            evStatus = ''
            evColor = 'green'
            evStatusText = `High EV (≥$${autoTradeEV.toFixed(2)})`
          } else if (signal.expected_value >= displayEV) {
            evStatus = ''
            evColor = 'yellow'
            evStatusText = `Medium EV (≥$${displayEV.toFixed(2)}) - Manual Review`
          } else if (signal.expected_value >= rejectEV) {
            evStatus = ''
            evColor = 'red'
            evStatusText = `Marginal EV (≥$${rejectEV.toFixed(2)}) - High Risk`
          } else {
            evStatus = ''
            evColor = 'red'
            evStatusText = `Rejected (<$${rejectEV.toFixed(2)})`
          }
        }
        
        tableRow('Expected Value:', `$${signal.expected_value.toFixed(2)}`, evColor)
        tableRow('EV Status:', evStatusText, evColor)
        
        // Show auto-tradeable status and trading mode
        if (TRADING_CONFIG.mode === 'AUTONOMOUS') {
          if (signal.auto_tradeable) {
            tableRow('Auto-Trade:', 'Yes', 'green')
            if (signal.autoTradeReason) {
              tableRow('Auto-Trade Reason:', signal.autoTradeReason, 'green')
            }
          } else {
            tableRow('Auto-Trade:', 'No - Manual Review', 'yellow')
            if (signal.rejectReason) {
              tableRow('Reject Reason:', signal.rejectReason, 'yellow')
            }
          }
        } else if (TRADING_CONFIG.mode === 'SIGNAL_ONLY') {
          tableRow('Trading Mode:', 'SIGNAL_ONLY', 'cyan')
        } else {
          tableRow('Trading Mode:', 'MANUAL_REVIEW', 'yellow')
        }
        
        // Show position size adjustment if applied
        if (signal.positionSizeMultiplier && signal.positionSizeMultiplier !== 1.0) {
          tableRow('Position Size:', `${(signal.positionSizeMultiplier * 100).toFixed(0)}% of calculated size`, 'yellow')
          if (signal.position_size_note) {
            tableRow('Size Note:', signal.position_size_note, 'yellow')
          }
        }
      }
  
  // Display warnings section for low confidence signals
  if (signal.warnings && signal.warnings.length > 0) {
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'red')
    log(`│ WARNING:`.padEnd(tableWidth - 1) + '│', 'red')
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'red')
    signal.warnings.forEach(warning => {
      // Remove emoji from warning text
      const cleanWarning = warning.replace(/[🟢🟡🔴⚠️✅❌📊📈🌐🎯💰🛡️🔪📡→•]/g, '').trim()
      log(`│ • ${cleanWarning}`.padEnd(tableWidth - 1) + '│', 'yellow')
    })
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'red')
    log(`│ Proceed at your own risk`.padEnd(tableWidth - 1) + '│', 'yellow')
  }
  
  // Display anti-knife warning if present (separate from warnings array)
  if (signal.anti_knife_warning && (!signal.warnings || !signal.warnings.includes('Catching falling knife scenario detected'))) {
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'red')
    // Remove emoji from warning text
    const cleanKnifeWarning = signal.anti_knife_warning.replace(/[🟢🟡🔴⚠️✅❌📊📈🌐🎯💰🛡️🔪📡→•]/g, '').trim()
    tableRow('HIGH RISK:', cleanKnifeWarning, 'red')
  }
  
      // Display EV warning if present (separate from warnings array)
      // Only show warning if signal is NOT auto-tradeable (in AUTONOMOUS mode) or in SIGNAL_ONLY/MANUAL_REVIEW mode
      if (signal.ev_warning && signal.ev_warning_message && 
          (!signal.warnings || !signal.warnings.some(w => w.includes('Marginal expected value'))) &&
          !(TRADING_CONFIG.mode === 'AUTONOMOUS' && signal.auto_tradeable)) {
        log('├' + '─'.repeat(tableWidth - 2) + '┤', 'yellow')
        // Remove emoji from warning text
        const cleanEVWarning = signal.ev_warning_message.replace(/[🟢🟡🔴⚠️✅❌📊📈🌐🎯💰🛡️🔪📡→•]/g, '').trim()
        tableRow('EV Warning:', cleanEVWarning, 'yellow')
      }
  
  // Display oversold warning if present (only if not already in warnings array)
  if (signal.oversold_warning && (!signal.warnings || !signal.warnings.some(w => w.includes('Oversold conditions')))) {
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'yellow')
    // Remove emoji from warning text
    const cleanOversoldWarning = signal.oversold_warning.replace(/[🟢🟡🔴⚠️✅❌📊📈🌐🎯💰🛡️🔪📡→•]/g, '').trim()
    tableRow('Warning:', cleanOversoldWarning, 'yellow')
  }
  
  // Display confidence breakdown if available
  if (signal.confidence_breakdown && Array.isArray(signal.confidence_breakdown) && signal.confidence_breakdown.length > 0) {
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
    log(`│ ${'Confidence Breakdown:'.padEnd(tableWidth - 4)} │`, 'bright')
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
    for (const breakdown of signal.confidence_breakdown) {
      const parts = breakdown.split(':')
      if (parts.length === 2) {
        const category = parts[0].trim()
        const score = parts[1].trim()
        const scoreValue = parseFloat(score.split('/')[0])
        const maxValue = parseFloat(score.split('/')[1])
        const scorePercent = maxValue > 0 ? (scoreValue / maxValue * 100).toFixed(0) : '0'
        const scoreColor = scorePercent >= 70 ? 'green' : scorePercent >= 50 ? 'yellow' : 'red'
        tableRow(`  ${category}:`, `${score} (${scorePercent}%)`, scoreColor)
      } else {
        tableRow('  ', breakdown, 'cyan')
      }
    }
    if (signal.confidence_score !== undefined && signal.confidence_max_score !== undefined) {
      const totalPercent = signal.confidence_max_score > 0 ? (signal.confidence_score / signal.confidence_max_score * 100).toFixed(0) : '0'
      tableRow('  Total Score:', `${signal.confidence_score}/${signal.confidence_max_score} (${totalPercent}%)`, confidenceColor)
    }
  }
  
  // Risk USD is already displayed in RISK MANAGEMENT section above
  // Remove duplicate display here to avoid confusion
  
  // Justification in table format (compact, wrapped text)
  if (signal.justification) {
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
    log(`│ ${'Justification:'.padEnd(tableWidth - 4)} │`, 'bright')
    log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
    
    // Handle comprehensive justification with newlines and sections
    const justification = signal.justification || 'N/A'
    
    // First, split by newlines to handle sections (ALL INDICATORS, RED FLAGS, etc.)
    const sections = justification.split('\n').filter(s => s.trim().length > 0)
    
    // Process each section
    let inRedFlagsSection = false
    let inAllIndicatorsSection = false
    
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      const trimmed = section.trim()
      if (!trimmed) continue
      
      // Remove emoji from section text before processing
      const cleanSection = trimmed.replace(/[🟢🟡🔴⚠️✅❌📊📈🌐🎯💰🛡️🔪📡→•]/g, '').trim()
      if (!cleanSection) continue
      
      // Check if this is a section header (RED FLAGS, ALL INDICATORS, etc.)
      const isRedFlagsHeader = cleanSection === 'RED FLAGS TO MONITOR:' || cleanSection.startsWith('RED FLAGS TO MONITOR:')
      const isAllIndicatorsHeader = cleanSection === 'ALL INDICATORS:' || cleanSection.startsWith('ALL INDICATORS:')
      const isWarning = cleanSection.includes('WARNING') || cleanSection.includes('CONTRADICTION')
      const isHighRisk = cleanSection.includes('HIGH RISK') || cleanSection.includes('CONTRADICTION')
      const isListItem = cleanSection.startsWith('- ') || cleanSection.startsWith('  - ')
      const isSubSection = cleanSection.startsWith('Supporting') || cleanSection.startsWith('Contradicting')
      
      // If this is a section header, display it with header format
      if (isRedFlagsHeader) {
        inRedFlagsSection = true
        inAllIndicatorsSection = false
        // Display as section header (no need for empty line, separator line is enough)
        log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
        log(`│ ${'RED FLAGS TO MONITOR:'.padEnd(tableWidth - 4)} │`, 'bright')
        log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
        continue
      } else if (isAllIndicatorsHeader) {
        inAllIndicatorsSection = true
        inRedFlagsSection = false
        // Display as section header (no need for empty line, separator line is enough)
        log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
        log(`│ ${'ALL INDICATORS:'.padEnd(tableWidth - 4)} │`, 'bright')
        log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
        continue
      }
      
      // Choose color based on section type
      let sectionColor = 'cyan'
      if (inRedFlagsSection || isHighRisk) {
        sectionColor = 'red'
      } else if (isWarning) {
        sectionColor = 'yellow'
      } else if (inAllIndicatorsSection) {
        sectionColor = 'cyan'
      }
      
      // Use full-width row for content
      fullWidthRow(cleanSection, sectionColor)
    }
  }
  
  // Invalidation Condition (ALWAYS display - CRITICAL field)
  // Based on Alpha Arena research: invalidation_condition improves performance
  log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
  const invalidationLabel = 'Invalidation:'
  log(`│ ${invalidationLabel.padEnd(tableWidth - 4)} │`, 'bright')
  log('├' + '─'.repeat(tableWidth - 2) + '┤', 'cyan')
  const invalidation = signal.invalidation_condition || 'N/A - Not specified'
  const isAutoGenerated = signal._invalidation_auto_generated === true
  
  // Show auto-generated warning as first line if applicable
  if (isAutoGenerated) {
    const autoGenWarning = 'This invalidation_condition was auto-generated based on Alpha Arena patterns'
    fullWidthRow(autoGenWarning, 'yellow')
  }
  
  // Use full-width row for invalidation text
  fullWidthRow(invalidation, 'cyan')
  
  log('└' + '─'.repeat(tableWidth - 2) + '┘', 'cyan')
}

// Track signal history to remember entry prices from first signals
const signalHistory = new Map() // Map<asset, {entryPrice, signal, timestamp}>

// Main function
async function main() {
  logSection('🚀 Signal Generation Test')
  
  // Check configuration
  if (!AI_PROVIDER_API_KEY) {
    log('❌ Error: AI_PROVIDER_API_KEY is required', 'red')
    log('   Set it with: export AI_PROVIDER_API_KEY=your_api_key', 'yellow')
    process.exit(1)
  }

  log(`AI Provider: ${AI_PROVIDER}`, 'cyan')
  log(`Model: ${MODEL_ID}`, 'cyan')
  log(`Hyperliquid API: ${HYPERLIQUID_API_URL}`, 'cyan')
  if (HYPERLIQUID_ACCOUNT_ADDRESS) {
    log(`Account Address: ${HYPERLIQUID_ACCOUNT_ADDRESS}`, 'cyan')
  } else {
    log('⚠️  No account address provided. Using mock account state.', 'yellow')
  }

  try {
    // Step 1: Get market data with technical analysis
    logSection('📊 Fetching Market Data')
    
    // Get all available assets from Hyperliquid universe
    const metadata = await getAssetMetadata()
    let universe = []
    
    if (Array.isArray(metadata) && metadata.length >= 2) {
      const metaObj = metadata[0]
      if (metaObj && metaObj.universe) {
        universe = metaObj.universe || []
      }
    } else if (metadata && metadata.data) {
      universe = metadata.data.universe || []
    }
    
    // Extract asset names from universe
    const allAvailableAssets = universe.map(item => {
      if (typeof item === 'string') return item
      return item.name || item.symbol || ''
    }).filter(name => name && name.length > 0)
    
    // Filter to top pairs that have good CoinGecko support
    // CoinGecko supports: BTC, ETH, SOL, BNB, ADA, DOGE, LTC, BCH, ETC, XLM, TRX, NEAR, FTM, ALGO, FIL, ICP, ATOM, DOT, LINK, UNI, AAVE, AVAX, MATIC, ARB, OP, SUI, APT
    // Note: Some assets like ARB, AVAX, MATIC, OP, SUI, APT are now supported
    // Updated asset list: Removed XRP and HYPE, added HYPER, RENDER, TRUMP, PENGU, KBONK, PYTH, NEAR, XLM, BLUR, ONDO, ZEC, XPL, FARTCOIN, TON, WLD
    const topPairs = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'DOGE', 'LTC', 'AVAX', 'ARB', 'HYPER', 'RENDER', 'TRUMP', 'PENGU', 'KBONK', 'PYTH', 'NEAR', 'XLM', 'BLUR', 'ONDO', 'ZEC', 'XPL', 'FARTCOIN', 'TON', 'WLD']
    const maxAssets = parseInt(process.env.MAX_ASSETS || '10') // Default: 10 assets
    let allowedAssets = topPairs.filter(asset => allAvailableAssets.includes(asset))
    
    // Apply MAX_ASSETS limit if set
    if (maxAssets > 0 && allowedAssets.length > maxAssets) {
      allowedAssets = allowedAssets.slice(0, maxAssets)
    }
    
    // If no top pairs found, use available assets (with limit if set)
    if (allowedAssets.length === 0 && allAvailableAssets.length > 0) {
      allowedAssets = maxAssets > 0 
        ? allAvailableAssets.slice(0, maxAssets)
        : allAvailableAssets
    }
    
    // Format assets as pairs (e.g., "BTC-USDC", "ETH-USDC")
    const formattedAssets = allowedAssets.map(asset => `${asset}-USDC`).join(', ')
    log(`📊 Using ${allowedAssets.length} assets: ${formattedAssets}`, 'cyan')
    
    // Now fetch market data for selected assets
    const result = await getMarketData(allowedAssets)
    
    // Handle return value - getMarketData returns { marketDataMap, allowedAssets }
    const marketData = result.marketDataMap || result
    const fetchedAssets = result.allowedAssets || allowedAssets
    
    if (!marketData) {
      throw new Error('Invalid market data returned from getMarketData')
    }
    
    // Ensure marketData is iterable (Map or Object)
    const marketDataSize = marketData instanceof Map 
      ? marketData.size 
      : (typeof marketData === 'object' ? Object.keys(marketData).length : 0)
    
    log(`✅ Fetched market data for ${marketDataSize} assets`, 'green')
    
    // Iterate over market data
    const marketDataEntries = marketData instanceof Map 
      ? Array.from(marketData.entries())
      : Object.entries(marketData || {})
    
    for (const [asset, data] of marketDataEntries) {
      if (data && data.indicators) {
        log(`   ${asset}: $${data.price?.toFixed(2) || '0.00'} | RSI(14): ${data.indicators.rsi14?.toFixed(2) || 'N/A'} | EMA(20): $${data.indicators.ema20?.toFixed(2) || 'N/A'} | MACD: ${data.indicators.macd ? data.indicators.macd.histogram.toFixed(4) : 'N/A'}`, 'cyan')
      } else if (data) {
        log(`   ${asset}: $${data.price?.toFixed(2) || '0.00'} | Technical analysis not available`, 'cyan')
      }
    }

    // Step 2: Get account state with retry mechanism
    logSection('💰 Fetching Account State')
    let accountState = {
      accountValue: 90, // $90 capital
      availableCash: 90, // $90 capital
      totalReturnPercent: 0,
      activePositions: [],
      sharpeRatio: 0
    }
    
    let accountStateFetchFailed = false
    let accountStateFetchAttempts = 0
    const MAX_ACCOUNT_STATE_FAILURES = 2

    if (HYPERLIQUID_ACCOUNT_ADDRESS) {
      const userState = await getUserState(HYPERLIQUID_ACCOUNT_ADDRESS, 3, 1000)
      if (userState && userState.data) {
        accountStateFetchAttempts = 0 // Reset on success
        const marginSummary = userState.data.marginSummary || userState.data.crossMarginSummary
        if (marginSummary) {
          accountState.accountValue = parseFloat(marginSummary.accountValue || '0')
          accountState.availableCash = parseFloat(marginSummary.availableCash || '0')
        }
        log(`✅ Account Value: $${accountState.accountValue.toFixed(2)}`, 'green')
        log(`✅ Available Cash: $${accountState.availableCash.toFixed(2)}`, 'green')
        
        // Parse active positions from userState
        // Hyperliquid returns: { assetPositions: [{ position: { coin: "BTC", szi: "1.5", entryPx: "50000", ... } }] }
        if (userState.data.assetPositions && Array.isArray(userState.data.assetPositions)) {
          accountState.activePositions = userState.data.assetPositions
            .filter(pos => {
              // Filter out positions with zero size
              if (!pos || !pos.position) return false
              const szi = parseFloat(pos.position.szi || '0')
              return Math.abs(szi) > 0.0001 // Only include non-zero positions
            })
            .map(pos => {
              const position = pos.position || {}
              const coin = position.coin || ''
              const szi = parseFloat(position.szi || '0') // Size (positive = LONG, negative = SHORT)
              const entryPx = parseFloat(position.entryPx || '0') // Entry price
              const unrealizedPnl = parseFloat(position.unrealizedPnl || '0') // Unrealized PnL
              
              // Leverage might be in different formats: { value: "2" } or just a number/string
              let leverage = 1
              if (position.leverage) {
                if (typeof position.leverage === 'object' && position.leverage.value) {
                  leverage = parseFloat(position.leverage.value || '1')
                } else {
                  leverage = parseFloat(position.leverage || '1')
                }
              }
              
              // Get current price from market data
              const assetData = marketData instanceof Map ? marketData.get(coin) : marketData[coin]
              const currentPrice = assetData?.price || entryPx
              
              return {
                symbol: coin,
                quantity: Math.abs(szi),
                entryPrice: entryPx,
                currentPrice: currentPrice,
                leverage: leverage || 1,
                unrealizedPnl: unrealizedPnl,
                side: szi > 0 ? 'LONG' : 'SHORT',
                entryTime: Date.now() // Hyperliquid doesn't provide entry time, use current time
              }
            })
          
          if (accountState.activePositions.length > 0) {
            log(`✅ Found ${accountState.activePositions.length} active position(s)`, 'green')
            for (const pos of accountState.activePositions) {
              const pnlPercent = pos.entryPrice > 0 
                ? (((pos.currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'LONG' ? 1 : -1)).toFixed(2)
                : '0.00'
              const pnlColor = parseFloat(pnlPercent) >= 0 ? 'green' : 'red'
              log(`   ${pos.symbol}: ${pos.side} ${pos.quantity} @ $${pos.entryPrice.toFixed(2)} | PnL: ${pnlPercent}% ($${pos.unrealizedPnl.toFixed(2)})`, pnlColor)
            }
          } else {
            log(`✅ No active positions`, 'green')
          }
        }
      } else {
        accountStateFetchAttempts++
        accountStateFetchFailed = accountStateFetchAttempts > MAX_ACCOUNT_STATE_FAILURES
        log('⚠️  Could not fetch account state. Using mock data.', 'yellow')
        if (accountStateFetchFailed) {
          log('❌ Account state fetch failed >2x. BLOCKING ALL SIGNALS until resolved.', 'red')
          log('   Please check your Hyperliquid API connection and account address.', 'yellow')
        }
      }
    } else {
      log('⚠️  No account address provided. Using mock account state.', 'yellow')
    }

    // Step 3: Check AI configuration
    logSection('🤖 AI Configuration')
    if (!AI_PROVIDER_API_KEY) {
      log('❌ Error: AI_PROVIDER_API_KEY is required', 'red')
      log('   Set it with: export AI_PROVIDER_API_KEY=your_api_key', 'yellow')
      process.exit(1)
    }
    log(`✅ AI Provider: ${AI_PROVIDER}`, 'green')
    log(`✅ Model: ${MODEL_ID}`, 'green')

    // Step 4: Generate signals
    logSection('📡 Generating Trading Signals')
    
    // Block signals if account state fetch failed >2x
    if (accountStateFetchFailed) {
      log('❌ SIGNAL GENERATION BLOCKED: Account state fetch failed >2x', 'red')
      log('   All signals are blocked until account state can be fetched successfully.', 'yellow')
      log('   Please check your Hyperliquid API connection and account address.', 'yellow')
      log('   Exiting without generating signals.', 'red')
      process.exit(1)
    }
    
    log('Generating signals... This may take a moment...', 'cyan')
    
    const signals = await generateSignals(null, marketData, accountState, allowedAssets)
    
    log(`✅ Generated ${signals.length} signals`, 'green')

    // Step 5: Get and display active positions
    const positions = getActivePositions(accountState)
    if (positions.size > 0) {
      logSection('📊 Active Positions')
      for (const [asset, pos] of positions) {
        const assetData = marketData instanceof Map ? marketData.get(asset) : marketData[asset]
        const currentPrice = assetData?.price || pos.currentPrice || 0
        const pnlPercent = pos.entryPrice > 0 
          ? (((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * (pos.side === 'LONG' ? 1 : -1)).toFixed(2)
          : '0.00'
        const pnlColor = parseFloat(pnlPercent) >= 0 ? 'green' : 'red'
        log(`   ${asset}: ${pos.side} ${Math.abs(pos.quantity)} @ $${pos.entryPrice.toFixed(2)} | Current: $${currentPrice.toFixed(2)} | PnL: ${pnlPercent}% ($${pos.unrealizedPnl?.toFixed(2) || '0.00'})`, pnlColor)
      }
    } else {
      logSection('📊 Active Positions')
      log(`   No active positions`, 'yellow')
    }
    
    // Step 6: Display warnings first (before signals table)
    if (signalWarnings.length > 0) {
      console.log('') // Empty line
      logSection('⚠️  Signal Processing Warnings')
      // Group warnings by asset
      const warningsByAsset = {}
      signalWarnings.forEach(warning => {
        if (!warningsByAsset[warning.asset]) {
          warningsByAsset[warning.asset] = []
        }
        warningsByAsset[warning.asset].push(warning)
      })
      
      // Display warnings grouped by asset with better formatting
      for (const [asset, assetWarnings] of Object.entries(warningsByAsset)) {
        log(`   📊 ${asset}:`, 'yellow')
        assetWarnings.forEach((warning, idx) => {
          if (idx > 0) {
            console.log('') // Empty line between warnings
          }
          log(`   ${warning.message}`, 'yellow')
          if (warning.details) {
            if (Array.isArray(warning.details)) {
              warning.details.forEach(detail => {
                if (detail && typeof detail === 'string') { // Skip null/undefined details
                  log(`      ${detail}`, 'yellow')
                }
              })
            } else if (typeof warning.details === 'string') {
              log(`      ${warning.details}`, 'yellow')
            }
          }
        })
      }
      console.log('') // Empty line after warnings
    }
    
    // Step 7: Filter signals by contradiction score and display all qualifying signals
    logSection('📊 Generated Signals')
    
    // Filter out HOLD signals and calculate contradiction score for each signal
    const actionableSignals = signals.filter(s => 
      s.signal === 'buy_to_enter' || 
      s.signal === 'sell_to_enter' || 
      s.signal === 'add' || 
      s.signal === 'close' || 
      s.signal === 'close_all' || 
      s.signal === 'reduce'
    )
    
    // Calculate contradiction score for each signal
    // Contradiction score is based on how many indicators contradict the signal
    const signalsWithContradiction = actionableSignals.map(signal => {
      const assetData = marketData instanceof Map ? marketData.get(signal.coin) : marketData[signal.coin]
      const indicators = assetData?.indicators || assetData?.data?.indicators
      const trendAlignment = assetData?.data?.trendAlignment || assetData?.trendAlignment
      
      // Calculate contradiction score using detectContradictions
      const contradictionResult = detectContradictions(signal, indicators, trendAlignment)
      const contradictionScore = contradictionResult.contradictionScore || 0
      const hasContradictions = contradictionResult.hasContradictions || false
      
      // Store contradiction score in signal
      signal.contradictionScore = contradictionScore
      signal.hasContradictions = hasContradictions
      signal.contradictions = contradictionResult.contradictions || []
      
      return signal
    })
    
    // Log contradiction scores for debugging
    console.log(`\n📊 Contradiction Score Analysis:`)
    const scores = signalsWithContradiction.map(s => ({
      coin: s.coin,
      signal: s.signal,
      score: s.contradictionScore || 0,
      contradictions: s.contradictions?.length || 0
    })).sort((a, b) => b.score - a.score)
    
    scores.forEach(s => {
      console.log(`   ${s.coin}-USDC ${s.signal.toUpperCase()}: Score=${s.score}, Contradictions=${s.contradictions}`)
    })
    
    // Calculate statistics
    const maxScore = Math.max(...scores.map(s => s.score), 0)
    const minScore = Math.min(...scores.map(s => s.score), 0)
    const avgScore = scores.length > 0 ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length : 0
    const medianScore = scores.length > 0 ? scores[Math.floor(scores.length / 2)].score : 0
    
    console.log(`   Max Score: ${maxScore}, Min Score: ${minScore}, Avg Score: ${avgScore.toFixed(2)}, Median Score: ${medianScore}`)
    
    // Filter signals by HIGH CONFIDENCE (>=0.45) and contradiction score 0-3
    // Reward: If confidence > 60%, reduce contradiction score by 2 points
    // Get HIGH CONFIDENCE threshold from config
    const HIGH_CONFIDENCE_THRESHOLD = TRADING_CONFIG?.thresholds?.confidence?.high || 0.45
    const HIGH_CONFIDENCE_REWARD_THRESHOLD = 0.60  // 60% - if above this, get -2 points reward
    const CONTRADICTION_REWARD = 2  // Points to subtract for high confidence signals
    const MIN_CONTRADICTION_SCORE = 0
    const MAX_CONTRADICTION_SCORE = 3  // Range back to 0-3
    
    // Apply confidence reward: reduce contradiction score by 2 if confidence > 60%
    const signalsWithReward = signalsWithContradiction.map(signal => {
      const confidence = signal.confidence || 0
      let adjustedScore = signal.contradictionScore || 0
      
      // Reward: If confidence > 60%, reduce contradiction score by 2 points
      if (confidence > HIGH_CONFIDENCE_REWARD_THRESHOLD) {
        const originalScore = adjustedScore
        adjustedScore = Math.max(0, adjustedScore - CONTRADICTION_REWARD)  // Don't go below 0
        if (originalScore !== adjustedScore) {
          console.log(`   🎁 Reward applied: ${signal.coin}-USDC ${signal.signal.toUpperCase()} (Confidence: ${(confidence * 100).toFixed(2)}% > 60%) - Contradiction Score: ${originalScore} → ${adjustedScore} (-${CONTRADICTION_REWARD})`)
        }
      }
      
      return {
        ...signal,
        adjustedContradictionScore: adjustedScore,
        originalContradictionScore: signal.contradictionScore || 0
      }
    })
    
    // Filter: HIGH CONFIDENCE + adjusted contradiction score 0-3
    const qualifyingSignals = signalsWithReward.filter(signal => {
      const confidence = signal.confidence || 0
      const adjustedScore = signal.adjustedContradictionScore || 0
      
      // Must be HIGH CONFIDENCE (>=0.45) AND adjusted contradiction score between 0-3
      const isHighConfidence = confidence >= HIGH_CONFIDENCE_THRESHOLD
      const hasValidContradictionScore = adjustedScore >= MIN_CONTRADICTION_SCORE && adjustedScore <= MAX_CONTRADICTION_SCORE
      
      if (!isHighConfidence || !hasValidContradictionScore) {
        const originalScore = signal.originalContradictionScore || 0
        const scoreInfo = originalScore !== adjustedScore 
          ? `${originalScore} (adjusted: ${adjustedScore}${confidence > HIGH_CONFIDENCE_REWARD_THRESHOLD ? `, -${CONTRADICTION_REWARD} reward` : ''})`
          : adjustedScore
        collectWarning(signal.coin, `⚠️  Filtering out ${signal.signal} signal: ${!isHighConfidence ? `Confidence too low (${(confidence * 100).toFixed(2)}% < ${(HIGH_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%)` : `Contradiction score out of range (${scoreInfo}, must be 0-3 after adjustment)`}`, [
          `   Signal filtered: Confidence=${(confidence * 100).toFixed(2)}%, Contradiction Score=${scoreInfo}`,
          `   Requirements: Confidence >= ${(HIGH_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%, Contradiction Score 0-3 (after ${confidence > HIGH_CONFIDENCE_REWARD_THRESHOLD ? `${CONTRADICTION_REWARD}-point reward if >60%` : 'no reward'})`
        ])
        console.log(`   ❌ Filtered: ${signal.coin}-USDC ${signal.signal.toUpperCase()} (Confidence: ${(confidence * 100).toFixed(2)}%, Contradiction: ${scoreInfo})`)
        return false
      }
      return true
    })
    
    const filteredCount = signalsWithContradiction.length - qualifyingSignals.length
    
    console.log(`   ✅ Qualifying signals: ${qualifyingSignals.length}/${signalsWithContradiction.length} (HIGH CONFIDENCE >=${(HIGH_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%, Contradiction Score 0-3${HIGH_CONFIDENCE_REWARD_THRESHOLD * 100 > 0 ? `, -${CONTRADICTION_REWARD} reward if >${(HIGH_CONFIDENCE_REWARD_THRESHOLD * 100).toFixed(0)}%` : ''})`)
    
    // Sort by confidence (highest first), then by adjusted contradiction score (lower is better)
    const sortedSignals = qualifyingSignals.sort((a, b) => {
      const scoreA = a.adjustedContradictionScore || a.contradictionScore || 0
      const scoreB = b.adjustedContradictionScore || b.contradictionScore || 0
      const confA = a.confidence || 0
      const confB = b.confidence || 0
      
      // Primary sort: confidence (highest first)
      if (confB !== confA) {
        return confB - confA
      }
      // Secondary sort: contradiction score (lower is better)
      if (scoreA !== scoreB) {
        return scoreA - scoreB
      }
      
      // Tertiary sort: prioritize BUY/SELL over other signals
      const priorityA = (a.signal === 'buy_to_enter' || a.signal === 'sell_to_enter') ? 1 : 0
      const priorityB = (b.signal === 'buy_to_enter' || b.signal === 'sell_to_enter') ? 1 : 0
      if (priorityB !== priorityA) {
        return priorityB - priorityA
      }
      
      return 0
    })
    
    if (sortedSignals.length === 0) {
      log('⚠️  No qualifying signals generated', 'yellow')
      log('\n✅ Signal generation test completed successfully!', 'green')
      log('⚠️  Note: No trades were executed. This is signal-only mode.', 'yellow')
      return
    }
    
    log(`✅ Found ${sortedSignals.length} qualifying signal(s) (HIGH CONFIDENCE >=${(HIGH_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%, Contradiction Score 0-3${HIGH_CONFIDENCE_REWARD_THRESHOLD * 100 > 0 ? `, -${CONTRADICTION_REWARD} reward if >${(HIGH_CONFIDENCE_REWARD_THRESHOLD * 100).toFixed(0)}%` : ''})`, 'green')
    log(`   Total signals generated: ${signals.length}`, 'cyan')
    log(`   Actionable signals: ${actionableSignals.length}`, 'cyan')
    log(`   Signals filtered out: ${filteredCount} (not HIGH CONFIDENCE or contradiction score not 0-3 after adjustment)`, 'cyan')
    log(`   Qualifying signals: ${qualifyingSignals.length} (HIGH CONFIDENCE + Contradiction 0-3${HIGH_CONFIDENCE_REWARD_THRESHOLD * 100 > 0 ? `, with -${CONTRADICTION_REWARD} reward for >${(HIGH_CONFIDENCE_REWARD_THRESHOLD * 100).toFixed(0)}%` : ''})`, 'cyan')
    
    // Display all qualifying signals with full format
    for (let i = 0; i < sortedSignals.length; i++) {
      const signal = sortedSignals[i]
      
      // Determine signal color for log
      const signalType = signal.signal.toUpperCase()
      let signalColor = 'yellow'
      if (signalType === 'BUY_TO_ENTER' || signalType === 'ADD') signalColor = 'green'
      else if (signalType === 'SELL_TO_ENTER') signalColor = 'red'
      else if (signalType === 'HOLD') signalColor = 'yellow'
      
      // Log signal header
      // Display adjusted contradiction score if reward was applied
      const adjustedScore = signal.adjustedContradictionScore !== undefined ? signal.adjustedContradictionScore : (signal.contradictionScore || 0)
      const originalScore = signal.originalContradictionScore !== undefined ? signal.originalContradictionScore : (signal.contradictionScore || 0)
      const hasReward = originalScore !== adjustedScore && signal.confidence > 0.60
      const contradictionInfo = adjustedScore > 0 || hasReward
        ? ` (Contradiction Score: ${adjustedScore}${hasReward ? ` [${originalScore} → ${adjustedScore}, -2 reward]` : ''})`
        : ''
      log(`\n📊 Signal ${i + 1}/${sortedSignals.length}: ${signal.coin} - ${signal.signal.toUpperCase()} (Confidence: ${((signal.confidence || 0) * 100).toFixed(2)}%${contradictionInfo})`, signalColor)
      
      // Track entry price and confidence from signal (for weighted decay)
      if ((signal.signal === 'buy_to_enter' || signal.signal === 'sell_to_enter') && signal.entry_price && signal.entry_price > 0) {
        signalHistory.set(signal.coin, {
          entryPrice: signal.entry_price,
          signal: signal.signal,
          confidence: signal.confidence || 0.5,
          timestamp: Date.now()
        })
      }
      
      // Display signal with full format
      await formatSignal(signal, i, marketData, positions, signalHistory, accountState)
      
      // Update positions for next iteration (simulation)
      updateActivePositions(signal)
      
      // Add separator between signals (except for last one)
      if (i < sortedSignals.length - 1) {
        console.log('') // Empty line between signals
      }
    }

    // Step 7: Summary (for all qualifying signals)
    logSection('📈 Signal Summary')
    log(`Total Signals Generated: ${signals.length} from ${allowedAssets.length} assets (${allowedAssets.length - signals.length} assets did not generate signals)`, 'cyan')
    log(`Actionable Signals: ${actionableSignals.length}`, 'cyan')
    log(`Signals Filtered Out: ${filteredCount} (not HIGH CONFIDENCE >=${(HIGH_CONFIDENCE_THRESHOLD * 100).toFixed(0)}% or contradiction score not 0-3 after adjustment)`, 'cyan')
    log(`Qualifying Signals (HIGH CONFIDENCE >=${(HIGH_CONFIDENCE_THRESHOLD * 100).toFixed(0)}%, Contradiction Score 0-3${HIGH_CONFIDENCE_REWARD_THRESHOLD * 100 > 0 ? `, -${CONTRADICTION_REWARD} reward if >${(HIGH_CONFIDENCE_REWARD_THRESHOLD * 100).toFixed(0)}%` : ''}): ${qualifyingSignals.length}`, 'cyan')
    log(`Signals Displayed: ${sortedSignals.length}`, 'cyan')
    
    // Show signal details
    for (const signal of sortedSignals) {
      const signalType = signal.signal.toUpperCase()
      let signalColor = 'yellow'
      if (signalType === 'BUY_TO_ENTER' || signalType === 'ADD') signalColor = 'green'
      else if (signalType === 'SELL_TO_ENTER') signalColor = 'red'
      
      // Display adjusted contradiction score if reward was applied
      const adjustedScore = signal.adjustedContradictionScore !== undefined ? signal.adjustedContradictionScore : (signal.contradictionScore || 0)
      const originalScore = signal.originalContradictionScore !== undefined ? signal.originalContradictionScore : (signal.contradictionScore || 0)
      const hasReward = originalScore !== adjustedScore && signal.confidence > 0.60
      const contradictionInfo = adjustedScore > 0 || hasReward
        ? ` | Contradiction Score: ${adjustedScore}${hasReward ? ` [${originalScore}→${adjustedScore}, -2 reward]` : ''}`
        : ''
      log(`   - ${signal.coin}-USDC: ${signal.signal.toUpperCase()} (Confidence: ${((signal.confidence || 0) * 100).toFixed(2)}%${contradictionInfo})`, signalColor)
    }

    log('\n✅ Signal generation test completed successfully!', 'green')
    log('⚠️  Note: No trades were executed. This is signal-only mode.', 'yellow')

  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red')
    if (error.stack) {
      log(`\nStack trace:\n${error.stack}`, 'red')
    }
    process.exit(1)
  }
}

// Run main function
main().catch(error => {
  log(`\n❌ Fatal error: ${error.message}`, 'red')
  process.exit(1)
})



