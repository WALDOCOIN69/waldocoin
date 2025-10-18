// utils/aiContentVerification.js - Advanced AI Content Verification
import crypto from 'crypto';
import { redis } from '../redisClient.js';

// AI Service Configuration
const AI_SERVICES = {
  // Google Vision API for image analysis
  GOOGLE_VISION: {
    endpoint: 'https://vision.googleapis.com/v1/images:annotate',
    key: process.env.GOOGLE_VISION_API_KEY
  },
  
  // OpenAI for content analysis
  OPENAI: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    key: process.env.OPENAI_API_KEY
  },
  
  // Reverse image search
  TINEYE: {
    endpoint: 'https://api.tineye.com/rest/search',
    key: process.env.TINEYE_API_KEY
  }
};

// 1. Content Originality Detection
export async function checkContentOriginality(imageUrl, tweetId) {
  try {
    console.log(`🔍 Checking originality for tweet ${tweetId}`);
    
    // Generate image hash for duplicate detection
    const imageHash = await generateImageHash(imageUrl);
    const hashKey = `image:hash:${imageHash}`;
    
    // Check if we've seen this image before
    const existingTweet = await redis.get(hashKey);
    if (existingTweet) {
      console.log(`❌ Duplicate image detected! Original tweet: ${existingTweet}`);
      return {
        isOriginal: false,
        reason: 'DUPLICATE_IMAGE',
        originalTweet: existingTweet,
        confidence: 100
      };
    }
    
    // Store hash for future checks
    await redis.set(hashKey, tweetId, { EX: 60 * 60 * 24 * 30 }); // 30 days
    
    // Reverse image search (if API available)
    const reverseSearchResults = await reverseImageSearch(imageUrl);
    if (reverseSearchResults.matches > 0) {
      console.log(`⚠️ Image found elsewhere: ${reverseSearchResults.matches} matches`);
      return {
        isOriginal: false,
        reason: 'FOUND_ELSEWHERE',
        matches: reverseSearchResults.matches,
        confidence: reverseSearchResults.confidence
      };
    }
    
    console.log(`✅ Content appears original for tweet ${tweetId}`);
    return {
      isOriginal: true,
      confidence: 95
    };
    
  } catch (error) {
    console.error('❌ Error checking content originality:', error);
    return {
      isOriginal: true, // Default to allowing if check fails
      confidence: 0,
      error: error.message
    };
  }
}

// 2. Engagement Legitimacy Verification
export async function verifyEngagementLegitimacy(tweetData, authorId) {
  try {
    console.log(`🔍 Verifying engagement for tweet ${tweetData.id}`);
    
    const metrics = tweetData.public_metrics;
    const engagementScore = await calculateEngagementScore(metrics, authorId);
    
    // Check for suspicious engagement patterns
    const suspiciousPatterns = [];
    
    // Pattern 1: Unrealistic engagement ratio
    const likeToRetweetRatio = metrics.like_count / Math.max(metrics.retweet_count, 1);
    if (likeToRetweetRatio > 50 || likeToRetweetRatio < 2) {
      suspiciousPatterns.push('UNUSUAL_ENGAGEMENT_RATIO');
    }
    
    // Pattern 2: Sudden engagement spike
    const engagementSpike = await detectEngagementSpike(authorId, metrics);
    if (engagementSpike.isSuspicious) {
      suspiciousPatterns.push('ENGAGEMENT_SPIKE');
    }
    
    // Pattern 3: Bot-like engagement timing
    const timingAnalysis = await analyzeEngagementTiming(tweetData.id);
    if (timingAnalysis.isBotLike) {
      suspiciousPatterns.push('BOT_LIKE_TIMING');
    }
    
    const isLegitimate = suspiciousPatterns.length === 0;
    const confidence = Math.max(0, 100 - (suspiciousPatterns.length * 25));
    
    console.log(`${isLegitimate ? '✅' : '❌'} Engagement legitimacy: ${confidence}% confidence`);
    
    return {
      isLegitimate,
      confidence,
      suspiciousPatterns,
      engagementScore,
      details: {
        likeToRetweetRatio,
        engagementSpike,
        timingAnalysis
      }
    };
    
  } catch (error) {
    console.error('❌ Error verifying engagement legitimacy:', error);
    return {
      isLegitimate: true, // Default to allowing if check fails
      confidence: 0,
      error: error.message
    };
  }
}

// 3. Image Recognition & Content Analysis
export async function analyzeImageContent(imageUrl, tweetText) {
  try {
    console.log(`🔍 Analyzing image content: ${imageUrl}`);
    
    // Google Vision API for comprehensive image analysis
    const visionResults = await callGoogleVision(imageUrl);
    
    // Content safety check
    const safetyCheck = analyzeSafetyAnnotations(visionResults.safeSearchAnnotation);
    if (!safetyCheck.isSafe) {
      return {
        isAppropriate: false,
        reason: 'INAPPROPRIATE_CONTENT',
        details: safetyCheck.violations,
        confidence: safetyCheck.confidence
      };
    }
    
    // Text extraction (OCR)
    const extractedText = extractTextFromImage(visionResults.textAnnotations);
    
    // WALDO-related content check
    const waldoRelevance = checkWaldoRelevance(extractedText, tweetText);
    
    // Quality assessment
    const qualityScore = assessImageQuality(visionResults);
    
    console.log(`✅ Image analysis complete - Quality: ${qualityScore}%, WALDO relevance: ${waldoRelevance.score}%`);
    
    return {
      isAppropriate: true,
      qualityScore,
      waldoRelevance,
      extractedText,
      safetyCheck,
      confidence: 90
    };
    
  } catch (error) {
    console.error('❌ Error analyzing image content:', error);
    return {
      isAppropriate: true, // Default to allowing if check fails
      confidence: 0,
      error: error.message
    };
  }
}

// Helper Functions
async function generateImageHash(imageUrl) {
  try {
    // Download image and generate hash
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    return crypto.createHash('sha256').update(Buffer.from(buffer)).digest('hex');
  } catch (error) {
    // Fallback to URL hash if image download fails
    return crypto.createHash('sha256').update(imageUrl).digest('hex');
  }
}

async function reverseImageSearch(imageUrl) {
  try {
    if (!AI_SERVICES.TINEYE.key) {
      return { matches: 0, confidence: 0 };
    }
    
    // TinEye reverse image search
    const response = await fetch(`${AI_SERVICES.TINEYE.endpoint}?image_url=${encodeURIComponent(imageUrl)}`, {
      headers: {
        'Authorization': `Bearer ${AI_SERVICES.TINEYE.key}`
      }
    });
    
    const data = await response.json();
    return {
      matches: data.results?.length || 0,
      confidence: data.results?.length > 0 ? 80 : 20
    };
  } catch (error) {
    return { matches: 0, confidence: 0 };
  }
}

async function calculateEngagementScore(metrics, authorId) {
  // Get author's average engagement for comparison
  const avgEngagement = await getAuthorAverageEngagement(authorId);
  
  const currentEngagement = metrics.like_count + metrics.retweet_count;
  const score = avgEngagement > 0 ? (currentEngagement / avgEngagement) * 100 : 100;
  
  return Math.min(score, 1000); // Cap at 1000%
}

async function detectEngagementSpike(authorId, metrics) {
  const recentTweets = await redis.lRange(`author:${authorId}:recent_engagement`, 0, 9);
  
  if (recentTweets.length < 5) {
    return { isSuspicious: false, reason: 'INSUFFICIENT_DATA' };
  }
  
  const avgEngagement = recentTweets.reduce((sum, tweet) => {
    const data = JSON.parse(tweet);
    return sum + data.like_count + data.retweet_count;
  }, 0) / recentTweets.length;
  
  const currentEngagement = metrics.like_count + metrics.retweet_count;
  const spike = currentEngagement / Math.max(avgEngagement, 1);
  
  return {
    isSuspicious: spike > 10, // 10x normal engagement
    spike,
    avgEngagement,
    currentEngagement
  };
}

async function analyzeEngagementTiming(tweetId) {
  // This would analyze the timing of likes/retweets if we had access to that data
  // For now, return non-suspicious
  return {
    isBotLike: false,
    reason: 'TIMING_DATA_UNAVAILABLE'
  };
}

async function callGoogleVision(imageUrl) {
  if (!AI_SERVICES.GOOGLE_VISION.key) {
    throw new Error('Google Vision API key not configured');
  }
  
  const response = await fetch(`${AI_SERVICES.GOOGLE_VISION.endpoint}?key=${AI_SERVICES.GOOGLE_VISION.key}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{
        image: { source: { imageUri: imageUrl } },
        features: [
          { type: 'SAFE_SEARCH_DETECTION' },
          { type: 'TEXT_DETECTION' },
          { type: 'IMAGE_PROPERTIES' },
          { type: 'LABEL_DETECTION' }
        ]
      }]
    })
  });
  
  const data = await response.json();
  return data.responses[0];
}

function analyzeSafetyAnnotations(safeSearch) {
  if (!safeSearch) return { isSafe: true, confidence: 50 };
  
  const violations = [];
  const levels = ['VERY_UNLIKELY', 'UNLIKELY', 'POSSIBLE', 'LIKELY', 'VERY_LIKELY'];
  
  if (levels.indexOf(safeSearch.adult) >= 2) violations.push('ADULT_CONTENT');
  if (levels.indexOf(safeSearch.violence) >= 2) violations.push('VIOLENT_CONTENT');
  if (levels.indexOf(safeSearch.racy) >= 3) violations.push('RACY_CONTENT');
  
  return {
    isSafe: violations.length === 0,
    violations,
    confidence: violations.length === 0 ? 95 : 85
  };
}

function extractTextFromImage(textAnnotations) {
  if (!textAnnotations || textAnnotations.length === 0) return '';
  return textAnnotations[0].description || '';
}

function checkWaldoRelevance(extractedText, tweetText) {
  const waldoKeywords = ['waldo', 'waldocoin', 'wlo', '$wlo', '#waldomeme'];
  const combinedText = `${extractedText} ${tweetText}`.toLowerCase();
  
  const matches = waldoKeywords.filter(keyword => combinedText.includes(keyword));
  const score = (matches.length / waldoKeywords.length) * 100;
  
  return {
    score,
    matches,
    isRelevant: score > 20
  };
}

function assessImageQuality(visionResults) {
  // Basic quality assessment based on image properties
  if (!visionResults.imagePropertiesAnnotation) return 75;
  
  const colors = visionResults.imagePropertiesAnnotation.dominantColors?.colors || [];
  const hasGoodColorVariety = colors.length >= 3;
  
  return hasGoodColorVariety ? 85 : 65;
}

async function getAuthorAverageEngagement(authorId) {
  const key = `author:${authorId}:avg_engagement`;
  const cached = await redis.get(key);
  if (cached) return parseFloat(cached);
  
  // Calculate from recent tweets
  const recentTweets = await redis.lRange(`author:${authorId}:recent_engagement`, 0, 19);
  if (recentTweets.length === 0) return 10; // Default for new authors
  
  const avg = recentTweets.reduce((sum, tweet) => {
    const data = JSON.parse(tweet);
    return sum + data.like_count + data.retweet_count;
  }, 0) / recentTweets.length;
  
  await redis.set(key, avg.toString(), { EX: 60 * 60 * 24 }); // Cache for 24 hours
  return avg;
}

// Main AI Content Verification Function
export async function verifyContentWithAI(tweetData, imageUrl) {
  console.log(`🤖 Starting AI content verification for tweet ${tweetData.id}`);
  
  const results = {
    tweetId: tweetData.id,
    timestamp: new Date().toISOString(),
    checks: {}
  };
  
  try {
    // Run all AI checks in parallel
    const [originalityCheck, engagementCheck, contentAnalysis] = await Promise.all([
      checkContentOriginality(imageUrl, tweetData.id),
      verifyEngagementLegitimacy(tweetData, tweetData.author_id),
      analyzeImageContent(imageUrl, tweetData.text)
    ]);
    
    results.checks = {
      originality: originalityCheck,
      engagement: engagementCheck,
      content: contentAnalysis
    };
    
    // Calculate overall AI confidence score
    const confidenceScores = [
      originalityCheck.confidence,
      engagementCheck.confidence,
      contentAnalysis.confidence
    ].filter(score => score > 0);
    
    results.overallConfidence = confidenceScores.length > 0 
      ? confidenceScores.reduce((a, b) => a + b) / confidenceScores.length 
      : 0;
    
    // Determine if content passes AI verification
    results.aiVerified = originalityCheck.isOriginal && 
                        engagementCheck.isLegitimate && 
                        contentAnalysis.isAppropriate;
    
    // Store results for analytics
    await redis.set(`ai:verification:${tweetData.id}`, JSON.stringify(results), { EX: 60 * 60 * 24 * 7 });
    
    console.log(`🤖 AI verification complete: ${results.aiVerified ? 'PASSED' : 'FAILED'} (${results.overallConfidence}% confidence)`);
    
    return results;
    
  } catch (error) {
    console.error('❌ AI content verification failed:', error);
    results.error = error.message;
    results.aiVerified = true; // Default to allowing if AI fails
    results.overallConfidence = 0;
    return results;
  }
}

export default {
  verifyContentWithAI,
  checkContentOriginality,
  verifyEngagementLegitimacy,
  analyzeImageContent
};
