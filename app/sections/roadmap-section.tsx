import { RoadmapMilestone } from '@/data/dashboard'
import { SectionCard } from '@/components/section-card'
import { RoadmapItem } from '@/components/roadmap-item'

interface RoadmapSectionProps {
  milestones: RoadmapMilestone[]
}

export function RoadmapSection({ milestones }: RoadmapSectionProps) {
  return (
    <SectionCard
      title="Shipping roadmap"
      description="Timelines mirror production OKRs. Replace copy as soon as product planning locks."
      accent="Transparent delivery"
    >
      <div className="grid gap-4">
        {milestones.map((milestone) => (
          <RoadmapItem key={milestone.label} milestone={milestone} />
        ))}
      </div>
    </SectionCard>
  )
}


