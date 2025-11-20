import React, { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext()

// Get API URL from environment variable
const API_URL = import.meta.env.VITE_API_URL || 'https://waldocoin-backend-api.onrender.com'

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [tier, setTier] = useState('free')
  const [loading, setLoading] = useState(true)
  const [wloBalance, setWloBalance] = useState(0)
  const [showQRModal, setShowQRModal] = useState(false)
  const [qrData, setQrData] = useState(null)

  // Load user from localStorage on mount
  useEffect(() => {
    const loadUser = async () => {
      try {
        const savedUser = localStorage.getItem('memeology_user')
        const savedTier = localStorage.getItem('memeology_tier')
        
        if (savedUser) {
          const userData = JSON.parse(savedUser)
          setUser(userData)
          setTier(savedTier || 'free')
          
          // Check tier status
          if (userData.wallet) {
            await checkUserTier(userData.wallet)
          }
        }
      } catch (error) {
        console.error('Error loading user:', error)
      } finally {
        setLoading(false)
      }
    }
    
    loadUser()
  }, [])

  const checkUserTier = async (walletAddress) => {
    try {
      // Check WLO balance
      const balanceResponse = await fetch(`${API_URL}/api/memeology/wallet/balance?wallet=${walletAddress}`)
      const balanceData = await balanceResponse.json()

      if (balanceData.wloBalance !== undefined) {
        const wlo = balanceData.wloBalance || 0
        setWloBalance(wlo)

        // Check premium subscription
        const tierResponse = await fetch(`${API_URL}/api/memeology/user/tier?wallet=${walletAddress}`)
        const tierData = await tierResponse.json()
        
        let userTier = 'free'
        
        if (tierData.tier === 'premium') {
          userTier = 'premium'
        } else if (wlo >= 1000) {
          userTier = 'waldocoin'
        }
        
        setTier(userTier)
        localStorage.setItem('memeology_tier', userTier)
        
        return userTier
      }
    } catch (error) {
      console.error('Error checking tier:', error)
      return 'free'
    }
  }

  const loginWithXUMM = async () => {
    try {
      // Request XUMM login from backend
      const response = await fetch(`${API_URL}/api/auth/xumm/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      const data = await response.json()

      if (data.success && data.qr_url) {
        // Show QR modal on same page
        setQrData({
          qr_url: data.qr_url,
          qr_uri: data.qr_uri,
          uuid: data.uuid
        })
        setShowQRModal(true)

        // Poll for login completion
        const checkLogin = setInterval(async () => {
          const statusResponse = await fetch(`${API_URL}/api/auth/xumm/status?uuid=${data.uuid}`)
          const statusData = await statusResponse.json()

          if (statusData.success && statusData.signed) {
            clearInterval(checkLogin)
            setShowQRModal(false)

            const userData = {
              wallet: statusData.account,
              name: `User ${statusData.account.slice(0, 8)}...`,
              loggedIn: true
            }

            setUser(userData)
            localStorage.setItem('memeology_user', JSON.stringify(userData))

            // Check tier
            await checkUserTier(statusData.account)
          } else if (statusData.rejected) {
            clearInterval(checkLogin)
            setShowQRModal(false)
            alert('Login rejected')
          }
        }, 2000)

        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(checkLogin)
          setShowQRModal(false)
        }, 300000)
      }
    } catch (error) {
      console.error('XUMM login error:', error)
      alert('Login failed. Please try again.')
    }
  }

  const logout = () => {
    setUser(null)
    setTier('free')
    setWloBalance(0)
    localStorage.removeItem('memeology_user')
    localStorage.removeItem('memeology_tier')
  }

  const closeQRModal = () => {
    setShowQRModal(false)
    setQrData(null)
  }

  const value = {
    user,
    tier,
    wloBalance,
    loading,
    loginWithXUMM,
    logout,
    checkUserTier,
    showQRModal,
    qrData,
    closeQRModal
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      {showQRModal && qrData && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #0a0c1a 0%, #0b0f23 100%)',
            padding: '30px',
            borderRadius: '20px',
            border: '2px solid #00f7ff',
            boxShadow: '0 0 30px rgba(0, 247, 255, 0.3)',
            textAlign: 'center',
            maxWidth: '400px',
            position: 'relative'
          }}>
            <button
              onClick={closeQRModal}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                background: 'transparent',
                border: 'none',
                color: '#00f7ff',
                fontSize: '24px',
                cursor: 'pointer',
                padding: '5px 10px'
              }}
            >
              ✕
            </button>
            <h2 style={{ color: '#00f7ff', marginBottom: '20px' }}>🔐 Login with Xaman</h2>
            <img
              src={qrData.qr_url}
              alt="XUMM QR Code"
              style={{
                width: '300px',
                height: '300px',
                border: '3px solid #00f7ff',
                borderRadius: '10px',
                marginBottom: '20px'
              }}
            />
            <p style={{ color: '#eafff9', marginBottom: '10px' }}>
              Scan with Xaman app to login
            </p>
            <a
              href={qrData.qr_uri}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-block',
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #ff3df7 0%, #00f7ff 100%)',
                color: '#fff',
                textDecoration: 'none',
                borderRadius: '10px',
                fontWeight: 'bold',
                marginTop: '10px'
              }}
            >
              📱 Open in Xaman App
            </a>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  )
}

