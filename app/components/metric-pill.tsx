import { HeroMetric } from '@/data/dashboard'

interface MetricPillProps {
  metric: HeroMetric
}

export function MetricPill({ metric }: MetricPillProps) {
  return (
    <div className="flex flex-col border border-white/10 px-4 py-3 rounded-none">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{metric.label}</p>
      <p className="text-2xl font-semibold">{metric.value}</p>
      <p className="text-xs text-secondary">{metric.helper}</p>
    </div>
  )
}


