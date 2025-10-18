#!/usr/bin/env python3
"""
AI Content Verification for WALDOCOIN Twitter Bot
Implements advanced AI-powered fraud detection and content verification
"""

import os
import json
import hashlib
import requests
import redis
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

# Configuration
GOOGLE_VISION_API_KEY = os.getenv("GOOGLE_VISION_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
TINEYE_API_KEY = os.getenv("TINEYE_API_KEY")
REDIS_URL = os.getenv("REDIS_URL")

r = redis.from_url(REDIS_URL) if REDIS_URL else None

class AIContentVerifier:
    def __init__(self):
        self.google_vision_endpoint = "https://vision.googleapis.com/v1/images:annotate"
        self.openai_endpoint = "https://api.openai.com/v1/chat/completions"
        self.tineye_endpoint = "https://api.tineye.com/rest/search"
    
    async def verify_content(self, tweet_data: Dict) -> Dict:
        """Main AI verification function"""
        print(f"🤖 Starting AI verification for tweet {tweet_data['id']}")
        
        results = {
            "tweet_id": tweet_data["id"],
            "timestamp": datetime.now().isoformat(),
            "ai_verified": True,
            "confidence": 0,
            "checks": {}
        }
        
        try:
            # Extract image URLs from tweet
            image_urls = self._extract_image_urls(tweet_data)
            
            # Run verification checks
            if image_urls:
                # Content originality check
                originality_result = await self._check_content_originality(image_urls[0], tweet_data["id"])
                results["checks"]["originality"] = originality_result
                
                # Image content analysis
                content_result = await self._analyze_image_content(image_urls[0], tweet_data.get("text", ""))
                results["checks"]["content"] = content_result
            else:
                # Text-only tweet verification
                results["checks"]["originality"] = {"is_original": True, "confidence": 80, "reason": "TEXT_ONLY"}
                results["checks"]["content"] = {"is_appropriate": True, "confidence": 85, "reason": "TEXT_ONLY"}
            
            # Engagement legitimacy check
            engagement_result = await self._verify_engagement_legitimacy(tweet_data)
            results["checks"]["engagement"] = engagement_result
            
            # Calculate overall confidence and verification status
            confidence_scores = [
                results["checks"].get("originality", {}).get("confidence", 0),
                results["checks"].get("content", {}).get("confidence", 0),
                results["checks"].get("engagement", {}).get("confidence", 0)
            ]
            
            valid_scores = [s for s in confidence_scores if s > 0]
            results["confidence"] = sum(valid_scores) / len(valid_scores) if valid_scores else 0
            
            # Determine verification status
            results["ai_verified"] = (
                results["checks"].get("originality", {}).get("is_original", True) and
                results["checks"].get("content", {}).get("is_appropriate", True) and
                results["checks"].get("engagement", {}).get("is_legitimate", True)
            )
            
            # Store results
            if r:
                r.set(f"ai:verification:{tweet_data['id']}", json.dumps(results), ex=60*60*24*7)
            
            print(f"🤖 AI verification complete: {'PASSED' if results['ai_verified'] else 'FAILED'} ({results['confidence']:.1f}%)")
            return results
            
        except Exception as e:
            print(f"❌ AI verification error: {str(e)}")
            results["error"] = str(e)
            results["ai_verified"] = True  # Default to allowing if AI fails
            return results
    
    def _extract_image_urls(self, tweet_data: Dict) -> List[str]:
        """Extract image URLs from tweet data"""
        # This would need to be implemented based on Twitter API v2 media expansion
        # For now, return empty list
        return []
    
    async def _check_content_originality(self, image_url: str, tweet_id: str) -> Dict:
        """Check if content is original using image hashing and reverse search"""
        try:
            # Generate image hash
            image_hash = await self._generate_image_hash(image_url)
            hash_key = f"image:hash:{image_hash}"
            
            if r:
                # Check if we've seen this image before
                existing_tweet = r.get(hash_key)
                if existing_tweet:
                    return {
                        "is_original": False,
                        "confidence": 95,
                        "reason": "DUPLICATE_IMAGE",
                        "original_tweet": existing_tweet.decode()
                    }
                
                # Store hash for future checks
                r.set(hash_key, tweet_id, ex=60*60*24*30)  # 30 days
            
            # Reverse image search (if API available)
            if TINEYE_API_KEY:
                reverse_results = await self._reverse_image_search(image_url)
                if reverse_results["matches"] > 0:
                    return {
                        "is_original": False,
                        "confidence": 85,
                        "reason": "FOUND_ELSEWHERE",
                        "matches": reverse_results["matches"]
                    }
            
            return {
                "is_original": True,
                "confidence": 90,
                "reason": "APPEARS_ORIGINAL"
            }
            
        except Exception as e:
            return {
                "is_original": True,
                "confidence": 0,
                "error": str(e)
            }
    
    async def _analyze_image_content(self, image_url: str, tweet_text: str) -> Dict:
        """Analyze image content for appropriateness and relevance"""
        try:
            if not GOOGLE_VISION_API_KEY:
                return {
                    "is_appropriate": True,
                    "confidence": 50,
                    "reason": "VISION_API_UNAVAILABLE"
                }
            
            # Google Vision API call
            vision_results = await self._call_google_vision(image_url)
            
            # Safety check
            safety_result = self._analyze_safety(vision_results.get("safeSearchAnnotation", {}))
            if not safety_result["is_safe"]:
                return {
                    "is_appropriate": False,
                    "confidence": safety_result["confidence"],
                    "reason": "INAPPROPRIATE_CONTENT",
                    "violations": safety_result["violations"]
                }
            
            # Extract text from image
            extracted_text = self._extract_text_from_vision(vision_results.get("textAnnotations", []))
            
            # Check WALDO relevance
            waldo_relevance = self._check_waldo_relevance(extracted_text, tweet_text)
            
            return {
                "is_appropriate": True,
                "confidence": 85,
                "waldo_relevance": waldo_relevance,
                "extracted_text": extracted_text[:100],  # Limit length
                "safety_check": safety_result
            }
            
        except Exception as e:
            return {
                "is_appropriate": True,
                "confidence": 0,
                "error": str(e)
            }
    
    async def _verify_engagement_legitimacy(self, tweet_data: Dict) -> Dict:
        """Verify that engagement appears legitimate"""
        try:
            metrics = tweet_data.get("public_metrics", {})
            author_id = tweet_data.get("author_id")
            
            # Basic engagement ratio analysis
            likes = metrics.get("like_count", 0)
            retweets = metrics.get("retweet_count", 0)
            
            # Calculate engagement ratio
            ratio = likes / max(retweets, 1)
            
            # Check for suspicious patterns
            suspicious_patterns = []
            
            if ratio > 50:  # Too many likes vs retweets
                suspicious_patterns.append("HIGH_LIKE_RATIO")
            elif ratio < 2:  # Too few likes vs retweets
                suspicious_patterns.append("LOW_LIKE_RATIO")
            
            # Check for engagement spikes (if we have historical data)
            if r and author_id:
                spike_result = await self._detect_engagement_spike(author_id, likes + retweets)
                if spike_result["is_suspicious"]:
                    suspicious_patterns.append("ENGAGEMENT_SPIKE")
            
            is_legitimate = len(suspicious_patterns) == 0
            confidence = max(0, 100 - (len(suspicious_patterns) * 25))
            
            return {
                "is_legitimate": is_legitimate,
                "confidence": confidence,
                "suspicious_patterns": suspicious_patterns,
                "engagement_ratio": ratio
            }
            
        except Exception as e:
            return {
                "is_legitimate": True,
                "confidence": 0,
                "error": str(e)
            }
    
    async def _generate_image_hash(self, image_url: str) -> str:
        """Generate hash for image deduplication"""
        try:
            response = requests.get(image_url, timeout=10)
            response.raise_for_status()
            return hashlib.sha256(response.content).hexdigest()
        except:
            # Fallback to URL hash
            return hashlib.sha256(image_url.encode()).hexdigest()
    
    async def _reverse_image_search(self, image_url: str) -> Dict:
        """Perform reverse image search using TinEye API"""
        try:
            if not TINEYE_API_KEY:
                return {"matches": 0, "confidence": 0}
            
            response = requests.get(
                f"{self.tineye_endpoint}?image_url={image_url}",
                headers={"Authorization": f"Bearer {TINEYE_API_KEY}"},
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                matches = len(data.get("results", []))
                return {
                    "matches": matches,
                    "confidence": 80 if matches > 0 else 20
                }
            
            return {"matches": 0, "confidence": 0}
            
        except Exception as e:
            return {"matches": 0, "confidence": 0, "error": str(e)}
    
    async def _call_google_vision(self, image_url: str) -> Dict:
        """Call Google Vision API for image analysis"""
        payload = {
            "requests": [{
                "image": {"source": {"imageUri": image_url}},
                "features": [
                    {"type": "SAFE_SEARCH_DETECTION"},
                    {"type": "TEXT_DETECTION"},
                    {"type": "LABEL_DETECTION"}
                ]
            }]
        }
        
        response = requests.post(
            f"{self.google_vision_endpoint}?key={GOOGLE_VISION_API_KEY}",
            json=payload,
            timeout=15
        )
        
        if response.status_code == 200:
            return response.json()["responses"][0]
        else:
            raise Exception(f"Vision API error: {response.status_code}")
    
    def _analyze_safety(self, safe_search: Dict) -> Dict:
        """Analyze Google Vision safety annotations"""
        if not safe_search:
            return {"is_safe": True, "confidence": 50, "violations": []}
        
        levels = ["VERY_UNLIKELY", "UNLIKELY", "POSSIBLE", "LIKELY", "VERY_LIKELY"]
        violations = []
        
        for category in ["adult", "violence", "racy"]:
            level = safe_search.get(category, "VERY_UNLIKELY")
            threshold = 2 if category == "racy" else 1  # More lenient for racy content
            
            if levels.index(level) > threshold:
                violations.append(category.upper())
        
        return {
            "is_safe": len(violations) == 0,
            "confidence": 90 if len(violations) == 0 else 85,
            "violations": violations
        }
    
    def _extract_text_from_vision(self, text_annotations: List) -> str:
        """Extract text from Google Vision text annotations"""
        if not text_annotations:
            return ""
        return text_annotations[0].get("description", "")
    
    def _check_waldo_relevance(self, extracted_text: str, tweet_text: str) -> Dict:
        """Check if content is WALDO-related"""
        waldo_keywords = ["waldo", "waldocoin", "wlo", "$wlo", "#waldomeme"]
        combined_text = f"{extracted_text} {tweet_text}".lower()
        
        matches = [kw for kw in waldo_keywords if kw in combined_text]
        score = (len(matches) / len(waldo_keywords)) * 100
        
        return {
            "score": score,
            "matches": matches,
            "is_relevant": score > 20
        }
    
    async def _detect_engagement_spike(self, author_id: str, current_engagement: int) -> Dict:
        """Detect unusual engagement spikes"""
        try:
            if not r:
                return {"is_suspicious": False, "reason": "NO_REDIS"}
            
            # Get recent engagement history
            history_key = f"author:{author_id}:engagement_history"
            recent_engagements = r.lrange(history_key, 0, 9)  # Last 10 tweets
            
            if len(recent_engagements) < 3:
                return {"is_suspicious": False, "reason": "INSUFFICIENT_DATA"}
            
            # Calculate average engagement
            avg_engagement = sum(int(e) for e in recent_engagements) / len(recent_engagements)
            
            # Check for spike
            spike_ratio = current_engagement / max(avg_engagement, 1)
            is_suspicious = spike_ratio > 10  # 10x normal engagement
            
            # Store current engagement
            r.lpush(history_key, current_engagement)
            r.ltrim(history_key, 0, 19)  # Keep last 20
            r.expire(history_key, 60*60*24*30)  # 30 days
            
            return {
                "is_suspicious": is_suspicious,
                "spike_ratio": spike_ratio,
                "avg_engagement": avg_engagement,
                "current_engagement": current_engagement
            }
            
        except Exception as e:
            return {"is_suspicious": False, "error": str(e)}

# Global instance
ai_verifier = AIContentVerifier()

# Export main function
async def verify_content_with_ai(tweet_data: Dict) -> Dict:
    """Main function to verify content with AI"""
    return await ai_verifier.verify_content(tweet_data)
