import { redis } from "../redisClient.js";
import { xummClient } from "./xummClient.js";

console.log("🧩 Loaded: utils/paymentHandler.js");

/**
 * Enhanced Payment Handler with Vulnerability Fixes
 * 
 * Handles payment timeouts, network failures, XUMM payload expiry,
 * and provides comprehensive error handling and logging.
 */

// Payment tracking keys
const PAYMENT_KEYS = {
  tracking: (uuid) => `payment:${uuid}:tracking`,
  timeout: (uuid) => `payment:${uuid}:timeout`,
  retry: (uuid) => `payment:${uuid}:retry`,
  failure: (uuid) => `payment:${uuid}:failure`
};

/**
 * Create and track a payment payload with enhanced error handling
 * @param {Object} paymentData - Payment configuration
 * @param {Function} onSuccess - Success callback
 * @param {Function} onFailure - Failure callback
 * @returns {Object} - { success: boolean, uuid?: string, next?: object, error?: string }
 */
export async function createTrackedPayment(paymentData, onSuccess, onFailure) {
  try {
    console.log(`💳 Creating tracked payment:`, {
      destination: paymentData.txjson.Destination,
      amount: paymentData.txjson.Amount,
      tag: paymentData.txjson.DestinationTag
    });

    // Create payment payload with extended expiry for better UX
    const payload = {
      ...paymentData,
      options: {
        ...paymentData.options,
        expire: 600, // 10 minutes instead of 5
        submit: true
      }
    };

    const { uuid, next } = await xummClient.payload.createAndSubscribe(payload, async (event) => {
      try {
        console.log(`💳 Payment event for ${uuid}:`, event.data);

        // Track payment state
        await redis.hset(PAYMENT_KEYS.tracking(uuid), {
          status: event.data.signed !== null ? 'resolved' : 'pending',
          signed: event.data.signed,
          timestamp: Date.now(),
          txid: event.data.txid || null
        });

        if (event.data.signed === true) {
          console.log(`✅ Payment successful: ${uuid} - TXID: ${event.data.txid}`);
          
          // Clear any timeout/retry tracking
          await Promise.all([
            redis.del(PAYMENT_KEYS.timeout(uuid)),
            redis.del(PAYMENT_KEYS.retry(uuid)),
            redis.del(PAYMENT_KEYS.failure(uuid))
          ]);

          if (onSuccess) {
            await onSuccess(event.data);
          }
          return true;
        } else if (event.data.signed === false) {
          console.log(`❌ Payment rejected: ${uuid}`);
          
          await redis.hset(PAYMENT_KEYS.failure(uuid), {
            reason: 'user_rejected',
            timestamp: Date.now()
          });

          if (onFailure) {
            await onFailure(new Error("Payment rejected by user"));
          }
          return true;
        }

        return false; // Continue waiting
      } catch (error) {
        console.error(`❌ Payment event handler error for ${uuid}:`, error);
        
        await redis.hset(PAYMENT_KEYS.failure(uuid), {
          reason: 'event_handler_error',
          error: error.message,
          timestamp: Date.now()
        });

        if (onFailure) {
          await onFailure(error);
        }
        return true;
      }
    });

    // Track payment creation
    await redis.hset(PAYMENT_KEYS.tracking(uuid), {
      status: 'created',
      created: Date.now(),
      expires: Date.now() + (600 * 1000), // 10 minutes
      destination: paymentData.txjson.Destination,
      amount: paymentData.txjson.Amount,
      tag: paymentData.txjson.DestinationTag || null
    });

    // Set up timeout handling
    setTimeout(async () => {
      try {
        const tracking = await redis.hgetall(PAYMENT_KEYS.tracking(uuid));
        
        if (tracking && tracking.status !== 'resolved') {
          console.log(`⏰ Payment timeout: ${uuid}`);
          
          await redis.hset(PAYMENT_KEYS.timeout(uuid), {
            reason: 'timeout',
            timestamp: Date.now()
          });

          // Check final status from XUMM
          try {
            const payloadData = await xummClient.payload.get(uuid);
            
            if (payloadData.meta?.signed === true) {
              console.log(`✅ Late payment success detected: ${uuid}`);
              if (onSuccess) {
                await onSuccess({ signed: true, txid: payloadData.response?.txid });
              }
            } else {
              console.log(`❌ Payment timeout confirmed: ${uuid}`);
              if (onFailure) {
                await onFailure(new Error("Payment timeout"));
              }
            }
          } catch (statusError) {
            console.error(`❌ Payment status check failed: ${uuid}:`, statusError);
            if (onFailure) {
              await onFailure(new Error("Payment timeout and status check failed"));
            }
          }
        }
      } catch (timeoutError) {
        console.error(`❌ Payment timeout handler error: ${uuid}:`, timeoutError);
      }
    }, 600000); // 10 minutes

    console.log(`💳 Payment created successfully: ${uuid}`);
    
    return {
      success: true,
      uuid,
      next,
      expires: Date.now() + (600 * 1000)
    };

  } catch (error) {
    console.error(`❌ Payment creation failed:`, error);
    
    return {
      success: false,
      error: error.message || "Failed to create payment"
    };
  }
}

/**
 * Get payment status with comprehensive error handling
 * @param {string} uuid - Payment UUID
 * @returns {Object} - Payment status information
 */
export async function getPaymentStatus(uuid) {
  try {
    // Get tracking data
    const tracking = await redis.hgetall(PAYMENT_KEYS.tracking(uuid));
    
    if (!tracking || Object.keys(tracking).length === 0) {
      return {
        success: false,
        error: "Payment not found",
        signed: null,
        resolved: false
      };
    }

    // Check if we have cached status
    if (tracking.status === 'resolved') {
      return {
        success: true,
        signed: tracking.signed === 'true',
        resolved: true,
        txid: tracking.txid || null,
        timestamp: parseInt(tracking.timestamp)
      };
    }

    // Check XUMM for latest status
    try {
      const payloadData = await xummClient.payload.get(uuid);
      
      const status = {
        success: true,
        signed: payloadData.meta?.signed || null,
        resolved: payloadData.meta?.resolved || false,
        expired: payloadData.meta?.expired || false,
        cancelled: payloadData.meta?.cancelled || false,
        txid: payloadData.response?.txid || null
      };

      // Update tracking if resolved
      if (status.resolved && tracking.status !== 'resolved') {
        await redis.hset(PAYMENT_KEYS.tracking(uuid), {
          status: 'resolved',
          signed: status.signed,
          timestamp: Date.now(),
          txid: status.txid || null
        });
      }

      return status;

    } catch (xummError) {
      console.error(`❌ XUMM status check failed for ${uuid}:`, xummError);
      
      // Return cached data if XUMM is unavailable
      return {
        success: true,
        signed: tracking.signed === 'true' ? true : tracking.signed === 'false' ? false : null,
        resolved: tracking.status === 'resolved',
        error: "Status check failed, using cached data",
        timestamp: parseInt(tracking.timestamp)
      };
    }

  } catch (error) {
    console.error(`❌ Payment status error for ${uuid}:`, error);
    
    return {
      success: false,
      error: error.message || "Failed to get payment status",
      signed: null,
      resolved: false
    };
  }
}

/**
 * Clean up expired payment tracking data
 * @param {number} olderThanMs - Clean up payments older than this (default: 24 hours)
 * @returns {number} - Number of payments cleaned up
 */
export async function cleanupExpiredPayments(olderThanMs = 24 * 60 * 60 * 1000) {
  try {
    const cutoff = Date.now() - olderThanMs;
    const trackingKeys = await redis.keys('payment:*:tracking');
    let cleanedCount = 0;

    for (const key of trackingKeys) {
      try {
        const tracking = await redis.hgetall(key);
        const created = parseInt(tracking.created);

        if (created && created < cutoff) {
          const uuid = key.split(':')[1];
          
          // Delete all related keys
          await Promise.all([
            redis.del(PAYMENT_KEYS.tracking(uuid)),
            redis.del(PAYMENT_KEYS.timeout(uuid)),
            redis.del(PAYMENT_KEYS.retry(uuid)),
            redis.del(PAYMENT_KEYS.failure(uuid))
          ]);

          cleanedCount++;
        }
      } catch (keyError) {
        console.error(`❌ Error cleaning payment key ${key}:`, keyError);
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired payment records`);
    }

    return cleanedCount;
  } catch (error) {
    console.error(`❌ Payment cleanup error:`, error);
    return 0;
  }
}

/**
 * Get payment failure information
 * @param {string} uuid - Payment UUID
 * @returns {Object} - Failure information or null
 */
export async function getPaymentFailure(uuid) {
  try {
    const failure = await redis.hgetall(PAYMENT_KEYS.failure(uuid));
    
    if (!failure || Object.keys(failure).length === 0) {
      return null;
    }

    return {
      reason: failure.reason,
      error: failure.error || null,
      timestamp: parseInt(failure.timestamp)
    };
  } catch (error) {
    console.error(`❌ Get payment failure error for ${uuid}:`, error);
    return null;
  }
}
