import React, { useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import FlipNumber from '@/components/portfolio/FlipNumber'
import { Search, Copy } from 'lucide-react'
import { toast } from 'react-hot-toast'

export interface LeaderboardEntry {
  rank: number
  trader: string
  wallet_address: string
  account_value: number
  pnl_24h: number
  pnl_7d: number
  pnl_30d: number
  pnl_alltime: number
  roi_24h: number
  roi_7d: number
  roi_30d: number
  roi_alltime: number
  volume_24h: number
  volume_7d: number
  volume_30d: number
  volume_alltime: number
}

type TimeFilter = '24H' | '07D' | '30D' | 'Alltime'

const DUMMY_LEADERBOARD: LeaderboardEntry[] = [
  {
    rank: 1,
    trader: 'GPT Trader',
    wallet_address: '0x1234567890123456789012345678901234567890',
    account_value: 125000,
    pnl_24h: 2500,
    pnl_7d: 15000,
    pnl_30d: 45000,
    pnl_alltime: 125000,
    roi_24h: 2.04,
    roi_7d: 13.64,
    roi_30d: 56.25,
    roi_alltime: 100.0,
    volume_24h: 50000,
    volume_7d: 350000,
    volume_30d: 1200000,
    volume_alltime: 5000000,
  },
  {
    rank: 2,
    trader: 'Claude Trader',
    wallet_address: '0x2345678901234567890123456789012345678901',
    account_value: 98000,
    pnl_24h: 1800,
    pnl_7d: 12000,
    pnl_30d: 38000,
    pnl_alltime: 98000,
    roi_24h: 1.87,
    roi_7d: 13.95,
    roi_30d: 63.33,
    roi_alltime: 98.0,
    volume_24h: 45000,
    volume_7d: 320000,
    volume_30d: 1100000,
    volume_alltime: 4800000,
  },
  {
    rank: 3,
    trader: 'Alpha Bot',
    wallet_address: '0x3456789012345678901234567890123456789012',
    account_value: 87500,
    pnl_24h: 1500,
    pnl_7d: 10000,
    pnl_30d: 32500,
    pnl_alltime: 87500,
    roi_24h: 1.74,
    roi_7d: 12.90,
    roi_30d: 59.09,
    roi_alltime: 87.5,
    volume_24h: 40000,
    volume_7d: 280000,
    volume_30d: 950000,
    volume_alltime: 4200000,
  },
  {
    rank: 4,
    trader: 'Crypto Master',
    wallet_address: '0x4567890123456789012345678901234567890123',
    account_value: 72000,
    pnl_24h: 1200,
    pnl_7d: 8500,
    pnl_30d: 27000,
    pnl_alltime: 72000,
    roi_24h: 1.69,
    roi_7d: 13.38,
    roi_30d: 60.0,
    roi_alltime: 72.0,
    volume_24h: 35000,
    volume_7d: 250000,
    volume_30d: 850000,
    volume_alltime: 3800000,
  },
  {
    rank: 5,
    trader: 'Trading Pro',
    wallet_address: '0x5678901234567890123456789012345678901234',
    account_value: 65000,
    pnl_24h: 1000,
    pnl_7d: 7000,
    pnl_30d: 22500,
    pnl_alltime: 65000,
    roi_24h: 1.56,
    roi_7d: 12.07,
    roi_30d: 52.94,
    roi_alltime: 65.0,
    volume_24h: 30000,
    volume_7d: 220000,
    volume_30d: 750000,
    volume_alltime: 3500000,
  },
  {
    rank: 6,
    trader: 'DeFi Wizard',
    wallet_address: '0x6789012345678901234567890123456789012345',
    account_value: 58000,
    pnl_24h: 800,
    pnl_7d: 6000,
    pnl_30d: 18000,
    pnl_alltime: 58000,
    roi_24h: 1.40,
    roi_7d: 11.54,
    roi_30d: 45.0,
    roi_alltime: 58.0,
    volume_24h: 28000,
    volume_7d: 200000,
    volume_30d: 680000,
    volume_alltime: 3200000,
  },
  {
    rank: 7,
    trader: 'Smart Trader',
    wallet_address: '0x7890123456789012345678901234567890123456',
    account_value: 52000,
    pnl_24h: 600,
    pnl_7d: 5000,
    pnl_30d: 15000,
    pnl_alltime: 52000,
    roi_24h: 1.17,
    roi_7d: 10.64,
    roi_30d: 40.54,
    roi_alltime: 52.0,
    volume_24h: 25000,
    volume_7d: 180000,
    volume_30d: 600000,
    volume_alltime: 2800000,
  },
  {
    rank: 8,
    trader: 'Market Maker',
    wallet_address: '0x8901234567890123456789012345678901234567',
    account_value: 48000,
    pnl_24h: 500,
    pnl_7d: 4500,
    pnl_30d: 13500,
    pnl_alltime: 48000,
    roi_24h: 1.05,
    roi_7d: 10.34,
    roi_30d: 39.13,
    roi_alltime: 48.0,
    volume_24h: 22000,
    volume_7d: 160000,
    volume_30d: 550000,
    volume_alltime: 2500000,
  },
  {
    rank: 9,
    trader: 'Yield Hunter',
    wallet_address: '0x9012345678901234567890123456789012345678',
    account_value: 45000,
    pnl_24h: 400,
    pnl_7d: 4000,
    pnl_30d: 12000,
    pnl_alltime: 45000,
    roi_24h: 0.90,
    roi_7d: 9.76,
    roi_30d: 36.36,
    roi_alltime: 45.0,
    volume_24h: 20000,
    volume_7d: 150000,
    volume_30d: 500000,
    volume_alltime: 2200000,
  },
  {
    rank: 10,
    trader: 'Risk Manager',
    wallet_address: '0x0123456789012345678901234567890123456789',
    account_value: 42000,
    pnl_24h: 300,
    pnl_7d: 3500,
    pnl_30d: 10500,
    pnl_alltime: 42000,
    roi_24h: 0.72,
    roi_7d: 9.09,
    roi_30d: 33.33,
    roi_alltime: 42.0,
    volume_24h: 18000,
    volume_7d: 140000,
    volume_30d: 480000,
    volume_alltime: 2000000,
  },
  {
    rank: 11,
    trader: 'Whale Trader',
    wallet_address: '0xabcdef1234567890abcdef1234567890abcdef12',
    account_value: 38000,
    pnl_24h: 250,
    pnl_7d: 3000,
    pnl_30d: 9000,
    pnl_alltime: 38000,
    roi_24h: 0.66,
    roi_7d: 8.57,
    roi_30d: 31.03,
    roi_alltime: 38.0,
    volume_24h: 15000,
    volume_7d: 120000,
    volume_30d: 420000,
    volume_alltime: 1800000,
  },
  {
    rank: 12,
    trader: 'Crypto Ninja',
    wallet_address: '0xfedcba0987654321fedcba0987654321fedcba09',
    account_value: 35000,
    pnl_24h: 200,
    pnl_7d: 2500,
    pnl_30d: 7500,
    pnl_alltime: 35000,
    roi_24h: 0.57,
    roi_7d: 7.69,
    roi_30d: 27.27,
    roi_alltime: 35.0,
    volume_24h: 12000,
    volume_7d: 100000,
    volume_30d: 380000,
    volume_alltime: 1600000,
  },
  {
    rank: 13,
    trader: 'Diamond Hands',
    wallet_address: '0x9876543210fedcba9876543210fedcba98765432',
    account_value: 32000,
    pnl_24h: 150,
    pnl_7d: 2000,
    pnl_30d: 6000,
    pnl_alltime: 32000,
    roi_24h: 0.47,
    roi_7d: 6.67,
    roi_30d: 23.08,
    roi_alltime: 32.0,
    volume_24h: 10000,
    volume_7d: 80000,
    volume_30d: 320000,
    volume_alltime: 1400000,
  },
  {
    rank: 14,
    trader: 'Moon Shooter',
    wallet_address: '0x1111222233334444555566667777888899990000',
    account_value: 30000,
    pnl_24h: 100,
    pnl_7d: 1500,
    pnl_30d: 4500,
    pnl_alltime: 30000,
    roi_24h: 0.33,
    roi_7d: 5.26,
    roi_30d: 17.65,
    roi_alltime: 30.0,
    volume_24h: 8000,
    volume_7d: 60000,
    volume_30d: 280000,
    volume_alltime: 1200000,
  },
  {
    rank: 15,
    trader: 'HODL Master',
    wallet_address: '0x2222333344445555666677778888999900001111',
    account_value: 28000,
    pnl_24h: 50,
    pnl_7d: 1000,
    pnl_30d: 3000,
    pnl_alltime: 28000,
    roi_24h: 0.18,
    roi_7d: 3.70,
    roi_30d: 12.00,
    roi_alltime: 28.0,
    volume_24h: 6000,
    volume_7d: 50000,
    volume_30d: 250000,
    volume_alltime: 1000000,
  },
]

export default function Leaderboard() {
  const [searchQuery, setSearchQuery] = useState('')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('Alltime')

  const filteredData = useMemo(() => {
    let filtered = DUMMY_LEADERBOARD

    // Filter by wallet address search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      filtered = filtered.filter(
        (entry) =>
          entry.wallet_address.toLowerCase().includes(query) ||
          entry.trader.toLowerCase().includes(query)
      )
    }

    return filtered
  }, [searchQuery])

  const getPnl = (entry: LeaderboardEntry) => {
    switch (timeFilter) {
      case '24H':
        return entry.pnl_24h
      case '07D':
        return entry.pnl_7d
      case '30D':
        return entry.pnl_30d
      case 'Alltime':
        return entry.pnl_alltime
    }
  }

  const getRoi = (entry: LeaderboardEntry) => {
    switch (timeFilter) {
      case '24H':
        return entry.roi_24h
      case '07D':
        return entry.roi_7d
      case '30D':
        return entry.roi_30d
      case 'Alltime':
        return entry.roi_alltime
    }
  }

  const getVolume = (entry: LeaderboardEntry) => {
    switch (timeFilter) {
      case '24H':
        return entry.volume_24h
      case '07D':
        return entry.volume_7d
      case '30D':
        return entry.volume_30d
      case 'Alltime':
        return entry.volume_alltime
    }
  }

  const handleCopyAddress = async (address: string) => {
    try {
      await navigator.clipboard.writeText(address)
      toast.success('Wallet address copied to clipboard')
    } catch (err) {
      console.error('Failed to copy address:', err)
      toast.error('Failed to copy address')
    }
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 p-4 space-y-4 border-b border-border">
        {/* Search and Filter Section */}
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by wallet address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Select value={timeFilter} onValueChange={(value) => setTimeFilter(value as TimeFilter)}>
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24H">24H</SelectItem>
              <SelectItem value="07D">07D</SelectItem>
              <SelectItem value="30D">30D</SelectItem>
              <SelectItem value="Alltime">Alltime</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table Section */}
      <div className="flex-1 overflow-y-auto p-4">
        <Card className="border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="min-w-[1000px] divide-y divide-border w-full">
              <thead className="bg-muted/50">
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 text-left">Rank</th>
                  <th className="px-4 py-3 text-left">Trader</th>
                  <th className="px-4 py-3 text-left">Account Value</th>
                  <th className="px-4 py-3 text-left">PNL ({timeFilter})</th>
                  <th className="px-4 py-3 text-left">ROI ({timeFilter})</th>
                  <th className="px-4 py-3 text-left">Volume ({timeFilter})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-xs text-muted-foreground">
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No traders found
                    </td>
                  </tr>
                ) : (
                  filteredData.map((entry) => {
                    const pnl = getPnl(entry)
                    const roi = getRoi(entry)
                    const volume = getVolume(entry)
                    return (
                      <tr key={entry.rank} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="font-semibold text-foreground">#{entry.rank}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <span className="font-semibold text-foreground">{entry.trader}</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {entry.wallet_address.slice(0, 8)}...{entry.wallet_address.slice(-6)}
                              </span>
                              <button
                                onClick={() => handleCopyAddress(entry.wallet_address)}
                                title="Copy wallet address"
                                className="h-3 w-3 p-0 hover:opacity-70 transition-opacity flex items-center justify-center"
                              >
                                <Copy className="h-3 w-3 text-muted-foreground" />
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground">
                            <FlipNumber value={entry.account_value} prefix="$" decimals={2} />
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-semibold ${
                              pnl >= 0 ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            <FlipNumber value={pnl} prefix="$" decimals={2} />
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-semibold ${
                              roi >= 0 ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {roi >= 0 ? '+' : ''}
                            {roi.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-foreground">
                            <FlipNumber value={volume} prefix="$" decimals={2} />
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}

