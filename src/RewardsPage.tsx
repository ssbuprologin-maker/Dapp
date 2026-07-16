import { ArrowLeft, Gift, Sparkles } from 'lucide-react'

export default function RewardsPage({ onBack }: { onBack: () => void }) {
  return <section className="rewards-page">
    <button type="button" className="rewards-back" onClick={onBack}><ArrowLeft /> Back</button>
    <div className="rewards-coming-soon">
      <span className="rewards-gift"><Gift /></span>
      <small><Sparkles /> REWARDS</small>
      <h1>Rewards are coming soon.</h1>
      <p>This area is ready for the rewards system, balances, tasks, and claims that will be configured later.</p>
      <div><strong>$0.00</strong><span>Current rewards</span></div>
    </div>
  </section>
}
