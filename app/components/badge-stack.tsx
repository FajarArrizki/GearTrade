interface BadgeStackProps {
  badges: string[]
}

export function BadgeStack({ badges }: BadgeStackProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((badge) => (
        <span
          key={badge}
          className="text-xs uppercase tracking-[0.2em] px-3 py-1 border border-white/15 bg-white/5"
        >
          {badge}
        </span>
      ))}
    </div>
  )
}


