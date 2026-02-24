import asyncio
import json
import sys
from io import StringIO
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Import paperbanana core modules
from paperbanana.core.pipeline import PaperBananaPipeline
from paperbanana.core.types import GenerationInput, DiagramType
from paperbanana.core.config import Settings
from paperbanana.core.logging import configure_logging
from dotenv import load_dotenv

# Load variables from .env file
load_dotenv()

app = FastAPI(title="PaperBanana Web UI API")

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class StdoutRedirector:
    """Redirects stdout to a WebSocket."""
    def __init__(self, websocket: WebSocket, original_stdout):
        self.websocket = websocket
        self.original_stdout = original_stdout
        self.loop = asyncio.get_running_loop()

    def write(self, message):
        self.original_stdout.write(message)
        if message.strip():
            import re
            # Strip ANSI escape codes
            clean_message = re.sub(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])', '', message.strip())
            try:
                # Use call_soon_threadsafe if called from thread, but we are in async
                # Since we are monkeypatching sys.stdout, we need to create a task safely
                asyncio.run_coroutine_threadsafe(
                    self.websocket.send_json({"type": "log", "message": clean_message}), 
                    self.loop
                )
            except Exception:
                pass

    def flush(self):
        self.original_stdout.flush()

@app.get("/")
def read_root():
    return {"message": "Welcome to PaperBanana API"}

@app.websocket("/api/ws/generate")
async def websocket_generate(websocket: WebSocket):
    await websocket.accept()
    original_stdout = sys.stdout
    try:
        # Wait for the configuration from the frontend
        data = await websocket.receive_text()
        config = json.loads(data)
        
        prompt = config.get("prompt", "")
        vlm_type = config.get("vlmType", "gpt-4o")
        iterations = int(config.get("iterations", 3))

        # Enable verbose logging in paperbanana to see the phases
        configure_logging(verbose=True)

        # Redirect stdout to capture structlog output
        redirector = StdoutRedirector(websocket, original_stdout)
        sys.stdout = redirector

        parallel_count = int(config.get("parallelCount", 1))
        continue_run_id = config.get("continueRunId")
        
        vlm_provider_mapped = "openai" if "gpt" in vlm_type else ("anthropic" if "claude" in vlm_type else "gemini")
        
        async def run_single_pipeline(idx: int):
            settings = Settings(
                vlm_provider=vlm_provider_mapped,
                vlm_model=vlm_type,
                max_iterations=iterations,
                refinement_iterations=iterations,
                output_dir="webui_outputs"
            )
            
            pipeline = PaperBananaPipeline(settings=settings)
            
            if continue_run_id:
                if idx == 0:
                    try:
                        # Only send the initializing log once
                        asyncio.run_coroutine_threadsafe(
                             websocket.send_json({"type": "log", "message": f"Resuming generation {continue_run_id} with {vlm_type} ({parallel_count} instances)..."}),
                             asyncio.get_running_loop()
                        )
                    except: pass
                from paperbanana.core.resume import load_resume_state
                state = load_resume_state(settings.output_dir, continue_run_id)
                output = await pipeline.continue_run(
                    resume_state=state,
                    additional_iterations=iterations,
                    user_feedback=prompt
                )
            else:
                if idx == 0:
                    try:
                        asyncio.run_coroutine_threadsafe(
                             websocket.send_json({"type": "log", "message": f"Initializing pipeline with {vlm_type} ({parallel_count} instances)..."}),
                             asyncio.get_running_loop()
                        )
                    except: pass
                gen_input = GenerationInput(
                    source_context="Provided via WebUI",
                    communicative_intent=prompt,
                    diagram_type=DiagramType.METHODOLOGY, 
                    raw_data=None,
                )
                output = await pipeline.generate(gen_input)
                
            # Stream the partial result back immediately
            import base64
            with open(output.image_path, "rb") as img_file:
                encoded_string = base64.b64encode(img_file.read()).decode('utf-8')
                img_data_url = f"data:image/jpeg;base64,{encoded_string}"
                
            run_id = output.metadata.get("run_id", pipeline.run_id)
            
            try:
                # Use threadsafe since stdout redirection might interleave
                asyncio.run_coroutine_threadsafe(
                    websocket.send_json({
                        "type": "partial_complete", 
                        "image_url": img_data_url,
                        "run_id": run_id
                    }),
                    asyncio.get_running_loop()
                )
            except Exception as e:
                print(f"Error sending partial complete: {e}")
                
            return run_id
            
        # Spawn N independent pipeline tasks
        tasks = [run_single_pipeline(i) for i in range(parallel_count)]
        
        # Wait for all of them to finish concurrently
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Check for errors in the gathered results
        errors = [r for r in results if isinstance(r, Exception)]
        if errors and len(errors) == len(tasks):
            # If all failed, throw the first error to trigger the catch block
            raise errors[0]
            
        # Send final complete signal
        # Use the run_id of the first successful task
        first_success_id = next((r for r in results if not isinstance(r, Exception)), None)
        
        await websocket.send_json({
            "type": "complete", 
            "run_id": first_success_id
        })

    except WebSocketDisconnect:
        print("WebSocket client disconnected")
    except Exception as e:
        sys.stdout = original_stdout # Restore immediately
        await websocket.send_json({"type": "error", "message": str(e)})
    finally:
        sys.stdout = original_stdout
        try:
            await websocket.close()
        except Exception:
            pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

