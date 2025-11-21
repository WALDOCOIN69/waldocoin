import React, { useState } from 'react'
import { AuthProvider } from './contexts/AuthContext'
import Header from './components/Header'
import MemeGenerator from './components/MemeGenerator'
import CommunityGallery from './components/CommunityGallery'
import AIBot from './components/AIBot'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('generator')

  return (
    <AuthProvider>
      <div className="app">
        <Header />

        <div className="container">
          <div className="tabs">
            <button
              className={`tab ${activeTab === 'generator' ? 'active' : ''}`}
              onClick={() => setActiveTab('generator')}
            >
              🎨 Meme Generator
            </button>
            <button
              className={`tab ${activeTab === 'gallery' ? 'active' : ''}`}
              onClick={() => setActiveTab('gallery')}
            >
              🖼️ Community Gallery
            </button>
            <button
              className={`tab ${activeTab === 'ai' ? 'active' : ''}`}
              onClick={() => setActiveTab('ai')}
            >
              🤖 AI Bot
            </button>
          </div>

          {activeTab === 'generator' && <MemeGenerator />}
          {activeTab === 'gallery' && <CommunityGallery />}
          {activeTab === 'ai' && <AIBot />}
        </div>
      </div>
    </AuthProvider>
  )
}

export default App

