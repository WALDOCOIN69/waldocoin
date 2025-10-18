// utils/freeAiVerification.js - FREE AI Content Verification
import crypto from 'crypto';
import { redis } from '../redisClient.js';

// FREE AI Content Verification using built-in algorithms
export class FreeAIVerifier {
  
  // 1. FREE Image Duplicate Detection (Image Hashing)
  async checkContentOriginality(imageUrl, tweetId) {
    try {
      console.log(`🔍 FREE: Checking originality for tweet ${tweetId}`);
      
      // Generate multiple hash types for better detection
      const hashes = await this.generateMultipleHashes(imageUrl);
      
      // Check all hash types for duplicates
      for (const [hashType, hash] of Object.entries(hashes)) {
        const hashKey = `image:${hashType}:${hash}`;
        const existingTweet = await redis.get(hashKey);
        
        if (existingTweet) {
          console.log(`❌ Duplicate detected via ${hashType}: ${existingTweet}`);
          return {
            isOriginal: false,
            reason: 'DUPLICATE_IMAGE',
            hashType,
            originalTweet: existingTweet,
            confidence: 95
          };
        }
        
        // Store hash for future checks
        await redis.set(hashKey, tweetId, { EX: 60 * 60 * 24 * 30 }); // 30 days
      }
      
      console.log(`✅ Content appears original for tweet ${tweetId}`);
      return {
        isOriginal: true,
        confidence: 90
      };
      
    } catch (error) {
      console.error('❌ Error in free originality check:', error);
      return { isOriginal: true, confidence: 0, error: error.message };
    }
  }
  
  // 2. FREE Engagement Pattern Analysis
  async verifyEngagementLegitimacy(tweetData, authorId) {
    try {
      console.log(`🔍 FREE: Analyzing engagement patterns for ${tweetData.id}`);
      
      const metrics = tweetData.public_metrics;
      const suspiciousPatterns = [];
      let confidence = 100;
      
      // Pattern 1: Unrealistic engagement ratios (FREE)
      const likeToRetweetRatio = metrics.like_count / Math.max(metrics.retweet_count, 1);
      if (likeToRetweetRatio > 100 || likeToRetweetRatio < 1) {
        suspiciousPatterns.push('EXTREME_ENGAGEMENT_RATIO');
        confidence -= 30;
      }
      
      // Pattern 2: Engagement spike detection (FREE using Redis)
      const spikeResult = await this.detectEngagementSpike(authorId, metrics);
      if (spikeResult.isSuspicious) {
        suspiciousPatterns.push('ENGAGEMENT_SPIKE');
        confidence -= 25;
      }
      
      // Pattern 3: Round number detection (bots often use round numbers)
      if (this.hasRoundNumbers(metrics)) {
        suspiciousPatterns.push('ROUND_NUMBERS');
        confidence -= 15;
      }
      
      // Pattern 4: Engagement velocity (too fast)
      const velocityCheck = await this.checkEngagementVelocity(tweetData);
      if (velocityCheck.isSuspicious) {
        suspiciousPatterns.push('HIGH_VELOCITY');
        confidence -= 20;
      }
      
      const isLegitimate = confidence >= 60;
      
      console.log(`${isLegitimate ? '✅' : '❌'} Engagement analysis: ${confidence}% confidence`);
      
      return {
        isLegitimate,
        confidence: Math.max(confidence, 0),
        suspiciousPatterns,
        details: { likeToRetweetRatio, spikeResult, velocityCheck }
      };
      
    } catch (error) {
      console.error('❌ Error in free engagement analysis:', error);
      return { isLegitimate: true, confidence: 0, error: error.message };
    }
  }
  
  // 3. FREE Content Analysis (Text-based)
  async analyzeContent(tweetText, tweetData) {
    try {
      console.log(`🔍 FREE: Analyzing content for tweet ${tweetData.id}`);
      
      let confidence = 100;
      const issues = [];
      
      // Check for spam patterns (FREE)
      const spamScore = this.calculateSpamScore(tweetText);
      if (spamScore > 70) {
        issues.push('HIGH_SPAM_SCORE');
        confidence -= 40;
      }
      
      // Check WALDO relevance (FREE)
      const waldoRelevance = this.checkWaldoRelevance(tweetText);
      if (waldoRelevance.score < 20) {
        issues.push('LOW_WALDO_RELEVANCE');
        confidence -= 20;
      }
      
      // Check for inappropriate keywords (FREE)
      const inappropriateContent = this.checkInappropriateContent(tweetText);
      if (inappropriateContent.hasViolations) {
        issues.push('INAPPROPRIATE_CONTENT');
        confidence -= 50;
      }
      
      // Check text quality (FREE)
      const qualityScore = this.assessTextQuality(tweetText);
      if (qualityScore < 30) {
        issues.push('LOW_QUALITY_TEXT');
        confidence -= 15;
      }
      
      const isAppropriate = confidence >= 50;
      
      console.log(`${isAppropriate ? '✅' : '❌'} Content analysis: ${confidence}% confidence`);
      
      return {
        isAppropriate,
        confidence: Math.max(confidence, 0),
        issues,
        waldoRelevance,
        qualityScore,
        spamScore
      };
      
    } catch (error) {
      console.error('❌ Error in free content analysis:', error);
      return { isAppropriate: true, confidence: 0, error: error.message };
    }
  }
  
  // Helper Methods (All FREE)
  
  async generateMultipleHashes(imageUrl) {
    try {
      const response = await fetch(imageUrl, { timeout: 10000 });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const buffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      
      return {
        sha256: crypto.createHash('sha256').update(uint8Array).digest('hex'),
        md5: crypto.createHash('md5').update(uint8Array).digest('hex'),
        // Simple perceptual hash (basic version)
        size: uint8Array.length.toString(),
        firstBytes: Array.from(uint8Array.slice(0, 32)).join(',')
      };
    } catch (error) {
      // Fallback to URL hash if image download fails
      const urlHash = crypto.createHash('sha256').update(imageUrl).digest('hex');
      return {
        sha256: urlHash,
        md5: crypto.createHash('md5').update(imageUrl).digest('hex'),
        size: '0',
        firstBytes: 'url_fallback'
      };
    }
  }
  
  async detectEngagementSpike(authorId, metrics) {
    try {
      const historyKey = `author:${authorId}:engagement_history`;
      const recentEngagements = await redis.lRange(historyKey, 0, 9); // Last 10
      
      if (recentEngagements.length < 3) {
        return { isSuspicious: false, reason: 'INSUFFICIENT_DATA' };
      }
      
      const currentEngagement = metrics.like_count + metrics.retweet_count;
      const avgEngagement = recentEngagements.reduce((sum, eng) => sum + parseInt(eng), 0) / recentEngagements.length;
      
      const spike = currentEngagement / Math.max(avgEngagement, 1);
      
      // Store current engagement
      await redis.lpush(historyKey, currentEngagement.toString());
      await redis.ltrim(historyKey, 0, 19); // Keep last 20
      await redis.expire(historyKey, 60 * 60 * 24 * 30); // 30 days
      
      return {
        isSuspicious: spike > 15, // 15x normal = suspicious
        spike,
        avgEngagement,
        currentEngagement
      };
      
    } catch (error) {
      return { isSuspicious: false, error: error.message };
    }
  }
  
  hasRoundNumbers(metrics) {
    // Bots often generate round numbers
    const values = [metrics.like_count, metrics.retweet_count, metrics.reply_count || 0];
    const roundNumbers = values.filter(val => val > 0 && val % 10 === 0);
    return roundNumbers.length >= 2; // 2+ round numbers = suspicious
  }
  
  async checkEngagementVelocity(tweetData) {
    try {
      const createdAt = new Date(tweetData.created_at);
      const now = new Date();
      const ageMinutes = (now - createdAt) / (1000 * 60);
      
      if (ageMinutes < 5) return { isSuspicious: false, reason: 'TOO_NEW' };
      
      const totalEngagement = tweetData.public_metrics.like_count + tweetData.public_metrics.retweet_count;
      const engagementPerMinute = totalEngagement / ageMinutes;
      
      // More than 10 engagements per minute = suspicious
      return {
        isSuspicious: engagementPerMinute > 10,
        engagementPerMinute,
        ageMinutes,
        totalEngagement
      };
      
    } catch (error) {
      return { isSuspicious: false, error: error.message };
    }
  }
  
  calculateSpamScore(text) {
    let score = 0;
    
    // Excessive caps
    const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
    if (capsRatio > 0.5) score += 30;
    
    // Excessive emojis
    const emojiCount = (text.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu) || []).length;
    if (emojiCount > 5) score += 20;
    
    // Repeated characters
    if (/(.)\1{3,}/.test(text)) score += 25;
    
    // Excessive punctuation
    const punctuationRatio = (text.match(/[!?.,;:]/g) || []).length / text.length;
    if (punctuationRatio > 0.2) score += 15;
    
    // Short repetitive text
    if (text.length < 20 && /(\w+)\s+\1/.test(text)) score += 20;
    
    return Math.min(score, 100);
  }
  
  checkWaldoRelevance(text) {
    const waldoKeywords = [
      'waldo', 'waldocoin', 'wlo', '$wlo', '#waldomeme', '#waldocoin',
      'meme', 'crypto', 'token', 'xrpl', 'ripple'
    ];
    
    const lowerText = text.toLowerCase();
    const matches = waldoKeywords.filter(keyword => lowerText.includes(keyword));
    const score = (matches.length / waldoKeywords.length) * 100;
    
    return {
      score,
      matches,
      isRelevant: score > 10
    };
  }
  
  checkInappropriateContent(text) {
    const inappropriateKeywords = [
      'fuck', 'shit', 'damn', 'bitch', 'ass', 'hell',
      'scam', 'fraud', 'steal', 'hack', 'illegal'
    ];
    
    const lowerText = text.toLowerCase();
    const violations = inappropriateKeywords.filter(keyword => lowerText.includes(keyword));
    
    return {
      hasViolations: violations.length > 0,
      violations,
      severity: violations.length > 2 ? 'HIGH' : violations.length > 0 ? 'MEDIUM' : 'NONE'
    };
  }
  
  assessTextQuality(text) {
    let score = 100;
    
    // Too short
    if (text.length < 10) score -= 30;
    
    // No meaningful words
    const words = text.split(/\s+/).filter(word => word.length > 2);
    if (words.length < 3) score -= 25;
    
    // All symbols/numbers
    if (!/[a-zA-Z]/.test(text)) score -= 40;
    
    // Excessive repetition
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const repetitionRatio = uniqueWords.size / Math.max(words.length, 1);
    if (repetitionRatio < 0.5) score -= 20;
    
    return Math.max(score, 0);
  }
}

// Main FREE verification function
export async function verifyContentFree(tweetData, imageUrl = null) {
  console.log(`🆓 Starting FREE AI verification for tweet ${tweetData.id}`);
  
  const verifier = new FreeAIVerifier();
  const results = {
    tweetId: tweetData.id,
    timestamp: new Date().toISOString(),
    method: 'FREE_VERIFICATION',
    checks: {}
  };
  
  try {
    // Run all FREE checks
    const checks = await Promise.all([
      imageUrl ? verifier.checkContentOriginality(imageUrl, tweetData.id) : 
                 Promise.resolve({ isOriginal: true, confidence: 80, reason: 'NO_IMAGE' }),
      verifier.verifyEngagementLegitimacy(tweetData, tweetData.author_id),
      verifier.analyzeContent(tweetData.text || '', tweetData)
    ]);
    
    results.checks = {
      originality: checks[0],
      engagement: checks[1],
      content: checks[2]
    };
    
    // Calculate overall confidence
    const confidenceScores = checks.map(check => check.confidence).filter(score => score > 0);
    results.overallConfidence = confidenceScores.length > 0 
      ? confidenceScores.reduce((a, b) => a + b) / confidenceScores.length 
      : 0;
    
    // Determine verification status
    results.aiVerified = checks[0].isOriginal && 
                        checks[1].isLegitimate && 
                        checks[2].isAppropriate;
    
    // Store results
    await redis.set(`ai:free:${tweetData.id}`, JSON.stringify(results), { EX: 60 * 60 * 24 * 7 });
    
    console.log(`🆓 FREE verification complete: ${results.aiVerified ? 'PASSED' : 'FAILED'} (${results.overallConfidence.toFixed(1)}%)`);
    
    return results;
    
  } catch (error) {
    console.error('❌ FREE verification error:', error);
    results.error = error.message;
    results.aiVerified = true; // Default to allowing
    results.overallConfidence = 0;
    return results;
  }
}

export default { FreeAIVerifier, verifyContentFree };
