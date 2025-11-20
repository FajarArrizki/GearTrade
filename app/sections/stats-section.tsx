import { StatTile } from '@/data/dashboard'
import { SectionCard } from '@/components/section-card'
import { StatTileCard } from '@/components/stat-tile'

interface StatsSectionProps {
  stats: StatTile[]
  timeframe: string
}

export function StatsSection({ stats, timeframe }: StatsSectionProps) {
  return (
    <SectionCard
      title="Desk telemetry"
      description="All values are synthetic but shaped exactly like their live counterparts."
      accent={`Updated · ${timeframe}`}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((tile) => (
          <StatTileCard key={tile.title} tile={tile} />
        ))}
      </div>
    </SectionCard>
  )
}


