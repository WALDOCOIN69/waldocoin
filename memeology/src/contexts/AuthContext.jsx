import React, { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext()

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
      const balanceResponse = await fetch(`/api/wallet/balance?address=${walletAddress}`)
      const balanceData = await balanceResponse.json()
      
      if (balanceData.success) {
        const wlo = balanceData.wlo_balance || 0
        setWloBalance(wlo)
        
        // Check premium subscription
        const tierResponse = await fetch(`/api/user/tier?wallet=${walletAddress}`)
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
      const response = await fetch('/api/auth/xumm/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      const data = await response.json()
      
      if (data.success && data.qr_url) {
        // Open XUMM QR in new window
        window.open(data.qr_url, 'XUMM Login', 'width=400,height=600')
        
        // Poll for login completion
        const checkLogin = setInterval(async () => {
          const statusResponse = await fetch(`/api/auth/xumm/status?uuid=${data.uuid}`)
          const statusData = await statusResponse.json()
          
          if (statusData.success && statusData.signed) {
            clearInterval(checkLogin)
            
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
            alert('Login rejected')
          }
        }, 2000)
        
        // Timeout after 5 minutes
        setTimeout(() => clearInterval(checkLogin), 300000)
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

  const value = {
    user,
    tier,
    wloBalance,
    loading,
    loginWithXUMM,
    logout,
    checkUserTier
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

