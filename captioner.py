"""图片反推：WD14 tagger（ONNX）+ 可选 TIPO 扩写。

给「本地图库」节点用：选中若干张图 → 逐张打标 →（可选）TIPO 扩写 →
写回同名 `.txt` 侧车，正好接上图库原本「同名侧车 = 提示词」的规则。

设计要点：
* 模型全部复用本机已装的 `ComfyUI-WD14-Tagger`（目录里已有 onnx + csv），
  不额外下载；没有装这个节点时降级为「反推不可用」并说明原因。
* ONNX session 缓存复用：官方节点每张图都新建一次 session（0.7~2s/张），
  批量处理时这是最大开销。这里只保留最近一个模型常驻。
* TIPO 复用 `z-tipo-extension` 的节点类，保持和用户工作流完全一致的输出；
  该扩展没装 / 加载失败时同样降级，不影响纯标签模式。
* 反推是长任务，走后台线程 + 轮询进度，避免 HTTP 请求挂几分钟。
"""

from __future__ import annotations

import csv
import importlib
import logging
import os
import random
import sys
import threading
import time
import types
import uuid
from pathlib import Path

from .prompt_reader import IMAGE_EXTENSIONS, has_prompt_file, invalidate_sidecar_cache

logger = logging.getLogger(__name__)

NODE_DIR = Path(__file__).resolve().parent
CUSTOM_NODES = NODE_DIR.parent

# 与官方节点保持一致的默认值
DEFAULT_MODEL = "wd-v1-4-moat-tagger-v2"
DEFAULT_THRESHOLD = 0.35
DEFAULT_CHARACTER_THRESHOLD = 0.85

# 单行输出用的 TIPO 格式：默认模板里有换行和空行，训练集标注通常要一行
TIPO_FLAT_FORMAT = (
    "<|special|>, <|characters|>, <|copyrights|>, <|artist|>, "
    "<|general|>, <|extended|>, <|quality|>, <|meta|>, <|rating|>"
)
# 只要标签时去掉 <|extended|>：TIPO 就不会去生成那段英文描述，快一半
TIPO_TAGS_FORMAT = (
    "<|special|>, <|characters|>, <|copyrights|>, <|artist|>, "
    "<|general|>, <|quality|>, <|meta|>, <|rating|>"
)

MAX_JOB_RESULTS = 5000
MAX_WRITE_ITEMS = 5000

# --------------------------------------------------------------------------- #
# 模型发现
# --------------------------------------------------------------------------- #
_dir_cache: list[Path] | None = None


def _tagger_dirs() -> list[Path]:
    global _dir_cache
    if _dir_cache is not None:
        return _dir_cache

    dirs: list[Path] = []
    # 1) 官方节点注册过的 wd14_tagger 目录（如果存在）
    try:
        import folder_paths  # type: ignore

        if "wd14_tagger" in getattr(folder_paths, "folder_names_and_paths", {}):
            dirs.extend(Path(p) for p in folder_paths.get_folder_paths("wd14_tagger"))
        try:
            dirs.append(Path(folder_paths.models_dir) / "onnx")
        except Exception:
            pass
    except Exception:
        pass
    # 2) 官方节点自带的 models 目录（便携版默认装在这里）
    dirs.append(CUSTOM_NODES / "ComfyUI-WD14-Tagger" / "models")

    out: list[Path] = []
    seen: set[str] = set()
    for directory in dirs:
        try:
            if not directory.is_dir():
                continue
        except OSError:
            continue
        key = str(directory).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(directory)
    _dir_cache = out
    return out


def list_models() -> list[dict]:
    """列出可用的打标模型（onnx + 同名 csv 才算可用）。"""
    found: dict[str, dict] = {}
    for directory in _tagger_dirs():
        try:
            entries = list(os.scandir(directory))
        except OSError:
            continue
        onnx = {}
        csvs = set()
        for entry in entries:
            try:
                if not entry.is_file():
                    continue
            except OSError:
                continue
            stem, ext = os.path.splitext(entry.name)
            if ext.lower() == ".onnx":
                onnx[stem] = entry
            elif ext.lower() == ".csv":
                csvs.add(stem)
        for stem, entry in onnx.items():
            if stem not in csvs or stem in found:
                continue
            try:
                size = entry.stat().st_size
            except OSError:
                size = 0
            found[stem] = {
                "name": stem,
                "size": size,
                "dir": str(directory),
                "mtime": 0,
            }
    return sorted(found.values(), key=lambda m: m["name"])


def default_model(models: list[dict] | None = None) -> str:
    names = [m["name"] for m in (models if models is not None else list_models())]
    if not names:
        return ""
    if DEFAULT_MODEL in names:
        return DEFAULT_MODEL
    for preferred in ("wd-vit-tagger-v3", "wd-eva02-large-tagger-v3"):
        if preferred in names:
            return preferred
    return names[0]


def _model_files(name: str) -> tuple[Path, Path] | None:
    safe = Path(str(name)).name
    for directory in _tagger_dirs():
        onnx = directory / f"{safe}.onnx"
        csv_path = directory / f"{safe}.csv"
        try:
            if onnx.is_file() and csv_path.is_file():
                return onnx, csv_path
        except OSError:
            continue
    return None


# --------------------------------------------------------------------------- #
# ONNX 会话（带缓存）
# --------------------------------------------------------------------------- #
_session_lock = threading.Lock()
_sessions: dict[str, dict] = {}
_meta_lock = threading.Lock()
_meta_cache: dict[str, tuple[list[str], int, int]] = {}


def _read_tags(csv_path: Path) -> tuple[list[str], int, int]:
    """返回 (tags, general_index, character_index)；行结构同官方实现。"""
    key = str(csv_path).lower()
    with _meta_lock:
        cached = _meta_cache.get(key)
        if cached is not None:
            return cached

    tags: list[str] = []
    general_index: int | None = None
    character_index: int | None = None
    with open(csv_path, "r", encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle)
        next(reader, None)
        for row in reader:
            if len(row) < 3:
                continue
            if general_index is None and row[2] == "0":
                general_index = len(tags)
            elif character_index is None and row[2] == "4":
                character_index = len(tags)
            tags.append(row[1])
    result = (
        tags,
        general_index if general_index is not None else 0,
        character_index if character_index is not None else len(tags),
    )
    with _meta_lock:
        _meta_cache[key] = result
    return result


def _get_session(name: str) -> dict:
    with _session_lock:
        cached = _sessions.get(name)
        if cached is not None:
            return cached

    files = _model_files(name)
    if files is None:
        raise RuntimeError(f"找不到模型 {name}.onnx / .csv（需要 ComfyUI-WD14-Tagger 的 models 目录）")
    onnx_path, csv_path = files

    try:
        import onnxruntime as ort  # 延迟导入：只有真的反推时才需要
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"onnxruntime 不可用：{exc}") from exc

    providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in ort.get_available_providers()]
    if not providers:
        providers = ["CPUExecutionProvider"]
    session = ort.InferenceSession(str(onnx_path), providers=providers)
    inp = session.get_inputs()[0]
    height = int(inp.shape[1]) if isinstance(inp.shape[1], int) else 448
    tags, general_index, character_index = _read_tags(csv_path)

    entry = {
        "session": session,
        "input": inp.name,
        "output": session.get_outputs()[0].name,
        "height": height,
        "tags": tags,
        "general": general_index,
        "character": character_index,
    }
    with _session_lock:
        # 只留最近一个模型：eva02-large 常驻一 GB 多，切模型就该释放
        _sessions.clear()
        _sessions[name] = entry
    return entry


def release_models() -> None:
    with _session_lock:
        _sessions.clear()


# --------------------------------------------------------------------------- #
# 打标
# --------------------------------------------------------------------------- #
def _tag_image(pil, name: str, threshold: float, character_threshold: float, replace_underscore: bool) -> list[tuple[str, float]]:
    entry = _get_session(name)
    import numpy as np  # onnxruntime 依赖 numpy，不需要单独判断
    from PIL import Image

    size = entry["height"]
    image = pil.convert("RGB")
    ratio = float(size) / max(image.size)
    new_size = (max(1, int(image.size[0] * ratio)), max(1, int(image.size[1] * ratio)))
    image = image.resize(new_size, Image.LANCZOS)
    square = Image.new("RGB", (size, size), (255, 255, 255))
    square.paste(image, ((size - new_size[0]) // 2, (size - new_size[1]) // 2))
    array = np.array(square).astype(np.float32)[:, :, ::-1][None]  # RGB -> BGR，同官方实现

    probs = entry["session"].run([entry["output"]], {entry["input"]: array})[0][0]
    tags = entry["tags"]
    general = entry["general"]
    character = entry["character"]

    picked: list[tuple[str, float]] = []
    for index in range(character, len(tags)):
        if probs[index] > character_threshold:
            picked.append((tags[index], float(probs[index])))
    for index in range(general, character):
        if probs[index] > threshold:
            picked.append((tags[index], float(probs[index])))
    if replace_underscore:
        picked = [(tag.replace("_", " "), score) for tag, score in picked]
    return picked


def _escape(tag: str) -> str:
    return tag.replace("(", "\\(").replace(")", "\\)")


def tag_image(pil, name: str, threshold: float, character_threshold: float, replace_underscore: bool, trailing_comma: bool, exclude_tags: str = "") -> dict:
    picked = _tag_image(pil, name, threshold, character_threshold, replace_underscore)
    blocked = {s.strip().lower() for s in str(exclude_tags or "").split(",") if s.strip()}
    if blocked:
        picked = [(tag, score) for tag, score in picked if tag.lower() not in blocked]
    text = ("" if trailing_comma else ", ").join(
        _escape(tag) + (", " if trailing_comma else "") for tag, _ in picked
    )
    return {
        "text": text,
        "count": len(picked),
        "tags": [{"tag": tag, "score": round(score, 4)} for tag, score in picked],
    }


# --------------------------------------------------------------------------- #
# TIPO 扩写（复用 z-tipo-extension 的节点类）
# --------------------------------------------------------------------------- #
_tipo_lock = threading.Lock()
_tipo_module = None
_tipo_error = ""


def _load_tipo():
    global _tipo_module, _tipo_error
    if _tipo_module is not None:
        return _tipo_module

    # 1) ComfyUI 已经加载过：直接在 sys.modules 里找
    for mod_name, module in list(sys.modules.items()):
        if mod_name.endswith(".nodes.tipo") and hasattr(module, "TIPO") and hasattr(module, "DEFAULT_FORMAT"):
            _tipo_module = module
            return module

    # 2) 自己按包加载（目录名带连字符，不能直接 import）
    ext_dir = CUSTOM_NODES / "z-tipo-extension"
    if not (ext_dir / "nodes" / "tipo.py").is_file():
        raise RuntimeError("没有安装 z-tipo-extension（TIPO 扩写不可用）")
    pkg_name = "_lgb_tipo_ext"
    if pkg_name not in sys.modules:
        pkg = types.ModuleType(pkg_name)
        pkg.__path__ = [str(ext_dir)]
        pkg.__package__ = pkg_name
        sys.modules[pkg_name] = pkg
    try:
        module = importlib.import_module(f"{pkg_name}.nodes.tipo")
    except Exception as exc:
        raise RuntimeError(f"加载 TIPO 失败：{exc}") from exc
    if not hasattr(module, "TIPO"):
        raise RuntimeError("z-tipo-extension 版本不匹配（找不到 TIPO 节点类）")
    _tipo_module = module
    return module


def tipo_status() -> dict:
    global _tipo_error
    try:
        module = _load_tipo()
        models = list(module.model_options())
        devices = list(module.torch_devices())
        _tipo_error = ""
        return {
            "available": True,
            "models": models,
            "default": models[0] if models else "",
            "devices": devices,
            "device": "cpu" if "cpu" in devices else (devices[0] if devices else "cpu"),
            "reason": "",
        }
    except Exception as exc:
        _tipo_error = str(exc)
        return {
            "available": False,
            "models": [],
            "default": "",
            "devices": ["cpu"],
            "device": "cpu",
            "reason": _tipo_error,
        }


def run_tipo(tags: str, model: str, width: int, height: int, *, device: str = "cpu", tag_length: str = "long", nl_length: str = "long", temperature: float = 0.5, seed: int | None = None, tags_only: bool = False) -> str:
    """把标签扩写成更长的提示词。返回空串表示没有任何输出。"""
    module = _load_tipo()
    options = list(module.model_options())
    if not options:
        raise RuntimeError("TIPO 没有可用模型")
    if model not in options:
        model = options[0]
    if device not in list(module.torch_devices()):
        device = "cpu"
    seed_value = random.randint(0, 2**31 - 1) if seed is None or seed < 0 else int(seed)

    with _tipo_lock:  # TIPO 的模型是全局单例，必须串行
        out = module.TIPO.execute(
            tags=tags,
            nl_prompt="",
            ban_tags="",
            tipo_model=model,
            width=max(64, int(width or 1024)),
            height=max(64, int(height or 1024)),
            temperature=float(temperature),
            top_p=0.95,
            min_p=0.05,
            top_k=80,
            tag_length=tag_length,
            nl_length=nl_length,
            seed=seed_value,
            device=device,
            format=TIPO_TAGS_FORMAT if tags_only else TIPO_FLAT_FORMAT,
        )
    result = getattr(out, "result", None) or getattr(out, "args", ())
    # 0 = 格式化后的完整提示词（含英文描述），4 = 纯标签
    index = 4 if tags_only else 0
    if index >= len(result) or not str(result[index] or "").strip():
        index = 0
    return str(result[index] or "").strip()


# --------------------------------------------------------------------------- #
# 后台任务
# --------------------------------------------------------------------------- #
_job_lock = threading.Lock()
_jobs: dict[str, dict] = {}
_current_job: str | None = None


def _clean_text(text: str) -> str:
    """合并换行/多余空白：训练集标注一般要一行。"""
    parts = [p.strip() for p in str(text or "").replace("\r", "\n").split("\n")]
    joined = ", ".join(p for p in parts if p)
    return " ".join(joined.split())


def start_job(paths: list[str], options: dict) -> dict:
    global _current_job
    cleaned = [str(p).strip() for p in paths if str(p or "").strip()]
    if not cleaned:
        raise ValueError("没有要反推的图片")
    if len(cleaned) > MAX_JOB_RESULTS:
        raise ValueError(f"一次最多反推 {MAX_JOB_RESULTS} 张")

    models = list_models()
    if not models:
        raise RuntimeError("没有可用的打标模型：需要 ComfyUI-WD14-Tagger 的 models 目录里有 .onnx + .csv")

    model = str(options.get("model") or default_model(models))
    if _model_files(model) is None:
        model = default_model(models)

    mode = str(options.get("mode") or "tags")
    if mode not in ("tags", "tipo", "tipo_nl"):
        mode = "tags"
    tipo_info = tipo_status()
    if mode != "tags" and not tipo_info["available"]:
        mode = "tags"

    payload = {
        "model": model,
        "threshold": float(options.get("threshold", DEFAULT_THRESHOLD)),
        "character_threshold": float(options.get("character_threshold", DEFAULT_CHARACTER_THRESHOLD)),
        "replace_underscore": bool(options.get("replace_underscore", False)),
        "trailing_comma": bool(options.get("trailing_comma", False)),
        "exclude_tags": str(options.get("exclude_tags") or ""),
        "prefix": str(options.get("prefix") or "").strip().rstrip(","),
        "mode": mode,
        "tipo_model": str(options.get("tipo_model") or tipo_info["default"]),
        "tipo_device": str(options.get("tipo_device") or tipo_info["device"]),
        "tipo_tag_length": str(options.get("tipo_tag_length") or "long"),
        "tipo_temperature": float(options.get("tipo_temperature", 0.5)),
        "tipo_seed": int(options.get("tipo_seed", -1) or -1),
    }

    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "state": "running",
        "total": len(cleaned),
        "done": 0,
        "results": [],
        "error": "",
        "current": "",
        "cancel": False,
        "started": time.time(),
        "elapsed": 0.0,
        "model": model,
        "mode": mode,
    }
    with _job_lock:
        running = _jobs.get(_current_job or "")
        if running is not None and running["state"] == "running":
            raise RuntimeError("已经有一个反推任务在跑，等它结束或先取消")
        _jobs[job_id] = job
        _current_job = job_id
        # 只保留最近 3 个任务
        for old in sorted(_jobs.values(), key=lambda j: j["started"])[:-3]:
            if old["id"] != job_id:
                _jobs.pop(old["id"], None)

    thread = threading.Thread(target=_run_job, args=(job, cleaned, payload), name=f"lg-caption-{job_id}", daemon=True)
    thread.start()
    return {"job": job_id, "total": len(cleaned), "model": model, "mode": mode}


def _run_job(job: dict, paths: list[str], opts: dict) -> None:
    from PIL import Image  # 延迟导入，和 gallery.py 保持一致

    try:
        for raw in paths:
            if job["cancel"]:
                job["state"] = "cancelled"
                break
            path = Path(raw)
            job["current"] = path.name
            record = {
                "path": str(path),
                "name": path.name,
                "text": "",
                "tags": "",
                "tag_count": 0,
                # 已有侧车 → 前端标出来，避免用户以为「写入了其实被跳过」
                "has_prompt": bool(has_prompt_file(path)),
                "error": "",
            }
            try:
                if not path.is_file():
                    raise FileNotFoundError("文件不存在")
                if path.suffix.lower() not in IMAGE_EXTENSIONS:
                    raise ValueError("不是图片文件")
                with Image.open(path) as pil:
                    width, height = pil.size
                    result = tag_image(
                        pil,
                        opts["model"],
                        opts["threshold"],
                        opts["character_threshold"],
                        opts["replace_underscore"],
                        opts["trailing_comma"],
                        opts["exclude_tags"],
                    )
                tags_text = result["text"]
                record["tags"] = tags_text
                record["tag_count"] = result["count"]
                text = tags_text
                if opts["mode"] != "tags" and tags_text:
                    try:
                        expanded = run_tipo(
                            tags_text,
                            opts["tipo_model"],
                            width,
                            height,
                            device=opts["tipo_device"],
                            tag_length=opts["tipo_tag_length"],
                            temperature=opts["tipo_temperature"],
                            seed=opts["tipo_seed"],
                            tags_only=opts["mode"] == "tipo",
                        )
                        if expanded:
                            text = expanded
                        else:
                            record["error"] = "TIPO 没有输出，已保留原始标签"
                    except Exception as exc:
                        record["error"] = f"TIPO 失败，已保留原始标签：{exc}"
                if opts["prefix"]:
                    text = f"{opts['prefix']}, {text}" if text else opts["prefix"]
                record["text"] = _clean_text(text)
            except Exception as exc:
                record["error"] = f"{type(exc).__name__}: {exc}"
            with _job_lock:
                job["results"].append(record)
                job["done"] = len(job["results"])
        else:
            job["state"] = "done"
        if job["state"] == "running":
            job["state"] = "done"
    except Exception as exc:  # pragma: no cover - 兜底
        logger.exception("[LocalGallery] 反推任务异常")
        job["error"] = f"{type(exc).__name__}: {exc}"
        job["state"] = "error"
    finally:
        job["elapsed"] = time.time() - job["started"]
        job["current"] = ""


def job_status(job_id: str, since: int = 0) -> dict | None:
    with _job_lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        results = job["results"]
        start = max(0, min(int(since or 0), len(results)))
        snapshot = {
            "id": job["id"],
            "state": job["state"],
            "total": job["total"],
            "done": job["done"],
            "elapsed": round(time.time() - job["started"], 1) if job["state"] == "running" else round(job["elapsed"], 1),
            "error": job["error"],
            "current": job["current"],
            "model": job["model"],
            "mode": job["mode"],
        }
        return {"job": snapshot, "results": [dict(r) for r in results[start:]], "next": len(results)}


def cancel_job(job_id: str) -> bool:
    with _job_lock:
        job = _jobs.get(job_id)
        if job is None:
            return False
        job["cancel"] = True
        return True


# --------------------------------------------------------------------------- #
# 写回同名侧车
# --------------------------------------------------------------------------- #
def _find_existing(image_path: Path, ext: str) -> Path | None:
    direct = image_path.with_suffix(ext)
    try:
        if direct.is_file():
            return direct
    except OSError:
        pass
    stem = image_path.stem.lower()
    try:
        for entry in os.scandir(image_path.parent):
            try:
                if not entry.is_file():
                    continue
            except OSError:
                continue
            name_stem, name_ext = os.path.splitext(entry.name)
            if name_stem.lower() == stem and name_ext.lower() == ext.lower():
                return Path(entry.path)
    except OSError:
        pass
    return None


def write_caption(image_path: str, text: str, mode: str = "skip", ext: str = ".txt") -> dict:
    path = Path(str(image_path))
    if not path.is_file():
        raise ValueError("图片不存在")
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError("不是图片文件")
    clean = _clean_text(text)
    if not clean:
        raise ValueError("内容为空")
    if mode not in ("skip", "overwrite", "append"):
        mode = "skip"
    if not ext.startswith("."):
        ext = "." + ext

    existing = _find_existing(path, ext)
    target = existing or path.with_suffix(ext)
    action = "written"
    backup = None

    if existing is not None:
        if mode == "skip":
            return {"path": str(path), "file": str(existing), "action": "skipped"}
        if mode == "append":
            try:
                old = existing.read_text(encoding="utf-8-sig", errors="replace").strip()
            except OSError:
                old = ""
            old = _clean_text(old).rstrip(",").strip()
            if old:
                clean = _clean_text(f"{old}, {clean}")
                action = "appended"
            else:
                action = "written"

    if existing is not None and mode == "overwrite":
        try:
            backup_path = target.with_suffix(target.suffix + ".bak")
            backup_path.write_bytes(target.read_bytes())
            backup = str(backup_path)
        except OSError:
            backup = None

    target.write_text(clean, encoding="utf-8")
    invalidate_sidecar_cache(target.parent)
    return {"path": str(path), "file": str(target), "action": action, "backup": backup}


def write_captions(items: list[dict], mode: str = "skip", ext: str = ".txt") -> dict:
    if len(items) > MAX_WRITE_ITEMS:
        raise ValueError(f"一次最多写入 {MAX_WRITE_ITEMS} 个文件")
    written, skipped, failed = [], [], []
    for item in items:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip()
        if not path:
            continue
        try:
            result = write_caption(path, item.get("text") or "", mode, ext)
        except Exception as exc:
            failed.append({"path": path, "error": f"{type(exc).__name__}: {exc}"})
            continue
        if result["action"] == "skipped":
            skipped.append(result)
        else:
            written.append(result)
    return {"ok": True, "written": written, "skipped": skipped, "failed": failed}


def info() -> dict:
    models = list_models()
    tipo = tipo_status()
    return {
        "ok": True,
        "models": models,
        "default_model": default_model(models),
        "defaults": {
            "threshold": DEFAULT_THRESHOLD,
            "character_threshold": DEFAULT_CHARACTER_THRESHOLD,
        },
        "tipo": tipo,
        "ext": ".txt",
    }
