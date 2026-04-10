FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 \
    libgl1 wget curl \
    && rm -rf /var/lib/apt/lists/*

RUN pip install easyocr fastapi uvicorn python-multipart pillow

WORKDIR /app
COPY app.py .

EXPOSE 8001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
