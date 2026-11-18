"""
本地提示词读取器（只认同名文件）
================================

给定一张本地图片，找出与它配套的提示词文件，按优先级：

1. 同名文本侧车：`a.png` -> `a.txt` / `a.caption` / `a.prompt` / `a.tags`（大小写不敏感）
2. 同名 JSON 侧车：`a.json`（支持 kohya `captions` 列表、`prompt`/`caption`/`text` 字段）
3. 目录级提示词：kohya 风格 `1_girl smile/` 目录里的 `1_girl smile.txt`（自动去掉 `数字_` 前缀）
4. 跨文件夹同名：另一条已加入的路径里有同名 .txt（比如图片在 `output/`、提示词在 `output/提示词/`）

不读图片内嵌的任何元数据（工作流参数一律忽略）。
全部失败时返回空字符串，绝不抛异常给上层。
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

IMAGE_EXTENSIONS = (
    ".png", ".jpg", ".jpeg", ".jfif", ".webp", ".bmp",
    ".gif", ".tif", ".tiff", ".avif", ".jxl",
)

TEXT_SIDECAR_EXTENSIONS = (".txt", ".caption", ".prompt", ".tags", ".md")

# 目录索引缓存：避免一次处理几十张图时反复 scandir
_DIR_CACHE: dict[str, tuple[float, dict[str, str]]] = {}
_DIR_CACHE_LOCK = threading.Lock()
_DIR_CACHE_TTL = 5.0

# 跨文件夹索引缓存：key = 排序后的目录元组
_CROSS_CACHE: dict[tuple[str, ...], tuple[float, dict[str, str]]] = {}
_CROSS_CACHE_LOCK = threading.Lock()
_CROSS_CACHE_TTL = 5.0


# --------------------------------------------------------------------------- #
# 基础工具
# --------------------------------------------------------------------------- #
def is_image_file(path: str | os.PathLike) -> bool:
    return Path(path).suffix.lower() in IMAGE_EXTENSIONS


def _read_text(path: Path) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gbk", "latin-1"):
        try:
            text = path.read_text(encoding=encoding)
        except (UnicodeDecodeError, LookupError):
            continue
        except OSError:
            return ""
        return text.strip()
    return ""


def _dir_index(directory: Path) -> dict[str, str]:
    """directory 下 `小写文件名 -> 真实文件名` 的索引（带短 TTL 缓存）。"""
    key = str(directory)
    now = time.time()
    with _DIR_CACHE_LOCK:
        cached = _DIR_CACHE.get(key)
        if cached and now - cached[0] < _DIR_CACHE_TTL:
            return cached[1]
    index: dict[str, str] = {}
    try:
        with os.scandir(directory) as it:
            for entry in it:
                try:
                    if entry.is_file():
                        index[entry.name.lower()] = entry.name
                except OSError:
                    continue
    except OSError:
        index = {}
    with _DIR_CACHE_LOCK:
        _DIR_CACHE[key] = (now, index)
        if len(_DIR_CACHE) > 256:
            _DIR_CACHE.clear()
    return index


def _find_case_insensitive(directory: Path, filename: str) -> Path | None:
    direct = directory / filename
    if direct.is_file():
        return direct
    real = _dir_index(directory).get(filename.lower())
    if real:
        candidate = directory / real
        if candidate.is_file():
            return candidate
    return None


# --------------------------------------------------------------------------- #
# JSON 侧车
# --------------------------------------------------------------------------- #
_RE_NEGATIVE = re.compile(r"^\s*negative\s*prompt\s*:", re.IGNORECASE)
_RE_PARAM_LINE = re.compile(r"^\s*steps\s*:\s*\d+", re.IGNORECASE)


def strip_a1111_parameters(text: str) -> str:
    """从 A1111 的 `parameters` 文本里取出正向提示词。"""
    if not text:
        return ""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cut = len(lines)
    for i, line in enumerate(lines):
        if _RE_NEGATIVE.match(line) or _RE_PARAM_LINE.match(line):
            cut = i
            break
    positive = "\n".join(lines[:cut]).strip()
    return positive or text.strip()


def _prompt_from_json_file(path: Path) -> str:
    raw = _read_text(path)
    if not raw:
        return ""
    try:
        data = json.loads(raw)
    except ValueError:
        return raw  # 后缀是 .json 但内容是裸文本

    if isinstance(data, list):
        joined = ", ".join(str(x).strip() for x in data if str(x).strip())
        return joined.strip()
    if isinstance(data, str):
        return data.strip()
    if not isinstance(data, dict):
        return ""

    for key in ("prompt", "caption", "text", "tags", "positive", "content", "description"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            if key == "positive":
                return strip_a1111_parameters(value)
            return value.strip()
        if isinstance(value, list):
            joined = ", ".join(str(x).strip() for x in value if str(x).strip())
            if joined.strip():
                return joined.strip()
    captions = data.get("captions")
    if isinstance(captions, list):
        joined = ", ".join(str(x).strip() for x in captions if str(x).strip())
        if joined.strip():
            return joined.strip()
    return ""


# --------------------------------------------------------------------------- #
# 对外主函数
# --------------------------------------------------------------------------- #
def _clean_folder_caption(name: str) -> str:
    # kohya: "1_girl, smile" / "10_hatsune miku"
    return re.sub(r"^\d+_", "", name).replace("_", " ").strip()


def build_cross_index(dirs) -> dict[str, str]:
    """把一批目录里的侧车文件按 stem 建索引，供「跨文件夹同名匹配」用。

    - key 是小写文件名（不含扩展名），value 是提示词文件的绝对路径
    - 文本侧车优先于 .json；同名多处时取路径排序后的第一个（结果稳定）
    - 结果缓存 5 秒，扫描 / 悬停预览不会反复 scandir
    """
    keys: list[str] = []
    for item in dirs or ():
        text = str(item or "").strip()
        if not text:
            continue
        try:
            key = str(Path(text))
        except (TypeError, ValueError):
            continue
        if key not in keys:
            keys.append(key)
    if not keys:
        return {}
    cache_key = tuple(sorted(keys))
    now = time.time()
    with _CROSS_CACHE_LOCK:
        hit = _CROSS_CACHE.get(cache_key)
        if hit and now - hit[0] < _CROSS_CACHE_TTL:
            return hit[1]

    found: dict[str, str] = {}
    json_found: dict[str, str] = {}
    for directory_text in cache_key:
        try:
            with os.scandir(Path(directory_text)) as it:
                entries = sorted(it, key=lambda e: e.name.lower())
        except OSError:
            continue
        for entry in entries:
            try:
                if not entry.is_file() or entry.name.startswith("."):
                    continue
            except OSError:
                continue
            stem, suffix = os.path.splitext(entry.name)
            suffix = suffix.lower()
            key = stem.lower()
            if suffix in TEXT_SIDECAR_EXTENSIONS:
                found.setdefault(key, entry.path)
            elif suffix == ".json":
                json_found.setdefault(key, entry.path)
    for key, path in json_found.items():
        found.setdefault(key, path)

    with _CROSS_CACHE_LOCK:
        _CROSS_CACHE[cache_key] = (now, found)
        if len(_CROSS_CACHE) > 64:
            _CROSS_CACHE.clear()
            _CROSS_CACHE[cache_key] = (now, found)
    return found


def find_sidecar_prompt(
    image_path: str | os.PathLike, cross: dict[str, str] | None = None
) -> str:
    """只在「同名/同目录的提示词文件」里找，完全不看图片内嵌元数据。

    cross：`build_cross_index()` 建出来的跨文件夹索引；同目录找不到时，
    会去别的已加入目录里找同名提示词（图片在 A 文件夹、txt 在 B 文件夹也能配上）。
    """
    try:
        path = Path(image_path)
    except (TypeError, ValueError):
        return ""
    if not path.is_file():
        return ""

    directory = path.parent
    stem = path.stem

    # 1) 同名文本侧车
    for ext in TEXT_SIDECAR_EXTENSIONS:
        candidate = _find_case_insensitive(directory, stem + ext)
        if candidate:
            text = _read_text(candidate)
            if text:
                return text

    # 2) 同名 JSON 侧车
    candidate = _find_case_insensitive(directory, stem + ".json")
    if candidate:
        text = _prompt_from_json_file(candidate)
        if text:
            return text

    # 2.5) 跨文件夹同名：图片在 A 目录、提示词在 B 目录
    if cross:
        hit = cross.get(stem.lower())
        if hit:
            text = read_prompt_file(hit)
            if text:
                return text

    # 3) 目录级提示词（kohya 风格）
    folder_caption = _clean_folder_caption(directory.name)
    if folder_caption:
        for name in (directory.name + ".txt", folder_caption + ".txt"):
            candidate = _find_case_insensitive(directory, name)
            if candidate:
                text = _read_text(candidate)
                if text:
                    return text

    return ""


def read_prompt_file(path: str | os.PathLike) -> str:
    """直接读一个提示词文件（.txt/.caption/.prompt/.tags/.md/.json）。

    孤儿提示词（没有同名图片）走这条路，行为与侧车匹配完全一致。
    """
    try:
        p = Path(path)
    except (TypeError, ValueError):
        return ""
    if not p.is_file():
        return ""
    suffix = p.suffix.lower()
    if suffix == ".json":
        return _prompt_from_json_file(p)
    if suffix in TEXT_SIDECAR_EXTENSIONS:
        return _read_text(p)
    return ""


def has_prompt_file(
    image_path: str | os.PathLike, cross: dict[str, str] | None = None
) -> bool:
    """廉价判断：只检查侧车文件是否存在（不解码图片）。"""

    try:
        path = Path(image_path)
    except (TypeError, ValueError):
        return False
    directory = path.parent
    stem = path.stem
    for ext in TEXT_SIDECAR_EXTENSIONS + (".json",):
        if _find_case_insensitive(directory, stem + ext):
            return True
    # 跨文件夹同名（图片在一个目录、txt 在另一个已加入目录）
    if cross and cross.get(stem.lower()):
        return True

    folder_caption = _clean_folder_caption(directory.name)
    if folder_caption:
        for name in (directory.name + ".txt", folder_caption + ".txt"):
            if _find_case_insensitive(directory, name):
                return True
    return False


def invalidate_sidecar_cache(directory: str | os.PathLike) -> None:
    """刚写入/删除侧车文件后调用，避免 5 秒目录缓存读到旧结果。"""
    try:
        key = str(Path(directory))
    except (TypeError, ValueError):
        return
    with _DIR_CACHE_LOCK:
        _DIR_CACHE.pop(key, None)

