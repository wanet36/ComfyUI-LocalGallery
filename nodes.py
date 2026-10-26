"""本地图库浏览器节点。

从原 DanbooruGalleryNode 抽出：保留「隐藏 selection_data + IMAGE/STRING 列表输出」的接口形态，
但数据源从远端站点换成本地文件夹，并按同名规则自动匹配提示词。
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps

from .gallery import describe_paths, is_path_allowed, load_config, scan_folder
from .prompt_reader import find_sidecar_prompt, is_image_file

logger = logging.getLogger(__name__)

PLACEHOLDER = torch.zeros((1, 64, 64, 3), dtype=torch.float32)


def read_prompt(path: str) -> str:
    """读取同名提示词文件（.txt/.caption/.prompt/.tags/.md/.json），不碰图片元数据。"""
    try:
        return find_sidecar_prompt(path) or ""
    except Exception:
        return ""


def _parse_json(raw, fallback):
    if isinstance(raw, (dict, list)):
        return raw
    if not raw:
        return fallback
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return fallback
    return data if isinstance(data, (dict, list)) else fallback


def parse_selection(selection_data) -> list[dict]:
    """selection_data: {"items": [{"path": "...", "prompt": "..."}], "root": "..."}"""
    data = _parse_json(selection_data, {})
    items = data.get("items") if isinstance(data, dict) else data
    if not isinstance(items, list):
        return []
    result = []
    for item in items:
        if isinstance(item, str):
            result.append({"path": item, "prompt": ""})
        elif isinstance(item, dict) and item.get("path"):
            result.append({"path": str(item["path"]), "prompt": str(item.get("prompt") or "")})
    return result


def parse_prompt_selection(selection_data) -> list[dict]:
    """提示词页的选中项：{"prompts": [{"path": "...", "prompt": "..."}]}

    path 是图片路径（提示词按同名规则从 .txt 等文件读），但图片本身不参与输出。
    """
    data = _parse_json(selection_data, {})
    if not isinstance(data, dict):
        return []
    rows = data.get("prompts")
    if not isinstance(rows, list):
        return []
    result = []
    for row in rows:
        if isinstance(row, dict) and row.get("path"):
            result.append({"path": str(row["path"]), "prompt": str(row.get("prompt") or "")})
        elif isinstance(row, str) and row:
            result.append({"path": row, "prompt": ""})
    return result


def load_image_tensor(path: str) -> torch.Tensor | None:
    """读图 -> [1,H,W,3] float32 RGB。失败返回 None。"""
    try:
        if not Path(path).is_file() or not is_image_file(path):
            return None
        max_side = int(load_config().get("max_image_side", 8192))
        with Image.open(path) as img:
            img = ImageOps.exif_transpose(img)
            if getattr(img, "is_animated", False):
                img.seek(0)
            if max(img.size) > max_side:
                logger.warning(f"[LocalGallery] 图片超过 {max_side}px，已跳过：{path}")
                return None
            if img.mode in ("RGBA", "LA", "P"):
                img = img.convert("RGBA")
                background = Image.new("RGB", img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1])
                img = background
            else:
                img = img.convert("RGB")
            array = np.asarray(img, dtype=np.float32) / 255.0
        return torch.from_numpy(array)[None, ...]
    except Exception as exc:
        logger.error(f"[LocalGallery] 图片读取失败 {path}: {exc}")
        return None


class LocalGalleryBrowser:
    """本地图库浏览器：选图 + 同名提示词，输出列表。"""

    CATEGORY = "local gallery"
    FUNCTION = "run"
    OUTPUT_NODE = True

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("images", "prompts", "filenames")
    OUTPUT_IS_LIST = (True, True, True)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "folder_path": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": "图片文件夹路径 / 单张图片路径。支持多行，每行一个路径（换行、分号、竖线都能分隔）",
                    },
                ),
            },
            "hidden": {
                "selection_data": ("STRING", {"default": "{}"}),
                "extra_paths": ("STRING", {"default": "[]"}),
            },
        }

    @classmethod
    def IS_CHANGED(cls, folder_path="", selection_data="{}", extra_paths="[]", **kwargs):
        items = parse_selection(selection_data)
        prompt_items = parse_prompt_selection(selection_data)
        signature = [folder_path or "", extra_paths or ""]
        # 提示词页的选中项也算输入变化（只选了提示词、没选图时也能触发重跑）
        for item in prompt_items:
            signature.append("prompt:" + item.get("path", ""))
        for item in items:
            path = item.get("path", "")
            signature.append(path)
            # 提示词文件被改动时也要重跑
            try:
                p = Path(path)
                if p.is_file():
                    signature.append(str(p.stat().st_mtime_ns))
                for ext in (".txt", ".caption", ".prompt"):
                    side = p.with_suffix(ext)
                    if side.is_file():
                        signature.append(str(side.stat().st_mtime_ns))
            except OSError:
                continue
        return "|".join(signature)

    def run(self, folder_path="", selection_data="{}", extra_paths="[]", **kwargs):
        items = parse_selection(selection_data)
        prompt_items = parse_prompt_selection(selection_data)
        # 提示词页选了东西就不走自动兜底，否则「只选提示词」会被兜底的图顶掉
        if not items and not prompt_items:
            items = self._fallback_items(folder_path, extra_paths)

        if not items and not prompt_items:
            logger.info("[LocalGallery] 未选择任何图片，输出占位图")
            return ([PLACEHOLDER], [""], [""])

        images, prompts, filenames = [], [], []
        for item in items:
            path = item.get("path", "")
            if not path:
                continue
            if not is_path_allowed(Path(path)):
                logger.warning(f"[LocalGallery] 路径被 allowed_roots 拦截：{path}")
                continue

            prompt = ""
            try:
                prompt = read_prompt(path)
            except Exception as exc:
                logger.warning(f"[LocalGallery] 提示词读取失败 {path}: {exc}")
            if not prompt:
                # 面板选图时缓存的提示词（同样来自同名文件）
                prompt = item.get("prompt") or ""

            tensor = load_image_tensor(path)
            if tensor is None:
                logger.warning(f"[LocalGallery] 跳过无法读取的图片：{path}")
                tensor = PLACEHOLDER

            images.append(tensor)
            prompts.append(prompt)
            filenames.append(Path(path).name)

        # 提示词页的选中项：只输出提示词，不输出图片
        if prompt_items:
            picked_prompts, picked_names = [], []
            for item in prompt_items:
                path = item.get("path", "")
                if not path:
                    continue
                if not is_path_allowed(Path(path)):
                    logger.warning(f"[LocalGallery] 路径被 allowed_roots 拦截：{path}")
                    continue
                text = ""
                try:
                    text = read_prompt(path)
                except Exception as exc:
                    logger.warning(f"[LocalGallery] 提示词读取失败 {path}: {exc}")
                if not text:
                    text = item.get("prompt") or ""
                picked_prompts.append(text)
                picked_names.append(Path(path).name)
            if picked_prompts:
                prompts = picked_prompts
                # 没选图时 filenames 跟着提示词走，方便下游对照是哪张图
                if not images:
                    filenames = picked_names

        if not images and not prompts:
            return ([PLACEHOLDER], [""], [""])
        if not images:
            logger.info("[LocalGallery] 只选中了提示词，images 输出为空")
        return (images, prompts, filenames)

    @staticmethod
    def _fallback_items(folder_path, extra_paths) -> list[dict]:
        """没选任何图时：若配置了「自动全选」，则按路径顺序取前 N 张。"""
        if not str(folder_path or "").strip():
            return []
        config = load_config()
        auto = config.get("auto_select_when_empty") or {}
        if not auto.get("enabled"):
            return []
        try:
            limit = int(auto.get("limit", 4))
        except (TypeError, ValueError):
            limit = 4
        result = scan_folder(folder_path, recursive=bool(auto.get("recursive")))
        picked = [{"path": i["path"], "prompt": ""} for i in result.get("items", [])[:limit]]
        picked.extend({"path": i["path"], "prompt": ""} for i in describe_paths(_parse_json(extra_paths, [])))
        return picked


NODE_CLASS_MAPPINGS = {"LocalGalleryBrowser": LocalGalleryBrowser}
NODE_DISPLAY_NAME_MAPPINGS = {"LocalGalleryBrowser": "本地图库浏览器 (Local Gallery)"}
