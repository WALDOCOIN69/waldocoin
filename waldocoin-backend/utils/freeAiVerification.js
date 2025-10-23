// utils/freeAiVerification.js - FREE AI Content Verification (No API costs)
// Focus: TEXT CONTENT ANALYSIS - Images can be reused, but text should be creative
// Philosophy: Same image + different creative text = ALLOWED (encourages creativity)
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

      // Check for spam patterns (FREE) - Enhanced anti-farming
      const spamScore = this.calculateSpamScore(tweetText);
      if (spamScore > 80) {
        issues.push('GIBBERISH_OR_FARMING');
        confidence -= 60; // Heavy penalty for obvious farming
      } else if (spamScore > 60) {
        issues.push('HIGH_SPAM_SCORE');
        confidence -= 40;
      } else if (spamScore > 40) {
        issues.push('MODERATE_SPAM_SCORE');
        confidence -= 20;
      }

      // Check WALDO relevance (FREE)
      const waldoRelevance = this.checkWaldoRelevance(tweetText);
      if (waldoRelevance.score < 15) {
        issues.push('LOW_WALDO_RELEVANCE');
        confidence -= 30;
      }

      // Check content quality (NEW) - Prevents farming with gibberish
      const contentQuality = this.calculateContentQuality(tweetText);
      if (contentQuality < 30) {
        issues.push('LOW_QUALITY_CONTENT');
        confidence -= 35;
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

  // 4. FREE Twitter Profile Analysis (NEW!)
  async analyzeTwitterProfile(authorId, tweetData) {
    try {
      console.log(`🔍 FREE: Analyzing Twitter profile for author ${authorId}`);

      let confidence = 100;
      const suspiciousIndicators = [];

      // Get cached profile data or fetch from Twitter API
      const profileData = await this.getProfileData(authorId);

      if (!profileData) {
        return {
          isLegitimate: true,
          confidence: 0,
          reason: 'PROFILE_DATA_UNAVAILABLE'
        };
      }

      // 1. Account Age Analysis
      const accountAge = this.analyzeAccountAge(profileData.created_at);
      if (accountAge.isSuspicious) {
        suspiciousIndicators.push('NEW_ACCOUNT');
        confidence -= 25;
      }

      // 2. Profile Picture Analysis
      const profilePicture = this.analyzeProfilePicture(profileData.profile_image_url);
      if (profilePicture.isSuspicious) {
        suspiciousIndicators.push('SUSPICIOUS_PROFILE_PIC');
        confidence -= 20;
      }

      // 3. Follower/Following Ratio Analysis
      const followerRatio = this.analyzeFollowerRatio(profileData.public_metrics);
      if (followerRatio.isSuspicious) {
        suspiciousIndicators.push('SUSPICIOUS_FOLLOWER_RATIO');
        confidence -= 30;
      }

      // 4. Username Pattern Analysis
      const usernamePattern = this.analyzeUsernamePattern(profileData.username);
      if (usernamePattern.isSuspicious) {
        suspiciousIndicators.push('SUSPICIOUS_USERNAME');
        confidence -= 15;
      }

      // 5. Bio Analysis
      const bioAnalysis = this.analyzeBio(profileData.description || '');
      if (bioAnalysis.isSuspicious) {
        suspiciousIndicators.push('SUSPICIOUS_BIO');
        confidence -= 10;
      }

      // 6. Tweet Frequency Analysis
      const tweetFrequency = this.analyzeTweetFrequency(profileData.public_metrics, profileData.created_at);
      if (tweetFrequency.isSuspicious) {
        suspiciousIndicators.push('SUSPICIOUS_TWEET_FREQUENCY');
        confidence -= 20;
      }

      const isLegitimate = confidence >= 60;

      console.log(`${isLegitimate ? '✅' : '❌'} Profile analysis: ${confidence}% confidence`);

      return {
        isLegitimate,
        confidence: Math.max(confidence, 0),
        suspiciousIndicators,
        profileAnalysis: {
          accountAge,
          profilePicture,
          followerRatio,
          usernamePattern,
          bioAnalysis,
          tweetFrequency
        }
      };

    } catch (error) {
      console.error('❌ Error in profile analysis:', error);
      return { isLegitimate: true, confidence: 0, error: error.message };
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

    // 1. GIBBERISH DETECTION - Random character patterns
    const gibberishPatterns = [
      /[qwerty]{4,}/i,           // Keyboard mashing: qwerty, asdf
      /[asdfgh]{4,}/i,
      /[zxcvbn]{4,}/i,
      /(.)\1{4,}/,               // Same character 5+ times: aaaaa
      /^[a-z]{1,3}(\s[a-z]{1,3}){3,}$/i, // Single letters: a b c d e
      /[0-9]{6,}/,               // Random numbers: 123456789
      /^[!@#$%^&*()]{3,}$/       // Just symbols: !@#$%
    ];

    for (const pattern of gibberishPatterns) {
      if (pattern.test(text)) {
        score += 60; // Heavy penalty for gibberish
        break;
      }
    }

    // 2. FARMING PATTERNS - Low effort content
    const farmingPatterns = [
      /^(nice|good|great|cool|wow|ok|yes|no)\.?$/i,  // Single word responses
      /^(lol|lmao|haha|omg|wtf)\.?$/i,               // Just reactions
      /^.{1,10}$/,                                   // Extremely short (under 10 chars)
      /^(\w+\s?){1,3}$/,                            // 1-3 words only
      /^(to the moon|hodl|diamond hands|wen moon)\.?$/i // Generic crypto phrases
    ];

    for (const pattern of farmingPatterns) {
      if (pattern.test(text.trim())) {
        score += 50; // Heavy penalty for farming attempts
        break;
      }
    }

    // 3. EXCESSIVE CAPS (farming tactic)
    const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
    if (capsRatio > 0.7) score += 40;  // Increased penalty
    else if (capsRatio > 0.5) score += 25;

    // 4. EMOJI SPAM (farming tactic)
    const emojiCount = (text.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu) || []).length;
    if (emojiCount > 8) score += 35;   // More than 8 emojis = spam
    else if (emojiCount > 5) score += 20;

    // 5. REPEATED CHARACTERS/WORDS
    if (/(.)\1{4,}/.test(text)) score += 40;        // Same char 5+ times
    if (/(\w+)\s+\1\s+\1/.test(text)) score += 35;  // Same word 3+ times

    // 6. EXCESSIVE PUNCTUATION
    const punctuationRatio = (text.match(/[!?.,;:]/g) || []).length / text.length;
    if (punctuationRatio > 0.3) score += 30;        // Increased threshold
    else if (punctuationRatio > 0.2) score += 15;

    // 7. MEANINGLESS COMBINATIONS
    const meaninglessWords = ['aaa', 'bbb', 'ccc', 'xxx', 'zzz', 'test', 'testing', '123', 'abc'];
    const wordCount = meaninglessWords.filter(word => text.toLowerCase().includes(word)).length;
    if (wordCount >= 2) score += 30;

    // 8. LACK OF VOWELS (gibberish indicator)
    const vowelRatio = (text.match(/[aeiou]/gi) || []).length / text.length;
    if (vowelRatio < 0.1 && text.length > 10) score += 25; // Very few vowels = likely gibberish

    return Math.min(score, 100);
  }

  // NEW: Content Quality Scoring - Prevents farming with meaningful content requirements
  calculateContentQuality(text) {
    let score = 0;

    // 1. Length bonus (substantial content)
    if (text.length >= 50) score += 25;
    else if (text.length >= 30) score += 15;
    else if (text.length >= 20) score += 10;

    // 2. Word variety (not repetitive)
    const words = text.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);
    const varietyRatio = uniqueWords.size / words.length;
    if (varietyRatio > 0.8) score += 20;  // High word variety
    else if (varietyRatio > 0.6) score += 15;
    else if (varietyRatio > 0.4) score += 10;

    // 3. Sentence structure (proper grammar indicators)
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length >= 2) score += 15; // Multiple sentences
    if (/^[A-Z]/.test(text.trim())) score += 5; // Starts with capital

    // 4. Meaningful words (not just filler)
    const meaningfulWords = [
      'when', 'how', 'why', 'what', 'where', 'because', 'since', 'although',
      'think', 'believe', 'feel', 'know', 'understand', 'realize', 'remember',
      'love', 'hate', 'like', 'enjoy', 'prefer', 'want', 'need', 'hope',
      'community', 'project', 'future', 'potential', 'growth', 'success'
    ];
    const meaningfulCount = meaningfulWords.filter(word =>
      text.toLowerCase().includes(word)
    ).length;
    score += Math.min(meaningfulCount * 3, 15); // Up to 15 points for meaningful words

    // 5. Context and coherence (basic checks)
    if (text.includes(' and ') || text.includes(' but ') || text.includes(' or ')) score += 5;
    if (text.includes(' the ') || text.includes(' this ') || text.includes(' that ')) score += 5;

    // 6. Penalty for obvious farming attempts
    const farmingPhrases = [
      'nice project', 'good project', 'great project', 'amazing project',
      'to the moon', 'wen moon', 'hodl strong', 'diamond hands',
      'buy the dip', 'this is the way', 'bullish', 'bearish'
    ];
    const farmingCount = farmingPhrases.filter(phrase =>
      text.toLowerCase().includes(phrase)
    ).length;
    if (farmingCount >= 2) score -= 20; // Multiple generic phrases = farming

    return Math.max(Math.min(score, 100), 0);
  }

  checkWaldoRelevance(text) {
    const waldoKeywords = [
      'waldo', 'waldocoin', 'wlo', '$wlo', '#waldomeme', '#waldocoin', '#waldo',
      'meme', 'crypto', 'token', 'xrpl', 'ripple', 'hodl', 'moon'
    ];

    const creativeKeywords = [
      'funny', 'hilarious', 'lol', 'lmao', 'epic', 'amazing', 'awesome',
      'creative', 'original', 'unique', 'brilliant', 'genius', 'fire', '🔥',
      'based', 'chad', 'diamond', 'hands', 'ape', 'rocket', '🚀', '💎'
    ];

    const lowerText = text.toLowerCase();
    const waldoMatches = waldoKeywords.filter(keyword => lowerText.includes(keyword));
    const creativeMatches = creativeKeywords.filter(keyword => lowerText.includes(keyword));

    // Score based on WALDO relevance + creative content (focus on text creativity)
    const waldoScore = Math.min((waldoMatches.length / 2) * 60, 60); // Max 60% for WALDO keywords
    const creativeScore = Math.min((creativeMatches.length / 1) * 40, 40); // Max 40% for creativity
    const totalScore = waldoScore + creativeScore;

    return {
      score: totalScore,
      waldoMatches,
      creativeMatches,
      isRelevant: totalScore >= 20, // Lower threshold - focus on creativity over strict WALDO mentions
      hasWaldoContent: waldoMatches.length > 0,
      hasCreativeContent: creativeMatches.length > 0,
      textLength: text.length,
      isSubstantial: text.length >= 20 // Encourage substantial content
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

  // Profile Analysis Helper Methods (NEW!)

  async getProfileData(authorId) {
    try {
      // Check Redis cache first
      const cacheKey = `profile:${authorId}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // If not cached, would need Twitter API call (requires bearer token)
      // For now, return null to indicate unavailable
      // In production, implement Twitter API v2 user lookup
      return null;

    } catch (error) {
      console.error('Error getting profile data:', error);
      return null;
    }
  }

  analyzeAccountAge(createdAt) {
    try {
      const accountDate = new Date(createdAt);
      const now = new Date();
      const ageInDays = (now - accountDate) / (1000 * 60 * 60 * 24);

      // Accounts less than 30 days old are suspicious
      const isSuspicious = ageInDays < 30;

      return {
        isSuspicious,
        ageInDays: Math.floor(ageInDays),
        reason: isSuspicious ? 'ACCOUNT_TOO_NEW' : 'ACCOUNT_AGE_OK'
      };

    } catch (error) {
      return { isSuspicious: false, error: error.message };
    }
  }

  analyzeProfilePicture(profileImageUrl) {
    try {
      // Check for default Twitter profile pictures
      const defaultPatterns = [
        'default_profile_images',
        'default_profile',
        'sticky/default_profile',
        '_normal.jpg' // Default Twitter pattern
      ];

      const isDefault = defaultPatterns.some(pattern =>
        profileImageUrl && profileImageUrl.includes(pattern)
      );

      // Check for suspicious patterns
      const suspiciousPatterns = [
        'temp', 'generated', 'fake', 'bot', 'auto'
      ];

      const hasSuspiciousPattern = suspiciousPatterns.some(pattern =>
        profileImageUrl && profileImageUrl.toLowerCase().includes(pattern)
      );

      const isSuspicious = isDefault || hasSuspiciousPattern;

      return {
        isSuspicious,
        isDefault,
        hasSuspiciousPattern,
        reason: isDefault ? 'DEFAULT_PROFILE_PIC' :
          hasSuspiciousPattern ? 'SUSPICIOUS_PIC_URL' : 'PROFILE_PIC_OK'
      };

    } catch (error) {
      return { isSuspicious: false, error: error.message };
    }
  }

  analyzeFollowerRatio(publicMetrics) {
    try {
      const followers = publicMetrics.followers_count || 0;
      const following = publicMetrics.following_count || 0;

      // Calculate ratios
      const followingToFollowerRatio = following / Math.max(followers, 1);
      const followerToFollowingRatio = followers / Math.max(following, 1);

      let isSuspicious = false;
      const reasons = [];

      // Red flags:
      // 1. Following way more than followers (>10:1 ratio)
      if (followingToFollowerRatio > 10 && following > 100) {
        isSuspicious = true;
        reasons.push('HIGH_FOLLOWING_RATIO');
      }

      // 2. Very low followers but high following
      if (followers < 10 && following > 500) {
        isSuspicious = true;
        reasons.push('LOW_FOLLOWERS_HIGH_FOLLOWING');
      }

      // 3. Exact same followers and following (bot pattern)
      if (followers === following && followers > 0) {
        isSuspicious = true;
        reasons.push('IDENTICAL_COUNTS');
      }

      // 4. Round numbers (bot indicator)
      if (followers > 0 && followers % 100 === 0 && following > 0 && following % 100 === 0) {
        isSuspicious = true;
        reasons.push('ROUND_NUMBERS');
      }

      return {
        isSuspicious,
        reasons,
        followers,
        following,
        followingToFollowerRatio: parseFloat(followingToFollowerRatio.toFixed(2)),
        followerToFollowingRatio: parseFloat(followerToFollowingRatio.toFixed(2))
      };

    } catch (error) {
      return { isSuspicious: false, error: error.message };
    }
  }

  analyzeUsernamePattern(username) {
    try {
      let isSuspicious = false;
      const reasons = [];

      // 1. Random character patterns
      if (/^[a-zA-Z]+\d{4,}$/.test(username)) {
        isSuspicious = true;
        reasons.push('LETTERS_PLUS_NUMBERS');
      }

      // 2. Excessive numbers
      const numberCount = (username.match(/\d/g) || []).length;
      if (numberCount > username.length * 0.5) {
        isSuspicious = true;
        reasons.push('EXCESSIVE_NUMBERS');
      }

      // 3. Repetitive patterns
      if (/(.)\1{3,}/.test(username)) {
        isSuspicious = true;
        reasons.push('REPETITIVE_CHARACTERS');
      }

      // 4. Common bot patterns
      const botPatterns = ['bot', 'auto', 'gen', 'fake', 'temp', 'test'];
      if (botPatterns.some(pattern => username.toLowerCase().includes(pattern))) {
        isSuspicious = true;
        reasons.push('BOT_KEYWORDS');
      }

      // 5. Very long usernames (>15 chars often suspicious)
      if (username.length > 15) {
        isSuspicious = true;
        reasons.push('VERY_LONG_USERNAME');
      }

      return {
        isSuspicious,
        reasons,
        username,
        length: username.length,
        numberCount
      };

    } catch (error) {
      return { isSuspicious: false, error: error.message };
    }
  }

  analyzeBio(description) {
    try {
      let isSuspicious = false;
      const reasons = [];

      // 1. Empty bio (slightly suspicious)
      if (!description || description.trim().length === 0) {
        isSuspicious = true;
        reasons.push('EMPTY_BIO');
      }

      // 2. Generic bio patterns
      const genericPatterns = [
        'crypto enthusiast', 'blockchain lover', 'to the moon',
        'diamond hands', 'hodl', 'not financial advice'
      ];

      const hasGenericPattern = genericPatterns.some(pattern =>
        description && description.toLowerCase().includes(pattern)
      );

      if (hasGenericPattern) {
        reasons.push('GENERIC_CRYPTO_BIO');
      }

      // 3. Excessive emojis
      const emojiCount = (description.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]/gu) || []).length;
      if (emojiCount > 10) {
        isSuspicious = true;
        reasons.push('EXCESSIVE_EMOJIS');
      }

      return {
        isSuspicious,
        reasons,
        length: description ? description.length : 0,
        emojiCount,
        hasGenericPattern
      };

    } catch (error) {
      return { isSuspicious: false, error: error.message };
    }
  }

  analyzeTweetFrequency(publicMetrics, createdAt) {
    try {
      const tweetCount = publicMetrics.tweet_count || 0;
      const accountDate = new Date(createdAt);
      const now = new Date();
      const ageInDays = Math.max((now - accountDate) / (1000 * 60 * 60 * 24), 1);

      const tweetsPerDay = tweetCount / ageInDays;

      let isSuspicious = false;
      const reasons = [];

      // 1. Extremely high tweet frequency (>50 tweets/day)
      if (tweetsPerDay > 50) {
        isSuspicious = true;
        reasons.push('EXTREMELY_HIGH_FREQUENCY');
      }

      // 2. Very low tweet count for old account
      if (ageInDays > 365 && tweetCount < 10) {
        isSuspicious = true;
        reasons.push('OLD_ACCOUNT_LOW_TWEETS');
      }

      // 3. New account with many tweets
      if (ageInDays < 30 && tweetCount > 1000) {
        isSuspicious = true;
        reasons.push('NEW_ACCOUNT_MANY_TWEETS');
      }

      return {
        isSuspicious,
        reasons,
        tweetCount,
        ageInDays: Math.floor(ageInDays),
        tweetsPerDay: parseFloat(tweetsPerDay.toFixed(2))
      };

    } catch (error) {
      return { isSuspicious: false, error: error.message };
    }
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
    // Run all FREE checks including profile analysis
    const checks = await Promise.all([
      imageUrl ? verifier.checkContentOriginality(imageUrl, tweetData.id) :
        Promise.resolve({ isOriginal: true, confidence: 80, reason: 'NO_IMAGE' }),
      verifier.verifyEngagementLegitimacy(tweetData, tweetData.author_id),
      verifier.analyzeContent(tweetData.text || '', tweetData),
      verifier.analyzeTwitterProfile(tweetData.author_id, tweetData)
    ]);

    results.checks = {
      originality: checks[0],
      engagement: checks[1],
      content: checks[2],
      profile: checks[3]
    };

    // Calculate overall confidence
    const confidenceScores = checks.map(check => check.confidence).filter(score => score > 0);
    results.overallConfidence = confidenceScores.length > 0
      ? confidenceScores.reduce((a, b) => a + b) / confidenceScores.length
      : 0;

    // Determine verification status (now includes profile check)
    results.aiVerified = checks[0].isOriginal &&
      checks[1].isLegitimate &&
      checks[2].isAppropriate &&
      checks[3].isLegitimate;

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
