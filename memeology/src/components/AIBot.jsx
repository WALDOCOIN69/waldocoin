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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

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
      const response = await fetch(`${API_URL}/api/memeology/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: input,
          wallet: user?.wallet || 'anonymous',
          tier: tier || 'free',
          ai_model: aiModel
        })
      })

      const data = await response.json()
      const botMessage = { role: 'bot', content: data.suggestion }
      setMessages(prev => [...prev, botMessage])
    } catch (error) {
      console.error('Error:', error)
      setMessages(prev => [...prev, { role: 'bot', content: 'Error getting response' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ai-bot">
      <div className="ai-container">
        <div className="ai-header">
          <h2>🤖 AI Meme Assistant</h2>
          {/* Hide AI model selector - users don't need to know which AI is being used */}
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
                  {msg.content}
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
            placeholder="Describe the meme you want..."
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
    </div>
  )
}

export default AIBot

