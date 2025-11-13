import React, { useState, useEffect } from 'react'
import Header from './components/Header'
import MemeGenerator from './components/MemeGenerator'
import AIBot from './components/AIBot'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [isPremium, setIsPremium] = useState(false)
  const [activeTab, setActiveTab] = useState('generator')

  useEffect(() => {
    // Check if user is logged in
    const token = localStorage.getItem('waldoToken')
    const userData = localStorage.getItem('waldoUser')
    
    if (token && userData) {
      setUser(JSON.parse(userData))
      checkPremiumStatus(JSON.parse(userData).id)
    }
  }, [])

  const checkPremiumStatus = async (userId) => {
    try {
      const response = await fetch(`/api/premium/status?user_id=${userId}`)
      const data = await response.json()
      setIsPremium(data.isPremium)
    } catch (error) {
      console.error('Error checking premium status:', error)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('waldoToken')
    localStorage.removeItem('waldoUser')
    setUser(null)
    setIsPremium(false)
  }

  return (
    <div className="app">
      <Header user={user} isPremium={isPremium} onLogout={handleLogout} />
      
      <div className="container">
        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'generator' ? 'active' : ''}`}
            onClick={() => setActiveTab('generator')}
          >
            🎨 Meme Generator
          </button>
          <button 
            className={`tab ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            🤖 AI Bot
          </button>
        </div>

        {activeTab === 'generator' && (
          <MemeGenerator user={user} isPremium={isPremium} />
        )}
        
        {activeTab === 'ai' && (
          <AIBot user={user} isPremium={isPremium} />
        )}
      </div>
    </div>
  )
}

export default App

