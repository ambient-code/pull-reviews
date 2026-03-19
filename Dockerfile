FROM node:20-slim AS base

# Install Chromium, ffmpeg, and all required libs for headless rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ffmpeg \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-core \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    ca-certificates \
    curl \
    libportaudio2 \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install --break-system-packages kokoro-tts

# Tell Remotion to use system Chromium instead of downloading its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV REMOTION_CHROME_EXECUTABLE=/usr/bin/chromium

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source
COPY . .

# Pre-download Kokoro TTS model files
RUN mkdir -p /app/.kokoro-cache \
    && curl -sL "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx" -o /app/.kokoro-cache/kokoro-v1.0.onnx \
    && curl -sL "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin" -o /app/.kokoro-cache/voices-v1.0.bin

# Replace Remotion's bundled ffmpeg with system ffmpeg to avoid SELinux mprotect issues
RUN rm -f /app/node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg \
          /app/node_modules/@remotion/compositor-linux-x64-gnu/ffprobe \
    && ln -s /usr/bin/ffmpeg /app/node_modules/@remotion/compositor-linux-x64-gnu/ffmpeg \
    && ln -s /usr/bin/ffprobe /app/node_modules/@remotion/compositor-linux-x64-gnu/ffprobe

# Pre-bundle Remotion compositions at build time
RUN npx remotion bundle src/index.tsx --public-dir public 2>&1

# Create output directory
RUN mkdir -p /app/out

EXPOSE 3001

CMD ["npx", "tsx", "src/server.ts"]
