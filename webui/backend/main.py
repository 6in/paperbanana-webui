"""
PaperBanana Web UI Backend — reliable real-time log/cost streaming.

Architecture:
- Single asyncio.Queue for all log lines. Items are (pipeline_idx: int, message: str).
- structlog: custom processor pushes (pipeline_idx, rendered_message) to queue; custom
  logger factory no-ops so we don't double-print. pipeline_idx comes from contextvars.
- Stdout redirector: for print() calls, puts (current_pipeline_idx, line) in the same
  queue; pipeline_idx is read from a module-level ContextVar set per pipeline task.
- One drain task reads from the queue and sends each message over WebSocket immediately
  (log + cost_usd). Cost is computed by parsing token usage from the log message.
"""
import asyncio
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from datetime import datetime, timezone
from contextvars import ContextVar
from typing import Optional

import yaml
from fastapi import FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from paperbanana.core.pipeline import PaperBananaPipeline
from paperbanana.core.types import GenerationInput, DiagramType
from paperbanana.core.config import Settings

import structlog
from structlog.contextvars import bind_contextvars
from paperbanana.core.logging import configure_logging
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="PaperBanana Web UI API")

WEBUI_BASE_PATH = os.getenv("WEBUI_BASE_PATH", "/paper-banana-webui").strip()
if WEBUI_BASE_PATH in {"", "/"}:
    WEBUI_BASE_PATH = ""
else:
    WEBUI_BASE_PATH = "/" + WEBUI_BASE_PATH.strip("/")

AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "false").strip().lower() in {"1", "true", "yes", "on"}
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()
AUTH_ALLOWED_DOMAINS = {
    d.strip().lower()
    for d in os.getenv("AUTH_ALLOWED_DOMAINS", "").split(",")
    if d.strip()
}
AUTH_EMAIL_RULES_FILE = os.getenv("AUTH_EMAIL_RULES_FILE", "").strip()
AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "email").strip() or "email"
AUTH_COOKIE_MAX_AGE_SECONDS = int(os.getenv("AUTH_COOKIE_MAX_AGE_SECONDS", "604800"))
AUTH_STORAGE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60


def with_base(path: str) -> str:
    if not path.startswith("/"):
        path = "/" + path
    return f"{WEBUI_BASE_PATH}{path}" if WEBUI_BASE_PATH else path


class GoogleVerifyRequest(BaseModel):
    id_token: str


def _normalize_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    return email.strip().lower()


def _normalize_email_set(values: object) -> set[str]:
    if not isinstance(values, list):
        return set()
    out: set[str] = set()
    for v in values:
        if isinstance(v, str):
            normalized = _normalize_email(v)
            if normalized:
                out.add(normalized)
    return out


def _resolve_rules_file(path_value: str) -> Path:
    raw = Path(path_value)
    if raw.is_absolute():
        return raw
    # Resolve relative to webui/ directory.
    return (Path(__file__).resolve().parents[1] / raw).resolve()


def _load_auth_email_rules() -> tuple[set[str], set[str]]:
    if not AUTH_EMAIL_RULES_FILE:
        return (set(), set())
    path = _resolve_rules_file(AUTH_EMAIL_RULES_FILE)
    if not path.exists():
        logging.getLogger(__name__).warning(
            "AUTH_EMAIL_RULES_FILE not found: %s",
            str(path),
        )
        return (set(), set())
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception as exc:
        logging.getLogger(__name__).warning(
            "Failed to load AUTH_EMAIL_RULES_FILE %s: %s",
            str(path),
            str(exc),
        )
        return (set(), set())
    if not isinstance(data, dict):
        return (set(), set())
    allowed = _normalize_email_set(data.get("allowed_emails"))
    denied = _normalize_email_set(data.get("denied_emails"))
    return (allowed, denied)


AUTH_ALLOWED_EMAILS, AUTH_DENIED_EMAILS = _load_auth_email_rules()


def _is_email_allowed(email: Optional[str]) -> bool:
    normalized = _normalize_email(email)
    if not normalized:
        return False
    if normalized in AUTH_DENIED_EMAILS:
        return False
    if normalized in AUTH_ALLOWED_EMAILS:
        return True
    if "@" not in normalized:
        return False
    domain = normalized.split("@", 1)[1]
    return domain in AUTH_ALLOWED_DOMAINS


def _secure_cookie_enabled(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    return request.headers.get("x-forwarded-proto", "").lower() == "https"


def _auth_payload(name: str, email: str) -> dict:
    return {
        "name": name,
        "email": email,
        "authenticated_at": datetime.now(timezone.utc).isoformat(),
        "expires_in_seconds": AUTH_STORAGE_MAX_AGE_SECONDS,
    }


def _set_auth_cookie(response: Response, request: Request, email: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=email,
        max_age=AUTH_COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=_secure_cookie_enabled(request),
        samesite="lax",
        path=WEBUI_BASE_PATH or "/",
    )


def _clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        path=WEBUI_BASE_PATH or "/",
    )


def _require_auth_http(request: Request) -> Optional[str]:
    if not AUTH_REQUIRED:
        return None
    email = _normalize_email(request.cookies.get(AUTH_COOKIE_NAME))
    if not _is_email_allowed(email):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return email


_cors_origins_env = os.getenv(
    "CORS_ALLOW_ORIGINS",
    "http://localhost:54312,http://127.0.0.1:54312,https://localhost:54312,https://127.0.0.1:54312",
)
ALLOW_ORIGINS = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ContextVar for pipeline index so print() and other non-structlog output get the right idx
PIPELINE_IDX: ContextVar[int] = ContextVar("pipeline_idx", default=-1)

# Model cost rates per 1M tokens: (input_cost, output_cost) USD
COST_RATES = {
    "gpt-4o": (2.50, 10.00),
    "gpt-4-turbo": (10.00, 30.00),
    "claude-3-opus": (15.00, 75.00),
    "claude-3-sonnet": (3.00, 15.00),
    "claude-3-5-sonnet": (3.00, 15.00),
    "claude-3-haiku": (0.25, 1.25),
    "gemini-3-pro": (2.00, 12.00),
    "gemini-3-pro-preview": (2.00, 12.00),
    "gemini-3-flash": (0.075, 0.30),
    "gemini-3-flash-preview": (0.075, 0.30),
    "gemini-exp-1206": (0.075, 0.30),
    "gemini-2.5-pro": (1.25, 5.00),
    "gemini-1.5-pro": (1.25, 5.00),
    "gemini-1.5-flash": (0.075, 0.30),
    "gemini": (0.00, 0.00),
}

# ANSI strip
ANSI_RE = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")
# Token usage: match "TOKEN_USAGE input=123 output=456", usage={'prompt_token_count': 1000}, key=123, etc.
TOKEN_INPUT_RE = re.compile(
    r"(?:prompt_token_count|prompt_tokens|input_tokens)\s*[=:]\s*(\d+)",
    re.IGNORECASE,
)
TOKEN_OUTPUT_RE = re.compile(
    r"(?:candidates_token_count|completion_tokens|output_tokens)\s*[=:]\s*(\d+)",
    re.IGNORECASE,
)


def _cost_for_model(model_name: str) -> tuple[float, float]:
    name_lower = model_name.lower()
    for key, (inc, outc) in COST_RATES.items():
        if key in name_lower:
            return (inc, outc)
    return (0.0, 0.0)


def _extract_usage_from_event(event_dict: dict) -> Optional[tuple[int, int]]:
    """Extract (input_tokens, output_tokens) from event — top-level keys, TOKEN_USAGE event, or usage object."""
    # Explicit top-level keys (Gemini provider logs prompt_token_count=, candidates_token_count=)
    inp = event_dict.get("prompt_token_count") or event_dict.get("prompt_tokens") or event_dict.get("input_tokens")
    out = event_dict.get("candidates_token_count") or event_dict.get("completion_tokens") or event_dict.get("output_tokens")
    if inp is not None and out is not None:
        try:
            return (int(inp), int(out))
        except (TypeError, ValueError):
            pass
    # "TOKEN_USAGE input=123 output=456" style (structlog passes positional args as event or message)
    event = event_dict.get("event") or event_dict.get("message", "")
    if isinstance(event, str) and "TOKEN_USAGE" in event:
        pi = TOKEN_INPUT_RE.search(event)
        po = TOKEN_OUTPUT_RE.search(event)
        if pi and po:
            try:
                return (int(pi.group(1)), int(po.group(1)))
            except (TypeError, ValueError):
                pass

    usage = event_dict.get("usage")
    if usage is None:
        return None
    try:
        if hasattr(usage, "prompt_token_count") and hasattr(usage, "candidates_token_count"):
            return (int(usage.prompt_token_count), int(usage.candidates_token_count))
        if hasattr(usage, "prompt_tokens") and hasattr(usage, "completion_tokens"):
            return (int(usage.prompt_tokens), int(usage.completion_tokens))
        if isinstance(usage, dict):
            inp = usage.get("prompt_token_count") or usage.get("prompt_tokens") or usage.get("input_tokens")
            out = usage.get("candidates_token_count") or usage.get("completion_tokens") or usage.get("output_tokens")
            if inp is not None and out is not None:
                return (int(inp), int(out))
        if hasattr(usage, "prompt_token_count"):
            inp = getattr(usage, "prompt_token_count", None)
            out = getattr(usage, "candidates_token_count", None) or getattr(usage, "completion_token_count", None)
            if inp is not None and out is not None:
                return (int(inp), int(out))
    except (TypeError, ValueError, AttributeError):
        pass
    return None


def make_queue_processor(log_queue: asyncio.Queue):
    """Returns a structlog processor that pushes (pipeline_idx, message, usage_override) to log_queue."""

    def _render_event(
        logger: object, method_name: str, event_dict: dict
    ) -> dict:
        pipeline_idx = event_dict.get("pipeline_idx", -1)
        if isinstance(pipeline_idx, (list, tuple)):
            pipeline_idx = pipeline_idx[0] if pipeline_idx else -1
        try:
            pipeline_idx = int(pipeline_idx)
        except (TypeError, ValueError):
            pipeline_idx = -1

        usage_override = _extract_usage_from_event(event_dict)

        # Render to string (same style as console)
        renderer = structlog.dev.ConsoleRenderer()
        try:
            msg = renderer(logger, method_name, event_dict)
        except Exception:
            msg = str(event_dict)
        clean = ANSI_RE.sub("", msg).strip()
        if clean:
            try:
                log_queue.put_nowait((pipeline_idx, clean, usage_override))
            except asyncio.QueueFull:
                pass
        return event_dict

    return _render_event


class NoopLogger:
    """Logger that does nothing; log output is sent via the queue processor."""

    def __call__(self, method_name: str, event_dict: Optional[dict] = None, **kw) -> None:
        pass

    def __getattr__(self, name):
        return lambda *a, **k: None


class StdoutRedirector:
    """Sends print() output to the same log queue with current pipeline_idx from ContextVar."""

    def __init__(
        self,
        log_queue: asyncio.Queue,
        original_stdout,
        loop: asyncio.AbstractEventLoop,
    ):
        self.log_queue = log_queue
        self.original_stdout = original_stdout
        self.loop = loop

    def write(self, message: str) -> None:
        self.original_stdout.write(message)
        if message.strip():
            clean = ANSI_RE.sub("", message.strip())
            if clean:
                idx = PIPELINE_IDX.get()
                try:
                    # (pipeline_idx, message, usage_override=None)
                    self.loop.call_soon_threadsafe(self.log_queue.put_nowait, (idx, clean, None))
                except Exception:
                    pass

    def flush(self) -> None:
        self.original_stdout.flush()


async def drain_log_queue(
    websocket: WebSocket,
    log_queue: asyncio.Queue,
    model_name: str,
    stop_sentinel: object,
    _original_stdout=None,
) -> None:
    """
    Single drain task: read (pipeline_idx, message) from queue and send over WebSocket.
    Parses token usage from message and sends cost_usd with every log for real-time cost.
    """
    _out = _original_stdout or sys.__stdout__
    tokens_tally: dict[int, dict] = {}
    in_c, out_c = _cost_for_model(model_name)
    msg_count = 0

    while True:
        try:
            item = await log_queue.get()
            if item is stop_sentinel:
                log_queue.task_done()
                _out.write(f"[drain] stop sentinel received after {msg_count} messages\n")
                _out.flush()
                break
            if len(item) == 3:
                pipeline_idx, msg, usage_override = item
            else:
                pipeline_idx, msg = item[0], item[1]
                usage_override = None
            log_queue.task_done()
            msg_count += 1

            if pipeline_idx not in tokens_tally:
                tokens_tally[pipeline_idx] = {"input": 0, "output": 0, "cost": 0.0}

            if usage_override is not None:
                inp, out = usage_override
                tokens_tally[pipeline_idx]["input"] += inp
                tokens_tally[pipeline_idx]["output"] += out
                _out.write(f"[drain#{msg_count}] TOKENS pipeline_idx={pipeline_idx} input={inp} output={out}\n")
                _out.flush()
            else:
                pi = TOKEN_INPUT_RE.search(msg)
                po = TOKEN_OUTPUT_RE.search(msg)
                if pi:
                    tokens_tally[pipeline_idx]["input"] += int(pi.group(1))
                if po:
                    tokens_tally[pipeline_idx]["output"] += int(po.group(1))

            cost = (
                tokens_tally[pipeline_idx]["input"] / 1_000_000 * in_c
                + tokens_tally[pipeline_idx]["output"] / 1_000_000 * out_c
            )
            tokens_tally[pipeline_idx]["cost"] = cost
            cost_usd = tokens_tally[pipeline_idx]["cost"]

            _out.write(f"[drain#{msg_count}] idx={pipeline_idx} cost={cost_usd:.6f} msg={msg[:80]}\n")
            _out.flush()

            try:
                await websocket.send_json(
                    {
                        "type": "log",
                        "message": msg,
                        "pipelineIdx": pipeline_idx,
                        "cost_usd": cost_usd,
                    }
                )
            except Exception as e:
                _out.write(f"[drain] WebSocket send failed: {e}\n")
                _out.flush()
                break
        except asyncio.CancelledError:
            _out.write(f"[drain] cancelled after {msg_count} messages, queue size={log_queue.qsize()}\n")
            _out.flush()
            break
        except Exception as e:
            _out.write(f"[drain] error: {e}\n")
            _out.flush()
            break


@app.get("/")
@app.get(with_base("/"))
def read_root():
    return {"message": "Welcome to PaperBanana API", "base_path": WEBUI_BASE_PATH or "/"}


@app.get("/api/auth/config")
@app.get(with_base("/api/auth/config"))
def auth_config():
    return {
        "auth_required": AUTH_REQUIRED,
        "google_client_id": GOOGLE_CLIENT_ID if AUTH_REQUIRED else "",
        "cookie_name": AUTH_COOKIE_NAME,
        "storage_max_age_seconds": AUTH_STORAGE_MAX_AGE_SECONDS,
        "auth_email_rules_file": AUTH_EMAIL_RULES_FILE,
    }


@app.get("/api/auth/session")
@app.get(with_base("/api/auth/session"))
def auth_session(request: Request):
    email = _normalize_email(request.cookies.get(AUTH_COOKIE_NAME))
    if not AUTH_REQUIRED:
        return {"authenticated": True, "auth_required": False, "email": email}
    if not _is_email_allowed(email):
        return {"authenticated": False, "auth_required": True}
    return {"authenticated": True, "auth_required": True, "email": email}


@app.post("/api/auth/google/verify")
@app.post(with_base("/api/auth/google/verify"))
def auth_google_verify(payload: GoogleVerifyRequest, request: Request, response: Response):
    if not AUTH_REQUIRED:
        return {"ok": True, "auth_required": False}
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID is not configured")

    try:
        from google.auth.transport import requests as grequests
        from google.oauth2 import id_token
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"google-auth import failed: {exc}") from exc

    try:
        claims = id_token.verify_oauth2_token(
            payload.id_token,
            grequests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid Google token: {exc}") from exc

    issuer = str(claims.get("iss", ""))
    if issuer not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token issuer")
    if not bool(claims.get("email_verified")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google email is not verified")

    email = _normalize_email(claims.get("email"))
    name = str(claims.get("name") or claims.get("given_name") or email or "")
    if not _is_email_allowed(email):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email is not allowed")

    _set_auth_cookie(response, request, email)
    return {"ok": True, "auth_required": True, "user": _auth_payload(name, email)}


@app.post("/api/auth/logout")
@app.post(with_base("/api/auth/logout"))
def auth_logout(response: Response):
    _clear_auth_cookie(response)
    return {"ok": True}


@app.get("/api/test-token")
@app.get(with_base("/api/test-token"))
async def test_token(request: Request):
    authed_email = _require_auth_http(request)
    if authed_email:
        structlog.get_logger().info("Auth check", email=authed_email)
    """
    PaperBanana VLM → structlog → キュー → トークンパース → コスト計算
    の一連の流れを、軽量プロンプトで疎通確認する。
    """
    import logging as _logging

    test_queue: asyncio.Queue = asyncio.Queue()
    collected: list[tuple] = []

    # 1. structlog を本番と同じ設定にする（キュープロセッサ付き）
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="%Y-%m-%d %H:%M:%S", utc=False),
            make_queue_processor(test_queue),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(_logging.DEBUG),
        context_class=dict,
        logger_factory=lambda: NoopLogger(),
        cache_logger_on_first_use=False,
    )

    # 2. PaperBanana VLM 経由で API を呼ぶ（本番と同じパス）
    from paperbanana.providers.registry import ProviderRegistry
    from paperbanana.core.config import Settings

    settings = Settings(vlm_provider="gemini", vlm_model="gemini-3-flash-preview")
    vlm = ProviderRegistry.create_vlm(settings)

    try:
        response_text = await vlm.generate(prompt="Say hello.", max_tokens=16)
    except Exception as e:
        response_text = f"[ERROR] {type(e).__name__}: {e}"

    # 3. キューに入ったログを全部取り出す
    while not test_queue.empty():
        try:
            item = test_queue.get_nowait()
            test_queue.task_done()
            collected.append(item)
        except Exception:
            break

    # 4. 各ログ行からトークン解析を試みる
    results = []
    total_input = 0
    total_output = 0
    in_c, out_c = _cost_for_model("gemini-3-flash-preview")

    for item in collected:
        if len(item) == 3:
            idx, msg, usage_override = item
        else:
            idx, msg = item[0], item[1]
            usage_override = None

        parsed_input, parsed_output = None, None

        if usage_override is not None:
            parsed_input, parsed_output = usage_override
        else:
            pi = TOKEN_INPUT_RE.search(msg)
            po = TOKEN_OUTPUT_RE.search(msg)
            if pi:
                parsed_input = int(pi.group(1))
            if po:
                parsed_output = int(po.group(1))

        if parsed_input:
            total_input += parsed_input
        if parsed_output:
            total_output += parsed_output

        results.append({
            "pipeline_idx": idx,
            "message": msg[:500],
            "usage_override": str(usage_override) if usage_override else None,
            "parsed_input": parsed_input,
            "parsed_output": parsed_output,
        })

    cost = (total_input / 1_000_000 * in_c) + (total_output / 1_000_000 * out_c)

    return {
        "status": "ok",
        "response_text": (response_text or "(None)")[:200],
        "total_log_lines": len(collected),
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "cost_usd": round(cost, 6),
        "cost_rates": {"input_per_1M": in_c, "output_per_1M": out_c},
        "log_details": results,
    }


@app.websocket("/api/ws/generate")
@app.websocket(with_base("/api/ws/generate"))
async def websocket_generate(websocket: WebSocket):
    ws_email = _normalize_email(websocket.cookies.get(AUTH_COOKIE_NAME))
    if AUTH_REQUIRED and not _is_email_allowed(ws_email):
        await websocket.close(code=4401, reason="Authentication required")
        return
    await websocket.accept()
    if ws_email:
        structlog.get_logger().info("WebSocket auth", email=ws_email)
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    log_queue: Optional[asyncio.Queue] = None
    drain_task: Optional[asyncio.Task] = None
    stop_sentinel = object()

    try:
        data = await websocket.receive_text()
        config = json.loads(data)

        prompt = config.get("prompt", "")
        vlm_type = config.get("vlmType", "gpt-4o")
        iterations = int(config.get("iterations", 3))
        parallel_count = int(config.get("parallelCount", 1))
        continue_run_id = config.get("continueRunId")

        configure_logging(verbose=True)

        # Single queue for all log lines (structlog + stdout)
        log_queue = asyncio.Queue()

        # structlog: merge contextvars (pipeline_idx), then our processor pushes to queue; logger no-ops
        structlog.configure(
            processors=[
                structlog.contextvars.merge_contextvars,
                structlog.processors.add_log_level,
                structlog.processors.StackInfoRenderer(),
                structlog.dev.set_exc_info,
                structlog.processors.TimeStamper(fmt="%Y-%m-%d %H:%M:%S", utc=False),
                make_queue_processor(log_queue),
            ],
            wrapper_class=structlog.make_filtering_bound_logger(logging.DEBUG),
            context_class=dict,
            logger_factory=lambda: NoopLogger(),
            cache_logger_on_first_use=False,
        )

        loop = asyncio.get_running_loop()
        redirector = StdoutRedirector(log_queue, original_stdout, loop)
        sys.stdout = redirector
        sys.stderr = redirector

        drain_task = asyncio.create_task(
            drain_log_queue(websocket, log_queue, vlm_type, stop_sentinel, _original_stdout=original_stdout)
        )

        vlm_provider_mapped = (
            "openai"
            if "gpt" in vlm_type
            else ("anthropic" if "claude" in vlm_type else "gemini")
        )

        generation_start = time.perf_counter()

        async def run_single_pipeline(idx: int):
            pipeline_start = time.perf_counter()
            PIPELINE_IDX.set(idx)
            bind_contextvars(pipeline_idx=idx)

            settings = Settings(
                vlm_provider=vlm_provider_mapped,
                vlm_model=vlm_type,
                max_iterations=iterations,
                refinement_iterations=iterations,
                output_dir="webui_outputs",
            )

            pipeline = PaperBananaPipeline(settings=settings)

            if continue_run_id:
                print(f"Resuming run {continue_run_id} [instance {idx + 1}]...")
                from paperbanana.core.resume import load_resume_state

                state = load_resume_state(settings.output_dir, continue_run_id)
                output = await pipeline.continue_run(
                    resume_state=state,
                    additional_iterations=iterations,
                    user_feedback=prompt,
                )
            else:
                print(
                    f"Initializing pipeline with {vlm_type} [instance {idx + 1}/{parallel_count}]..."
                )
                gen_input = GenerationInput(
                    source_context="Provided via WebUI",
                    communicative_intent=prompt,
                    diagram_type=DiagramType.METHODOLOGY,
                    raw_data=None,
                )
                output = await pipeline.generate(gen_input)

            duration_seconds = round(time.perf_counter() - pipeline_start, 1)

            with open(output.image_path, "rb") as img_file:
                import base64
                encoded_string = base64.b64encode(img_file.read()).decode("utf-8")
                img_data_url = f"data:image/jpeg;base64,{encoded_string}"

            run_id = output.metadata.get("run_id", pipeline.run_id)

            await websocket.send_json(
                {
                    "type": "partial_complete",
                    "image_url": img_data_url,
                    "run_id": run_id,
                    "pipelineIdx": idx,
                    "duration_seconds": duration_seconds,
                }
            )
            return run_id

        tasks = [run_single_pipeline(i) for i in range(parallel_count)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        errors = [r for r in results if isinstance(r, Exception)]
        if errors and len(errors) == len(tasks):
            raise errors[0]

        total_duration_seconds = round(time.perf_counter() - generation_start, 1)
        first_success_id = next(
            (r for r in results if not isinstance(r, Exception)), None
        )
        await websocket.send_json({
            "type": "complete",
            "run_id": first_success_id,
            "duration_seconds": total_duration_seconds,
        })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        if original_stdout is not None:
            sys.stdout = original_stdout
            sys.stderr = original_stderr
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        if log_queue is not None:
            try:
                log_queue.put_nowait(stop_sentinel)
            except asyncio.QueueFull:
                pass
        if drain_task is not None:
            try:
                await asyncio.wait_for(drain_task, timeout=10.0)
            except asyncio.TimeoutError:
                drain_task.cancel()
                try:
                    await drain_task
                except asyncio.CancelledError:
                    pass
            except asyncio.CancelledError:
                pass
        try:
            await websocket.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
