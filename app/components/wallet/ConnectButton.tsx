'use client'

import React, { useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useDisconnect } from 'wagmi'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Copy, ExternalLink, LogOut, User, Network } from 'lucide-react'
import { formatAddress } from '@/lib/utils'
import AccountModal from './AccountModal'
import NetworkSwitcher from './NetworkSwitcher'
import ConnectModal from './ConnectModal'
import { toast } from 'react-hot-toast'

function CustomConnectButton() {
  const [accountModalOpen, setAccountModalOpen] = useState(false)
  const [networkModalOpen, setNetworkModalOpen] = useState(false)
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const { disconnect } = useDisconnect()

  const handleDisconnect = () => {
    disconnect()
    toast.success('Wallet disconnected')
  }

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== 'loading'
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus ||
            authenticationStatus === 'authenticated')

        const handleCopyAddress = async () => {
          if (account?.address) {
            await navigator.clipboard.writeText(account.address)
            toast.success('Address copied to clipboard')
          }
        }

        const handleViewOnExplorer = () => {
          if (!account?.address || !chain) return
          
          const explorerUrls: Record<number, string> = {
            1: 'https://etherscan.io',
            11155111: 'https://sepolia.etherscan.io',
            42161: 'https://arbiscan.io',
            421614: 'https://sepolia.arbiscan.io',
            8453: 'https://basescan.org',
            84532: 'https://sepolia.basescan.org',
          }
          
          const baseUrl = explorerUrls[chain.id] || 'https://etherscan.io'
          window.open(`${baseUrl}/address/${account.address}`, '_blank')
        }

        return (
          <>
            <div
              {...(!ready && {
                'aria-hidden': true,
                style: {
                  opacity: 0,
                  pointerEvents: 'none',
                  userSelect: 'none',
                },
              })}
            >
              {(() => {
                if (!connected) {
                  return (
                    <Button
                      onClick={() => setConnectModalOpen(true)}
                      size="sm"
                      className="px-4 py-2 text-sm font-medium"
                    >
                      Connect Wallet
                    </Button>
                  )
                }

                if (chain?.unsupported) {
                  return (
                    <Button
                      onClick={() => setNetworkModalOpen(true)}
                      size="sm"
                      variant="destructive"
                      className="px-4 py-2 text-sm font-medium"
                    >
                      Wrong network
                    </Button>
                  )
                }

                return (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="relative h-9 rounded-full px-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                              {account.displayName?.[0]?.toUpperCase() || account.address.slice(2, 4).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex flex-col items-start">
                            <span className="text-sm font-medium leading-none">
                              {account.displayName || formatAddress(account.address)}
                            </span>
                            {chain && (
                              <span className="text-[10px] text-muted-foreground leading-none">
                                {chain.name}
                              </span>
                            )}
                          </div>
                        </div>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56" align="end" forceMount>
                      <DropdownMenuLabel className="font-normal">
                        <div className="flex flex-col space-y-1">
                          <p className="text-sm font-medium leading-none">
                            {account.displayName || 'Wallet'}
                          </p>
                          <p className="text-xs leading-none text-muted-foreground font-mono">
                            {formatAddress(account.address)}
                          </p>
                        </div>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleCopyAddress}>
                        <Copy className="mr-2 h-4 w-4" />
                        <span>Copy Address</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleViewOnExplorer}>
                        <ExternalLink className="mr-2 h-4 w-4" />
                        <span>View on Explorer</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setAccountModalOpen(true)}>
                        <User className="mr-2 h-4 w-4" />
                        <span>Account Details</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setNetworkModalOpen(true)}>
                        <Network className="mr-2 h-4 w-4" />
                        <span>Switch Network</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleDisconnect}>
                        <LogOut className="mr-2 h-4 w-4" />
                        <span>Disconnect</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              })()}
            </div>

            {/* Custom Modals */}
            <ConnectModal open={connectModalOpen} onOpenChange={setConnectModalOpen} />
            <AccountModal open={accountModalOpen} onOpenChange={setAccountModalOpen} />
            <NetworkSwitcher open={networkModalOpen} onOpenChange={setNetworkModalOpen} />
          </>
        )
      }}
    </ConnectButton.Custom>
  )
}

export default CustomConnectButton

