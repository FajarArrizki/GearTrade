'use client'

import React, { useEffect, useState } from 'react'
import { useConnect, useAccount } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Wallet } from 'lucide-react'
import { toast } from 'react-hot-toast'

interface ConnectModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Wallet metadata with icon URLs
const walletIconUrls: Record<string, string> = {
  metamask: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/metamask.svg',
  walletconnect: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/walletconnect.svg',
  coinbase: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/coinbase.svg',
  coinbasewalletsdk: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/coinbase.svg',
  rainbow: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/rainbow.svg',
  safe: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/safe.svg',
  zerion: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/zerion.svg',
  imtoken: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/imtoken.svg',
  trust: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/trust.svg',
  frame: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/frame.svg',
  backpack: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/backpack.svg',
  base: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/base.svg',
  okx: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/okx.svg',
  okex: 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/okx.svg',
}

const walletMetadata: Record<string, { name: string; description?: string }> = {
  metamask: { name: 'MetaMask', description: 'Connect using MetaMask browser extension' },
  walletconnect: { name: 'WalletConnect', description: 'Connect using WalletConnect' },
  coinbase: { name: 'Coinbase Wallet', description: 'Connect using Coinbase Wallet' },
  coinbasewalletsdk: { name: 'Coinbase Wallet', description: 'Connect using Coinbase Wallet' },
  rainbow: { name: 'Rainbow', description: 'Connect using Rainbow Wallet' },
  injected: { name: 'Injected', description: 'Connect using browser extension' },
  safe: { name: 'Safe', description: 'Connect using Safe Wallet' },
  zerion: { name: 'Zerion', description: 'Connect using Zerion Wallet' },
  imtoken: { name: 'imToken', description: 'Connect using imToken' },
  trust: { name: 'Trust Wallet', description: 'Connect using Trust Wallet' },
  frame: { name: 'Frame', description: 'Connect using Frame' },
  backpack: { name: 'Backpack', description: 'Connect using Backpack Wallet' },
  base: { name: 'Base Account', description: 'Connect using Base Account' },
  okx: { name: 'OKX Wallet', description: 'Connect using OKX Wallet' },
  okex: { name: 'OKX Wallet', description: 'Connect using OKX Wallet' },
}

export default function ConnectModal({ open, onOpenChange }: ConnectModalProps) {
  const { connect, connectors, isPending, error } = useConnect()
  const { isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const [installedWallets, setInstalledWallets] = useState<string[]>([])
  const [recentWallets, setRecentWallets] = useState<string[]>([])
  const [connectingConnectorId, setConnectingConnectorId] = useState<string | null>(null)

  // Use connectors from useConnect hook (wagmi v2)
  const allConnectors = connectors || []

  // Close modal when wallet is successfully connected
  useEffect(() => {
    if (isConnected && open) {
      setConnectingConnectorId(null)
      // Small delay to show success state
      const timer = setTimeout(() => {
        onOpenChange(false)
        toast.success('Wallet connected successfully')
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [isConnected, open, onOpenChange])

  // Reset loading when connection is rejected/cancelled
  useEffect(() => {
    if (error && connectingConnectorId) {
      // Check if error is user rejection
      const errorMessage = error.message?.toLowerCase() || ''
      if (errorMessage.includes('reject') || errorMessage.includes('cancel') || errorMessage.includes('user')) {
        setConnectingConnectorId(null)
      }
    }
  }, [error, connectingConnectorId])

  // Reset loading when modal closes
  useEffect(() => {
    if (!open) {
      setConnectingConnectorId(null)
    }
  }, [open])

  // Detect installed wallets
  useEffect(() => {
    if (typeof window === 'undefined') return

    const detected: string[] = []

    // Check for MetaMask
    if (window.ethereum?.isMetaMask) {
      detected.push('metamask')
    }

    // Check for Coinbase Wallet
    if (window.ethereum?.isCoinbaseWallet || (window.ethereum as any)?.isCoinbase) {
      detected.push('coinbase')
    }

    // Check for OKX Wallet
    if ((window.ethereum as any)?.isOKExWallet || (window.ethereum as any)?.isOKX) {
      detected.push('okx')
    }

    // Check for Rainbow
    if (window.ethereum?.isRainbow) {
      detected.push('rainbow')
    }

    // Check for Backpack
    if (window.ethereum?.isBackpack) {
      detected.push('backpack')
    }

    // Check for Trust Wallet
    if (window.ethereum?.isTrust) {
      detected.push('trust')
    }

    // Check for Zerion
    if (window.ethereum?.isZerion) {
      detected.push('zerion')
    }

    // Check for Frame
    if (window.ethereum?.isFrame) {
      detected.push('frame')
    }

    setInstalledWallets(detected)

    // Load recent wallets from localStorage
    const recent = localStorage.getItem('recentWallets')
    if (recent) {
      try {
        setRecentWallets(JSON.parse(recent))
      } catch {
        // Ignore parse errors
      }
    }
  }, [])

  const handleConnect = async (connector: any) => {
    const connectorId = getConnectorId(connector)
    setConnectingConnectorId(connectorId)
    
    try {
      // Initiate connection - modal will stay open to show confirmation dialog
      await connect({ connector })
      
      // Save to recent wallets
      const walletId = connector.id || connector.name?.toLowerCase() || connector.uid
      if (walletId) {
        const recent = [...new Set([walletId, ...recentWallets])].slice(0, 3)
        setRecentWallets(recent)
        localStorage.setItem('recentWallets', JSON.stringify(recent))
      }
      
      // Modal will stay open until wallet is confirmed connected (handled by useEffect)
      // User will see the wallet confirmation dialog
    } catch (err: any) {
      console.error('Connection error:', err)
      const errorMessage = err?.message?.toLowerCase() || ''
      
      // Reset loading immediately on any error
      setConnectingConnectorId(null)
      
      // Only show error toast if it's not a user rejection
      if (!errorMessage.includes('reject') && !errorMessage.includes('cancel') && !errorMessage.includes('user')) {
        toast.error(err?.message || 'Failed to connect wallet')
      }
      // Keep modal open so user can try again
    }
  }

  // Get unique connector identifier - use wallet name for deduplication
  const getConnectorId = (connector: any) => {
    // Use uid first, then id, then create from type and name
    return connector.uid || connector.id || `${connector.type}-${connector.name}` || String(connector)
  }

  // Get normalized wallet name for deduplication
  const getNormalizedWalletName = (connector: any) => {
    const id = (connector.id || connector.name || connector.uid || '').toLowerCase()
    
    // Special handling: distinguish Coinbase Wallet from Base Account
    if (id.includes('base') && !id.includes('coinbase') && !id.includes('cbwallet')) {
      return 'base account'
    }
    
    // Check for Coinbase Wallet specifically (not Base Account)
    if ((id.includes('coinbase') || id.includes('cbwallet')) && !id.includes('baseaccount')) {
      return 'coinbase wallet'
    }
    
    const metadata = Object.entries(walletMetadata).find(([key]) => {
      // Skip 'base' match if it's actually coinbase
      if (key === 'base' && (id.includes('coinbase') || id.includes('cbwallet'))) {
        return false
      }
      return id.includes(key)
    })
    return metadata ? metadata[1].name.toLowerCase() : (connector.name || connector.id || '').toLowerCase()
  }

  // Remove duplicates by wallet name - each wallet should only appear once
  const walletNameMap = new Map<string, any>()
  const seenWalletNames = new Set<string>()
  
  allConnectors.forEach((connector: any) => {
    const walletName = getNormalizedWalletName(connector)
    // Only keep first occurrence of each wallet name
    if (!seenWalletNames.has(walletName)) {
      walletNameMap.set(walletName, connector)
      seenWalletNames.add(walletName)
    }
  })

  // Get unique connectors by wallet name
  const uniqueConnectorsByWalletName = Array.from(walletNameMap.values())
  
  // Additional deduplication by connector ID (in case same wallet has multiple connector instances)
  const uniqueConnectorsFinal = Array.from(
    new Map(uniqueConnectorsByWalletName.map((connector: any) => {
      const walletName = getNormalizedWalletName(connector)
      // Use wallet name as key to ensure only one per wallet
      return [walletName, connector]
    })).values()
  )

  // Group connectors - ensure no duplicates across groups
  const seenIds = new Set<string>()
  const seenWalletNamesInGroups = new Set<string>()
  
  const installedConnectors = uniqueConnectorsFinal.filter((connector: any) => {
    const walletName = getNormalizedWalletName(connector)
    if (seenWalletNamesInGroups.has(walletName)) return false
    
    const connectorId = (connector.id || connector.name || connector.uid || '').toLowerCase()
    
    const isInstalled = installedWallets.some((w) => {
      const wLower = w.toLowerCase()
      // Check by wallet name match
      if (walletName.includes(wLower) || wLower === walletName) return true
      // Check by connector ID
      if (connectorId.includes(wLower)) return true
      // Special cases
      if (wLower === 'coinbase' && (connectorId.includes('coinbase') || connectorId.includes('cbwallet') || walletName.includes('coinbase'))) return true
      if (wLower === 'okx' && (connectorId.includes('okx') || connectorId.includes('okex') || walletName.includes('okx'))) return true
      return false
    }) || (connector.type === 'injected' && window.ethereum && !connectorId.includes('walletconnect') && walletName !== 'walletconnect')
    
    if (isInstalled) {
      seenWalletNamesInGroups.add(walletName)
      seenIds.add(getConnectorId(connector))
      return true
    }
    return false
  })

  const popularConnectors = uniqueConnectorsFinal.filter((connector: any) => {
    const walletName = getNormalizedWalletName(connector)
    if (seenWalletNamesInGroups.has(walletName)) return false
    
    const connectorId = (connector.id || connector.name || connector.uid || '').toLowerCase()
    // Exclude 'base' from popular if it's actually Base Account (not Coinbase)
    const isBaseAccount = connectorId.includes('base') && !connectorId.includes('coinbase') && !connectorId.includes('cbwallet')
    const popular = ['metamask', 'walletconnect', 'coinbase', 'rainbow', 'backpack', 'safe', 'okx', 'okex', ...(isBaseAccount ? ['base'] : [])]
    const isPopular = popular.some((p) => {
      // Special handling for base vs coinbase
      if (p === 'base' && (connectorId.includes('coinbase') || connectorId.includes('cbwallet'))) {
        return false
      }
      if (p === 'coinbase' && isBaseAccount) {
        return false
      }
      return connectorId.includes(p) || walletName.toLowerCase().includes(p)
    })
    
    if (isPopular) {
      seenWalletNamesInGroups.add(walletName)
      seenIds.add(getConnectorId(connector))
      return true
    }
    return false
  })

  const otherConnectors = uniqueConnectorsFinal.filter((connector: any) => {
    const walletName = getNormalizedWalletName(connector)
    return !seenWalletNamesInGroups.has(walletName)
  })

  const getWalletName = (connector: any) => {
    const id = (connector.id || connector.name || connector.uid || '').toLowerCase()
    
    // Special handling: distinguish Coinbase Wallet from Base Account
    if (id.includes('base') && !id.includes('coinbase') && !id.includes('cbwallet')) {
      // This is Base Account, not Coinbase Wallet
      return 'Base Account'
    }
    
    // Check for Coinbase Wallet specifically (not Base Account)
    if ((id.includes('coinbase') || id.includes('cbwallet')) && !id.includes('baseaccount')) {
      return 'Coinbase Wallet'
    }
    
    const metadata = Object.entries(walletMetadata).find(([key]) => {
      // Skip 'base' match if it's actually coinbase
      if (key === 'base' && (id.includes('coinbase') || id.includes('cbwallet'))) {
        return false
      }
      return id.includes(key)
    })
    return metadata ? metadata[1].name : connector.name || connector.id || 'Unknown Wallet'
  }

  const getWalletIcon = (connector: any) => {
    const id = (connector.id || connector.name || connector.uid || '').toLowerCase()
    
    // Priority 1: Use connector icon if available (from RainbowKit)
    if (connector.iconUrl) {
      return connector.iconUrl
    }
    
    // Priority 2: Use iconUrl from connector.icon if it exists
    if (connector.icon) {
      return connector.icon
    }
    
    // Priority 3: Special handling: distinguish Coinbase Wallet from Base Account
    if (id.includes('base') && !id.includes('coinbase') && !id.includes('cbwallet')) {
      return walletIconUrls.base || 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/base.svg'
    }
    
    // Priority 4: Check for Coinbase Wallet specifically
    if ((id.includes('coinbase') || id.includes('cbwallet')) && !id.includes('baseaccount')) {
      return walletIconUrls.coinbase || 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/coinbase.svg'
    }
    
    // Priority 5: Find matching icon from walletIconUrls
    const iconKey = Object.keys(walletIconUrls).find((key) => {
      // Skip 'base' match if it's actually coinbase
      if (key === 'base' && (id.includes('coinbase') || id.includes('cbwallet'))) {
        return false
      }
      return id.includes(key)
    })
    
    if (iconKey && walletIconUrls[iconKey]) {
      return walletIconUrls[iconKey]
    }
    
    // Fallback: Try to get from connector metadata or use generic wallet icon
    return 'https://raw.githubusercontent.com/walletconnect/walletconnect-assets/master/icon/walletconnect.svg'
  }

  const isRecent = (connector: any) => {
    const id = (connector.id || connector.name || connector.uid || '').toLowerCase()
    return recentWallets.some((w) => id.includes(w.toLowerCase()))
  }

  const WalletButton = ({ connector }: { connector: any }) => {
    const connectorId = getConnectorId(connector)
    const isConnecting = connectingConnectorId === connectorId
    const walletName = getWalletName(connector)
    const walletIcon = getWalletIcon(connector)
    const recent = isRecent(connector)
    const [iconError, setIconError] = useState(false)

    return (
      <Button
        variant="outline"
        className="w-full justify-start h-auto py-3 px-4"
        onClick={() => handleConnect(connector)}
        disabled={isConnecting || isPending}
      >
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
              {!iconError ? (
                <img 
                  src={walletIcon} 
                  alt={walletName}
                  className="h-6 w-6 object-contain rounded"
                  onError={() => setIconError(true)}
                />
              ) : (
                <Wallet className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col items-start min-w-0">
              <span className="text-sm font-medium truncate w-full">{walletName}</span>
              {recent && (
                <span className="text-xs text-primary">Recent</span>
              )}
            </div>
          </div>
          {isConnecting && <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />}
        </div>
      </Button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="space-y-4">
          <DialogHeader>
            <DialogTitle>Connect a Wallet</DialogTitle>
            <DialogDescription>
              Choose a wallet to connect to your account
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Installed Wallets */}
            {installedConnectors.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-primary uppercase tracking-wide">
                  Installed
                </div>
                <div className="space-y-2">
                  {installedConnectors.map((connector: any) => (
                    <WalletButton key={getConnectorId(connector)} connector={connector} />
                  ))}
                </div>
              </div>
            )}

            {/* Popular Wallets */}
            {popularConnectors.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Popular
                </div>
                <div className="space-y-2">
                  {popularConnectors.map((connector: any) => (
                    <WalletButton key={getConnectorId(connector)} connector={connector} />
                  ))}
                </div>
              </div>
            )}

            {/* Other Wallets */}
            {otherConnectors.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  More Options
                </div>
                <div className="space-y-2">
                  {otherConnectors.map((connector: any) => (
                    <WalletButton key={getConnectorId(connector)} connector={connector} />
                  ))}
                </div>
              </div>
            )}

            {uniqueConnectorsFinal.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8">
                No wallets available. Please install a wallet extension.
              </div>
            )}

            {/* Fallback: Use RainbowKit modal if no connectors detected */}
            {uniqueConnectorsFinal.length === 0 && (
              <Button
                variant="default"
                className="w-full"
                onClick={() => {
                  onOpenChange(false)
                  openConnectModal()
                }}
              >
                Open Wallet Options
              </Button>
            )}

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded">
                {error.message}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Extend Window interface for wallet detection
declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean
      isCoinbaseWallet?: boolean
      isCoinbase?: boolean
      isRainbow?: boolean
      isBackpack?: boolean
      isTrust?: boolean
      isZerion?: boolean
      isFrame?: boolean
      isOKExWallet?: boolean
      isOKX?: boolean
      request?: (args: { method: string; params?: any[] }) => Promise<any>
    }
  }
}

