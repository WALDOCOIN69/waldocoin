import React, { useState, useEffect } from 'react'
import './MemeGenerator.css'

function MemeGenerator({ user, isPremium }) {
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [topText, setTopText] = useState('')
  const [bottomText, setBottomText] = useState('')
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchTemplates()
  }, [])

  const fetchTemplates = async () => {
    try {
      setLoading(true)
      // Try to fetch from API, but use mock data if it fails
      try {
        const response = await fetch('/api/templates/imgflip')
        const data = await response.json()
        setTemplates(data.memes || [])
      } catch (apiError) {
        // Use mock data when backend is not available
        const mockTemplates = [
          { id: '181913649', name: 'Drake Hotline Bling', url: 'https://i.imgflip.com/30b1gx.jpg' },
          { id: '87743020', name: 'Two Buttons', url: 'https://i.imgflip.com/1g8my4.jpg' },
          { id: '112126428', name: 'Distracted Boyfriend', url: 'https://i.imgflip.com/1ur9b0.jpg' },
          { id: '131087935', name: 'Running Away Balloon', url: 'https://i.imgflip.com/261o3j.jpg' },
          { id: '4087833', name: 'Waiting Skeleton', url: 'https://i.imgflip.com/2fm6x.jpg' },
          { id: '101470', name: 'Ancient Aliens', url: 'https://i.imgflip.com/26am.jpg' },
          { id: '438680', name: 'Batman Slapping Robin', url: 'https://i.imgflip.com/9ehk.jpg' },
          { id: '21735', name: 'The Rock Driving', url: 'https://i.imgflip.com/grr.jpg' },
          { id: '563423', name: 'That Would Be Great', url: 'https://i.imgflip.com/c2qn.jpg' },
          { id: '61579', name: 'One Does Not Simply', url: 'https://i.imgflip.com/1bij.jpg' },
          { id: '101288', name: 'Third World Skeptical Kid', url: 'https://i.imgflip.com/265k.jpg' },
          { id: '61520', name: 'Futurama Fry', url: 'https://i.imgflip.com/1bgw.jpg' },
        ]
        setTemplates(mockTemplates)
      }
    } catch (error) {
      console.error('Error fetching templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const generateMeme = async () => {
    if (!selectedTemplate || !user) {
      alert('Please select a template and login')
      return
    }

    try {
      setLoading(true)
      const response = await fetch('/api/memes/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('waldoToken')}`
        },
        body: JSON.stringify({
          template_id: selectedTemplate.id,
          text_top: topText,
          text_bottom: bottomText,
          user_id: user.id
        })
      })

      const data = await response.json()
      setPreview(data.image_url)
    } catch (error) {
      console.error('Error generating meme:', error)
      alert('Error generating meme')
    } finally {
      setLoading(false)
    }
  }

  const downloadMeme = () => {
    if (preview) {
      const link = document.createElement('a')
      link.href = preview
      link.download = 'meme.png'
      link.click()
    }
  }

  return (
    <div className="meme-generator">
      <div className="generator-grid">
        {/* Templates */}
        <div className="templates-panel card">
          <h2>📋 Meme Templates</h2>
          <div className="templates-list">
            {loading ? (
              <p>Loading templates...</p>
            ) : (
              templates.map(template => (
                <div
                  key={template.id}
                  className={`template-item ${selectedTemplate?.id === template.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTemplate(template)}
                >
                  <img src={template.url} alt={template.name} />
                  <p>{template.name}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="editor-panel card">
          <h2>✏️ Edit Meme</h2>
          
          {selectedTemplate && (
            <div className="preview-box">
              <img src={selectedTemplate.url} alt="preview" />
            </div>
          )}

          <div className="form-group">
            <label>Top Text</label>
            <input
              type="text"
              value={topText}
              onChange={(e) => setTopText(e.target.value)}
              placeholder="Enter top text..."
              maxLength="100"
            />
          </div>

          <div className="form-group">
            <label>Bottom Text</label>
            <input
              type="text"
              value={bottomText}
              onChange={(e) => setBottomText(e.target.value)}
              placeholder="Enter bottom text..."
              maxLength="100"
            />
          </div>

          <button 
            className="btn-primary" 
            onClick={generateMeme}
            disabled={!selectedTemplate || loading}
          >
            {loading ? 'Generating...' : '🎨 Generate Meme'}
          </button>
        </div>

        {/* Preview */}
        {preview && (
          <div className="preview-panel card">
            <h2>👀 Preview</h2>
            <img src={preview} alt="meme preview" className="meme-preview" />
            <button className="btn-primary" onClick={downloadMeme}>
              ⬇️ Download Meme
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default MemeGenerator

