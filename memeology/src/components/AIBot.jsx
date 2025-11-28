import React, { useState, useRef, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import './AIBot.css'

function AIBot() {
  const { user, tier } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiModel, setAiModel] = useState('groq') // groq (free), claude (premium), ollama (free)
  const messagesEndRef = useRef(null)
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const [generationMode, setGenerationMode] = useState('template') // 'template' or 'ai-image'
  const [enlargedImage, setEnlargedImage] = useState(null) // For image modal

  // Template browser state
  const [showTemplateBrowser, setShowTemplateBrowser] = useState(false)
  const [templates, setTemplates] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [templateStats, setTemplateStats] = useState(null)

  const examplePrompts = [
    "Make a meme about crypto being down",
    "Create a meme about Monday mornings",
    "Meme about my code not working",
    "Make a funny meme about coffee",
    "Create a meme about working from home",
    "Meme about being broke",
    "Make a meme about the weekend",
    "Create a meme about procrastination"
  ]

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Rotate placeholder text every 3 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % examplePrompts.length)
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // Load categories and stats on mount
  useEffect(() => {
    loadCategories()
    loadTemplateStats()
  }, [])

  // Load templates when browser is opened or filters change
  useEffect(() => {
    if (showTemplateBrowser) {
      loadTemplates()
    }
  }, [showTemplateBrowser, selectedCategory, searchQuery, tier])

  const loadCategories = async () => {
    try {
      const response = await fetch('https://waldocoin-backend.onrender.com/api/memeology/templates/categories')
      const data = await response.json()
      if (data.success) {
        setCategories(data.categories)
      }
    } catch (error) {
      console.error('Error loading categories:', error)
    }
  }

  const loadTemplateStats = async () => {
    try {
      const response = await fetch('https://waldocoin-backend.onrender.com/api/memeology/templates/stats')
      const data = await response.json()
      if (data.success) {
        setTemplateStats(data)
      }
    } catch (error) {
      console.error('Error loading template stats:', error)
    }
  }

  const loadTemplates = async () => {
    try {
      const userTier = tier || 'free'
      const params = new URLSearchParams({
        tier: userTier,
        limit: 100
      })

      if (searchQuery) params.append('q', searchQuery)
      if (selectedCategory !== 'all') params.append('category', selectedCategory)

      const response = await fetch(`https://waldocoin-backend.onrender.com/api/memeology/templates/search?${params}`)
      const data = await response.json()

      if (data.success) {
        setTemplates(data.templates)
      }
    } catch (error) {
      console.error('Error loading templates:', error)
    }
  }

  const sendMessage = async () => {
    if (!input.trim()) {
      return
    }

    // Allow anonymous users for FREE tier
    const userMessage = { role: 'user', content: input }

    // Fun loading messages
    const loadingMessages = [
      '🎨 Cooking up something spicy...',
      '🧠 AI brain go brrr...',
      '✨ Summoning the meme gods...',
      '🎭 Crafting peak comedy...',
      '🚀 Launching meme into orbit...',
      '🎪 Performing meme magic...',
      '⚡ Charging meme capacitors...',
      '🎯 Aiming for viral status...'
    ]
    const randomLoading = loadingMessages[Math.floor(Math.random() * loadingMessages.length)]

    const loadingMessage = { role: 'bot', content: randomLoading, type: 'text' }
    setMessages([...messages, userMessage, loadingMessage])
    setInput('')
    setLoading(true)

    try {
      const API_URL = import.meta.env.VITE_API_URL || 'https://waldocoin-backend-api.onrender.com'
      const response = await fetch(`${API_URL}/api/memeology/ai/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: input,
          wallet: user?.wallet || 'anonymous',
          tier: tier || 'free',
          mode: generationMode
        })
      })

      const data = await response.json()

      if (data.success && data.meme_url) {
        // Replace loading message with the generated meme
        const botMessage = {
          role: 'bot',
          content: data.meme_url,
          type: 'image',
          template: data.template_name,
          texts: data.texts,
          mode: data.mode,
          fallback_urls: data.fallback_urls || []
        }
        // Remove loading message and add meme
        setMessages(prev => [...prev.slice(0, -1), botMessage])
      } else {
        // Replace loading message with error
        setMessages(prev => [...prev.slice(0, -1), {
          role: 'bot',
          content: data.error || '❌ Failed to generate meme. Try being more specific or try again!'
        }])
      }
    } catch (error) {
      console.error('Error:', error)
      // Replace loading message with error
      setMessages(prev => [...prev.slice(0, -1), { role: 'bot', content: '❌ Network error. Check your connection and try again!' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ai-bot">
      <div className="ai-container">
        <div className="ai-header">
          <h2>🤖 AI Meme Assistant</h2>
          <div className="mode-toggle">
            <button
              className={`mode-btn ${generationMode === 'template' ? 'active' : ''}`}
              onClick={() => setGenerationMode('template')}
              title="Use meme templates (fast)"
            >
              📋 Template
            </button>
            <button
              className={`mode-btn ${generationMode === 'ai-image' ? 'active' : ''}`}
              onClick={() => setGenerationMode('ai-image')}
              title="AI generates custom image (slower)"
            >
              🎨 AI Image
            </button>
            <button
              className={`mode-btn ${showTemplateBrowser ? 'active' : ''}`}
              onClick={() => setShowTemplateBrowser(!showTemplateBrowser)}
              title="Browse all templates"
            >
              🎨 Browse ({templateStats?.stats?.total || 380})
            </button>
          </div>
        </div>

        {/* Template Browser */}
        {showTemplateBrowser && (
          <div className="template-browser">
            <div className="browser-header">
              <h3>📚 Template Library</h3>
              {templateStats && (
                <div className="tier-info">
                  <span className="tier-badge">{tier || 'FREE'}</span>
                  <span className="template-count">
                    {tier === 'free' && `${templateStats.stats.free} templates`}
                    {tier === 'waldocoin' && `${templateStats.stats.free + templateStats.stats.waldocoin} templates`}
                    {['premium', 'gold', 'platinum', 'king'].includes(tier) && `All ${templateStats.stats.total} templates`}
                  </span>
                </div>
              )}
            </div>

            <div className="browser-filters">
              <input
                type="text"
                className="search-input"
                placeholder="🔍 Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              <div className="category-filters">
                <button
                  className={`category-btn ${selectedCategory === 'all' ? 'active' : ''}`}
                  onClick={() => setSelectedCategory('all')}
                >
                  All
                </button>
                {categories.map(cat => (
                  <button
                    key={cat.category}
                    className={`category-btn ${selectedCategory === cat.category ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(cat.category)}
                  >
                    {cat.category} ({cat.count})
                  </button>
                ))}
              </div>
            </div>

            <div className="template-grid">
              {templates.map(template => (
                <div key={template.id} className="template-card">
                  <div className="template-info">
                    <h4>{template.name}</h4>
                    <div className="template-meta">
                      <span className="template-source">{template.source}</span>
                      <span className="template-score">⭐ {template.qualityScore}/100</span>
                      <span className="template-rank">#{template.rank}</span>
                    </div>
                    <div className="template-categories">
                      {template.categories?.map(cat => (
                        <span key={cat} className="category-tag">{cat}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    className="use-template-btn"
                    onClick={() => {
                      setInput(`Make a meme using ${template.name}`)
                      setShowTemplateBrowser(false)
                    }}
                  >
                    Use Template
                  </button>
                </div>
              ))}
            </div>

            {templates.length === 0 && (
              <div className="no-templates">
                <p>No templates found. Try a different search or category.</p>
              </div>
            )}
          </div>
        )}

        <div className="chat-box">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p>👋 Hi! I'm your AI meme assistant.</p>
              <p>Tell me what kind of meme you want to create!</p>
              <p>Example: "Make a meme about crypto being down"</p>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role}`}>
                <div className="message-content">
                  {msg.type === 'image' ? (
                    <div className="meme-result">
                      <div className="meme-image-container" onClick={() => setEnlargedImage(msg.content)}>
                        <img
                          src={msg.content}
                          alt="Generated meme"
                          className="meme-image"
                          style={{ maxWidth: '100%', height: 'auto', display: 'block', cursor: 'pointer' }}
                          onLoad={() => console.log('✅ Image loaded successfully')}
                          onError={(e) => {
                            console.error('❌ Image failed to load:', msg.content)
                            // Try fallback URLs if main image fails to load
                            if (msg.fallback_urls && msg.fallback_urls.length > 0) {
                              const fallbackUrl = msg.fallback_urls.shift()
                              if (fallbackUrl) {
                                console.log('Trying fallback:', fallbackUrl)
                                e.target.src = fallbackUrl
                              } else {
                                e.target.alt = '❌ Failed to load image. Try again!'
                              }
                            } else {
                              e.target.alt = '❌ Failed to load image. Try again!'
                            }
                          }}
                        />
                        <div className="meme-watermark-text">
                          memeology.fun
                        </div>
                      </div>
                      <div className="meme-info">
                        <small>
                          {msg.mode === 'ai-image' ? '🎨 AI Generated Image' : `📋 Template: ${msg.template}`}
                          {msg.texts && (
                            <span style={{ marginLeft: '10px', opacity: 0.7 }}>
                              "{msg.texts.top}" / "{msg.texts.bottom}"
                            </span>
                          )}
                        </small>
                        <button
                          className="btn-download"
                          onClick={async () => {
                            try {
                              // Create canvas to add watermark
                              const img = new Image()
                              img.crossOrigin = 'anonymous'
                              img.src = msg.content

                              await new Promise((resolve, reject) => {
                                img.onload = resolve
                                img.onerror = reject
                              })

                              const canvas = document.createElement('canvas')
                              const ctx = canvas.getContext('2d')
                              canvas.width = img.width
                              canvas.height = img.height

                              // Draw the meme image
                              ctx.drawImage(img, 0, 0)

                              // Add text watermark with black background
                              const text = 'memeology.fun'
                              const fontSize = 14
                              const padding = 8

                              ctx.font = `bold ${fontSize}px Arial`
                              const textMetrics = ctx.measureText(text)
                              const textWidth = textMetrics.width
                              const textHeight = fontSize

                              // Draw black background rectangle (bottom-left corner, no margin)
                              ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'
                              ctx.fillRect(0, img.height - textHeight - padding * 2, textWidth + padding * 2, textHeight + padding * 2)

                              // Draw text
                              ctx.fillStyle = '#00f7ff'
                              ctx.fillText(text, padding, img.height - padding - 4)

                              // Download the watermarked image
                              canvas.toBlob((blob) => {
                                const url = URL.createObjectURL(blob)
                                const link = document.createElement('a')
                                link.href = url
                                link.download = `meme-${Date.now()}.jpg`
                                link.click()
                                URL.revokeObjectURL(url)
                              }, 'image/jpeg', 0.9)
                            } catch (error) {
                              console.error('Download failed:', error)
                              // Fallback to direct download
                              const link = document.createElement('a')
                              link.href = msg.content
                              link.download = `meme-${Date.now()}.jpg`
                              link.click()
                            }
                          }}
                        >
                          📥 Download
                        </button>
                      </div>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))
          )}
          {loading && (
            <div className="message bot">
              <div className="message-content">
                <span className="typing">Thinking...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
            placeholder={examplePrompts[placeholderIndex]}
            disabled={loading}
          />
          <button
            className="btn-primary"
            onClick={sendMessage}
            disabled={loading || !input.trim()}
          >
            {loading ? '⏳' : '📤'} Send
          </button>
        </div>
      </div>

      {/* Image Enlargement Modal */}
      {enlargedImage && (
        <div className="image-modal" onClick={() => setEnlargedImage(null)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEnlargedImage(null)}>✕</button>
            <div className="enlarged-image-container">
              <img src={enlargedImage} alt="Enlarged meme" className="enlarged-image" />
              <div className="meme-watermark-text">
                memeology.fun
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AIBot

