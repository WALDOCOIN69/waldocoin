import React from 'react'
import './Header.css'
import { useAuth } from '../contexts/AuthContext'

function Header() {
  const { user, tier, wloBalance, loginWithXUMM, logout } = useAuth()

  const handleWaldoLink = () => {
    window.location.href = 'https://waldocoin.live'
  }

  const getTierBadge = () => {
    if (tier === 'premium') return '💎 Premium'
    if (tier === 'waldocoin') return '🪙 WALDOCOIN'
    return '🆓 Free'
  }

  return (
    <header className="header">
      <div className="header-content">
        <div className="logo">
          <div className="logo-main">
            <span className="logo-icon">🧬</span>
            <div className="logo-text">
              <h1>MEMEOLOGY.FUN</h1>
              <p className="tagline">Brought to you by <span className="waldo-labs">WALDOlabs</span></p>
            </div>
          </div>
        </div>

        <div className="header-actions">
          <button className="btn-secondary" onClick={handleWaldoLink}>
            🪙 Back to Waldocoin
          </button>

          {user ? (
            <div className="user-menu">
              <span className="tier-badge">{getTierBadge()}</span>
              <span className="user-name">{user.wallet?.slice(0, 10)}...</span>
              {tier === 'waldocoin' && (
                <span className="wlo-balance">{wloBalance.toFixed(0)} WLO</span>
              )}
              <button className="btn-secondary" onClick={logout}>
                Logout
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={loginWithXUMM}>
              🔐 Login with XUMM
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header

