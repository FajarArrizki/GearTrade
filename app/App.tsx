import { HeroSection } from '@/sections/hero-section'
import { StatsSection } from '@/sections/stats-section'
import { TraderSection } from '@/sections/trader-section'
import { AiSection } from '@/sections/ai-section'
import { RoadmapSection } from '@/sections/roadmap-section'
import { FaqSection } from '@/sections/faq-section'
import { getDashboardData } from '@/data/dashboard'

export function App() {
  const { hero, stats, traders, decisions, roadmap, faqs, timeframe } = getDashboardData({ timeframe: '24h' })

  return (
    <div className="min-h-screen bg-background text-foreground accent-gradient">
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-10">
        <HeroSection content={hero} />
        <StatsSection stats={stats} timeframe={timeframe} />
        <TraderSection traders={traders} />
        <AiSection decisions={decisions} />
        <RoadmapSection milestones={roadmap} />
        <FaqSection faqs={faqs} />
        <footer className="text-center text-xs text-muted-foreground py-10">
          GearTrade · Static design environment · Replace at will
        </footer>
      </div>
    </div>
  )
}


