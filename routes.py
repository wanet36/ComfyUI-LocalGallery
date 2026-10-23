"""ComfyUI HTTP 路由：列表 / 缩略图 / 提示词 / 原图 / 目录浏览。

不再提供系统原生选择框（便携版 python 通常没装 tkinter），
改用内置的 /local_gallery/browse 目录浏览接口。
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from pathlib import Path

from aiohttp import web

from .gallery import (
    browse_dir,
    config_public,
    describe_paths,
    image_size,
    is_path_allowed,
    list_trash,
    load_config,
    load_ui_settings,
    load_last_paths,
    make_thumbnail,
    purge_trash,
    restore_trash,
    save_config,
    scan_folder,
    save_last_paths,
    save_ui_settings,
    scan_orphan_prompts,
    search_prompts,
    trash_images,
    trash_prompts,
    trash_thumb,
)
from .favorites import export_favorites, list_favorites, toggle_favorites
from .prompt_reader import (
    TEXT_SIDECAR_EXTENSIONS,
    find_sidecar_prompt,
    has_prompt_file,
    read_prompt_file,
)
from . import captioner
from . import convert

logger = logging.getLogger(__name__)

routes = None
try:
    from server import PromptServer

    routes = PromptServer.instance.routes
except Exception as exc:  # pragma: no cover - 只在非 ComfyUI 环境触发
    logger.warning(f"[LocalGallery] 无法挂载 HTTP 路由（非 ComfyUI 环境）：{exc}")


NODE_API_PREFIX = "/local_gallery"

# 1x1 透明 PNG，用于缩略图失败时占位
_PLACEHOLDER_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00"
    b"\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _deny(message: str, status: int = 400):
    return web.json_response({"ok": False, "error": message}, status=status)


def _check_path(raw: str) -> tuple[Path | None, web.Response | None]:
    if not raw:
        return None, _deny("缺少 path 参数")
    path = Path(os.path.expandvars(os.path.expanduser(raw.strip().strip('"'))))
    if not path.exists():
        return None, _deny(f"路径不存在：{path}", 404)
    if not is_path_allowed(path):
        return None, _deny("路径不在 config.json 的 allowed_roots 允许范围内", 403)
    return path, None


def register_routes() -> bool:
    if routes is None:
        return False
    if getattr(routes, "_local_gallery_registered", False):
        return True

    # ------------------------------------------------------------------ list
    @routes.get(f"{NODE_API_PREFIX}/list")
    async def local_gallery_list(request: web.Request):
        raw = request.query.get("path", "")
        recursive = request.query.get("recursive", "0") in ("1", "true", "True")
        only_with_prompt = request.query.get("only_with_prompt", "0") in ("1", "true", "True")
        extensions = [e for e in request.query.get("ext", "").split(",") if e.strip()]
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(
                None,
                lambda: scan_folder(
                    raw,
                    recursive=recursive,
                    only_with_prompt=only_with_prompt,
                    extensions=extensions or None,
                ),
            )
        except Exception as exc:
            logger.exception("[LocalGallery] 扫描目录失败")
            return _deny(f"扫描失败：{exc}", 500)
        return web.json_response(result)

    # ----------------------------------------------------------------- browse
    @routes.get(f"{NODE_API_PREFIX}/browse")
    async def local_gallery_browse(request: web.Request):
        raw = request.query.get("path", "")
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, browse_dir, raw)
        except Exception as exc:
            logger.exception("[LocalGallery] 浏览目录失败")
            return _deny(f"浏览失败：{exc}", 500)
        return web.json_response(result)

    # ------------------------------------------------------------- orphans
    @routes.get(f"{NODE_API_PREFIX}/orphans")
    async def local_gallery_orphans(request: web.Request):
        """列出「有提示词文件、但没有同名图片」的孤儿提示词。"""
        raw = request.query.get("path", "")
        recursive = request.query.get("recursive", "0") in ("1", "true", "True")
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, scan_orphan_prompts, raw, recursive)
        except Exception as exc:
            logger.exception("[LocalGallery] 列出孤儿提示词失败")
            return _deny(f"读取失败：{exc}", 500)
        return web.json_response(result)

    # ------------------------------------------------------------- thumbnails
    @routes.get(f"{NODE_API_PREFIX}/thumb")
    async def local_gallery_thumb(request: web.Request):
        raw = request.query.get("path", "")
        path, error = _check_path(raw)
        if error is not None:
            return error
        try:
            size = int(request.query.get("size", "320"))
        except ValueError:
            size = 320
        loop = asyncio.get_running_loop()
        try:
            data = await loop.run_in_executor(None, make_thumbnail, str(path), size)
        except Exception:
            logger.exception("[LocalGallery] 缩略图生成失败")
            data = None
        if not data:
            return web.Response(
                body=_PLACEHOLDER_PNG,
                content_type="image/png",
                headers={"Cache-Control": "no-store"},
            )
        return web.Response(
            body=data,
            content_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=31536000"},
        )

    # ------------------------------------------------------------------- raw
    @routes.get(f"{NODE_API_PREFIX}/raw")
    async def local_gallery_raw(request: web.Request):
        raw = request.query.get("path", "")
        path, error = _check_path(raw)
        if error is not None:
            return error
        if not path.is_file():
            return _deny("不是文件", 400)
        return web.FileResponse(path)

    # ---------------------------------------------------------------- prompt
    @routes.get(f"{NODE_API_PREFIX}/prompt")
    async def local_gallery_prompt(request: web.Request):
        raw = request.query.get("path", "")
        path, error = _check_path(raw)
        if error is not None:
            return error
        loop = asyncio.get_running_loop()

        # 孤儿提示词：直接给一个 .txt，按侧车规则读内容（没有图片尺寸）
        if path.suffix.lower() in TEXT_SIDECAR_EXTENSIONS + (".json",):
            def read_sidecar():
                return read_prompt_file(path)

            try:
                text = await loop.run_in_executor(None, read_sidecar)
            except Exception as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=500)
            return web.json_response(
                {
                    "ok": True,
                    "path": str(path),
                    "name": path.name,
                    "prompt": text or "",
                    "has_prompt": bool(text),
                    "width": 0,
                    "height": 0,
                    "sidecar": True,
                }
            )

        def work():
            return find_sidecar_prompt(path) or ""

        try:
            prompt = await loop.run_in_executor(None, work)
        except Exception as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=500)
        width, height = await loop.run_in_executor(None, image_size, str(path))
        return web.json_response(
            {
                "ok": True,
                "path": str(path),
                "name": path.name,
                "prompt": prompt or "",
                "has_prompt": bool(prompt) or has_prompt_file(path),
                "width": width,
                "height": height,
            }
        )

    # --------------------------------------------------------------- describe
    @routes.post(f"{NODE_API_PREFIX}/describe")
    async def local_gallery_describe(request: web.Request):
        try:
            payload = await request.json()
        except Exception:
            return _deny("请求体不是合法 JSON")
        paths = payload.get("paths") if isinstance(payload, dict) else payload
        if not isinstance(paths, list):
            return _deny("paths 必须是数组")
        loop = asyncio.get_running_loop()
        items = await loop.run_in_executor(None, describe_paths, [str(p) for p in paths])
        return web.json_response({"ok": True, "items": items})

    # ---------------------------------------------------------------- delete
    @routes.post(f"{NODE_API_PREFIX}/delete")
    async def local_gallery_delete(request: web.Request):
        """「删除」= 移到回收站，可手动恢复。只接受图片文件。"""
        try:
            payload = await request.json()
        except Exception:
            return _deny("请求体不是合法 JSON")
        paths = payload.get("paths") if isinstance(payload, dict) else payload
        if not isinstance(paths, list) or not paths:
            return _deny("paths 必须是非空数组")
        if len(paths) > 500:
            return _deny("一次最多删除 500 个文件")

        cleaned = [str(p).strip() for p in paths if str(p or "").strip()]
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, trash_images, cleaned)
        except Exception as exc:
            logger.exception("[LocalGallery] 删除失败")
            return _deny(f"删除失败：{exc}", 500)

        # 删掉的图顺手取消收藏，避免收藏页留下死链（前端也会做一次，幂等）
        moved_paths = [m.get("path") for m in result.get("moved", []) if m.get("path")]
        if moved_paths:
            try:
                await loop.run_in_executor(None, toggle_favorites, moved_paths, "remove", {})
            except Exception:
                logger.warning("[LocalGallery] 清理收藏失败", exc_info=True)

        if not result.get("ok"):
            return web.json_response(result, status=400)
        logger.info(
            "[LocalGallery] 已移入回收站 %s 个文件 -> %s",
            len(result.get("moved", [])),
            result.get("trash_dir"),
        )
        return web.json_response(result)

    # --------------------------------------------------------------- search
    @routes.post(f"{NODE_API_PREFIX}/search")
    async def local_gallery_search(request: web.Request):
        """按提示词内容搜索。files 是前端当前列表里的图片路径。"""
        try:
            payload = await request.json()
        except Exception:
            return _deny("请求体不是合法 JSON")
        if not isinstance(payload, dict):
            return _deny("请求体必须是对象")

        files = payload.get("files")
        if not isinstance(files, list) or not files:
            return _deny("files 必须是非空数组")
        if len(files) > 50000:
            return _deny("文件太多，请先缩小路径范围")

        raw_q = payload.get("q")
        keywords = raw_q if isinstance(raw_q, list) else str(raw_q or "").split()
        keywords = [str(k) for k in keywords if str(k).strip()]
        if not keywords:
            return _deny("缺少搜索关键词")

        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(
                None,
                lambda: search_prompts([str(f) for f in files], keywords),
            )
        except Exception as exc:
            logger.exception("[LocalGallery] 提示词搜索失败")
            return _deny(f"搜索失败：{exc}", 500)

        result["ok"] = True
        return web.json_response(result)

    # ------------------------------------------------------------ favorites
    @routes.get(f"{NODE_API_PREFIX}/favorites")
    async def local_gallery_favorites_list(request: web.Request):
        loop = asyncio.get_running_loop()
        try:
            items = await loop.run_in_executor(None, list_favorites)
        except Exception as exc:
            logger.exception("[LocalGallery] 读取收藏失败")
            return _deny(f"读取收藏失败：{exc}", 500)
        return web.json_response({"ok": True, "count": len(items), "items": items})

    @routes.post(f"{NODE_API_PREFIX}/favorites")
    async def local_gallery_favorites_toggle(request: web.Request):
        try:
            payload = await request.json()
        except Exception:
            return _deny("请求体不是合法 JSON")
        if not isinstance(payload, dict):
            return _deny("请求体必须是对象")
        paths = payload.get("paths")
        if isinstance(paths, str):
            paths = [paths]
        if not isinstance(paths, list) or not paths:
            return _deny("paths 必须是非空数组")
        if len(paths) > 2000:
            return _deny("一次最多操作 2000 个")
        action = str(payload.get("action") or "toggle")
        prompts = payload.get("prompts") if isinstance(payload.get("prompts"), dict) else {}

        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(
                None, toggle_favorites, [str(p) for p in paths], action, prompts
            )
        except Exception as exc:
            logger.exception("[LocalGallery] 更新收藏失败")
            return _deny(f"更新收藏失败：{exc}", 500)

        result["ok"] = True
        result["count"] = len(result.get("items", []))
        return web.json_response(result)

    # --------------------------------------------------------------- caption
    @routes.get(f"{NODE_API_PREFIX}/caption/info")
    async def local_gallery_caption_info(request: web.Request):
        """可用模型 / 默认阈值 / TIPO 是否可用。前端打开反推面板时调一次。"""
        loop = asyncio.get_running_loop()
        try:
            data = await loop.run_in_executor(None, captioner.info)
        except Exception as exc:
            logger.exception("[LocalGallery] 读取反推配置失败")
            return _deny(f"读取失败：{exc}", 500)
        return web.json_response(data)

    @routes.post(f"{NODE_API_PREFIX}/caption/start")
    async def local_gallery_caption_start(request: web.Request):
        """开一个后台反推任务。路径必须过 allowed_roots 白名单。"""
        try:
            payload = await request.json()
        except Exception:
            return _deny("请求体不是合法 JSON")
        if not isinstance(payload, dict):
            return _deny("请求体必须是对象")

        raw_paths = payload.get("paths")
        if not isinstance(raw_paths, list) or not raw_paths:
            return _deny("paths 必须是非空数组")

        allowed: list[str] = []
        blocked = 0
        for raw in raw_paths:
            text = str(raw or "").strip()
            if not text:
                continue
            path = Path(os.path.expandvars(os.path.expanduser(text)))
            if not is_path_allowed(path):
                blocked += 1
                continue
            allowed.append(str(path))
        if not allowed:
            return _deny("没有可处理的图片（路径不在 allowed_roots 允许范围内）", 403)

        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, captioner.start_job, allowed, options)
        except ValueError as exc:
            return _deny(str(exc))
        except RuntimeError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=409)
        except Exception as exc:
            logger.exception("[LocalGallery] 启动反推任务失败")
            return _deny(f"启动失败：{exc}", 500)

        result["ok"] = True
        result["blocked"] = blocked
        return web.json_response(result)

    @routes.get(f"{NODE_API_PREFIX}/caption/status")
    async def local_gallery_caption_status(request: web.Request):
        """轮询进度。since 只取增量结果，避免每 500ms 重传整批。"""
        job_id = request.query.get("job", "")
        if not job_id:
            return _deny("缺少 job 参数")
        try:
            since = int(request.query.get("since", "0"))
        except ValueError:
            since = 0
        data = captioner.job_status(job_id, since)
        if data is None:
            return web.json_response({"ok": False, "error": "任务不存在或已过期"}, status=404)
        data["ok"] = True
        return web.json_response(data)

    @routes.post(f"{NODE_API_PREFIX}/caption/cancel")
    async def local_gallery_caption_cancel(request: web.Request):
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        job_id = str((payload or {}).get("job") or "")
        if not job_id:
            return _deny("缺少 job")
        return web.json_response({"ok": captioner.cancel_job(job_id)})

    # --------------------------------------------------------------- convert
    @routes.get(f"{NODE_API_PREFIX}/convert/info")
    async def local_gallery_convert_info(request: web.Request):
        """可选格式 / 压缩方式 / 输出方式。前端打开转换面板时调一次。"""
        loop = asyncio.get_running_loop()
        try:
            data = await loop.run_in_executor(None, convert.info)
        except Exception as exc:
            logger.exception("[LocalGallery] 读取转换配置失败")
            return _deny(f"读取失败：{exc}", 500)
        return web.json_response(data)

    @routes.post(f"{NODE_API_PREFIX}/convert/start")
    async def local_gallery_convert_start(request: web.Request):
        """开一个后台转换/压缩任务。路径必须过 allowed_roots 白名单。"""
        try:
            payload = await request.json()
        except Exception:
            return _deny("请求体不是合法 JSON")
        if not isinstance(payload, dict):
            return _deny("请求体必须是对象")

        raw_paths = payload.get("paths")
        if not isinstance(raw_paths, list) or not raw_paths:
            return _deny("paths 必须是非空数组")

        allowed: list[str] = []
        blocked = 0
        for raw in raw_paths:
            text = str(raw or "").strip()
            if not text:
                continue
            path = Path(os.path.expandvars(os.path.expanduser(text)))
            if not is_path_allowed(path):
                blocked += 1
                continue
            allowed.append(str(path))
        if not allowed:
            return _deny("没有可处理的图片（路径不在 allowed_roots 允许范围内）", 403)

        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, convert.start_job, allowed, options)
        except ValueError as exc:
            return _deny(str(exc))
        except RuntimeError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=409)
        except Exception as exc:
            logger.exception("[LocalGallery] 启动转换任务失败")
            return _deny(f"启动失败：{exc}", 500)

        result["ok"] = True
        result["blocked"] = blocked
        return web.json_response(result)

    @routes.get(f"{NODE_API_PREFIX}/convert/status")
    async def local_gallery_convert_status(request: web.Request):
        job_id = request.query.get("job", "")
        if not job_id:
            return _deny("缺少 job 参数")
        try:
            since = int(request.query.get("since", "0"))
        except ValueError:
            since = 0
        data = convert.job_status(job_id, since)
        if data is None:
            return web.json_response({"ok": False, "error": "任务不存在或已过期"}, status=404)
        data["ok"] = True
        return web.json_response(data)

    @routes.post(f"{NODE_API_PREFIX}/convert/cancel")
    async def local_gallery_convert_cancel(request: web.Request):
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        job_id = str((payload or {}).get("job") or "")
        if not job_id:
            return _deny("缺少 job")
        return web.json_response({"ok": convert.cancel_job(job_id)})

    @routes.post(f"{NODE_API_PREFIX}/caption/write")
    async def local_gallery_caption_write(request: web.Request):
        """把（可能被手工改过的）文本写成同名 .txt 侧车。"""
        try:
            payload = await request.json()
        except Exception:
            return _deny("请求体不是合法 JSON")
        if not isinstance(payload, dict):
            return _deny("请求体必须是对象")

        items = payload.get("items")
        if not isinstance(items, list) or not items:
            return _deny("items 必须是非空数组")
        if len(items) > captioner.MAX_WRITE_ITEMS:
            return _deny(f"一次最多写入 {captioner.MAX_WRITE_ITEMS} 个文件")

        mode = str(payload.get("mode") or "skip")
        if mode not in ("skip", "overwrite", "append"):
            return _deny("mode 只能是 skip / overwrite / append")
        ext = str(payload.get("ext") or ".txt")
        if not re.fullmatch(r"\.[A-Za-z0-9]{1,8}", ext):
            return _deny("ext 不合法")

        blocked: list[dict] = []
        safe_items: list[dict] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            path = Path(os.path.expandvars(os.path.expanduser(str(item.get("path") or "").strip())))
            if not str(path):
                continue
            if not is_path_allowed(path):
                blocked.append({"path": str(path), "error": "路径不在 allowed_roots 允许范围内"})
                continue
            safe_items.append({"path": str(path), "text": item.get("text") or ""})
        if not safe_items:
            return web.json_response(
                {"ok": False, "error": "没有可写入的文件", "failed": blocked}, status=403
            )

        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(
                None, lambda: captioner.write_captions(safe_items, mode, ext)
            )
        except ValueError as exc:
            return _deny(str(exc))
        except Exception as exc:
            logger.exception("[LocalGallery] 写入提示词失败")
            return _deny(f"写入失败：{exc}", 500)

        result["failed"] = list(result.get("failed", [])) + blocked
        result["count"] = len(result.get("written", []))
        result["skipped_count"] = len(result.get("skipped", []))
        logger.info(
            "[LocalGallery] 反推写回：新增 %s / 跳过 %s / 失败 %s",
            result["count"],
            result["skipped_count"],
            len(result["failed"]),
        )
        return web.json_response(result)

    # --------------------------------------------------------- delete prompt
    @routes.post(f"{NODE_API_PREFIX}/delete_prompts")
    async def local_gallery_delete_prompts(request: web.Request):
        """只删提示词（移到回收站），图片原样保留。"""
        try:
            payload = await request.json()
        except Exception:
            return _deny("请求体不是合法 JSON")
        paths = payload.get("paths") if isinstance(payload, dict) else payload
        if not isinstance(paths, list) or not paths:
            return _deny("paths 必须是非空数组")
        if len(paths) > 2000:
            return _deny("一次最多处理 2000 个")

        cleaned = [str(p).strip() for p in paths if str(p or "").strip()]
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, trash_prompts, cleaned)
        except Exception as exc:
            logger.exception("[LocalGallery] 删除提示词失败")
            return _deny(f"删除失败：{exc}", 500)

        if not result.get("ok"):
            return web.json_response(result, status=400)
        logger.info("[LocalGallery] 已移走 %s 个提示词文件", len(result.get("moved", [])))
        return web.json_response(result)

    # ------------------------------------------------------------ trash info
    @routes.get(f"{NODE_API_PREFIX}/trash")
    async def local_gallery_trash_info(request: web.Request):
        """回收站清单：批次 -> 条目（含原路径，可直接恢复）。"""
        loop = asyncio.get_running_loop()
        try:
            data = await loop.run_in_executor(None, list_trash)
        except Exception as exc:
            logger.exception("[LocalGallery] 读取回收站失败")
            return _deny(f"读取回收站失败：{exc}", 500)
        return web.json_response(data)

    @routes.get(f"{NODE_API_PREFIX}/trash/thumb")
    async def local_gallery_trash_thumb(request: web.Request):
        batch = request.query.get("batch", "")
        stored = request.query.get("stored", "")
        if not batch or not stored:
            return _deny("缺少 batch / stored")
        try:
            size = int(request.query.get("size", "320"))
        except ValueError:
            size = 320
        loop = asyncio.get_running_loop()
        try:
            data = await loop.run_in_executor(None, trash_thumb, batch, stored, size)
        except Exception:
            logger.exception("[LocalGallery] 回收站缩略图失败")
            data = None
        if not data:
            return web.Response(
                body=_PLACEHOLDER_PNG,
                content_type="image/png",
                headers={"Cache-Control": "no-store"},
            )
        return web.Response(
            body=data,
            content_type="image/jpeg",
            headers={"Cache-Control": "no-store"},
        )

    @routes.post(f"{NODE_API_PREFIX}/trash/restore")
    async def local_gallery_trash_restore(request: web.Request):
        try:
            payload = await request.json()
        except Exception:
            return _deny("请求体不是合法 JSON")
        items = payload.get("items") if isinstance(payload, dict) else None
        if not isinstance(items, list) or not items:
            return _deny("items 必须是非空数组")
        if len(items) > 2000:
            return _deny("一次最多恢复 2000 个")

        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, restore_trash, items)
        except Exception as exc:
            logger.exception("[LocalGallery] 恢复失败")
            return _deny(f"恢复失败：{exc}", 500)

        if not result.get("ok"):
            return web.json_response(result, status=400)
        logger.info("[LocalGallery] 已从回收站恢复 %s 个条目", len(result.get("restored", [])))
        return web.json_response(result)

    @routes.post(f"{NODE_API_PREFIX}/trash/purge")
    async def local_gallery_trash_purge(request: web.Request):
        """永久清空：给 batch 清这一批，不给则清空整个回收站。"""
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        batch = str((payload or {}).get("batch") or "").strip() or None
        loop = asyncio.get_running_loop()
        try:
            result = await loop.run_in_executor(None, purge_trash, batch)
        except Exception as exc:
            logger.exception("[LocalGallery] 清空回收站失败")
            return _deny(f"清空失败：{exc}", 500)
        return web.json_response(result)

    # ------------------------------------------------------------------ info
    # ------------------------------------------------------------- UI 设置
    @routes.get(f"{NODE_API_PREFIX}/ui/settings")
    async def local_gallery_ui_settings_get(request: web.Request):
        return web.json_response({"ok": True, **load_ui_settings()})

    @routes.post(f"{NODE_API_PREFIX}/ui/settings")
    async def local_gallery_ui_settings_post(request: web.Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            return web.json_response({"ok": False, "error": "需要 JSON 对象"}, status=400)
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, save_ui_settings, body)
        return web.json_response({"ok": True, **data})

    # ------------------------------------------------- 收藏导出到文件夹
    @routes.post(f"{NODE_API_PREFIX}/favorites/export")
    async def local_gallery_favorites_export(request: web.Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        dest = str(body.get("dest") or "").strip()
        overwrite = bool(body.get("overwrite"))
        loop = asyncio.get_running_loop()
        data = await loop.run_in_executor(None, export_favorites, dest, overwrite)
        return web.json_response(data, status=200 if data.get("ok") else 400)

    # ------------------------------------------------------- 上次用过的路径
    @routes.get(f"{NODE_API_PREFIX}/paths")
    async def local_gallery_paths_get(request: web.Request):
        return web.json_response({"ok": True, "paths": load_last_paths()})

    @routes.post(f"{NODE_API_PREFIX}/paths")
    async def local_gallery_paths_post(request: web.Request):
        try:
            body = await request.json()
        except Exception:
            body = {}
        raw = body.get("paths") if isinstance(body, dict) else body
        if raw is None:
            raw = []
        if not isinstance(raw, list):
            return web.json_response(
                {"ok": False, "error": "paths 需要是数组"}, status=400
            )
        return web.json_response({"ok": True, "paths": save_last_paths(raw)})

    @routes.get(f"{NODE_API_PREFIX}/info")
    async def local_gallery_info(request: web.Request):
        config = load_config()
        return web.json_response(
            {
                "ok": True,
                "allowed_roots": config.get("allowed_roots") or [],
                "thumb_size": config.get("thumb_size", 320),
            }
        )

    # --------------------------------------------------------------- config
    @routes.get(f"{NODE_API_PREFIX}/config")
    async def local_gallery_config_get(request: web.Request):
        """设置面板用：config.json 里能改的那几项 + 实际生效的回收站目录。"""
        loop = asyncio.get_running_loop()
        try:
            data = await loop.run_in_executor(None, config_public)
        except Exception as exc:
            logger.exception("[LocalGallery] 读取配置失败")
            return _deny(f"读取配置失败：{exc}", 500)
        return web.json_response({"ok": True, "config": data})

    @routes.post(f"{NODE_API_PREFIX}/config")
    async def local_gallery_config_post(request: web.Request):
        """写回 config.json：只认设置面板里那几个字段，越界直接 400。"""
        try:
            payload = await request.json()
        except Exception:
            return _deny("请求体不是合法 JSON")
        if not isinstance(payload, dict):
            return _deny("请求体必须是对象")
        loop = asyncio.get_running_loop()
        try:
            data = await loop.run_in_executor(None, save_config, payload)
        except ValueError as exc:
            return _deny(str(exc))
        except Exception as exc:
            logger.exception("[LocalGallery] 保存配置失败")
            return _deny(f"保存失败：{exc}", 500)
        return web.json_response({"ok": True, "config": data})

    routes._local_gallery_registered = True
    logger.info("[LocalGallery] HTTP 路由已注册：%s/*", NODE_API_PREFIX)
    return True
