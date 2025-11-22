import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import './MemeGenerator.css'
import PremiumModal from './PremiumModal'

// Get API URL from environment variable
const API_URL = import.meta.env.VITE_API_URL || 'https://waldocoin-backend-api.onrender.com'

function MemeGenerator() {
  const { user, tier, wloBalance } = useAuth()
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [templateCount, setTemplateCount] = useState(0)
  const [upgradeMessage, setUpgradeMessage] = useState('')
  const [tierFeatures, setTierFeatures] = useState(null)
  const [showTierModal, setShowTierModal] = useState(false)
  const [showNFTModal, setShowNFTModal] = useState(false)
  const [showPremiumModal, setShowPremiumModal] = useState(false)
  const [userNFTs, setUserNFTs] = useState([])
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareCaption, setShareCaption] = useState('')
  const [shareSuccess, setShareSuccess] = useState(false)
  const [uploadedImage, setUploadedImage] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [aiSuggesting, setAiSuggesting] = useState(false)
  const [aiSuggestionsToday, setAiSuggestionsToday] = useState(0)

  // Multiple text boxes
  const [textBoxes, setTextBoxes] = useState([
    { id: 1, text: '', position: 'top', x: 0.5, y: 0.1, fontSize: 50, fontFamily: 'Impact', color: '#ffffff', outlineColor: '#000000', outlineWidth: 3 },
    { id: 2, text: '', position: 'bottom', x: 0.5, y: 0.9, fontSize: 50, fontFamily: 'Impact', color: '#ffffff', outlineColor: '#000000', outlineWidth: 3 }
  ])
  const [activeBoxId, setActiveBoxId] = useState(1)
  const [draggingBoxId, setDraggingBoxId] = useState(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  const canvasRef = useRef(null)
  const imageRef = useRef(null)
  const watermarkRef = useRef(null)

  useEffect(() => {
    fetchTemplates()
    if (user && (tier === 'waldocoin' || tier === 'premium')) {
      fetchUserNFTs()
    }
  }, [tier])

  const fetchUserNFTs = async () => {
    if (!user?.wallet) return

    try {
      const response = await fetch(`${API_URL}/api/memeology/user/nfts?wallet=${user.wallet}`)
      const data = await response.json()
      if (data.success) {
        setUserNFTs(data.nfts || [])
      }
    } catch (error) {
      console.error('Error fetching NFTs:', error)
    }
  }

  // Draw meme on canvas whenever text or template changes
  useEffect(() => {
    if (selectedTemplate && imageLoaded) {
      drawMeme()
    }
  }, [textBoxes, selectedTemplate, imageLoaded])

  const drawMeme = () => {
    const canvas = canvasRef.current
    const image = imageRef.current

    if (!canvas || !image) return

    const ctx = canvas.getContext('2d')

    // Set canvas size to match image
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight

    // Draw image
    ctx.drawImage(image, 0, 0)

    // Draw each text box
    textBoxes.forEach(box => {
      if (!box.text) return

      // Configure text style for this box
      ctx.fillStyle = box.color
      ctx.strokeStyle = box.outlineColor
      ctx.lineWidth = box.outlineWidth
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Calculate font size based on canvas width and user setting
      const scaledFontSize = (box.fontSize / 100) * (canvas.width / 10)
      ctx.font = `bold ${scaledFontSize}px ${box.fontFamily}, Arial Black, sans-serif`

      const lines = wrapText(ctx, box.text.toUpperCase(), canvas.width * 0.9)

      // Use x and y coordinates (0-1 range, relative to canvas size)
      const centerX = box.x * canvas.width
      const centerY = box.y * canvas.height

      // Draw text lines centered at the position
      const lineHeight = scaledFontSize * 1.1
      const totalHeight = lines.length * lineHeight
      const startY = centerY - (totalHeight / 2) + (lineHeight / 2)

      lines.forEach((line, index) => {
        const y = startY + (index * lineHeight)
        ctx.strokeText(line, centerX, y)
        ctx.fillText(line, centerX, y)
      })

      // Draw selection indicator if this box is active
      if (box.id === activeBoxId && box.text) {
        ctx.strokeStyle = '#00f7ff'
        ctx.lineWidth = 3
        ctx.setLineDash([5, 5])
        const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width))
        ctx.strokeRect(
          centerX - textWidth / 2 - 10,
          startY - lineHeight / 2 - 5,
          textWidth + 20,
          totalHeight + 10
        )
        ctx.setLineDash([])
      }
    })

    // Add watermark for FREE and WALDOCOIN tiers (Premium has no watermark)
    if (tier !== 'premium') {
      const padding = 15

      if (tier === 'waldocoin') {
        // WALDOCOIN tier gets "WALDOCOIN" text watermark
        const fontSize = Math.min(canvas.width, canvas.height) * 0.05 // 5% of smallest dimension
        ctx.font = `bold ${fontSize}px Impact, Arial Black, sans-serif`
        ctx.textAlign = 'right'
        ctx.textBaseline = 'bottom'

        // Draw background box
        const text = 'WALDOCOIN'
        const textMetrics = ctx.measureText(text)
        const textWidth = textMetrics.width
        const textHeight = fontSize * 1.2
        const boxPadding = 10

        const boxX = canvas.width - padding - textWidth - boxPadding * 2
        const boxY = canvas.height - padding - textHeight - boxPadding

        // Semi-transparent black background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
        ctx.fillRect(boxX, boxY, textWidth + boxPadding * 2, textHeight + boxPadding)

        // Gold gradient text
        const gradient = ctx.createLinearGradient(
          boxX, boxY,
          boxX + textWidth, boxY + textHeight
        )
        gradient.addColorStop(0, '#FFD700')
        gradient.addColorStop(0.5, '#FFA500')
        gradient.addColorStop(1, '#FFD700')

        ctx.fillStyle = gradient
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = 3

        const textX = canvas.width - padding - boxPadding
        const textY = canvas.height - padding - boxPadding

        ctx.strokeText(text, textX, textY)
        ctx.fillText(text, textX, textY)

      } else if (tier === 'free' && watermarkRef.current && watermarkRef.current.complete) {
        // FREE tier gets Memeology logo watermark
        const watermarkSize = Math.min(canvas.width, canvas.height) * 0.15 // 15% of smallest dimension
        const x = canvas.width - watermarkSize - padding
        const y = canvas.height - watermarkSize - padding

        // Draw semi-transparent watermark
        ctx.globalAlpha = 0.8
        ctx.drawImage(watermarkRef.current, x, y, watermarkSize, watermarkSize)
        ctx.globalAlpha = 1.0
      }
    }
  }

  const wrapText = (ctx, text, maxWidth) => {
    const words = text.split(' ')
    const lines = []
    let currentLine = words[0]

    for (let i = 1; i < words.length; i++) {
      const word = words[i]
      const width = ctx.measureText(currentLine + ' ' + word).width
      if (width < maxWidth) {
        currentLine += ' ' + word
      } else {
        lines.push(currentLine)
        currentLine = word
      }
    }
    lines.push(currentLine)
    return lines
  }

  const handleImageLoad = () => {
    setImageLoaded(true)
  }

  const handleTemplateSelect = (template) => {
    setSelectedTemplate(template)
    setImageLoaded(false)
    // Reset text boxes
    setTextBoxes([
      { id: 1, text: '', position: 'top', x: 0.5, y: 0.1, fontSize: 50, fontFamily: 'Impact', color: '#ffffff', outlineColor: '#000000', outlineWidth: 3 },
      { id: 2, text: '', position: 'bottom', x: 0.5, y: 0.9, fontSize: 50, fontFamily: 'Impact', color: '#ffffff', outlineColor: '#000000', outlineWidth: 3 }
    ])
    setActiveBoxId(1)
  }

  const updateTextBox = (id, field, value) => {
    setTextBoxes(boxes => boxes.map(box =>
      box.id === id ? { ...box, [field]: value } : box
    ))
  }

  // Canvas mouse event handlers for dragging text
  const getCanvasCoordinates = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    }
  }

  const getTextBoxAtPosition = (x, y) => {
    const canvas = canvasRef.current
    if (!canvas) return null

    // Check in reverse order (top boxes first)
    for (let i = textBoxes.length - 1; i >= 0; i--) {
      const box = textBoxes[i]
      if (!box.text) continue

      const centerX = box.x * canvas.width
      const centerY = box.y * canvas.height

      const ctx = canvas.getContext('2d')
      const scaledFontSize = (box.fontSize / 100) * (canvas.width / 10)
      ctx.font = `bold ${scaledFontSize}px ${box.fontFamily}, Arial Black, sans-serif`

      const lines = wrapText(ctx, box.text.toUpperCase(), canvas.width * 0.9)
      const lineHeight = scaledFontSize * 1.1
      const totalHeight = lines.length * lineHeight
      const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width))

      const startY = centerY - (totalHeight / 2)

      // Check if click is within text bounds
      if (
        x >= centerX - textWidth / 2 - 10 &&
        x <= centerX + textWidth / 2 + 10 &&
        y >= startY - lineHeight / 2 - 5 &&
        y <= startY + totalHeight + lineHeight / 2 + 5
      ) {
        return box
      }
    }
    return null
  }

  const handleCanvasMouseDown = (e) => {
    const { x, y } = getCanvasCoordinates(e)
    const clickedBox = getTextBoxAtPosition(x, y)

    if (clickedBox) {
      setDraggingBoxId(clickedBox.id)
      setActiveBoxId(clickedBox.id)
      const canvas = canvasRef.current
      setDragOffset({
        x: x - (clickedBox.x * canvas.width),
        y: y - (clickedBox.y * canvas.height)
      })
    }
  }

  const handleCanvasMouseMove = (e) => {
    if (!draggingBoxId) return

    const canvas = canvasRef.current
    if (!canvas) return

    const { x, y } = getCanvasCoordinates(e)

    // Update text box position (normalized 0-1)
    const newX = Math.max(0, Math.min(1, (x - dragOffset.x) / canvas.width))
    const newY = Math.max(0, Math.min(1, (y - dragOffset.y) / canvas.height))

    setTextBoxes(boxes => boxes.map(box =>
      box.id === draggingBoxId ? { ...box, x: newX, y: newY } : box
    ))
  }

  const handleCanvasMouseUp = () => {
    setDraggingBoxId(null)
  }

  const addTextBox = () => {
    const newId = Math.max(...textBoxes.map(b => b.id)) + 1
    setTextBoxes([...textBoxes, {
      id: newId,
      text: '',
      position: 'middle',
      x: 0.5,
      y: 0.5,
      fontSize: 50,
      fontFamily: 'Impact',
      color: '#ffffff',
      outlineColor: '#000000',
      outlineWidth: 3
    }])
    setActiveBoxId(newId)
  }

  const removeTextBox = (id) => {
    if (textBoxes.length <= 1) return
    setTextBoxes(boxes => boxes.filter(box => box.id !== id))
    if (activeBoxId === id) {
      setActiveBoxId(textBoxes[0].id)
    }
  }

  const getActiveBox = () => textBoxes.find(box => box.id === activeBoxId) || textBoxes[0]

  const filteredTemplates = templates.filter(template =>
    template.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const fetchTemplates = async () => {
    try {
      setLoading(true)
      const apiUrl = import.meta.env.VITE_API_URL || 'https://waldocoin-backend-api.onrender.com'
      const response = await fetch(`${apiUrl}/api/memeology/templates/imgflip?tier=${tier}`)
      const data = await response.json()

      // Filter out any templates with broken images
      const validTemplates = (data.memes || []).filter(template => {
        // Remove templates that commonly have CORS issues
        const brokenIds = ['252600902', '226297822', '161865971'] // Always Has Been, Panik Kalm, Marked Safe
        return !brokenIds.includes(template.id)
      })

      setTemplates(validTemplates)
      setTemplateCount(validTemplates.length)
      setUpgradeMessage(data.upgrade_message || '')
      setTierFeatures(data.features || null)
    } catch (error) {
      console.error('Error fetching templates:', error)
      // Fallback to a few guaranteed working templates
      const fallbackTemplates = [
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
          { id: '89370399', name: 'Roll Safe Think About It', url: 'https://i.imgflip.com/1h7in3.jpg' },
          { id: '93895088', name: 'Expanding Brain', url: 'https://i.imgflip.com/1jwhww.jpg' },
          { id: '124822590', name: 'Left Exit 12 Off Ramp', url: 'https://i.imgflip.com/22bdq6.jpg' },
          { id: '217743513', name: 'UNO Draw 25 Cards', url: 'https://i.imgflip.com/3lmzyx.jpg' },
          { id: '129242436', name: 'Change My Mind', url: 'https://i.imgflip.com/24y43o.jpg' },
          { id: '188390779', name: 'Woman Yelling At Cat', url: 'https://i.imgflip.com/345v97.jpg' },
          { id: '135256802', name: 'Epic Handshake', url: 'https://i.imgflip.com/28j0te.jpg' },
          { id: '80707627', name: 'Sad Pablo Escobar', url: 'https://i.imgflip.com/1c1uej.jpg' },
          { id: '91538330', name: 'X, X Everywhere', url: 'https://i.imgflip.com/1ihzfe.jpg' },
          { id: '102156234', name: 'Mocking Spongebob', url: 'https://i.imgflip.com/1otk96.jpg' },
          { id: '178591752', name: 'Tuxedo Winnie The Pooh', url: 'https://i.imgflip.com/2ybua0.jpg' },
          { id: '27813981', name: 'Hide the Pain Harold', url: 'https://i.imgflip.com/gk5el.jpg' },
          { id: '100777631', name: 'Is This A Pigeon', url: 'https://i.imgflip.com/1o00in.jpg' },
          { id: '155067746', name: 'Surprised Pikachu', url: 'https://i.imgflip.com/2kbn1e.jpg' },
          { id: '175540452', name: 'Unsettled Tom', url: 'https://i.imgflip.com/2wifvo.jpg' },
          { id: '161865971', name: 'Marked Safe From', url: 'https://i.imgflip.com/2odckz.jpg' },
          { id: '226297822', name: 'Panik Kalm Panik', url: 'https://i.imgflip.com/3qqcim.jpg' },
          { id: '252600902', name: 'Always Has Been', url: 'https://i.imgflip.com/46e43q.jpg' },
          { id: '119139145', name: 'Blank Nut Button', url: 'https://i.imgflip.com/1yxkcp.jpg' },
          { id: '148909805', name: 'Monkey Puppet', url: 'https://i.imgflip.com/2gnnjh.jpg' },
          { id: '97984', name: 'Disaster Girl', url: 'https://i.imgflip.com/23ls.jpg' },
          { id: '196652226', name: 'Spongebob Ight Imma Head Out', url: 'https://i.imgflip.com/392xtu.jpg' },
          { id: '84341851', name: 'Evil Kermit', url: 'https://i.imgflip.com/1e7ql7.jpg' },
          { id: '91545132', name: 'Trump Bill Signing', url: 'https://i.imgflip.com/1ii4oc.jpg' },
          { id: '134797956', name: 'American Chopper Argument', url: 'https://i.imgflip.com/2896ro.jpg' },
          { id: '114585149', name: 'Inhaling Seagull', url: 'https://i.imgflip.com/1w7ygt.jpg' },
          { id: '132769734', name: 'Hard To Swallow Pills', url: 'https://i.imgflip.com/271ps6.jpg' },
          { id: '110163934', name: 'I Bet Hes Thinking About Other Women', url: 'https://i.imgflip.com/1tl71a.jpg' },
          { id: '123999232', name: 'The Scroll Of Truth', url: 'https://i.imgflip.com/21tqf4.jpg' },
          { id: '99683372', name: 'Sleeping Shaq', url: 'https://i.imgflip.com/1nck6k.jpg' },
          { id: '28251713', name: 'Oprah You Get A', url: 'https://i.imgflip.com/gtj5t.jpg' },
          { id: '6235864', name: 'Finding Neverland', url: 'https://i.imgflip.com/3pnmg.jpg' },
          { id: '55311130', name: 'This Is Fine', url: 'https://i.imgflip.com/wxica.jpg' },
          { id: '3218037', name: 'This Is Where Id Put My Trophy If I Had One', url: 'https://i.imgflip.com/1wz1x.jpg' },
          { id: '922147', name: 'Laughing Men In Suits', url: 'https://i.imgflip.com/jrj7.jpg' },
          { id: '5496396', name: 'Leonardo Dicaprio Cheers', url: 'https://i.imgflip.com/39t1o.jpg' },
          { id: '14371066', name: 'Star Wars Yoda', url: 'https://i.imgflip.com/8k0sa.jpg' },
          { id: '61556', name: 'Grandma Finds The Internet', url: 'https://i.imgflip.com/1bhk.jpg' },
        ]
        setTemplates(fallbackTemplates)
        setTemplateCount(fallbackTemplates.length)

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
      const response = await fetch(`${API_URL}/api/memeology/memes/create`, {
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
    const canvas = canvasRef.current
    if (!canvas) return

    // Convert canvas to blob and download
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `meme-${Date.now()}.png`
      link.click()
      URL.revokeObjectURL(url)
    })
  }

  const shareToGallery = async () => {
    if (!user?.wallet) {
      alert('Please connect your wallet to share memes!')
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    try {
      // Convert canvas to data URL
      const memeUrl = canvas.toDataURL('image/png')

      const response = await fetch(`${API_URL}/api/memeology/community/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: user.wallet,
          memeUrl: memeUrl,
          templateName: selectedTemplate?.name || 'Custom Meme',
          caption: shareCaption
        })
      })

      const data = await response.json()

      if (data.success) {
        setShareSuccess(true)
        setShowShareModal(false)
        setShareCaption('')
        alert('🎉 Meme shared to community gallery!')
      } else {
        alert(data.error || 'Failed to share meme')
      }
    } catch (error) {
      console.error('Error sharing meme:', error)
      alert('Error sharing meme to gallery')
    }
  }

  const handleImageUpload = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    // Check if user can upload
    if (tier === 'free') {
      alert('📸 Custom uploads are not available on FREE tier. Upgrade to WALDOCOIN (1000+ WLO) or PREMIUM to upload your own images!')
      return
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG, JPG, GIF, etc.)')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size must be less than 5MB')
      return
    }

    try {
      setUploading(true)

      // Convert to base64
      const reader = new FileReader()
      reader.onload = async (e) => {
        const imageData = e.target.result

        // Upload to backend
        const response = await fetch(`${API_URL}/api/memeology/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet: user.wallet,
            imageData: imageData,
            tier: tier
          })
        })

        const data = await response.json()

        if (data.success) {
          // Use uploaded image as template
          setSelectedTemplate({
            id: `custom_${Date.now()}`,
            name: 'Custom Upload',
            url: data.imageUrl,
            isCustom: true
          })
          setUploadedImage(data.imageUrl)
          setImageLoaded(false)
          alert('✅ Image uploaded successfully!')
        } else {
          alert(data.error || data.message || 'Failed to upload image')
        }

        setUploading(false)
      }

      reader.onerror = () => {
        alert('Error reading file')
        setUploading(false)
      }

      reader.readAsDataURL(file)
    } catch (error) {
      console.error('Error uploading image:', error)
      alert('Error uploading image')
      setUploading(false)
    }
  }

  const getAISuggestion = async (boxId) => {
    if (!user?.wallet) {
      alert('Please connect your wallet to use AI suggestions!')
      return
    }

    // Check tier limits
    const limits = {
      free: 1,
      waldocoin: 10,
      premium: 999999
    }

    const dailyLimit = limits[tier] || 1

    if (aiSuggestionsToday >= dailyLimit) {
      alert(`Daily AI suggestion limit reached (${dailyLimit}/day). Upgrade to get more suggestions!`)
      return
    }

    try {
      setAiSuggesting(true)

      const response = await fetch(`${API_URL}/api/memeology/ai/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: user.wallet,
          templateName: selectedTemplate?.name || 'meme',
          position: textBoxes.find(box => box.id === boxId)?.position || 'top',
          tier: tier
        })
      })

      const data = await response.json()

      if (data.success) {
        updateTextBox(boxId, 'text', data.suggestion)
        setAiSuggestionsToday(aiSuggestionsToday + 1)
      } else {
        alert(data.error || 'Failed to get AI suggestion')
      }
    } catch (error) {
      console.error('Error getting AI suggestion:', error)
      alert('Error getting AI suggestion')
    } finally {
      setAiSuggesting(false)
    }
  }

  return (
    <div className="meme-generator">
      <div className="generator-grid">
        {/* Templates */}
        <div className="templates-panel card">
          <div className="templates-header">
            <div className="templates-title-row">
              <h2>📋 Meme Templates</h2>
              <div className="tier-info">
                <span className={`tier-badge tier-${tier}`}>
                  {tier === 'free' && '🆓 FREE'}
                  {tier === 'waldocoin' && '🪙 WALDOCOIN'}
                  {tier === 'premium' && '💎 PREMIUM'}
                </span>
                <span className="template-count">{templateCount} templates</span>
              </div>
            </div>

            {/* Tier Features */}
            {tierFeatures && (
              <div className="tier-features">
                <div className="feature-item">
                  <span className="feature-label">Memes/day:</span>
                  <span className="feature-value">{tierFeatures.memes_per_day}</span>
                </div>
                {tierFeatures.fee_per_meme !== 'none' && (
                  <div className="feature-item">
                    <span className="feature-label">Fee per meme:</span>
                    <span className="feature-value fee-highlight">{tierFeatures.fee_per_meme}</span>
                  </div>
                )}
                <div className="feature-item">
                  <span className="feature-label">AI suggestions:</span>
                  <span className="feature-value">{tierFeatures.ai_suggestions}</span>
                </div>
              </div>
            )}

            {upgradeMessage && tier !== 'premium' && (
              <div className="upgrade-banner" onClick={() => setShowTierModal(true)} style={{ cursor: 'pointer' }}>
                {upgradeMessage}
                <div style={{ fontSize: '12px', marginTop: '5px', opacity: 0.8 }}>
                  Click to compare tiers →
                </div>
              </div>
            )}
            <div className="search-box">
              <input
                type="text"
                placeholder="🔍 Search templates..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
              />

              <div className="template-actions">
                {tierFeatures?.nft_art_integration && (
                  <button
                    className="nft-browse-button"
                    onClick={() => setShowNFTModal(true)}
                  >
                    🖼️ Use My NFTs ({userNFTs.length})
                  </button>
                )}

                {tier !== 'free' && (
                  <label className="upload-button">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      style={{ display: 'none' }}
                      disabled={uploading}
                    />
                    {uploading ? '⏳ Uploading...' : '📤 Upload Image'}
                  </label>
                )}
              </div>
            </div>
          </div>
          <div className="templates-list">
            {loading ? (
              <p>Loading templates...</p>
            ) : filteredTemplates.length > 0 ? (
              filteredTemplates.map(template => (
                <div
                  key={template.id}
                  className={`template-item ${selectedTemplate?.id === template.id ? 'selected' : ''}`}
                  onClick={() => handleTemplateSelect(template)}
                >
                  <img
                    src={template.url}
                    alt={template.name}
                    onError={(e) => {
                      // Hide broken images
                      e.target.parentElement.style.display = 'none'
                    }}
                  />
                  <p>{template.name}</p>
                </div>
              ))
            ) : (
              <div className="no-results">
                <p>No templates found for "{searchQuery}"</p>
                <button className="btn-small" onClick={() => setSearchQuery('')}>Clear Search</button>
              </div>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="editor-panel card">
          <h2>✏️ Edit Meme</h2>

          {selectedTemplate ? (
            <>
              {/* Live Preview Canvas */}
              <div className="preview-box">
                <canvas
                  ref={canvasRef}
                  className="meme-canvas"
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onMouseLeave={handleCanvasMouseUp}
                  style={{ cursor: draggingBoxId ? 'grabbing' : 'grab' }}
                />
                <img
                  ref={imageRef}
                  src={selectedTemplate.url}
                  alt="template"
                  onLoad={handleImageLoad}
                  style={{ display: 'none' }}
                />
                {/* Watermark logo (hidden, used for canvas drawing) */}
                <img
                  ref={watermarkRef}
                  src="/memeology-logo.png"
                  alt="watermark"
                  style={{ display: 'none' }}
                  crossOrigin="anonymous"
                />
              </div>

              <div className="drag-hint">
                💡 <strong>Tip:</strong> Click and drag text on the image to reposition it!
              </div>

              {/* Text Boxes */}
              <div className="text-boxes-section">
                <div className="text-boxes-header">
                  <h3>📝 Text Boxes</h3>
                  <button className="btn-small" onClick={addTextBox}>+ Add Text</button>
                </div>

                {textBoxes.map((box, index) => (
                  <div
                    key={box.id}
                    className={`text-box-item ${activeBoxId === box.id ? 'active' : ''}`}
                    onClick={() => setActiveBoxId(box.id)}
                  >
                    <div className="text-box-header">
                      <span>Text {index + 1}</span>
                      {textBoxes.length > 1 && (
                        <button
                          className="btn-remove"
                          onClick={(e) => { e.stopPropagation(); removeTextBox(box.id); }}
                        >
                          ×
                        </button>
                      )}
                    </div>

                    <div className="text-input-group">
                      <input
                        type="text"
                        value={box.text}
                        onChange={(e) => updateTextBox(box.id, 'text', e.target.value)}
                        placeholder="Enter text..."
                        maxLength="100"
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        className="ai-suggest-btn"
                        onClick={(e) => { e.stopPropagation(); getAISuggestion(box.id); }}
                        disabled={aiSuggesting}
                        title="Get AI suggestion"
                      >
                        {aiSuggesting ? '⏳' : '✨ AI'}
                      </button>
                    </div>

                    {activeBoxId === box.id && (
                      <div className="text-box-controls">
                        <div className="form-group">
                          <label>Position</label>
                          <select
                            value={box.position}
                            onChange={(e) => {
                              const pos = e.target.value
                              const updates = { position: pos }
                              // Update x/y coordinates based on preset position
                              if (pos === 'top') {
                                updates.x = 0.5
                                updates.y = 0.1
                              } else if (pos === 'bottom') {
                                updates.x = 0.5
                                updates.y = 0.9
                              } else {
                                updates.x = 0.5
                                updates.y = 0.5
                              }
                              setTextBoxes(boxes => boxes.map(b =>
                                b.id === box.id ? { ...b, ...updates } : b
                              ))
                            }}
                          >
                            <option value="top">Top</option>
                            <option value="middle">Middle</option>
                            <option value="bottom">Bottom</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Font</label>
                          <select
                            value={box.fontFamily}
                            onChange={(e) => updateTextBox(box.id, 'fontFamily', e.target.value)}
                          >
                            <option value="Impact">Impact</option>
                            <option value="Arial Black">Arial Black</option>
                            <option value="Arial">Arial</option>
                            <option value="Comic Sans MS">Comic Sans MS</option>
                            <option value="Times New Roman">Times New Roman</option>
                            <option value="Courier New">Courier New</option>
                            <option value="Georgia">Georgia</option>
                          </select>
                        </div>

                        <div className="form-group">
                          <label>Size: {box.fontSize}%</label>
                          <input
                            type="range"
                            min="20"
                            max="150"
                            value={box.fontSize}
                            onChange={(e) => updateTextBox(box.id, 'fontSize', Number(e.target.value))}
                          />
                        </div>

                        <div className="form-row">
                          <div className="form-group">
                            <label>Text Color</label>
                            <input
                              type="color"
                              value={box.color}
                              onChange={(e) => updateTextBox(box.id, 'color', e.target.value)}
                            />
                          </div>

                          <div className="form-group">
                            <label>Outline</label>
                            <input
                              type="color"
                              value={box.outlineColor}
                              onChange={(e) => updateTextBox(box.id, 'outlineColor', e.target.value)}
                            />
                          </div>

                          <div className="form-group">
                            <label>Width: {box.outlineWidth}px</label>
                            <input
                              type="range"
                              min="0"
                              max="10"
                              value={box.outlineWidth}
                              onChange={(e) => updateTextBox(box.id, 'outlineWidth', Number(e.target.value))}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="meme-actions-buttons">
                <button
                  className="btn-primary"
                  onClick={downloadMeme}
                  disabled={!imageLoaded}
                >
                  ⬇️ Download Meme
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setShowShareModal(true)}
                  disabled={!imageLoaded}
                >
                  🌐 Share to Gallery
                </button>
              </div>
            </>
          ) : (
            <div className="no-template">
              <p>👈 Select a template to get started!</p>
            </div>
          )}
        </div>
      </div>

      {/* Tier Comparison Modal */}
      {showTierModal && (
        <div className="modal-overlay" onClick={() => setShowTierModal(false)}>
          <div className="tier-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowTierModal(false)}>×</button>
            <h2>🎨 Choose Your Tier</h2>

            <div className="tier-comparison">
              {/* Free Tier */}
              <div className="tier-card tier-free-card">
                <div className="tier-card-header">
                  <h3>🆓 FREE</h3>
                  <p className="tier-price">$0/month</p>
                </div>
                <ul className="tier-features-list">
                  <li>✅ 50 meme templates</li>
                  <li>✅ 10 memes per day</li>
                  <li>✅ 5 AI suggestions/day</li>
                  <li>❌ Custom fonts</li>
                  <li>❌ No watermark</li>
                  <li>💰 No fees</li>
                </ul>
                <button className="tier-button tier-button-free" disabled>Current Tier</button>
              </div>

              {/* WALDOCOIN Tier */}
              <div className="tier-card tier-waldocoin-card">
                <div className="tier-card-header">
                  <h3>🪙 WALDOCOIN</h3>
                  <p className="tier-price">Hold 1000+ WLO</p>
                </div>
                <ul className="tier-features-list">
                  <li>✅ 150 meme templates</li>
                  <li>✅ Unlimited memes/day</li>
                  <li>✅ 50 AI suggestions/day</li>
                  <li>✅ Custom fonts</li>
                  <li>✅ <strong>Use your NFTs as templates!</strong></li>
                  <li>❌ No watermark</li>
                  <li>💰 <strong>0.1 WLO per meme</strong></li>
                </ul>
                <button className="tier-button tier-button-waldocoin">
                  Get WALDOCOIN
                </button>
              </div>

              {/* Premium Tier */}
              <div className="tier-card tier-premium-card">
                <div className="tier-card-header">
                  <h3>💎 PREMIUM</h3>
                  <p className="tier-price">$5/month</p>
                  <p className="tier-payment">Pay with WLO or XRP</p>
                </div>
                <ul className="tier-features-list">
                  <li>✅ 200+ meme templates</li>
                  <li>✅ Unlimited memes/day</li>
                  <li>✅ Unlimited AI suggestions</li>
                  <li>✅ Custom fonts</li>
                  <li>✅ <strong>Use your NFTs as templates!</strong></li>
                  <li>✅ No watermark</li>
                  <li>💰 <strong>No fees!</strong></li>
                </ul>
                <button
                  className="tier-button tier-button-premium"
                  onClick={() => {
                    setShowTierModal(false)
                    setShowPremiumModal(true)
                  }}
                >
                  Upgrade to Premium
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NFT Art Browser Modal */}
      {showNFTModal && (
        <div className="modal-overlay" onClick={() => setShowNFTModal(false)}>
          <div className="nft-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowNFTModal(false)}>×</button>
            <h2>🖼️ Your NFT Collection</h2>
            <p className="nft-subtitle">Click any NFT to use it as a meme template</p>

            {userNFTs.length === 0 ? (
              <div className="no-nfts">
                <p>No NFTs found in your wallet</p>
                <p className="nft-hint">Connect your XUMM wallet to see your NFTs</p>
              </div>
            ) : (
              <div className="nft-grid">
                {userNFTs.map((nft) => (
                  <div
                    key={nft.id}
                    className="nft-item"
                    onClick={() => {
                      setSelectedTemplate({
                        id: nft.id,
                        name: nft.name,
                        url: nft.image_url,
                        isNFT: true
                      })
                      setShowNFTModal(false)
                      setImageLoaded(false)
                    }}
                  >
                    <img src={nft.image_url} alt={nft.name} />
                    <div className="nft-info">
                      <p className="nft-name">{nft.name}</p>
                      <p className="nft-collection">{nft.collection}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Premium Payment Modal */}
      <PremiumModal
        show={showPremiumModal}
        onClose={() => setShowPremiumModal(false)}
        wallet={user?.wallet}
      />

      {/* Share to Gallery Modal */}
      {showShareModal && (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="share-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowShareModal(false)}>×</button>
            <h2>🌐 Share to Community Gallery</h2>
            <p className="share-subtitle">Add a caption to your meme (optional)</p>

            <textarea
              className="caption-input"
              placeholder="Add a funny caption... (optional)"
              value={shareCaption}
              onChange={(e) => setShareCaption(e.target.value)}
              maxLength={200}
              rows={3}
            />
            <p className="char-count">{shareCaption.length}/200</p>

            <div className="share-actions">
              <button className="btn-cancel" onClick={() => setShowShareModal(false)}>
                Cancel
              </button>
              <button className="btn-share" onClick={shareToGallery}>
                🚀 Share Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MemeGenerator

