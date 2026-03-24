from fastapi import FastAPI, File, UploadFile, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import ezdxf
import os
import time
import math
from typing import List

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

@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    filename = f"{int(time.time())}_{file.filename}"
    filepath = os.path.join("uploads", filename)
    with open(filepath, "wb") as f:
        f.write(await file.read())
    mock_detected_elements = [
        {"type": "pipe", "x1": 100, "y1": 300, "x2": 250, "y2": 300},
        {"type": "sleeve", "x": 250, "y": 300},
        {"type": "pipe", "x1": 250, "y1": 300, "x2": 450, "y2": 300},
        {"type": "meter", "x": 450, "y": 300},
        {"type": "pipe", "x1": 450, "y1": 300, "x2": 650, "y2": 300},
        {"type": "valve", "x": 650, "y": 300},
        {"type": "pipe", "x1": 650, "y1": 300, "x2": 800, "y2": 300},
    ]
    return {"imageUrl": f"/uploads/{filename}", "elements": mock_detected_elements}

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
            add_lines('SYMBOLS', item.color, cx, cy, [(-15, 0, 15, 0)], item.angle)
            msp.add_arc(get_rotated_pts(cx, cy, [(cx-15, cy)], item.angle)[0], radius=10, start_angle=90-item.angle, end_angle=270-item.angle, dxfattribs=get_attribs('SYMBOLS', item.color))
            msp.add_arc(get_rotated_pts(cx, cy, [(cx+15, cy)], item.angle)[0], radius=10, start_angle=-90-item.angle, end_angle=90-item.angle, dxfattribs=get_attribs('SYMBOLS', item.color))
        elif item.type == 'short_a':
            add_lines('SYMBOLS', item.color, cx, cy, [(-20, -15, -20, 15), (-20, 0, 15, 0)], item.angle)
            msp.add_arc(get_rotated_pts(cx, cy, [(cx+15, cy)], item.angle)[0], radius=10, start_angle=-90-item.angle, end_angle=90-item.angle, dxfattribs=get_attribs('SYMBOLS', item.color))
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