"""收藏图片的持久化（节点目录下的 favorites.json）。

独立成模块，避免和 gallery.py 的扫描/缩略图逻辑混在一起。
写入用「临时文件 + os.replace」，防止掉电写坏文件。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path

from .prompt_reader import TEXT_SIDECAR_EXTENSIONS

NODE_DIR = Path(__file__).resolve().parent
FAVORITES_PATH = NODE_DIR / "favorites.json"
FOLDER_NAME_MAX = 40

_LOCK = threading.Lock()
_cache: dict | None = None


def _load() -> dict:
    """读缓存或磁盘。返回 {"version": 2, "folders": [...], "items": {path: {...}}}。

    v1 的旧文件没有 folders，读进来按空列表处理（下次写入自动升级）。
    """
    global _cache
    if _cache is not None:
        return _cache

    data: dict = {"version": 2, "folders": [], "items": {}}
    try:
        if FAVORITES_PATH.is_file():
            raw = json.loads(FAVORITES_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                folders = raw.get("folders")
                if isinstance(folders, list):
                    seen_ids: set[str] = set()
                    for folder in folders:
                        if not isinstance(folder, dict):
                            continue
                        fid = str(folder.get("id") or "").strip()
                        name = str(folder.get("name") or "").strip()
                        if not fid or not name or fid in seen_ids:
                            continue
                        seen_ids.add(fid)
                        data["folders"].append(
                            {
                                "id": fid,
                                "name": name[:FOLDER_NAME_MAX],
                                "created": float(folder.get("created") or 0),
                            }
                        )
                items = raw.get("items")
                if isinstance(items, dict):
                    cleaned = {}
                    for path, meta in items.items():
                        if not isinstance(path, str) or not path.strip():
                            continue
                        entry = dict(meta) if isinstance(meta, dict) else {}
                        ids = entry.get("folders")
                        entry["folders"] = (
                            [str(x) for x in ids if str(x or "").strip()]
                            if isinstance(ids, list)
                            else []
                        )
                        cleaned[path] = entry
                    data["items"] = cleaned
    except Exception:
        # 文件损坏时不阻塞使用，按空列表处理（下次写入会覆盖）
        data = {"version": 2, "folders": [], "items": {}}

    _cache = data
    return data


def _save(data: dict) -> None:
    tmp = FAVORITES_PATH.with_name(FAVORITES_PATH.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, FAVORITES_PATH)


def _norm(path: str) -> str:
    """归一化用于比较：统一分隔符 / 去掉冗余 .. / Windows 下转小写。

    D://a//b.png、D:/a/b.png、d://A//B.PNG 会被认为是同一张。
    """
    try:
        return os.path.normcase(os.path.normpath(path))
    except (TypeError, ValueError):
        return str(path).lower()


def _storage_key(path: str) -> str:
    """存盘用的展示形式：保留大小写，但统一分隔符。"""
    try:
        return os.path.normpath(path)
    except (TypeError, ValueError):
        return path


def _find_key(items: dict, path: str) -> str | None:
    target = _norm(path)
    for key in items:
        if _norm(key) == target:
            return key
    return None


def list_favorites() -> list[dict]:
    """按收藏时间倒序返回。"""
    with _LOCK:
        items = _load()["items"]
        rows = []
        for path, meta in items.items():
            row = {"path": path}
            row.update(meta if isinstance(meta, dict) else {})
            rows.append(row)
    rows.sort(key=lambda r: r.get("added") or 0, reverse=True)
    return rows


def toggle_favorites(paths: list[str], action: str = "toggle", prompts: dict | None = None) -> dict:
    """新增 / 移除 / 切换收藏。

    action: add | remove | toggle
    返回 {"added": [...], "removed": [...], "items": [...]}
    """
    action = action if action in ("add", "remove", "toggle") else "toggle"
    prompts = prompts or {}
    added: list[str] = []
    removed: list[str] = []

    with _LOCK:
        data = _load()
        items = data["items"]
        now = time.time()

        for raw in paths:
            path = str(raw or "").strip()
            if not path:
                continue
            key = _find_key(items, path)

            if action == "add":
                should_add = key is None
            elif action == "remove":
                should_add = False
            else:
                should_add = key is None

            if should_add:
                entry = {"added": now, "folders": []}
                prompt = prompts.get(path)
                if not prompt:
                    # 前端可能用另一种分隔符传 prompt 表，按归一化再找一次
                    for key, value in prompts.items():
                        if _norm(key) == _norm(path):
                            prompt = value
                            break
                if isinstance(prompt, str) and prompt.strip():
                    entry["prompt"] = prompt.strip()
                items[_storage_key(path)] = entry
                added.append(path)
            elif key is not None:
                del items[key]
                removed.append(key)

        if added or removed:
            data["version"] = 2
            _save(data)

        snapshot = []
        for path, meta in items.items():
            row = {"path": path}
            row.update(meta if isinstance(meta, dict) else {})
            snapshot.append(row)

    snapshot.sort(key=lambda r: r.get("added") or 0, reverse=True)
    return {"added": added, "removed": removed, "items": snapshot}


def favorite_paths() -> list[str]:
    return [row["path"] for row in list_favorites()]


def export_favorites(dest: str, overwrite: bool = False, folder_id: str = "all") -> dict:
    """把收藏的图片 + 同名提示词复制到 dest（不动原文件）。

    - `folder_id`：`all` 全部收藏 / `none` 未分类 / 其它值 = 只导出该收藏夹里的
    - 同名文件默认跳过，`overwrite=True` 才覆盖
    - 图片没有侧车提示词、但收藏时记过 prompt 的，补写一个 `<stem>.txt`
    """
    text = str(dest or "").strip()
    empty = {"ok": False, "dest": "", "copied": [], "skipped": [], "failed": [], "total": 0}
    if not text:
        return {**empty, "error": "目标文件夹为空"}

    target = Path(os.path.expandvars(os.path.expanduser(text)))
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        return {**empty, "error": f"无法创建目标目录：{exc}", "dest": str(target)}
    if not target.is_dir():
        return {**empty, "error": "目标路径不是文件夹", "dest": str(target)}

    rows = list_favorites()
    scope = str(folder_id or "all").strip() or "all"
    if scope == "none":
        rows = [r for r in rows if not (r.get("folders") or [])]
    elif scope != "all":
        rows = [r for r in rows if scope in (r.get("folders") or [])]
    copied: list[dict] = []
    skipped: list[dict] = []
    failed: list[dict] = []

    for row in rows:
        raw = str(row.get("path") or "").strip()
        if not raw:
            continue
        src = Path(os.path.expandvars(os.path.expanduser(raw)))
        if not src.is_file():
            failed.append({"path": str(src), "error": "文件不存在"})
            continue

        dst = target / src.name
        if dst.exists() and not overwrite:
            skipped.append({"path": str(src), "reason": "同名文件已存在"})
            continue
        try:
            shutil.copy2(src, dst)
        except (OSError, shutil.Error) as exc:
            failed.append({"path": str(src), "error": f"复制失败：{exc}"})
            continue

        entry = {"path": str(src), "to": str(dst), "prompts": [], "warnings": []}
        for ext in TEXT_SIDECAR_EXTENSIONS:
            side = src.with_suffix(ext)
            if not side.is_file():
                continue
            side_dst = target / side.name
            if side_dst.exists() and not overwrite:
                continue
            try:
                shutil.copy2(side, side_dst)
                entry["prompts"].append(side_dst.name)
            except (OSError, shutil.Error) as exc:
                entry["warnings"].append(f"{side.name} 复制失败：{exc}")

        # 没有侧车、但收藏时存过提示词 → 补一个 txt，训练集直接能用
        if not entry["prompts"]:
            stored = str(row.get("prompt") or "").strip()
            if stored:
                txt = target / f"{src.stem}.txt"
                if overwrite or not txt.exists():
                    try:
                        txt.write_text(stored + "\n", encoding="utf-8")
                        entry["prompts"].append(txt.name)
                    except OSError as exc:
                        entry["warnings"].append(f"{txt.name} 写入失败：{exc}")

        copied.append(entry)

    return {
        "ok": True,
        "dest": str(target),
        "total": len(rows),
        "copied": copied,
        "skipped": skipped,
        "failed": failed,
    }


# --------------------------------------------------------------------------- #
# 收藏夹（分类）
# --------------------------------------------------------------------------- #
def _clean_folder_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", str(raw or "")).strip()
    return name[:FOLDER_NAME_MAX]


def _snapshot(data: dict) -> list[dict]:
    rows = []
    for path, meta in data["items"].items():
        row = {"path": path}
        row.update(meta if isinstance(meta, dict) else {})
        rows.append(row)
    rows.sort(key=lambda r: r.get("added") or 0, reverse=True)
    return rows


def _folder_state(data: dict) -> dict:
    counts: dict[str, int] = {}
    unclassified = 0
    for meta in data["items"].values():
        ids = meta.get("folders") or []
        if not ids:
            unclassified += 1
        for fid in ids:
            counts[fid] = counts.get(fid, 0) + 1
    folders = [
        {**folder, "count": counts.get(folder["id"], 0)} for folder in data["folders"]
    ]
    folders.sort(key=lambda f: (f.get("name") or "").lower())
    return {
        "folders": folders,
        "unclassified": unclassified,
        "total": len(data["items"]),
    }


def list_folders() -> dict:
    with _LOCK:
        data = _load()
        return _folder_state(data)


def create_folder(name: str) -> dict:
    clean = _clean_folder_name(name)
    if not clean:
        return {"ok": False, "error": "收藏夹名字不能为空"}
    with _LOCK:
        data = _load()
        lowered = clean.lower()
        for folder in data["folders"]:
            if folder["name"].strip().lower() == lowered:
                return {"ok": False, "error": f"已经有同名收藏夹：{folder['name']}"}
        folder = {
            "id": f"f{uuid.uuid4().hex[:10]}",
            "name": clean,
            "created": time.time(),
        }
        data["folders"].append(folder)
        data["version"] = 2
        _save(data)
        state = _folder_state(data)
    return {"ok": True, "folder": {**folder, "count": 0}, **state}


def delete_folder(folder_id: str) -> dict:
    fid = str(folder_id or "").strip()
    if not fid:
        return {"ok": False, "error": "缺少收藏夹 id"}
    with _LOCK:
        data = _load()
        before = len(data["folders"])
        data["folders"] = [f for f in data["folders"] if f["id"] != fid]
        if len(data["folders"]) == before:
            return {"ok": False, "error": "收藏夹不存在"}
        for meta in data["items"].values():
            ids = meta.get("folders")
            if isinstance(ids, list) and fid in ids:
                meta["folders"] = [x for x in ids if x != fid]
        data["version"] = 2
        _save(data)
        state = _folder_state(data)
    return {"ok": True, **state}


def assign_folder(paths: list[str], folder_id: str, action: str = "add") -> dict:
    """把一批图片放进 / 移出某个收藏夹。

    - 图片还没被收藏时自动加进收藏（否则「放入收藏夹」看不见）
    - action: add | remove
    """
    fid = str(folder_id or "").strip()
    if not fid:
        return {"ok": False, "error": "缺少收藏夹 id"}
    action = "remove" if action == "remove" else "add"
    with _LOCK:
        data = _load()
        if not any(f["id"] == fid for f in data["folders"]):
            return {"ok": False, "error": "收藏夹不存在"}

        items = data["items"]
        now = time.time()
        changed: list[str] = []
        for raw in paths:
            path = str(raw or "").strip()
            if not path:
                continue
            key = _find_key(items, path)
            if action == "add":
                if key is None:
                    key = _storage_key(path)
                    items[key] = {"added": now, "folders": [fid]}
                    changed.append(key)
                    continue
                meta = items[key]
                ids = meta.get("folders")
                if not isinstance(ids, list):
                    ids = []
                if fid not in ids:
                    ids.append(fid)
                    meta["folders"] = ids
                    changed.append(key)
            else:
                if key is None:
                    continue
                meta = items[key]
                ids = meta.get("folders")
                if isinstance(ids, list) and fid in ids:
                    meta["folders"] = [x for x in ids if x != fid]
                    changed.append(key)

        if changed:
            data["version"] = 2
            _save(data)
        snapshot = _snapshot(data)
        state = _folder_state(data)
    return {
        "ok": True,
        "changed": changed,
        "count": len(changed),
        "items": snapshot,
        **state,
    }
