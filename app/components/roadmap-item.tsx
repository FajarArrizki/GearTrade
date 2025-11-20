import { RoadmapMilestone } from '@/data/dashboard'

interface RoadmapItemProps {
  milestone: RoadmapMilestone
}

const statusStyles: Record<RoadmapMilestone['status'], string> = {
  done: 'text-emerald-400 border-emerald-400/40',
  wip: 'text-amber-300 border-amber-300/40',
  planned: 'text-sky-300 border-sky-300/40',
}

export function RoadmapItem({ milestone }: RoadmapItemProps) {
  return (
    <article className="border border-white/10 p-4 space-y-2">
      <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{milestone.quarter}</p>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{milestone.label}</h3>
        <span className={`text-xs px-2 py-1 border ${statusStyles[milestone.status]}`}>
          {milestone.status}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{milestone.details}</p>
    </article>
  )
}


