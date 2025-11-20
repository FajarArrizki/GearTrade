import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { arbitrum, arbitrumSepolia, base, baseSepolia, mainnet, sepolia } from 'viem/chains'

export const config = getDefaultConfig({
  appName: 'GearTrade',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'YOUR_PROJECT_ID',
  chains: [
    arbitrum,
    arbitrumSepolia,
    base,
    baseSepolia,
    mainnet,
    sepolia,
  ],
  ssr: false,
})

