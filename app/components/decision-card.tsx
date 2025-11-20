import { AiDecision } from '@/data/dashboard'

interface DecisionCardProps {
  decision: AiDecision
}

export function DecisionCard({ decision }: DecisionCardProps) {
  return (
    <article className="border border-white/10 p-4 space-y-3">
      <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{decision.timestamp}</p>
      <h3 className="text-lg font-semibold">{decision.action}</h3>
      <p className="text-sm text-secondary">{decision.marketBias}</p>
      <p className="text-sm text-muted-foreground">{decision.narrative}</p>
      <div className="text-xs text-emerald-300">{decision.conviction}</div>
      <p className="text-xs text-amber-300">{decision.guardrail}</p>
    </article>
  )
}


