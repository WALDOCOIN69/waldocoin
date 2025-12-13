import React, { useState } from 'react'
import { AuthProvider } from './contexts/AuthContext'
import Header from './components/Header'
import MemeGenerator from './components/MemeGenerator'
import CommunityGallery from './components/CommunityGallery'
import AIBot from './components/AIBot'
import './App.css'

function App() {
	const [activeTab, setActiveTab] = useState('generator')
	// When set, this will preload the meme editor with an image (e.g. from AI Image mode)
	const [aiEditorTemplate, setAiEditorTemplate] = useState(null)

	const handleUseInEditor = (imageUrl) => {
		if (!imageUrl) return
		setAiEditorTemplate({
			id: `ai_${Date.now()}`,
			name: 'AI Generated Image',
			url: imageUrl,
			isCustom: true,
		})
		setActiveTab('generator')
	}

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

					{activeTab === 'generator' && (
						<MemeGenerator
							initialTemplate={aiEditorTemplate}
							onTemplateConsumed={() => setAiEditorTemplate(null)}
						/>
					)}
					{activeTab === 'gallery' && <CommunityGallery />}
					{activeTab === 'ai' && <AIBot onUseInEditor={handleUseInEditor} />}
				</div>

				<footer className="app-footer">
					<p>Need help? Contact us at <a href="mailto:info@memeology.fun">info@memeology.fun</a></p>
				</footer>
			</div>
		</AuthProvider>
	)
}

export default App

