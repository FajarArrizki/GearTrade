/**
 * Trading Mode Switcher Component
 * Allows users to switch between Testnet and Mainnet, and between Spot and Futures
 */

import { useTradingMode, TradingMode, TradingType } from '@/contexts/TradingModeContext';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function TradingModeSwitcher() {
  const { tradingMode, setTradingMode, tradingType, setTradingType } = useTradingMode();

  const modes: { value: TradingMode; label: string; color: string }[] = [
    {
      value: 'testnet',
      label: 'Pepertrade',
      color: 'bg-green-500 hover:bg-green-600',
    },
    {
      value: 'mainnet',
      label: 'Real Trade',
      color: 'bg-red-500 hover:bg-red-600',
    },
  ];

  const handleModeClick = (mode: TradingMode) => {
    console.log('[TradingModeSwitcher] Button clicked, target mode:', mode);
    console.log('[TradingModeSwitcher] Current tradingMode:', tradingMode);
    try {
      setTradingMode(mode);
      console.log('[TradingModeSwitcher] setTradingMode called successfully');
    } catch (error) {
      console.error('[TradingModeSwitcher] Error calling setTradingMode:', error);
    }
  };

  const handleTypeChange = (type: TradingType) => {
    console.log('[TradingModeSwitcher] Trading type changed to:', type);
    setTradingType(type);
  };

  return (
    <div className="flex items-center space-x-3">
      <div className="flex items-center space-x-2">
        <span className="text-xs font-medium text-gray-600">Mode:</span>
        <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5">
          {modes.map((mode) => (
            <button
              key={mode.value}
              onClick={() => handleModeClick(mode.value)}
              className={`
                px-3 py-1.5 rounded text-xs font-medium transition-all
                ${
                  tradingMode === mode.value
                    ? `${mode.color} text-white shadow-sm`
                    : 'text-gray-700 hover:bg-gray-100'
                }
              `}
            >
              <span>{mode.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center space-x-2">
        <Select value={tradingType} onValueChange={handleTypeChange}>
          <SelectTrigger className="h-8 w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="spot">Spot</SelectItem>
            <SelectItem value="futures">Futures</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
