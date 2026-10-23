# -*- coding: utf-8 -*-
"""图片格式转换 / 压缩。

编码与压缩算法参考 ComfyUI-ImageToolkit-CN（core.py / node_saver.py）：
- 质量模式：JPG 走 quality，WEBP 走 quality+method，PNG 质量换算成 zlib 压缩级别
- 体积模式：二分查找能压进目标体积的最高画质，必要时逐级降分辨率
- 落盘：沿用「图像批量保存」的做法 —— 决定扩展名 → 编码 → 写文件 → 顺带处理同名提示词

和工具箱的区别：这里直接读写磁盘上的原图，不经过张量/显存，几百张也不会吃内存；
并且作为后台任务跑，前端可以看进度、随时取消。
"""

from __future__ import annotations

import io
import os
import threading
import time
import uuid
from pathlib import Path

from .gallery import is_path_allowed
from .prompt_reader import IMAGE_EXTENSIONS, TEXT_SIDECAR_EXTENSIONS

MAX_JOB_ITEMS = 5000

# 显示名 -> (Pillow 格式名, 扩展名)；None = 保持原格式（只压缩）
FORMAT_INFO = {
    "保持原格式": None,
    "JPG": ("JPEG", "jpg"),
    "WEBP": ("WEBP", "webp"),
    "PNG": ("PNG", "png"),
    "BMP": ("BMP", "bmp"),
    "TIFF": ("TIFF", "tif"),
    "GIF": ("GIF", "gif"),
}
FORMAT_NAMES = list(FORMAT_INFO.keys())

COMPRESS_MODES = ["按质量", "按体积"]
SCALE_MODES = ["不缩放", "按长边", "按百分比"]
ALIGN_CHOICES = ["不对齐", "2", "8", "16", "32", "64"]
OUTPUT_MODES = ["同目录 · 新文件", "指定文件夹", "覆盖原文件"]

# Pillow 格式名 -> 原始扩展名（保持原格式时用）
_PIL_TO_EXT = {
    "JPEG": "jpg",
    "PNG": "png",
    "WEBP": "webp",
    "BMP": "bmp",
    "TIFF": "tif",
    "GIF": "gif",
}

_jobs: dict[str, dict] = {}
_current: str | None = None
_job_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# 编码（与工具箱保持一致的参数）
# --------------------------------------------------------------------------- #
def _prepare_for_format(pil, pil_format: str):
    from PIL import Image

    if pil_format in ("JPEG", "BMP"):
        if pil.mode in ("RGBA", "LA") or (pil.mode == "P" and "transparency" in pil.info):
            rgba = pil.convert("RGBA")
            bg = Image.new("RGB", rgba.size, (255, 255, 255))
            bg.paste(rgba, mask=rgba.split()[-1])
            return bg
        if pil.mode != "RGB":
            return pil.convert("RGB")
        return pil
    if pil_format == "GIF":
        return pil.convert("P", palette=Image.Palette.ADAPTIVE, colors=256)
    if pil.mode not in ("RGB", "RGBA"):
        return pil.convert("RGB")
    return pil


def encode_image(pil, pil_format: str, quality: int) -> bytes:
    """按格式与质量编码。PNG 用质量反推压缩级别，TIFF 用 LZW 无损压缩。"""
    q = int(max(0, min(100, int(quality))))
    img = _prepare_for_format(pil, pil_format)
    buf = io.BytesIO()
    kw = {}
    if pil_format == "JPEG":
        kw = {"quality": max(1, q), "optimize": True, "progressive": True}
    elif pil_format == "WEBP":
        kw = {"quality": max(1, q), "method": 4}
    elif pil_format == "PNG":
        kw = {"optimize": True, "compress_level": int(round((100 - q) / 100.0 * 9))}
    elif pil_format == "TIFF":
        kw = {"compression": "tiff_lzw"}
    img.save(buf, format=pil_format, **kw)
    return buf.getvalue()


def encode_to_target_size(pil, pil_format: str, quality: int, target_bytes: int,
                          allow_shrink: bool) -> bytes:
    """按体积压缩：二分查找能压进目标体积的最高画质。"""
    from PIL import Image

    qmax = int(max(1, min(100, int(quality))))
    best = encode_image(pil, pil_format, qmax)
    if len(best) <= target_bytes:
        return best

    lo, hi = 1, qmax
    while lo <= hi:
        mid = (lo + hi) // 2
        data = encode_image(pil, pil_format, mid)
        if len(data) <= target_bytes:
            best = data
            lo = mid + 1
        else:
            hi = mid - 1

    if allow_shrink and len(best) > target_bytes:
        cur = pil
        for _ in range(6):
            w, h = cur.size
            nw, nh = max(8, int(w * 0.85)), max(8, int(h * 0.85))
            if (nw, nh) == (w, h):
                break
            cur = cur.resize((nw, nh), Image.Resampling.LANCZOS)
            data = encode_image(cur, pil_format, 10)
            if len(data) < len(best):
                best = data
            if len(best) <= target_bytes:
                break
    return best


def calc_target_size(size, 缩放方式, 长边像素, 缩放百分比, 尺寸对齐):
    ow, oh = int(size[0]), int(size[1])
    tw, th = ow, oh
    if 缩放方式 == "按长边":
        s = max(1, int(长边像素)) / max(ow, oh)
        tw, th = int(round(ow * s)), int(round(oh * s))
    elif 缩放方式 == "按百分比":
        s = max(1, int(缩放百分比)) / 100.0
        tw, th = int(round(ow * s)), int(round(oh * s))
    tw, th = max(1, tw), max(1, th)
    if 尺寸对齐 and str(尺寸对齐) != "不对齐":
        try:
            n = int(尺寸对齐)
        except (TypeError, ValueError):
            n = 0
        if n > 1:
            tw = max(n, (tw // n) * n)
            th = max(n, (th // n) * n)
    return tw, th


def human_size(num: int) -> str:
    num = int(num or 0)
    if num >= 1024 * 1024:
        return f"{num / 1024 / 1024:.2f} MB"
    if num >= 1024:
        return f"{num / 1024:.1f} KB"
    return f"{num} B"


# --------------------------------------------------------------------------- #
# 输出路径
# --------------------------------------------------------------------------- #
def _unique_path(path: Path, taken: set[str] | None = None) -> Path:
    """同目录输出时避免撞名：a_webp.webp → a_webp-1.webp"""
    taken = taken or set()
    key = str(path).lower()
    if not path.exists() and key not in taken:
        return path
    i = 1
    while True:
        candidate = path.with_name(f"{path.stem}-{i}{path.suffix}")
        ckey = str(candidate).lower()
        if not candidate.exists() and ckey not in taken:
            return candidate
        i += 1


def _copy_sidecar(src: Path, dst: Path) -> str:
    """把同名提示词文件复制成新文件名（.txt/.caption/...）。返回新文件名。"""
    for ext in TEXT_SIDECAR_EXTENSIONS:
        side = src.with_suffix(ext)
        if not side.is_file():
            continue
        target = dst.with_suffix(ext)
        try:
            target.write_bytes(side.read_bytes())
            return target.name
        except OSError:
            return ""
    return ""


# --------------------------------------------------------------------------- #
# 任务
# --------------------------------------------------------------------------- #
def _normalize_options(options: dict) -> dict:
    options = options if isinstance(options, dict) else {}

    fmt = str(options.get("format") or "保持原格式")
    if fmt not in FORMAT_INFO:
        fmt = "保持原格式"

    mode = str(options.get("mode") or "按质量")
    if mode not in COMPRESS_MODES:
        mode = "按质量"

    scale = str(options.get("scale") or "不缩放")
    if scale not in SCALE_MODES:
        scale = "不缩放"

    align = str(options.get("align") or "不对齐")
    if align not in ALIGN_CHOICES:
        align = "不对齐"

    output = str(options.get("output") or "同目录 · 新文件")
    if output not in OUTPUT_MODES:
        output = "同目录 · 新文件"

    def num(key, default, low, high):
        try:
            value = int(float(options.get(key, default)))
        except (TypeError, ValueError):
            value = default
        return max(low, min(high, value))

    return {
        "format": fmt,
        "mode": mode,
        "quality": num("quality", 88, 1, 100),
        "target_kb": num("target_kb", 300, 1, 20480),
        "allow_shrink": bool(options.get("allow_shrink", True)),
        "scale": scale,
        "long_side": num("long_side", 1024, 16, 32768),
        "percent": num("percent", 100, 1, 400),
        "align": align,
        "output": output,
        "out_dir": str(options.get("out_dir") or "").strip(),
        "with_prompt": bool(options.get("with_prompt", True)),
        "overwrite": output == "覆盖原文件",
    }


def start_job(paths: list[str], options: dict) -> dict:
    global _current
    cleaned = [str(p).strip() for p in (paths or []) if str(p or "").strip()]
    if not cleaned:
        raise ValueError("没有要转换的图片")
    if len(cleaned) > MAX_JOB_ITEMS:
        raise ValueError(f"一次最多处理 {MAX_JOB_ITEMS} 张")

    opts = _normalize_options(options)
    if opts["output"] == "指定文件夹":
        if not opts["out_dir"]:
            raise ValueError("请先填写输出文件夹")
        out_dir = Path(opts["out_dir"]).expanduser()
        if not out_dir.is_absolute():
            raise ValueError("输出文件夹要填绝对路径")
        try:
            out_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise ValueError(f"输出文件夹建不出来：{exc}") from exc
        opts["out_dir"] = str(out_dir)

    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id,
        "state": "running",
        "total": len(cleaned),
        "done": 0,
        "failed": 0,
        "bytes_before": 0,
        "bytes_after": 0,
        "results": [],
        "current": "",
        "error": "",
        "cancel": False,
        "started": time.time(),
        "elapsed": 0.0,
        "options": opts,
    }
    with _job_lock:
        running = _jobs.get(_current or "")
        if running is not None and running["state"] == "running":
            raise RuntimeError("已经有一个转换任务在跑，等它结束或先取消")
        _jobs[job_id] = job
        _current = job_id
        for old in sorted(_jobs.values(), key=lambda j: j["started"])[:-3]:
            if old["id"] != job_id:
                _jobs.pop(old["id"], None)

    thread = threading.Thread(
        target=_run_job, args=(job, cleaned, opts), name=f"lg-convert-{job_id}", daemon=True
    )
    thread.start()
    return {"job": job_id, "total": len(cleaned), "options": opts}


def _run_job(job: dict, paths: list[str], opts: dict) -> None:
    from PIL import Image, ImageOps

    taken: set[str] = set()
    try:
        for raw in paths:
            if job["cancel"]:
                job["state"] = "cancelled"
                break
            src = Path(raw)
            job["current"] = src.name
            record = {
                "path": str(src),
                "name": src.name,
                "out": "",
                "out_name": "",
                "ok": False,
                "before": 0,
                "after": 0,
                "width": 0,
                "height": 0,
                "error": "",
            }
            try:
                if not src.is_file():
                    raise FileNotFoundError("文件不存在")
                if src.suffix.lower() not in IMAGE_EXTENSIONS:
                    raise ValueError("不是图片文件")
                if not is_path_allowed(src):
                    raise ValueError("路径不在 allowed_roots 允许范围内")

                before = src.stat().st_size
                record["before"] = before

                with Image.open(src) as opened:
                    opened.load()
                    pil = opened.convert("RGBA") if opened.mode in ("RGBA", "LA", "P") else opened.convert("RGB")
                    # 保持原格式时沿用原图的 Pillow 格式名
                    info = FORMAT_INFO[opts["format"]]
                    if info is None:
                        pil_format = opened.format if opened.format in _PIL_TO_EXT else "PNG"
                    else:
                        pil_format, _ext = info
                    ext = _PIL_TO_EXT.get(pil_format, "png")

                    tw, th = calc_target_size(
                        pil.size, opts["scale"], opts["long_side"], opts["percent"], opts["align"]
                    )
                    if (tw, th) != pil.size:
                        pil = pil.resize((tw, th), Image.Resampling.LANCZOS)

                    if opts["mode"] == "按体积":
                        data = encode_to_target_size(
                            pil, pil_format, opts["quality"], opts["target_kb"] * 1024,
                            opts["allow_shrink"],
                        )
                    else:
                        data = encode_image(pil, pil_format, opts["quality"])
                    record["width"], record["height"] = pil.size

                # 输出路径
                if opts["overwrite"]:
                    # 覆盖：写回原路径；扩展名真的变了（如 jpg→webp）才换名并删旧文件
                    same = {f".{ext}"}
                    if ext == "jpg":
                        same.add(".jpeg")
                    dst = src if src.suffix.lower() in same else src.with_suffix(f".{ext}")
                elif opts["output"] == "指定文件夹":
                    dst = Path(opts["out_dir"]) / f"{src.stem}.{ext}"
                    dst = _unique_path(dst, taken)
                else:
                    # 同目录新文件：换格式时用新扩展名（a.png → a.webp），
                    # 只压缩同格式时加 _c 后缀（a.jpg → a_c.jpg），一眼能看出是新文件
                    src_ext = src.suffix.lower().lstrip(".")
                    same = src_ext == ext or (src_ext == "jpeg" and ext == "jpg")
                    stem = f"{src.stem}_c" if same else src.stem
                    dst = _unique_path(src.with_name(f"{stem}.{ext}"), taken)
                taken.add(str(dst).lower())

                dst.parent.mkdir(parents=True, exist_ok=True)
                tmp = dst.with_name(dst.name + ".lgtmp")
                tmp.write_bytes(data)
                os.replace(tmp, dst)

                # 覆盖模式下若扩展名变了，把旧文件删掉（等同"转换"）
                if opts["overwrite"] and dst != src and src.is_file():
                    try:
                        src.unlink()
                    except OSError:
                        pass

                record["ok"] = True
                record["out"] = str(dst)
                record["out_name"] = dst.name
                record["after"] = len(data)
                if opts["with_prompt"] and not opts["overwrite"]:
                    record["prompt"] = _copy_sidecar(src, dst)

                job["bytes_before"] += before
                job["bytes_after"] += len(data)
            except Exception as exc:  # 单张失败不影响整批
                record["error"] = str(exc) or exc.__class__.__name__
                job["failed"] += 1
            finally:
                job["done"] += 1
                job["results"].append(record)
                job["elapsed"] = time.time() - job["started"]

        if job["state"] != "cancelled":
            job["state"] = "done"
        job["current"] = ""
    except Exception as exc:  # 任务级异常
        job["state"] = "error"
        job["error"] = str(exc)
    finally:
        job["elapsed"] = time.time() - job["started"]


def job_status(job_id: str, since: int = 0) -> dict | None:
    with _job_lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        since = max(0, int(since or 0))
        results = job["results"][since:]
        return {
            "ok": True,
            "job": job_id,
            "state": job["state"],
            "total": job["total"],
            "done": job["done"],
            "failed": job["failed"],
            "current": job["current"],
            "error": job["error"],
            "elapsed": round(job["elapsed"], 2),
            "bytes_before": job["bytes_before"],
            "bytes_after": job["bytes_after"],
            "next": since + len(results),
            "results": results,
            "options": job["options"],
        }


def cancel_job(job_id: str) -> bool:
    with _job_lock:
        job = _jobs.get(job_id)
        if job is None or job["state"] != "running":
            return False
        job["cancel"] = True
        return True


def info() -> dict:
    """前端打开面板时读一次：可选项 + 上一次用过的参数。"""
    return {
        "ok": True,
        "formats": FORMAT_NAMES,
        "compress_modes": COMPRESS_MODES,
        "scale_modes": SCALE_MODES,
        "align_choices": ALIGN_CHOICES,
        "output_modes": OUTPUT_MODES,
        "max_items": MAX_JOB_ITEMS,
        "running": bool(_current and _jobs.get(_current, {}).get("state") == "running"),
    }
