FROM python:3.12-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install the supercompress Python library from PyPI
RUN pip install --no-cache-dir supercompress

# Install API server dependencies
RUN pip install --no-cache-dir fastapi uvicorn[standard] pydantic httpx firebase-admin

# Copy API server code and static files
COPY . .

ENV HOST=0.0.0.0
ENV PORT=8790
ENV SC_KEY_STORE=file
ENV SC_KEY_STORE_FILE=/data/api_keys.json

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8790

CMD ["python", "scripts/local_web_server.py"]
