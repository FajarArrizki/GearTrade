// Trading Configuration
// Centralized configuration for autonomous futures trading system
// Full auto-execution untuk BTC & ETH futures (long/short)

module.exports = {
  // Mode
  mode: 'AUTONOMOUS',  // AUTONOMOUS | SIGNAL_ONLY | MANUAL_REVIEW

  // Thresholds untuk Autonomous Futures Trading
  // Lebih aggressive karena:
  // 1. Cuma 2 pairs (BTC, ETH)
  // 2. Futures = bisa long/short fleksibel
  // 3. Full automation tanpa manual review
  thresholds: {
    confidence: {
      high: 0.60,        // 60% - High confidence → full position
      medium: 0.32,      // 32% - Medium confidence → 70% position
      low: 0.25,         // 25% - Low confidence → 50% position (oversold/overbought extreme only)
      reject: 0.20       // 20% - Hard reject < 20%
    },
    expectedValue: {
      high: 0.8,         // $0.80 - Excellent EV
      medium: 0.3,       // $0.30 - Good EV
      low: 0.0,          // $0.00 - Acceptable (breakeven+)
      reject: -0.3       // -$0.30 - Reject deep negative only
    }
  },

  // Position sizing adjustments based on confidence
  positionSizing: {
    highConfidence: 1.0,    // 100% of calculated size
    mediumConfidence: 0.7,  // 70% of calculated size
    lowConfidence: 0.5,     // 50% of calculated size
  },

  // Safety limits
  safety: {
    maxRiskPerTrade: 2.0,        // 2% max risk per trade
    maxOpenPositions: 2,          // Both pairs max
    dailyLossLimit: 5.0,          // Stop if -5% daily loss
    consecutiveLosses: 3,         // Pause after 3 consecutive losses
    minAccountBalance: 10.0       // Minimum $10 balance
  },

  // Special rules untuk limited pairs
  limitedPairsMode: {
    enabled: true,
    minPairs: 2,
    relaxThresholds: true,        // Auto-relax jika < 3 pairs
    allowOversoldPlays: true,
    requireDiversification: false, // Boleh both BTC+ETH long/short
    correlationThreshold: 0.7      // High correlation threshold for same direction
  }
}

