import { FaqEntry } from '@/data/dashboard'
import { SectionCard } from '@/components/section-card'
import { FaqItem } from '@/components/faq-item'

interface FaqSectionProps {
  faqs: FaqEntry[]
}

export function FaqSection({ faqs }: FaqSectionProps) {
  return (
    <SectionCard
      title="Design-ready FAQ"
      description="Every answer references the static nature of this build so onboarding is obvious."
      accent="Meta content"
    >
      <div className="space-y-3">
        {faqs.map((entry) => (
          <FaqItem key={entry.question} entry={entry} />
        ))}
      </div>
    </SectionCard>
  )
}


