import { BarChart3, NotebookPen, Settings } from 'lucide-react'

interface NavbarProps {
  currentPage?: string
  onPageChange?: (page: string) => void
  onAccountUpdated?: () => void
}

export default function Navbar({ currentPage = 'comprehensive', onPageChange }: NavbarProps) {
  const navItems = [
    { id: 'comprehensive', icon: BarChart3, label: 'Trade', title: 'Trade' },
    { id: 'prompt-management', icon: NotebookPen, label: 'Prompts', title: 'Prompt Templates' },
    { id: 'trader-management', icon: Settings, label: 'Settings', title: 'AI Trader Management' },
  ]

  return (
    <nav className="w-full border-b bg-background/50 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center gap-1 px-4 py-2 overflow-x-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          const isActive = currentPage === item.id
          return (
            <button
              key={item.id}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-secondary text-secondary-foreground font-medium'
                  : 'hover:bg-muted text-muted-foreground'
              }`}
              onClick={() => onPageChange?.(item.id)}
              title={item.title}
            >
              <Icon className="w-4 h-4" />
              <span className="text-sm">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
