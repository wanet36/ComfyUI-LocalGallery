"""目录扫描 / 缩略图缓存 / 目录浏览 / 配置。与 ComfyUI 解耦，方便单独测试。"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import re
import shutil
import struct
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .prompt_reader import (
    IMAGE_EXTENSIONS,
    TEXT_SIDECAR_EXTENSIONS,
    find_sidecar_prompt,
    has_prompt_file,
    is_image_file,
)

logger = logging.getLogger(__name__)

# 节点自己的目录（config.json / .trash 都在这里，不是 custom_nodes）
NODE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = NODE_DIR / "config.json"

DEFAULT_CONFIG = {
    # 留空 = 允许浏览本机任意路径；填写后只允许这些根目录（含子目录）
    "allowed_roots": [],
    "thumb_size": 320,
    "thumb_quality": 82,
    "max_scan_files": 20000,
    "max_image_side": 8192,
    # 「删除」不是真删，而是移到这个目录（留空 = 节点目录下的 .trash）
    "trash_dir": "",
    # 关掉后所有删除接口都拒绝执行（只读模式）
    "allow_delete": True,
    # 「最近浏览」记多少条
    "recent_limit": 12,
    "auto_select_when_empty": {
        "enabled": False,
        "limit": 4,
        "recursive": False,
    },
}

# 设置面板能改的字段 -> (中文名, 最小值/校验) ；只写白名单里的键
CONFIG_NUM_RANGES = {
    "thumb_size": ("缩略图尺寸", 96, 640),
    "thumb_quality": ("缩略图质量", 40, 95),
    "max_scan_files": ("扫描上限", 100, 500000),
    "max_image_side": ("单图最大边", 512, 65536),
    "recent_limit": ("最近浏览条数", 3, 50),
}

_config_lock = threading.Lock()
_config_cache: dict | None = None


def load_config() -> dict:
    global _config_cache
    with _config_lock:
        if _config_cache is not None:
            return _config_cache
        data = dict(DEFAULT_CONFIG)
        try:
            if CONFIG_PATH.is_file():
                loaded = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data.update(loaded)
        except Exception:
            pass
        _config_cache = data
        return data


def config_public() -> dict:
    """给设置面板用的配置快照：多带一个实际生效的回收站目录。"""
    cfg = load_config()
    data = {key: cfg.get(key, DEFAULT_CONFIG.get(key)) for key in DEFAULT_CONFIG}
    try:
        data["trash_dir_effective"] = str(trash_root())
    except Exception:
        data["trash_dir_effective"] = ""
    data["node_dir"] = str(NODE_DIR)
    return data


def save_config(patch: dict) -> dict:
    """把设置面板改的几项写回 config.json。

    只认白名单字段；越界 / 类型不对直接抛 ValueError，让前端把话原样显示出来。
    """
    if not isinstance(patch, dict):
        raise ValueError("请求体必须是对象")

    clean = dict(load_config())
    changed: list[str] = []

    for key, (label, low, high) in CONFIG_NUM_RANGES.items():
        if key not in patch:
            continue
        raw = patch.get(key)
        try:
            value = int(float(raw))
        except (TypeError, ValueError):
            raise ValueError(f"{label}要填数字")
        if value < low or value > high:
            raise ValueError(f"{label}要在 {low} ~ {high} 之间")
        clean[key] = value
        changed.append(key)

    if "allow_delete" in patch:
        clean["allow_delete"] = bool(patch.get("allow_delete"))
        changed.append("allow_delete")

    if "trash_dir" in patch:
        raw = str(patch.get("trash_dir") or "").strip()
        if raw:
            target = Path(raw).expanduser()
            if not target.is_absolute():
                raise ValueError("回收站目录要填绝对路径，例如 D:\\AI\\trash\\local_gallery")
            try:
                target.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                raise ValueError(f"回收站目录建不出来：{exc}") from exc
            raw = str(target)
        clean["trash_dir"] = raw
        changed.append("trash_dir")

    if "allowed_roots" in patch:
        raw = patch.get("allowed_roots")
        if isinstance(raw, str):
            raw = re.split(r"[\r\n;|]+", raw)
        if not isinstance(raw, list):
            raise ValueError("allowed_roots 要是路径数组或按行分隔的文本")
        roots: list[str] = []
        for item in raw:
            text = str(item or "").strip()
            if not text:
                continue
            path = Path(text).expanduser()
            if not path.is_absolute():
                raise ValueError(f"白名单目录要填绝对路径：{text}")
            if not path.exists():
                raise ValueError(f"白名单目录不存在：{text}")
            if not path.is_dir():
                raise ValueError(f"白名单要填目录，不是文件：{text}")
            resolved = str(path.resolve())
            if resolved not in roots:
                roots.append(resolved)
        clean["allowed_roots"] = roots
        changed.append("allowed_roots")

    if "auto_select_when_empty" in patch:
        raw = patch.get("auto_select_when_empty") or {}
        if not isinstance(raw, dict):
            raise ValueError("auto_select_when_empty 要是对象")
        auto = dict(DEFAULT_CONFIG["auto_select_when_empty"])
        auto.update({k: v for k, v in (clean.get("auto_select_when_empty") or {}).items() if k in auto})
        auto["enabled"] = bool(raw.get("enabled", auto.get("enabled")))
        auto["recursive"] = bool(raw.get("recursive", auto.get("recursive")))
        if "limit" in raw:
            try:
                limit = int(float(raw.get("limit")))
            except (TypeError, ValueError):
                raise ValueError("空选自动取图张数要填数字")
            if limit < 1 or limit > 64:
                raise ValueError("空选自动取图张数要在 1 ~ 64 之间")
            auto["limit"] = limit
        clean["auto_select_when_empty"] = auto
        changed.append("auto_select_when_empty")

    payload = json.dumps(clean, ensure_ascii=False, indent=2)
    with _config_lock:
        tmp = CONFIG_PATH.with_name(CONFIG_PATH.name + ".tmp")
        tmp.write_text(payload + "\n", encoding="utf-8")
        os.replace(tmp, CONFIG_PATH)
        globals()["_config_cache"] = clean

    logger.info("[LocalGallery] 配置已更新：%s", ", ".join(changed) or "无变化")
    return config_public()


def allowed_roots() -> list[str]:
    roots = load_config().get("allowed_roots") or []
    return [str(Path(r).expanduser().resolve()) for r in roots if str(r).strip()]


def is_path_allowed(path: Path) -> bool:
    roots = allowed_roots()
    if not roots:
        return True
    try:
        resolved = path.resolve()
    except OSError:
        return False
    for root in roots:
        try:
            resolved.relative_to(root)
            return True
        except ValueError:
            continue
    return False


# --------------------------------------------------------------------------- #
# 路径解析（支持一次填多个路径）
# --------------------------------------------------------------------------- #
_PATH_SPLIT = re.compile(r"[\r\n;|]+")


def _clean_path_text(text: str) -> str:
    return str(text or "").strip().strip('"').strip("'").strip()


def resolve_input_paths(raw: str) -> list[Path]:
    """把用户输入拆成路径列表。换行 / 分号 / 竖线都算分隔符（逗号不算，怕误伤目录名）。"""
    text = raw if isinstance(raw, str) else str(raw or "")
    if not text.strip():
        return []
    results: list[Path] = []
    seen: set[str] = set()
    for part in _PATH_SPLIT.split(text):
        cleaned = _clean_path_text(part)
        if not cleaned:
            continue
        path = Path(os.path.expandvars(os.path.expanduser(cleaned)))
        key = str(path).lower()
        if key in seen:
            continue
        seen.add(key)
        results.append(path)
    return results


def resolve_input_path(raw: str) -> Path:
    """取第一个路径（兼容旧调用）。"""
    paths = resolve_input_paths(raw)
    return paths[0] if paths else Path("")


# --------------------------------------------------------------------------- #
# 提示词角标检测（带缓存 + 线程池）
# --------------------------------------------------------------------------- #
# 缓存 mtime -> (有提示词, 宽, 高)
_PROBE_CACHE: dict[str, tuple[float, bool, int, int]] = {}
_FLAG_LOCK = threading.Lock()
_FLAG_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="lg-probe")


def _probe(path: Path, mtime: float) -> tuple[bool, int, int]:
    """一次打开图片，同时拿到 (有无提示词文件, 宽, 高)。

    只读文件头，不解码像素，单张约 0.3~2ms。
    """
    key = str(path).lower()
    with _FLAG_LOCK:
        cached = _PROBE_CACHE.get(key)
        if cached and cached[0] == mtime:
            return cached[1], cached[2], cached[3]

    flag = False
    width = height = 0
    try:
        flag = has_prompt_file(path)
        width, height = read_image_size(path)
    except Exception:
        pass

    with _FLAG_LOCK:
        _PROBE_CACHE[key] = (mtime, flag, width, height)
        if len(_PROBE_CACHE) > 50000:
            _PROBE_CACHE.clear()
    return flag, width, height


def _stat_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _make_item(
    path: Path,
    root: Path | None,
    has_prompt: bool | None = None,
    width: int = 0,
    height: int = 0,
) -> dict:
    try:
        stat = path.stat()
        size, mtime = stat.st_size, stat.st_mtime
    except OSError:
        size, mtime = 0, 0
    try:
        rel = str(path.relative_to(root)) if root else path.name
    except ValueError:
        rel = path.name
    if has_prompt is None:
        flag, width, height = _probe(path, mtime)
        has_prompt = flag
    return {
        "name": path.name,
        "stem": path.stem,
        "rel": rel.replace("\\", "/"),
        "path": str(path),
        "root": str(root) if root else "",
        "size": size,
        "mtime": mtime,
        "ext": path.suffix.lower().lstrip("."),
        "has_prompt": bool(has_prompt),
        "has_prompt_file": has_prompt_file(path),
        "width": int(width or 0),
        "height": int(height or 0),
    }


# --------------------------------------------------------------------------- #
# 图片尺寸（快速通道：只读文件头）
# --------------------------------------------------------------------------- #
def _pil_size(path: Path) -> tuple[int, int]:
    """JPEG / 不支持的格式走 PIL，并按 EXIF 方向换轴（和缩略图、输出张量保持一致）。"""
    try:
        from PIL import Image

        with Image.open(path) as img:
            width, height = img.size
            orientation = 1
            try:
                orientation = int(img.getexif().get(0x0112, 1) or 1)
            except Exception:
                orientation = 1
        if orientation in (5, 6, 7, 8):
            width, height = height, width
        return int(width), int(height)
    except Exception:
        return 0, 0


def read_image_size(path: Path) -> tuple[int, int]:
    """读图片尺寸。PNG/GIF/BMP/WEBP 解析文件头（约 0.05ms），JPEG 交给 PIL。"""
    try:
        with open(path, "rb") as fh:
            head = fh.read(65536)
    except OSError:
        return 0, 0
    if len(head) < 24:
        return _pil_size(path)

    # PNG
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        try:
            width, height = struct.unpack(">II", head[16:24])
            return int(width), int(height)
        except struct.error:
            return 0, 0
    # GIF
    if head[:6] in (b"GIF87a", b"GIF89a"):
        width, height = struct.unpack("<HH", head[6:10])
        return int(width), int(height)
    # BMP
    if head[:2] == b"BM":
        try:
            width, height = struct.unpack("<ii", head[18:26])
            return abs(int(width)), abs(int(height))
        except struct.error:
            return 0, 0
    # WEBP
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        chunk = head[12:16]
        if chunk == b"VP8X" and len(head) >= 30:
            width = 1 + int.from_bytes(head[24:27], "little")
            height = 1 + int.from_bytes(head[27:30], "little")
            return width, height
        if chunk == b"VP8L" and len(head) >= 25:
            bits = int.from_bytes(head[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if chunk == b"VP8 ":
            idx = head.find(b"\x9d\x01\x2a", 12)
            if idx > 0 and len(head) >= idx + 7:
                width = int.from_bytes(head[idx + 3:idx + 5], "little") & 0x3FFF
                height = int.from_bytes(head[idx + 5:idx + 7], "little") & 0x3FFF
                return width, height
    # JPEG 及其它
    return _pil_size(path)


# --------------------------------------------------------------------------- #
# 扫描
# --------------------------------------------------------------------------- #
def _collect_files(target: Path, recursive: bool, keep, max_files: int) -> tuple[list[Path], bool]:
    found: list[Path] = []
    if recursive:
        for dirpath, dirnames, filenames in os.walk(target):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
            for name in sorted(filenames):
                if name.startswith("."):
                    continue
                candidate = Path(dirpath) / name
                if keep(candidate):
                    found.append(candidate)
                    if len(found) >= max_files:
                        return found, True
        return found, False

    with os.scandir(target) as it:
        for entry in it:
            try:
                if not entry.is_file() or entry.name.startswith("."):
                    continue
            except OSError:
                continue
            candidate = Path(entry.path)
            if keep(candidate):
                found.append(candidate)
                if len(found) >= max_files:
                    return found, True
    return found, False


def list_orphan_prompts(
    roots: list[Path],
    recursive: bool = False,
    max_files: int = 20000,
    limit: int | None = None,
) -> dict:
    """找出「有提示词文件、但同目录没有同名图片」的孤儿提示词。

    返回 count（总数）/ samples（前 8 个文件名，给状态栏提示用）/ items（明细，
    每项可带 path/name/dir/size/mtime）。只做 os.scandir，不读文件内容。
    """
    if not roots:
        return {"count": 0, "samples": [], "items": [], "truncated": False}

    count = 0
    samples: list[str] = []
    items: list[dict] = []
    budget = max(1, int(max_files))
    cap = budget if limit is None else max(0, int(limit))
    truncated = False

    def handle_dir(directory: Path) -> None:
        nonlocal count, budget, truncated
        try:
            with os.scandir(directory) as it:
                entries = list(it)
        except OSError:
            return

        images: set[str] = set()
        texts: list[tuple[Path, os.stat_result | None]] = []
        for entry in entries:
            try:
                if not entry.is_file() or entry.name.startswith("."):
                    continue
            except OSError:
                continue
            stem, suffix = os.path.splitext(entry.name)
            suffix = suffix.lower()
            if suffix in IMAGE_EXTENSIONS:
                images.add(stem.lower())
            elif suffix in TEXT_SIDECAR_EXTENSIONS:
                try:
                    texts.append((Path(entry.path), entry.stat()))
                except OSError:
                    texts.append((Path(entry.path), None))

        # kohya 风格的目录级提示词（`1_girl smile.txt` / `目录名.txt`）不算孤儿
        folder_name = directory.name.lower()
        folder_caption = re.sub(r"^\d+_", "", folder_name).replace("_", " ")

        for path, stat in texts:
            if budget <= 0:
                truncated = True
                return
            budget -= 1
            stem = path.stem.lower()
            if stem in images or stem in (folder_name, folder_caption):
                continue
            count += 1
            if len(samples) < 8:
                samples.append(path.name)
            if len(items) < cap:
                items.append(
                    {
                        "path": str(path),
                        "name": path.name,
                        "dir": str(path.parent),
                        "size": int(stat.st_size) if stat else 0,
                        "mtime": float(stat.st_mtime) if stat else 0.0,
                    }
                )

    for root in roots:
        try:
            if not root.is_dir():
                continue
        except OSError:
            continue
        if recursive:
            for dirpath, dirnames, _ in os.walk(root):
                dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
                handle_dir(Path(dirpath))
        else:
            handle_dir(root)

    return {"count": count, "samples": samples, "items": items, "truncated": truncated}


def count_orphan_prompts(
    roots: list[Path],
    recursive: bool = False,
    max_files: int = 20000,
) -> dict:
    """只要计数（扫描主流程用，明细交给 /orphans 接口按需取）。"""
    data = list_orphan_prompts(roots, recursive, max_files, limit=0)
    return {"count": data["count"], "samples": data["samples"]}


def scan_orphan_prompts(raw_path: str, recursive: bool = False) -> dict:
    """给 /orphans 接口用：解析路径 → 列出孤儿提示词明细。"""
    targets = resolve_input_paths(raw_path)
    dirs = []
    for target in targets:
        try:
            if target.is_dir():
                dirs.append(target)
        except OSError:
            continue
    max_files = int(load_config().get("max_scan_files", 20000))
    data = list_orphan_prompts(dirs, recursive, max_files, limit=max_files)
    data["ok"] = True
    data["dirs"] = [str(d) for d in dirs]
    return data


def scan_folder(
    raw_path: str,
    recursive: bool = False,
    only_with_prompt: bool = False,
    extensions: list[str] | None = None,
) -> dict:
    """扫描一个或多个路径（目录或图片文件），合并去重后返回。"""
    targets = resolve_input_paths(raw_path)
    if not targets:
        return {
            "ok": False,
            "error": "路径为空",
            "root": "",
            "roots": [],
            "items": [],
            "truncated": False,
            "invalid": [],
            "multi": False,
            "orphan_prompts": 0,
            "orphan_samples": [],
        }

    max_files = int(load_config().get("max_scan_files", 20000))
    ext_filter = None
    if extensions:
        ext_filter = {("." + e.lower().lstrip(".")) for e in extensions if e}

    def keep(path: Path) -> bool:
        suffix = path.suffix.lower()
        if suffix not in IMAGE_EXTENSIONS:
            return False
        if ext_filter and suffix not in ext_filter:
            return False
        return True

    items: list[dict] = []
    roots: list[str] = []
    invalid: list[dict] = []
    seen: set[str] = set()
    truncated = False

    for target in targets:
        raw_target = str(target)
        if not raw_target:
            continue
        if not target.exists():
            invalid.append({"path": raw_target, "error": f"路径不存在：{raw_target}"})
            continue
        if not is_path_allowed(target):
            invalid.append(
                {"path": raw_target, "error": "路径不在 config.json 的 allowed_roots 范围内"}
            )
            continue

        # 1) 单个图片文件
        if target.is_file():
            if not keep(target):
                invalid.append({"path": raw_target, "error": f"不是支持的图片格式：{target.name}"})
                continue
            roots.append(str(target.parent))
            mtime = _stat_mtime(target)
            flag, width, height = _probe(target, mtime)
            if only_with_prompt and not flag:
                continue
            key = raw_target.lower()
            if key in seen:
                continue
            seen.add(key)
            item = _make_item(target, target.parent, has_prompt=flag, width=width, height=height)
            item["mtime"] = mtime
            items.append(item)
            continue

        # 2) 目录
        roots.append(str(target))
        try:
            found, was_truncated = _collect_files(
                target, recursive, keep, max(1, max_files - len(items))
            )
        except PermissionError:
            invalid.append({"path": raw_target, "error": "没有权限读取该目录"})
            continue
        except OSError as exc:
            invalid.append({"path": raw_target, "error": f"读取目录失败：{exc}"})
            continue

        truncated = truncated or was_truncated
        if not found:
            continue

        found.sort(key=lambda p: (p.name.lower(), str(p)))
        stats = [_stat_mtime(p) for p in found]
        probed = list(
            _FLAG_POOL.map(
                lambda pair: _probe(pair[0], pair[1]),
                zip(found, stats),
            )
        )
        for path, mtime, (flag, width, height) in zip(found, stats, probed):
            key = str(path).lower()
            if key in seen:
                continue
            if only_with_prompt and not flag:
                continue
            seen.add(key)
            item = _make_item(path, target, has_prompt=flag, width=width, height=height)
            item["mtime"] = mtime
            items.append(item)

    error = ""
    if invalid:
        error = "；".join(entry["error"] for entry in invalid[:3])

    # 去重但保持顺序（同一目录被多条路径带出来时不要重复计数）
    roots = list(dict.fromkeys(roots))

    single_file = False
    try:
        single_file = len(targets) == 1 and targets[0].is_file()
    except OSError:
        single_file = False

    orphan = count_orphan_prompts([t for t in targets if t.is_dir()], recursive, max_files)

    return {
        "ok": bool(items) or not invalid,
        "error": error,
        "root": roots[0] if roots else "",
        "roots": roots,
        "items": items,
        "truncated": truncated,
        "invalid": invalid,
        "recursive": bool(recursive),
        "multi": len(roots) > 1,
        "is_file": single_file,
        "orphan_prompts": orphan["count"],
        "orphan_samples": orphan["samples"],
    }


def describe_paths(paths: list[str]) -> list[dict]:
    """把一批绝对路径（手动导入的图片）整理成 item。"""
    items = []
    seen = set()
    for raw in paths or []:
        if not isinstance(raw, str):
            continue
        path = Path(os.path.expandvars(os.path.expanduser(_clean_path_text(raw))))
        if not path.is_file() or not is_image_file(path):
            continue
        key = str(path).lower()
        if key in seen:
            continue
        seen.add(key)
        items.append(_make_item(path, None))
    return items


# --------------------------------------------------------------------------- #
# 目录浏览（前端内置文件浏览器，不依赖系统对话框 / tkinter）
# --------------------------------------------------------------------------- #
def list_drives() -> list[str]:
    drives = []
    for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
        root = f"{letter}:\\"
        try:
            if Path(root).exists():
                drives.append(root)
        except OSError:
            continue
    if not drives:
        drives = ["/"]
    return drives


def browse_dir(raw_path: str, limit: int = 400) -> dict:
    """列出目录下的子目录与图片，供前端文件浏览器使用。"""
    text = _clean_path_text(raw_path or "")
    if not text:
        return {
            "ok": True,
            "path": "",
            "parent": None,
            "drives": list_drives(),
            "dirs": [],
            "images": [],
            "image_total": 0,
            "truncated": False,
        }

    target = Path(os.path.expandvars(os.path.expanduser(text)))
    if not target.exists():
        return {"ok": False, "error": f"路径不存在：{text}", "path": text}
    if not is_path_allowed(target):
        return {"ok": False, "error": "路径不在 allowed_roots 允许范围内", "path": text}
    if target.is_file():
        target = target.parent

    dirs: list[dict] = []
    images: list[dict] = []
    image_total = 0
    truncated = False

    try:
        with os.scandir(target) as it:
            for entry in it:
                try:
                    if entry.name.startswith("."):
                        continue
                    if entry.is_dir():
                        if len(dirs) < limit:
                            dirs.append({"name": entry.name, "path": entry.path})
                    elif entry.is_file():
                        suffix = Path(entry.name).suffix.lower()
                        if suffix in IMAGE_EXTENSIONS:
                            image_total += 1
                            if len(images) < limit:
                                images.append(
                                    {
                                        "name": entry.name,
                                        "path": entry.path,
                                        "size": entry.stat().st_size,
                                    }
                                )
                            else:
                                truncated = True
                except OSError:
                    continue
    except PermissionError:
        return {"ok": False, "error": "没有权限读取该目录", "path": str(target)}
    except OSError as exc:
        return {"ok": False, "error": f"读取目录失败：{exc}", "path": str(target)}

    dirs.sort(key=lambda d: d["name"].lower())
    images.sort(key=lambda f: f["name"].lower())

    parent = str(target.parent) if target.parent != target else None

    return {
        "ok": True,
        "path": str(target),
        "parent": parent,
        "drives": list_drives(),
        "dirs": dirs,
        "images": images,
        "image_total": image_total,
        "truncated": truncated,
    }


# --------------------------------------------------------------------------- #
# 缩略图
# --------------------------------------------------------------------------- #
_THUMB_LOCK = threading.Semaphore(4)


def thumb_cache_dir() -> Path:
    base = Path(tempfile.gettempdir()) / "comfyui_local_gallery_thumbs"
    base.mkdir(parents=True, exist_ok=True)
    return base


def make_thumbnail(image_path: str, size: int | None = None) -> bytes | None:
    """生成并缓存 JPEG 缩略图。失败返回 None。"""
    from PIL import Image, ImageOps

    path = Path(image_path)
    if not path.is_file():
        return None
    cfg = load_config()
    size = int(size or cfg.get("thumb_size", 320))
    size = max(64, min(size, 1024))
    quality = int(cfg.get("thumb_quality", 82))

    try:
        stat = path.stat()
        key_src = f"{path.resolve()}|{stat.st_mtime_ns}|{stat.st_size}|{size}|{quality}"
    except OSError:
        return None
    key = hashlib.sha1(key_src.encode("utf-8", "ignore")).hexdigest()
    cache_file = thumb_cache_dir() / f"{key}.jpg"
    if cache_file.is_file():
        try:
            return cache_file.read_bytes()
        except OSError:
            pass

    with _THUMB_LOCK:
        if cache_file.is_file():
            try:
                return cache_file.read_bytes()
            except OSError:
                pass
        try:
            with Image.open(path) as img:
                img = ImageOps.exif_transpose(img)
                if getattr(img, "is_animated", False):
                    img.seek(0)
                img.thumbnail((size, size), Image.LANCZOS)
                if img.mode in ("RGBA", "LA", "P"):
                    img = img.convert("RGBA")
                    background = Image.new("RGB", img.size, (255, 255, 255))
                    background.paste(img, mask=img.split()[-1])
                    img = background
                else:
                    img = img.convert("RGB")
                buffer = io.BytesIO()
                img.save(buffer, format="JPEG", quality=quality, optimize=True)
                data = buffer.getvalue()
        except Exception:
            return None

        try:
            tmp = cache_file.with_suffix(".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, cache_file)
        except OSError:
            pass
        return data


def image_size(image_path: str) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(image_path) as img:
            return img.size
    except Exception:
        return (0, 0)


# --------------------------------------------------------------------------- #
# 删除（移入回收站，可恢复）
# --------------------------------------------------------------------------- #
TRASH_DIRNAME = ".trash"
TRASH_MANIFEST = "manifest.json"
TRASH_VERSION = 1


def trash_root() -> Path:
    """回收站根目录：config.trash_dir 或节点目录下的 .trash。"""
    raw = str(load_config().get("trash_dir") or "").strip()
    root = Path(os.path.expandvars(os.path.expanduser(raw))) if raw else (NODE_DIR / TRASH_DIRNAME)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _unique_path(target: Path) -> Path:
    """目标已存在时加 -1、-2 后缀。"""
    if not target.exists():
        return target
    stem, suffix, parent = target.stem, target.suffix, target.parent
    for i in range(1, 1000):
        candidate = parent / f"{stem}-{i}{suffix}"
        if not candidate.exists():
            return candidate
    raise OSError(f"无法为 {target.name} 找到可用的回收站文件名")


def _trash_target(batch: Path, src: Path) -> Path:
    """保留「盘符/目录层级」，避免不同目录的同名文件互相覆盖。"""
    drive = (src.drive or "disk").replace(":", "").strip("\\/") or "disk"
    try:
        anchor = Path(src.anchor) if src.anchor else None
        rel_parent = src.parent.relative_to(anchor) if anchor else Path("")
    except (ValueError, OSError):
        rel_parent = Path(src.parent.name)
    return _unique_path(batch / drive / rel_parent / src.name)


# ------------------------------- 回收站清单 -------------------------------- #
# 单靠「盘符/目录层级」能还原绝大多数路径，但撞名时会被加 -1 后缀，
# 所以要有一份 manifest 记录「回收站里的相对路径 ↔ 原始绝对路径」。
def _manifest_path(batch: Path) -> Path:
    return batch / TRASH_MANIFEST


def _load_manifest(batch: Path) -> dict:
    path = _manifest_path(batch)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("items"), list):
                data.setdefault("version", TRASH_VERSION)
                return data
        except Exception:
            pass
    return {"version": TRASH_VERSION, "created": "", "items": []}


def _save_manifest(batch: Path, data: dict) -> None:
    try:
        _manifest_path(batch).write_text(
            json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8"
        )
    except OSError:
        logger.warning("[LocalGallery] 回收站清单写入失败：%s", batch)


def _stored_rel(batch: Path, path: Path) -> str:
    try:
        return path.relative_to(batch).as_posix()
    except ValueError:
        return path.name


def _new_item_id() -> str:
    return uuid.uuid4().hex[:10]


def _file_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _legacy_items(batch: Path) -> list[dict]:
    """老批次没有 manifest：按「盘符/相对目录/文件名」反推原始路径。"""
    groups: dict[tuple[str, str], dict] = {}
    try:
        files = [p for p in batch.rglob("*") if p.is_file() and p.name != TRASH_MANIFEST]
    except OSError:
        files = []

    for file in files:
        rel = file.relative_to(batch)
        parts = rel.parts
        if len(parts) >= 2:
            drive = parts[0]
            tail = Path(*parts[1:])
            original = Path(f"{drive}:\\") / tail
        else:
            original = Path(file.name)
        key = (str(original.parent).lower(), original.stem.lower())
        group = groups.setdefault(
            key,
            {
                # 老批次没有清单，id 必须由「原始路径」推导出来并保持稳定，
                # 否则 list_trash 给的 id 到 restore 时就对不上了
                "id": hashlib.sha1(str(original.parent).lower().encode("utf-8")).hexdigest()[:10]
                + hashlib.sha1(original.stem.lower().encode("utf-8")).hexdigest()[:4],
                "original": "",
                "stored": "",
                "kind": "image" if is_image_file(file) else "prompt",
                "size": 0,
                "sidecars": [],
            },
        )
        if is_image_file(file):
            group["original"] = str(original)
            group["stored"] = _stored_rel(batch, file)
            group["size"] = _file_size(file)
        else:
            group["sidecars"].append(
                {"original": str(original), "stored": _stored_rel(batch, file)}
            )
            if not group["original"]:
                group["original"] = str(original)
                group["stored"] = _stored_rel(batch, file)
                group["kind"] = "prompt"
                group["size"] = _file_size(file)
    return list(groups.values())


def trash_images(paths: list[str], batch_name: str | None = None) -> dict:
    """把图片及其同名提示词文件移到回收站。

    只接受图片文件；目录、非图片、allowed_roots 外的路径一律拒绝。
    """
    config = load_config()
    if config.get("allow_delete") is False:
        return {"ok": False, "error": "config.json 里 allow_delete 为 false，已禁用删除", "moved": [], "failed": []}

    stamp = batch_name or time.strftime("%Y%m%d-%H%M%S")
    try:
        root = trash_root()
        batch = root / stamp
        batch.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return {"ok": False, "error": f"无法创建回收站目录：{exc}", "moved": [], "failed": []}

    moved: list[dict] = []
    failed: list[dict] = []
    sidecars = TEXT_SIDECAR_EXTENSIONS + (".json", ".TXT")

    for raw in paths:
        raw = str(raw or "").strip()
        if not raw:
            continue
        try:
            src = Path(os.path.expandvars(os.path.expanduser(raw)))
        except (ValueError, OSError) as exc:
            failed.append({"path": raw, "error": f"路径非法：{exc}"})
            continue

        if src.is_dir():
            failed.append({"path": str(src), "error": "是文件夹，不处理"})
            continue
        if not src.is_file():
            failed.append({"path": str(src), "error": "文件不存在"})
            continue
        if not is_image_file(src):
            failed.append({"path": str(src), "error": "不是图片文件"})
            continue
        if not is_path_allowed(src):
            failed.append({"path": str(src), "error": "不在 allowed_roots 允许范围内"})
            continue

        try:
            target = _trash_target(batch, src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(target))
        except (OSError, shutil.Error) as exc:
            failed.append({"path": str(src), "error": f"移动失败：{exc}"})
            continue

        entry = {"path": str(src), "to": str(target), "sidecars": []}
        item = {
            "id": _new_item_id(),
            "kind": "image",
            "original": str(src),
            "stored": _stored_rel(batch, target),
            "size": _file_size(target),
            "sidecars": [],
        }

        # 同名提示词文件一起移走，否则会留下孤儿 txt
        for ext in sidecars:
            side = src.with_suffix(ext)
            if not side.is_file():
                continue
            try:
                side_target = _unique_path(target.parent / side.name)
                shutil.move(str(side), str(side_target))
                entry["sidecars"].append({"path": str(side), "to": str(side_target)})
                item["sidecars"].append(
                    {"original": str(side), "stored": _stored_rel(batch, side_target)}
                )
            except (OSError, shutil.Error) as exc:
                entry.setdefault("warnings", []).append(f"{side.name} 移动失败：{exc}")

        moved.append(entry)
        _append_manifest(batch, item)

    return {
        "ok": bool(moved) or not failed,
        "trash_dir": str(batch),
        "moved": moved,
        "failed": failed,
    }


def _append_manifest(batch: Path, item: dict) -> None:
    data = _load_manifest(batch)
    if not data.get("created"):
        data["created"] = time.strftime("%Y-%m-%d %H:%M:%S")
    data["items"].append(item)
    _save_manifest(batch, data)


def _sidecar_files(image_path: Path) -> list[Path]:
    """一张图对应的所有侧车文件（大小写不敏感，同目录）。"""
    stem = image_path.stem.lower()
    found: list[Path] = []
    try:
        entries = list(os.scandir(image_path.parent))
    except OSError:
        return found
    allowed = {ext.lower() for ext in TEXT_SIDECAR_EXTENSIONS} | {".json"}
    for entry in entries:
        try:
            if not entry.is_file():
                continue
        except OSError:
            continue
        name_stem, name_ext = os.path.splitext(entry.name)
        if name_stem.lower() == stem and name_ext.lower() in allowed:
            found.append(Path(entry.path))
    # 目录级 kohya 标注不动：它不属于单张图
    return found


def trash_prompts(paths: list[str], batch_name: str | None = None) -> dict:
    """只把提示词文件移到回收站，**不动图片**。

    `paths` 既可以是图片路径（自动找它的同名侧车），也可以直接是 `.txt` 等提示词文件。
    """
    config = load_config()
    if config.get("allow_delete") is False:
        return {"ok": False, "error": "config.json 里 allow_delete 为 false，已禁用删除", "moved": [], "failed": []}

    stamp = batch_name or time.strftime("%Y%m%d-%H%M%S")
    try:
        batch = trash_root() / stamp
        batch.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return {"ok": False, "error": f"无法创建回收站目录：{exc}", "moved": [], "failed": []}

    targets: list[Path] = []
    seen: set[str] = set()
    failed: list[dict] = []
    for raw in paths:
        text = str(raw or "").strip()
        if not text:
            continue
        try:
            src = Path(os.path.expandvars(os.path.expanduser(text)))
        except (ValueError, OSError) as exc:
            failed.append({"path": text, "error": f"路径非法：{exc}"})
            continue
        if not is_path_allowed(src):
            failed.append({"path": str(src), "error": "不在 allowed_roots 允许范围内"})
            continue
        if not src.is_file():
            failed.append({"path": str(src), "error": "文件不存在"})
            continue

        if is_image_file(src):
            sides = _sidecar_files(src)
            if not sides:
                failed.append({"path": str(src), "error": "没有同名提示词文件"})
                continue
            candidates = sides
        elif src.suffix.lower() in {ext.lower() for ext in TEXT_SIDECAR_EXTENSIONS} | {".json"}:
            candidates = [src]
        else:
            failed.append({"path": str(src), "error": "不是提示词文件"})
            continue

        for candidate in candidates:
            key = str(candidate).lower()
            if key in seen:
                continue
            seen.add(key)
            targets.append(candidate)

    moved: list[dict] = []
    for src in targets:
        try:
            target = _trash_target(batch, src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(target))
        except (OSError, shutil.Error) as exc:
            failed.append({"path": str(src), "error": f"移动失败：{exc}"})
            continue
        moved.append({"path": str(src), "to": str(target)})
        _append_manifest(
            batch,
            {
                "id": _new_item_id(),
                "kind": "prompt",
                "original": str(src),
                "stored": _stored_rel(batch, target),
                "size": _file_size(target),
                "sidecars": [],
            },
        )

    return {
        "ok": bool(moved) or not failed,
        "trash_dir": str(batch),
        "moved": moved,
        "failed": failed,
    }


def list_trash(limit_per_batch: int = 400) -> dict:
    """列出回收站里的每个批次和条目（带原路径，可直接恢复）。"""
    root = trash_root()
    batches: list[dict] = []
    try:
        entries = sorted(
            (p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")),
            key=lambda p: p.name,
            reverse=True,
        )
    except OSError:
        entries = []

    for batch in entries:
        manifest = _load_manifest(batch)
        items = manifest.get("items") or []
        if not items:
            items = _legacy_items(batch)

        rows: list[dict] = []
        for item in items:
            stored = batch / (item.get("stored") or "")
            if not item.get("stored") or not stored.is_file():
                continue
            sidecars = [
                side for side in (item.get("sidecars") or []) if (batch / (side.get("stored") or "")).is_file()
            ]
            rows.append(
                {
                    "id": item.get("id") or _new_item_id(),
                    "kind": "image" if item.get("kind") == "image" else "prompt",
                    "name": Path(str(item.get("original") or stored.name)).name,
                    "original": str(item.get("original") or ""),
                    "stored": item.get("stored"),
                    "size": int(item.get("size") or 0),
                    "sidecars": len(sidecars),
                }
            )
        if not rows:
            continue
        rows.sort(key=lambda r: (r["kind"] != "image", r["name"].lower()))
        batches.append(
            {
                "name": batch.name,
                "path": str(batch),
                "created": manifest.get("created") or batch.name,
                "items": rows[:limit_per_batch],
                "total": len(rows),
                "images": sum(1 for r in rows if r["kind"] == "image"),
                "prompts": sum(1 for r in rows if r["kind"] == "prompt"),
            }
        )
    return {
        "ok": True,
        "root": str(root),
        "batches": batches,
        "total": sum(b["total"] for b in batches),
    }


def trash_thumb(batch_name: str, stored: str, size: int = 320) -> bytes | None:
    """回收站里的缩略图（不走 allowed_roots，因为 .trash 通常在节点目录下）。"""
    root = trash_root().resolve()
    try:
        target = (root / batch_name / stored).resolve()
    except (OSError, ValueError):
        return None
    if root not in target.parents:
        return None
    if not target.is_file() or not is_image_file(target):
        return None
    return make_thumbnail(str(target), size)


def restore_trash(entries: list[dict]) -> dict:
    """按 {batch, id} 把文件移回原位置；目标已存在时自动加 -1 后缀。"""
    root = trash_root()
    restored: list[dict] = []
    failed: list[dict] = []
    touched: set[str] = set()

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        batch_name = str(entry.get("batch") or "").strip()
        item_id = str(entry.get("id") or "").strip()
        if not batch_name or not item_id:
            failed.append({"batch": batch_name, "id": item_id, "error": "参数不完整"})
            continue
        batch = root / batch_name
        if not batch.is_dir():
            failed.append({"batch": batch_name, "id": item_id, "error": "批次不存在"})
            continue

        manifest = _load_manifest(batch)
        items = manifest.get("items") or []
        if not items:
            items = _legacy_items(batch)
            manifest["items"] = items

        item = next((it for it in items if str(it.get("id")) == item_id), None)
        if item is None:
            failed.append({"batch": batch_name, "id": item_id, "error": "条目不存在"})
            continue

        stored = batch / (item.get("stored") or "")
        original = Path(str(item.get("original") or ""))
        if not item.get("stored") or not stored.is_file():
            failed.append({"batch": batch_name, "id": item_id, "error": "回收站里的文件已丢失"})
            continue
        if not str(original) or not is_path_allowed(original):
            failed.append({"batch": batch_name, "id": item_id, "error": "原路径不在 allowed_roots 内"})
            continue

        try:
            original.parent.mkdir(parents=True, exist_ok=True)
            target = _unique_path(original)
            shutil.move(str(stored), str(target))
        except (OSError, shutil.Error) as exc:
            failed.append({"batch": batch_name, "id": item_id, "error": f"恢复失败：{exc}"})
            continue

        for side in item.get("sidecars") or []:
            side_stored = batch / (side.get("stored") or "")
            side_original = Path(str(side.get("original") or ""))
            if not side_stored.is_file() or not str(side_original):
                continue
            try:
                side_original.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(side_stored), str(_unique_path(side_original)))
            except (OSError, shutil.Error):
                logger.warning("[LocalGallery] 侧车恢复失败：%s", side_original)

        restored.append(
            {
                "batch": batch_name,
                "id": item_id,
                "kind": item.get("kind") or "image",
                "original": str(original),
                "target": str(target),
                "renamed": target != original,
            }
        )
        touched.add(batch_name)
        manifest["items"] = [it for it in items if str(it.get("id")) != item_id]
        _save_manifest(batch, manifest)

    # 空批次直接删掉（只删目录，不删文件）
    for batch_name in touched:
        batch = root / batch_name
        try:
            # manifest.json 本身不算内容，否则空批次永远删不掉
            has_file = any(
                p.is_file() and p.name != TRASH_MANIFEST for p in batch.rglob("*")
            )
        except OSError:
            has_file = True
        if not has_file:
            try:
                shutil.rmtree(batch, ignore_errors=True)
            except OSError:
                pass

    return {"ok": bool(restored) or not failed, "restored": restored, "failed": failed}


def purge_trash(batch_name: str | None = None) -> dict:
    """永久删除某一批（batch_name）或整个回收站。"""
    root = trash_root()
    removed = 0
    if batch_name:
        targets = [root / batch_name]
    else:
        try:
            targets = [p for p in root.iterdir() if p.is_dir()]
        except OSError:
            targets = []
    for batch in targets:
        try:
            if not batch.is_dir():
                continue
            root_resolved = root.resolve()
            if root_resolved not in batch.resolve().parents:
                continue
            removed += sum(
                1 for p in batch.rglob("*") if p.is_file() and p.name != TRASH_MANIFEST
            )
            shutil.rmtree(batch, ignore_errors=True)
        except OSError:
            continue
    return {"ok": True, "removed": removed}


def restore_hint(trash_dir: str) -> str:
    return f"文件已移到回收站：{trash_dir}（可在节点里打开「回收站」随时恢复）"


# --------------------------------------------------------------------------- #
# 上次用过的路径（服务端持久化）
# --------------------------------------------------------------------------- #
# 光靠浏览器 localStorage 不够：换浏览器、或者 localhost 与 127.0.0.1 交替访问
# 时不同源，都会丢。这里在节点目录存一份，重启 ComfyUI 后新节点直接接上。
LAST_PATHS_FILE = NODE_DIR / ".last_paths.json"


def load_last_paths() -> list[str]:
    try:
        raw = LAST_PATHS_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, ValueError):
        return []
    if isinstance(data, dict):
        data = data.get("paths")
    if not isinstance(data, list):
        return []
    return [str(item).strip() for item in data if str(item).strip()]


def save_last_paths(paths) -> list[str]:
    """记住路径列表（含空列表 —— 用户主动清空后不该再被「恢复」回来）。"""
    if isinstance(paths, str):
        paths = [paths]
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in paths or []:
        text = str(item or "").strip()
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(text)
    payload = {"paths": cleaned, "updated": time.time()}
    try:
        LAST_PATHS_FILE.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        logger.warning(f"[LocalGallery] 记住路径失败：{exc}")
    return cleaned


# --------------------------------------------------------------------------- #
# 通用 UI 设置（服务端持久化：换浏览器 / 换设备也在）
# --------------------------------------------------------------------------- #
UI_SETTINGS_FILE = NODE_DIR / ".ui_settings.json"
UI_SETTINGS_DEFAULTS = {"favorites_export_dir": ""}


def load_ui_settings() -> dict:
    data: dict = {}
    try:
        raw = json.loads(UI_SETTINGS_FILE.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            data = raw
    except (OSError, ValueError):
        data = {}

    result = dict(UI_SETTINGS_DEFAULTS)
    value = data.get("favorites_export_dir")
    if isinstance(value, str):
        result["favorites_export_dir"] = value.strip()
    return result


def save_ui_settings(patch: dict) -> dict:
    current = load_ui_settings()
    if isinstance(patch, dict):
        value = patch.get("favorites_export_dir")
        if isinstance(value, str):
            current["favorites_export_dir"] = value.strip()
    try:
        UI_SETTINGS_FILE.write_text(
            json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except OSError as exc:
        logger.warning(f"[LocalGallery] 保存设置失败：{exc}")
    return current


# --------------------------------------------------------------------------- #
# 按提示词搜索
# --------------------------------------------------------------------------- #
_PROMPT_TEXT_CACHE: dict[str, tuple[float, str]] = {}
_PROMPT_TEXT_LOCK = threading.Lock()


def _prompt_text(path: Path) -> str:
    """带 mtime 缓存地读一张图的提示词（搜索时反复调用）。"""
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return ""
    key = str(path).lower()
    with _PROMPT_TEXT_LOCK:
        cached = _PROMPT_TEXT_CACHE.get(key)
        if cached and cached[0] == mtime:
            return cached[1]
    try:
        text = find_sidecar_prompt(str(path)) or ""
    except Exception:
        text = ""
    with _PROMPT_TEXT_LOCK:
        _PROMPT_TEXT_CACHE[key] = (mtime, text)
        if len(_PROMPT_TEXT_CACHE) > 20000:
            _PROMPT_TEXT_CACHE.clear()
    return text


def search_prompts(files: list[str], keywords: list[str]) -> dict:
    """在给定图片文件里按提示词内容搜索。

    多个关键词是「与」关系（全部出现才算命中），不区分大小写。
    只读同名提示词文件。
    """
    kws = [str(k).strip().lower() for k in keywords if str(k).strip()]
    if not kws:
        return {"hits": [], "scanned": 0, "with_prompt": 0, "keywords": []}

    hits: list[str] = []
    scanned = 0
    with_prompt = 0
    seen: set[str] = set()

    for raw in files:
        raw = str(raw or "").strip()
        if not raw or raw.lower() in seen:
            continue
        seen.add(raw.lower())
        path = Path(raw)
        if not path.is_file():
            continue
        scanned += 1
        text = _prompt_text(path)
        if not text:
            continue
        with_prompt += 1
        low = text.lower()
        if all(kw in low for kw in kws):
            hits.append(raw)

    return {"hits": hits, "scanned": scanned, "with_prompt": with_prompt, "keywords": kws}
