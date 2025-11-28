// Conditionally import Analytics models (only if MongoDB is configured)
let MemeGeneration, UserSession, TemplatePerformance, ConversionEvent, FeatureUsage;
let analyticsEnabled = false;

try {
  const analyticsModels = await import('../models/Analytics.js');
  MemeGeneration = analyticsModels.MemeGeneration;
  UserSession = analyticsModels.UserSession;
  TemplatePerformance = analyticsModels.TemplatePerformance;
  ConversionEvent = analyticsModels.ConversionEvent;
  FeatureUsage = analyticsModels.FeatureUsage;
  analyticsEnabled = true;
} catch (error) {
  console.warn('⚠️  Analytics tracking disabled (MongoDB/Mongoose not installed)');
}

// TRACK MEME GENERATION
export async function trackMemeGeneration(data) {
  if (!analyticsEnabled) {
    return null; // Silently skip if analytics not enabled
  }

  try {
    const memeEvent = new MemeGeneration({
      userId: data.userId || data.sessionId,
      tier: data.tier || 'free',
      isAnonymous: !data.userId,
      
      templateId: data.templateId,
      templateName: data.templateName,
      templateSource: data.templateSource,
      templateCategory: data.templateCategory,
      templateQualityScore: data.templateQualityScore,
      templateRank: data.templateRank,
      
      generationMode: data.generationMode || 'template',
      userPrompt: data.userPrompt,
      aiModel: data.aiModel,
      aiGeneratedText: data.aiGeneratedText,
      
      generationTimeMs: data.generationTimeMs,
      
      sessionId: data.sessionId,
      deviceType: data.deviceType,
      browser: data.browser,
      country: data.country,
      
      experimentId: data.experimentId,
      variantId: data.variantId
    });
    
    await memeEvent.save();
    
    // Update template performance asynchronously
    updateTemplatePerformance(data.templateId, data.templateName, data.templateSource, data.tier);
    
    return memeEvent;
  } catch (error) {
    console.error('Error tracking meme generation:', error);
    // Don't throw - analytics should never break the app
    return null;
  }
}

// UPDATE TEMPLATE PERFORMANCE
async function updateTemplatePerformance(templateId, templateName, templateSource, tier) {
  try {
    const update = {
      templateName,
      templateSource,
      $inc: { 
        totalGenerations: 1,
        [`${tier}UserGenerations`]: 1
      },
      lastUsedAt: new Date()
    };
    
    await TemplatePerformance.findOneAndUpdate(
      { templateId },
      update,
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Error updating template performance:', error);
  }
}

// TRACK MEME DOWNLOAD
export async function trackMemeDownload(memeId, templateId) {
  if (!analyticsEnabled) return null;

  try {
    // Update meme generation record
    await MemeGeneration.findByIdAndUpdate(memeId, { wasDownloaded: true });
    
    // Update template performance
    await TemplatePerformance.findOneAndUpdate(
      { templateId },
      { $inc: { totalDownloads: 1 } }
    );
  } catch (error) {
    console.error('Error tracking download:', error);
  }
}

// TRACK MEME SHARE
export async function trackMemeShare(memeId, templateId) {
  if (!analyticsEnabled) return null;

  try {
    await MemeGeneration.findByIdAndUpdate(memeId, { wasShared: true });
    await TemplatePerformance.findOneAndUpdate(
      { templateId },
      { $inc: { totalShares: 1 } }
    );
  } catch (error) {
    console.error('Error tracking share:', error);
  }
}

// TRACK USER SESSION
export async function trackSession(sessionData) {
  if (!analyticsEnabled) return null;

  try {
    const session = await UserSession.findOneAndUpdate(
      { sessionId: sessionData.sessionId },
      {
        $set: {
          userId: sessionData.userId,
          tier: sessionData.tier,
          deviceType: sessionData.deviceType,
          browser: sessionData.browser,
          country: sessionData.country,
          referrer: sessionData.referrer,
          lastActivityAt: new Date()
        },
        $setOnInsert: {
          startedAt: new Date()
        }
      },
      { upsert: true, new: true }
    );
    
    return session;
  } catch (error) {
    console.error('Error tracking session:', error);
    return null;
  }
}

// UPDATE SESSION ACTIVITY
export async function updateSessionActivity(sessionId, activity) {
  if (!analyticsEnabled) return null;

  try {
    const update = {
      lastActivityAt: new Date(),
      $inc: {}
    };
    
    if (activity.memeGenerated) update.$inc.memesGenerated = 1;
    if (activity.memeDownloaded) update.$inc.memesDownloaded = 1;
    if (activity.templateViewed) update.$inc.templatesViewed = 1;
    if (activity.searchPerformed) update.$inc.searchesPerformed = 1;
    if (activity.pageViewed) update.$inc.pagesViewed = 1;
    
    await UserSession.findOneAndUpdate({ sessionId }, update);
  } catch (error) {
    console.error('Error updating session activity:', error);
  }
}

// TRACK CONVERSION
export async function trackConversion(conversionData) {
  if (!analyticsEnabled) return null;

  try {
    const conversion = new ConversionEvent({
      userId: conversionData.userId,
      sessionId: conversionData.sessionId,
      fromTier: conversionData.fromTier,
      toTier: conversionData.toTier,
      conversionType: conversionData.conversionType,
      amountUSD: conversionData.amountUSD,
      amountWLO: conversionData.amountWLO,
      trigger: conversionData.trigger,
      referrer: conversionData.referrer
    });
    
    await conversion.save();
    return conversion;
  } catch (error) {
    console.error('Error tracking conversion:', error);
    return null;
  }
}

// TRACK FEATURE USAGE
export async function trackFeatureUsage(featureName, userId, tier) {
  if (!analyticsEnabled) return null;

  try {
    await FeatureUsage.findOneAndUpdate(
      { featureName, userId },
      {
        $set: { tier, lastUsedAt: new Date() },
        $inc: { usageCount: 1 },
        $setOnInsert: { firstUsedAt: new Date() }
      },
      { upsert: true }
    );
  } catch (error) {
    console.error('Error tracking feature usage:', error);
  }
}

