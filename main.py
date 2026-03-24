import os
import time
import math
import json
from typing import List
from fastapi import FastAPI, File, UploadFile, Request, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ezdxf
from google import genai
from google.genai import types

app = FastAPI()

os.makedirs("uploads", exist_ok=True)
os.makedirs("output", exist_ok=True)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

class CADItem(BaseModel):
    type: str
    x: float = 0
    y: float = 0
    x1: float = 0
    y1: float = 0
    x2: float = 0
    y2: float = 0
    color: str = None
    text: str = None
    angle: float = 0

class DXFRequest(BaseModel):
    items: List[CADItem]

@app.get("/")
async def serve_root():
    return FileResponse("static/index.html")

@app.post("/upload")
async def upload_image(file: UploadFile = File(...), api_key: str = Form(None)):
    filename = f"{int(time.time())}_{file.filename}"
    filepath = os.path.join("uploads", filename)
    with open(filepath, "wb") as f:
        f.write(await file.read())
    
    elements = []
    
    # Check if Gemini API key is configured
    api_key = api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Warning: GEMINI_API_KEY is not set. Using mock response.")
        return {"imageUrl": f"/uploads/{filename}", "elements": [], "error": "未提供 Google Gemini API 金鑰，請在畫面上方輸入。"}
    
    try:
        from PIL import Image
        import io
        
        # Load the image for Gemini
        img = Image.open(filepath)
        width, height = img.size
        
        # Initialize Gemini Client
        client = genai.Client(api_key=api_key)
        
        prompt = f"""
        You are an expert CAD engineer analyzing a hand-drawn water piping schematic.
        The image dimensions are {width}x{height} pixels.
        Analyze the image and return ONLY a JSON array of detected elements.
        
        Supported 'type' values and required coordinates:
        1. "pipe" -> needs x1, y1 (start) and x2, y2 (end).
        2. "meter" (水量計) -> needs x, y (center).
        3. "valve" (彈性座封閘閥 / square with X) -> needs x, y.
        4. "sleeve" (套管 / double curve joints) -> needs x, y.
        5. "reducer" (大小頭 / trapezoid) -> needs x, y.
        6. "tee" (丁字管) -> needs x, y.
        7. "elbow90" (90°彎頭) -> needs x, y.
        8. "elbow45" (45°彎頭) -> needs x, y.
        9. "quick_release" (快拆) -> needs x, y.
        10. "short_a" (短甲) -> needs x, y.
        11. "short_b" (短乙) -> needs x, y.
        
        Return pure JSON array, e.g. [{{"type": "pipe", "x1": 100, "y1": 200, "x2": 300, "y2": 200}}, {{"type": "valve", "x": 300, "y": 200}}]. 
        Do not use markdown blocks.
        """
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[img, prompt],
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json"
            )
        )
        
        # Parse JSON array returned by Gemini
        import json
        elements = json.loads(response.text)
        print(f"Gemini successfully detected {len(elements)} elements.")
        
    except Exception as e:
        print(f"Gemini AI Error: {e}")
        elements = [] # fallback to empty if AI fails
        
    return {"imageUrl": f"/uploads/{filename}", "elements": elements, "width": width, "height": height}

@app.post("/generate")
async def generate_dxf(req: DXFRequest):
    doc = ezdxf.new('R2010')
    doc.layers.add('PIPES', color=7)
    doc.layers.add('SYMBOLS', color=5)
    doc.layers.add('TEXT', color=7)
    doc.layers.add('POINTERS', color=6)
    msp = doc.modelspace()
    
    def get_attribs(layer, hex_color=None):
        attribs = {'layer': layer}
        if hex_color and hex_color.startswith('#'):
            try: attribs['true_color'] = int(hex_color[1:], 16)
            except: pass
        return attribs
        
    def get_rotated_pts(cx, cy, pts, angle_deg):
        rad = math.radians(-angle_deg)
        out = []
        for (px, py) in pts:
            tx, ty = px - cx, py - cy
            rx = tx * math.cos(rad) - ty * math.sin(rad)
            ry = tx * math.sin(rad) + ty * math.cos(rad)
            out.append((cx + rx, cy + ry))
        return out

    def add_lines(layer, color, cx, cy, lines, angle_deg):
        attribs = get_attribs(layer, color)
        for (x1, y1, x2, y2) in lines:
            pts = get_rotated_pts(cx, cy, [(cx+x1, cy+y1), (cx+x2, cy+y2)], angle_deg)
            msp.add_line(pts[0], pts[1], dxfattribs=attribs)

    for item in req.items:
        cx, cy = item.x, -item.y
        if item.type == 'pipe':
            msp.add_line((item.x1, -item.y1), (item.x2, -item.y2), dxfattribs=get_attribs('PIPES', item.color))
        elif item.type == 'meter':
            add_lines('SYMBOLS', item.color, cx, cy, [(-30, -15, -30, 15), (-30, 0, -15, 0), (15, 0, 30, 0), (30, -15, 30, 15)], item.angle)
            msp.add_circle((cx, cy), radius=15, dxfattribs=get_attribs('SYMBOLS', item.color))
            attribs = get_attribs('SYMBOLS', item.color)
            attribs['height'] = 12
            attribs['rotation'] = -item.angle
            txt = msp.add_text("M", dxfattribs=attribs)
            txt.set_placement(get_rotated_pts(cx, cy, [(cx-6, cy-6)], item.angle)[0])
        elif item.type == 'valve':
            add_lines('SYMBOLS', item.color, cx, cy, [
                (-20, -20, 20, -20), (20, -20, 20, 20), (20, 20, -20, 20), (-20, 20, -20, -20),
                (-20, -20, 20, 20), (-20, 20, 20, -20)
            ], item.angle)
        elif item.type == 'sleeve':
            add_lines('SYMBOLS', item.color, cx, cy, [
                (-15, -20, -15, -8), (-15, -8, -5, -8), (-5, -8, -5, 8), (-5, 8, -15, 8), (-15, 8, -15, 20),
                (15, -20, 15, -8), (15, -8, 5, -8), (5, -8, 5, 8), (5, 8, 15, 8), (15, 8, 15, 20),
                (-5, 0, 5, 0)
            ], item.angle)
        elif item.type == 'short_a':
            add_lines('SYMBOLS', item.color, cx, cy, [
                (-15, -20, -15, 20), (-15, 0, 5, 0),
                (15, -20, 15, -8), (15, -8, 5, -8), (5, -8, 5, 8), (5, 8, 15, 8), (15, 8, 15, 20)
            ], item.angle)
        elif item.type == 'short_b':
            add_lines('SYMBOLS', item.color, cx, cy, [(-20, -15, -20, 15), (-20, 0, 20, 0)], item.angle)
        elif item.type == 'reducer':
            add_lines('SYMBOLS', item.color, cx, cy, [
                (-15, -15, -15, 15), (15, -8, 15, 8), (-15, -15, 15, -8), (-15, 15, 15, 8)
            ], item.angle)
        elif item.type == 'tee':
            add_lines('SYMBOLS', item.color, cx, cy, [
                (-20, 0, 20, 0), (0, 0, 0, -20), 
                (-20, -10, -20, 10), (20, -10, 20, 10), (-10, -20, 10, -20)
            ], item.angle)
        elif item.type == 'elbow90':
            add_lines('SYMBOLS', item.color, cx, cy, [
                (-15, 15, -15, -15), (-15, -15, 15, -15),
                (-25, 15, -5, 15), (15, -25, 15, -5)
            ], item.angle)
        elif item.type == 'elbow45':
            add_lines('SYMBOLS', item.color, cx, cy, [
                (-15, 0, 0, 0), (0, 0, 15, -15),
                (-15, -10, -15, 10), (8, -22, 22, -8)
            ], item.angle)
        elif item.type == 'quick_release':
            add_lines('SYMBOLS', item.color, cx, cy, [
                (-15, 0, 15, 0), (-15, -15, -15, 15), (0, -12, 0, 12), (15, -15, 15, 15)
            ], item.angle)
        elif item.type == 'text':
            attribs = get_attribs('TEXT', item.color)
            attribs['height'] = 16
            attribs['rotation'] = -item.angle
            msp.add_text(item.text or "Text", dxfattribs=attribs).set_placement((cx, cy - 16))
        elif item.type == 'arrow':
            add_lines('POINTERS', item.color, cx, cy, [
                (-20, 0, 20, 0), (20, 0, 10, 5), (20, 0, 10, -5)
            ], item.angle)

    filename = f"output_{int(time.time())}.dxf"
    filepath = os.path.join("output", filename)
    doc.saveas(filepath)
    return {"downloadUrl": f"/download/{filename}"}

@app.get("/download/{filename}")
async def download_file(filename: str):
    filepath = os.path.join("output", filename)
    return FileResponse(filepath, media_type='application/dxf', filename=filename)