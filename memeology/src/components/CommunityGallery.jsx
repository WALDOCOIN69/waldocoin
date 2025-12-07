import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import './CommunityGallery.css'

const API_URL = import.meta.env.VITE_API_URL || 'https://waldocoin-backend-api.onrender.com'

function CommunityGallery() {
  const { user } = useAuth()
  const [memes, setMemes] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState('recent') // 'recent' or 'top'
  const [userVotes, setUserVotes] = useState({}) // Track user's votes per meme
  const [highlightedMemeId, setHighlightedMemeId] = useState(null)
  const [hasFetchedHighlight, setHasFetchedHighlight] = useState(false)
  const [highlightNotFound, setHighlightNotFound] = useState(false)

  useEffect(() => {
    fetchGallery()
  }, [sortBy])

  const fetchGallery = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${API_URL}/api/memeology/community/gallery?sort=${sortBy}&limit=100`)
      const data = await response.json()
      
      if (data.success) {
        setMemes(data.memes)
      }
    } catch (error) {
      console.error('Error fetching gallery:', error)
    } finally {
      setLoading(false)
    }
  }

  // If the URL contains ?memeId=..., remember it so we can scroll/highlight
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const id = params.get('memeId')
      if (id) {
        setHighlightedMemeId(id)
      }
    } catch (err) {
      console.error('Error parsing memeId from URL:', err)
    }
  }, [])

  // If the highlighted meme is in the current list, scroll it into view.
  // If not, try to fetch it directly from the backend once.
  useEffect(() => {
    if (!highlightedMemeId || memes.length === 0) return

    const el = document.getElementById(`meme-${highlightedMemeId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    if (!hasFetchedHighlight) {
      const fetchSingleMeme = async () => {
        try {
          setHasFetchedHighlight(true)
          const resp = await fetch(`${API_URL}/api/memeology/community/meme/${encodeURIComponent(highlightedMemeId)}`)
          const data = await resp.json()
          if (data.success && data.meme) {
            setMemes(prev => {
              const filtered = prev.filter(m => m.id !== data.meme.id)
              return [data.meme, ...filtered]
            })
          } else {
            setHighlightNotFound(true)
          }
        } catch (error) {
          console.error('Error fetching highlighted meme:', error)
          setHighlightNotFound(true)
        }
      }

      fetchSingleMeme()
    }
  }, [highlightedMemeId, memes, hasFetchedHighlight])

  const handleVote = async (memeId, voteType) => {
    if (!user?.wallet) {
      alert('Please connect your wallet to vote!')
      return
    }

    try {
      const response = await fetch(`${API_URL}/api/memeology/community/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: user.wallet,
          memeId,
          voteType
        })
      })

      const data = await response.json()

      if (data.success) {
        // Update local state
        setMemes(memes.map(meme => 
          meme.id === memeId 
            ? { ...meme, upvotes: data.upvotes, downvotes: data.downvotes }
            : meme
        ))

        // Track user's vote
        setUserVotes({ ...userVotes, [memeId]: voteType })
      } else {
        alert(data.error || 'Vote failed')
      }
    } catch (error) {
      console.error('Error voting:', error)
      alert('Error voting on meme')
    }
  }

  const formatWallet = (wallet) => {
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
  }

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="community-gallery">
      <div className="gallery-header">
        <h1>🎨 Community Gallery</h1>
        <p className="gallery-subtitle">Vote for your favorite memes! Creators earn WLO for viral memes.</p>
        
        <div className="gallery-controls">
          <div className="sort-buttons">
            <button 
              className={`sort-btn ${sortBy === 'recent' ? 'active' : ''}`}
              onClick={() => setSortBy('recent')}
            >
              🕒 Recent
            </button>
            <button 
              className={`sort-btn ${sortBy === 'top' ? 'active' : ''}`}
              onClick={() => setSortBy('top')}
            >
              🔥 Top Voted
            </button>
          </div>
        </div>
      </div>

      {highlightNotFound && (
        <div className="highlight-warning">
          This meme link may have expired or been removed from the gallery.
        </div>
      )}

      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading memes...</p>
        </div>
      ) : memes.length === 0 ? (
        <div className="empty-state">
          <h2>No memes yet!</h2>
          <p>Be the first to share a meme to the community gallery.</p>
        </div>
      ) : (
        <div className="memes-grid">
          {memes.map((meme) => (
              <div
                key={meme.id}
                id={`meme-${meme.id}`}
                className={`meme-card ${meme.id === highlightedMemeId ? 'highlight' : ''}`}
              >
              <div className="meme-image-container">
                <img src={meme.memeUrl} alt={meme.caption || 'Meme'} className="meme-image" />
              </div>
              
              <div className="meme-info">
                {meme.caption && <p className="meme-caption">{meme.caption}</p>}
                <div className="meme-meta">
                  <span className="meme-creator">👤 {formatWallet(meme.wallet)}</span>
                  <span className="meme-date">⏰ {formatDate(meme.createdAt)}</span>
                </div>
              </div>

              <div className="meme-actions">
                <button 
                  className={`vote-btn upvote ${userVotes[meme.id] === 'up' ? 'active' : ''}`}
                  onClick={() => handleVote(meme.id, 'up')}
                  disabled={!user?.wallet}
                >
                  👍 {meme.upvotes || 0}
                </button>
                <button 
                  className={`vote-btn downvote ${userVotes[meme.id] === 'down' ? 'active' : ''}`}
                  onClick={() => handleVote(meme.id, 'down')}
                  disabled={!user?.wallet}
                >
                  👎 {meme.downvotes || 0}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default CommunityGallery

