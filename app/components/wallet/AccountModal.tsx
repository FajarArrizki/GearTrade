'use client'

import React from 'react'
import { useAccount, useBalance, useDisconnect } from 'wagmi'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Copy, ExternalLink, LogOut } from 'lucide-react'
import { formatAddress } from '@/lib/utils'
import { toast } from 'react-hot-toast'

interface AccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AccountModal({ open, onOpenChange }: AccountModalProps) {
  const { address, chain, isConnected } = useAccount()
  const { data: balance } = useBalance({
    address,
  })
  const { disconnect } = useDisconnect()

  const handleCopyAddress = async () => {
    if (address) {
      await navigator.clipboard.writeText(address)
      toast.success('Address copied to clipboard')
    }
  }

  const handleViewOnExplorer = () => {
    if (!address || !chain) return
    
    const explorerUrls: Record<number, string> = {
      1: 'https://etherscan.io',
      11155111: 'https://sepolia.etherscan.io',
      42161: 'https://arbiscan.io',
      421614: 'https://sepolia.arbiscan.io',
      8453: 'https://basescan.org',
      84532: 'https://sepolia.basescan.org',
    }
    
    const baseUrl = explorerUrls[chain.id] || 'https://etherscan.io'
    window.open(`${baseUrl}/address/${address}`, '_blank')
  }

  const handleDisconnect = () => {
    disconnect()
    onOpenChange(false)
    toast.success('Wallet disconnected')
  }

  if (!isConnected || !address) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Account Details</DialogTitle>
          <DialogDescription>
            View and manage your wallet account information
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Account Info Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                    {address.slice(2, 4).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base">Connected Wallet</CardTitle>
                  <CardDescription className="font-mono text-xs break-all">
                    {formatAddress(address)}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Balance */}
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">
                  Balance
                </div>
                <div className="text-lg font-semibold">
                  {balance?.formatted || '0.00'} {balance?.symbol || 'ETH'}
                </div>
              </div>

              {/* Network */}
              {chain && (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">
                    Network
                  </div>
                  <div className="text-sm font-medium">
                    {chain.name}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyAddress}
                  className="w-full justify-start"
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Address
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleViewOnExplorer}
                  className="w-full justify-start"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View on Explorer
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDisconnect}
                  className="w-full justify-start"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Disconnect
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
}



