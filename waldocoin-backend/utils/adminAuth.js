// utils/adminAuth.js - Centralized admin authentication utilities
import dotenv from 'dotenv';

dotenv.config();

/**
 * Check if admin key is valid
 * @param {Object} req - Express request object
 * @returns {boolean} - True if admin key is valid
 */
export function checkAdmin(req) {
  const key = process.env.X_ADMIN_KEY;
  if (!key) return true; // no key configured -> allow
  const hdr = req.header("x-admin-key") || req.header("X-Admin-Key") || req.query.admin_key;
  return hdr === key;
}

/**
 * Express middleware for admin authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
export function requireAdmin(req, res, next) {
  const adminKey = req.headers['x-admin-key'];
  if (!adminKey || adminKey !== process.env.X_ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

/**
 * Validate admin key against environment variable
 * @param {string} providedKey - Admin key from request
 * @returns {Object} - Validation result
 */
export function validateAdminKey(providedKey) {
  const expectedKey = process.env.X_ADMIN_KEY;
  
  if (!providedKey) {
    return { valid: false, error: "Admin key required" };
  }
  
  if (!expectedKey) {
    return { valid: false, error: "Admin key not configured" };
  }
  
  if (providedKey !== expectedKey) {
    return { valid: false, error: "Invalid admin key" };
  }
  
  return { valid: true };
}

/**
 * Get admin key from request headers or query params
 * @param {Object} req - Express request object
 * @returns {string|null} - Admin key or null if not found
 */
export function getAdminKey(req) {
  return req.header("x-admin-key") || req.header("X-Admin-Key") || req.query.admin_key || req.body.adminKey || null;
}
