import { StatTile } from '@/data/dashboard'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

interface StatTileProps {
  tile: StatTile
}

export function StatTileCard({ tile }: StatTileProps) {
  const TrendIcon = tile.trend === 'up' ? ArrowUpRight : ArrowDownRight

  return (
    <div className="flex flex-col justify-between border border-white/10 p-4 space-y-3">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{tile.title}</p>
        <p className="text-3xl font-semibold mt-2">{tile.primary}</p>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <TrendIcon
          className={`h-4 w-4 ${tile.trend === 'up' ? 'text-emerald-400' : 'text-rose-400'}`}
        />
        <span>{tile.deltaLabel}</span>
        <span className={tile.trend === 'up' ? 'text-emerald-400' : 'text-rose-400'}>{tile.deltaValue}</span>
      </div>
      <p className="text-xs text-muted-foreground">{tile.caption}</p>
    </div>
  )
}


