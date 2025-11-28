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

  const sendMessage = async () => {
    if (!input.trim()) {
      return
    }

    // Allow anonymous users for FREE tier
    const userMessage = { role: 'user', content: input }
    setMessages([...messages, userMessage])
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
        // Show the generated meme image
        const botMessage = {
          role: 'bot',
          content: data.meme_url,
          type: 'image',
          template: data.template_name,
          texts: data.texts,
          mode: data.mode,
          fallback_urls: data.fallback_urls || []
        }
        setMessages(prev => [...prev, botMessage])
      } else {
        setMessages(prev => [...prev, {
          role: 'bot',
          content: data.error || 'Failed to generate meme. Try being more specific!'
        }])
      }
    } catch (error) {
      console.error('Error:', error)
      setMessages(prev => [...prev, { role: 'bot', content: 'Error generating meme. Please try again!' }])
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
          </div>
        </div>

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
                        <img
                          src="/memeology-logo.png"
                          alt="Memeology"
                          className="meme-watermark-overlay"
                        />
                      </div>
                      <div className="meme-info">
                        <small>
                          {msg.mode === 'ai-image' ? '🎨 AI Generated' : `📋 ${msg.template}`}
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

                              // Load and draw watermark
                              const watermark = new Image()
                              watermark.src = '/memeology-logo.png'

                              await new Promise((resolve, reject) => {
                                watermark.onload = resolve
                                watermark.onerror = () => {
                                  console.warn('Watermark not found, downloading without watermark')
                                  resolve() // Continue without watermark
                                }
                              })

                              if (watermark.complete && watermark.naturalWidth > 0) {
                                // Calculate watermark size (20% of image width to cover memegen.link watermark)
                                const watermarkSize = Math.floor(img.width * 0.20)
                                const padding = 10

                                // Draw watermark on bottom-left to cover memegen.link watermark
                                ctx.drawImage(
                                  watermark,
                                  padding,
                                  img.height - watermarkSize - padding,
                                  watermarkSize,
                                  watermarkSize
                                )
                              }

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
            <img src={enlargedImage} alt="Enlarged meme" className="enlarged-image" />
          </div>
        </div>
      )}
    </div>
  )
}

export default AIBot

