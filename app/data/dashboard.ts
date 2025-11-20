export interface HeroContent {
  eyebrow: string
  heading: string
  subheading: string
  heroMetrics: Array<HeroMetric>
  primaryCta: CtaContent
  secondaryCta: CtaContent
  trustBadges: string[]
}

export interface HeroMetric {
  label: string
  value: string
  helper: string
}

export interface CtaContent {
  label: string
  helper: string
}

export interface StatTile {
  title: string
  primary: string
  deltaLabel: string
  deltaValue: string
  trend: 'up' | 'down'
  caption: string
}

export interface TraderProfile {
  name: string
  focus: string
  pnl: string
  winRate: string
  leverage: string
  latency: string
  avatar: string
  highlight: string
}

export interface AiDecision {
  timestamp: string
  marketBias: string
  conviction: string
  action: string
  narrative: string
  guardrail: string
}

export interface RoadmapMilestone {
  quarter: string
  label: string
  status: 'done' | 'wip' | 'planned'
  details: string
}

export interface FaqEntry {
  question: string
  answer: string
}

const heroContent: HeroContent = {
  eyebrow: 'Hyperliquid Native AI Execution',
  heading: 'GearTrade',
  subheading: 'Autonomous delta-neutral trading desk that blends LLM reasoning, risk-aware execution, and Hyperliquid perps liquidity.',
  heroMetrics: [
    { label: 'Managed Notional', value: '$48.3M', helper: '+12.4% WoW' },
    { label: 'Latency Budget', value: '42ms', helper: 'edge routing' },
    { label: 'Portfolio Uptime', value: '99.97%', helper: '6 regions' },
  ],
  primaryCta: { label: 'Launch Paper Desk', helper: 'no wallet needed' },
  secondaryCta: { label: 'View Strategy Tapes', helper: '16 curated flows' },
  trustBadges: ['DeepSeek Optimized', 'Hyperliquid Verified', 'LLM Guardrails v3'],
}

const statTiles: StatTile[] = [
  {
    title: 'AI Sharpe',
    primary: '3.42',
    deltaLabel: 'Stability',
    deltaValue: '+0.18',
    trend: 'up',
    caption: 'Measured across 180-day blended book.',
  },
  {
    title: 'Execution Quality',
    primary: '99.1%',
    deltaLabel: 'Slippage',
    deltaValue: '-0.08%',
    trend: 'up',
    caption: 'Versus Hyperliquid mark price.',
  },
  {
    title: 'Capital Efficiency',
    primary: '7.3x',
    deltaLabel: 'Utilization',
    deltaValue: '+1.4x',
    trend: 'up',
    caption: 'Average net leverage with circuit breakers.',
  },
  {
    title: 'Compliance Checks',
    primary: '312',
    deltaLabel: 'Daily',
    deltaValue: '100%',
    trend: 'up',
    caption: 'All guardrails satisfied in the last session.',
  },
]

const traderProfiles: TraderProfile[] = [
  {
    name: 'MARA-12',
    focus: 'ETH Macro Momentum',
    pnl: '+212.4%',
    winRate: '63%',
    leverage: '3.1x',
    latency: '38ms',
    avatar: '🛰️',
    highlight: 'Pairs DeepSeek tacticals with human-readable briefs every 30 minutes.',
  },
  {
    name: 'LYRA-7',
    focus: 'BTC Funding Harvest',
    pnl: '+128.7%',
    winRate: '57%',
    leverage: '2.4x',
    latency: '41ms',
    avatar: '🎯',
    highlight: 'Auto-hedges directional risk with options overlays and shared risk budget.',
  },
  {
    name: 'NOVA-3',
    focus: 'SOL Perp Rotation',
    pnl: '+308.9%',
    winRate: '68%',
    leverage: '4.6x',
    latency: '35ms',
    avatar: '⚡',
    highlight: 'Executes 5m breakout scaffolds with multi-chain liquidity mirroring.',
  },
]

const aiDecisions: AiDecision[] = [
  {
    timestamp: '09:42 UTC',
    marketBias: 'ETH funding cooled from +18 bps to +6 bps',
    conviction: 'High conviction / regime stable',
    action: 'Maintain 2.5x long ETH, trail stop at 3.1%',
    narrative: 'Order book delta flipped net positive after Asia open; hold exposure until CPI print.',
    guardrail: 'Auto-delever to 1.2x if realized vol > 68%.',
  },
  {
    timestamp: '11:05 UTC',
    marketBias: 'SOL liquidity pockets at 162.4',
    conviction: 'Medium conviction / awaiting confirmation',
    action: 'Queue maker bids 0.15% below mark',
    narrative: 'Hyperliquid depth shows persistent iceberg absorption; bias adds if ask stack thins.',
    guardrail: 'Cancel replaces after 90s without fill.',
  },
  {
    timestamp: '13:27 UTC',
    marketBias: 'BTC basis compressing on front-months',
    conviction: 'Exploratory / sandbox mode',
    action: 'Simulate short gamma hedge with 15% size',
    narrative: 'LLM flagged elevated gamma exposure; running dry run before wiring to main vault.',
    guardrail: 'No real capital committed in sandbox window.',
  },
]

const roadmapMilestones: RoadmapMilestone[] = [
  {
    quarter: 'Q1 · 2025',
    label: 'LLM Execution Guardrails v3',
    status: 'done',
    details: 'Chain-of-thought scoring, forced stop-loss anchoring, and deterministic review.',
  },
  {
    quarter: 'Q2 · 2025',
    label: 'Cross-venue Latency Mesh',
    status: 'wip',
    details: 'Aggregated routing across Hyperliquid, Aevo, and Jupiter perps.',
  },
  {
    quarter: 'Q3 · 2025',
    label: 'Vault Composability API',
    status: 'planned',
    details: 'Composable strategy endpoints with per-tenant limit management.',
  },
]

const faqEntries: FaqEntry[] = [
  {
    question: 'Can I run everything without the backend?',
    answer: 'Yes. This bundle ships with static, high-fidelity data so designers can iterate on layout, typography, and theming without standing up the Rust/Go services.',
  },
  {
    question: 'How do I swap dummy data for live feeds?',
    answer: 'Replace the `getDashboardData` helper with your API calls and hydrate each section through the same props. The UI already expects fully shaped objects.',
  },
  {
    question: 'Is Hyperliquid testnet supported?',
    answer: 'The production stack spans both testnet and mainnet. In this static build we surface representative numbers pulled from internal monitoring.',
  },
]

interface DashboardDataRequest {
  timeframe?: '24h' | '7d' | '30d'
}

interface DashboardDataResponse {
  hero: HeroContent
  stats: StatTile[]
  traders: TraderProfile[]
  decisions: AiDecision[]
  roadmap: RoadmapMilestone[]
  faqs: FaqEntry[]
  timeframe: string
}

export function getDashboardData({ timeframe = '24h' }: DashboardDataRequest = {}): DashboardDataResponse {
  return {
    hero: heroContent,
    stats: statTiles,
    traders: traderProfiles,
    decisions: aiDecisions,
    roadmap: roadmapMilestones,
    faqs: faqEntries,
    timeframe,
  }
}


