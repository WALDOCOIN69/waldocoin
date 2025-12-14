import React, { useState, useEffect } from 'react'
import './PremiumModal.css'

const API_URL = import.meta.env.VITE_API_URL || 'https://waldocoin-backend-api.onrender.com'

function PremiumModal({ show, onClose, wallet }) {
  const [pricing, setPricing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedDuration, setSelectedDuration] = useState('monthly')
  const [selectedPayment, setSelectedPayment] = useState('xrp')
  const [processing, setProcessing] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [xummQrCode, setXummQrCode] = useState(null)
  const [xummPayloadId, setXummPayloadId] = useState(null)
  const [xummDeepLink, setXummDeepLink] = useState(null)

  // Detect mobile device
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  useEffect(() => {
    if (show) {
      fetchPricing()
    }
  }, [show])

  const fetchPricing = async () => {
    try {
      setLoading(true)
      const response = await fetch(`${API_URL}/api/memeology/premium/pricing`)
      const data = await response.json()
      
      if (data.success) {
        setPricing(data.pricing)
      }
    } catch (error) {
      console.error('Error fetching pricing:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubscribeClick = () => {
    if (!wallet) {
      alert('Please connect your wallet first')
      return
    }
    // Show confirmation popup
    setShowConfirmation(true)
  }

  const handleConfirmSubscribe = async () => {
    setShowConfirmation(false)

    try {
      setProcessing(true)

      const currentPricing = pricing[selectedDuration]
      const amount = selectedPayment === 'xrp' ? currentPricing.xrp : currentPricing.wlo

      // Create XUMM payment request
      // Premium payments go to Treasury Wallet (revenue collection)
      const TREASURY_WALLET = 'r9ZKBDvtQbdv5v6i6vtP5RK2yYGZnyyk4K'
      const WALDO_ISSUER = 'rstjAWDiqKsUMhHqiJShRSkuaZ44TXZyDY'

      const paymentPayload = {
        TransactionType: 'Payment',
        Destination: TREASURY_WALLET,
        Amount: selectedPayment === 'xrp'
          ? String(Math.floor(amount * 1000000)) // XRP in drops
          : {
              currency: 'WLO',
              value: String(amount),
              issuer: WALDO_ISSUER
            },
        DestinationTag: 888, // Tag for premium subscriptions
        Memos: [{
          Memo: {
            MemoType: Buffer.from('PREMIUM_SUB', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from(`${selectedDuration}_${selectedPayment}`, 'utf8').toString('hex').toUpperCase()
          }
        }]
      }

      // Request XUMM signature
      const xummResponse = await fetch(`${API_URL}/api/auth/xumm/create-payload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txjson: paymentPayload,
          options: {
            submit: true,
            return_url: {
              web: window.location.href
            }
          }
        })
      })

      const xummData = await xummResponse.json()

      if (!xummData.success) {
        throw new Error('Failed to create payment request')
      }

      // Show QR code (desktop) or deep link (mobile)
      setXummQrCode(xummData.refs.qr_png)
      setXummPayloadId(xummData.uuid)
      setXummDeepLink(xummData.refs.qr_uri)

      // On mobile, automatically open Xaman app
      if (isMobile && xummData.refs.qr_uri) {
        window.location.href = xummData.refs.qr_uri
      }

      // Poll for payment confirmation
      const checkPayment = setInterval(async () => {
        const statusResponse = await fetch(`${API_URL}/api/auth/xumm/payload/${xummData.uuid}`)
        const statusData = await statusResponse.json()

        if (statusData.meta.signed) {
          clearInterval(checkPayment)

          // Hide QR code / deep link
          setXummQrCode(null)
          setXummPayloadId(null)
          setXummDeepLink(null)

          if (statusData.meta.resolved) {
            // Payment successful, activate premium
            const txHash = statusData.response.txid

            const subscribeResponse = await fetch(`${API_URL}/api/memeology/premium/subscribe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                wallet,
                paymentMethod: selectedPayment,
                duration: selectedDuration,
                txHash
              })
            })

            const subscribeData = await subscribeResponse.json()

            if (subscribeData.success) {
              alert(`✅ ${subscribeData.message}\n\nExpires: ${new Date(subscribeData.subscription.expiresAt).toLocaleDateString()}\nDays remaining: ${subscribeData.subscription.daysRemaining}`)
              window.location.reload() // Refresh to update tier
            } else {
              alert('❌ Subscription activation failed. Please contact support.')
            }
          } else {
            alert('❌ Payment was rejected or failed.')
          }

          setProcessing(false)
        }
      }, 2000)

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(checkPayment)
        setXummQrCode(null)
        setXummPayloadId(null)
        setXummDeepLink(null)
        setProcessing(false)
        alert('⏱️ Payment request timed out. Please try again.')
      }, 300000)

    } catch (error) {
      console.error('Error subscribing:', error)
      alert('❌ Error processing subscription: ' + error.message)
      setProcessing(false)
    }
  }

  if (!show) return null

  const currentPricing = pricing?.[selectedDuration]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="premium-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button>
        
        <div className="premium-header">
          <h2>💎 Upgrade to Premium</h2>
          <p className="premium-subtitle">Remove watermark & unlock unlimited features</p>
        </div>

        {loading ? (
          <div className="loading-spinner">Loading pricing...</div>
        ) : (
          <>
            {/* Duration Selection */}
            <div className="duration-selector">
              <button
                className={`duration-btn ${selectedDuration === 'monthly' ? 'active' : ''}`}
                onClick={() => setSelectedDuration('monthly')}
              >
                <div className="duration-label">Monthly</div>
                <div className="duration-price">${currentPricing?.usd || 5}/mo</div>
              </button>
              <button
                className={`duration-btn ${selectedDuration === 'yearly' ? 'active' : ''}`}
                onClick={() => setSelectedDuration('yearly')}
              >
                <div className="duration-label">Yearly</div>
                <div className="duration-price">${currentPricing?.usd || 50}/yr</div>
                <div className="duration-savings">Save $10!</div>
              </button>
            </div>

            {/* Payment Method Selection */}
            <div className="payment-selector">
              <h3>Choose Payment Method</h3>
              <div className="payment-options">
                <button
                  className={`payment-btn ${selectedPayment === 'xrp' ? 'active' : ''}`}
                  onClick={() => setSelectedPayment('xrp')}
                >
                  <div className="payment-icon">💎</div>
                  <div className="payment-label">XRP</div>
                  <div className="payment-amount">{currentPricing?.xrp || '~2'} XRP</div>
                  <div className="payment-usd">${currentPricing?.usd || 5} USD</div>
                </button>
                <button
                  className={`payment-btn ${selectedPayment === 'wlo' ? 'active' : ''}`}
                  onClick={() => setSelectedPayment('wlo')}
                >
                  <div className="payment-icon">🪙</div>
                  <div className="payment-label">WLO</div>
                  <div className="payment-amount">{currentPricing?.wlo?.toLocaleString() || '5,000'} WLO</div>
                  <div className="payment-usd">${currentPricing?.usd || 5} USD</div>
                </button>
              </div>
            </div>

            {/* Premium Benefits */}
            <div className="premium-benefits">
              <h3>✨ Premium Benefits</h3>
              <ul>
                <li>❌ <strong>No Watermark</strong></li>
                <li>🎨 Unlimited meme templates</li>
                <li>🤖 Unlimited AI suggestions</li>
                <li>🖼️ Use your NFTs as templates</li>
                <li>📤 Unlimited custom uploads</li>
                <li>🎬 GIF template support</li>
                <li>💰 Earn WLO from viral memes</li>
              </ul>
            </div>

            {/* Subscribe Button */}
            <button
              className="subscribe-btn"
              onClick={handleSubscribeClick}
              disabled={processing || !wallet}
            >
              {processing ? 'Processing...' : `Subscribe with ${selectedPayment.toUpperCase()}`}
            </button>

            {!wallet && (
              <p className="wallet-warning">⚠️ Please connect your wallet first</p>
            )}
          </>
        )}

        {/* Confirmation Popup */}
        {showConfirmation && (
          <div className="confirmation-overlay">
            <div className="confirmation-popup">
              <h3>⚠️ Confirm Subscription</h3>
              <div className="confirmation-details">
                <p><strong>Duration:</strong> {selectedDuration === 'monthly' ? 'Monthly' : 'Yearly (Save $10!)'}</p>
                <p><strong>Payment:</strong> {currentPricing?.[selectedPayment === 'xrp' ? 'xrp' : 'wlo']} {selectedPayment.toUpperCase()}</p>
                <p><strong>USD Value:</strong> ${currentPricing?.usd}</p>
                <p className="no-refund-warning">🚨 <strong>NO REFUNDS</strong> - All sales are final</p>
              </div>
              <div className="confirmation-buttons">
                <button className="confirm-btn-yes" onClick={handleConfirmSubscribe}>
                  ✅ Yes, Subscribe
                </button>
                <button className="confirm-btn-no" onClick={() => setShowConfirmation(false)}>
                  ❌ Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* XUMM QR Code Popup */}
        {xummQrCode && (
          <div className="qr-overlay">
            <div className="qr-popup">
              <h3>📱 {isMobile ? 'Open Xaman' : 'Scan with Xaman'}</h3>

              {/* Desktop: Show QR code */}
              {!isMobile && (
                <>
                  <p className="qr-instructions">Open Xaman app and scan this QR code to sign the transaction</p>
                  <img src={xummQrCode} alt="XUMM QR Code" className="qr-code-image" />
                </>
              )}

              {/* Mobile: Show button to open Xaman */}
              {isMobile && (
                <>
                  <p className="qr-instructions">Tap the button below to sign the transaction in Xaman</p>
                  <a
                    href={xummDeepLink}
                    onClick={(e) => {
                      e.preventDefault()
                      window.location.href = xummDeepLink
                    }}
                    style={{
                      display: 'inline-block',
                      padding: '15px 30px',
                      background: 'linear-gradient(135deg, #ff3df7 0%, #00f7ff 100%)',
                      color: '#fff',
                      textDecoration: 'none',
                      borderRadius: '10px',
                      fontWeight: 'bold',
                      fontSize: '18px',
                      cursor: 'pointer',
                      marginBottom: '15px'
                    }}
                  >
                    🚀 Open Xaman App
                  </a>
                </>
              )}

              <div className="qr-details">
                <p><strong>Amount:</strong> {currentPricing?.[selectedPayment === 'xrp' ? 'xrp' : 'wlo']} {selectedPayment.toUpperCase()}</p>
                <p><strong>Destination:</strong> Treasury Wallet</p>
                <p className="qr-waiting">⏳ Waiting for signature...</p>
              </div>
              <button
                className="qr-cancel-btn"
                onClick={() => {
                  setXummQrCode(null)
                  setXummPayloadId(null)
                  setXummDeepLink(null)
                  setProcessing(false)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PremiumModal

