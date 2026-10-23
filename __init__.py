"""ComfyUI 本地图库浏览器（Local Gallery Browser）

改造自 ComfyUI-Danbooru-Gallery 的 DanbooruGalleryNode：
- 数据源：远端站点 -> 本地文件夹 / 单张图片
- 提示词：远端帖子 tags -> 同目录同名 .txt/.caption/.prompt/.json 或图片内嵌元数据
- 输出：images(IMAGE 列表) / prompts(STRING 列表) / filenames(STRING 列表)
"""

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .routes import register_routes

try:
    register_routes()
except Exception as exc:  # 路由失败不应阻断节点加载
    import logging

    logging.getLogger(__name__).warning(f"[LocalGallery] 路由注册失败：{exc}")

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
