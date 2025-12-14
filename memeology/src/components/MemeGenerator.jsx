import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { parseGIF, decompressFrames } from 'gifuct-js'
import './MemeGenerator.css'
import PremiumModal from './PremiumModal'

// Get API URL from environment variable
const API_URL = import.meta.env.VITE_API_URL || 'https://waldocoin-backend-api.onrender.com'

function MemeGenerator({ initialTemplate = null, onTemplateConsumed }) {
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
	  const [showGIFModal, setShowGIFModal] = useState(false)
	  const [gifSearch, setGifSearch] = useState('')
	  const [gifResults, setGifResults] = useState([])
	  const [loadingGifs, setLoadingGifs] = useState(false)
	  const [lastSharedMemeUrl, setLastSharedMemeUrl] = useState(null)
	  const [exportingVideo, setExportingVideo] = useState(false)
	  const [videoProgress, setVideoProgress] = useState(0)
	  const [showSubmitModal, setShowSubmitModal] = useState(false)
	  const [submitTemplateName, setSubmitTemplateName] = useState('')
	  const [submitTemplateImage, setSubmitTemplateImage] = useState(null)
	  const [submittingTemplate, setSubmittingTemplate] = useState(false)
	  const [creatorStats, setCreatorStats] = useState(null)

  // Multiple text boxes
  const [textBoxes, setTextBoxes] = useState([
    { id: 1, text: '', position: 'top', x: 0.5, y: 0.1, fontSize: 50, fontFamily: 'Impact', color: '#ffffff', outlineColor: '#000000', outlineWidth: 3 },
    { id: 2, text: '', position: 'bottom', x: 0.5, y: 0.9, fontSize: 50, fontFamily: 'Impact', color: '#ffffff', outlineColor: '#000000', outlineWidth: 3 }
  ])
  const [activeBoxId, setActiveBoxId] = useState(1)
  const [draggingBoxId, setDraggingBoxId] = useState(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [enlargedImage, setEnlargedImage] = useState(null) // For image modal

  const canvasRef = useRef(null)
  const imageRef = useRef(null)
  const watermarkRef = useRef(null)

  useEffect(() => {
    fetchTemplates()
    // Only premium+ tiers (not free or waldocoin) get NFT images
    const premiumTiers = ['premium', 'gold', 'platinum', 'king']
    if (user && premiumTiers.includes(tier)) {
      fetchUserNFTs()
    }
    // Creator stats for paid tiers (waldocoin and above)
    if (user && tier !== 'free') {
      fetchCreatorStats()
    }
  }, [tier])

	// On mobile, disable page scrolling while the user is dragging a text box
	// so the image doesn't slide up/down when you try to move text.
	useEffect(() => {
		if (!draggingBoxId) return

		const originalOverflow = document.body.style.overflow
		document.body.style.overflow = 'hidden'

		return () => {
			document.body.style.overflow = originalOverflow
		}
	}, [draggingBoxId])

	// If a template is passed in from elsewhere (e.g. AI Image mode), load it once
	useEffect(() => {
		if (initialTemplate && initialTemplate.url) {
			// Reuse the normal selection logic so text boxes reset properly
			handleTemplateSelect(initialTemplate)
			if (onTemplateConsumed) {
				onTemplateConsumed()
			}
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialTemplate])

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

  const fetchCreatorStats = async () => {
    if (!user?.wallet) return

    try {
      const response = await fetch(`${API_URL}/api/memeology/templates/submissions?wallet=${user.wallet}`)
      const data = await response.json()
      if (data.success) {
        setCreatorStats(data)
      }
    } catch (error) {
      console.error('Error fetching creator stats:', error)
    }
  }

  const handleTemplateImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      alert('Image too large. Max size is 5MB.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      setSubmitTemplateImage(reader.result)
    }
    reader.readAsDataURL(file)
  }

  const submitTemplate = async () => {
    if (!submitTemplateName.trim() || !submitTemplateImage) {
      alert('Please provide a template name and image')
      return
    }

    try {
      setSubmittingTemplate(true)

      const response = await fetch(`${API_URL}/api/memeology/templates/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: user.wallet,
          imageData: submitTemplateImage,
          name: submitTemplateName.trim(),
          categories: ['community']
        })
      })

      const data = await response.json()

      if (data.success) {
        alert(`🎉 Template submitted! You'll earn 100 WLO each time someone uses it once approved. (${data.submissionsRemaining} submissions left this month)`)
        setShowSubmitModal(false)
        setSubmitTemplateName('')
        setSubmitTemplateImage(null)
        fetchCreatorStats()
      } else {
        alert(data.error || 'Failed to submit template')
      }
    } catch (error) {
      console.error('Error submitting template:', error)
      alert('Error submitting template')
    } finally {
      setSubmittingTemplate(false)
    }
  }

	  // Draw meme on canvas whenever text or template changes
	  useEffect(() => {
	    if (selectedTemplate && imageLoaded) {
	      drawMeme()
	    }
	  }, [textBoxes, selectedTemplate, imageLoaded])
	
	  const renderMemeToCanvas = (canvas, { showSelection = true } = {}) => {
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
	
	      // Draw selection indicator around the active box only in editor mode
	      if (showSelection && box.id === activeBoxId && box.text) {
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
		        // WALDOCOIN tier gets "WALDOCOIN" text watermark (slightly smaller so it doesn't block text)
		        const fontSize = Math.min(canvas.width, canvas.height) * 0.035 // 3.5% of smallest dimension
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
		        // FREE tier gets Memeology logo watermark (smaller so it doesn't cover captions)
		        const watermarkSize = Math.min(canvas.width, canvas.height) * 0.08 // 8% of smallest dimension
	        const x = canvas.width - watermarkSize - padding
	        const y = canvas.height - watermarkSize - padding
	
		        // Draw semi-transparent watermark (slightly lighter)
		        ctx.globalAlpha = 0.7
	        ctx.drawImage(watermarkRef.current, x, y, watermarkSize, watermarkSize)
	        ctx.globalAlpha = 1.0
	      }
	    }
	  }

	  const drawMeme = () => {
	    const canvas = canvasRef.current
	    if (!canvas) return
	    renderMemeToCanvas(canvas, { showSelection: true })
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

	    // Support both mouse and touch events
	    let clientX
	    let clientY
	    if (e.touches && e.touches.length > 0) {
	      clientX = e.touches[0].clientX
	      clientY = e.touches[0].clientY
	    } else if (e.changedTouches && e.changedTouches.length > 0) {
	      clientX = e.changedTouches[0].clientX
	      clientY = e.changedTouches[0].clientY
	    } else {
	      clientX = e.clientX
	      clientY = e.clientY
	    }

	    return {
	      x: (clientX - rect.left) * scaleX,
	      y: (clientY - rect.top) * scaleY
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
	    // Prevent page scroll on touch drag
	    if (e.touches) e.preventDefault()

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
	    // Prevent page scroll on touch drag
	    if (e.touches) e.preventDefault()

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

	      // Fetch both standard and custom templates in parallel
	      const [standardRes, customRes] = await Promise.all([
	        fetch(`${apiUrl}/api/memeology/templates/imgflip?tier=${tier}`),
	        fetch(`${apiUrl}/api/memeology/templates/custom?tier=${tier}`)
	      ])

	      const standardData = await standardRes.json()
	      let customData = { templates: [] }
	      try {
	        customData = await customRes.json()
	      } catch (e) {
	        console.log('No custom templates available')
	      }

	      // Standard templates from backend
	      const standardTemplates = standardData.memes || []

	      // Custom templates (from admin uploads) - add isCustom flag
	      const customTemplates = (customData.templates || []).map(t => ({
	        ...t,
	        isCustom: true
	      }))

	      // Merge: custom templates first, then standard
	      const allTemplates = [...customTemplates, ...standardTemplates]

	      setTemplates(allTemplates)
	      setTemplateCount(allTemplates.length)
        setUpgradeMessage(standardData.upgrade_message || '')
        setTierFeatures(standardData.features || null)
      } catch (error) {
        console.error('Error fetching templates:', error)
        // Fallback templates - use proxy URLs to avoid CORS issues on download
        const apiUrl = import.meta.env.VITE_API_URL || 'https://waldocoin-backend-api.onrender.com'
        const proxyBase = `${apiUrl}/api/memeology/templates/proxy?url=`
        const fallbackTemplates = [
          { id: '181913649', name: 'Drake Hotline Bling', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/30b1gx.jpg')}` },
          { id: '87743020', name: 'Two Buttons', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/1g8my4.jpg')}` },
          { id: '112126428', name: 'Distracted Boyfriend', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/1ur9b0.jpg')}` },
          { id: '131087935', name: 'Running Away Balloon', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/261o3j.jpg')}` },
          { id: '4087833', name: 'Waiting Skeleton', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/2fm6x.jpg')}` },
          { id: '101470', name: 'Ancient Aliens', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/26am.jpg')}` },
          { id: '438680', name: 'Batman Slapping Robin', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/9ehk.jpg')}` },
          { id: '21735', name: 'The Rock Driving', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/grr.jpg')}` },
          { id: '563423', name: 'That Would Be Great', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/c2qn.jpg')}` },
          { id: '61579', name: 'One Does Not Simply', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/1bij.jpg')}` },
          { id: '6235864', name: 'Finding Neverland', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/3pnmg.jpg')}` },
          { id: '55311130', name: 'This Is Fine', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/wxica.jpg')}` },
          { id: '3218037', name: 'This Is Where Id Put My Trophy If I Had One', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/1wz1x.jpg')}` },
          { id: '922147', name: 'Laughing Men In Suits', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/jrj7.jpg')}` },
          { id: '5496396', name: 'Leonardo Dicaprio Cheers', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/39t1o.jpg')}` },
          { id: '14371066', name: 'Star Wars Yoda', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/8k0sa.jpg')}` },
          { id: '61556', name: 'Grandma Finds The Internet', url: `${proxyBase}${encodeURIComponent('https://i.imgflip.com/1bhk.jpg')}` },
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

  // Expand the meme to full-screen modal view
  const expandMeme = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Create a clean version without selection box for the modal
    const exportCanvas = document.createElement('canvas')
    renderMemeToCanvas(exportCanvas, { showSelection: false })

    try {
      const dataUrl = exportCanvas.toDataURL('image/png')
      setEnlargedImage(dataUrl)
    } catch (err) {
      console.error('Failed to expand meme:', err)
    }
  }

	const downloadMeme = () => {
	  const image = imageRef.current
	  if (!image) return

	  // Simple confirmation so users on mobile understand what will happen.
	  const ok = window.confirm(
	    'Download this meme to your device? On some phones your browser will open the image so you can long‑press to save it.'
	  )
	  if (!ok) return

	  // Render a clean copy of the meme (without the drag selection box)
	  // to an off-screen canvas so the saved image has no editor UI.
	  const exportCanvas = document.createElement('canvas')
	  renderMemeToCanvas(exportCanvas, { showSelection: false })

	  const isIOS = /iP(hone|ad|od)/i.test(window.navigator.userAgent || '')

	  if (isIOS) {
	    // On iPhone/iPad, open the image directly so the user can long‑press and
	    // "Save Image" into their Photos / Gallery. This must be synchronous
	    // with the tap to avoid popup blockers.
	    try {
	      const dataUrl = exportCanvas.toDataURL('image/png')
	      const win = window.open(dataUrl, '_blank')
	      if (!win) {
	        // Fallback: navigate current tab
	        window.location.href = dataUrl
	      }
	    } catch (err) {
	      console.error('iOS open failed:', err)
	      alert('Unable to open image on this device. Try taking a screenshot as a backup.')
	    }
	    return
	  }

	  // Helper for older browsers or when Blob creation fails
	  const downloadFromDataUrl = () => {
	    try {
	      const dataUrl = exportCanvas.toDataURL('image/png')
	      const link = document.createElement('a')
	      link.href = dataUrl
	      link.download = `meme-${Date.now()}.png`
	      document.body.appendChild(link)
	      link.click()
	      document.body.removeChild(link)
	    } catch (err) {
	      console.error('Download fallback failed:', err)
	      alert('Unable to download image on this device. Try long‑pressing and saving the image instead.')
	    }
	  }

	  // Other devices: prefer Blob when available, fall back to data URL
	  if (!exportCanvas.toBlob) {
	    downloadFromDataUrl()
	    return
	  }

	  try {
	    exportCanvas.toBlob((blob) => {
	      try {
	        if (!blob) {
	          downloadFromDataUrl()
	          return
	        }

	        const url = URL.createObjectURL(blob)
	        const link = document.createElement('a')
	        link.href = url
	        link.download = `meme-${Date.now()}.png`
	        document.body.appendChild(link)
	        link.click()
	        document.body.removeChild(link)
	        setTimeout(() => URL.revokeObjectURL(url), 1500)
	      } catch (err) {
	        console.error('Download failed:', err)
	        alert('Unable to download image on this device. Try long‑pressing and saving the image instead.')
	      }
	    })
	  } catch (err) {
	    console.error('Download failed:', err)
	    downloadFromDataUrl()
	  }
	}

  // Export GIF meme as video (premium feature)
  const exportAsVideo = async () => {
    if (!selectedTemplate?.isGIF) {
      alert('Video export is only available for GIF templates')
      return
    }

    if (tier === 'free') {
      alert('🎬 Video export is a premium feature. Upgrade to WALDOCOIN tier or higher!')
      return
    }

    try {
      setExportingVideo(true)
      setVideoProgress(0)

      // Fetch the GIF
      const response = await fetch(selectedTemplate.url)
      const buffer = await response.arrayBuffer()

      // Parse GIF frames
      const gif = parseGIF(buffer)
      const frames = decompressFrames(gif, true)

      if (!frames || frames.length === 0) {
        throw new Error('Could not parse GIF frames')
      }

      // Create canvas for video
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = frames[0].dims.width
      canvas.height = frames[0].dims.height

      // Create MediaRecorder
      const stream = canvas.captureStream(30) // 30 FPS
      const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9'
      })

      const chunks = []
      recorder.ondataavailable = (e) => chunks.push(e.data)

      const videoPromise = new Promise((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' })
          resolve(blob)
        }
      })

      recorder.start()

      // Render each frame with text overlay
      const tempCanvas = document.createElement('canvas')
      const tempCtx = tempCanvas.getContext('2d')
      let frameImageData = ctx.createImageData(canvas.width, canvas.height)

      for (let i = 0; i < frames.length; i++) {
        const frame = frames[i]
        setVideoProgress(Math.round((i / frames.length) * 100))

        // Draw frame to temp canvas
        tempCanvas.width = frame.dims.width
        tempCanvas.height = frame.dims.height

        // Create image data from frame patch
        const patchData = tempCtx.createImageData(frame.dims.width, frame.dims.height)
        patchData.data.set(frame.patch)
        tempCtx.putImageData(patchData, 0, 0)

        // Composite frame onto main canvas
        if (frame.disposalType === 2) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
        ctx.drawImage(tempCanvas, frame.dims.left, frame.dims.top)

        // Draw text overlays
        drawTextOnCanvas(ctx, canvas.width, canvas.height)

        // Wait for frame delay
        const delay = frame.delay || 100
        await new Promise(r => setTimeout(r, delay))
      }

      // Loop the GIF 3 times for video
      for (let loop = 0; loop < 2; loop++) {
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i]
          setVideoProgress(Math.round(((loop + 1) * frames.length + i) / (frames.length * 3) * 100))

          tempCanvas.width = frame.dims.width
          tempCanvas.height = frame.dims.height
          const patchData = tempCtx.createImageData(frame.dims.width, frame.dims.height)
          patchData.data.set(frame.patch)
          tempCtx.putImageData(patchData, 0, 0)

          if (frame.disposalType === 2) {
            ctx.clearRect(0, 0, canvas.width, canvas.height)
          }
          ctx.drawImage(tempCanvas, frame.dims.left, frame.dims.top)
          drawTextOnCanvas(ctx, canvas.width, canvas.height)

          const delay = frame.delay || 100
          await new Promise(r => setTimeout(r, delay))
        }
      }

      recorder.stop()
      const videoBlob = await videoPromise

      // Download video
      const url = URL.createObjectURL(videoBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `meme-${Date.now()}.webm`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 1500)

      setVideoProgress(100)
      alert('🎬 Video exported successfully!')

    } catch (error) {
      console.error('Error exporting video:', error)
      alert('Failed to export video: ' + error.message)
    } finally {
      setExportingVideo(false)
      setVideoProgress(0)
    }
  }

  // Helper to draw text on canvas (for video export)
  const drawTextOnCanvas = (ctx, width, height) => {
    textBoxes.forEach(box => {
      if (!box.text) return

      const scaledFontSize = (box.fontSize / 100) * (width / 10)
      ctx.font = `bold ${scaledFontSize}px ${box.fontFamily}, Arial Black, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      const lines = box.text.toUpperCase().split('\n')
      const lineHeight = scaledFontSize * 1.1
      const centerX = box.x * width
      const centerY = box.y * height

      lines.forEach((line, idx) => {
        const y = centerY + (idx - (lines.length - 1) / 2) * lineHeight

        // Draw outline
        ctx.strokeStyle = box.outlineColor
        ctx.lineWidth = box.outlineWidth * 2
        ctx.lineJoin = 'round'
        ctx.strokeText(line, centerX, y)

        // Draw fill
        ctx.fillStyle = box.color
        ctx.fillText(line, centerX, y)
      })
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
	        // If backend provided a per-meme public URL, remember it so
	        // the Share on X button can deep-link to this exact meme.
	        if (data.meme && data.meme.publicUrl) {
	          setLastSharedMemeUrl(data.meme.publicUrl)
	        }
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

		  const shareOnX = () => {
		    const url = lastSharedMemeUrl || 'https://memeology.fun'
		    const text = `Made this on #WaldoMeme\n${url}`
		    const tweetUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`
		    try {
		      window.open(tweetUrl, '_blank', 'noopener,noreferrer')
		    } catch (err) {
		      console.error('Error opening X share window:', err)
		      alert('Unable to open X (Twitter). Please check your popup blocker and try again.')
		    }
		  }

  const handleImageUpload = async (event) => {
    const file = event.target.files[0]
    if (!file) return

    // All tiers can now upload custom images!

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
    // Free tier gets 10 AI suggestions per month
    if (tier === 'free' && aiSuggestionsToday >= 10) {
      alert('🤖 You\'ve used all 10 AI suggestions this month. Hold 1000+ WLO for unlimited AI!')
      return
    }

    // WALDOCOIN and above get unlimited AI

    try {
      setAiSuggesting(true)

      const response = await fetch(`${API_URL}/api/memeology/ai/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet: user?.wallet || 'anonymous',
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

  const searchGIFs = async () => {
    if (!gifSearch.trim()) {
      alert('Please enter a search term')
      return
    }

    // GIFs only for premium+ tiers (not free or waldocoin)
    if (tier === 'free' || tier === 'waldocoin') {
      alert('🎬 GIF templates are a PREMIUM feature. Subscribe to Premium ($5/mo) or collect 3+ NFTs!')
      return
    }

    try {
      setLoadingGifs(true)

      const response = await fetch(`${API_URL}/api/memeology/gifs/search?q=${encodeURIComponent(gifSearch)}`)
      const data = await response.json()

      if (data.success) {
        setGifResults(data.gifs)
      } else {
        alert(data.error || 'Failed to search GIFs')
      }
    } catch (error) {
      console.error('Error searching GIFs:', error)
      alert('Error searching GIFs')
    } finally {
      setLoadingGifs(false)
    }
  }

  const selectGIF = (gif) => {
    setSelectedTemplate({
      id: `gif_${gif.id}`,
      name: gif.title || 'GIF Template',
      url: gif.url,
      isGIF: true
    })
    setShowGIFModal(false)
    setImageLoaded(false)
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
                {/* NFT images - only for premium+ tiers (not waldocoin) */}
                {tierFeatures?.nft_art_integration && (
                  <button
                    className="nft-browse-button"
                    onClick={() => setShowNFTModal(true)}
                  >
                    🖼️ Use My NFTs ({userNFTs.length})
                  </button>
                )}

                {/* GIFs - only for premium+ tiers (not waldocoin or free) */}
                {tierFeatures?.gif_templates !== 'none' && (
                  <button
                    className="gif-browse-button"
                    onClick={() => setShowGIFModal(true)}
                  >
                    🎬 Browse GIFs
                  </button>
                )}

                {/* Template submission - for paid tiers */}
                {tier !== 'free' && (
                  <button
                    className="submit-template-button"
                    onClick={() => setShowSubmitModal(true)}
                  >
                    📤 Submit Template
                  </button>
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
	                    crossOrigin="anonymous"
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
	                  onTouchStart={handleCanvasMouseDown}
	                  onTouchMove={handleCanvasMouseMove}
	                  onTouchEnd={handleCanvasMouseUp}
	                  onTouchCancel={handleCanvasMouseUp}
                  style={{ cursor: draggingBoxId ? 'grabbing' : 'grab' }}
                />
                <button
                  className="expand-button"
                  onClick={expandMeme}
                  title="View full size"
                >
                  🔍
                </button>
                <img
                  ref={imageRef}
                  src={selectedTemplate.url}
                  alt="template"
	                  crossOrigin="anonymous"
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
                {selectedTemplate?.isGIF && tier !== 'free' && (
                  <button
                    className="btn-primary video-export-btn"
                    onClick={exportAsVideo}
                    disabled={!imageLoaded || exportingVideo}
                  >
                    {exportingVideo ? `🎬 Exporting... ${videoProgress}%` : '🎬 Export Video'}
                  </button>
                )}
                <button
                  className="btn-secondary"
                  onClick={() => setShowShareModal(true)}
                  disabled={!imageLoaded}
                >
                  🌐 Share to Gallery
                </button>
	                <button
	                  className="btn-secondary"
	                  onClick={shareOnX}
	                >
	                  🐦 Share on X (#WaldoMeme)
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
                  <li>✅ 100 meme templates</li>
                  <li>✅ Unlimited memes/day</li>
                  <li>✅ Custom fonts</li>
                  <li>⚠️ 10 AI suggestions/month</li>
                  <li>❌ GIF templates</li>
                  <li>❌ Use NFT images</li>
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
                  <li>✅ <strong>380+ meme templates</strong></li>
                  <li>✅ Unlimited memes/day</li>
                  <li>✅ <strong>Unlimited AI suggestions</strong></li>
                  <li>✅ Custom fonts</li>
                  <li>❌ GIF templates</li>
                  <li>❌ Use NFT images</li>
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
                  <li>✅ <strong>380+ meme templates</strong></li>
                  <li>✅ Unlimited memes/day</li>
                  <li>✅ <strong>Unlimited AI suggestions</strong></li>
                  <li>✅ Custom fonts</li>
                  <li>✅ <strong>GIF templates</strong></li>
                  <li>✅ <strong>Use your NFT images!</strong></li>
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

      {/* GIF Browser Modal */}
      {showGIFModal && (
        <div className="modal-overlay" onClick={() => setShowGIFModal(false)}>
          <div className="gif-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowGIFModal(false)}>×</button>
            <h2>🎬 Browse GIF Templates</h2>

            <div className="gif-search-box">
              <input
                type="text"
                placeholder="Search for GIFs... (e.g., 'funny cat', 'reaction')"
                value={gifSearch}
                onChange={(e) => setGifSearch(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && searchGIFs()}
              />
              <button onClick={searchGIFs} disabled={loadingGifs}>
                {loadingGifs ? '⏳ Searching...' : '🔍 Search'}
              </button>
            </div>

            {loadingGifs && (
              <div className="loading-spinner">
                <div className="spinner"></div>
                <p>Searching GIFs...</p>
              </div>
            )}

            {gifResults.length > 0 && (
              <div className="gif-grid">
                {gifResults.map((gif) => (
                  <div
                    key={gif.id}
                    className="gif-item"
                    onClick={() => selectGIF(gif)}
                  >
                    <img src={gif.url} alt={gif.title} />
                    <p className="gif-title">{gif.title}</p>
                  </div>
                ))}
              </div>
            )}

            {!loadingGifs && gifResults.length === 0 && gifSearch && (
              <div className="empty-state">
                <p>No GIFs found. Try a different search term!</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Image Enlargement Modal */}
      {enlargedImage && (
        <div className="image-modal" onClick={() => setEnlargedImage(null)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setEnlargedImage(null)}>✕</button>
            <div className="enlarged-image-container">
              <img src={enlargedImage} alt="Enlarged meme" className="enlarged-image" />
            </div>
          </div>
        </div>
      )}

      {/* Submit Template Modal */}
      {showSubmitModal && (
        <div className="modal-overlay" onClick={() => setShowSubmitModal(false)}>
          <div className="submit-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowSubmitModal(false)}>×</button>
            <h2>📤 Submit Your Template</h2>
            <p className="submit-subtitle">
              Premium members can submit up to 3 templates per month.<br/>
              Earn <strong>100 WLO</strong> each time someone uses your template!
            </p>

            {creatorStats && (
              <div className="creator-stats">
                <div className="stat-item">
                  <span className="stat-value">{creatorStats.submissionsRemaining}/3</span>
                  <span className="stat-label">Submissions Left</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{creatorStats.pending?.length || 0}</span>
                  <span className="stat-label">Pending Review</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{creatorStats.approved?.length || 0}</span>
                  <span className="stat-label">Approved</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">{creatorStats.totalEarnings || 0} WLO</span>
                  <span className="stat-label">Total Earned</span>
                </div>
              </div>
            )}

            <div className="submit-form">
              <div className="form-group">
                <label>Template Name</label>
                <input
                  type="text"
                  placeholder="e.g., 'Surprised Cat', 'Thumbs Up Guy'"
                  value={submitTemplateName}
                  onChange={(e) => setSubmitTemplateName(e.target.value)}
                  maxLength={50}
                />
              </div>

              <div className="form-group">
                <label>Template Image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleTemplateImageUpload}
                />
                <p className="form-hint">Max 5MB. JPG, PNG, or GIF.</p>
              </div>

              {submitTemplateImage && (
                <div className="preview-upload">
                  <img src={submitTemplateImage} alt="Preview" />
                </div>
              )}

              <button
                className="btn-primary submit-btn"
                onClick={submitTemplate}
                disabled={submittingTemplate || !submitTemplateName.trim() || !submitTemplateImage}
              >
                {submittingTemplate ? '⏳ Submitting...' : '📤 Submit for Review'}
              </button>

              <p className="submit-note">
                ⚠️ Templates are reviewed by admins before appearing in the gallery.
                Inappropriate content will be rejected.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MemeGenerator

