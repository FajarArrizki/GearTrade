import { AiDecision } from '@/data/dashboard'
import { SectionCard } from '@/components/section-card'
import { DecisionCard } from '@/components/decision-card'

interface AiSectionProps {
  decisions: AiDecision[]
}

export function AiSection({ decisions }: AiSectionProps) {
  return (
    <SectionCard
      title="LLM Reasoning Stream"
      description="Swap this feed with your realtime WebSocket events once the backend is live."
      accent="Prompt logs"
    >
      <div className="grid gap-4 md:grid-cols-3">
        {decisions.map((decision) => (
          <DecisionCard key={decision.timestamp} decision={decision} />
        ))}
      </div>
    </SectionCard>
  )
}


