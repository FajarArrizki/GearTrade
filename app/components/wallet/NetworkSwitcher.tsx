'use client'

import React, { useState, useEffect } from 'react'
import { useAccount, useSwitchChain, useChains } from 'wagmi'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, Loader2, Network } from 'lucide-react'
import { toast } from 'react-hot-toast'

interface NetworkSwitcherProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Network display names
const networkNames: Record<number, string> = {
  1: 'Ethereum Mainnet',
  11155111: 'Sepolia Testnet',
  42161: 'Arbitrum One',
  421614: 'Arbitrum Sepolia',
  8453: 'Base',
  84532: 'Base Sepolia',
}

// Network icon URLs - using multiple sources for reliability
const networkIcons: Record<number, string[]> = {
  1: [
    'https://raw.githubusercontent.com/rainbow-me/rainbowkit/main/packages/rainbowkit/src/assets/chains/ethereum.svg',
    'https://raw.githubusercontent.com/ethereum/ethereum-org-website/master/src/assets/assets/eth-diamond-black.png',
    'https://cryptologos.cc/logos/ethereum-eth-logo.svg',
  ],
  11155111: [
    'https://raw.githubusercontent.com/rainbow-me/rainbowkit/main/packages/rainbowkit/src/assets/chains/ethereum.svg',
    'https://raw.githubusercontent.com/ethereum/ethereum-org-website/master/src/assets/assets/eth-diamond-black.png',
    'https://cryptologos.cc/logos/ethereum-eth-logo.svg',
  ],
  42161: [
    'https://raw.githubusercontent.com/rainbow-me/rainbowkit/main/packages/rainbowkit/src/assets/chains/arbitrum.svg',
    'https://raw.githubusercontent.com/OffchainLabs/arbitrum/master/packages/arb-ts/src/lib/images/arbitrum.svg',
    'https://cryptologos.cc/logos/arbitrum-arb-logo.svg',
  ],
  421614: [
    'https://raw.githubusercontent.com/rainbow-me/rainbowkit/main/packages/rainbowkit/src/assets/chains/arbitrum.svg',
    'https://raw.githubusercontent.com/OffchainLabs/arbitrum/master/packages/arb-ts/src/lib/images/arbitrum.svg',
    'https://cryptologos.cc/logos/arbitrum-arb-logo.svg',
  ],
  8453: [
    'https://raw.githubusercontent.com/rainbow-me/rainbowkit/main/packages/rainbowkit/src/assets/chains/base.svg',
    'https://raw.githubusercontent.com/base-org/brand-kit/main/logo/symbol/base-symbol.svg',
    'https://cryptologos.cc/logos/base-base-logo.svg',
  ],
  84532: [
    'https://raw.githubusercontent.com/rainbow-me/rainbowkit/main/packages/rainbowkit/src/assets/chains/base.svg',
    'https://raw.githubusercontent.com/base-org/brand-kit/main/logo/symbol/base-symbol.svg',
    'https://cryptologos.cc/logos/base-base-logo.svg',
  ],
}

// Network Card Component
interface NetworkCardProps {
  network: any
  isActive: boolean
  isSwitching: boolean
  onSwitch: (chainId: number) => void
}

function NetworkCard({ network, isActive, isSwitching, onSwitch }: NetworkCardProps) {
  const [iconError, setIconError] = useState(false)
  const [currentIconIndex, setCurrentIconIndex] = useState(0)
  
  // Priority 1: Use iconUrl from chain object if available (from RainbowKit/viem)
  // Priority 2: Use predefined networkIcons
  const chainIconUrl = (network as any)?.iconUrl || (network as any)?.icon
  const fallbackIcons = networkIcons[network.id] || [
    'https://raw.githubusercontent.com/rainbow-me/rainbowkit/main/packages/rainbowkit/src/assets/chains/ethereum.svg'
  ]
  
  // Combine chain icon with fallbacks
  const allIconSources = chainIconUrl 
    ? [chainIconUrl, ...fallbackIcons]
    : fallbackIcons
  
  const currentIcon = allIconSources[currentIconIndex] || allIconSources[0]

  const handleIconError = () => {
    // Try next fallback icon
    if (currentIconIndex < allIconSources.length - 1) {
      setCurrentIconIndex(currentIconIndex + 1)
    } else {
      setIconError(true)
    }
  }

  return (
    <Card
      className={`cursor-pointer transition-colors ${
        isActive
          ? 'border-primary bg-primary/5'
          : 'hover:bg-accent'
      }`}
      onClick={() => !isActive && onSwitch(network.id)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
              {!iconError ? (
                <img 
                  src={currentIcon} 
                  alt={networkNames[network.id] || network.name}
                  className="h-6 w-6 object-contain rounded-full"
                  onError={handleIconError}
                  loading="lazy"
                />
              ) : (
                <Network className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div>
              <CardTitle className="text-sm">
                {networkNames[network.id] || network.name}
              </CardTitle>
              <CardDescription className="text-xs">
                Chain ID: {network.id}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSwitching && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
            {isActive && (
              <Check className="h-4 w-4 text-primary" />
            )}
          </div>
        </div>
      </CardHeader>
    </Card>
  )
}

export default function NetworkSwitcher({ open, onOpenChange }: NetworkSwitcherProps) {
  const { chain } = useAccount()
  const chains = useChains()
  const { switchChain, isPending, error } = useSwitchChain()
  const [switchingChainId, setSwitchingChainId] = useState<number | null>(null)
  const [previousChainId, setPreviousChainId] = useState<number | undefined>(chain?.id)

  // Track chain changes to detect successful switch
  useEffect(() => {
    if (chain?.id && switchingChainId && chain.id === switchingChainId && chain.id !== previousChainId) {
      // Chain successfully switched
      toast.success(`Switched to ${networkNames[chain.id] || `Chain ${chain.id}`}`)
      setSwitchingChainId(null)
      setPreviousChainId(chain.id)
      // Small delay to show success state
      const timer = setTimeout(() => {
        onOpenChange(false)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [chain?.id, switchingChainId, previousChainId, onOpenChange])

  // Reset switching state when modal closes
  useEffect(() => {
    if (!open) {
      setSwitchingChainId(null)
      setPreviousChainId(chain?.id)
    }
  }, [open, chain?.id])

  // Reset switching state on error (user rejection)
  useEffect(() => {
    if (error && switchingChainId) {
      const errorMessage = error.message?.toLowerCase() || ''
      // Check if error is user rejection
      if (errorMessage.includes('reject') || errorMessage.includes('cancel') || errorMessage.includes('user')) {
        setSwitchingChainId(null)
        // Don't show error toast for user rejection
      } else {
        // Other errors - show error but keep modal open
        toast.error('Failed to switch network')
        setSwitchingChainId(null)
      }
    }
  }, [error, switchingChainId])

  const handleSwitchChain = async (chainId: number) => {
    // Don't switch if already switching or already on this chain
    if (isPending || chain?.id === chainId) return

    try {
      setSwitchingChainId(chainId)
      setPreviousChainId(chain?.id)
      // Initiate switch - wallet will show confirmation dialog
      // Modal will stay open until chain changes or user rejects
      await switchChain({ chainId })
      // Don't close modal here - wait for chain to actually change (handled by useEffect)
    } catch (err: any) {
      console.error('Failed to switch chain:', err)
      const errorMessage = err?.message?.toLowerCase() || ''
      
      // Reset switching state
      setSwitchingChainId(null)
      
      // Only show error if it's not a user rejection
      if (!errorMessage.includes('reject') && !errorMessage.includes('cancel') && !errorMessage.includes('user')) {
        toast.error('Failed to switch network')
      }
      // Keep modal open so user can try again
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    // Prevent closing modal while switching network (waiting for wallet confirmation)
    if (!newOpen && isPending && switchingChainId) {
      // User is trying to close while switching - allow it (they can cancel)
      // But reset the switching state
      setSwitchingChainId(null)
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Network</DialogTitle>
          <DialogDescription>
            Choose a network to connect to
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {chains.map((network) => {
            const isActive = chain?.id === network.id
            const isSwitching = switchingChainId === network.id && isPending

            return (
              <NetworkCard
                key={network.id}
                network={network}
                isActive={isActive}
                isSwitching={isSwitching}
                onSwitch={handleSwitchChain}
              />
            )
          })}
        </div>

        {switchingChainId && (
          <div className="text-sm text-muted-foreground mt-2 text-center">
            Please confirm the network switch in your wallet
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive mt-2">
            {error.message}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

