# Build from the repository root: docker build -f backend/Dockerfile .
FROM python:3.11-slim

# cpu (default, small image) or a CUDA build such as cu128 for NVIDIA GPUs
ARG TORCH_VARIANT=cpu

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

WORKDIR /app
RUN pip install torch --index-url https://download.pytorch.org/whl/${TORCH_VARIANT}
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend backend
COPY samples samples

WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
