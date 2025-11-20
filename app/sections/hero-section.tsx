import { HeroContent } from '@/data/dashboard'
import { BadgeStack } from '@/components/badge-stack'
import { MetricPill } from '@/components/metric-pill'
import { CtaButton } from '@/components/cta-button'

interface HeroSectionProps {
  content: HeroContent
}

export function HeroSection({ content }: HeroSectionProps) {
  return (
    <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] items-stretch">
      <div className="glass-panel p-8 space-y-8 accent-gradient">
        <p className="text-xs uppercase tracking-[0.4em] text-secondary">{content.eyebrow}</p>
        <div className="space-y-2">
          <h1 className="text-4xl md:text-5xl font-semibold leading-tight">{content.heading}</h1>
          <p className="text-muted-foreground text-lg max-w-2xl">{content.subheading}</p>
        </div>
        <BadgeStack badges={content.trustBadges} />
        <div className="grid gap-3 sm:grid-cols-3">
          {content.heroMetrics.map((metric) => (
            <MetricPill key={metric.label} metric={metric} />
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <CtaButton label={content.primaryCta.label} helper={content.primaryCta.helper} />
          <CtaButton label={content.secondaryCta.label} helper={content.secondaryCta.helper} variant="secondary" />
        </div>
      </div>
      <div className="glass-panel p-0 grid-outline relative overflow-hidden">
        <div className="absolute inset-0 accent-gradient opacity-60" />
        <div className="relative z-10 p-8 flex flex-col h-full justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Strategy Feed</p>
            <p className="text-lg text-muted-foreground">
              Pre-baked dummy entries keep layout filled while designers iterate.
            </p>
          </div>
          <div className="space-y-3">
            {content.heroMetrics.map((metric) => (
              <div key={metric.label} className="border border-white/10 p-3">
                <p className="text-sm text-muted-foreground">{metric.label}</p>
                <p className="text-2xl font-semibold">{metric.value}</p>
                <p className="text-xs text-secondary">{metric.helper}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Replace this pane with video, charting, or any Hyperliquid embed. Keeps aspect ratio on all breakpoints.
          </p>
        </div>
      </div>
    </section>
  )
}


