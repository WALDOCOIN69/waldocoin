import React from 'react'
import './Header.css'
import { useAuth } from '../contexts/AuthContext'

// Backend API base URL (same as other Memeology components)
const API_URL = import.meta.env.VITE_API_URL || 'https://waldocoin-backend-api.onrender.com'

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

		  const handleLinkTwitter = async () => {
	    if (!user?.wallet) {
	      alert('Please connect your wallet first to link your X account.')
	      return
	    }

	    const input = window.prompt('Enter your X (Twitter) handle (you can include or omit @):')
	    if (!input) return
	    const twitterHandle = input.trim()
	    if (!twitterHandle) return

	    try {
	      const response = await fetch(`${API_URL}/api/linkTwitter`, {
	        method: 'POST',
	        headers: { 'Content-Type': 'application/json' },
	        body: JSON.stringify({
	          wallet: user.wallet,
	          twitterHandle
	        })
	      })

	      const data = await response.json()

	      if (data.success) {
	        let message = data.message || `X handle @${data.twitterHandle || twitterHandle} linked successfully!`
	        if (typeof data.memesStored === 'number') {
	          message += `\nFound ${data.memesStored} existing #WaldoMeme tweets.`
	        }
	        if (typeof data.xpBonus === 'number') {
	          message += `\nYou earned +${data.xpBonus} XP for linking.`
	        }
	        alert(message)
	      } else {
	        alert(data.error || 'Failed to link X handle. It may already be linked and locked.')
	      }
	    } catch (error) {
	      console.error('Error linking X handle:', error)
	      alert('Error linking X handle. Please try again later.')
	    }
	  }

  return (
    <header className="header">
      <div className="header-content">
        <div className="logo">
          <div className="logo-main">
            <img src="/memeology-logo.png" alt="Memeology" className="logo-image" />
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
	              {tier === 'free' ? (
	                <button
	                  className="btn-secondary"
	                  onClick={() => {
	                    window.location.href = 'https://stats-page.waldocoin.live'
	                  }}
	                >
	                  📊 View WALDO Stats &amp; Link X
	                </button>
	              ) : (
	                <button className="btn-secondary" onClick={handleLinkTwitter}>
	                  🐦 Link X Handle
	                </button>
	              )}
	              <button className="btn-secondary logout-btn" onClick={logout}>
	                Logout
	              </button>
	            </div>
	          ) : (
            <button className="btn-primary" onClick={loginWithXUMM}>
              🔐 Login with Xaman
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

export default Header

