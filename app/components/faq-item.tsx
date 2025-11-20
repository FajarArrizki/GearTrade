import { useState } from 'react'
import { FaqEntry } from '@/data/dashboard'

interface FaqItemProps {
  entry: FaqEntry
}

export function FaqItem({ entry }: FaqItemProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <article className="border border-white/10">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        onClick={() => setIsOpen((state) => !state)}
      >
        <span className="font-medium">{entry.question}</span>
        <span className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {isOpen ? 'close' : 'open'}
        </span>
      </button>
      {isOpen && <p className="px-4 pb-4 text-sm text-muted-foreground">{entry.answer}</p>}
    </article>
  )
}


