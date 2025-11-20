# Migration Guide: test-signal-generation.js → TypeScript Modular

Panduan untuk mengkonversi `test-signal-generation.js` (15,174 baris, 99 fungsi) menjadi struktur modular TypeScript.

## 📋 Status Konversi

### ✅ Completed (11/99 functions ~11%)
- [x] `formatPrice` → `formatting/price.ts`
- [x] `formatLargeNumber` → `formatting/price.ts`
- [x] `calculateSMA` → `technical-indicators/moving-averages.ts`
- [x] `calculateEMA` → `technical-indicators/moving-averages.ts`
- [x] `calculateRSI` → `technical-indicators/momentum.ts`
- [x] `calculateMACD` → `technical-indicators/momentum.ts`
- [x] `calculateStochastic` → `technical-indicators/momentum.ts`
- [x] `calculateCCI` → `technical-indicators/momentum.ts`
- [x] `calculateWilliamsR` → `technical-indicators/momentum.ts`
- [x] `calculateBollingerBands` → `technical-indicators/volatility.ts`
- [x] `calculateATR` → `technical-indicators/volatility.ts`
- [x] `calculateOBV` → `technical-indicators/volume.ts`
- [x] `calculateVWAP` → `technical-indicators/volume.ts`

### 🔄 Next Priority Functions

#### Technical Indicators (Remaining ~20 functions)
- [ ] `calculateADX` → `technical-indicators/trend.ts`
- [ ] `calculateParabolicSAR` → `technical-indicators/trend.ts`
- [ ] `calculateAroon` → `technical-indicators/trend.ts`
- [ ] `calculateSupportResistance` → `technical-indicators/trend.ts`
- [ ] `detectTrend` → `analysis/trend-detection.ts`
- [ ] `detectMarketStructure` → `analysis/trend-detection.ts`
- [ ] `detectDivergence` → `analysis/divergence.ts`
- [ ] `detectCandlestickPatterns` → `analysis/candlestick.ts`
- [ ] `detectMarketRegime` → `analysis/market-regime.ts`

#### Data Fetchers (~10 functions)
- [ ] `getHistoricalDataFromBinance` → `data-fetchers/binance.ts`
- [ ] `getHistoricalDataFromOKX` → `data-fetchers/okx.ts`
- [ ] `getHistoricalDataFromCoinGecko` → `data-fetchers/coingecko.ts` (to be removed)
- [ ] `getHistoricalDataFromCoinMarketCap` → `data-fetchers/coinmarketcap.ts`
- [ ] `getHistoricalData` → `data-fetchers/historical-data.ts`
- [ ] `getMultiTimeframeData` → `data-fetchers/historical-data.ts`
- [ ] `fetchHyperliquid` → `data-fetchers/hyperliquid.ts`
- [ ] `getAssetMetadata` → `data-fetchers/hyperliquid.ts`
- [ ] `getUserState` → `data-fetchers/hyperliquid.ts`
- [ ] `getMarketData` → `data-fetchers/hyperliquid.ts`

#### Analysis (~15 functions)
- [ ] `detectContradictions` → `analysis/contradiction.ts`
- [ ] `calculateCorrelationMatrix` → `analysis/correlation.ts`
- [ ] `calculateCorrelation` → `analysis/correlation.ts`
- [ ] `calculateEnhancedMetrics` → `analysis/enhanced-metrics.ts`
- [ ] `calculateOrderBookDepth` → `analysis/orderbook.ts`
- [ ] `calculateSessionVolumeProfile` → `analysis/volume-profile.ts`
- [ ] `calculateCompositeVolumeProfile` → `analysis/volume-profile.ts`
- [ ] `detectChangeOfCharacter` → `analysis/market-structure.ts`
- [ ] `calculateCumulativeVolumeDelta` → `analysis/volume-profile.ts`

#### Signal Generation (~15 functions)
- [ ] `generateSignals` → `signal-generation/generator.ts`
- [ ] `calculateConfidenceScore` → `signal-generation/confidence.ts`
- [ ] `calculateExpectedValue` → `signal-generation/expected-value.ts`
- [ ] `shouldAutoExecute` → `signal-generation/filtering.ts`
- [ ] `checkRiskLimits` → `signal-generation/filtering.ts`
- [ ] `generateInvalidationCondition` → `signal-generation/generator.ts`
- [ ] `generateJustificationFromIndicators` → `signal-generation/generator.ts`
- [ ] `generateRedFlagsSection` → `signal-generation/generator.ts`
- [ ] `validateSignalJustificationConsistency` → `signal-generation/generator.ts`

#### Risk Management (~10 functions)
- [ ] `calculateDynamicLeverage` → `risk-management/leverage.ts`
- [ ] `calculateDynamicMarginPercentage` → `risk-management/margin.ts`
- [ ] `calculateMAE` → `risk-management/mae.ts`
- [ ] `calculateBounceTP` → `risk-management/take-profit.ts`
- [ ] `calculateDynamicTP` → `risk-management/take-profit.ts`
- [ ] `calculateBounceTPTrail` → `risk-management/take-profit.ts`
- [ ] `calculateBounceSLOffset` → `risk-management/stop-loss.ts`

#### Utilities (~10 functions)
- [ ] `log` → `utils/logger.ts`
- [ ] `logSection` → `utils/logger.ts`
- [ ] `interpolateToHourly` → `utils/interpolation.ts`
- [ ] `getCacheTTLForInterval` → `utils/cache.ts`
- [ ] `parseCandles` → `utils/data-parsing.ts`
- [ ] `calculateMultiTimeframeIndicators` → `utils/multi-timeframe.ts`
- [ ] `checkTrendAlignment` → `utils/multi-timeframe.ts`
- [ ] `collectWarning` → `utils/logger.ts`

#### Main Entry (~3 functions)
- [ ] `main` → `index.ts`
- [ ] `formatSignal` → `formatting/signal.ts`
- [ ] `getActivePositions` → `utils/positions.ts`

## 🛠️ Proses Konversi

### Step 1: Identifikasi Fungsi
1. Buka `scripts/test-signal-generation.js`
2. Cari fungsi dengan `grep -n "^function "` atau `grep -n "^async function "`
3. Identifikasi kategori fungsi (lihat mapping di atas)

### Step 2: Ekstrak ke Modul
1. Buat file baru di folder yang sesuai (atau edit file yang sudah ada)
2. Copy fungsi dari JS ke TS
3. Tambahkan type annotations
4. Import dependencies yang diperlukan
5. Export fungsi

### Step 3: Update Exports
1. Export dari module's `index.ts`
2. Export dari main `index.ts` jika perlu
3. Update types di `types/index.ts` jika perlu

### Step 4: Test
1. Run TypeScript compiler: `npx tsc --noEmit`
2. Check for errors
3. Test functionality

## 📝 Contoh Konversi

### Before (JavaScript)
```javascript
function calculateSMA(values, period) {
  if (values.length < period) return []
  const sma = []
  for (let i = period - 1; i < values.length; i++) {
    const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    sma.push(sum / period)
  }
  return sma
}
```

### After (TypeScript)
```typescript
export function calculateSMA(values: number[], period: number): number[] {
  if (values.length < period) return []
  
  const sma: number[] = []
  for (let i = period - 1; i < values.length; i++) {
    const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
    sma.push(sum / period)
  }
  
  return sma
}
```

## 🎯 Tips

1. **Start Small**: Convert simple utility functions first
2. **Type Everything**: Add proper TypeScript types
3. **Test Incrementally**: Test after each major module
4. **Keep Parity**: Ensure 100% feature parity with original
5. **Document**: Add JSDoc comments where helpful

## 📚 Reference

- Original file: `scripts/test-signal-generation.js` (15,174 lines)
- Target structure: `src/signal-generation/` (modular TypeScript)
- Types: `src/signal-generation/types/index.ts`

