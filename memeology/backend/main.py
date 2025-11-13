"""
Memeology Backend API Worker
FastAPI server for meme generation and AI suggestions
Part of WALDO LABS ecosystem
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import os
from typing import Optional

app = FastAPI(title="Memeology API", description="AI-Powered Meme Generator by WALDO LABS")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "https://memeology.fun"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class MemeCreateRequest(BaseModel):
    template_id: str
    text_top: str
    text_bottom: str
    user_id: Optional[str] = None

class AISuggestRequest(BaseModel):
    message: str
    user_id: Optional[str] = None
    ai_model: str = "groq"

# Imgflip API credentials (get from env or use defaults)
IMGFLIP_USERNAME = os.getenv("IMGFLIP_USERNAME", "waldolabs")
IMGFLIP_PASSWORD = os.getenv("IMGFLIP_PASSWORD", "waldolabs123")

@app.get("/")
async def root():
    return {
        "service": "Memeology API",
        "version": "1.0.0",
        "by": "WALDO LABS",
        "status": "running"
    }

@app.get("/api/templates/imgflip")
async def get_imgflip_templates():
    """Fetch popular meme templates from Imgflip"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("https://api.imgflip.com/get_memes")
            data = response.json()
            
            if data.get("success"):
                return {"memes": data["data"]["memes"][:50]}  # Return top 50
            else:
                raise HTTPException(status_code=500, detail="Failed to fetch templates")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/memes/create")
async def create_meme(request: MemeCreateRequest):
    """Generate a meme using Imgflip API"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.imgflip.com/caption_image",
                data={
                    "template_id": request.template_id,
                    "username": IMGFLIP_USERNAME,
                    "password": IMGFLIP_PASSWORD,
                    "text0": request.text_top,
                    "text1": request.text_bottom,
                }
            )
            data = response.json()
            
            if data.get("success"):
                return {
                    "success": True,
                    "image_url": data["data"]["url"],
                    "page_url": data["data"]["page_url"]
                }
            else:
                raise HTTPException(status_code=400, detail=data.get("error_message", "Failed to create meme"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ai/suggest")
async def ai_suggest(request: AISuggestRequest):
    """Get AI suggestions for meme ideas"""
    try:
        # For now, return a simple response
        # TODO: Integrate with Groq, Claude, or Ollama
        suggestions = {
            "groq": "Try using the 'Distracted Boyfriend' template with text about crypto!",
            "claude": "How about a 'Drake Hotline Bling' meme comparing traditional finance vs DeFi?",
            "ollama": "The 'Two Buttons' template works great for decision-making memes!"
        }
        
        suggestion = suggestions.get(request.ai_model, suggestions["groq"])
        
        return {
            "success": True,
            "suggestion": f"💡 {suggestion}",
            "model": request.ai_model
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/premium/status")
async def check_premium_status(user_id: str):
    """Check if user has premium access"""
    # TODO: Integrate with waldocoin backend to check WLO/XRP holdings
    return {
        "isPremium": False,
        "user_id": user_id
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

