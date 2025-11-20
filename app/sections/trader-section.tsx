import { TraderProfile } from '@/data/dashboard'
import { SectionCard } from '@/components/section-card'
import { TraderCard } from '@/components/trader-card'

interface TraderSectionProps {
  traders: TraderProfile[]
}

export function TraderSection({ traders }: TraderSectionProps) {
  return (
    <SectionCard
      title="AI Trader roster"
      description="Each profile ships with placeholder copy, ready for bespoke art direction."
      accent="Simulated Vaults"
    >
      <div className="grid gap-4 md:grid-cols-3">
        {traders.map((profile) => (
          <TraderCard key={profile.name} profile={profile} />
        ))}
      </div>
    </SectionCard>
  )
}


