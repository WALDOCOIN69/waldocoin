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
    if (!input.trim() || !user) {
      alert('Please login first')
      return
    }

    const userMessage = { role: 'user', content: input }
    setMessages([...messages, userMessage])
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('/api/ai/suggest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('waldoToken')}`
        },
        body: JSON.stringify({
          message: input,
          user_id: user.id,
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
          <h2>🤖 AI Meme Bot</h2>
          <div className="model-selector">
            <label>AI Model:</label>
            <select value={aiModel} onChange={(e) => setAiModel(e.target.value)}>
              <option value="groq">⚡ Groq (Free, Fast)</option>
              {tier === 'premium' && <option value="claude">✨ Claude (Premium, Best)</option>}
              <option value="ollama">🏠 Ollama (Free, Local)</option>
            </select>
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

