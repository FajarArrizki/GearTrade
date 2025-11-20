import React from 'react'
import { User, LogOut, UserCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import TradingModeSwitcher from '@/components/trading/TradingModeSwitcher'
import { useAuth } from '@/contexts/AuthContext'
import { getSignInUrl } from '@/lib/auth'
import CustomConnectButton from '@/components/wallet/ConnectButton'

interface Account {
  id: number
  user_id: number
  name: string
  account_type: string
  initial_capital: number
  current_cash: number
  frozen_cash: number
}

interface HeaderProps {
  title?: string
  currentAccount?: Account | null
  showAccountSelector?: boolean
  currentPage?: string
  onPageChange?: (page: string) => void
}

export default function Header({ title = 'GearTrade', currentAccount, showAccountSelector = false, currentPage = 'comprehensive', onPageChange }: HeaderProps) {
  const { user, loading, authEnabled, logout } = useAuth()

  const handleSignUp = async () => {
    const signInUrl = await getSignInUrl()
    if (signInUrl) {
      window.location.href = signInUrl
    }
  }

  const navItems = [
    { id: 'comprehensive', label: 'GearTrade', title: 'GearTrade' },
    { id: 'leaderboard', label: 'Leaderboard', title: 'Leaderboard' },
    { id: 'prompt-management', label: 'Prompts', title: 'Prompt Templates' },
    { id: 'trader-management', label: 'Settings', title: 'AI Trader Management' },
  ]

  return (
        <header className="fixed top-0 left-0 right-0 z-50 w-full border-b bg-background/50 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="w-full py-4 px-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src="/logo_app.png" alt="Logo" className="h-8 w-8 object-contain" onError={(e) => {
            console.error('Logo failed to load:', e.currentTarget.src)
            e.currentTarget.style.display = 'none'
          }} />
          <h1 className="text-xl font-bold">{title}</h1>
          
          {/* Navigation items next to logo */}
          <div className="flex items-center gap-1 ml-2 overflow-x-auto">
            {navItems.map((item) => {
              const isActive = currentPage === item.id
              return (
                <button
                  key={item.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-secondary text-secondary-foreground font-medium'
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                  onClick={() => onPageChange?.(item.id)}
                  title={item.title}
                >
                  <span className="text-sm">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-3">

          <TradingModeSwitcher />

          {/* Always show wallet connect button */}
          <CustomConnectButton />

          {/* Optional: Show auth dropdown if enabled and user is logged in via OAuth */}
          {authEnabled && user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={user.avatar} alt={user.displayName || user.name} />
                    <AvatarFallback className="text-xs">
                      {user.displayName?.[0] || user.name?.[0] || "U"}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {user.displayName || user.name}
                    </p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => window.open('https://account.akooi.com/account', '_blank')}>
                  <UserCog className="mr-2 h-4 w-4" />
                  <span>My Account</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign Out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
    </header>
  )
}
