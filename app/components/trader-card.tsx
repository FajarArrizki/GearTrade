import { TraderProfile } from '@/data/dashboard'

interface TraderCardProps {
  profile: TraderProfile
}

export function TraderCard({ profile }: TraderCardProps) {
  return (
    <article className="border border-white/15 p-4 space-y-3 h-full flex flex-col justify-between">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{profile.avatar}</span>
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">{profile.focus}</p>
          <h3 className="text-xl font-semibold">{profile.name}</h3>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">PnL</dt>
          <dd className="text-emerald-400 font-semibold">{profile.pnl}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Win rate</dt>
          <dd>{profile.winRate}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Leverage</dt>
          <dd>{profile.leverage}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Latency</dt>
          <dd>{profile.latency}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">{profile.highlight}</p>
    </article>
  )
}


