import mongoose from 'mongoose';

// MEME GENERATION EVENT - Track every meme created
const memeGenerationSchema = new mongoose.Schema({
  // User Info
  userId: { type: String, index: true }, // Wallet address or session ID
  tier: { type: String, enum: ['free', 'waldocoin', 'premium', 'gold', 'platinum', 'king'], index: true },
  isAnonymous: { type: Boolean, default: true },
  
  // Meme Details
  templateId: { type: String, index: true },
  templateName: { type: String },
  templateSource: { type: String }, // imgflip, memegen, etc.
  templateCategory: [{ type: String }],
  templateQualityScore: { type: Number },
  templateRank: { type: Number },
  
  // Generation Method
  generationMode: { type: String, enum: ['ai', 'manual', 'template', 'image'], index: true },
  userPrompt: { type: String }, // What user typed
  aiModel: { type: String }, // groq, openai, etc.
  aiGeneratedText: { type: String }, // What AI generated
  
  // Engagement Metrics
  generationTimeMs: { type: Number }, // How long it took
  wasDownloaded: { type: Boolean, default: false },
  wasShared: { type: Boolean, default: false },
  wasRegenerated: { type: Boolean, default: false },
  
  // Session Info
  sessionId: { type: String, index: true },
  deviceType: { type: String }, // mobile, desktop, tablet
  browser: { type: String },
  country: { type: String },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now, index: true },
  
  // A/B Testing
  experimentId: { type: String },
  variantId: { type: String }
}, {
  timestamps: true
});

// USER SESSION - Track user sessions
const userSessionSchema = new mongoose.Schema({
  sessionId: { type: String, unique: true, index: true },
  userId: { type: String, index: true },
  tier: { type: String },
  
  // Session Metrics
  memesGenerated: { type: Number, default: 0 },
  memesDownloaded: { type: Number, default: 0 },
  templatesViewed: { type: Number, default: 0 },
  searchesPerformed: { type: Number, default: 0 },
  
  // Engagement
  sessionDurationMs: { type: Number },
  pagesViewed: { type: Number, default: 0 },
  
  // Conversion Tracking
  sawUpgradePrompt: { type: Boolean, default: false },
  clickedUpgrade: { type: Boolean, default: false },
  completedUpgrade: { type: Boolean, default: false },
  
  // Device Info
  deviceType: { type: String },
  browser: { type: String },
  country: { type: String },
  referrer: { type: String },
  
  // Timestamps
  startedAt: { type: Date, default: Date.now },
  lastActivityAt: { type: Date, default: Date.now },
  endedAt: { type: Date }
}, {
  timestamps: true
});

// TEMPLATE PERFORMANCE - Aggregate template stats
const templatePerformanceSchema = new mongoose.Schema({
  templateId: { type: String, unique: true, index: true },
  templateName: { type: String },
  templateSource: { type: String },
  
  // Usage Stats
  totalGenerations: { type: Number, default: 0 },
  totalDownloads: { type: Number, default: 0 },
  totalShares: { type: Number, default: 0 },
  
  // Performance Metrics
  averageGenerationTime: { type: Number },
  downloadRate: { type: Number }, // % of generations that were downloaded
  shareRate: { type: Number },
  regenerationRate: { type: Number },
  
  // Tier Breakdown
  freeUserGenerations: { type: Number, default: 0 },
  waldocoinUserGenerations: { type: Number, default: 0 },
  premiumUserGenerations: { type: Number, default: 0 },
  
  // Trending Score (calculated)
  trendingScore: { type: Number, default: 0 },
  
  // Last Updated
  lastUsedAt: { type: Date },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// CONVERSION EVENT - Track tier upgrades
const conversionEventSchema = new mongoose.Schema({
  userId: { type: String, index: true },
  sessionId: { type: String },
  
  // Conversion Details
  fromTier: { type: String },
  toTier: { type: String },
  conversionType: { type: String, enum: ['purchase', 'token_hold', 'nft_hold'] },
  
  // Revenue
  amountUSD: { type: Number },
  amountWLO: { type: Number },
  
  // Attribution
  trigger: { type: String }, // What caused the upgrade (limit_reached, feature_locked, etc.)
  referrer: { type: String },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// FEATURE USAGE - Track which features are used
const featureUsageSchema = new mongoose.Schema({
  featureName: { type: String, index: true },
  userId: { type: String, index: true },
  tier: { type: String },
  
  // Usage Count
  usageCount: { type: Number, default: 1 },
  
  // Timestamps
  firstUsedAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

export const MemeGeneration = mongoose.model('MemeGeneration', memeGenerationSchema);
export const UserSession = mongoose.model('UserSession', userSessionSchema);
export const TemplatePerformance = mongoose.model('TemplatePerformance', templatePerformanceSchema);
export const ConversionEvent = mongoose.model('ConversionEvent', conversionEventSchema);
export const FeatureUsage = mongoose.model('FeatureUsage', featureUsageSchema);

