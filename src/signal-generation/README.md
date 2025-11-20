# Signal Generation - Modular TypeScript Version

Modular TypeScript version of `test-signal-generation.js` with 100% feature parity.

## 📁 Structure

```
src/signal-generation/
├── types/                    # TypeScript type definitions
│   └── index.ts
├── technical-indicators/     # Technical analysis indicators
│   ├── moving-averages.ts    # SMA, EMA
│   ├── momentum.ts           # RSI, MACD, Stochastic, CCI, Williams %R
│   ├── volatility.ts         # ATR, Bollinger Bands
│   ├── volume.ts             # OBV, VWAP
│   ├── trend.ts               # ADX, Parabolic SAR, Aroon
│   └── index.ts
├── data-fetchers/           # Market data fetching
│   ├── binance.ts           # Binance API
│   ├── hyperliquid.ts       # Hyperliquid API
│   ├── okx.ts               # OKX API
│   ├── historical-data.ts   # Historical data aggregation
│   └── index.ts
├── analysis/                # Market analysis functions
│   ├── trend-detection.ts   # Trend, market structure detection
│   ├── divergence.ts        # Divergence detection
│   ├── market-regime.ts     # Market regime analysis
│   ├── contradiction.ts     # Contradiction detection
│   ├── correlation.ts       # Correlation matrix
│   └── index.ts
├── formatting/              # Display formatting
│   ├── price.ts             # Price formatting
│   ├── table.ts             # Table display
│   └── index.ts
├── risk-management/         # Risk management
│   ├── leverage.ts          # Dynamic leverage calculation
│   ├── margin.ts            # Margin calculation
│   ├── stop-loss.ts         # Stop loss calculation
│   ├── mae.ts               # Maximum Adverse Excursion
│   └── index.ts
├── signal-generation/       # Signal generation logic
│   ├── generator.ts         # Main signal generation
│   ├── confidence.ts        # Confidence calculation
│   ├── expected-value.ts    # Expected value calculation
│   ├── filtering.ts         # Signal filtering
│   └── index.ts
├── utils/                   # Utilities
│   ├── logger.ts            # Logging functions
│   ├── cache.ts             # Caching utilities
│   ├── interpolation.ts     # Data interpolation
│   └── index.ts
└── index.ts                 # Main entry point

```

## 🚀 Usage

```typescript
import { generateSignals } from './signal-generation'

const signals = await generateSignals({
  model: aiModel,
  marketData: marketDataMap,
  accountState: userState,
  allowedAssets: ['BTC', 'ETH', 'SOL']
})
```

## 📝 Migration Status

### ✅ Completed
- [x] Folder structure
- [x] TypeScript types
- [x] Technical indicators: Moving averages (SMA, EMA)
- [x] Technical indicators: Momentum (RSI, MACD, Stochastic, CCI, Williams %R)
- [x] Formatting: Price formatting

### 🔄 In Progress
- [ ] Technical indicators: Volatility (ATR, Bollinger Bands)
- [ ] Technical indicators: Volume (OBV, VWAP)
- [ ] Technical indicators: Trend (ADX, Parabolic SAR, Aroon)

### 📋 TODO
- [ ] Data fetchers (Binance, Hyperliquid, OKX)
- [ ] Analysis functions (trend detection, divergence, market regime)
- [ ] Signal generation logic
- [ ] Risk management functions
- [ ] Utils (logging, caching, interpolation)
- [ ] Main entry point (index.ts)

## 🔧 Development

This is a modular conversion from the monolithic `test-signal-generation.js` file. Each function is organized by category and converted to TypeScript with proper typing.

### Adding New Functions

1. Identify the function category
2. Add to appropriate module file
3. Export from module's `index.ts`
4. Add types to `types/index.ts` if needed
5. Import and use in main `index.ts`

## 📚 Function Mapping

### Original JS → TypeScript Modules

| Original Function | New Location | Status |
|------------------|--------------|--------|
| `calculateSMA` | `technical-indicators/moving-averages.ts` | ✅ |
| `calculateEMA` | `technical-indicators/moving-averages.ts` | ✅ |
| `calculateRSI` | `technical-indicators/momentum.ts` | ✅ |
| `calculateMACD` | `technical-indicators/momentum.ts` | ✅ |
| `formatPrice` | `formatting/price.ts` | ✅ |
| `formatLargeNumber` | `formatting/price.ts` | ✅ |

*More mappings will be added as migration progresses*

