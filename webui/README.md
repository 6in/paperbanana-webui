# PaperBanana Web UI

A modern, Glassmorphism-style chat interface for the [PaperBanana](https://github.com/llmsresearch/paperbanana) Automated Academic Illustration generator. 

This project operates on a **Complete Separation Architecture**, acting as an independent wrapper around the original `paperbanana` CLI/Library. It reads the stdout logs in real-time and streams them via WebSockets to a React frontend, allowing you to watch the multi-agent generation process (Optimization, Retrieval, Planning, Iteration) happen live in your browser.

![PaperBanana Web UI Preview](https://via.placeholder.com/800x400.png?text=PaperBanana+Web+UI) *(Replace with actual screenshot)*

## Features
- **Dual-Pane Chat Layout**: Interact with the AI on the left, watch logs and view the final figure on the right.
- **Real-time Log Streaming**: Uses FastAPI WebSockets to capture and stream `structlog` output.
- **Glassmorphism Design**: Sleek, modern aesthetic built with Tailwind CSS v4.
- **Zero-Conflict**: Lives in its own `webui/` directory. Does not modify the core `paperbanana` repository.

## Prerequisites
- **Python 3.10+** (for the backend and `paperbanana` core)
- **Bun** (for the modern Vite/React frontend)
- A valid API Key (e.g., Google Gemini, OpenAI, or Anthropic)

---

## 🚀 Quick Setup Guide

Assume you have cloned the original `paperbanana` repository and placed this `webui` folder next to it.

```text
parent-directory/
├── paperbanana/      # The original repo
└── webui/            # THIS project
    ├── backend/
    ├── frontend/
    └── .env
```

### 1. Set up the Environment Variables
Create a `.env` file in the root of the `webui/` directory and add your keys:

```bash
# webui/.env
GOOGLE_API_KEY=your_gemini_api_key_here
# OPENAI_API_KEY=your_openai_api_key_here
```

### 2. Install Backend Dependencies
We recommend setting up a dedicated virtual environment. 

```bash
cd webui
python3 -m venv venv
source venv/bin/activate

# Install FastAPI backend requirements
pip install fastapi uvicorn websockets pydantic python-dotenv

# Link the core PaperBanana library (editable mode)
pip install -e ../paperbanana
```

### 3. Install Frontend Dependencies
We use Bun for lightning-fast package management.

```bash
cd webui/frontend
bun install
```

---

## 🏃‍♂️ Running the Web UI

You will need to start both the Backend API and the Frontend Development Server simultaneously.

**Terminal 1: Start the FastAPI Backend (Port 54311)**
```bash
cd webui
source venv/bin/activate
uvicorn backend.main:app --reload --host 0.0.0.0 --port 54311
```

**Terminal 2: Start the React Frontend (Port 54312)**
```bash
cd webui/frontend
bun dev
```

Open your browser and navigate to **`http://localhost:54312`**.

## How it works (Under the Hood)
1. **Frontend (`App.tsx`, `ChatInterface.tsx`)**: The user selects a model (`gemini-3-pro-preview`, `gpt-4o`, etc.) and types a prompt. This is sent as JSON over a WebSocket connection to the backend.
2. **Backend (`backend/main.py`)**: 
   - FastAPI receives the payload.
   - It intercepts `sys.stdout` using a custom `StdoutRedirector`.
   - It instantiates the `PaperBananaPipeline` from the sibling directory and runs `.generate()`.
   - As the pipeline logs its progress (e.g., *Phase 1: Planning*), the redirector strips ANSI color codes and pushes the text back through the WebSocket.
3. **Frontend (`PreviewArea.tsx`)**: Receives the logs and auto-scrolls the terminal-like window on the right. Once the backend finishes and encodes the generated `.png` image to Base64, the frontend renders the final academic figure.
