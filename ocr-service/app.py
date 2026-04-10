from fastapi import FastAPI
from pydantic import BaseModel
import easyocr
import base64, io
from PIL import Image
import numpy as np

app = FastAPI()
reader = easyocr.Reader(['en'], gpu=False)

class ImageRequest(BaseModel):
    image: str

@app.post("/ocr")
async def do_ocr(req: ImageRequest):
    try:
        b64 = req.image.split(",")[-1]
        img_bytes = base64.b64decode(b64)
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        img_np = np.array(img)
        
        result = reader.readtext(img_np)
        print("[EasyOCR raw]", result)
        
        texts = [item[1] for item in result if item[2] > 0.1]
        text = " ".join(texts).strip()
        print("[EasyOCR text]", text)
        return {"text": text, "confidence": 90}
    except Exception as e:
        import traceback
        print("[EasyOCR ERROR]", traceback.format_exc())
        return {"text": "", "error": str(e)}

@app.get("/health")
def health():
    return {"status": "ok"}
