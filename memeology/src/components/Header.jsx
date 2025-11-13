import React from 'react'
import './Header.css'

function Header({ user, isPremium, onLogout }) {
  const handleWaldoLink = () => {
    window.location.href = 'https://waldocoin.live'
  }

  return (
    <header className="header">
      <div className="header-content">
        <div className="logo">
          <h1>🎨 Memeology</h1>
          <p>AI-Powered Meme Creator</p>
        </div>

        <div className="header-actions">
          <button className="btn-secondary" onClick={handleWaldoLink}>
            🪙 Back to Waldocoin
          </button>

          {user ? (
            <div className="user-menu">
              <span className="user-name">{user.wallet?.slice(0, 10)}...</span>
              {isPremium && <span className="premium-badge">⭐ Premium</span>}
              <button className="btn-secondary" onClick={onLogout}>
                Logout
              </button>
            </div>
          ) : (
            <button className="btn-primary" onClick={() => window.location.href = 'https://waldocoin.live/login'}>
              Login with Waldo
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header

