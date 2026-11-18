/**
 * 本地图库浏览器 — ComfyUI 前端扩展
 * 改造自 ComfyUI-Danbooru-Gallery 的 danbooru_gallery.js
 *
 * - 多路径：路径列表（每行一个），文件夹与单张图片可混填
 * - 内置文件浏览器：不依赖 tkinter / 系统对话框
 * - 缩略图网格：固定行高 + 尺寸滑块，避免 aspect-ratio 造成的重叠
 * - 悬停浮窗显示文件名/尺寸/提示词，底部只留一行状态
 */

import { app } from "../../scripts/app.js";

const NODE_NAME = "LocalGalleryBrowser";
const STORE_KEY = "localGalleryBrowser.lastPaths";
const PAGE_SIZE = 80;
const COLS_DEFAULT = 6;
const COLS_MIN = 2;
const COLS_MAX = 10;
const COLS_KEY = "localGalleryBrowser.cols";
const THEME_KEY = "localGalleryBrowser.theme"; // auto | light | dark
const PICK_KEY = "localGalleryBrowser.pickMode"; // multi | single

/* 选择模式只认这两个值，坏数据一律回落到多选 */
function readPickMode() {
  try {
    return localStorage.getItem(PICK_KEY) === "single" ? "single" : "multi";
  } catch (err) {
    return "multi";
  }
}

/* ------------------------------------------------------------------ 样式 */
const CSS = `
/* ============================================================ 设计令牌 */
/* 令牌定义在面板根节点 + 浮层（浮层挂在 body 上，需要自己带一份） */
.lgb-wrap,
.lgb-tip,
.lgb-overlay,
.lgb-sortmenu {
  --lg-font: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  --lg-mono: "SFMono-Regular", "Cascadia Mono", Consolas, "Liberation Mono", monospace;

  /* 表面 */
  --lg-bg: #17181c;
  --lg-elev: #1e2026;
  --lg-sunken: #121317;
  --lg-hover: #272b34;
  --lg-active: #30353f;
  --lg-line: #2a2e37;
  --lg-line-2: #3c424e;

  /* 文字 */
  --lg-text: #e9ecf2;
  --lg-text-2: #a5adba;
  --lg-text-3: #6d7480;

  /* 语义色 */
  --lg-accent: #6aa1ff;
  --lg-accent-2: #3f7cf5;
  --lg-accent-soft: rgba(106, 161, 255, 0.15);
  --lg-accent-line: rgba(106, 161, 255, 0.52);
  --lg-on-accent: #0a1120;
  --lg-gold: #f3c25f;
  --lg-danger: #f0736b;
  --lg-danger-soft: rgba(240, 115, 107, 0.15);
  --lg-ok: #5fd08a;

  /* 阴影 / 圆角 / 动效 */
  --lg-shadow-1: 0 2px 8px rgba(0, 0, 0, 0.34);
  --lg-shadow-2: 0 14px 38px rgba(0, 0, 0, 0.58);
  --lg-r-sm: 4px;
  --lg-r: 6px;
  --lg-r-lg: 9px;
  --lg-dur: 140ms;

  --lg-ctl-h: 28px;
  --lg-ctl-h-sm: 24px;
}

/* 亮色主题：只换令牌，组件样式完全复用 */
.lgb-wrap[data-theme="light"],
.lgb-tip[data-theme="light"],
.lgb-overlay[data-theme="light"],
.lgb-sortmenu[data-theme="light"] {
  --lg-bg: #f6f7f9;
  --lg-elev: #ffffff;
  --lg-sunken: #eceef2;
  --lg-hover: #eef1f5;
  --lg-active: #e2e6ed;
  --lg-line: #dfe3ea;
  --lg-line-2: #c6cdd9;

  --lg-text: #1b1f27;
  --lg-text-2: #596374;
  --lg-text-3: #8b93a1;

  --lg-accent: #2f6fe4;
  --lg-accent-2: #1f5bd0;
  --lg-accent-soft: rgba(47, 111, 228, 0.1);
  --lg-accent-line: rgba(47, 111, 228, 0.42);
  --lg-on-accent: #ffffff;
  --lg-gold: #b8810c;
  --lg-danger: #d0342c;
  --lg-danger-soft: rgba(208, 52, 44, 0.1);
  --lg-ok: #1f9254;

  --lg-shadow-1: 0 1px 3px rgba(16, 24, 40, 0.1);
  --lg-shadow-2: 0 16px 40px rgba(16, 24, 40, 0.18);
}

/* ================================================================ 基础 */
.lgb-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  background: var(--lg-bg);
  color: var(--lg-text);
  font-family: var(--lg-font);
  font-size: 12px;
  line-height: 1.45;
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
}
.lgb-wrap *,
.lgb-wrap *::before,
.lgb-wrap *::after {
  box-sizing: border-box;
}
.lgb-wrap button,
.lgb-wrap input {
  font-family: inherit;
}
.lgb-wrap :focus-visible,
.lgb-overlay :focus-visible {
  outline: 2px solid var(--lg-accent);
  outline-offset: 1px;
}
.lgb-wrap ::-webkit-scrollbar,
.lgb-overlay ::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
.lgb-wrap ::-webkit-scrollbar-track,
.lgb-overlay ::-webkit-scrollbar-track {
  background: transparent;
}
.lgb-wrap ::-webkit-scrollbar-thumb,
.lgb-overlay ::-webkit-scrollbar-thumb {
  background: var(--lg-line-2);
  border: 3px solid transparent;
  background-clip: content-box;
  border-radius: 99px;
}
.lgb-wrap ::-webkit-scrollbar-thumb:hover,
.lgb-overlay ::-webkit-scrollbar-thumb:hover {
  background: var(--lg-text-3);
  background-clip: content-box;
}

.lgb-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-width: 0;
}
.lgb-bar {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.lgb-bar::-webkit-scrollbar {
  height: 4px;
}

/* ============================================================ 顶部栏 */
.lgb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  border-bottom: 1px solid var(--lg-line);
}
.lgb-head-spacer {
  flex: 1 1 auto;
  min-width: 0;
}

/* 批量删除按钮组：图库/收藏挂在路径栏，提示词页整块挪进提示词栏 */
.lgb-bulk {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

/* 分段控件 */
.lgb-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--lg-sunken);
  border: 1px solid var(--lg-line);
  flex: 0 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.lgb-tabs::-webkit-scrollbar {
  height: 0;
}
.lgb-wrap .lgb-tab {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--lg-text-2);
  font-size: 12px;
  line-height: 1;
  padding: 5px 10px;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  transition: background var(--lg-dur), color var(--lg-dur), box-shadow var(--lg-dur);
}
.lgb-wrap .lgb-tab:hover {
  color: var(--lg-text);
  background: var(--lg-hover);
}
.lgb-wrap .lgb-tab.on {
  color: var(--lg-accent);
  background: var(--lg-accent-soft);
  box-shadow: inset 0 0 0 1px var(--lg-accent-line);
  font-weight: 600;
}
.lgb-tab .num {
  font-size: 10px;
  line-height: 1;
  padding: 0;
  color: var(--lg-text-3);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
.lgb-wrap .lgb-tab.on .num {
  color: var(--lg-accent);
  opacity: 0.9;
}
.lgb-wrap .lgb-tab:disabled {
  opacity: 0.45;
  cursor: default;
  background: transparent;
  color: var(--lg-text-3);
}
/* 提示词页里的第二级切换：比顶栏小一号，靠左贴齐 */
.lgb-subtabs {
  flex: 0 0 auto;
  align-self: flex-start;
}
.lgb-subtabs .lgb-tab {
  font-size: 11.5px;
  padding: 4px 9px;
}

/* 密度控制 */
.lgb-size {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  color: var(--lg-text-3);
  font-size: 11px;
  user-select: none;
  white-space: nowrap;
}
.lgb-slider {
  width: 84px;
  height: 14px;
  margin: 0;
  accent-color: var(--lg-accent);
  cursor: pointer;
  flex: 0 0 auto;
}

/* 关掉「附加说明」后：只藏解释性段落，警告（.warnline）和结果摘要（.lgb-conv-msg）照常显示 */
html.lgb-no-hints .lgb-settings .desc:not(.warnline):not(.lgb-conv-msg) {
  display: none;
}

/* 回收站「当前生效」路径：等宽小字，不属于解释段落，关说明时也保留 */
.lgb-settings .lgb-pathhint {
  margin: -2px 0 3px;
  font-family: var(--lg-mono);
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--lg-text-3);
  /* 长路径折行显示，别截断成看不清的半截 */
  word-break: break-all;
}

/* ============================================================ 路径栏 */
.lgb-bar {
  padding: 8px 8px 0;
}

.lgb-input {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--lg-ctl-h);
  background: var(--lg-sunken);
  color: var(--lg-text);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  padding: 0 9px;
  font-size: 12px;
  outline: none;
  transition: border-color var(--lg-dur), box-shadow var(--lg-dur), background var(--lg-dur);
}
.lgb-input::placeholder {
  color: var(--lg-text-3);
}
.lgb-input:hover {
  border-color: var(--lg-line-2);
}
.lgb-input:focus {
  background: var(--lg-bg);
  border-color: var(--lg-accent);
  box-shadow: 0 0 0 3px var(--lg-accent-soft);
}

/* ================================================================ 按钮 */
:is(.lgb-wrap, .lgb-overlay) .lgb-btn {
  appearance: none;
  height: var(--lg-ctl-h);
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  color: var(--lg-text);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: background var(--lg-dur), border-color var(--lg-dur), color var(--lg-dur);
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn:hover {
  background: var(--lg-hover);
  border-color: var(--lg-line-2);
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn:active {
  background: var(--lg-active);
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
/* 主按钮禁用时别还留着一块亮蓝，容易误以为能点 */
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.primary:disabled,
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.primary:disabled:hover {
  background: var(--lg-sunken);
  border-color: var(--lg-line);
  color: var(--lg-text-3);
  box-shadow: none;
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.ic {
  width: var(--lg-ctl-h);
  padding: 0;
  font-size: 12px;
  color: var(--lg-text-2);
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.ic:hover {
  color: var(--lg-text);
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.sm {
  height: var(--lg-ctl-h-sm);
  padding: 0 8px;
  font-size: 11.5px;
  color: var(--lg-text-2);
  background: transparent;
  border-color: transparent;
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.sm:hover {
  color: var(--lg-text);
  background: var(--lg-hover);
  border-color: var(--lg-line);
}
/* 系统选择框开着时「浏览」的等待态（不禁用，再点会提示框已经开了） */
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.busy {
  opacity: 0.7;
  cursor: progress;
}

/* 单选 / 多选：滑块开关。滑块宽度由 JS 按当前标签实测，中英文切换都不错位 */
:is(.lgb-wrap, .lgb-overlay) .lgb-switch {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  flex: 0 0 auto;
  height: var(--lg-ctl-h-sm);
  padding: 2px;
  background: var(--lg-sunken);
  border: 1px solid var(--lg-line);
  border-radius: 999px;
  user-select: none;
  cursor: pointer;
}
:is(.lgb-wrap, .lgb-overlay) .lgb-switch .knob {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: 34px;
  border-radius: 999px;
  background: var(--lg-accent);
  transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), width 0.18s ease;
  pointer-events: none;
}
:is(.lgb-wrap, .lgb-overlay) .lgb-switch .seg {
  position: relative;
  z-index: 1;
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0 9px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--lg-text-3);
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--lg-dur);
}
:is(.lgb-wrap, .lgb-overlay) .lgb-switch .seg:hover {
  color: var(--lg-text);
}
:is(.lgb-wrap, .lgb-overlay) .lgb-switch .seg.on {
  color: var(--lg-on-accent);
  font-weight: 600;
}
:is(.lgb-wrap, .lgb-overlay) .lgb-switch .seg:focus-visible {
  outline: 1px solid var(--lg-accent);
  outline-offset: 1px;
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.primary {
  background: var(--lg-accent);
  border-color: transparent;
  color: var(--lg-on-accent);
  font-weight: 600;
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.primary:hover {
  background: var(--lg-accent-2);
  color: var(--lg-on-accent);
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.warn {
  background: var(--lg-danger-soft);
  border-color: rgba(240, 115, 107, 0.38);
  color: var(--lg-danger);
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.warn:hover {
  background: var(--lg-danger);
  border-color: transparent;
  color: #fff;
}
:is(.lgb-wrap, .lgb-overlay) .lgb-btn.danger:hover {
  background: var(--lg-danger-soft);
  border-color: rgba(240, 115, 107, 0.42);
  color: var(--lg-danger);
}

/* 内联矢量图标 */
.lgb-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  line-height: 0;
}
.lgb-acts .lgb-ico {
  opacity: 0.92;
}

/* ============================================================ 路径标签 */
.lgb-chips {
  display: flex;
  gap: 6px;
  align-items: center;
  flex: 0 0 auto;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 7px 8px 3px;
  min-height: 32px;
}
.lgb-chips::-webkit-scrollbar {
  height: 6px;
}
.lgb-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  height: 24px;
  max-width: 300px;
  padding: 0 4px 0 8px;
  background: var(--lg-sunken);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r-sm);
  transition: border-color var(--lg-dur), background var(--lg-dur);
}
.lgb-chip:hover {
  border-color: var(--lg-line-2);
  background: var(--lg-hover);
}
.lgb-chip::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 99px;
  background: var(--lg-ok);
  flex: 0 0 auto;
  opacity: 0.85;
}
.lgb-chip.miss::before {
  background: var(--lg-danger);
  opacity: 1;
}
.lgb-chip span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--lg-text-2);
  font-size: 11px;
}
.lgb-chip.miss span {
  color: var(--lg-danger);
}
/* 收藏夹选择弹窗 */
.lgb-folderpicker {
  width: min(420px, 92vw);
}
.lgb-folderpicker .hint {
  margin: 2px 0 8px;
  color: var(--lg-text-2);
  font-size: 12px;
  line-height: 1.5;
}
.lgb-folderlist {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 46vh;
  overflow-y: auto;
  padding: 2px;
}
:is(.lgb-wrap, .lgb-overlay) button.lgb-folderrow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r-sm);
  background: var(--lg-sunken);
  color: var(--lg-text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--lg-dur), background var(--lg-dur);
}
:is(.lgb-wrap, .lgb-overlay) button.lgb-folderrow:hover {
  border-color: var(--lg-accent);
  background: var(--lg-accent-soft);
}
.lgb-folderrow.lgb-unfiled {
  border-style: dashed;
  color: var(--lg-text-2);
}
.lgb-folderrow .nm {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lgb-folderrow .n {
  color: var(--lg-text-3);
  font-size: 11px;
}

/* 「删除选中」下拉菜单 */
.lgb-delmenu .lgb-sortcol {
  min-width: 210px;
}
.lgb-delmenu .opt {
  height: 30px;
}
.lgb-delmenu .opt.danger {
  color: var(--lg-danger);
}
.lgb-delmenu .opt.danger:hover {
  background: var(--lg-danger-soft);
  color: var(--lg-danger);
}
.lgb-delmenu .opt[disabled] {
  opacity: 0.45;
}

/* 列表模式：一行一张图（缩略图 + 文件名 + 分辨率体积 + 提示词 chips） */
.lgb-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.lgb-lrow {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  background: var(--lg-elev);
  cursor: pointer;
  transition: background var(--lg-dur), border-color var(--lg-dur);
}
.lgb-lrow:hover {
  background: var(--lg-hover);
}
.lgb-lrow.sel {
  border-color: var(--lg-accent);
  background: var(--lg-accent-soft);
}
.lgb-lrow .pic {
  flex: 0 0 auto;
  width: 52px;
  height: 68px;
  overflow: hidden;
  border-radius: var(--lg-r-sm);
  background: var(--lg-sunken);
}
.lgb-lrow .pic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.lgb-lrow .mid {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.lgb-lrow .nm {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--lg-text);
}
.lgb-lrow .nm .t {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lgb-lrow .nm .ext {
  flex: 0 0 auto;
  font-size: 10px;
  font-weight: 500;
  color: var(--lg-text-3);
  text-transform: uppercase;
}
.lgb-lrow .meta {
  font-size: 10.5px;
  color: var(--lg-text-3);
}
.lgb-lrow .tags {
  display: flex;
  gap: 4px;
  overflow: hidden;
  /* 右侧淡出，暗示还能横向看更多 */
  -webkit-mask-image: linear-gradient(to right, #000 82%, transparent 100%);
  mask-image: linear-gradient(to right, #000 82%, transparent 100%);
}
.lgb-lrow .tag {
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--lg-line);
  border-radius: 4px;
  background: var(--lg-sunken);
  color: var(--lg-text-2);
  font-size: 10px;
  line-height: 1.5;
  white-space: nowrap;
}
.lgb-lrow .tag.more {
  border-style: dashed;
  color: var(--lg-text-3);
}
.lgb-lrow .no {
  flex: 0 0 auto;
  min-width: 20px;
  text-align: center;
  font-size: 11px;
  color: var(--lg-text-3);
  font-variant-numeric: tabular-nums;
}
.lgb-lrow .acts {
  flex: 0 0 auto;
  display: none;
  align-items: center;
  gap: 2px;
}
.lgb-lrow:hover .acts,
.lgb-lrow.sel .acts {
  display: flex;
}
.lgb-lrow:hover .no,
.lgb-lrow.sel .no {
  display: none;
}
.lgb-lrow .acts > * {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--lg-text-2);
  cursor: pointer;
  transition: background var(--lg-dur), color var(--lg-dur);
}
.lgb-lrow .acts > *:hover {
  background: var(--lg-hover);
  color: var(--lg-text);
}
.lgb-lrow .acts .lgb-fav.on {
  color: var(--lg-accent);
}
.lgb-lrow .acts .lgb-copy.off,
.lgb-lrow .acts .lgb-del:hover {
  opacity: 0.55;
}
.lgb-lrow .acts .lgb-del:hover {
  color: var(--lg-danger);
  opacity: 1;
}
.lgb-lrow.sel .acts .lgb-fav {
  color: var(--lg-accent);
}

/* 时间分组（图库页）：一天一坨，组标题吸顶 */
.lgb-grid.timeline {
  display: block;
}
.lgb-tgroup + .lgb-tgroup {
  margin-top: 12px;
}
:is(.lgb-wrap, .lgb-overlay) button.lgb-tgroup-head {
  position: sticky;
  top: -6px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  height: 26px;
  margin: 0 0 6px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--lg-r-sm);
  /* 和滚动容器同色，吸顶时把下面的缩略图盖住 */
  background: var(--lg-sunken);
  color: var(--lg-text-2);
  font-family: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
  user-select: none;
}
:is(.lgb-wrap, .lgb-overlay) button.lgb-tgroup-head:hover {
  color: var(--lg-text);
  background: var(--lg-hover);
}
.lgb-tgroup-head .arw {
  flex: 0 0 auto;
  width: 10px;
  font-size: 9px;
  color: var(--lg-text-3);
  transition: transform var(--lg-dur);
}
.lgb-tgroup.collapsed .lgb-tgroup-head .arw {
  transform: rotate(-90deg);
}
.lgb-tgroup-head .t {
  flex: 0 0 auto;
  font-weight: 600;
  color: var(--lg-text);
}
.lgb-tgroup-head .n {
  flex: 0 0 auto;
  color: var(--lg-text-3);
  font-size: 10.5px;
}
.lgb-tgroup-head .grow {
  flex: 1 1 auto;
  min-width: 8px;
  height: 1px;
  margin: 0 2px;
  background: var(--lg-line);
}
.lgb-tgroup-head .dfull {
  flex: 0 0 auto;
  color: var(--lg-text-3);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.lgb-tgroup-grid {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
}
.lgb-tgroup.collapsed .lgb-tgroup-grid,
.lgb-tgroup.collapsed .lgb-tgroup-rows {
  display: none;
}
.lgb-tgroup-rows {
  padding-top: 2px;
}
.lgb-tgroup.collapsed .lgb-tgroup-head {
  margin-bottom: 0;
}

/* 排序浮层：左栏选依据，右栏选方向 */
.lgb-sortmenu {
  position: fixed;
  z-index: 70;
  display: flex;
  gap: 4px;
  padding: 8px;
  background: var(--lg-elev);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  box-shadow: var(--lg-shadow-2);
}
.lgb-sortmenu .lgb-sortcol {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 96px;
}
.lgb-sortmenu .cap {
  padding: 2px 8px 5px;
  font-size: 10px;
  color: var(--lg-text-3);
  white-space: nowrap;
}
.lgb-sortmenu .lgb-sortsplit {
  width: 1px;
  margin: 2px 2px;
  background: var(--lg-line);
}
.lgb-sortmenu .opt {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--lg-r-sm);
  background: transparent;
  color: var(--lg-text-2);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background var(--lg-dur), color var(--lg-dur);
}
.lgb-sortmenu .opt:hover {
  background: var(--lg-hover);
  color: var(--lg-text);
}
.lgb-sortmenu .opt.on {
  background: var(--lg-accent-soft);
  color: var(--lg-text);
  box-shadow: inset 0 0 0 1px var(--lg-accent-line);
}
.lgb-sortmenu .opt[disabled] {
  opacity: 0.42;
  cursor: default;
}
.lgb-sortmenu .opt[disabled]:hover {
  background: transparent;
  color: var(--lg-text-2);
}
.lgb-sortbtn .caret,
.lgb-delbtn .caret {
  margin-left: 4px;
  font-size: 9px;
  opacity: 0.65;
  transition: transform var(--lg-dur);
}
.lgb-sortbtn.open .caret,
.lgb-delbtn.open .caret {
  transform: rotate(180deg);
  opacity: 1;
}
.lgb-sortmenu {
  font-family: var(--lg-font);
}
.lgb-sortmenu .opt .tick {
  margin-left: auto;
  color: var(--lg-accent);
  font-size: 11px;
}

/* 右键菜单：复用排序浮层的壳，只收窄一点 */
.lgb-ctxmenu {
  z-index: 95;
  padding: 5px;
  min-width: 168px;
}
.lgb-ctxmenu .lgb-sortcol {
  min-width: 0;
}
.lgb-ctxmenu .cap {
  max-width: 260px;
  padding: 4px 8px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-bottom: 1px solid var(--lg-line);
  margin-bottom: 4px;
}
.lgb-ctxmenu .opt {
  height: 29px;
  font-size: 12.5px;
}
.lgb-ctxmenu .opt .lgb-ico {
  opacity: 0.8;
}
.lgb-ctxmenu .sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--lg-line);
}

/* 收藏夹 chips：全部 / 未分类 / 各收藏夹 / ＋新建 */
.lgb-chip.lgb-folderchip {
  cursor: pointer;
  user-select: none;
}
.lgb-chip.lgb-folderchip::before {
  background: var(--lg-text-3);
}
.lgb-chip.lgb-folderchip.on {
  border-color: var(--lg-accent);
  background: var(--lg-accent-soft);
}
.lgb-chip.lgb-folderchip.on::before {
  background: var(--lg-accent);
  opacity: 1;
}
.lgb-chip.lgb-folderchip.on span {
  color: var(--lg-text);
}
.lgb-chip.lgb-folderchip .n {
  color: var(--lg-text-3);
  font-size: 10px;
}
.lgb-chip.lgb-folderchip.add {
  border-style: dashed;
  padding-right: 8px;
}
.lgb-chip.lgb-folderchip.add::before {
  display: none;
}
:is(.lgb-wrap, .lgb-br) .lgb-chip button {
  appearance: none;
  border: 0;
  background: none;
  color: var(--lg-text-3);
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  width: 16px;
  height: 16px;
  padding: 0;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
}
:is(.lgb-wrap, .lgb-br) .lgb-chip button:hover {
  color: var(--lg-danger);
  background: var(--lg-danger-soft);
}

/* ========================================================== 筛选 + 搜索 */
.lgb-filters {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
}
.lgb-chk {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  color: var(--lg-text-2);
  font-size: 11.5px;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: color var(--lg-dur);
}
.lgb-chk:hover {
  color: var(--lg-text);
}
.lgb-chk input {
  width: 13px;
  height: 13px;
  margin: 0;
  accent-color: var(--lg-accent);
  cursor: pointer;
}

.lgb-search {
  display: flex;
  align-items: center;
  flex: 1 1 150px;
  min-width: 110px;
  height: var(--lg-ctl-h);
  background: var(--lg-sunken);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  overflow: hidden;
  transition: border-color var(--lg-dur), box-shadow var(--lg-dur), background var(--lg-dur);
}
.lgb-search:focus-within {
  background: var(--lg-bg);
  border-color: var(--lg-accent);
  box-shadow: 0 0 0 3px var(--lg-accent-soft);
}
.lgb-wrap .lgb-mode {
  appearance: none;
  border: 0;
  border-right: 1px solid var(--lg-line);
  background: transparent;
  color: var(--lg-text-2);
  font-size: 11.5px;
  height: 100%;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--lg-dur), color var(--lg-dur);
}
.lgb-wrap .lgb-mode:hover {
  background: var(--lg-hover);
  color: var(--lg-text);
}
.lgb-wrap .lgb-mode.primary {
  color: var(--lg-accent);
  font-weight: 600;
}
.lgb-search .lgb-input {
  height: 100%;
  flex: 1 1 auto;
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0 8px;
  box-shadow: none;
}
.lgb-search .lgb-input:hover {
  border: 0;
}
.lgb-search .lgb-input:focus {
  border: 0;
  background: transparent;
  box-shadow: none;
}

.lgb-count {
  flex: 0 0 auto;
  color: var(--lg-text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ================================================================ 页面 */
.lgb-page {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 8px;
}
.lgb-page.off {
  display: none;
}
.lgb-scroll {
  flex: 1 1 auto;
  min-height: 80px;
  overflow-y: auto;
  overflow-x: hidden;
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  background: var(--lg-sunken);
  padding: 6px;
}

/* 框选矩形：挂在 .lgb-canvas 上，坐标就用 grid 的 rect，滚动时自动跟着走 */
.lgb-canvas {
  position: relative;
  min-height: 1px;
}

.lgb-marquee {
  position: absolute;
  z-index: 6;
  pointer-events: none;
  border: 1px solid var(--lg-accent-2);
  border-radius: 3px;
  background: var(--lg-accent-soft);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.25) inset;
}

/* 框选过程中禁止选中文字/图片，否则会拖出一片蓝色选区 */
.lgb-wrap.lgb-marquee-on,
.lgb-wrap.lgb-marquee-on * {
  user-select: none !important;
  -webkit-user-select: none !important;
}
.lgb-scroll.off {
  display: none;
}

/* ============================================================ 缩略图网格 */
.lgb-grid {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
}
/* 缩略图区域拖动不该选中文字（单选模式没有框选，拖一下不应拉出蓝色选区）。
   只挂 canvas：提示词页复用 .lgb-scroll，那里的文字要能手动选 */
.lgb-canvas {
  -webkit-user-select: none;
  user-select: none;
}
.lgb-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.lgb-item {
  position: relative;
  width: 100%;
  border-radius: var(--lg-r-lg);
  overflow: hidden;
  cursor: pointer;
  background: var(--lg-elev);
  border: 1px solid var(--lg-line);
  transition: border-color var(--lg-dur), box-shadow var(--lg-dur);
}
.lgb-item:hover {
  border-color: var(--lg-line-2);
  box-shadow: var(--lg-shadow-1);
}
.lgb-item.sel {
  border-color: var(--lg-accent);
  box-shadow: 0 0 0 1px var(--lg-accent), 0 0 0 4px var(--lg-accent-soft);
}
.lgb-item img {
  width: 100%;
  height: auto;
  display: block;
  background: var(--lg-sunken);
  pointer-events: none;
}

/* 文件信息 */
.lgb-cap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 18px 6px 4px;
  pointer-events: none;
  background: linear-gradient(to top, rgba(6, 8, 12, 0.9), rgba(6, 8, 12, 0.52) 46%, transparent);
}
.lgb-name {
  color: #f1f4f9;
  font-size: 10.5px;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
}
.lgb-meta {
  color: rgba(230, 236, 246, 0.72);
  font-size: 9.5px;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-height: 0;
  opacity: 0;
  font-variant-numeric: tabular-nums;
  transition: max-height var(--lg-dur), opacity var(--lg-dur);
}
.lgb-item:hover .lgb-meta {
  max-height: 14px;
  opacity: 1;
}
.lgb-item.is-fav .lgb-name {
  padding-right: 12px;
}
.lgb-item.is-fav .lgb-cap::after {
  content: "★";
  position: absolute;
  right: 6px;
  bottom: 3px;
  font-size: 10px;
  color: var(--lg-gold);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.75);
}

/* 选中序号 */
.lgb-order {
  position: absolute;
  top: 5px;
  left: 5px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--lg-accent);
  color: var(--lg-on-accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  display: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  z-index: 3;
}
.lgb-item.sel .lgb-order {
  display: block;
}

/* 提示词标记 */
.lgb-txt {
  position: absolute;
  top: 5px;
  right: 5px;
  height: 16px;
  line-height: 15px;
  padding: 0 5px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.05em;
  background: rgba(24, 104, 62, 0.88);
  color: #d6f7e3;
  border: 1px solid rgba(120, 220, 160, 0.34);
  z-index: 2;
  transition: opacity var(--lg-dur);
}
.lgb-txt.off {
  background: rgba(10, 12, 17, 0.55);
  color: rgba(226, 232, 242, 0.6);
  border-color: rgba(255, 255, 255, 0.14);
  font-weight: 500;
}
.lgb-item:hover .lgb-txt {
  opacity: 0;
}

/* 悬浮操作组 */
.lgb-acts {
  position: absolute;
  top: 5px;
  right: 5px;
  z-index: 5;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 7px;
  background: rgba(10, 12, 17, 0.62);
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  opacity: 0;
  transform: translateY(-3px);
  pointer-events: none;
  transition: opacity var(--lg-dur), transform var(--lg-dur);
}
.lgb-item:hover .lgb-acts,
.lgb-item:focus-within .lgb-acts {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.lgb-acts > * {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #e9eef6;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: background var(--lg-dur), color var(--lg-dur);
}
.lgb-acts > *:hover {
  background: rgba(255, 255, 255, 0.16);
}
.lgb-fav.on {
  color: var(--lg-gold);
}
/* 没有同名提示词时按钮变淡，避免点了才知道 */
.lgb-copy.off {
  opacity: 0.4;
}
.lgb-del:hover {
  background: #e5484d !important;
  color: #fff;
}

/* 窄列时压缩标记 */
.lgb-grid.compact .lgb-txt {
  width: 8px;
  height: 8px;
  padding: 0;
  font-size: 0;
  border-radius: 99px;
  top: 6px;
  right: 6px;
  line-height: 0;
}
.lgb-grid.compact .lgb-name {
  font-size: 9.5px;
}
.lgb-grid.compact .lgb-meta {
  display: none;
}
.lgb-grid.compact .lgb-acts {
  top: 4px;
  right: 4px;
  padding: 2px;
  gap: 1px;
}
.lgb-grid.compact .lgb-acts > * {
  width: 17px;
  height: 17px;
}
/* 窄列塞不下四个按钮，复制让位（底栏 / 提示词页 / 大图预览仍可复制） */
.lgb-grid.compact .lgb-copy {
  display: none;
}
.lgb-grid.compact .lgb-cap {
  padding: 12px 4px 3px;
}

/* 缩略图读取失败 */
.lgb-item.broken {
  background: var(--lg-sunken);
}
.lgb-item.broken::after {
  content: "无法预览";
  position: absolute;
  inset: 0 0 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lg-text-3);
  font-size: 10px;
  letter-spacing: 0.05em;
  pointer-events: none;
}

/* 空状态 */
.lgb-empty {
  flex: 1 1 100%;
  color: var(--lg-text-3);
  padding: 26px 16px;
  text-align: center;
  line-height: 1.75;
  font-size: 12px;
}
.lgb-empty::before {
  content: "";
  display: block;
  width: 34px;
  height: 26px;
  margin: 0 auto 10px;
  border: 1.5px dashed var(--lg-line-2);
  border-radius: 5px;
  opacity: 0.8;
}

/* ============================================================ 提示词页 */
.lgb-prompts {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lgb-prompt {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 9px;
  background: var(--lg-elev);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  cursor: pointer;
  transition: border-color var(--lg-dur), background var(--lg-dur);
}
/* 选中的提示词：只标记这张卡片，和缩略图的选择互不影响 */
.lgb-prompt.sel {
  border-color: var(--lg-accent);
  background: var(--lg-accent-soft);
}
/* 选中顺序标在文件名后面，序号照常显示 */
.lgb-prompt-head .pick {
  flex: 0 0 auto;
  margin-left: -2px;
  color: var(--lg-accent);
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.lgb-prompt:hover {
  border-color: var(--lg-line-2);
  background: var(--lg-hover);
}
.lgb-prompt.sel:hover {
  border-color: var(--lg-accent);
  background: var(--lg-accent-soft);
}
.lgb-prompt-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
}
.lgb-prompt-head .idx {
  flex: 0 0 auto;
  min-width: 20px;
  color: var(--lg-text-3);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.lgb-prompt-head .nm {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--lg-text-2);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 把「复制 / 删除」推到最右，让 ✓ 紧跟在文件名后面 */
.lgb-prompt-head .grow {
  flex: 1 1 auto;
  min-width: 0;
}
.lgb-prompt-head .cp {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: var(--lg-r-sm);
  border: 1px solid transparent;
  color: var(--lg-text-3);
  font-size: 10.5px;
  cursor: pointer;
  transition: background var(--lg-dur), color var(--lg-dur);
}
.lgb-prompt-head .cp.del:hover,
.lgb-prompt-head .cp.del:focus-visible {
  color: var(--lg-danger);
  background: var(--lg-danger-soft);
}
.lgb-prompt-head .cp:hover {
  color: var(--lg-accent);
  background: var(--lg-accent-soft);
}
/* 孤儿提示词：文件名下面挂一行所在目录 */
.lgb-prompt-dir {
  color: var(--lg-text-3);
  font-family: var(--lg-mono);
  font-size: 10px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lgb-prompt-body {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--lg-text);
  font-size: 11.5px;
  line-height: 1.55;
  max-height: 170px;
  overflow-y: auto;
}
.lgb-prompt-body.empty {
  color: var(--lg-text-3);
  font-style: italic;
}
:is(.lgb-wrap, .lgb-overlay, .lgb-tip) .lgb-link {
  appearance: none;
  border: 0;
  background: none;
  padding: 0;
  color: var(--lg-accent);
  font: inherit;
  font-style: normal;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}
:is(.lgb-wrap, .lgb-overlay, .lgb-tip) .lgb-link:hover {
  color: var(--lg-accent-2);
}

/* ============================================================ 底部状态栏 */
.lgb-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  border-top: 1px solid var(--lg-line);
  /* 面板拖得很窄时按钮放不下，允许横向滚动，别把内容顶出可视区 */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.lgb-foot::-webkit-scrollbar {
  height: 4px;
}
.lgb-selpill {
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 99px;
  background: var(--lg-hover);
  color: var(--lg-text-2);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: background var(--lg-dur), color var(--lg-dur);
}
.lgb-selpill.on {
  background: var(--lg-accent-soft);
  color: var(--lg-accent);
  font-weight: 600;
}
/* 底栏里「反推 / 转换」处于当前页时高亮 */
:is(.lgb-wrap, .lgb-overlay) .lgb-foot .lgb-btn.on {
  background: var(--lg-accent-soft);
  border-color: var(--lg-accent);
  color: var(--lg-accent);
  font-weight: 600;
}
.lgb-status {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--lg-text-3);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lgb-status.err {
  color: var(--lg-danger);
}

/* ============================================================ 悬停浮窗 */
.lgb-tip {
  position: fixed;
  z-index: 100000;
  max-width: 420px;
  padding: 8px 10px;
  border-radius: var(--lg-r-lg);
  background: var(--lg-elev);
  border: 1px solid var(--lg-line-2);
  box-shadow: var(--lg-shadow-2);
  color: var(--lg-text);
  font-family: var(--lg-font);
  font-size: 11.5px;
  line-height: 1.5;
  pointer-events: none;
  display: none;
}
.lgb-tip-head {
  color: var(--lg-text);
  font-weight: 600;
  font-size: 11.5px;
  margin-bottom: 4px;
  word-break: break-all;
}
.lgb-tip-dim {
  color: var(--lg-text-3);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.lgb-tip-prompt {
  color: var(--lg-text-2);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 210px;
  overflow: hidden;
}
.lgb-tip-empty {
  color: var(--lg-text-3);
  font-style: italic;
}
.lgb-tip-path {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid var(--lg-line);
  color: var(--lg-text-3);
  font-family: var(--lg-mono);
  font-size: 10px;
  word-break: break-all;
}

/* ================================================================ 浮层 */
.lgb-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(6, 8, 12, 0.72);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  animation: lgb-fade var(--lg-dur) ease;
}
@keyframes lgb-fade {
  from {
    opacity: 0;
  }
}

/* 大图预览 */
/* 看大图时把背景压得更暗，图更突出 */
.lgb-overlay.viewer {
  background: rgba(4, 6, 10, 0.88);
}
.lgb-viewer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  max-width: 94vw;
  max-height: 94vh;
}
/* 舞台：图片装在里面，缩放/拖动都作用在 img 上，超出部分被舞台裁掉 */
.lgb-viewer .lgb-vstage {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  max-width: 92vw;
  max-height: 78vh;
  border-radius: var(--lg-r-lg);
  background: rgba(255, 255, 255, 0.03);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7);
  touch-action: none;
  user-select: none;
}
.lgb-viewer .lgb-vstage img {
  display: block;
  max-width: 92vw;
  max-height: 78vh;
  border-radius: var(--lg-r-lg);
  transform-origin: center center;
  will-change: transform;
  -webkit-user-drag: none;
}
.lgb-viewer .lgb-vstage.zoomed {
  cursor: grab;
}
.lgb-viewer .lgb-vstage.dragging {
  cursor: grabbing;
}
.lgb-viewer .lgb-viewer-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 99px;
  background: rgba(14, 16, 22, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.lgb-viewer .lgb-vsep {
  width: 1px;
  height: 15px;
  margin: 0 3px;
  background: rgba(255, 255, 255, 0.16);
}
.lgb-viewer .lgb-vbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 99px;
  background: transparent;
  color: #e9eef6;
  cursor: pointer;
  transition: background var(--lg-dur) ease, color var(--lg-dur) ease;
}
.lgb-viewer .lgb-vbtn:hover {
  background: rgba(255, 255, 255, 0.14);
}
.lgb-viewer .lgb-vbtn:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.55);
  outline-offset: 1px;
}
.lgb-viewer .lgb-vbtn:disabled {
  opacity: 0.32;
  cursor: default;
  background: transparent;
}
/* 已收藏：星形填充成金色，和网格里的星标一致 */
.lgb-viewer .lgb-vbtn.on {
  color: #ffcf5c;
}
.lgb-viewer .lgb-vbtn.on .lgb-ico svg {
  fill: currentColor;
}
.lgb-viewer .lgb-vbtn.danger:hover {
  background: rgba(239, 68, 68, 0.24);
  color: #ff9c9c;
}
/* 没有同名提示词时复制按钮变淡，但仍可点（点了会说明原因） */
.lgb-viewer .lgb-vbtn.off {
  opacity: 0.4;
}
.lgb-viewer .zoomlabel {
  min-width: 40px;
  padding: 0 2px;
  text-align: center;
  color: #e9eef6;
  font-family: var(--lg-font);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  border-radius: 99px;
}
.lgb-viewer .zoomlabel:hover {
  background: rgba(255, 255, 255, 0.12);
}
.lgb-viewer .zoomlabel:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.55);
  outline-offset: 1px;
}
.lgb-viewer .count {
  min-width: 52px;
  text-align: center;
  color: #e9eef6;
  font-family: var(--lg-font);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.lgb-viewer .cap {
  padding: 5px 12px;
  border-radius: 99px;
  background: rgba(14, 16, 22, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #e9eef6;
  font-family: var(--lg-font);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

/* ============================================================ 确认对话框 */
.lgb-confirm {
  width: min(520px, 92vw);
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: var(--lg-r-lg);
  background: var(--lg-elev);
  border: 1px solid var(--lg-line-2);
  box-shadow: var(--lg-shadow-2);
  color: var(--lg-text);
  font-family: var(--lg-font);
  font-size: 12px;
}
.lgb-confirm h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--lg-text);
  display: flex;
  align-items: center;
  gap: 7px;
}
.lgb-confirm h3::before {
  content: "";
  width: 3px;
  height: 14px;
  border-radius: 99px;
  background: var(--lg-accent);
  flex: 0 0 auto;
}
.lgb-confirm .body {
  color: var(--lg-text-2);
  font-size: 12px;
  line-height: 1.7;
  max-height: 240px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.lgb-confirm .foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.lgb-recent {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 0 0 auto;
}
.lgb-recent .lgb-btn {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  line-height: var(--lg-ctl-h-sm);
  height: var(--lg-ctl-h-sm);
  font-size: 11px;
}

/* ============================================================ 文件浏览器 */
.lgb-br {
  width: min(900px, 94vw);
  height: min(660px, 90vh);
  display: flex;
  flex-direction: column;
  background: var(--lg-bg);
  border: 1px solid var(--lg-line-2);
  border-radius: var(--lg-r-lg);
  overflow: hidden;
  box-shadow: var(--lg-shadow-2);
  color: var(--lg-text);
  font-family: var(--lg-font);
  font-size: 12px;
}
.lgb-br-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  border-bottom: 1px solid var(--lg-line);
}
.lgb-br-head .title {
  flex: 0 0 auto;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--lg-text);
}
.lgb-br-head .hint {
  flex: 1 1 auto;
  font-size: 11px;
  color: var(--lg-text-3);
}
.lgb-br-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 0;
  flex: 0 0 auto;
}
/* 已加入的路径：从主面板搬过来的那排标签 */
/* 当前路径：只读展示，太长省略，悬停看全文 */
.lgb-br-path {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  background: var(--lg-sunken);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r-sm);
  font-family: var(--lg-mono);
  font-size: 11.5px;
  color: var(--lg-text-2);
}
.lgb-br-path .cap {
  flex: 0 0 auto;
  color: var(--lg-text-3);
  font-family: var(--lg-font);
}
.lgb-br-path .val {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lgb-br-saved {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 8px 12px;
  border-bottom: 1px solid var(--lg-line);
}
.lgb-br-saved .lgb-chip {
  max-width: 420px;
}
.lgb-br-saved::-webkit-scrollbar {
  height: 6px;
}
.lgb-br-saved::-webkit-scrollbar-thumb {
  border-radius: 99px;
  background: var(--lg-line-2);
}
.lgb-br-msg {
  padding: 6px 12px 0;
  flex: 0 0 auto;
  color: var(--lg-danger);
  font-size: 11px;
}
.lgb-br-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  gap: 10px;
  padding: 8px 12px;
}
.lgb-br-col {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.lgb-br-col h4 {
  margin: 0;
  flex: 0 0 auto;
  color: var(--lg-text-3);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.lgb-br-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px;
  background: var(--lg-sunken);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
}
.lgb-filegrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
  gap: 6px;
}
.lgb-fileitem {
  position: relative;
  height: 78px;
  border-radius: var(--lg-r);
  overflow: hidden;
  cursor: pointer;
  background: var(--lg-elev);
  border: 1px solid var(--lg-line);
  transition: border-color var(--lg-dur), box-shadow var(--lg-dur);
}
.lgb-fileitem:hover {
  border-color: var(--lg-line-2);
}
.lgb-fileitem.on {
  border-color: var(--lg-accent);
  box-shadow: 0 0 0 1px var(--lg-accent), 0 0 0 3px var(--lg-accent-soft);
}
.lgb-fileitem img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  pointer-events: none;
}
.lgb-fileitem .tick {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 15px;
  height: 15px;
  border-radius: 99px;
  background: rgba(10, 12, 17, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #fff;
  font-size: 9px;
  line-height: 13px;
  text-align: center;
}
.lgb-fileitem.on .tick {
  background: var(--lg-accent);
  border-color: var(--lg-accent);
  color: var(--lg-on-accent);
  font-weight: 700;
}
.lgb-fileitem .nm {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 8px 3px 2px;
  background: linear-gradient(to top, rgba(6, 8, 12, 0.82), transparent);
  color: #eef2f8;
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lgb-br-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  border-top: 1px solid var(--lg-line);
}
.lgb-br-foot .lgb-count {
  font-size: 11.5px;
  color: var(--lg-text-2);
}

/* ============================================================ 图片反推 */
.lgb-rev {
  width: min(880px, 94vw);
  height: min(740px, 92vh);
  display: flex;
  flex-direction: column;
  background: var(--lg-bg);
  border: 1px solid var(--lg-line-2);
  border-radius: var(--lg-r-lg);
  box-shadow: var(--lg-shadow-2);
  color: var(--lg-text);
  font-family: var(--lg-font);
  font-size: 12px;
  overflow: hidden;
}
/* 反推页里铺满整页，不再是弹窗卡片 */
.lgb-page > .lgb-rev {
  flex: 1 1 auto;
  width: 100%;
  height: auto;
  min-height: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.lgb-rev-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  border-bottom: 1px solid var(--lg-line);
}
.lgb-rev-head h3 {
  margin: 0;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--lg-text);
}
.lgb-rev-head h3::before {
  content: "";
  width: 3px;
  height: 14px;
  border-radius: 99px;
  background: var(--lg-accent);
  flex: 0 0 auto;
}
.lgb-rev-head .hint {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--lg-text-3);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lgb-rev-opts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 12px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  border-bottom: 1px solid var(--lg-line);
}
.lgb-rev-field {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.lgb-rev-field > .lb {
  color: var(--lg-text-3);
  font-size: 11px;
  white-space: nowrap;
}
.lgb-rev select,
.lgb-rev input[type="text"],
.lgb-rev input[type="number"] {
  height: var(--lg-ctl-h);
  padding: 0 6px;
  background: var(--lg-sunken);
  color: var(--lg-text);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  font-family: inherit;
  font-size: 11.5px;
  outline: none;
  transition: border-color var(--lg-dur), box-shadow var(--lg-dur);
}
.lgb-rev select:hover,
.lgb-rev input:hover {
  border-color: var(--lg-line-2);
}
.lgb-rev select:focus,
.lgb-rev input:focus {
  border-color: var(--lg-accent);
  box-shadow: 0 0 0 3px var(--lg-accent-soft);
}
.lgb-rev select:disabled,
.lgb-rev input:disabled {
  opacity: 0.45;
  cursor: default;
}
.lgb-rev select {
  max-width: 210px;
  cursor: pointer;
}
.lgb-rev input[type="number"] {
  width: 58px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.lgb-rev input.prefix {
  width: 96px;
}

.lgb-rev-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 10px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  border-bottom: 1px solid var(--lg-line);
}
.lgb-rev-prog {
  flex: 1 1 auto;
  height: 6px;
  min-width: 60px;
  margin: 0 2px 0 4px;
  border-radius: 99px;
  background: var(--lg-sunken);
  box-shadow: inset 0 0 0 1px var(--lg-line);
  overflow: hidden;
}
.lgb-rev-prog i {
  display: block;
  height: 100%;
  width: 0;
  border-radius: 99px;
  background: var(--lg-accent);
  transition: width 200ms linear;
}
.lgb-rev-status {
  flex: 0 0 auto;
  color: var(--lg-text-2);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lgb-rev-status.err {
  color: var(--lg-danger);
}

.lgb-rev-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lgb-rev-empty {
  margin: auto;
  padding: 26px 16px;
  color: var(--lg-text-3);
  text-align: center;
  line-height: 1.9;
  font-size: 11.5px;
}
.lgb-rev-item {
  display: grid;
  grid-template-columns: 54px 1fr;
  gap: 8px;
  padding: 7px;
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  background: var(--lg-elev);
}
.lgb-rev-item.err {
  border-color: rgba(240, 115, 107, 0.45);
}
.lgb-rev-item .thumb {
  width: 54px;
  height: 54px;
  border-radius: var(--lg-r-sm);
  overflow: hidden;
  background: var(--lg-sunken);
}
.lgb-rev-item .thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.lgb-rev-item .main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lgb-rev-item .row1 {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.lgb-rev-item .nm {
  min-width: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--lg-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lgb-rev-item .meta {
  flex: 0 0 auto;
  color: var(--lg-text-3);
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
}
.lgb-rev-item textarea {
  width: 100%;
  min-height: 48px;
  max-height: 200px;
  resize: vertical;
  padding: 5px 7px;
  background: var(--lg-sunken);
  color: var(--lg-text);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r-sm);
  font-family: var(--lg-mono);
  font-size: 11px;
  line-height: 1.55;
  outline: none;
  transition: border-color var(--lg-dur), box-shadow var(--lg-dur);
}
.lgb-rev-item textarea:hover {
  border-color: var(--lg-line-2);
}
.lgb-rev-item textarea:focus {
  border-color: var(--lg-accent);
  box-shadow: 0 0 0 3px var(--lg-accent-soft);
}
.lgb-rev-item .flags {
  display: inline-flex;
  gap: 4px;
  flex: 0 0 auto;
}
.lgb-rev-item .flag {
  padding: 1px 5px;
  border-radius: 99px;
  background: rgba(243, 194, 95, 0.14);
  border: 1px solid rgba(243, 194, 95, 0.36);
  color: var(--lg-gold);
  font-size: 10px;
  line-height: 1.5;
  white-space: nowrap;
}
.lgb-rev-item .warn {
  color: var(--lg-danger);
  font-size: 10.5px;
  line-height: 1.5;
}

.lgb-rev-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  border-top: 1px solid var(--lg-line);
}
.lgb-rev-foot .msg {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--lg-text-2);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lgb-rev-foot .msg.warn {
  color: var(--lg-danger);
}

/* ============================================================ 回收站 */
.lgb-trash {
  width: min(820px, 94vw);
  height: min(700px, 92vh);
  display: flex;
  flex-direction: column;
  background: var(--lg-bg);
  border: 1px solid var(--lg-line-2);
  border-radius: var(--lg-r-lg);
  box-shadow: var(--lg-shadow-2);
  color: var(--lg-text);
  font-family: var(--lg-font);
  font-size: 12px;
  overflow: hidden;
}
.lgb-trash-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  border-bottom: 1px solid var(--lg-line);
}
.lgb-trash-head h3 {
  margin: 0;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--lg-text);
}
.lgb-trash-head h3::before {
  content: "";
  width: 3px;
  height: 14px;
  border-radius: 99px;
  background: var(--lg-gold);
  flex: 0 0 auto;
}
.lgb-trash-head .hint {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--lg-text-3);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lgb-trash-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lgb-tbatch {
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  background: var(--lg-elev);
  overflow: hidden;
  flex: 0 0 auto;
}
.lgb-tbatch-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  cursor: pointer;
  background: var(--lg-sunken);
}
.lgb-tbatch-head:hover {
  background: var(--lg-hover);
}
.lgb-tbatch-head .chev {
  flex: 0 0 auto;
  width: 12px;
  color: var(--lg-text-3);
  font-size: 10px;
}
.lgb-tbatch-head .when {
  flex: 0 0 auto;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--lg-text);
  font-variant-numeric: tabular-nums;
}
.lgb-tbatch-head .cnt {
  flex: 0 0 auto;
  color: var(--lg-text-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.lgb-titems {
  display: flex;
  flex-direction: column;
}
.lgb-titem {
  display: grid;
  grid-template-columns: 34px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border-top: 1px solid var(--lg-line);
}
.lgb-titem .thumb {
  width: 34px;
  height: 34px;
  border-radius: var(--lg-r-sm);
  background: var(--lg-sunken);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.lgb-titem .thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.lgb-titem .thumb .tag {
  font-size: 9px;
  letter-spacing: 0.4px;
  color: var(--lg-text-3);
}
.lgb-titem .info {
  min-width: 0;
}
.lgb-titem .nm {
  font-size: 11.5px;
  color: var(--lg-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lgb-titem .nm .sub {
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 99px;
  background: rgba(243, 194, 95, 0.14);
  color: var(--lg-gold);
  font-size: 9.5px;
}
.lgb-titem .dir {
  font-family: var(--lg-mono);
  font-size: 10px;
  color: var(--lg-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.lgb-truncated {
  padding: 6px 10px;
  border-top: 1px solid var(--lg-line);
  color: var(--lg-text-3);
  font-size: 10.5px;
}
.lgb-trash-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  flex: 0 0 auto;
  background: var(--lg-elev);
  border-top: 1px solid var(--lg-line);
}
.lgb-trash-foot .msg {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--lg-text-2);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lgb-trash-foot .msg.warn {
  color: var(--lg-danger);
}

/* ============================================================ 设置面板 */
.lgb-settings {
  width: min(540px, 94vw);
  gap: 14px;
  padding: 14px 16px 16px;
}
.lgb-settings .lgb-set-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lgb-settings .lgb-set-body {
  display: flex;
  flex-direction: column;
  gap: 15px;
  max-height: min(66vh, 520px);
  overflow-y: auto;
}
.lgb-settings .lgb-set-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lgb-settings .lgb-set-sec + .lgb-set-sec {
  padding-top: 14px;
  border-top: 1px solid var(--lg-line);
}
.lgb-settings .lgb-set-sec .ttl {
  color: var(--lg-text-2);
  font-size: 11px;
  font-weight: 600;
}
.lgb-settings .lgb-set-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.lgb-settings .lgb-set-row .lb {
  color: var(--lg-text-3);
  font-size: 11px;
  min-width: 52px;
}
/* 运行参数那几行：标签留够宽度，数字框收窄靠右，单位跟在后面 */
.lgb-settings .lgb-set-row .lb.wide {
  min-width: 86px;
}
.lgb-settings .lgb-set-input.num {
  flex: 0 0 84px;
  width: 84px;
  padding: 0 6px;
  text-align: right;
}
.lgb-settings .unit {
  color: var(--lg-text-3);
  font-size: 11px;
}
.lgb-settings textarea.lgb-set-input {
  flex: 1 1 100%;
  height: auto;
  min-height: 64px;
  padding: 6px 8px;
  line-height: 1.65;
  resize: vertical;
}
.lgb-settings .desc {
  margin: 0;
  color: var(--lg-text-3);
  font-size: 11px;
  line-height: 1.65;
}
.lgb-settings select {
  flex: 1 1 200px;
  min-width: 0;
  height: var(--lg-ctl-h);
  padding: 0 6px;
  background: var(--lg-sunken);
  color: var(--lg-text);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  font-family: inherit;
  font-size: 11.5px;
  outline: none;
  cursor: pointer;
}
.lgb-settings select:hover {
  border-color: var(--lg-line-2);
}
.lgb-settings select:focus {
  border-color: var(--lg-accent);
  box-shadow: 0 0 0 3px var(--lg-accent-soft);
}
.lgb-settings select:disabled {
  opacity: 0.45;
  cursor: default;
}
/* 设置里的输入框 / 行内提示 */.lgb-settings .lgb-set-input,
.lgb-pick .lgb-set-input {
  flex: 1 1 240px;
  min-width: 0;
  height: var(--lg-ctl-h);
  padding: 0 8px;
  background: var(--lg-sunken);
  color: var(--lg-text);
  border: 1px solid var(--lg-line);
  border-radius: var(--lg-r);
  font-family: var(--lg-mono);
  font-size: 11px;
  outline: none;
  transition: border-color var(--lg-dur), box-shadow var(--lg-dur);
}
.lgb-settings .lgb-set-input:focus,
.lgb-pick .lgb-set-input:focus {
  border-color: var(--lg-accent);
  box-shadow: 0 0 0 3px var(--lg-accent-soft);
}
.lgb-settings .lgb-set-msg,
.lgb-pick .lgb-set-msg {
  color: var(--lg-text-3);
  font-size: 11px;
  line-height: 1.5;
}
.lgb-settings .lgb-set-msg.err,
.lgb-pick .lgb-set-msg.err {
  color: var(--lg-danger);
}
/* 只选目录的弹窗 */
.lgb-pick {
  width: min(540px, 94vw);
  gap: 10px;
  padding: 14px 16px 16px;
}
.lgb-pick .lgb-pick-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: min(46vh, 340px);
  overflow-y: auto;
  padding: 4px;
  border-radius: var(--lg-r);
  background: var(--lg-sunken);
  border: 1px solid var(--lg-line);
}
.lgb-pick .lgb-pick-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--lg-text);
  font-family: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.lgb-pick .lgb-pick-item:hover {
  background: var(--lg-hover);
}
.lgb-pick .lgb-pick-empty {
  padding: 12px;
  color: var(--lg-text-3);
  font-size: 11px;
  text-align: center;
}

/* 主题三选一 */
.lgb-settings .lgb-seg {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--lg-sunken);
  border: 1px solid var(--lg-line);
}
.lgb-settings .lgb-seg-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--lg-text-2);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: background var(--lg-dur), color var(--lg-dur);
}
.lgb-settings .lgb-seg-btn:hover {
  background: var(--lg-hover);
  color: var(--lg-text);
}
.lgb-settings .lgb-seg-btn.on {
  background: var(--lg-accent-soft);
  color: var(--lg-accent);
  font-weight: 500;
}

/* ============================================================ 转换 / 压缩（页面） */
.lgb-conv-page {
  display: flex;
  flex-direction: column;
  width: auto;
  max-width: none;
  padding: 0;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
}
.lgb-conv-page .lgb-conv-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.lgb-conv-page .lgb-conv-head h3 {
  margin: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--lg-text);
  flex: 0 0 auto;
}
.lgb-conv-page .lgb-conv-head .hint {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--lg-text-3);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 参数区自己滚动，进度区固定在下面 */
.lgb-conv-page .lgb-set-body {
  max-height: none;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}
.lgb-conv-page .lgb-conv-run {
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--lg-line);
  flex: 0 0 auto;
}
.lgb-conv-page .lgb-conv-run .ttl {
  margin-bottom: 2px;
}
/* 质量滑块在有标签的行里要撑开，别用缩略图密度那个 84px */
.lgb-conv-page .lgb-slider {
  flex: 1 1 auto;
  width: auto;
  min-width: 120px;
}
/* 单位（px / KB / % / 张）给个固定宽度，滑块动的时候数值不跳 */
.lgb-conv-page .lgb-set-row .unit {
  min-width: 26px;
  text-align: right;
}
.lgb-conv-page .lgb-conv-bar {
  height: 6px;
  border-radius: 99px;
  background: var(--lg-sunken);
  border: 1px solid var(--lg-line);
  overflow: hidden;
}
.lgb-conv-page .lgb-conv-bar > i {
  display: block;
  height: 100%;
  width: 0;
  background: var(--lg-accent);
  border-radius: 99px;
  transition: width 160ms linear;
}
.lgb-conv-page .lgb-conv-now {
  font-family: var(--lg-mono);
  font-size: 10.5px;
  color: var(--lg-text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lgb-settings .desc.warnline {
  color: var(--lg-danger);
}
.lgb-settings .desc.warnline:empty {
  display: none;
}
.lgb-conv-page .lgb-conv-msg {
  white-space: pre-line;
  min-height: 14px;
}
.lgb-conv-page .lgb-conv-msg.warn {
  color: var(--lg-danger);
}

/* ============================================================ 无障碍 */
@media (prefers-reduced-motion: reduce) {
  .lgb-wrap *,
  .lgb-overlay * {
    transition-duration: 1ms !important;
    animation-duration: 1ms !important;
  }
}
`;

function ensureStyle() {
  const old = document.getElementById("lgb-style");
  if (old) old.remove();
  const style = document.createElement("style");
  style.id = "lgb-style";
  style.textContent = CSS;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------- HTTP 适配 */
const PAGE_ROOT = (() => {
  let path = window.location.pathname || "/";
  if (!path.endsWith("/")) path = path.slice(0, path.lastIndexOf("/") + 1);
  return path.replace(/\/+$/, "");
})();

const PREFIX_CANDIDATES = [`${PAGE_ROOT}/api`, PAGE_ROOT];
let resolvedPrefix = null;

async function apiFetch(path, options = {}) {
  const prefixes = resolvedPrefix === null ? PREFIX_CANDIDATES : [resolvedPrefix];
  let lastResponse = null;
  for (const prefix of prefixes) {
    let response;
    try {
      response = await fetch(prefix + path, options);
    } catch (err) {
      continue;
    }
    if (response.status !== 404) {
      resolvedPrefix = prefix;
      return response;
    }
    lastResponse = response;
  }
  if (lastResponse) return lastResponse;
  throw new Error("无法连接 ComfyUI 服务");
}

async function apiJson(path, options) {
  const response = await apiFetch(path, options);
  let data = null;
  try {
    data = await response.json();
  } catch (err) {
    // 431/414 是请求本身太长（收藏太多时路径撑爆 URL），说清楚让人知道怎么办
    if ([413, 414, 431].includes(response.status)) {
      throw new Error(t("请求太长（HTTP {code}）：路径太多，请分批浏览", { code: response.status }));
    }
    throw new Error(t("接口返回异常（HTTP {code}）", { code: response.status }));
  }
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

function buildUrl(path, params = {}) {
  const prefix = resolvedPrefix === null ? `${PAGE_ROOT}/api` : resolvedPrefix;
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${prefix}${path}${query ? `?${query}` : ""}`;
}

/* ------------------------------------------------------------------ 多语言 */
const LANG_KEY = "localGalleryBrowser.lang";

/* 中 -> 英。键就是中文原文，查不到就原样输出（中文兜底，不会出现空字符串） */
const I18N_EN = {
  // 顶栏 / 页签
  "图库": "Gallery",
  "收藏": "Favorites",
  "提示词": "Prompts",
  "无匹配提示词": "Orphans",
  "反推": "Caption",
  "转换": "Convert",
  "收藏的图片": "Favorited images",
  "查看当前列表的提示词": "Show prompts of the current list",
  "把选中的图片反推成提示词，可写回同名 .txt": "Caption selected images, write back to .txt",
  "批量转格式 / 压体积 / 缩放": "Batch convert / compress / resize",
  "图库里带同名提示词的图片": "Images in Gallery that have a prompt file",
  "有提示词文件、但同目录没有同名图片，缩略图网格里显示不出来": "Prompt files with no matching image in the same folder",
  "每行显示几张（列数）": "Columns per row",
  "浏览缩略图": "Browse thumbnails",
  "查看被删除的图片和提示词，可随时恢复": "View deleted images and prompts, restorable anytime",
  "选择文件夹或单张图片加入路径列表": "Add folders or images to the path list",
  "重新扫描路径列表": "Rescan the path list",
  "设置：明暗主题、图片反推、收藏导出": "Settings: theme, captioning, favorites export",
  "浏览本机路径": "Browse local paths",
  "面板内浏览": "In-panel browser",
  "扫描": "Scan",
  "连路径下的子文件夹一起扫描": "Also scan subfolders under each path",
  "只列出有同名 .txt 提示词的图片": "Only list images that have a matching .txt prompt",
  "打开面板内浏览": "Open in-panel browser",
  "下钻目录、加单张图片、管理已加入的路径": "Browse folders, add single images, manage added paths",
  "「选择文件夹」弹 Windows 自带的选择框（可多选），选完直接加进路径列表；「面板内浏览」可以看某个目录里的图片、只加单张、管理已加入的路径。": "Choose folder opens the native Windows picker (multi-select) and adds the result to the path list; the in-panel browser lets you look at one folder, add single images and manage added paths.",
  "选择文件夹…": "Choose folder…",
  "选择文件夹": "Choose folder",
  "弹 Windows 自带的文件夹选择框（按住 Ctrl 可多选），选完加入路径列表": "Opens the native Windows folder picker (hold Ctrl for several); picked folders join the path list",
  "只把同名提示词文件移到回收站，图片保留（可随时恢复）": "Move only prompt files to trash, keep images (restorable)",
  "图片 + 同名提示词一起移到回收站（可随时恢复）": "Move image + prompt file to trash together (restorable)",
  "每行": "Cols",
  "张": "images",
  "最近：": "Recent:",
  "返回": "Back",

  // 筛选 / 搜索 / 状态
  "含子目录": "Include subfolders",
  "仅有提示词": "Only with prompt",
  "导出收藏 ({n})": "Export favorites ({n})",
  "语言已切换：{name}": "Language switched to {name}",
  "已选 {n}": "{n} selected",
  "已接上上次的路径": "Resumed last paths",
  "{resumed}{multi}已读到 {n} 张图，悬停看提示词": "{resumed}{multi}{n} images loaded, hover to preview prompts",
  "{resumed}{multi}已读到 {n} 张图，悬停看提示词 · {o} 个提示词匹配不到图片": "{resumed}{multi}{n} images loaded · {o} prompt files have no matching image",
  "{n} 个路径 · ": "{n} paths · ",
  "已移到回收站 {n} 个{moved}": "{n} moved to trash{moved}",
  "{n} 个失败": "{n} failed",
  "已移走 {n} 个提示词文件（图片保留）": "{n} prompt files moved (images kept)",
  "已收藏：{name}": "Favorited: {name}",
  "已取消收藏：{name}": "Unfavorited: {name}",
  "已复制到剪贴板": "Copied to clipboard",
  "已复制这条提示词": "Prompt copied",
  "已复制 {n} 条提示词": "{n} prompts copied",
  "已复制 {n} 条无匹配提示词": "{n} orphan prompts copied",
  "已复制 {n} 条反推结果": "{n} captions copied",
  "这些路径下没有图片": "No images under these paths",
  "选中的 {n} 张": "{n} selected",
  "当前列表 {n} 张": "{n} in list",
  "当前列表 {all} 张 · 已选 {sel} 张 · 原图默认保留": "{all} in list · {sel} selected · originals kept",
  "当前列表没有图片 —— 先在图库加一个文件夹": "No images in the list — add a folder in Gallery first",
  "成功 {ok} 张": "{ok} converted",
  "失败 {n} 张": "{n} failed",
  "省 {pct}%": "{pct}% smaller",
  "大了 {pct}%": "{pct}% bigger",
  "耗时 {sec}s": "{sec}s",
  "失败原因：{list}": "Errors: {list}",
  "输出到：{dir}": "Output to: {dir}",
  "输出位置：{where}": "Output: {where}",
  "转换完成：成功 {ok} 张": "Conversion finished: {ok} converted",
  "转换完成：成功 {ok} 张，失败 {f} 张": "Conversion finished: {ok} converted, {f} failed",
  "正在处理：{name}": "Processing: {name}",
  "删除选中 ({n})": "Delete selected ({n})",
  "删提示词 ({n})": "Delete prompts ({n})",
  "只移走 {n} 个同名提示词文件，图片保留（可随时恢复）": "Move {n} prompt files to trash, keep images (restorable)",
  "{n} 条提示词": "{n} prompts",
  "没有匹配不上的提示词": "No orphan prompts",
  "这些提示词文件同目录下找不到同名图片，缩略图网格里没有可挂载的位置": "These prompt files have no matching image in the same folder",
  "每个提示词文件都能对上同名图片": "Every prompt file has a matching image",
  "已选 {n} 张": "{n} selected",
  "已选 {n} 条提示词": "{n} prompts selected",
  "点击选中这条提示词（只输出提示词，不输出图片）": "Click to select this prompt (prompt only, no image)",
  "已选中：只输出提示词，不输出图片": "Selected: outputs the prompt only, no image",
  "已清空提示词的选择": "Prompt selection cleared",
  "共 {n} 张": "{n} images",
  "已读到 {n} 张图，悬停看提示词": "{n} images loaded, hover to preview prompts",
  "已读到 {n} 张图": "{n} images loaded",
  "{n} 个提示词匹配不到图片": "{n} prompt files have no matching image",
  "无匹配提示词 {n}": "Orphans {n}",
  "提示词 {n}": "Prompts {n}",
  "收藏 {n}": "Favorites {n}",
  "反推 {n}": "Caption {n}",
  "转换 {n}": "Convert {n}",
  "完成 · 成功 {ok} 张": "Done · {ok} converted",
  "已取消 · 成功 {ok} 张": "Cancelled · {ok} converted",
  "失败 {f} 张": "{f} failed",
  "收藏：{n} 张": "Favorites: {n}",
  "{n} 个提示词没有匹配到同名图片": "{n} prompt files have no matching image",
  "没有匹配不上的提示词（每个提示词文件都能对上同名图片）": "No orphan prompts (every prompt file has a matching image)",
  "带同名提示词的图片：{n} 张": "{n} images have a prompt file",
  "当前列表没有带提示词的图片": "No images with prompts in this list",
  "提示词页（固定跟随图库）：{n} 条": "Prompts (always from Gallery): {n} entries",
  "提示词页（固定跟随图库）：{n} 条，另有 {o} 个无匹配提示词": "Prompts (always from Gallery): {n} entries, plus {o} orphan prompts",
  "提示词页，另有 {o} 个无匹配提示词": "Prompts, plus {o} orphan prompts",
  "提示词页": "Prompts",
  "反推页：已选 {n} 张": "Caption: {n} selected",
  "反推页：先在图库选中图片": "Caption: select images in Gallery first",
  "转换压缩：已选 {n} 张": "Convert: {n} selected",
  "转换压缩：当前列表 {n} 张": "Convert: {n} in the list",
  "转换压缩：当前列表没有图片": "Convert: no images in the list",
  "模型": "Model",
  "TIPO 模型": "TIPO model",
  "阈值": "Threshold",
  "角色阈值": "Character threshold",
  "输出": "Output",
  "写入": "Write",
  "前缀": "Prefix",
  "跳过": "Skip",
  "覆盖（备份 .bak）": "Overwrite (backup .bak)",
  "覆盖": "Overwrite",
  "自动加序号": "Auto-number",
  "图片反推": "Image captioning",
  "读取进度失败：{err}": "Failed to read progress: {err}",
  "反推失败：{err}": "Captioning failed: {err}",
  "已停止 · 完成 {n} 张": "Stopped · {n} done",
  "完成 {n} 张 · 用时 {s}s": "{n} done · {s}s",
  "这些路径下没有图片。到「设置 → 浏览本机路径」勾上「含子目录」，或换一个路径。": "No images under these paths. Tick “Include subfolders” in Settings → Browse local paths, or try another path.",
  "已加入输出目录：{dir}": "Output folder added: {dir}",
  "转换任务还在跑，等它结束或先点「取消任务」": "A conversion is still running — wait or cancel it first",
  "先选一个输出文件夹": "Pick an output folder first",
  "没有可处理的图片": "Nothing to process",
  "界面语言": "Language",
  "文字说明": "Descriptions",
  "显示附加说明": "Show descriptions",
  "关掉后隐藏设置和转换页里每项下面的解释文字，界面更紧凑": "Hide the explanatory text under each option in Settings and Convert to keep the panel compact",
  "已显示各项说明": "Descriptions shown",
  "已隐藏各项说明": "Descriptions hidden",
  "当前生效：{path}": "In effect: {path}",
  "删除的图片和提示词都进这里，不是永久删除。": "Deleted images and prompts go here — nothing is permanently deleted.",
  "已加入 {n} 个路径": "{n} paths added",
  "多选图片加入，或把整个文件夹加进来": "Tick images to add, or add the whole folder",
  "当前：": "Current:",
  "还没选目录": "No folder selected yet",
  "收藏模式 · {n} 张（悬停看提示词，⤢ 看大图，☆ 取消收藏）": "Favorites · {n} images (hover for prompts, ⤢ to preview, ☆ to unfavorite)",
  "{a} / {b} 张{done}": "{a} / {b} images{done}",
  "读取中": "loading",
  "（读取失败）": "(read failed)",
  "图片数量超过扫描上限，已截断": "Image count exceeded the scan limit — truncated",
  "{n} 个路径读取失败（红色标签）": "{n} paths failed to read (red chips)",
  "这些提示词文件同目录下没有同名图片：": "These prompt files have no matching image in the same folder:",
  "扫描失败：{err}": "Scan failed: {err}",
  "正在扫描路径…": "Scanning paths…",
  "正在扫描 {n} 个路径…": "Scanning {n} paths…",
  "读取失败：{err}": "Read failed: {err}",
  "读取失败": "Read failed",
  "无法预览": "Cannot preview",
  "无法连接 ComfyUI 服务": "Cannot reach the ComfyUI server",
  "未知错误": "Unknown error",
  "接口返回异常（HTTP {code}）": "Unexpected response (HTTP {code})",
  "请求太长（HTTP {code}）：路径太多，请分批浏览": "Request too large (HTTP {code}): too many paths in one go — browse in smaller batches",
  "打开「设置 → 浏览本机路径」加一个文件夹开始": "Open Settings → Browse local paths to add a folder",
  "还没有图片 —— 打开「设置 → 浏览本机路径」加一个文件夹。": "No images yet — open Settings → Browse local paths to add a folder.",
  "筛出 {a} / {b} 张": "{a} / {b} images",
  "提示词命中 {a} / {b} 张（有提示词 {c} 张）": "{a} / {b} matched ({c} with prompts)",
  "提示词搜索失败：{err}": "Prompt search failed: {err}",
  "正在搜提示词…（{n} 张）": "Searching prompts… ({n} images)",
  "收藏失败：{err}": "Failed to favorite: {err}",
  "读取收藏失败：{err}": "Failed to load favorites: {err}",
  "还没有收藏 —— 在图库里点缩略图左上角的 ☆ 收藏": "No favorites yet — click ☆ on a thumbnail",
  "未分类": "Unfiled",
  "所有收藏（{name}）": "All favorites",
  "还没归类的收藏": "Favorites not in any folder",
  "收藏夹「{name}」（右键可删除）": "Folder \"{name}\" (right-click to delete)",
  "＋ 新建收藏夹": "+ New folder",
  "新建一个收藏夹": "Create a favorite folder",
  "新建收藏夹": "New folder",
  "收藏夹名字，例如：风景 / 精选 / 待修": "Folder name, e.g. landscape / picks / to-fix",
  "新建": "Create",
  "删除收藏夹": "Delete folder",
  "删除收藏夹「{name}」？": "Delete folder \"{name}\"?",
  "只删除这个分类，里面的图片仍然留在收藏里（不会取消收藏）。": "Only the category is removed — the images stay favorited.",
  "已新建收藏夹：{name}": "Folder created: {name}",
  "新建收藏夹失败：{err}": "Could not create folder: {err}",
  "已删除收藏夹：{name}": "Folder deleted: {name}",
  "读取收藏夹失败：{err}": "Could not load folders: {err}",
  "加入收藏夹": "Add to folder",
  "收藏到哪个收藏夹？": "Which folder?",
  "不分类，直接收藏": "Just favorite (no folder)",
  "把「{name}」收藏起来，顺便选个分类；不选就是未分类。": "Favorite \"{name}\" — pick a folder, or skip it to keep it unfiled.",
  "已收藏到「{name}」": "Favorited into \"{name}\"",
  "没有可以撤销的删除": "Nothing to undo",
  "已撤销删除：恢复 {n} 个文件": "Undone — restored {n} file(s)",
  "（{n} 个失败）": " ({n} failed)",
  " · 还能再撤 {n} 次": " · {n} more undo available",
  "撤销失败：{err}": "Undo failed: {err}",
  "没有可以撤销的操作": "Nothing to undo",
  "已撤销取消收藏：恢复 {n} 张": "Undo — {n} image(s) favorited again",
  "已撤销收藏：{n} 张已取消收藏": "Undo — {n} image(s) unfavorited again",
  "已撤销收藏：{n} 张已移出收藏夹": "Undo — {n} image(s) removed from the folder",
  "已撤销收藏：{n} 张": "Undo — {n} favorite change(s) reverted",
  " · 收藏也回来了": " · favorites restored",
  "导出范围": "Scope",
  "导出哪些收藏：全部 / 未分类 / 某一个收藏夹": "Which favorites to export: all / unfiled / one folder",
  "全部收藏（{n} 张）": "All favorites ({n})",
  "未分类（{n} 张）": "Unfiled ({n})",
  "{name}（{n} 张）": "{name} ({n})",
  "这个范围里没有图片": "Nothing in this scope",
  "把这一范围里的收藏图片和同名提示词复制过去": "Copy the favorited images in this scope and their prompts",
  "把收藏的图片和同名提示词「复制」到这个文件夹，原文件不动；同名文件默认跳过，不覆盖。导出范围可以只选某一个收藏夹。": "Copies favorited images and their prompts into this folder — originals untouched, existing files skipped (never overwritten). The scope can be a single favorite folder.",
  "加入收藏夹 ({n})": "Add to folder ({n})",
  "把选中的图片放进收藏夹（可以顺手新建一个）": "Put the selected images into a favorite folder (create one on the spot)",
  "先选中图片再放进收藏夹": "Select some images first",
  "把选中的 {n} 张图片放进哪个收藏夹？（没收藏的会自动收藏）": "Which folder should take the {n} selected image(s)? Images not yet favorited are favorited automatically.",
  "还没有收藏夹，点下面「＋ 新建收藏夹」建一个": "No folders yet — use \"+ New folder\" below",
  "已把 {n} 张放进「{name}」": "Added {n} image(s) to \"{name}\"",
  "放入收藏夹失败：{err}": "Could not add to folder: {err}",
  "这个收藏夹里还没有图片": "This folder has no images yet",
  "图库里没有带提示词的图片": "No images with prompts in Gallery",
  "还没有图片 —— 打开「设置 → 浏览本机路径」加一个文件夹": "No images yet — open Settings → Browse local paths to add a folder",
  "已复制 {n} 条提示词到剪贴板": "{n} prompts copied to clipboard",
  "当前没有可复制的提示词": "Nothing to copy",
  "没有可复制的内容": "Nothing to copy",
  "已清空选择": "Selection cleared",
  "剪贴板不可用，提示词已打到控制台": "Clipboard unavailable — prompts printed to console",
  "剪贴板不可用，请从控制台手动复制": "Clipboard unavailable — copy from the console",
  "设置里关掉了删除（allow_delete = false）—— 想删东西先去设置打开": "Deleting is disabled (allow_delete = false) — turn it on in Settings",
  "历史记录已清空": "History cleared",
  "路径列表已更新": "Path list updated",
  "文件过多，只显示了一部分（用「加入此文件夹」整目录添加更合适）": "Too many files — showing a subset (adding the whole folder is better)",
  "先在左侧选一个盘符或文件夹": "Pick a drive or folder on the left",
  "先点选右侧的图片": "Pick images on the right",
  "选一个盘符开始": "Pick a drive to start",
  "先进入一个文件夹": "Open a folder first",
  "取消选择": "Clear selection",
  "图片（{n}）": "Images ({n})",
  "文件夹（{n}）": "Folders ({n})",
  "按文件名 / 路径过滤 —— 点一下切换": "Filter by file name / path — click to cycle",
  "按提示词内容搜索 —— 点一下切换": "Search prompt text — click to cycle",
  "名称或提示词命中 —— 点一下切换": "Match name or prompt — click to cycle",
  "仅标签（快）": "Tags only (fast)",
  "TIPO 扩写标签": "TIPO expanded tags",
  "TIPO 标签 + 描述": "TIPO tags + description",
  "已有 .txt 就跳过": "Skip if .txt exists",
  "追加到末尾": "Append to end",
  "下划线换空格": "Underscore to space",
  "TIPO 扩写用的 gguf 模型": "GGUF model used by TIPO",
  "TIPO 不可用：{tip}": "TIPO unavailable: {tip}",
  "TIPO 不可用，只能用 WD14 标签": "TIPO unavailable — WD14 tags only",
  "反推不可用": "Captioning unavailable",
  "没有可用的打标模型：需要 ComfyUI-WD14-Tagger 的 models 目录里有 .onnx + .csv": "No tagging model: put .onnx + .csv into ComfyUI-WD14-Tagger/models",
  "还没有选中图片 —— 回图库点几张，再回到这里": "No images selected — pick some in Gallery first",
  "先在图库里选中图片，这里会列出它们": "Select images in Gallery and they show up here",
  "重新反推": "Re-caption",
  "正在停止…": "Stopping…",
  "请先在图库里选图": "Pick images in Gallery first",
  "正在反推，先停止再刷新": "Captioning is running — stop it before refreshing",
  "接着上次的进度…": "Resuming previous run…",
  "覆盖写入 .txt": "Overwrite .txt",
  "写入中…": "Writing…",
  "还没有内容可写入": "Nothing to write yet",
  "读取反推配置失败：{err}": "Failed to load captioning config: {err}",
  "停止失败：{err}": "Failed to stop: {err}",
  "启动失败：{err}": "Failed to start: {err}",
  "写入失败：{err}": "Write failed: {err}",
  "图片反推完成 {n} 张": "Captioning finished: {n} images",
  "{n} 个标签": "{n} tags",
  "选中 {n} 张 · 结果写到同名 .txt": "{n} selected · results go to matching .txt",
  "{n} 张 · {mode} · 写到同名 .txt": "{n} images · {mode} · written to matching .txt",
  "WD14 标签": "WD14 tags",
  "TIPO 扩写": "TIPO expansion",
  "转换中…": "Converting…",
  "保持原格式": "Keep original format",
  "不缩放": "No resize",
  "按长边": "By long edge",
  "按百分比": "By percentage",
  "{n} 的倍数": "Multiple of {n}",
  "保持原格式 = 只压缩不动格式；其它格式互转。JPG/BMP 会去掉透明通道并垫白底，GIF 会转 256 色。": "Keep original format = compress only. JPG/BMP drop transparency onto white; GIF is reduced to 256 colors.",
  "按质量：滑块直接决定画质（JPG/WEBP 生效，PNG 换算成压缩级别）。按体积：自动二分查找能塞进目标体积的最高画质。": "By quality: the slider sets quality (JPG/WEBP; PNG maps to a compression level). By size: binary-search the highest quality that fits.",
  "同目录新文件：换格式用新扩展名，同格式压缩加 _c 后缀，原图保留。覆盖原文件 = 原地重写（格式变了会删掉旧文件），不可恢复。": "New file in the same folder: new extension when converting, _c suffix when only compressing; originals kept. Overwrite = rewrite in place (old file removed if the extension changes) — not recoverable.",
  "覆盖原文件 + 换格式：旧文件会被删掉、换成新扩展名，回收站里找不回来。": "Overwrite + convert: the old file is deleted and replaced with a new extension — not recoverable from Trash.",
  "覆盖原文件会直接改写原图（不可撤销），建议先用「同目录 · 新文件」试一批。": "Overwrite rewrites the originals (no undo) — try “Same folder · new file” first.",
  "已请求取消，正在收尾…": "Cancel requested — finishing up…",
  "取消失败：{err}": "Cancel failed: {err}",
  "{n} 张被 allowed_roots 拦下": "{n} blocked by allowed_roots",
  "正在转换 {n} 张…": "Converting {n} images…",
  "条": "rows",
  "把收藏的图片和同名提示词复制过去": "Copies favorite images and their prompts",
  "先设置目标文件夹": "Set a target folder first",
  "还没有收藏的图片": "No favorite images yet",
  "导出中…": "Exporting…",
  "导出失败：{err}": "Export failed: {err}",
  "收藏已导出到 {dest}": "Favorites exported to {dest}",
  "保存中…": "Saving…",
  "保存失败：{err}": "Save failed: {err}",
  "已写入 config.json": "Saved to config.json",
  "已写入 config.json（缩略图尺寸在下一次重新扫描后生效）": "Saved to config.json (thumbnail size applies after the next rescan)",
  "已填回默认值，记得点「保存运行参数」": "Defaults restored — click Save settings to apply",
  "运行参数已保存": "Settings saved",
  "目录已填，但保存失败（重启后可能丢失）": "Folder filled in, but saving failed (may be lost after restart)",
  "留空 = 不限制。填了以后，浏览 / 扫描 / 删除只认这些目录（含子目录）里的文件；填错会导致路径全部失效，所以保存前请确认目录真实存在。": "Empty = no restriction. Otherwise browse / scan / delete only work inside these folders (and their subfolders). Wrong paths break everything, so double-check before saving.",
  "确定": "OK",
  "处理中…": "Working…",
  "删除 {n} 个文件？": "Delete {n} files?",
  "删除 {n} 个提示词？": "Delete {n} prompts?",
  "删除提示词（{n}）": "Delete prompts ({n})",
  "移到回收站（{n}）": "Move to trash ({n})",
  "这些文件会被【移到回收站】（不是永久删除），连同同名提示词文件一起移走。": "These files move to the Trash (not permanently deleted), together with their prompt files.",
  "删完按 Ctrl+Z 就能撤销（也可以到回收站里手动移回）。": "Press Ctrl+Z to undo (or restore them from the Trash).",
  "只把同名提示词文件（.txt / .caption / .json…）移到回收站，图片不会被删除。": "Only the prompt files (.txt / .caption / .json…) move to the Trash; images are kept.",
  "需要时可以随时从「回收站」恢复（图库页路径栏进入）。": "Restore them from Trash anytime (Trash button on the gallery tab).",
  "没有文件被移动": "No files moved",
  "没有文件被移走": "Nothing was moved",
  "永久删除": "Delete permanently",
  "全部永久删除": "Delete all permanently",
  "空": "empty",
  "清空回收站（{n} 个文件）？": "Empty trash ({n} files)?",
  "回收站里的所有图片和提示词都会被彻底删除，无法恢复。\n\n只想删某一批，请用批次右侧的「清空」。": "Everything in the Trash is permanently deleted — no recovery.\n\nTo clear one batch only, use Purge next to that batch.",
  "这一批会从回收站里彻底删除，无法恢复。\n\n批次：": "This batch is permanently deleted — no recovery.\n\nBatch: ",
  "永久删除这一批（{n} 个文件）？": "Permanently delete this batch ({n} files)?",
  "这一批还有 {n} 个未显示，用「恢复本批」一起恢复": "{n} more in this batch are hidden — “Restore batch” restores them all",
  "已从回收站恢复 {n} 个文件": "{n} files restored from trash",
  "已恢复 {n} 个{failed}": "{n} restored{failed}",
  "已永久删除 {n} 个文件": "{n} files permanently deleted",
  "恢复失败：{err}": "Restore failed: {err}",
  "还没有历史记录。在「设置」里浏览过文件夹之后就会出现在这里。": "No history yet. Folders you browse from Settings show up here.",
  "点一个文件夹就加入路径列表并扫描：": "Click a folder to add it to the path list and scan:",
  "{n} 张图片 · {p} 个提示词": "{n} images · {p} prompts",
  "{n} 个文件 · {root}": "{n} files · {root}",
  "全部永久删除这批": "Delete this batch permanently",
  "例如 D:\\AI\\exports\\favorites": "e.g. D:\\AI\\exports\\favorites",
  "例如 D:\\AI\\output\\compressed": "e.g. D:\\AI\\output\\compressed",
  "收藏这张": "Favorite",
  "取消收藏": "Unfavorite",
  "取消收藏 ({n})": "Unfavorite ({n})",
  "已取消收藏 {n} 张": "Removed {n} image(s) from favorites",
  "取消收藏失败：{err}": "Could not unfavorite: {err}",
  "把选中的图从收藏里移除（想加回来再点 ☆ 就行）": "Remove the selected images from favorites (click ☆ to add them back)",
  "… 等 {n} 个文件": "… and {n} more files",
  "… 等 {n} 个": "… and {n} more",
  "，{n} 个失败": ", {n} failed",
  "反推中…": "Captioning…",
  "已复制 {name}": "Copied {name}",
  " · {n} 个提示词匹配不到图片": " · {n} prompt files have no matching image",
  "已读到 {n} 张图，悬停看提示词{o}": "{n} images loaded, hover to preview prompts{o}",
  "写入 {n} 个 .txt": "Wrote {n} .txt files",
  " · 跳过 {n} 个已有": " · skipped {n} existing",
  " · 失败 {n}": " · {n} failed",
  "已复制 {n} 张": "{n} copied",
  " · 跳过 {n}": " · skipped {n}",
  "+{n} 提示词": "+{n} prompts",
  "已加入 {n} 张图片": "{n} images added",
  "已加入：{path}": "Added: {path}",
  "这个文件夹已经在列表里了": "That folder is already in the list",
  " · {n} 个失败": " · {n} failed",
  "全部": "All",
  "选中的 0 张": "0 selected",
  "当前列表 0 张": "0 in list",
  "失败：{err}": "Failed: {err}",
  "正在读取 {n} 条无匹配提示词…": "Reading {n} orphan prompts…",
  "读取无匹配提示词失败：{err}": "Failed to read orphan prompts: {err}",
  "当前缩放比例，点一下复位": "Current zoom — click to reset",
  "失败 {n}": "{n} failed",
  "名称": "Name",
  "按文件名 / 路径过滤": "Filter by file name / path",
  "按提示词内容搜索": "Search prompt text",
  "名称或提示词命中": "Match name or prompt",
  "搜提示词内容，全部包含才命中": "Search prompt text; all keywords must match",
  "名称或提示词，命中任意一个即可": "Name or prompt; any keyword matches",
  "浏览": "Browse",
  "用 Windows 系统的文件夹选择框加入文件夹（可多选）": "Add folders with the Windows folder picker (multi-select)",
  "面板内浏览：加单张图片、管理已加入的路径": "In-panel browser: add single images and manage paths",
  "正在打开系统文件夹选择框…": "Opening the system folder picker…",
  "选择框已弹出，请在窗口里选文件夹（按住 Ctrl 可多选）": "The picker is open — choose a folder in that window (hold Ctrl to pick several)",
  "选择框已经打开了，请到弹出的窗口里选文件夹（按住 Ctrl 可多选）": "The picker is already open — pick a folder in that window (hold Ctrl for several)",
  "等了 3 分钟没结果：选择框可能被其它窗口挡住了，点任务栏找一下，或再点一次「浏览」": "No result after 3 minutes — the picker may be hidden behind another window. Look for it in the taskbar, or click Browse again",
  "系统选择框打不开（{err}）：到「设置 → 浏览本机路径」再试一次，或用那里的面板内浏览": "The system picker failed ({err}) — try again from Settings → Browse local paths, or use the in-panel browser there",
  "没有选择文件夹": "No folder selected",
  "已加入 {n} 个文件夹": "Added {n} folder(s)",
  "系统选择框打不开（{err}），改用面板内浏览": "The system picker failed ({err}); switching to the in-panel browser",
  "系统文件夹选择框只支持 Windows，请用面板内浏览": "The system folder picker only works on Windows — use the in-panel browser",
  "选择": "Choose",
  "按文件名过滤（空格分隔多个关键词）": "Filter by file name (space separated)",
  "按文件名过滤，空格分隔多个关键词": "Filter by file name (space separated)",
  "搜索范围：名称 → 提示词 → 全部（点一下切一个）": "Search scope: name → prompt → all (click to cycle)",
  "排序：默认 → 文件名 ↑ → 文件名 ↓ → 时间（新→旧） → 时间（旧→新）": "Sort: default → name ↑ → name ↓ → newest first → oldest first",
  "默认": "Default",
  "排序依据": "Sort by",
  "方向": "Direction",
  "时间": "Time",
  "扫描顺序": "Scan order",
  "顺序": "Ascending",
  "倒序": "Descending",
  "按文件名排序": "Sort by file name",
  "按文件修改时间排序": "Sort by modified time",
  "回到扫描时的原始顺序": "Back to the original scan order",
  "从小到大 / 从旧到新": "A→Z / oldest first",
  "从大到小 / 从新到旧": "Z→A / newest first",
  "排序：点开选「名称 / 时间」和「顺序 / 倒序」": "Sort: pick name/time and ascending/descending",
  "时间分组": "Group by day",
  "网格": "Grid",
  "列表": "List",
  "当前：网格（点一下切成列表）": "Grid view (click for the list view)",
  "当前：列表（点一下切回网格）": "List view (click back to the grid)",
  "网格：瀑布流缩略图": "Grid: waterfall thumbnails",
  "列表：一行一张，带文件名和提示词标签": "List: one image per row with name and prompt tags",
  "没有提示词": "No prompt",
  "{n} 张": "{n} items",
  "今天": "Today",
  "昨天": "Yesterday",
  "前天": "Two days ago",
  "未知时间": "Unknown time",
  "点一下折叠 / 展开这一天": "Click to collapse / expand this day",
  "这些图读不到修改时间": "No modified time available for these images",
  "按文件修改时间分组：一天一坨，点组标题可折叠": "Group by modified time: one block per day, click a header to collapse",
  "已按修改时间分组：点组标题可折叠，再点这里关掉分组": "Grouped by modified time: click a header to collapse, click here to turn grouping off",
  "扫描顺序（目录里的原始顺序）": "Scan order (as found on disk)",
  "文件名从小到大（数字按数值比，2 在 10 前面）": "File name A→Z (numbers by value: 2 before 10)",
  "文件名从大到小": "File name Z→A",
  "名称 ↑": "Name ↑",
  "名称 ↓": "Name ↓",
  "时间 ↓": "Time ↓",
  "时间 ↑": "Time ↑",
  "排序：扫描顺序（点一下切一个）": "Sort: scan order (click to cycle)",
  "按文件名从小到大（数字按数值比，2 在 10 前面）": "File name A→Z (numbers by value: 2 before 10)",
  "按文件名从大到小": "File name Z→A",
  "按修改时间，从新到旧": "Modified time, newest first",
  "按修改时间，从旧到新": "Modified time, oldest first",
  "悬停缩略图可预览提示词": "Hover a thumbnail to preview its prompt",
  "已选 0": "0 selected",
  "已选 0 张": "0 selected",
  "全选": "Select all",
  "反选": "Invert",
  "清空选择": "Clear selection",
  "单选": "Single",
  "多选": "Multi",
  "单选：点一下只保留这一张，再点同一张取消选中": "Single: a click keeps only that image, clicking it again deselects",
  "多选：点一下加选、再点取消，Shift 连选": "Multi: click to add, click again to remove, Shift for a range",
  "选择模式：单选 / 多选（点另一侧就滑过去）": "Selection mode: single / multi (click the other side and the knob slides over)",
  "复制提示词": "Copy prompts",
  "复制这张的提示词": "Copy this image's prompt",
  "这张没有同名提示词": "No prompt file for this image",
  "这张没有同名提示词，无法复制": "No prompt file for this image — nothing to copy",
  "这张的提示词是空的，没有可复制的内容": "This image's prompt is empty",
  "已复制这张的提示词": "Prompt copied",
  "删提示词": "Delete prompts",
  "删除选中": "Delete selected",
  "点开选择：图片 + 提示词一起删 / 只删提示词 / 只删图片": "Open the menu: images + prompts / prompts only / images only",
  "删除全部（图片 + 提示词）": "Delete both (image + prompt)",
  "把选中的图片连同同名提示词一起移到回收站": "Move the images and their prompts to the Trash",
  "删除提示词（{n} 个）": "Delete prompts ({n})",
  "删除提示词（没有同名提示词）": "Delete prompts (none found)",
  "只移走同名提示词文件，图片保留": "Move only the prompt files, keep the images",
  "删除图片（提示词保留）": "Delete images (keep prompts)",
  "只移走图片，同名提示词文件留在原地": "Move only the images, leave the prompt files in place",
  "只把图片移到回收站（不是永久删除），同名提示词文件留在原地。": "Only the images move to the Trash (not a permanent delete); prompt files stay where they are.",
  "删除 {n} 张图片？": "Delete {n} image(s)?",
  "删除图片（{n}）": "Delete images ({n})",
  "把当前列表里的图全部选中": "Select every image in the current list",
  "把当前列表里的图全部选中（单选模式下会自动切到多选）": "Select every image in the current list (switches to multi-select automatically)",
  "已切到多选并全选": "Switched to multi-select and selected all",
  "取消全部选中": "Clear the selection",

  // 空状态 / 提示
  "这个文件夹里没有图片": "No images in this folder",
  "这个目录下没有子文件夹": "No subfolders here",
  "没有子文件夹": "No subfolders",
  "读取中…": "Loading…",
  "读取提示词…": "Loading prompt…",
  "重试": "Retry",
  "（这张图没有提示词）": "(no prompt for this image)",
  "（此图未找到同名提示词）": "(no matching prompt file)",
  "读取回收站失败": "Failed to read trash",
  "回收站是空的 —— 删除的图片和提示词会先放在这里，可随时恢复": "Trash is empty — deleted images and prompts land here and can be restored.",
  "删除的图片和提示词会先放在这里，随时可以恢复": "Deleted images and prompts land here first, restore them anytime.",

  // 缩略图卡片
  "有同名提示词文件": "Has a prompt file",
  "没有同名提示词文件": "No prompt file",
  "大图预览": "Preview",
  "只列带提示词的图片；没有同名提示词文件的不显示": "Only images that have a prompt file",
  "只删除提示词文件，图片保留（可在回收站恢复）": "Delete only the prompt file, keep the image (restorable)",
  "删除（移到回收站，可恢复）": "Delete (move to trash, restorable)",
  "移除此路径": "Remove this path",

  // 大图预览
  "上一张（←）": "Previous (←)",
  "下一张（→）": "Next (→)",
  "收藏这张（F）": "Favorite (F)",
  "取消收藏（F）": "Unfavorite (F)",
  "删除（移到回收站）": "Delete (move to trash)",
  "缩小（-）": "Zoom out (-)",
  "放大（+ / 滚轮 / 双击）": "Zoom in (+ / wheel / double-click)",
  "适应窗口（0）": "Fit to window (0)",
  "点一下回到适应窗口（0）": "Click to fit to window (0)",

  // 设置
  "设置": "Settings",
  "外观": "Appearance",
  "主题": "Theme",
  "语言 / Language": "Language / 语言",
  "跟随 ComfyUI": "Follow ComfyUI",
  "浅色": "Light",
  "深色": "Dark",
  "「跟随 ComfyUI」会随 ComfyUI 的深浅色自动切换；另外两个是强制。": "\u201cFollow ComfyUI\u201d tracks ComfyUI's light/dark theme; the other two force a theme.",
  "运行参数（写进 config.json）": "Runtime settings (config.json)",
  "缩略图尺寸": "Thumbnail size",
  "缩略图质量": "Thumbnail quality",
  "扫描上限": "Scan limit",
  "单图最大边": "Max image side",
  "最近浏览": "Recent folders",
  "回收站目录": "Trash folder",
  "允许删除（移到回收站）": "Allow deleting (move to trash)",
  "空选兜底": "Auto-pick when empty",
  "启用": "Enable",
  "缩略图尺寸 = 网格缩略图的长边像素（越大越清晰，磁盘缓存也越大）；质量 40–95，数值越高质量越好、体积越大。扫描上限 = 一次最多读多少个文件，超出会截断；单图最大边 = 超过这个尺寸的图在节点执行时跳过（省显存），不影响预览。": "Thumbnail size = long edge in px (larger is sharper, more disk cache). Quality 40–95. Scan limit = max files per scan. Max image side = images larger than this are skipped when the node runs (saves VRAM); preview is unaffected.",
  "保存运行参数": "Save settings",
  "恢复默认值": "Restore defaults",
  "高级": "Advanced",
  "允许访问的根目录": "Allowed roots",
  "每行一个绝对路径，留空 = 允许本机任意路径": "One absolute path per line; empty = allow any path",
  "留空 = 节点目录下的 .trash": "Empty = .trash under the node folder",
  "选择回收站目录": "Choose trash folder",
  "目标文件夹": "Target folder",
  "选择导出目标文件夹": "Choose export target folder",
  "把收藏的图片和同名提示词「复制」到这个文件夹，原文件不动；同名文件默认跳过，不覆盖。": "Copies favorite images and their prompts into this folder; originals untouched, existing files skipped.",
  "关闭": "Close",
  "关闭（Esc / 点外面也行）": "Close (Esc also works)",
  "关闭设置（Esc / 点外面也行）": "Close settings (Esc also works)",
  "取消": "Cancel",

  // 浏览本机路径
  "可多选图片，也可整目录加入": "Multi-select images, or add the whole folder",
  "跳转": "Go",
  "转到": "Go",
  "↑ 上一级": "↑ Up",
  "上一级": "Up",
  "直接填路径，回车跳转": "Type a path and press Enter",
  "粘贴路径后点「跳转」": "Paste a path, then click Go",
  "＋ 加入此文件夹": "＋ Add this folder",
  "添加选中图片": "Add selected",
  "文件夹": "Folders",
  "图片": "Images",
  "清空路径": "Clear paths",
  "把路径列表清空（不影响磁盘文件）": "Clear the path list (files untouched)",
  "已加入": "Added",

  // 提示词页
  "复制": "Copy",
  "复制全部": "Copy all",
  "复制这一条": "Copy this entry",
  "复制这条提示词": "Copy this prompt",
  "删除": "Delete",
  "把输出文件夹加入路径": "Add output folder to paths",
  "没有匹配不上的提示词 —— 这个目录里每个提示词文件都有同名图片": "No orphan prompts — every prompt file here has a matching image",
  "把这个提示词文件移到回收站（本来就没有对应图片）": "Move this prompt file to trash (it has no image)",

  // 转换页
  "转换 / 压缩": "Convert / Compress",
  "范围": "Scope",
  "处理": "Apply to",
  "格式": "Format",
  "目标格式": "Target format",
  "压缩": "Compression",
  "方式": "Mode",
  "按质量": "By quality",
  "按体积": "By size",
  "质量": "Quality",
  "目标体积": "Target size",
  "压不进去时允许降分辨率": "Downscale if it still doesn't fit",
  "缩放": "Resize",
  "数值": "Value",
  "尺寸对齐": "Size alignment",
  "不对齐": "No alignment",
  "尺寸对齐会把宽高向下取整到指定倍数（训练集常用 8/16/32），不对齐则保持原比例。": "Size alignment rounds width/height down to a multiple (8/16/32 for training sets); \u201cNo alignment\u201d keeps the exact ratio.",
  "位置": "Location",
  "输出到": "Output to",
  "同目录 · 新文件": "Same folder · new file",
  "指定文件夹": "Chosen folder",
  "覆盖原文件": "Overwrite original",
  "连同名提示词一起复制": "Copy prompt files too",
  "开始转换": "Start converting",
  "取消任务": "Cancel job",
  "进度": "Progress",
  "完成": "Done",
  "已取消": "Cancelled",
  "正在启动…": "Starting…",

  // 反推页
  "开始反推": "Start captioning",
  "停止": "Stop",
  "刷新列表": "Refresh list",
  "按当前选中的图片重新加载": "Reload from current selection",
  "写入 .txt": "Write .txt",
  "已有 txt": "has txt",
  "这张图已经有同名提示词文件，写入方式选「跳过」就不会动它": "This image already has a prompt file; \u201cSkip\u201d leaves it alone",

  // 回收站
  "回收站": "Trash",
  "恢复": "Restore",
  "恢复本批": "Restore batch",
  "清空": "Purge",
  "清空回收站": "Empty trash",
  "清空历史": "Clear history",
  "最近浏览的文件夹": "Recent folders",
  "恢复图片时会连同这张图的提示词一起恢复": "Restoring an image also restores its prompt",

  // 选择文件夹
  "选这个文件夹": "Use this folder",
  "如 @wanet": "e.g. @wanet",
  "（没有识别到内容，可以手动填）": "(nothing parsed — fill it in manually)",
};

let lang = "zh";
try {
  if (localStorage.getItem(LANG_KEY) === "en") lang = "en";
} catch (err) {
  /* 隐私模式下 localStorage 可能不可用，按中文走 */
}

/* 设置面板里那颗语言分段控件建好后把同步函数挂这儿，切语言时刷新选中态 */
let langSegSync = null;

/* ---------------- 附加说明开关 ----------------
   关掉后只藏解释性段落（.lgb-settings .desc），警告和结果摘要照常显示。 */
const HINTS_KEY = "localGalleryBrowser.showHints";
let showHints = true;
try {
  if (localStorage.getItem(HINTS_KEY) === "0") showHints = false;
} catch (err) {
  /* 忽略 */
}

function applyHints(persist = false) {
  // 设置浮层挂在 body 上、转换页在节点里，用 html 上的类统一控制
  document.documentElement.classList.toggle("lgb-no-hints", !showHints);
  if (persist) {
    try {
      localStorage.setItem(HINTS_KEY, showHints ? "1" : "0");
    } catch (err) {
      /* 忽略 */
    }
  }
}

/* 取词：查不到就用原文（中文），保证不会出现空字符串 */
function t(text, vars) {
  let out = text;
  if (lang === "en" && typeof text === "string") {
    const hit = I18N_EN[text];
    if (typeof hit === "string") out = hit;
  }
  if (vars && typeof out === "string") {
    Object.keys(vars).forEach((key) => {
      out = out.split(`{${key}}`).join(String(vars[key]));
    });
  }
  return out;
}

/* title / placeholder 用这两个设置，切语言时能一起刷 */
function setTitle(node, text) {
  if (!node) return node;
  node.dataset.i18nTitle = text;
  node.title = t(text);
  return node;
}

function setPh(node, text) {
  if (!node) return node;
  node.dataset.i18nPh = text;
  node.placeholder = t(text);
  return node;
}

/* 带变量的正文文案：模板和变量一起存，切语言时按新语言重拼 */
function setTpl(node, text, vars) {
  if (!node) return node;
  node.dataset.i18nTpl = text;
  node.dataset.i18nVars = JSON.stringify(vars || {});
  const span = document.createElement("span");
  span.textContent = t(text, vars);
  node.replaceChildren(span);
  return node;
}

/* 建一个带变量文案的元素 */
function elTpl(tag, className, text, vars) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return setTpl(node, text, vars);
}

/* <option>：value 保持内部值，只翻显示文字（可带变量） */
function mkOption(value, text, vars) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.dataset.i18n = text;
  opt.dataset.i18nVars = JSON.stringify(vars || {});
  opt.textContent = t(text, vars);
  return opt;
}

/* 带变量的 title：把模板和变量都存下来，切语言时按变量重新拼 */
function setTitleT(node, text, vars) {
  if (!node) return node;
  node.dataset.i18nTitle = text;
  node.dataset.i18nTitleVars = JSON.stringify(vars || {});
  node.title = t(text, vars);
  return node;
}

/* 只负责刷 DOM 上的静态文案；动态文案由各自的渲染函数重画 */
function applyLangNodes(root = document) {
  // <option> 里不能塞 span，单独按原文重设
  root.querySelectorAll("option[data-i18n]").forEach((node) => {
    let vars = {};
    try {
      vars = JSON.parse(node.dataset.i18nVars || "{}");
    } catch (err) {
      vars = {};
    }
    node.textContent = t(node.dataset.i18n, vars);
  });
  // 带变量的文案（模板 + 变量）
  root.querySelectorAll("[data-i18n-tpl]").forEach((node) => {
    let vars = {};
    try {
      vars = JSON.parse(node.dataset.i18nVars || "{}");
    } catch (err) {
      vars = {};
    }
    const span = document.createElement("span");
    span.textContent = t(node.dataset.i18nTpl, vars);
    node.replaceChildren(span);
  });
  root.querySelectorAll("[data-i18n]").forEach((node) => {
    if (node.tagName === "OPTION") return;
    const key = node.dataset.i18n;
    const prev = node.dataset.i18nOut ?? "";
    if (node.textContent !== prev) return; // 已被动态改写过，交给重渲染
    const out = t(key);
    node.replaceChildren(el("span", "", out));
    node.dataset.i18nOut = out;
  });
  root.querySelectorAll("[data-i18n-title]").forEach((node) => {
    let vars = null;
    if (node.dataset.i18nTitleVars) {
      try {
        vars = JSON.parse(node.dataset.i18nTitleVars);
      } catch (err) {
        vars = null;
      }
    }
    node.title = t(node.dataset.i18nTitle, vars);
  });
  root.querySelectorAll("[data-i18n-status]").forEach((node) => {
    let vars = null;
    if (node.dataset.i18nStatusVars) {
      try {
        vars = JSON.parse(node.dataset.i18nStatusVars);
      } catch (err) {
        vars = null;
      }
    }
    node.replaceChildren(el("span", "", t(node.dataset.i18nStatus, vars)));
  });
  root.querySelectorAll("[data-i18n-ph]").forEach((node) => {
    node.placeholder = t(node.dataset.i18nPh);
  });
}

/* ------------------------------------------------------------------ 工具 */
const CJK_RE = /[\u4e00-\u9fff]/;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) {
    const str = String(text);
    node.textContent = t(str);
    // 只有中文文案才挂 data-i18n：数字、纯英文、空串不必参与切语言重刷
    if (CJK_RE.test(str)) {
      node.dataset.i18n = str;
      node.dataset.i18nOut = node.textContent;
    }
  }
  return node;
}

/* 只有一个文字的容器（createTextNode 没法挂 data-i18n，用 span 包一层） */
function tspan(text) {
  return el("span", "", text);
}

/* 给已有节点换文字：内部用一个 span 承载，翻译插件就不会把这串英文再翻回中文 */
function setLabel(node, text) {
  if (!node) return node;
  node.replaceChildren(el("span", "", text));
  return node;
}

/* 内联矢量图标：比 emoji 在不同系统上更稳定，也能跟随文字颜色 */
const ICON_PATHS = {
  folder:
    '<path d="M1.8 4.7A1.7 1.7 0 0 1 3.5 3h2.4l1.3 1.7h5.3A1.7 1.7 0 0 1 14.2 6.4v5.1a1.7 1.7 0 0 1-1.7 1.7H3.5a1.7 1.7 0 0 1-1.7-1.7z"/>',
  clock: '<circle cx="8" cy="8" r="5.6"/><path d="M8 5.1V8l2 1.3"/>',
  refresh: '<path d="M13.2 8a5.2 5.2 0 1 1-1.7-3.9"/><path d="M13.4 2.5v2.8h-2.8"/>',
  trash:
    '<path d="M2.9 4.6h10.2"/><path d="M6.3 4.6V3.3h3.4v1.3"/><path d="M4.5 4.6l.55 8.1a1.2 1.2 0 0 0 1.2 1.1h3.5a1.2 1.2 0 0 0 1.2-1.1l.55-8.1"/>',
  expand:
    '<path d="M9.5 2.7h3.8v3.8"/><path d="M13.3 2.7L9.1 6.9"/><path d="M6.5 13.3H2.7V9.5"/><path d="M2.7 13.3l4.2-4.2"/>',
  plus: '<path d="M8 3.5v9"/><path d="M3.5 8h9"/>',
  recycle:
    '<path d="M2.9 8a5.1 5.1 0 1 0 1.6-3.7"/><path d="M2.6 2.7v3h3"/><path d="M8 5.7v2.5l1.7 1"/>',
  gear:
    '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.6v1.7M8 12.7v1.7M1.6 8h1.7M12.7 8h1.7M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2"/>',
  auto: '<circle cx="8" cy="8" r="5.8"/><path d="M8 2.2a5.8 5.8 0 0 0 0 11.6z" fill="currentColor" stroke="none"/>',
  up: '<path d="M8 12.6V3.6"/><path d="M3.9 7.7L8 3.6l4.1 4.1"/>',
  prev: '<path d="M9.9 3.4L5.1 8l4.8 4.6"/>',
  next: '<path d="M6.1 3.4L10.9 8l-4.8 4.6"/>',
  star: '<path d="M8 2.4l1.75 3.56 3.9.57-2.82 2.76.66 3.9L8 11.35l-3.49 1.84.66-3.9L2.35 6.53l3.9-.57z"/>',
  copy:
    '<rect x="5.6" y="5.6" width="7.8" height="7.8" rx="1.4"/><path d="M10.4 5.6V4.2A1.4 1.4 0 0 0 9 2.8H4.2A1.4 1.4 0 0 0 2.8 4.2V9a1.4 1.4 0 0 0 1.4 1.4h1.4"/>',
  convert:
    '<path d="M2.6 5.9h10.8"/><path d="M10.4 3l3 2.9-3 2.9"/><path d="M13.4 10.1H2.6"/><path d="M5.6 7.2l-3 2.9 3 2.9"/>',
  zoomIn:
    '<circle cx="7.1" cy="7.1" r="4.1"/><path d="M10.2 10.2l3.3 3.3"/><path d="M7.1 5.3v3.6M5.3 7.1h3.6"/>',
  zoomOut: '<circle cx="7.1" cy="7.1" r="4.1"/><path d="M10.2 10.2l3.3 3.3"/><path d="M5.3 7.1h3.6"/>',
  fit: '<path d="M2.8 5.9V2.8h3.1"/><path d="M13.2 5.9V2.8H10.1"/><path d="M2.8 10.1v3.1h3.1"/><path d="M13.2 10.1v3.1H10.1"/>',
  save: '<path d="M3.2 2.8h7.3l2.3 2.3v8.1H3.2z"/><path d="M5.6 2.8v3.1h4.2V2.8"/><path d="M5.4 9.1h5.2"/>',
  text: '<path d="M3 3.8h10"/><path d="M3 7.4h10"/><path d="M3 11h6.2"/>',
  sun: '<circle cx="8" cy="8" r="2.9"/><path d="M8 1.7v1.5M8 12.8v1.5M1.7 8h1.5M12.8 8h1.5M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1"/>',
  moon: '<path d="M12.8 9.6A5.3 5.3 0 0 1 6.4 3.2a5.3 5.3 0 1 0 6.4 6.4z"/>',
};

function icon(name, size = 14) {
  const span = el("span", "lgb-ico");
  span.innerHTML =
    `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${ICON_PATHS[name] || ""}</svg>`;
  return span;
}

/* ------------------------------------------------------------- 明暗主题 */
// 模块级：所有 LocalGallery 节点共用一份偏好，改一个就都变
let themePref = "auto";
try {
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (["auto", "light", "dark"].includes(savedTheme)) themePref = savedTheme;
} catch (err) {
  /* 忽略 */
}

// 每个节点把自己的 applyTheme 注册进来，切主题时统一重刷
const themeAppliers = new Set();

function setThemePref(pref) {
  themePref = ["auto", "light", "dark"].includes(pref) ? pref : "auto";
  try {
    localStorage.setItem(THEME_KEY, themePref);
  } catch (err) {
    /* 忽略 */
  }
  themeAppliers.forEach((apply) => {
    try {
      apply({ force: true });
    } catch (err) {
      /* 单个节点出错不影响其它节点 */
    }
  });
}

function parseDarkColor(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  let r;
  let g;
  let b;
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    r = parseInt(text[1] + text[1], 16);
    g = parseInt(text[2] + text[2], 16);
    b = parseInt(text[3] + text[3], 16);
  } else if (/^#[0-9a-f]{6}$/i.test(text)) {
    r = parseInt(text.slice(1, 3), 16);
    g = parseInt(text.slice(3, 5), 16);
    b = parseInt(text.slice(5, 7), 16);
  } else if (/^rgba?\(/i.test(text)) {
    const parts = (text.match(/[\d.]+/g) || []).map(Number);
    if (parts.length < 3) return null;
    [r, g, b] = parts;
  } else {
    return null;
  }
  if ([r, g, b].some((n) => !Number.isFinite(n))) return null;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

function isDarkTheme() {
  if (themePref === "dark") return true;
  if (themePref === "light") return false;
  // ComfyUI 新版前端用 .dark-theme 标记深色主题（darkModeSelector）
  if (document.querySelector(".dark-theme")) return true;
  for (const scope of [document.body, document.documentElement]) {
    if (!scope) continue;
    let raw = "";
    try {
      raw = getComputedStyle(scope).getPropertyValue("--bg-color");
    } catch (err) {
      raw = "";
    }
    const dark = parseDarkColor(raw);
    if (dark !== null) return dark;
  }
  return true;
}

function fmtSize(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)}${units[i]}`;
}

function splitPaths(raw) {
  // 去重键：分隔符统一 + 去掉末尾斜杠 + 忽略大小写，
  // 免得 D:/a/b 和 D://a//b 被当成两个不同路径
  const key = (value) =>
    value
      .toLowerCase()
      .replace(/[\\/]+/g, "/")
      .replace(/\/+$/, "");
  return String(raw || "")
    .split(/[\r\n;|]+/)
    .map((s) => s.trim().replace(/^["']+|["']+$/g, "").trim())
    .filter(Boolean)
    .filter((v, i, arr) => arr.findIndex((x) => key(x) === key(v)) === i);
}

/* --------------------------------------------------------------- 扩展本体 */
app.registerExtension({
  name: "Comfy.LocalGalleryBrowser",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    ensureStyle();

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      onNodeCreated?.apply(this, arguments);

      const node = this;
      node.setSize([790, 780]);

      /* ---------------- 接口 widget ---------------- */
      function addHiddenWidget(name, defaultValue) {
        const widget = node.addWidget("text", name, defaultValue, () => {}, { serialize: true });
        if (!widget) return null;
        widget.computeSize = () => [0, -4];
        widget.draw = () => {};
        widget.type = "hidden";
        try {
          Object.defineProperty(widget, "hidden", { value: true, writable: true });
        } catch (err) {
          /* 忽略 */
        }
        return widget;
      }

      // folder_path 是可见必填项：藏起来，改由面板里的路径列表编辑
      const pathWidget = node.widgets?.find((w) => w.name === "folder_path");
      if (pathWidget) {
        pathWidget.computeSize = () => [0, -4];
        pathWidget.draw = () => {};
        try {
          Object.defineProperty(pathWidget, "hidden", { value: true, writable: true });
        } catch (err) {
          /* 忽略 */
        }
      }
      const selectionWidget = addHiddenWidget("selection_data", JSON.stringify({ items: [] }));
      const extraWidget = addHiddenWidget("extra_paths", "[]");

      // 旧工作流里节点还带一个 prompt_source 下拉，widgets_values 多一格，
      // 会让隐藏参数整体错位。加载时把那格丢掉，并把后面的值搬回来。
      const LEGACY_MODES = ["仅同名文件", "同名文件优先", "仅图片内嵌"];
      function repairLegacyValues() {
        const raw = node.widgets_values;
        if (!Array.isArray(raw) || !raw.length) return;
        const idx = raw.findIndex((v) => LEGACY_MODES.includes(String(v ?? "").trim()));
        if (idx < 1) return;
        raw.splice(idx, 1);
        const sel = raw[idx];
        const extra = raw[idx + 1];
        if (selectionWidget && typeof sel === "string" && sel.trim().startsWith("{")) {
          selectionWidget.value = sel;
        }
        if (extraWidget && typeof extra === "string") extraWidget.value = extra;
        app.graph.setDirtyCanvas(true, true);
      }
      repairLegacyValues();

      // 老版本 nodes.py 里有个 optional.bypass_images（IMAGE 占位槽，run() 根本不用），
      // 服务端已经删了；但浏览器缓存的老节点定义、或老工作流里存的 inputs 还会把它画出来。
      // 这里在节点创建/加载时扫一遍，把这颗多余的输入点拆掉（有连线先断开再删）。
      function stripBypassInputs() {
        if (!Array.isArray(node.inputs)) return;
        const stale = node.inputs.filter((input) => input?.name === "bypass_images");
        for (const input of stale) {
          const index = node.inputs.indexOf(input);
          if (index < 0) continue;
          if (input.link != null && typeof node.disconnectInput === "function") {
            try {
              node.disconnectInput(index);
            } catch (err) {
              /* 忽略：断不开也照样删槽 */
            }
          }
          const at = node.inputs.indexOf(input);
          if (at >= 0) node.inputs.splice(at, 1);
        }
        const widgets = node.widgets || [];
        const filtered = widgets.filter((widget) => widget?.name !== "bypass_images");
        if (filtered.length !== widgets.length) node.widgets = filtered;
        if (stale.length) app.graph.setDirtyCanvas(true, true);
      }

      stripBypassInputs();
      const originalConfigure = node.onConfigure;
      node.onConfigure = function (info) {
        originalConfigure?.apply(this, arguments);
        repairLegacyValues();
        stripBypassInputs();
      };
      setTimeout(() => {
        repairLegacyValues();
        stripBypassInputs();
      }, 0);

      /* ---------------- 状态 ---------------- */
      const state = {
        items: [],
        // 图库页最近一次渲染出来的列表：提示词页固定用它，
        // 这样切到收藏页时提示词页不会跟着变成收藏的图
        galleryVisible: [],
        selected: new Map(),
        // 提示词页的选中项（path -> 顺序）：只出提示词、不出图，和图片选择互不影响
        promptSel: new Map(),
        promptLast: -1,
        // 单选 / 多选：单选时每次只保留一张（点同一张可取消）
        pickMode: readPickMode(),
        promptCache: new Map(),
        // 提示词页当前是哪一档（prompts / orphans）：paintSelection 要据此换计数口径
        promptMode: "prompts",
        // 当前页签：filenames 输出跟着它走（图库页给图片名，提示词页给提示词名）
        tab: "gallery",
        rendered: 0,
        columns: [],
        filter: "",
        busy: false,
        seq: 0,
        lastClicked: -1,
        invalid: [],
        favorites: new Map(),
        // 收藏夹：folders = [{id,name,count}]；favFolder = all | none | 收藏夹 id
        folders: [],
        favFolder: "all",
        favUnclassified: 0,
        source: "paths",
        searchMode: "name",
        // 排序：default / name-asc / name-desc / time-desc / time-asc
        sortMode: "default",
        // 视图：grid 瀑布流 / list 列表
        view: "grid",
        // 图库页按天分组（时间线）：tl 是渲染游标，collapsedDays 记住折叠了哪几天
        timeGroup: false,
        tl: null,
        collapsedDays: new Set(),
        promptHits: null,
        searchSeq: 0,
        // 本次是从 localStorage 接上的路径（用一次就清，避免以后每次刷新都提示）
        restoredFromStore: false,
        // 有提示词文件但没有同名图片的「孤儿提示词」，用于解释 327 个 txt 只显示 300 条
        orphanPrompts: 0,
        orphanSamples: [],
        orphanItems: [],
        orphanCount: 0,
        orphanLoaded: false,
        orphanSeq: 0,
      };

      /* UI 设置：服务端持久化（换浏览器也在），目前只存收藏导出目录 */
      const uiSettings = { favorites_export_dir: "" };

      /* 运行参数：对应节点目录的 config.json，设置面板可改 */
      const CONFIG_DEFAULTS = {
        allowed_roots: [],
        thumb_size: 320,
        thumb_quality: 82,
        max_scan_files: 20000,
        max_image_side: 8192,
        trash_dir: "",
        allow_delete: true,
        recent_limit: 12,
        auto_select_when_empty: { enabled: false, limit: 4, recursive: false },
      };
      const cfg = JSON.parse(JSON.stringify(CONFIG_DEFAULTS));
      cfg.trash_dir_effective = "";
      cfg.node_dir = "";

      async function loadConfig() {
        try {
          const data = await apiJson("/local_gallery/config");
          const remote = data?.config;
          if (!remote) return;
          const auto = remote.auto_select_when_empty || {};
          Object.assign(cfg, remote);
          cfg.auto_select_when_empty = {
            enabled: !!auto.enabled,
            limit: Number(auto.limit) || CONFIG_DEFAULTS.auto_select_when_empty.limit,
            recursive: !!auto.recursive,
          };
          cfg.allowed_roots = Array.isArray(remote.allowed_roots) ? remote.allowed_roots : [];
        } catch (err) {
          /* 忽略：老版本后端没有这个接口，按默认值来 */
        }
      }

      function saveConfig(patch) {
        return apiJson("/local_gallery/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
      }

      /* 只读模式：config.json 里 allow_delete = false 时所有删除入口都拦下 */
      function deleteAllowed() {
        if (cfg.allow_delete !== false) return true;
        setStatus("设置里关掉了删除（allow_delete = false）—— 想删东西先去设置打开", { error: true });
        return false;
      }

      /* 网格缩略图取多长边：跟 config.json 的 thumb_size 走 */
      function thumbSize() {
        const value = Number(cfg.thumb_size);
        return Number.isFinite(value) ? Math.min(640, Math.max(96, Math.round(value))) : 320;
      }

      async function loadUiSettings() {
        try {
          const data = await apiJson("/local_gallery/ui/settings");
          if (typeof data?.favorites_export_dir === "string") {
            uiSettings.favorites_export_dir = data.favorites_export_dir;
          }
        } catch (err) {
          /* 忽略：老版本后端没有这个接口 */
        }
      }

      /* ---------------- 路径列表 ---------------- */
      // folder_path 的 widget 对象在加载工作流时可能被替换掉，
      // 所以每次按名字取，别依赖 onNodeCreated 时缓存的引用
      function folderWidget() {
        return node.widgets?.find((w) => w?.name === "folder_path") || pathWidget || null;
      }

      function getPaths() {
        return splitPaths(folderWidget()?.value);
      }

      // 换了路径之后，把已经不在这些目录下的提示词选中项扔掉，
      // 否则切换文件夹后会静默地把别的目录的提示词也输出出去
      function prunePromptSelection() {
        const roots = getPaths().map((p) =>
          p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
        );
        if (!roots.length) return;
        let changed = false;
        for (const path of [...state.promptSel.keys()]) {
          const flat = path.replace(/\\/g, "/").toLowerCase();
          if (!roots.some((root) => flat === root || flat.startsWith(`${root}/`))) {
            state.promptSel.delete(path);
            changed = true;
          }
        }
        if (changed) {
          renumberPromptSelection();
          commitSelection();
          paintSelection();
        }
      }

      function setPaths(list, { refreshNow = true } = {}) {
        const cleaned = splitPaths(Array.isArray(list) ? list.join("\n") : String(list || ""));
        const widget = folderWidget();
        if (widget) widget.value = cleaned.join("\n");
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(cleaned));
        } catch (err) {
          /* 忽略 */
        }
        rememberPathsOnServer(cleaned);
        renderChips();
        prunePromptSelection();
        app.graph.setDirtyCanvas(true, true);
        if (refreshNow) refresh();
      }

      function addPaths(list) {
        setPaths([...getPaths(), ...list]);
      }

      /* 上次用过的路径：只存在 folder_path（随工作流保存）里的话，重启 ComfyUI 打开
         空白/旧工作流时就没了。这里额外用 localStorage 兜底，重启后自动接上。 */
      // 返回 null = 这台浏览器从没记过；数组 = 记过什么（可能是空，代表用户主动清空）
      function loadSavedPaths() {
        try {
          const raw = localStorage.getItem(STORE_KEY);
          if (raw === null) return null;
          const data = JSON.parse(raw);
          return splitPaths(Array.isArray(data) ? data.join("\n") : String(data || ""));
        } catch (err) {
          return null;
        }
      }

      function applySavedPaths(saved) {
        const widget = folderWidget();
        if (!widget) return false;
        widget.value = saved.join("\n");
        renderChips();
        return true;
      }

      // 本地完全没记录时才值得问后端（本地记了「空」说明用户主动清过，别去后端翻旧账）
      function shouldAskServer() {
        return !getPaths().length && loadSavedPaths() === null;
      }

      /* 服务端也留一份：换浏览器、或者 localhost / 127.0.0.1 交替访问时，
         localStorage 不同源就丢了，重启后问后端要更稳。 */
      function rememberPathsOnServer(paths) {
        try {
          apiJson("/local_gallery/paths", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths }),
          }).catch(() => {});
        } catch (err) {
          /* 忽略：记住路径失败不影响使用 */
        }
      }

      async function restorePathsFromServer() {
        if (getPaths().length) return false;
        let data = null;
        try {
          data = await apiJson("/local_gallery/paths");
        } catch (err) {
          return false;
        }
        const saved = splitPaths(Array.isArray(data?.paths) ? data.paths.join("\n") : "");
        if (!saved.length) return false;
        // 等回来的时候用户可能已经自己加了路径，别覆盖
        if (getPaths().length) return false;
        if (!applySavedPaths(saved)) return false;
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(saved));
        } catch (err) {
          /* 忽略 */
        }
        state.restoredFromStore = true;
        refresh({ silent: true });
        return true;
      }

      // 返回 true 表示确实补上了路径（当前工作流里本来有值就不动）
      function restoreSavedPaths() {
        if (getPaths().length) return false;
        const saved = loadSavedPaths();
        if (!saved || !saved.length) return false;
        return applySavedPaths(saved);
      }

      /* ---------------- 跟随 ComfyUI 明暗主题 ---------------- */

      /* ---------------- DOM ---------------- */
      // file-browser：给 ComfyUI-DD-Translation 之类的中文翻译插件做「别翻这块」的标记
      // （它内部会跳过 .file-browser 子树），不然我们切到英文又被它翻回中文
      const wrap = el("div", "lgb-wrap file-browser");

      let themeObserver = null;
      function applyTheme({ force = false } = {}) {
        const dark = isDarkTheme();
        const name = dark ? "dark" : "light";
        if (!force && wrap.dataset.theme === name) return;
        wrap.dataset.theme = name;
        if (tip) tip.dataset.theme = name;
        document.querySelectorAll(".lgb-overlay").forEach((node) => {
          node.dataset.theme = name;
        });
        // 节点底色跟着走，避免浅色模式下留一块深色板
        node.color = dark ? "#23262e" : "#e6eaf1";
        node.bgcolor = dark ? "#17181c" : "#f6f7f9";
        app.graph?.setDirtyCanvas?.(true, true);
      }


      function mkOverlay() {
        // file-browser 同上：让翻译插件跳过浮层里的文案
        const overlay = el("div", "lgb-overlay file-browser");
        overlay.dataset.theme = wrap.dataset.theme || "dark";
        return overlay;
      }

      /* 点弹窗外面任意位置就关掉。
         用捕获阶段的 pointerdown：即使有元素盖在遮罩上（ComfyUI 自己的浮层、
         z-index 更高的东西），事件也会先经过 document，不会点不动。
         只有「最上面那一层」弹窗响应，避免关掉下层（例如设置里的目录选择器）。 */
      function closeOnOutside(overlay, box, close) {
        const isTop = () => {
          const list = document.querySelectorAll(".lgb-overlay");
          return list.length > 0 && list[list.length - 1] === overlay;
        };
        const onDown = (evt) => {
          if (!box.isConnected) {
            document.removeEventListener("pointerdown", onDown, true);
            return;
          }
          if (!isTop()) return;
          const path = typeof evt.composedPath === "function" ? evt.composedPath() : [];
          if (path.includes(box) || box.contains(evt.target)) return;
          close();
        };
        document.addEventListener("pointerdown", onDown, true);
        return () => document.removeEventListener("pointerdown", onDown, true);
      }

      let themeTimer = null;
      function scheduleThemeSync() {
        if (themeTimer) return;
        themeTimer = setTimeout(() => {
          themeTimer = null;
          applyTheme();
        }, 60);
      }

      /* 顶栏：视图切换（分段控件）+ 缩略图密度 */
      const head = el("div", "lgb-head");

      const rowTabs = el("div", "lgb-tabs");
      const tabGallery = el("button", "lgb-tab on", "图库");
      const tabFavorites = el("button", "lgb-tab", "收藏");
      const tabPrompts = el("button", "lgb-tab", "提示词");
      const tabReverse = el("button", "lgb-tab", "反推");
      const tabConvert = el("button", "lgb-tab", "转换");
      setTitle(tabGallery, "浏览缩略图");
      setTitle(tabFavorites, "收藏的图片");
      setTitle(tabPrompts, "查看当前列表的提示词");
      setTitle(tabReverse, "把选中的图片反推成提示词，可写回同名 .txt");
      setTitle(tabConvert, "批量转格式 / 压体积 / 缩放");
      rowTabs.append(tabGallery, tabFavorites, tabPrompts, tabReverse, tabConvert);

      const sizeWrap = el("label", "lgb-size");
      const sizeInput = document.createElement("input");
      sizeInput.type = "range";
      sizeInput.min = String(COLS_MIN);
      sizeInput.max = String(COLS_MAX);
      sizeInput.step = "1";
      sizeInput.className = "lgb-slider";
      setTitle(sizeInput, "每行显示几张（列数）");
      const sizeVal = el("span", "lgb-count", "");
      sizeWrap.append(tspan("每行"), sizeInput, sizeVal, tspan("张"));

      head.append(rowTabs, el("div", "lgb-head-spacer"), sizeWrap);

      /* 路径栏：浏览回到主面板，设置收成一个图标 */
      const rowAdd = el("div", "lgb-row lgb-bar");
      const btnSettings = el("button", "lgb-btn ic");
      btnSettings.append(icon("gear"));
      setTitle(btnSettings, "设置：明暗主题、图片反推、收藏导出");
      const btnReload = el("button", "lgb-btn ic");
      btnReload.append(icon("refresh"));
      setTitle(btnReload, "重新扫描路径列表");
      const btnTrash = el("button", "lgb-btn");
      btnTrash.append(icon("recycle", 14), tspan("回收站"));
      setTitle(btnTrash, "查看被删除的图片和提示词，可随时恢复");

      /* 批量操作区：放在回收站左边。只做一套按钮，切到提示词页时整块挪进提示词栏 */
      const bulk = el("div", "lgb-bulk");
      // 收藏页专用：取消收藏
      const btnUnfav = el("button", "lgb-btn sm", "取消收藏");
      btnUnfav.style.display = "none";
      setTitle(btnUnfav, "把选中的图从收藏里移除（想加回来再点 ☆ 就行）");
      const btnFavFolder = el("button", "lgb-btn sm", "加入收藏夹");
      btnFavFolder.style.display = "none";
      setTitle(btnFavFolder, "把选中的图片放进收藏夹（可以顺手新建一个）");
      // 删除选中：点开选「全部 / 只删提示词 / 只删图片」
      const btnDelSel = el("button", "lgb-btn sm warn lgb-delbtn");
      btnDelSel.style.display = "none";
      const delSelLabel = el("span", "", "删除选中");
      btnDelSel.append(delSelLabel);
      setTitle(btnDelSel, "点开选择：图片 + 提示词一起删 / 只删提示词 / 只删图片");
      const btnAll = el("button", "lgb-btn sm", "全选");
      setTitle(btnAll, "把当前列表里的图全部选中（单选模式下会自动切到多选）");
      const btnNone = el("button", "lgb-btn sm", "清空选择");
      setTitle(btnNone, "取消全部选中");
      bulk.append(btnUnfav, btnFavFolder, btnDelSel, btnAll, btnNone);

      rowAdd.append(
        btnSettings,
        btnReload,
        el("div", "lgb-head-spacer"),
        bulk,
        btnTrash
      );

      const chips = el("div", "lgb-chips");

      /* 筛选 + 搜索：合并成一行，给网格让出高度 */
      const filters = el("div", "lgb-filters");
      function mkCheck(labelText, checked) {
        const label = el("label", "lgb-chk");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = checked;
        label.append(input, tspan(labelText));
        return { label, input };
      }
      const recursiveChk = mkCheck("含子目录", false);
      const onlyPromptChk = mkCheck("仅有提示词", false);

      const searchBox = el("div", "lgb-search");
      const searchModeBtn = el("button", "lgb-mode", "名称");
      setTitle(searchModeBtn, "搜索范围：名称 → 提示词 → 全部（点一下切一个）");
      const searchInput = document.createElement("input");
      searchInput.className = "lgb-input";
      setPh(searchInput, "按文件名过滤（空格分隔多个关键词）");
      searchBox.append(searchModeBtn, searchInput);
      // 排序：默认 / 文件名 ↑↓ / 修改时间 ↑↓，点一下切一个
      const sortModeBtn = el("button", "lgb-mode lgb-sortbtn");
      const sortLabel = el("span", "", "默认");
      sortModeBtn.append(sortLabel, el("span", "caret", "▾"));
      setTitle(sortModeBtn, "排序：点开选「名称 / 时间」和「顺序 / 倒序」");
      const countLabel = el("span", "lgb-count", "—");
      // 按时间分组：把缩略图按文件修改时间「一天一坨」
      const btnGroup = el("button", "lgb-mode", "时间分组");
      btnGroup.addEventListener("click", () => applyTimeGroup(!state.timeGroup));
      // 视图：网格 / 列表（滑块，放筛选行最左）
      const viewSwitch = el("div", "lgb-switch lgb-viewswitch");
      const viewKnob = el("span", "knob");
      const segGrid = el("button", "seg");
      segGrid.append(tspan("网格"));
      const segList = el("button", "seg");
      segList.append(tspan("列表"));
      setTitle(segGrid, "网格：瀑布流缩略图");
      setTitle(segList, "列表：一行一张，带文件名和提示词标签");
      viewSwitch.append(viewKnob, segGrid, segList);
      segGrid.addEventListener("click", () => setViewMode("grid"));
      segList.addEventListener("click", () => setViewMode("list"));
      viewSwitch.addEventListener("click", (evt) => {
        if (evt.target.closest?.(".seg")) return;
        setViewMode(state.view === "list" ? "grid" : "list");
      });
      // 「含子目录 / 仅有提示词」收进设置，这里只留视图相关的筛选
      filters.append(
        viewSwitch,
        el("div", "lgb-head-spacer"),
        btnGroup,
        sortModeBtn,
        searchBox,
        countLabel
      );

      const gridScroll = el("div", "lgb-scroll");
      // canvas 只做定位容器：框选矩形挂这里，renderGrid 清 grid 时不会被一起清掉
      const canvas = el("div", "lgb-canvas");
      const grid = el("div", "lgb-grid");
      const listBox = el("div", "lgb-list");
      listBox.style.display = "none";
      canvas.append(grid, listBox);
      gridScroll.append(canvas);

      /* 页 */
      const pageGallery = el("div", "lgb-page");
      const pagePrompts = el("div", "lgb-page off");

      /* 提示词页内部再分两档：带提示词的图片 / 无匹配提示词 */
      const promptSub = el("div", "lgb-tabs lgb-subtabs");
      const subPrompts = el("button", "lgb-tab on", "提示词");
      const subOrphans = el("button", "lgb-tab", "无匹配提示词");
      setTitle(subPrompts, "图库里带同名提示词的图片");
      setTitle(subOrphans, "有提示词文件、但同目录没有同名图片，缩略图网格里显示不出来");
      promptSub.append(subPrompts, subOrphans);

      const promptBar = el("div", "lgb-row");
      const promptScope = el("span", "lgb-count", "");
      const orphanScope = el("span", "lgb-count", "—");
      orphanScope.style.display = "none";
      const btnPromptCopyAll = el("button", "lgb-btn sm", "复制全部");
      const btnOrphanCopyAll = el("button", "lgb-btn sm", "复制全部");
      btnOrphanCopyAll.style.display = "none";
      promptBar.append(
        promptScope,
        orphanScope,
        el("div", "lgb-head-spacer"),
        btnPromptCopyAll,
        btnOrphanCopyAll
      );

      const promptScroll = el("div", "lgb-scroll");
      const promptList = el("div", "lgb-prompts");
      promptScroll.append(promptList);

      /* 孤儿提示词：有 .txt 但没有同名图片，网格里永远显示不出来 */
      const orphanScroll = el("div", "lgb-scroll off");
      const orphanList = el("div", "lgb-prompts");
      orphanScroll.append(orphanList);

      pagePrompts.append(promptSub, promptBar, promptScroll, orphanScroll);

      /* 反推页：把选中的图片列出来，跑 WD14 / TIPO，结果直接写回同名 .txt */
      const pageReverse = el("div", "lgb-page off");

      /* 转换页：批量转格式 / 压体积 / 缩放（内容在 mountConvertPage 里建） */
      const pageConvert = el("div", "lgb-page off");

      pageGallery.append(filters, gridScroll);

      /* 底栏：选择信息 + 批量操作（批量删除已挪到路径栏、回收站左边） */
      const rowFoot = el("div", "lgb-row lgb-foot");
      /* 单选 / 多选：滑块开关（两块标签 + 一个滑过去的滑块） */
      const modeSwitch = el("div", "lgb-switch");
      const modeKnob = el("span", "knob");
      const segSingle = el("button", "seg");
      segSingle.append(tspan("单选"));
      const segMulti = el("button", "seg");
      segMulti.append(tspan("多选"));
      modeSwitch.append(modeKnob, segSingle, segMulti);
      const selLabel = el("span", "lgb-selpill", "已选 0");
      const statusLabel = el("span", "lgb-status", "悬停缩略图可预览提示词");
      statusLabel.dataset.i18nStatus = "悬停缩略图可预览提示词";
      const btnCopy = el("button", "lgb-btn sm", "复制提示词");
      // 反推 / 转换快捷入口，放在「全选」左边
      const btnJumpReverse = el("button", "lgb-btn sm", "反推");
      setTitle(btnJumpReverse, "跳到反推页：对选中的图跑 WD14 / TIPO");
      const btnJumpConvert = el("button", "lgb-btn sm", "转换");
      setTitle(btnJumpConvert, "跳到转换压缩页：批量转格式 / 压体积 / 缩放");
      rowFoot.append(
        modeSwitch,
        selLabel,
        statusLabel,
        btnCopy,
        btnJumpReverse,
        btnJumpConvert
      );

      /* 单选 / 多选切换：模式存本地，切到单选时把多余的选中项裁掉 */
      function setPickMode(mode) {
        const next = mode === "single" ? "single" : "multi";
        const changed = next !== state.pickMode;
        state.pickMode = next;
        try {
          localStorage.setItem(PICK_KEY, next);
        } catch (err) {
          /* 忽略：存不住也只是下次回到默认多选 */
        }
        if (changed && next === "single" && state.selected.size > 1) {
          const keep = [...state.selected.entries()].sort((a, b) => a[1] - b[1])[0];
          state.selected.clear();
          if (keep) state.selected.set(keep[0], 0);
          commitSelection();
        }
        syncPickMode();
        paintSelection();
      }

      segSingle.addEventListener("click", () => setPickMode("single"));
      segMulti.addEventListener("click", () => setPickMode("multi"));
      // 点在滑块或缝隙上也能拨过去（真正的开关手感，不必非点文字）
      modeSwitch.addEventListener("click", (evt) => {
        if (evt.target.closest?.(".seg")) return;
        setPickMode(state.pickMode === "single" ? "multi" : "single");
      });

      syncPickMode();
      // 首帧量一次真实宽度；容器变宽（切语言）时再量，别让滑块和文字错位
      requestAnimationFrame(placeModeKnob);
      if (typeof ResizeObserver === "function") {
        new ResizeObserver(() => {
          placeModeKnob();
          syncViewSwitch();
        }).observe(modeSwitch);
        new ResizeObserver(() => syncViewSwitch()).observe(viewSwitch);
      }

      wrap.append(
        head,
        rowAdd,
        chips,
        pageGallery,
        pagePrompts,
        pageReverse,
        pageConvert,
        rowFoot
      );

      const domWidget = node.addDOMWidget("local_gallery", "local_gallery", wrap, {
        serialize: false,
        hideOnZoom: false,
        getValue: () => "",
        setValue: () => {},
      });
      if (domWidget) domWidget.serialize = false;

      /* ---------------- chips ---------------- */
      // 路径标签已搬进「浏览」弹窗（那里空间更宽，能看全路径），
      // 主面板这行只在收藏模式用：收藏夹分类。
      function favoritePathsForView() {
        const rows = [...state.favorites.entries()];
        const mode = state.favFolder || "all";
        if (mode === "all") return rows.map(([path]) => path);
        if (mode === "none") {
          return rows.filter(([, meta]) => !(meta?.folders || []).length).map(([path]) => path);
        }
        return rows.filter(([, meta]) => (meta?.folders || []).includes(mode)).map(([path]) => path);
      }

      function renderChips() {
        // 只在「收藏」页显示收藏夹栏；反推 / 转换 / 提示词页都不该占这行
        const isFav = state.source === "favorites" && activeTab === "favorites";
        chips.style.display = isFav ? "" : "none";
        chips.replaceChildren();
        if (!isFav) return;

        const mk = (key, label, count, hint) => {
          const chip = el("div", "lgb-chip lgb-folderchip");
          chip.classList.toggle("on", (state.favFolder || "all") === key);
          chip.append(el("span", "", label), el("span", "n", String(count || 0)));
          setTitleT(chip, hint, { name: label });
          chip.addEventListener("click", () => {
            state.favFolder = key;
            renderChips();
            refresh({ overridePaths: favoritePathsForView() });
          });
          if (key.startsWith("f")) {
            chip.addEventListener("contextmenu", (evt) => {
              evt.preventDefault();
              confirmDeleteFolder(key, label);
            });
          }
          return chip;
        };

        chips.append(mk("all", "全部", state.favorites.size, "所有收藏（{name}）"));
        if (state.favUnclassified) {
          chips.append(mk("none", "未分类", state.favUnclassified, "还没归类的收藏"));
        }
        state.folders.forEach((folder) => {
          chips.append(
            mk(folder.id, folder.name, folder.count, "收藏夹「{name}」（右键可删除）")
          );
        });

        const addChip = el("div", "lgb-chip lgb-folderchip add");
        addChip.append(tspan("＋ 新建收藏夹"));
        setTitle(addChip, "新建一个收藏夹");
        addChip.addEventListener("click", () => createFolderFlow());
        chips.append(addChip);
      }

      // 供「浏览」弹窗渲染已加入的路径
      function renderPathChips(container, { onChange } = {}) {
        const paths = getPaths();
        container.replaceChildren();
        container.append(
          paths.length
            ? elTpl("span", "lgb-count", "已加入 {n} 个路径", { n: paths.length })
            : el("span", "lgb-count", "还没有加入路径")
        );
        paths.forEach((path) => {
          const chip = el("div", "lgb-chip");
          const missing = state.invalid.some((entry) => entry.path === path);
          if (missing) chip.classList.add("miss");
          const label = el("span", "", path);
          label.title = missing ? `${path}\n${t("（读取失败）")}` : path;
          const btn = el("button", "", "✕");
          setTitle(btn, "移除此路径");
          btn.addEventListener("click", () => {
            setPaths(getPaths().filter((p) => p !== path));
            renderPathChips(container, { onChange });
            onChange?.();
          });
          chip.append(label, btn);
          container.append(chip);
        });
        if (paths.length) {
          const clear = el("button", "lgb-btn sm", "清空路径");
          setTitle(clear, "把路径列表清空（不影响磁盘文件）");
          clear.addEventListener("click", () => {
            setPaths([]);
            renderPathChips(container, { onChange });
            onChange?.();
          });
          container.append(clear);
        }
      }

      /* ---------------- 选择 ---------------- */
      // 提示词页（含「无匹配提示词」档）时，底栏操作的对象是提示词本身
      function onPromptsTab() {
        return activeTab === "prompts";
      }

      function commitSelection() {
        const ordered = [...state.selected.entries()].sort((a, b) => a[1] - b[1]);
        const items = ordered.map(([path]) => ({
          path,
          prompt: state.promptCache.get(path)?.prompt || "",
        }));
        // 提示词页的选中项单独一列：后端只取它的文本，不加载对应图片
        const prompts = [...state.promptSel.entries()]
          .sort((a, b) => a[1] - b[1])
          .map(([path]) => ({ path, prompt: state.promptCache.get(path)?.prompt || "" }));
        // filenames 跟当前页签走：图库/收藏页给图片名，提示词页给提示词名
        const filename_from = state.tab === "prompts" ? "prompt" : "image";
        if (selectionWidget) selectionWidget.value = JSON.stringify({ items, prompts, filename_from });
        app.graph.setDirtyCanvas(true, true);
      }

      function restoreSelection() {
        state.selected.clear();
        state.promptSel.clear();
        if (!selectionWidget?.value) return;
        try {
          const data = JSON.parse(selectionWidget.value);
          const items = Array.isArray(data?.items) ? data.items : [];
          items.forEach((item, index) => {
            if (item && typeof item.path === "string") state.selected.set(item.path, index);
          });
          const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
          prompts.forEach((item, index) => {
            if (item && typeof item.path === "string") state.promptSel.set(item.path, index);
          });
        } catch (err) {
          /* 忽略脏数据 */
        }
      }

      function visibleItems() {
        const keywords = state.filter.toLowerCase().split(/\s+/).filter(Boolean);
        const nameMatch = (item) => {
          if (!keywords.length) return true;
          const hay = `${item.name} ${item.rel} ${item.root || ""}`.toLowerCase();
          return keywords.every((kw) => hay.includes(kw));
        };

        // 没关键词：只受提示词命中集约束
        if (!keywords.length) {
          return state.promptHits
            ? state.items.filter((it) => state.promptHits.has(it.path))
            : state.items;
        }
        // 名称模式，或提示词结果还没回来
        if (state.searchMode === "name" || !state.promptHits) {
          return state.items.filter(nameMatch);
        }
        // 提示词模式以命中集为准；「全部」再并上名称命中的
        const byName = new Set(state.items.filter(nameMatch).map((it) => it.path));
        return state.items.filter(
          (it) =>
            state.promptHits.has(it.path) ||
            (state.searchMode === "both" && byName.has(it.path))
        );
      }

      function renumberSelection() {
        let order = 0;
        for (const key of [...state.selected.keys()]) {
          state.selected.set(key, order);
          order += 1;
        }
      }

      /* 滑块停在当前模式那一格：量一下标签的真实宽度，中英文都不会错位 */
      /* 滑块开关的通用定位：量当前那格的宽度，写到 knob 上 */
      function placeKnob(knob, box, active, tries = 0) {
        const width = active ? active.offsetWidth : 0;
        if (!width) {
          if (tries < 20 && box.isConnected) {
            requestAnimationFrame(() => placeKnob(knob, box, active, tries + 1));
          }
          return;
        }
        knob.style.width = `${width}px`;
        knob.style.transform = `translateX(${active.offsetLeft - 2}px)`;
      }

      function placeModeKnob() {
        placeKnob(modeKnob, modeSwitch, state.pickMode === "single" ? segSingle : segMulti);
      }

      function syncViewSwitch() {
        const isList = state.view === "list";
        segGrid.classList.toggle("on", !isList);
        segList.classList.toggle("on", isList);
        segGrid.setAttribute("aria-pressed", isList ? "false" : "true");
        segList.setAttribute("aria-pressed", isList ? "true" : "false");
        placeKnob(viewKnob, viewSwitch, isList ? segList : segGrid);
      }

      /* 滑块的外观，以及和「全选」的互斥 */
      function syncPickMode() {
        const single = state.pickMode === "single";
        segSingle.classList.toggle("on", single);
        segMulti.classList.toggle("on", !single);
        segSingle.setAttribute("aria-pressed", single ? "true" : "false");
        segMulti.setAttribute("aria-pressed", single ? "false" : "true");
        modeSwitch.classList.toggle("single", single);
        modeSwitch.classList.toggle("multi", !single);
        setTitle(segSingle, "单选：点一下只保留这一张，再点同一张取消选中");
        setTitle(segMulti, "多选：点一下加选、再点取消，Shift 连选");
        setTitle(modeSwitch, "选择模式：单选 / 多选（点另一侧就滑过去）");
        placeModeKnob();
      }

      function toggleSelect(path, index, { range = false, exclusive = false } = {}) {
        // 单选模式：永远只留一张；再点已选中的那张则取消（连带忽略 Shift）
        if (state.pickMode === "single") {
          if (state.selected.size === 1 && state.selected.has(path)) {
            state.selected.clear();
          } else {
            state.selected.clear();
            state.selected.set(path, 0);
          }
          state.lastClicked = index;
          commitSelection();
          paintSelection();
          return;
        }
        if (range && state.lastClicked >= 0) {
          const list = visibleItems();
          const from = Math.min(state.lastClicked, index);
          const to = Math.max(state.lastClicked, index);
          for (let i = from; i <= to; i += 1) {
            const item = list[i];
            if (item && !state.selected.has(item.path)) {
              state.selected.set(item.path, state.selected.size);
            }
          }
        } else if (exclusive) {
          state.selected.clear();
          state.selected.set(path, 0);
        } else if (state.selected.has(path)) {
          state.selected.delete(path);
          renumberSelection();
        } else {
          state.selected.set(path, state.selected.size);
        }
        state.lastClicked = index;
        commitSelection();
        paintSelection();
      }

      function paintSelection() {
        const paintOne = (dom) => {
          const order = state.selected.get(dom.dataset.path);
          dom.classList.toggle("sel", order !== undefined);
          const badge = dom.querySelector(".lgb-order");
          if (badge) badge.textContent = order !== undefined ? String(order + 1) : "";
        };
        grid.querySelectorAll(".lgb-item").forEach(paintOne);
        listBox.querySelectorAll(".lgb-lrow").forEach(paintOne);
        // 提示词页：底栏改看提示词的选中数（图片那套选择保持不动）
        const onPrompts = activeTab === "prompts";
        const count = onPrompts ? state.promptSel.size : state.selected.size;
        setTpl(selLabel, onPrompts ? "已选 {n} 条提示词" : "已选 {n}", { n: count });
        selLabel.classList.toggle("on", count > 0);
        btnCopy.style.display = count ? "" : "none";
        paintPromptSelection();
        // 转换页上的「范围」跟着选中数变
        syncConvertPage();
        // 批量删除：图库/收藏按图片选中数，提示词页两档按提示词选中数
        const onFavorites = activeTab === "favorites";
        const bulkCount = onPrompts ? state.promptSel.size : state.selected.size;
        // 收藏页不摆删除（那里的批量动作是「取消收藏」）
        btnDelSel.style.display = !onFavorites && bulkCount ? "" : "none";
        setTpl(delSelLabel, bulkCount ? "删除选中 ({n})" : "删除选中", { n: bulkCount });
        setTitle(
          btnDelSel,
          onPrompts
            ? "把选中的提示词文件移到回收站，图片保留（可随时恢复）"
            : "点开选择：图片 + 提示词一起删 / 只删提示词 / 只删图片"
        );
        const favFolderCount = onPrompts ? 0 : state.selected.size;
        btnUnfav.style.display = onFavorites && favFolderCount ? "" : "none";
        setTpl(btnUnfav, favFolderCount ? "取消收藏 ({n})" : "取消收藏", { n: favFolderCount });
        btnFavFolder.style.display = favFolderCount ? "" : "none";
        setTpl(btnFavFolder, favFolderCount ? "加入收藏夹 ({n})" : "加入收藏夹", {
          n: favFolderCount,
        });
        updateTabCounts();
        // 正在看反推页时，改了选中就跟着换列表（跑任务中不打断）
        if (activeTab === "reverse" && !revRunning()) ensureReversePage();
      }
      /* ---------------- 框选（左键拖出矩形批量选图） ---------------- */
      const marqueeBox = el("div", "lgb-marquee");
      marqueeBox.style.display = "none";
      canvas.append(marqueeBox);

      let dragSel = null; // 拖动中的临时状态
      let swallowClickUntil = 0;

      // 坐标基准统一用 grid 的 rect：它是 canvas 的内容原点，随滚动一起动
      function gridPoint(evt) {
        const rect = grid.getBoundingClientRect();
        return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
      }

      function beginMarquee(evt) {
        if (evt.button !== 0) return;
        if (activeTab !== "gallery" && activeTab !== "favorites") return;
        // 单选模式下不框选：一次只能留一张，拖出一片没有意义
        if (state.pickMode === "single") return;
        // 列表模式没有矩形可选
        if (state.view === "list") return;
        // 只从缩略图区域起拖，工具栏 / 筛选栏 / 底栏上的拖动不算框选
        const sc = gridScroll.getBoundingClientRect();
        if (
          evt.clientX < sc.left ||
          evt.clientX > sc.right ||
          evt.clientY < sc.top ||
          evt.clientY > sc.bottom
        ) {
          return;
        }
        // 卡片右上角那排小图标（复制/收藏/预览/删除）不参与框选
        if (evt.target.closest?.(".lgb-acts")) return;
        const p = gridPoint(evt);
        dragSel = {
          sx: p.x,
          sy: p.y,
          cx: p.x,
          cy: p.y,
          clientX: evt.clientX,
          clientY: evt.clientY,
          add: evt.ctrlKey || evt.metaKey || evt.shiftKey,
          base: new Map(state.selected),
          moved: false,
        };
        // 一律用捕获阶段：ComfyUI 的画布逻辑会在冒泡途中截住指针事件
        window.addEventListener("pointermove", onMarqueeMove, { passive: false, capture: true });
        window.addEventListener("pointerup", endMarquee, { once: true, capture: true });
        window.addEventListener("pointercancel", endMarquee, { once: true, capture: true });
      }

      function applyMarquee(box) {
        if (!dragSel) return;
        const rect = grid.getBoundingClientRect();
        const hits = [];
        grid.querySelectorAll(".lgb-item").forEach((dom) => {
          const r = dom.getBoundingClientRect();
          const left = r.left - rect.left;
          const top = r.top - rect.top;
          if (
            left < box.right &&
            left + r.width > box.left &&
            top < box.bottom &&
            top + r.height > box.top
          ) {
            hits.push(dom.dataset.path);
          }
        });
        const next = dragSel.add ? new Map(dragSel.base) : new Map();
        if (state.pickMode === "single") {
          // 单选模式一次只留一张，多框也没意义
          if (hits.length) next.set(hits[0], 0);
          else next.clear();
        } else {
          hits.forEach((path) => {
            if (!next.has(path)) next.set(path, next.size);
          });
        }
        state.selected = next;
        renumberSelection();
        paintSelection();
      }

      function onMarqueeMove(evt) {
        if (!dragSel) return;
        dragSel.clientX = evt.clientX;
        dragSel.clientY = evt.clientY;
        const p = gridPoint(evt);
        if (!dragSel.moved) {
          if (Math.hypot(p.x - dragSel.sx, p.y - dragSel.sy) < 4) return;
          dragSel.moved = true;
          wrap.classList.add("lgb-marquee-on");
          marqueeBox.style.display = "";
          startEdgeScroll();
        }
        // 拖选期间别让浏览器顺手把卡片文字也选上
        evt.preventDefault();
        hideTip();
        paintMarquee();
      }

      function paintMarquee() {
        if (!dragSel) return;
        const p = gridPoint(dragSel);
        dragSel.cx = p.x;
        dragSel.cy = p.y;
        const left = Math.min(dragSel.sx, dragSel.cx);
        const top = Math.min(dragSel.sy, dragSel.cy);
        const width = Math.abs(dragSel.cx - dragSel.sx);
        const height = Math.abs(dragSel.cy - dragSel.sy);
        marqueeBox.style.left = `${left}px`;
        marqueeBox.style.top = `${top}px`;
        marqueeBox.style.width = `${width}px`;
        marqueeBox.style.height = `${height}px`;
        applyMarquee({ left, top, right: left + width, bottom: top + height });
      }

      // 拖到上下边缘时自动滚动，不然框一整屏以外的图得松手再来一次
      let scrollRaf = 0;
      function startEdgeScroll() {
        if (scrollRaf) return;
        const tick = () => {
          if (!dragSel) {
            scrollRaf = 0;
            return;
          }
          const rect = gridScroll.getBoundingClientRect();
          const y = dragSel.clientY;
          const EDGE = 26;
          let dy = 0;
          if (y < rect.top + EDGE) dy = -Math.min(18, Math.ceil((rect.top + EDGE - y) / 3));
          else if (y > rect.bottom - EDGE) dy = Math.min(18, Math.ceil((y - (rect.bottom - EDGE)) / 3));
          if (dy) {
            const before = gridScroll.scrollTop;
            gridScroll.scrollTop = before + dy;
            if (gridScroll.scrollTop !== before) paintMarquee();
          }
          scrollRaf = requestAnimationFrame(tick);
        };
        scrollRaf = requestAnimationFrame(tick);
      }

      function endMarquee() {
        window.removeEventListener("pointermove", onMarqueeMove, { capture: true });
        if (scrollRaf) {
          cancelAnimationFrame(scrollRaf);
          scrollRaf = 0;
        }
        const moved = !!dragSel?.moved;
        dragSel = null;
        marqueeBox.style.display = "none";
        wrap.classList.remove("lgb-marquee-on");
        if (!moved) return; // 没拖动 = 普通点击，交给卡片自己的处理
        // 松手后浏览器还会补一个 click，不吞掉会把刚框选的又取消回来
        swallowClickUntil = performance.now() + 300;
        commitSelection();
      }

      // 捕获阶段吞掉框选结束那一下 click
      grid.addEventListener(
        "click",
        (evt) => {
          if (performance.now() < swallowClickUntil) {
            evt.preventDefault();
            evt.stopPropagation();
          }
        },
        true
      );
      // ComfyUI 在 document 上处理画布指针事件，pointerdown 传到 gridScroll 之前就被拦了，
      // 所以按下必须在 document 的捕获阶段接（pointermove/up 能正常冒泡）
      document.addEventListener(
        "pointerdown",
        (evt) => {
          if (!wrap.contains(evt.target)) return;
          beginMarquee(evt);
        },
        true
      );

      /* ---------------- 每行列数 ---------------- */
      let cols = COLS_DEFAULT;
      try {
        const saved = Number(localStorage.getItem(COLS_KEY));
        if (Number.isFinite(saved) && saved >= COLS_MIN && saved <= COLS_MAX) cols = Math.round(saved);
      } catch (err) {
        cols = COLS_DEFAULT;
      }

      let relayoutTimer = null;

      function relayoutNow() {
        if (relayoutTimer) {
          clearTimeout(relayoutTimer);
          relayoutTimer = null;
        }
        if (!state.items.length) return;
        hideTip();
        gridScroll.scrollTop = 0;
        renderGrid();
      }

      function applyCols(value, { persist = true, immediate = false } = {}) {
        const next = Math.min(COLS_MAX, Math.max(COLS_MIN, Math.round(Number(value) || COLS_DEFAULT)));
        const changed = next !== cols;
        cols = next;
        sizeInput.value = String(next);
        sizeVal.textContent = String(next);
        if (persist) {
          try {
            localStorage.setItem(COLS_KEY, String(next));
          } catch (err) {
            /* 忽略 */
          }
        }
        // 列数变了要重新分列；拖动过程中防抖，松手（immediate）立即重排
        if (!state.items.length) return;
        if (immediate) {
          relayoutNow();
          return;
        }
        if (changed) {
          if (relayoutTimer) clearTimeout(relayoutTimer);
          relayoutTimer = setTimeout(relayoutNow, 140);
        }
      }

      /* ---------------- 状态行 ---------------- */
      function setStatus(text, { error = false, hint = "", vars = null } = {}) {
        // 记住模板和变量，切语言时能原样重拼（text 是带 {n} 的中文模板）
        statusLabel.dataset.i18nStatus = text || "";
        statusLabel.dataset.i18nStatusVars = vars ? JSON.stringify(vars) : "";
        const rendered = t(text || "", vars);
        setLabel(statusLabel, rendered);
        statusLabel.title = hint ? `${rendered}\n${hint}` : rendered;
        statusLabel.classList.toggle("err", !!error);
      }

      /* ---------------- 提示词缓存 ---------------- */
      async function ensurePrompt(item, { retry = 1 } = {}) {
        if (!item) return null;
        const cached = state.promptCache.get(item.path);
        if (cached && !cached.error) return cached;

        let lastError = null;
        for (let attempt = 0; attempt <= retry; attempt += 1) {
          try {
            const data = await apiJson(
              `/local_gallery/prompt?path=${encodeURIComponent(item.path)}`
            );
            const entry = {
              prompt: data.prompt || "",
              width: data.width || 0,
              height: data.height || 0,
            };
            state.promptCache.set(item.path, entry);
            return entry;
          } catch (err) {
            lastError = err;
            // 网络抖动 / 服务端一时忙：稍等一下再试一次
            if (attempt < retry) await new Promise((r) => setTimeout(r, 220));
          }
        }
        // 读取失败不写进缓存：否则这张图的提示词会一直显示为空，直到刷新页面
        return {
          prompt: "",
          width: 0,
          height: 0,
          error: String(lastError?.message || lastError || "未知错误"),
        };
      }

      /* ---------------- 悬停浮窗 ---------------- */
      const tip = el("div", "lgb-tip");
      document.body.appendChild(tip);

      // 浮窗建好后再套主题（applyTheme 会同步浮窗自身的令牌）
      applyTheme();
      themeAppliers.add(applyTheme);
      try {
        themeObserver = new MutationObserver(() => scheduleThemeSync());
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
        themeObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
        // 主题类可能挂在任意祖先容器上，观察 class 变动即可（频率很低）
        themeObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ["class"],
          subtree: true,
        });
      } catch (err) {
        themeObserver = null;
      }

      let tipTimer = null;
      let tipItem = null;
      // 最后一次鼠标位置：异步补全内容时用它重新定位，避免浮窗贴到左上角
      const hoverPos = { x: 0, y: 0 };

      function hideTip() {
        if (tipTimer) {
          clearTimeout(tipTimer);
          tipTimer = null;
        }
        tipItem = null;
        tip.style.display = "none";
      }

      function positionTip() {
        const pad = 12;
        const rect = tip.getBoundingClientRect();
        // 坐标没拿到（NaN）时退化成居中，绝不留在 (0,0)
        const baseX = Number.isFinite(hoverPos.x) ? hoverPos.x : (window.innerWidth - rect.width) / 2;
        const baseY = Number.isFinite(hoverPos.y) ? hoverPos.y : (window.innerHeight - rect.height) / 2;
        let x = baseX + 16;
        let y = baseY + 16;
        if (x + rect.width + pad > window.innerWidth) x = baseX - rect.width - 14;
        if (y + rect.height + pad > window.innerHeight) y = baseY - rect.height - 14;
        x = Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - rect.width - pad));
        y = Math.min(Math.max(pad, y), Math.max(pad, window.innerHeight - rect.height - pad));
        tip.style.left = `${Math.round(x)}px`;
        tip.style.top = `${Math.round(y)}px`;
      }

      function fillTip(item, entry) {
        const dim = entry?.width ? `${entry.width}×${entry.height}` : "";
        const head = el("div", "lgb-tip-head");
        head.append(document.createTextNode(item.name));
        if (dim) {
          const span = el("span", "lgb-tip-dim", `  ·  ${dim}`);
          head.append(span);
        }
        if (item.size) head.append(el("span", "lgb-tip-dim", `  ·  ${fmtSize(item.size)}`));

        let promptNode;
        if (!entry) {
          promptNode = el("div", "lgb-tip-prompt", "读取提示词…");
        } else if (entry.prompt) {
          promptNode = el("div", "lgb-tip-prompt", entry.prompt);
        } else if (entry.error) {
          promptNode = elTpl("div", "lgb-tip-prompt lgb-tip-empty", "读取失败：{err}", {
            err: entry.error,
          });
        } else {
          promptNode = el("div", "lgb-tip-prompt lgb-tip-empty", "（此图未找到同名提示词）");
        }

        tip.replaceChildren(head, promptNode);
        if (item.rel && item.rel !== item.name) {
          tip.append(el("div", "lgb-tip-path", item.rel));
        }
      }

      function showTip(item, entry) {
        fillTip(item, entry);
        tip.style.display = "block";
        positionTip(); // 先按新内容量一次尺寸再定位
      }

      gridScroll.addEventListener(
        "scroll",
        () => {
          hideTip();
          maybeLoadMore();
        },
        { passive: true }
      );

      function bindHover(dom, item) {
        dom.addEventListener("mouseenter", (evt) => {
          if (tipTimer) clearTimeout(tipTimer);
          tipItem = item;
          // 记下指针位置（进入时的事件优先，拿不到就用元素位置兜底）
          if (Number.isFinite(evt?.clientX)) {
            hoverPos.x = evt.clientX;
            hoverPos.y = evt.clientY;
          } else {
            const box = dom.getBoundingClientRect();
            hoverPos.x = box.left + box.width / 2;
            hoverPos.y = box.top + box.height / 2;
          }
          tipTimer = setTimeout(async () => {
            tipTimer = null;
            if (tipItem !== item) return;
            const cached = state.promptCache.get(item.path);
            showTip(item, cached);
            if (!cached) {
              const entry = await ensurePrompt(item);
              if (tipItem === item && entry) showTip(item, entry);
            }
          }, 150);
        });
        dom.addEventListener("mousemove", (evt) => {
          if (!Number.isFinite(evt?.clientX)) return;
          hoverPos.x = evt.clientX;
          hoverPos.y = evt.clientY;
          if (tip.style.display === "block" && tipItem === item) positionTip();
        });
        dom.addEventListener("mouseleave", hideTip);
      }

      /* ---------------- 大图预览 ----------------
         翻页 / 收藏 / 删除（进回收站）/ 缩放（滚轮、双击、按钮、键盘） */
      const ZOOM_MIN = 0.2;
      const ZOOM_MAX = 8;
      const ZOOM_STEP = 1.25;

      function openViewer(item) {
        if (!item) return;
        hideTip(); // 悬停提示的层级比遮罩高，不收起会浮在大图上面
        // 在当前列表里翻页（收藏页就是收藏列表），不用关掉重开
        let list = visibleItems();
        let index = list.findIndex((entry) => entry.path === item.path);
        if (index < 0) {
          list.unshift(item);
          index = 0;
        }

        const overlay = mkOverlay();
        overlay.classList.add("viewer");
        const box = el("div", "lgb-viewer");

        // 舞台包住图片：缩放/平移作用在 img 上，超出舞台的部分裁掉
        const stage = el("div", "lgb-vstage");
        const img = document.createElement("img");
        img.draggable = false;
        img.decoding = "async";
        stage.append(img);

        const cap = el("div", "cap", "");

        const bar = el("div", "lgb-viewer-bar");
        const sep = () => el("span", "lgb-vsep");

        const btnPrev = el("button", "lgb-vbtn");
        btnPrev.append(icon("prev", 14));
        setTitle(btnPrev, "上一张（←）");
        const counter = el("span", "count", "");
        const btnNext = el("button", "lgb-vbtn");
        btnNext.append(icon("next", 14));
        setTitle(btnNext, "下一张（→）");

        // 复制提示词：紧挨收藏左边；没有同名 .txt 时变淡，点了给出原因
        const btnCopy = el("button", "lgb-vbtn");
        btnCopy.append(icon("copy", 14));
        setTitle(btnCopy, "复制这张的提示词");

        const btnFav = el("button", "lgb-vbtn");
        btnFav.append(icon("star", 14));
        const btnDel = el("button", "lgb-vbtn danger");
        btnDel.append(icon("trash", 14));
        setTitle(btnDel, "删除（移到回收站，可恢复）");

        const btnZoomOut = el("button", "lgb-vbtn");
        btnZoomOut.append(icon("zoomOut", 14));
        setTitle(btnZoomOut, "缩小（-）");
        const zoomLabel = el("span", "zoomlabel", "100%");
        setTitle(zoomLabel, "点一下回到适应窗口（0）");
        zoomLabel.tabIndex = 0;
        zoomLabel.setAttribute("role", "button");
        zoomLabel.setAttribute("aria-label", t("当前缩放比例，点一下复位"));
        const btnZoomIn = el("button", "lgb-vbtn");
        btnZoomIn.append(icon("zoomIn", 14));
        setTitle(btnZoomIn, "放大（+ / 滚轮 / 双击）");
        const btnFit = el("button", "lgb-vbtn");
        btnFit.append(icon("fit", 14));
        setTitle(btnFit, "适应窗口（0）");

        bar.append(
          btnPrev,
          counter,
          btnNext,
          sep(),
          btnCopy,
          btnFav,
          btnDel,
          sep(),
          btnZoomOut,
          zoomLabel,
          btnZoomIn,
          btnFit
        );

        box.append(stage, bar, cap);

        /* ---- 缩放 / 平移状态 ---- */
        let zoom = 1;
        let panX = 0;
        let panY = 0;

        function clampPan() {
          const rect = stage.getBoundingClientRect();
          // 缩放后比舞台大出来的部分，就是可以拖动的范围
          const maxX = Math.max(0, (rect.width * zoom - rect.width) / 2);
          const maxY = Math.max(0, (rect.height * zoom - rect.height) / 2);
          panX = Math.min(maxX, Math.max(-maxX, panX));
          panY = Math.min(maxY, Math.max(-maxY, panY));
        }

        function paintZoom() {
          img.style.transform = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${zoom})`;
          zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
          stage.classList.toggle("zoomed", zoom > 1.001);
          btnZoomOut.disabled = zoom <= ZOOM_MIN + 0.001;
          btnZoomIn.disabled = zoom >= ZOOM_MAX - 0.001;
          btnFit.disabled =
            Math.abs(zoom - 1) < 0.001 && Math.abs(panX) < 0.5 && Math.abs(panY) < 0.5;
        }

        function resetZoom() {
          zoom = 1;
          panX = 0;
          panY = 0;
          paintZoom();
        }

        // 以某个屏幕坐标为中心缩放；不给坐标就以舞台中心为基准
        function zoomTo(next, cx, cy) {
          const target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
          if (Math.abs(target - zoom) < 0.0001) return;
          if (Number.isFinite(cx) && Number.isFinite(cy)) {
            const rect = stage.getBoundingClientRect();
            const ox = cx - (rect.left + rect.width / 2);
            const oy = cy - (rect.top + rect.height / 2);
            const k = target / zoom;
            panX = ox - (ox - panX) * k;
            panY = oy - (oy - panY) * k;
          }
          zoom = target;
          clampPan();
          paintZoom();
        }

        /* ---- 滚轮缩放（以指针为中心） ---- */
        stage.addEventListener(
          "wheel",
          (evt) => {
            evt.preventDefault();
            const factor = Math.exp(-evt.deltaY * 0.0018);
            zoomTo(zoom * factor, evt.clientX, evt.clientY);
          },
          { passive: false }
        );

        /* ---- 拖动平移（放大后才有意义） ---- */
        let drag = null;
        stage.addEventListener("pointerdown", (evt) => {
          if (evt.button !== 0 || zoom <= 1.001) return;
          drag = { id: evt.pointerId, x: evt.clientX, y: evt.clientY, px: panX, py: panY };
          stage.classList.add("dragging");
          try {
            stage.setPointerCapture(evt.pointerId);
          } catch (err) {
            /* 忽略：个别环境不支持指针捕获 */
          }
        });
        stage.addEventListener("pointermove", (evt) => {
          if (!drag || evt.pointerId !== drag.id) return;
          panX = drag.px + (evt.clientX - drag.x);
          panY = drag.py + (evt.clientY - drag.y);
          clampPan();
          paintZoom();
        });
        function endDrag(evt) {
          if (!drag || (evt && evt.pointerId !== drag.id)) return;
          stage.classList.remove("dragging");
          try {
            stage.releasePointerCapture(drag.id);
          } catch (err) {
            /* 忽略 */
          }
          drag = null;
        }
        stage.addEventListener("pointerup", endDrag);
        stage.addEventListener("pointercancel", endDrag);

        // 双击：放大 ↔ 复位
        stage.addEventListener("dblclick", (evt) => {
          evt.preventDefault();
          if (zoom > 1.001) resetZoom();
          else zoomTo(2, evt.clientX, evt.clientY);
        });

        /* ---- 工具条 ---- */
        btnZoomIn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          zoomTo(zoom * ZOOM_STEP);
        });
        btnZoomOut.addEventListener("click", (evt) => {
          evt.stopPropagation();
          zoomTo(zoom / ZOOM_STEP);
        });
        btnFit.addEventListener("click", (evt) => {
          evt.stopPropagation();
          resetZoom();
        });
        zoomLabel.addEventListener("click", (evt) => {
          evt.stopPropagation();
          resetZoom();
        });
        zoomLabel.addEventListener("keydown", (evt) => {
          if (evt.key !== "Enter" && evt.key !== " ") return;
          evt.preventDefault();
          evt.stopPropagation();
          resetZoom();
        });

        btnPrev.addEventListener("click", (evt) => {
          evt.stopPropagation();
          show(index - 1);
        });
        btnNext.addEventListener("click", (evt) => {
          evt.stopPropagation();
          show(index + 1);
        });

        // 复制按钮：有同名 .txt 才亮，没有就变淡（点了会说明原因）
        function paintViewerCopy(cur) {
          const has = !!(cur && cur.has_prompt);
          btnCopy.classList.toggle("off", !has);
          setTitle(btnCopy, has ? "复制这张的提示词" : "这张没有同名提示词");
        }

        async function copyCurrentPrompt() {
          const cur = list[index];
          if (!cur || btnCopy.disabled) return;
          btnCopy.disabled = true;
          try {
            const entry = await ensurePrompt(cur);
            const text = (entry && entry.prompt) || "";
            if (!text) {
              setStatus(
                cur.has_prompt
                  ? "这张的提示词是空的，没有可复制的内容"
                  : "这张没有同名提示词，无法复制",
                { error: true }
              );
              return;
            }
            await copyText(text, "已复制这张的提示词");
          } finally {
            btnCopy.disabled = false;
          }
        }

        btnCopy.addEventListener("click", (evt) => {
          evt.stopPropagation();
          copyCurrentPrompt();
        });

        function paintViewerFav(on) {
          btnFav.classList.toggle("on", !!on);
          setTitle(btnFav, on ? "取消收藏（F）" : "收藏这张（F）");
        }

        // 收藏状态变了，同步网格里那张图的星标（不然关掉预览后星是旧的）
        function syncCardFav(path, on) {
          grid.querySelectorAll(".lgb-item").forEach((dom) => {
            if (dom.dataset.path === path) paintFav(dom.querySelector(".lgb-fav"), on);
          });
        }

        async function toggleCurrentFav() {
          const cur = list[index];
          if (!cur || btnFav.disabled) return;
          // 还没收藏：先问放进哪个收藏夹，选完再同步星标（收藏页的换图逻辑用不上）
          if (!state.favorites.has(cur.path)) {
            favoriteOne(cur, null, {
              onDone: () => {
                const on = state.favorites.has(cur.path);
                paintViewerFav(on);
                syncCardFav(cur.path, on);
              },
            });
            return;
          }
          btnFav.disabled = true;
          await toggleFavorite(cur, null);
          const on = state.favorites.has(cur.path);
          paintViewerFav(on);
          syncCardFav(cur.path, on);
          btnFav.disabled = false;

          // 收藏页里取消收藏：这张已经不在列表里了，换成下一张
          if (activeTab === "favorites" && !visibleItems().some((it) => it.path === cur.path)) {
            list = visibleItems();
            if (!list.length) {
              close();
              return;
            }
            index = Math.min(index, list.length - 1);
            show(index);
          }
        }

        btnFav.addEventListener("click", (evt) => {
          evt.stopPropagation();
          toggleCurrentFav();
        });

        btnDel.addEventListener("click", (evt) => {
          evt.stopPropagation();
          const cur = list[index];
          if (!cur) return;
          // 删除走确认框；删完自动切到下一张，删空了就关掉预览
          deletePaths([cur.path], {
            onRemoved: () => {
              list = visibleItems();
              if (!list.length) {
                close();
                return;
              }
              index = Math.min(index, list.length - 1);
              show(index);
            },
          });
        });

        function show(next) {
          index = Math.max(0, Math.min(list.length - 1, next));
          const cur = list[index] || item;
          img.src = buildUrl("/local_gallery/raw", { path: cur.path });
          img.alt = cur.name || "";
          cap.textContent = `${cur.rel || cur.name} · ${fmtSize(cur.size)}`;
          counter.textContent = `${index + 1} / ${list.length}`;
          btnPrev.disabled = index <= 0;
          btnNext.disabled = index >= list.length - 1;
          paintViewerFav(state.favorites.has(cur.path));
          paintViewerCopy(cur);
          resetZoom();
        }

        function onKey(evt) {
          // 上面压着确认框时，按键交给确认框处理（否则 Esc 会把预览一起关掉）
          if (document.querySelector(".lgb-confirm")) return;
          if (evt.key === "Escape") close();
          else if (evt.key === "ArrowLeft") {
            evt.preventDefault();
            show(index - 1);
          } else if (evt.key === "ArrowRight") {
            evt.preventDefault();
            show(index + 1);
          } else if (evt.key === "+" || evt.key === "=") {
            evt.preventDefault();
            zoomTo(zoom * ZOOM_STEP);
          } else if (evt.key === "-" || evt.key === "_") {
            evt.preventDefault();
            zoomTo(zoom / ZOOM_STEP);
          } else if (evt.key === "0") {
            evt.preventDefault();
            resetZoom();
          } else if (evt.key === "f" || evt.key === "F") {
            evt.preventDefault();
            toggleCurrentFav();
          }
        }
        function close() {
          overlay.remove();
          window.removeEventListener("keydown", onKey);
        }
        overlay.addEventListener("click", (evt) => {
          // 点按钮不关，点遮罩空白处关
          if (evt.target === overlay) close();
        });
        window.addEventListener("keydown", onKey);
        overlay.append(box);
        document.body.appendChild(overlay);
        show(index);
      }
      /* ---------------- 标签页切换 ---------------- */
      let activeTab = "gallery";

      function promptEntries() {
        // 固定跟随「图库」页：收藏页只是查看收藏，不该改变提示词页的内容。
        // 图库页时仍按筛选 / 搜索结果走；收藏页时用图库最近一次的快照。
        return state.source === "favorites" ? state.galleryVisible : visibleItems();
      }

      // 提示词页只列"真的带提示词"的图；没有同名 txt 的直接不出现
      function promptItems() {
        return promptEntries().filter((it) => it.has_prompt);
      }

      function updateTabCounts() {
        // 页签上不再挂数量，数量只留在悬停提示里
        tabFavorites.replaceChildren(tspan("收藏"));
        setTitleT(tabFavorites, "收藏：{n} 张", { n: state.favorites.size });

        const orphans = state.orphanPrompts || 0;
        subOrphans.replaceChildren(tspan("无匹配提示词"));
        if (orphans > 0) subOrphans.append(el("span", "num", String(orphans)));
        if (orphans) {
          setTitleT(subOrphans, "{n} 个提示词没有匹配到同名图片", { n: orphans });
        } else {
          setTitle(subOrphans, "没有匹配不上的提示词（每个提示词文件都能对上同名图片）");
        }

        const total = promptItems().length;
        subPrompts.replaceChildren(tspan("提示词"));
        if (total > 0) subPrompts.append(el("span", "num", String(total)));
        if (total) setTitleT(subPrompts, "带同名提示词的图片：{n} 张", { n: total });
        else setTitle(subPrompts, "当前列表没有带提示词的图片");

        tabPrompts.replaceChildren(tspan("提示词"));
        if (total) {
          setTitleT(
            tabPrompts,
            orphans
              ? "提示词页（固定跟随图库）：{n} 条，另有 {o} 个无匹配提示词"
              : "提示词页（固定跟随图库）：{n} 条",
            { n: total, o: orphans }
          );
        } else {
          setTitleT(tabPrompts, orphans ? "提示词页，另有 {o} 个无匹配提示词" : "提示词页", { o: orphans });
        }

        const selCount = state.selected.size;
        tabReverse.replaceChildren(tspan("反推"));
        if (selCount) setTitleT(tabReverse, "反推页：已选 {n} 张", { n: selCount });
        else setTitle(tabReverse, "反推页：先在图库选中图片");

        // 转换页：徽标显示待处理张数（有选中按选中，否则按当前列表）
        const convTotal = selCount || visibleItems().length;
        tabConvert.replaceChildren(tspan("转换"));
        if (selCount) setTitleT(tabConvert, "转换压缩：已选 {n} 张", { n: selCount });
        else if (convTotal) setTitleT(tabConvert, "转换压缩：当前列表 {n} 张", { n: convTotal });
        else setTitle(tabConvert, "转换压缩：当前列表没有图片");
      }

      /* 切语言：刷静态文案 + 让各处的渲染函数按新语言重画 */
      function applyLang() {
        try {
          localStorage.setItem(LANG_KEY, lang);
        } catch (err) {
          /* 忽略 */
        }
        if (langSegSync) langSegSync();
        applyLangNodes();
        applySearchMode(state.searchMode, { persist: false });
        closeSortMenu();
        applySortMode(state.sortMode, { persist: false, rerender: false });
        updateTabCounts();
        paintSelection();
        syncConvertPage();
        renderChips();
        // 「今天 / 昨天」这类组标题是渲染时生成的，切语言要重画一遍
        state.tl = null;
        state.rendered = 0;
        renderGrid();
        if (activeTab === "prompts") {
          if (promptMode === "orphans") renderOrphans({ reset: true });
          else renderPrompts({ reset: true });
        }
        if (activeTab === "reverse") mountReversePage();
      }

      /* 提示词页里的两档：prompts = 带提示词的图片 / orphans = 无匹配提示词 */
      let promptMode = "prompts";

      function setPromptMode(mode, { render = true } = {}) {
        const next = mode === "orphans" ? "orphans" : "prompts";
        promptMode = next;
        state.promptMode = next;
        const isOrphans = next === "orphans";
        subPrompts.classList.toggle("on", !isOrphans);
        subOrphans.classList.toggle("on", isOrphans);
        promptScope.style.display = isOrphans ? "none" : "";
        btnPromptCopyAll.style.display = isOrphans ? "none" : "";
        orphanScope.style.display = isOrphans ? "" : "none";
        btnOrphanCopyAll.style.display = isOrphans ? "" : "none";
        promptScroll.classList.toggle("off", isOrphans);
        orphanScroll.classList.toggle("off", !isOrphans);
        if (!render) return;
        if (isOrphans) loadOrphans();
        else renderPrompts({ reset: true });
      }

      function switchTab(name) {
        activeTab = ["favorites", "prompts", "reverse", "convert"].includes(name) ? name : "gallery";
        // filenames 跟页签走，切页就要把新的口径写进 selection_data
        state.tab = activeTab;
        const isGallery = activeTab === "gallery";
        const isFav = activeTab === "favorites";
        const isPrompts = activeTab === "prompts";
        const isReverse = activeTab === "reverse";
        const isConvert = activeTab === "convert";
        tabGallery.classList.toggle("on", isGallery);
        tabFavorites.classList.toggle("on", isFav);
        tabPrompts.classList.toggle("on", isPrompts);
        tabReverse.classList.toggle("on", isReverse);
        tabConvert.classList.toggle("on", isConvert);
        // 收藏页复用同一个缩略图网格，别把它一起关掉
        const isGridView = isGallery || isFav;
        pageGallery.classList.toggle("off", !isGridView);
        pagePrompts.classList.toggle("off", !isPrompts);
        pageReverse.classList.toggle("off", !isReverse);
        pageConvert.classList.toggle("off", !isConvert);
        // 缩略图密度对两个网格页（图库 / 收藏）都有效
        sizeWrap.style.display = isGridView ? "" : "none";
        // 路径栏（浏览 / 设置 / 刷新 / 回收站）只在能看图的两个页签出现；
        // 提示词页把整块批量删除挪进提示词栏，那里也有一颗「删除选中」
        rowAdd.style.display = isGridView ? "" : "none";
        // 收藏夹栏跟着页签走（不在收藏页就收起）
        renderChips();
        // 底栏这两个按钮兼做「当前在哪页」的指示
        btnJumpReverse.classList.toggle("on", isReverse);
        btnJumpConvert.classList.toggle("on", isConvert);
        if (isPrompts) promptBar.append(bulk);
        else if (isGridView) rowAdd.insertBefore(bulk, btnTrash);
        hideTip();
        updateTabCounts();
        paintSelection(); // 底栏按钮跟着页面变（反推页不显示批量删除）
        commitSelection(); // 页签变了 => filenames 的口径也变了
        if (isReverse) {
          ensureReversePage();
          return;
        }
        if (isPrompts) {
          // 收藏页没有孤儿，进来就回到「提示词」档
          setPromptMode(promptMode, { render: false });
          if (promptMode === "orphans") loadOrphans();
          else renderPrompts({ reset: true });
          return;
        }
        if (isConvert) {
          // 转换页内容只建一次，之后随选中数同步按钮
          ensureConvertPage();
          return;
        }
        if (isFav) {
          refresh({ overridePaths: favoritePathsForView() });
          return;
        }
        refresh();
      }

      /* ---------------- 提示词页 ---------------- */
      const PROMPT_PAGE = 60;
      const PROMPT_CONCURRENCY = 6;
      let promptRendered = 0;
      const promptQueue = [];
      let promptWorkers = 0;

      /* 渲染一条提示词：文本 / 空 / 读取失败（可重试） */
      function paintPromptBody(body, item, entry) {
        const text = (entry?.prompt || "").trim();
        body.replaceChildren();
        if (text) {
          body.textContent = text;
          body.classList.remove("empty");
          return;
        }
        body.classList.add("empty");
        if (entry?.error) {
          const btn = el("button", "lgb-link", "重试");
          btn.addEventListener("click", async (evt) => {
            evt.stopPropagation();
            state.promptCache.delete(item.path);
            body.textContent = "读取中…";
            const next = await ensurePrompt(item, { retry: 2 });
            paintPromptBody(body, item, next);
          });
          body.append(elTpl("span", "", "读取失败：{err}", { err: `${entry.error} ` }), btn);
          return;
        }
        body.append(el("span", "", "（这张图没有提示词）"));
      }

      function pumpPromptQueue() {
        while (promptWorkers < PROMPT_CONCURRENCY && promptQueue.length) {
          const job = promptQueue.shift();
          promptWorkers += 1;
          ensurePrompt(job.item)
            .then((entry) => paintPromptBody(job.body, job.item, entry))
            .catch((err) => {
              paintPromptBody(job.body, job.item, { error: String(err.message || err) });
            })
            .finally(() => {
              promptWorkers -= 1;
              pumpPromptQueue();
            });
        }
      }

      function fillPromptBody(item, body) {
        const cached = state.promptCache.get(item.path);
        if (cached) {
          paintPromptBody(body, item, cached);
          return;
        }
        body.textContent = "读取中…";
        body.classList.add("empty");
        promptQueue.push({ item, body });
        pumpPromptQueue();
      }

      async function copyText(text, okText, vars) {
        if (!text) return false;
        try {
          await navigator.clipboard.writeText(text);
          setStatus(okText || "已复制到剪贴板", { vars: vars || null });
          return true;
        } catch (err) {
          setStatus("剪贴板不可用，提示词已打到控制台", { error: true });
          console.log("[LocalGallery] 复制的文本：\n" + text);
          return false;
        }
      }

      /* 复制「这一张」的提示词：和缩略图上的小复制按钮同一套逻辑 */
      async function copyItemPrompt(item) {
        if (!item) return false;
        if (!item.has_prompt) {
          setStatus("这张没有同名提示词，无法复制", { error: true });
          return false;
        }
        const entry = await ensurePrompt(item);
        const text = (entry && entry.prompt) || "";
        if (!text) {
          setStatus("这张的提示词是空的，没有可复制的内容", { error: true });
          return false;
        }
        return copyText(text, "已复制这张的提示词");
      }

      /* 复制「当前选中」的提示词：和底栏的「复制提示词」按钮同一套逻辑 */
      async function copySelectedPrompts() {
        const promptsTab = onPromptsTab();
        const ordered = [...(promptsTab ? state.promptSel : state.selected).entries()].sort(
          (a, b) => a[1] - b[1]
        );
        if (!ordered.length) {
          setStatus("先选几张图片，再复制提示词", { error: true });
          return 0;
        }
        const lines = [];
        for (const [path] of ordered) {
          if (!state.promptCache.has(path)) {
            try {
              const data = await apiJson(
                `/local_gallery/prompt?path=${encodeURIComponent(path)}`
              );
              state.promptCache.set(path, { prompt: data.prompt || "" });
            } catch (err) {
              state.promptCache.set(path, { prompt: "" });
            }
          }
          lines.push(state.promptCache.get(path)?.prompt || "");
        }
        const text = lines.join("\n\n");
        try {
          await navigator.clipboard.writeText(text);
          setStatus("已复制 {n} 条提示词到剪贴板", { vars: { n: lines.length } });
        } catch (err) {
          setStatus("剪贴板不可用，请从控制台手动复制", { error: true });
          console.log("[LocalGallery] 复制的提示词：\n" + text);
        }
        return lines.length;
      }

      function renderPrompts({ reset = true } = {}) {
        const all = promptItems();
        setTpl(promptScope, "{n} 条提示词", { n: all.length });
        setTitle(promptScope, "只列带提示词的图片；没有同名提示词文件的不显示");

        if (reset) {
          promptList.replaceChildren();
          promptRendered = 0;
          promptQueue.length = 0;
        }
        if (!all.length) {
          promptList.replaceChildren(
            el(
              "div",
              "lgb-empty",
              promptEntries().length
                ? "图库里没有带提示词的图片"
                : "还没有图片 —— 打开「设置 → 浏览本机路径」加一个文件夹"
            )
          );
          return;
        }

        const slice = all.slice(promptRendered, promptRendered + PROMPT_PAGE);
        const frag = document.createDocumentFragment();
        slice.forEach((item, offset) => {
          const index = promptRendered + offset;
          const card = el("div", "lgb-prompt");
          card.dataset.path = item.path;
          card.dataset.idx = String(index + 1);
          const head = el("div", "lgb-prompt-head");
          const cp = el("span", "cp", "复制");
          setTitle(cp, "复制这条提示词");
          const del = el("span", "cp del", "删除");
          setTitle(del, "只删除提示词文件，图片保留（可在回收站恢复）");
          head.append(
            el("span", "idx", String(index + 1)),
            el("span", "nm", item.name),
            el("span", "pick"),
            el("span", "grow"),
            cp,
            del
          );
          const body = el("div", "lgb-prompt-body");
          card.append(head, body);
          // 点卡片 = 选中这条提示词（只输出提示词，不输出图片）
          card.addEventListener("click", (evt) => {
            if (cp.contains?.(evt.target) || del.contains?.(evt.target)) return;
            // 刚拖选过正文就不算点击，别把拖选当成选中卡片
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && body.contains(sel.anchorNode)) return;
            togglePromptSelect(item, index, {
              range: evt.shiftKey,
              exclusive: evt.ctrlKey || evt.metaKey,
            });
            ensurePrompt(item).then(() => commitSelection());
          });
          cp.addEventListener("click", async (evt) => {
            evt.stopPropagation();
            const entry = await ensurePrompt(item);
            copyText(entry?.prompt || "", "已复制这条提示词");
          });
          del.addEventListener("click", (evt) => {
            evt.stopPropagation();
            deletePrompts([item.path]);
          });
          fillPromptBody(item, body);
          frag.append(card);
        });
        promptList.append(frag);
        promptRendered += slice.length;
        paintPromptSelection();
      }

      /* ---- 提示词卡片的选择：只选提示词，不选图片 ---- */
      // 当前这一档（提示词 / 无匹配提示词）的列表，Shift 连选用它算区间
      function activePromptList() {
        return state.promptMode === "orphans" ? state.orphanItems || [] : promptItems();
      }

      function renumberPromptSelection() {
        const ordered = [...state.promptSel.entries()].sort((a, b) => a[1] - b[1]);
        state.promptSel.clear();
        ordered.forEach(([path], i) => state.promptSel.set(path, i));
      }

      function togglePromptSelect(item, index, { range = false, exclusive = false } = {}) {
        const list = activePromptList();
        if (state.pickMode === "single") {
          if (state.promptSel.size === 1 && state.promptSel.has(item.path)) {
            state.promptSel.clear();
          } else {
            state.promptSel.clear();
            state.promptSel.set(item.path, 0);
          }
        } else if (range && state.promptLast >= 0) {
          const from = Math.min(state.promptLast, index);
          const to = Math.max(state.promptLast, index);
          for (let i = from; i <= to; i += 1) {
            const entry = list[i];
            if (entry && !state.promptSel.has(entry.path)) {
              state.promptSel.set(entry.path, state.promptSel.size);
            }
          }
        } else if (exclusive) {
          state.promptSel.clear();
          state.promptSel.set(item.path, 0);
        } else if (state.promptSel.has(item.path)) {
          state.promptSel.delete(item.path);
          renumberPromptSelection();
        } else {
          state.promptSel.set(item.path, state.promptSel.size);
        }
        state.promptLast = index;
        commitSelection();
        paintSelection();
      }

      // 选中态：卡片加 sel、文件名后面标「✓顺序号」，鼠标悬停说明只会输出提示词
      function paintPromptSelection() {
        [promptList, orphanList].forEach((list) => {
          list.querySelectorAll(".lgb-prompt").forEach((dom) => {
            const order = state.promptSel.get(dom.dataset.path);
            const on = order !== undefined;
            dom.classList.toggle("sel", on);
            setTitle(
              dom,
              on
                ? "已选中：只输出提示词，不输出图片"
                : "点击选中这条提示词（只输出提示词，不输出图片）"
            );
            const idx = dom.querySelector(".idx");
            if (idx) idx.textContent = dom.dataset.idx || "";
            const pick = dom.querySelector(".pick");
            if (pick) {
              pick.textContent = on ? `✓${order + 1}` : "";
              pick.style.display = on ? "" : "none";
            }
          });
        });
      }

      /* ---------------- 孤儿提示词页 ---------------- */
      const ORPHAN_PAGE = 60;
      let orphanRendered = 0;

      async function loadOrphans({ force = false } = {}) {
        // 孤儿提示词固定按「图库」的路径列表拉取，跟当前是图库页还是收藏页无关
        if (state.orphanLoaded && !force) {
          renderOrphans({ reset: true });
          return;
        }
        const paths = getPaths();
        if (!paths.length) {
          state.orphanItems = [];
          state.orphanCount = 0;
          state.orphanLoaded = true;
          renderOrphans({ reset: true });
          return;
        }
        const seq = ++state.orphanSeq;
        setTpl(orphanScope, "读取中…");
        try {
          const data = await apiJson(
            `/local_gallery/orphans?path=${encodeURIComponent(paths.join("\n"))}` +
              `&recursive=${recursiveChk.input.checked ? 1 : 0}`
          );
          if (seq !== state.orphanSeq) return;
          state.orphanItems = Array.isArray(data.items) ? data.items : [];
          state.orphanCount = Number(data.count) || state.orphanItems.length;
          state.orphanLoaded = true;
        } catch (err) {
          if (seq !== state.orphanSeq) return;
          state.orphanItems = [];
          state.orphanCount = 0;
          state.orphanLoaded = false;
          setTpl(orphanScope, "读取失败");
          btnOrphanCopyAll.disabled = true;
          orphanList.replaceChildren(
            elTpl("div", "lgb-empty", "读取无匹配提示词失败：{err}", { err: err.message || err })
          );
          return;
        }
        renderOrphans({ reset: true });
      }

      function renderOrphans({ reset = true } = {}) {
        const all = state.orphanItems || [];
        const count = state.orphanCount ?? all.length;
        setTpl(
          orphanScope,
          all.length ? "{n} 个提示词匹配不到图片" : "没有匹配不上的提示词",
          { n: count }
        );
        setTitle(
          orphanScope,
          all.length
            ? "这些提示词文件同目录下找不到同名图片，缩略图网格里没有可挂载的位置"
            : "每个提示词文件都能对上同名图片"
        );
        btnOrphanCopyAll.disabled = !all.length;

        if (reset) {
          orphanList.replaceChildren();
          orphanRendered = 0;
        }
        if (!all.length) {
          orphanList.replaceChildren(
            el("div", "lgb-empty", "没有匹配不上的提示词 —— 这个目录里每个提示词文件都有同名图片")
          );
          return;
        }

        const slice = all.slice(orphanRendered, orphanRendered + ORPHAN_PAGE);
        const frag = document.createDocumentFragment();
        slice.forEach((item, offset) => {
          const index = orphanRendered + offset;
          const card = el("div", "lgb-prompt");
          card.dataset.path = item.path;
          card.dataset.idx = String(index + 1);
          const head = el("div", "lgb-prompt-head");
          const cp = el("span", "cp", "复制");
          setTitle(cp, "复制这条提示词");
          const del = el("span", "cp del", "删除");
          setTitle(del, "把这个提示词文件移到回收站（本来就没有对应图片）");
          head.append(
            el("span", "idx", String(index + 1)),
            el("span", "nm", item.name),
            el("span", "pick"),
            el("span", "grow"),
            cp,
            del
          );
          const dir = el("div", "lgb-prompt-dir", item.dir || "");
          dir.title = item.path || "";
          const body = el("div", "lgb-prompt-body");
          card.append(head, dir, body);
          // 孤儿提示词也能选：本来就没有图片，选中的就是这条文本本身
          card.addEventListener("click", (evt) => {
            if (cp.contains?.(evt.target) || del.contains?.(evt.target)) return;
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed && body.contains(sel.anchorNode)) return;
            togglePromptSelect(item, index, {
              range: evt.shiftKey,
              exclusive: evt.ctrlKey || evt.metaKey,
            });
            ensurePrompt(item).then(() => commitSelection());
          });
          cp.addEventListener("click", async (evt) => {
            evt.stopPropagation();
            const entry = await ensurePrompt(item);
            copyText(entry?.prompt || "", "已复制这条提示词");
          });
          del.addEventListener("click", (evt) => {
            evt.stopPropagation();
            deletePrompts([item.path]);
          });
          fillPromptBody(item, body);
          frag.append(card);
        });
        orphanList.append(frag);
        orphanRendered += slice.length;
        paintPromptSelection();
      }

      btnOrphanCopyAll.addEventListener("click", async () => {
        const all = state.orphanItems || [];
        if (!all.length) return;
        btnOrphanCopyAll.disabled = true;
        setStatus("正在读取 {n} 条无匹配提示词…", { vars: { n: all.length } });
        const texts = [];
        for (const item of all) {
          const entry = await ensurePrompt(item);
          const text = (entry?.prompt || "").trim();
          if (text) texts.push(text);
        }
        btnOrphanCopyAll.disabled = false;
        copyText(texts.join("\n\n"), "已复制 {n} 条无匹配提示词", { n: texts.length });
      });

      orphanScroll.addEventListener(
        "scroll",
        () => {
          const remain = orphanScroll.scrollHeight - orphanScroll.scrollTop - orphanScroll.clientHeight;
          if (remain < 400 && orphanRendered < (state.orphanItems || []).length) {
            renderOrphans({ reset: false });
          }
        },
        { passive: true }
      );

      /* ---------------- 删除（移到回收站） ---------------- */
      function openConfirm({ title, titleVars, body, okText, okVars, onOk }) {
        const overlay = mkOverlay();
        const box = el("div", "lgb-confirm");
        const foot = el("div", "foot");
        const btnCancel = el("button", "lgb-btn", "取消");
        const btnOk = el("button", "lgb-btn warn");
        setTpl(btnOk, okText || "确定", okVars);
        foot.append(btnCancel, btnOk);
        const bodyEl = el("div", "body");
        bodyEl.textContent = body || "";
        box.append(elTpl("h3", "", title, titleVars), bodyEl, foot);
        overlay.append(box);
        document.body.appendChild(overlay);

        const close = () => {
          overlay.remove();
          window.removeEventListener("keydown", onKey);
        };
        function onKey(evt) {
          if (evt.key === "Escape") close();
        }
        window.addEventListener("keydown", onKey);
        btnCancel.addEventListener("click", close);
        overlay.addEventListener("click", (evt) => {
          if (evt.target === overlay) close();
        });
        btnOk.addEventListener("click", async () => {
          btnOk.disabled = true;
          btnCancel.disabled = true;
          setTpl(btnOk, "处理中…");
          try {
            await onOk();
            close();
          } catch (err) {
            btnOk.disabled = false;
            btnCancel.disabled = false;
            setTpl(btnOk, okText || "确定", okVars);
            setTpl(box.querySelector(".body"), "失败：{err}", { err: err.message || err });
          }
        });
        return close;
      }

      function shortName(path) {
        return String(path || "").split(/[\\/]/).pop() || String(path || "");
      }

      /* ---------------- Ctrl+Z 撤销删除 ----------------
         删除都是「移到回收站」，所以撤销 = 按 batch + id 把文件移回去。
         每次删除成功压一条，最多记 20 次；Ctrl+Z 从最近一次往回撤。 */
      const undoStack = [];
      const UNDO_MAX = 20;

      function pushUndo(task) {
        undoStack.push({ ...task, at: Date.now() });
        if (undoStack.length > UNDO_MAX) undoStack.shift();
      }

      /* 删除进回收站：entries 是 {batch, id}；favEntries 顺手记下被连带取消的收藏，
         撤销时一起还原，省得用户自己去点星 */
      function pushTrashUndo(moved, favEntries = []) {
        const entries = (moved || [])
          .filter((m) => m && m.batch && m.id)
          .map((m) => ({ batch: m.batch, id: m.id }));
        if (!entries.length) return;
        pushUndo({ kind: "trash", entries, favEntries });
      }

      function pushFavUndo(items) {
        const entries = (items || []).filter((e) => e && e.path);
        if (!entries.length) return;
        pushUndo({ kind: "fav", entries });
      }

      /* 收藏（含放进收藏夹）也能撤：entries 里记下「原本是不是已收藏」，
         撤销时未收藏的整条取消，原本就收藏的只从加进去的那个夹里移出 */
      function pushFavoriteUndo(items) {
        const entries = (items || []).filter((e) => e && e.path);
        if (!entries.length) return;
        pushUndo({ kind: "unfav", entries });
      }

      function repaintFavAll() {
        grid.querySelectorAll(".lgb-item").forEach((dom) => {
          paintFav(dom.querySelector(".lgb-fav"), state.favorites.has(dom.dataset.path));
        });
        listBox.querySelectorAll(".lgb-lrow").forEach((dom) => {
          paintFav(dom.querySelector(".lgb-fav"), state.favorites.has(dom.dataset.path));
        });
      }

      // 重新收藏 + 还原收藏夹归属（assign 会把没收藏的自动收藏）
      async function restoreFavorites(entries) {
        const paths = entries.map((e) => e.path).filter(Boolean);
        if (!paths.length) return;
        const data = await apiJson("/local_gallery/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths, action: "add" }),
        });
        state.favorites = new Map((data.items || []).map((it) => [it.path, it]));
        const byFolder = new Map();
        entries.forEach((e) => {
          (e.folders || []).forEach((fid) => {
            if (!byFolder.has(fid)) byFolder.set(fid, []);
            byFolder.get(fid).push(e.path);
          });
        });
        for (const [fid, list] of byFolder) {
          try {
            const res = await apiJson("/local_gallery/favorites/folders/assign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths: list, folder_id: fid, action: "add" }),
            });
            applyFolderState(res);
          } catch (err) {
            /* 夹没了就只恢复收藏，不打断撤销 */
          }
        }
        updateTabCounts();
      }

      async function undoLast() {
        const task = undoStack.pop();
        if (!task) {
          setStatus("没有可以撤销的操作");
          return;
        }
        try {
          if (task.kind === "fav") {
            await restoreFavorites(task.entries);
            repaintFavAll();
            if (state.source === "favorites") {
              await refresh({ overridePaths: favoritePathsForView() });
            }
            setStatus(
              t("已撤销取消收藏：恢复 {n} 张", { n: task.entries.length }) +
                (undoStack.length ? t(" · 还能再撤 {n} 次", { n: undoStack.length }) : "")
            );
            return;
          }

          if (task.kind === "unfav") {
            // 原本没收藏的：整条取消收藏
            const plain = task.entries.filter((e) => !e.wasFav).map((e) => e.path);
            if (plain.length) {
              const data = await apiJson("/local_gallery/favorites", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paths: plain, action: "remove" }),
              });
              applyFolderState(data);
            }
            // 原本就收藏过的：只把它们从这次加进去的夹里移出
            const byFolder = new Map();
            task.entries
              .filter((e) => e.wasFav && e.folderId)
              .forEach((e) => {
                if (!byFolder.has(e.folderId)) byFolder.set(e.folderId, []);
                byFolder.get(e.folderId).push(e.path);
              });
            for (const [fid, list] of byFolder) {
              try {
                const res = await apiJson("/local_gallery/favorites/folders/assign", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ paths: list, folder_id: fid, action: "remove" }),
                });
                applyFolderState(res);
              } catch (err) {
                /* 夹没了就跳过 */
              }
            }
            repaintFavAll();
            if (state.source === "favorites") {
              await refresh({ overridePaths: favoritePathsForView() });
            }
            const ungrouped = task.entries.filter((e) => e.wasFav && e.folderId).length;
            const removedFav = task.entries.length - ungrouped;
            let msg;
            if (removedFav > 0 && ungrouped === 0) {
              msg = t("已撤销收藏：{n} 张已取消收藏", { n: removedFav });
            } else if (removedFav === 0 && ungrouped > 0) {
              msg = t("已撤销收藏：{n} 张已移出收藏夹", { n: ungrouped });
            } else {
              msg = t("已撤销收藏：{n} 张", { n: task.entries.length });
            }
            setStatus(msg + (undoStack.length ? t(" · 还能再撤 {n} 次", { n: undoStack.length }) : ""));
            return;
          }

          const res = await apiJson("/local_gallery/trash/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: task.entries }),
          });
          const restored = (res.restored || []).length;
          const failed = (res.failed || []).length;
          // 删除时连带取消的收藏也一并恢复
          let favBack = 0;
          if (task.favEntries && task.favEntries.length) {
            try {
              await restoreFavorites(task.favEntries);
              favBack = task.favEntries.length;
            } catch (err) {
              /* 收藏恢复失败不影响文件恢复 */
            }
          }
          // 文件回到原位了，列表得重扫一遍才看得到
          await refresh();
          setStatus(
            t("已撤销删除：恢复 {n} 个文件", { n: restored }) +
              (favBack ? t(" · 收藏也回来了", {}) : "") +
              (failed ? t("（{n} 个失败）", { n: failed }) : "") +
              (undoStack.length ? t(" · 还能再撤 {n} 次", { n: undoStack.length }) : ""),
            { error: failed > 0 }
          );
        } catch (err) {
          undoStack.push(task); // 失败放回去，别把撤销机会弄丢
          setStatus("撤销失败：{err}", { error: true, vars: { err: err.message || err } });
        }
      }

      // 「删除选中」下拉：全部 / 只删提示词 / 只删图片
      let delMenuEl = null;
      let delMenuOff = null;

      function closeDeleteMenu() {
        if (delMenuOff) {
          delMenuOff();
          delMenuOff = null;
        }
        if (delMenuEl) {
          delMenuEl.remove();
          delMenuEl = null;
        }
        btnDelSel.classList.remove("open");
      }

      function openDeleteMenu() {
        if (delMenuEl) {
          closeDeleteMenu();
          return;
        }
        const paths = [...state.selected.keys()];
        if (!paths.length) return;
        const byPath = new Map(state.items.map((it) => [it.path, it]));
        const promptCount = paths.filter((path) => byPath.get(path)?.has_prompt).length;

        const panel = el("div", "lgb-sortmenu lgb-delmenu");
        panel.dataset.theme = wrap.dataset.theme || "dark";
        const col = el("div", "lgb-sortcol");

        const mk = (label, hint, { danger = false, disabled = false, vars = null } = {}, run) => {
          const btn = el("button", `opt${danger ? " danger" : ""}`);
          setTpl(btn, label, vars);
          setTitle(btn, hint);
          if (disabled) btn.disabled = true;
          else
            btn.addEventListener("click", () => {
              closeDeleteMenu();
              run();
            });
          col.append(btn);
        };

        mk(
          "删除全部（图片 + 提示词）",
          "把选中的图片连同同名提示词一起移到回收站",
          { danger: true },
          () => deletePaths(paths)
        );
        mk(
          promptCount ? "删除提示词（{n} 个）" : "删除提示词（没有同名提示词）",
          "只移走同名提示词文件，图片保留",
          { disabled: !promptCount, vars: promptCount ? { n: promptCount } : null },
          () => deletePrompts(paths)
        );
        mk(
          "删除图片（提示词保留）",
          "只移走图片，同名提示词文件留在原地",
          { danger: true },
          () => deletePaths(paths, { withPrompts: false })
        );

        panel.append(col);
        document.body.appendChild(panel);

        const rect = btnDelSel.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8));
        panel.style.left = `${left}px`;
        panel.style.top = `${rect.bottom + 6}px`;
        btnDelSel.classList.add("open");

        const onDown = (evt) => {
          if (panel.contains(evt.target) || btnDelSel.contains(evt.target)) return;
          closeDeleteMenu();
        };
        const onKey = (evt) => {
          if (evt.key === "Escape") closeDeleteMenu();
        };
        document.addEventListener("pointerdown", onDown, true);
        window.addEventListener("keydown", onKey);
        delMenuOff = () => {
          document.removeEventListener("pointerdown", onDown, true);
          window.removeEventListener("keydown", onKey);
        };
        delMenuEl = panel;
      }

      async function deletePaths(paths, { onRemoved, withPrompts = true } = {}) {
        const list = [...new Set(paths.filter(Boolean))];
        if (!list.length) return;
        if (!deleteAllowed()) return;
        const preview = list.slice(0, 12).map((p) => "  " + shortName(p)).join("\n");
        const more = list.length > 12 ? "\n  " + t("… 等 {n} 个文件", { n: list.length }) : "";
        openConfirm({
          title: withPrompts ? "删除 {n} 个文件？" : "删除 {n} 张图片？",
          titleVars: { n: list.length },
          body:
            (withPrompts
              ? t("这些文件会被【移到回收站】（不是永久删除），连同同名提示词文件一起移走。")
              : t("只把图片移到回收站（不是永久删除），同名提示词文件留在原地。")) +
            "\n" +
            t("删完按 Ctrl+Z 就能撤销（也可以到回收站里手动移回）。") +
            `\n\n${preview}${more}`,
          okText: withPrompts ? "移到回收站（{n}）" : "删除图片（{n}）",
          okVars: { n: list.length },
          onOk: async () => {
            const data = await apiJson("/local_gallery/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths: list, with_prompts: withPrompts }),
            });
            const moved = (data.moved || []).map((m) => m.path);
            const failed = data.failed || [];
            if (!moved.length) {
              throw new Error(failed.map((f) => f.error).join("；") || "没有文件被移动");
            }
            const gone = new Set(moved);
            state.items = state.items.filter((it) => !gone.has(it.path));
            state.galleryVisible = state.galleryVisible.filter((it) => !gone.has(it.path));
            let promptSelDirty = false;
            gone.forEach((p) => {
              state.selected.delete(p);
              state.promptCache.delete(p);
              if (state.promptSel.delete(p)) promptSelDirty = true;
            });
            // 删掉的图同时取消收藏，免得收藏页里留着死链
            const favGone = moved.filter((p) => state.favorites.has(p));
            // 撤销删除时把这几个收藏也一起还原
            const favGoneMeta = favGone.map((p) => ({
              path: p,
              folders: (state.favorites.get(p)?.folders || []).slice(),
            }));
            if (favGone.length) {
              favGone.forEach((p) => state.favorites.delete(p));
              apiJson("/local_gallery/favorites", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ paths: favGone, action: "remove" }),
              }).catch(() => {
                /* 收藏清理失败不影响删除结果 */
              });
            }
            if (promptSelDirty) renumberPromptSelection();
            renumberSelection();
            commitSelection();
            state.rendered = 0;
            renderGrid();
            updateTabCounts();
            if (activeTab === "prompts") renderPrompts({ reset: true });
            pushTrashUndo(data.moved, favGoneMeta);
            const where = data.trash_dir ? ` → ${data.trash_dir}` : "";
            setStatus(
              t("已移到回收站 {n} 个{moved}", { n: moved.length, moved: "" }) +
                (failed.length ? `，${t("{n} 个失败", { n: failed.length })}` : "") +
                where,
              { error: failed.length > 0 }
            );
            // 大图预览靠这个回调切到下一张（或删空了就关掉）
            if (typeof onRemoved === "function") onRemoved(moved);
          },
        });
      }

      /* ---------------- 只删提示词 ---------------- */
      async function deletePrompts(paths) {
        const list = [...new Set(paths.filter(Boolean))];
        if (!list.length) return;
        if (!deleteAllowed()) return;
        const byPath = new Map(state.items.map((it) => [it.path, it]));
        // 图片路径 → 删它的同名提示词；提示词文件路径（孤儿）→ 直接删它自己。
        // 后端两种都认，这里只把「没有提示词的图片」挡掉，免得产生失败项
        const targets = list.filter((path) => (byPath.has(path) ? byPath.get(path).has_prompt : true));
        const images = targets.filter((path) => byPath.has(path));
        if (!targets.length) {
          setStatus("选中的条目没有同名提示词，没什么可删的", { error: true });
          return;
        }
        const preview = targets.slice(0, 10).map((p) => "  " + shortName(p)).join("\n");
        const more = targets.length > 10 ? "\n  " + t("… 等 {n} 个", { n: targets.length }) : "";

        openConfirm({
          title: "删除 {n} 个提示词？",
          titleVars: { n: targets.length },
          body:
            t("只把同名提示词文件（.txt / .caption / .json…）移到回收站，图片不会被删除。") +
            "\n" +
            t("需要时可以随时从「回收站」恢复（图库页路径栏进入）。") +
            "\n\n" +
            preview +
            more,
          okText: "删除提示词（{n}）",
          okVars: { n: targets.length },
          onOk: async () => {
            const data = await apiJson("/local_gallery/delete_prompts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths: targets }),
            });
            const moved = data.moved || [];
            const failed = data.failed || [];
            pushTrashUndo(moved);
            if (!moved.length) {
              throw new Error(
                failed.map((f) => f.error).filter(Boolean).join("；") || "没有文件被移走"
              );
            }
            images.forEach((path) => {
              const item = byPath.get(path);
              if (item) item.has_prompt = false;
              state.promptCache.delete(path);
              const dom = [...grid.querySelectorAll(".lgb-item")].find(
                (nodeEl) => nodeEl.dataset.path === path
              );
              const badge = dom?.querySelector(".lgb-txt");
              if (badge) {
                badge.textContent = "—";
                badge.classList.add("off");
                setTitle(badge, "没有同名提示词文件");
              }
            });
            // 选中项跟着删掉，别让「已选 N」还挂着已经进了回收站的文件。
            // 后端 moved 里给的是 .txt 的路径，图片路径得按 has_prompt 再兜一遍
            const gonePaths = new Set(moved.map((m) => m.path));
            let selChanged = false;
            for (const key of [...state.promptSel.keys()]) {
              const item = byPath.get(key);
              if (gonePaths.has(key) || (item && !item.has_prompt)) {
                state.promptSel.delete(key);
                selChanged = true;
              }
            }
            if (selChanged) {
              renumberPromptSelection();
              commitSelection();
            }
            // 孤儿列表里被删的立即摘掉，别出现点不开的空卡片
            const orphanBefore = state.orphanItems?.length || 0;
            if (orphanBefore) {
              state.orphanItems = state.orphanItems.filter((it) => !gonePaths.has(it.path));
              const cut = orphanBefore - state.orphanItems.length;
              if (cut > 0) state.orphanCount = Math.max(0, (state.orphanCount || orphanBefore) - cut);
            }
            updateTabCounts();
            paintSelection();
            if (orphanBefore) loadOrphans({ force: true });
            if (activeTab === "prompts" && promptMode !== "orphans") renderPrompts({ reset: true });
            setStatus(
              `${t("已移走 {n} 个提示词文件（图片保留）", { n: moved.length })}${
                failed.length ? t("，{n} 个失败", { n: failed.length }) : ""
              }`,
              { error: failed.length > 0 }
            );
          },
        });
      }

      /* ---------------- 回收站 ---------------- */
      async function openTrash() {
        hideTip();
        const overlay = mkOverlay();
        const box = el("div", "lgb-trash");

        const headEl = el("div", "lgb-trash-head");
        const hint = el("div", "hint", "读取中…");
        const btnClose = el("button", "lgb-btn", "关闭");
        headEl.append(el("h3", "", "回收站"), hint, btnClose);

        const body = el("div", "lgb-trash-body");
        const foot = el("div", "lgb-trash-foot");
        const footMsg = el("div", "msg", "删除的图片和提示词会先放在这里，随时可以恢复");
        const btnPurgeAll = el("button", "lgb-btn sm warn", "清空回收站");
        btnPurgeAll.disabled = true;
        foot.append(footMsg, btnPurgeAll);

        box.append(headEl, body, foot);
        overlay.append(box);
        document.body.appendChild(overlay);

        let offTrashOutside = null;
        const close = () => {
          offTrashOutside?.();
          offTrashOutside = null;
          overlay.remove();
          window.removeEventListener("keydown", onKey);
        };
        function onKey(evt) {
          if (evt.key === "Escape") close();
        }
        window.addEventListener("keydown", onKey);
        btnClose.addEventListener("click", close);
        offTrashOutside = closeOnOutside(overlay, box, close);
        overlay.addEventListener("click", (evt) => {
          if (evt.target === overlay) close();
        });

        let data = null;

        function formatWhen(name) {
          const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(String(name || ""));
          if (!match) return String(name || "");
          const [, y, mo, d, h, mi, se] = match;
          return `${y}-${mo}-${d} ${h}:${mi}:${se}`;
        }

        function setMsg(text, warn = false, vars = null) {
          if (text) setLabel(footMsg, t(text, vars));
          else footMsg.textContent = "";
          footMsg.classList.toggle("warn", !!warn);
        }

        async function doRestore(entries, rows) {
          if (!entries.length) return;
          try {
            const res = await apiJson("/local_gallery/trash/restore", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items: entries }),
            });
            const restored = res.restored || [];
            const failed = res.failed || [];
            rows.forEach((row) => row?.remove());
            setMsg(
              "已恢复 {n} 个{failed}",
              failed.length > 0,
              {
                n: restored.length,
                failed: failed.length ? t(" · {n} 个失败", { n: failed.length }) : "",
              }
            );
            setStatus("已从回收站恢复 {n} 个文件", { vars: { n: restored.length } });
            await reload();
            if (restored.length) refresh({ silent: true });
          } catch (err) {
            setMsg("恢复失败：{err}", true, { err: err.message || err });
          }
        }

        function batchEntries(batch) {
          return (batch.items || []).map((it) => ({ batch: batch.name, id: it.id }));
        }

        function render() {
          body.replaceChildren();
          const batches = data?.batches || [];
          if (!batches.length) {
            body.append(
              el("div", "lgb-empty", "回收站是空的 —— 删除的图片和提示词会先放在这里，可随时恢复")
            );
            btnPurgeAll.disabled = true;
            return;
          }
          btnPurgeAll.disabled = false;

          batches.forEach((batch, index) => {
            const block = el("div", "lgb-tbatch");
            const row = el("div", "lgb-tbatch-head");
            const chev = el("span", "chev", index === 0 ? "▾" : "▸");
            const when = el("span", "when", formatWhen(batch.created || batch.name));
            when.title = batch.name;
            const count = elTpl("span", "cnt", "{n} 张图片 · {p} 个提示词", {
              n: batch.images,
              p: batch.prompts,
            });
            const btnBatch = el("button", "lgb-btn sm", "恢复本批");
            const btnPurge = el("button", "lgb-btn sm warn", "清空");
            row.append(chev, when, count, el("div", "lgb-head-spacer"), btnBatch, btnPurge);

            const items = el("div", "lgb-titems");
            if (index !== 0) items.style.display = "none";

            const rows = [];
            (batch.items || []).forEach((it) => {
              const itemRow = el("div", "lgb-titem");
              itemRow.dataset.batch = batch.name;
              itemRow.dataset.id = it.id;
              rows.push(itemRow);

              const thumb = el("div", "thumb");
              if (it.kind === "image") {
                const img = document.createElement("img");
                img.loading = "lazy";
                img.alt = "";
                img.src = buildUrl("/local_gallery/trash/thumb", {
                  batch: batch.name,
                  stored: it.stored,
                  size: 96,
                });
                thumb.append(img);
              } else {
                thumb.append(el("span", "tag", "TXT"));
              }

              const info = el("div", "info");
              const nameRow = el("div", "nm");
              nameRow.append(document.createTextNode(it.name));
              if (it.sidecars) {
                const tag = elTpl("span", "sub", "+{n} 提示词", { n: it.sidecars });
                setTitle(tag, "恢复图片时会连同这张图的提示词一起恢复");
                nameRow.append(tag);
              }
              info.append(nameRow);
              const source = String(it.original || "");
              const dir = el("div", "dir", source.replace(/[\\/][^\\/]+$/, ""));
              dir.title = source;
              info.append(dir);

              const btnRestore = el("button", "lgb-btn sm", "恢复");
              btnRestore.addEventListener("click", (evt) => {
                evt.stopPropagation();
                doRestore([{ batch: batch.name, id: it.id }], [itemRow]);
              });

              itemRow.append(thumb, info, btnRestore);
              items.append(itemRow);
            });
            if (batch.total > (batch.items || []).length) {
              items.append(
                elTpl(
                  "div",
                  "lgb-truncated",
                  "这一批还有 {n} 个未显示，用「恢复本批」一起恢复",
                  { n: batch.total - batch.items.length }
                )
              );
            }

            row.addEventListener("click", () => {
              const open = items.style.display !== "none";
              items.style.display = open ? "none" : "";
              chev.textContent = open ? "▸" : "▾";
            });

            btnBatch.addEventListener("click", (evt) => {
              evt.stopPropagation();
              doRestore(batchEntries(batch), rows);
            });
            btnPurge.addEventListener("click", (evt) => {
              evt.stopPropagation();
              openConfirm({
                title: "永久删除这一批（{n} 个文件）？",
                titleVars: { n: batch.total },
                body: t("这一批会从回收站里彻底删除，无法恢复。\n\n批次：") + batch.name,
                okText: "永久删除",
                onOk: async () => {
                  const res = await apiJson("/local_gallery/trash/purge", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ batch: batch.name }),
                  });
                  setMsg("已永久删除 {n} 个文件", true, { n: res.removed || 0 });
                  await reload();
                },
              });
            });

            block.append(row, items);
            body.append(block);
          });
        }

        async function reload() {
          try {
            data = await apiJson("/local_gallery/trash");
            if (data.total) {
              setTpl(hint, "{n} 个文件 · {root}", { n: data.total, root: data.root });
            } else {
              if (data.root) setLabel(hint, data.root);
              else setTpl(hint, "空");
            }
            hint.title = data.root || "";
            render();
          } catch (err) {
            setTpl(hint, "读取失败：{err}", { err: err.message || err });
            body.replaceChildren(el("div", "lgb-empty", "读取回收站失败"));
          }
        }

        btnPurgeAll.addEventListener("click", () => {
          const total = data?.total || 0;
          if (!total) return;
          openConfirm({
            title: "清空回收站（{n} 个文件）？",
            titleVars: { n: total },
            body: t("回收站里的所有图片和提示词都会被彻底删除，无法恢复。\n\n只想删某一批，请用批次右侧的「清空」。"),
            okText: "全部永久删除",
            onOk: async () => {
              const res = await apiJson("/local_gallery/trash/purge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
              });
              setMsg("已永久删除 {n} 个文件", true, { n: res.removed || 0 });
              await reload();
            },
          });
        });

        await reload();
      }

      /* ---------------- 图片反推（WD14 + 可选 TIPO） ---------------- */
      const REV_KEY = "localGalleryBrowser.caption";
      const REV_DEFAULTS = {
        model: "",
        threshold: 0.35,
        character: 0.85,
        mode: "tags",
        tipoModel: "",
        prefix: "",
        writeMode: "skip",
        underscore: true,
      };

      function loadRevSettings() {
        try {
          const raw = JSON.parse(localStorage.getItem(REV_KEY) || "{}");
          if (raw && typeof raw === "object") return { ...REV_DEFAULTS, ...raw };
        } catch (err) {
          /* 忽略脏数据 */
        }
        return { ...REV_DEFAULTS };
      }

      const rev = {
        info: null,
        job: null,
        state: "idle",
        total: 0,
        done: 0,
        current: "",
        elapsed: 0,
        error: "",
        results: [],
        texts: new Map(),
        since: 0,
        timer: null,
        ui: null,
        statusText: "",
        settings: loadRevSettings(),
      };

      function saveRevSettings() {
        try {
          localStorage.setItem(REV_KEY, JSON.stringify(rev.settings));
        } catch (err) {
          /* 忽略 */
        }
      }

      function revRunning() {
        return rev.state === "running";
      }

      // 切到反推页时调用：选中变了才重建，跑任务中不重建（轮询闭包还指着旧 DOM）
      function ensureReversePage() {
        const key = [...state.selected.keys()].join("\n");
        if (revRunning() && rev.ui) return;
        if (rev.ui && rev.builtFor === key) return;
        mountReversePage(key);
      }

      async function mountReversePage(builtForKey = [...state.selected.keys()].join("\n")) {
        hideTip();
        pageReverse.replaceChildren();
        rev.ui = null;
        rev.builtFor = builtForKey;
        const targets = [...state.selected.keys()];

        // 只显示属于当前选中的结果（换了选中就不串台）
        const targetSet = new Set(targets);

        // 还没反推的图也给一张卡片，这样页面里能直接看到选中的图
        function placeholderFor(path) {
          const item = state.items.find((it) => it.path === path);
          return {
            path,
            name: item?.name || shortName(path),
            text: "",
            tags: "",
            tag_count: 0,
            has_prompt: !!item?.has_prompt,
            error: "",
          };
        }

        const box = el("div", "lgb-rev");

        const headEl = el("div", "lgb-rev-head");
        const hint = targets.length
          ? elTpl("div", "hint", "选中 {n} 张 · 结果写到同名 .txt", { n: targets.length })
          : el("div", "hint", "先在图库里选中图片，这里会列出它们");
        const btnRefresh = el("button", "lgb-btn sm", "刷新列表");
        setTitle(btnRefresh, "按当前选中的图片重新加载");
        btnRefresh.addEventListener("click", () => {
          if (revRunning()) {
            setStatus("正在反推，先停止再刷新", { error: true });
            return;
          }
          mountReversePage();
        });
        headEl.append(el("h3", "", "图片反推"), hint, btnRefresh);

        function field(label, control) {
          const wrapEl = el("label", "lgb-rev-field");
          wrapEl.append(el("span", "lb", label), control);
          return wrapEl;
        }

        function numberInput(min, max, step, value) {
          const input = document.createElement("input");
          input.type = "number";
          input.min = String(min);
          input.max = String(max);
          input.step = String(step);
          input.value = String(value);
          return input;
        }

        const modelSel = document.createElement("select");
        modelSel.dataset.role = "model";
        const thrInput = numberInput(0.05, 0.95, 0.05, rev.settings.threshold);
        const charInput = numberInput(0, 1, 0.05, rev.settings.character);
        const modeSel = document.createElement("select");
        [
          ["tags", "仅标签（快）"],
          ["tipo", "TIPO 扩写标签"],
          ["tipo_nl", "TIPO 标签 + 描述"],
        ].forEach(([value, text]) => modeSel.append(mkOption(value, text)));
        modeSel.value = rev.settings.mode || "tags";

        const tipoSel = document.createElement("select");
        const prefixInput = document.createElement("input");
        prefixInput.type = "text";
        prefixInput.className = "prefix";
        setPh(prefixInput, "如 @wanet");
        prefixInput.value = rev.settings.prefix || "";
        const underscoreChk = mkCheck("下划线换空格", rev.settings.underscore !== false);

        const optsRow = el("div", "lgb-rev-opts");
        optsRow.append(
          field("模型", modelSel),
          field("阈值", thrInput),
          field("角色阈值", charInput),
          field("输出", modeSel),
          field("TIPO 模型", tipoSel),
          field("前缀", prefixInput),
          underscoreChk.label
        );

        const bar = el("div", "lgb-rev-bar");
        const btnStart = el("button", "lgb-btn primary", "开始反推");
        const btnStop = el("button", "lgb-btn", "停止");
        btnStop.style.display = "none";
        const prog = el("div", "lgb-rev-prog");
        const progFill = document.createElement("i");
        prog.append(progFill);
        const revStatus = el("span", "lgb-rev-status", "");
        bar.append(btnStart, btnStop, prog, revStatus);

        const list = el("div", "lgb-rev-list");
        const emptyEl = el("div", "lgb-rev-empty", "");
        list.append(emptyEl);

        const foot = el("div", "lgb-rev-foot");
        const writeSel = document.createElement("select");
        [
          ["skip", "已有 .txt 就跳过"],
          ["overwrite", "覆盖（备份 .bak）"],
          ["append", "追加到末尾"],
        ].forEach(([value, text]) => writeSel.append(mkOption(value, text)));
        writeSel.value = rev.settings.writeMode || "skip";
        const msg = el("div", "msg", "");
        const btnCopyAll = el("button", "lgb-btn sm", "复制全部");
        const btnWrite = el("button", "lgb-btn primary", "写入 .txt");
        foot.append(field("写入", writeSel), msg, btnCopyAll, btnWrite);

        box.append(headEl, optsRow, bar, list, foot);
        pageReverse.append(box);

        rev.ui = { list, msg, hint };

        /* -------- 设置项 <-> localStorage -------- */
        function readOptions() {
          const settings = {
            model: modelSel.value,
            threshold: Number(thrInput.value) || 0.35,
            character: Number(charInput.value) || 0,
            mode: modeSel.value,
            tipoModel: tipoSel.value,
            prefix: prefixInput.value.trim(),
            writeMode: writeSel.value,
            underscore: underscoreChk.input.checked,
          };
          rev.settings = settings;
          saveRevSettings();
          return {
            model: settings.model,
            threshold: Math.min(0.95, Math.max(0.05, settings.threshold)),
            character_threshold: Math.min(1, Math.max(0, settings.character)),
            replace_underscore: settings.underscore,
            trailing_comma: false,
            exclude_tags: "",
            prefix: settings.prefix,
            mode: settings.mode,
            tipo_model: settings.tipoModel,
          };
        }

        function syncTipoState() {
          const available = !!rev.info?.tipo?.available;
          const wantTipo = modeSel.value !== "tags";
          tipoSel.disabled = !available || !wantTipo;
          [...modeSel.options].forEach((opt) => {
            if (opt.value === "tags") return;
            opt.disabled = !available;
          });
          if (!available && wantTipo) modeSel.value = "tags";
          const tip = rev.info?.tipo?.reason || "";
          if (available) {
            setTitle(tipoSel, "TIPO 扩写用的 gguf 模型");
          } else {
            setTitleT(tipoSel, "TIPO 不可用：{tip}", { tip });
          }
        }

        function fillModels() {
          const info = rev.info || {};
          modelSel.replaceChildren();
          (info.models || []).forEach((m) => {
            const opt = new Option(m.name, m.name);
            opt.title = m.dir || "";
            modelSel.append(opt);
          });
          const want = rev.settings.model;
          if (want && [...modelSel.options].some((o) => o.value === want)) modelSel.value = want;
          else if (info.default_model) modelSel.value = info.default_model;

          tipoSel.replaceChildren();
          (info.tipo?.models || []).forEach((m) => {
            const label = m.includes(" | ") ? m.split(" | ")[1] : m;
            const opt = new Option(label, m);
            opt.title = m;
            tipoSel.append(opt);
          });
          const wantTipo = rev.settings.tipoModel;
          if (wantTipo && [...tipoSel.options].some((o) => o.value === wantTipo)) {
            tipoSel.value = wantTipo;
          } else if (info.tipo?.default) {
            tipoSel.value = info.tipo.default;
          }
          syncTipoState();
        }

        /* -------- 结果列表 -------- */
        function makeRow(rec) {
          const row = el("div", "lgb-rev-item");
          row.dataset.path = rec.path;
          const thumbWrap = el("div", "thumb");
          const img = document.createElement("img");
          img.loading = "lazy";
          img.alt = "";
          img.src = buildUrl("/local_gallery/thumb", { path: rec.path, size: 128 });
          thumbWrap.append(img);

          const main = el("div", "main");
          const top = el("div", "row1");
          top.append(el("span", "nm", rec.name || shortName(rec.path)));
          const flags = el("div", "flags");
          if (rec.has_prompt) {
            const flag = el("span", "flag", "已有 txt");
            setTitle(flag, "这张图已经有同名提示词文件，写入方式选「跳过」就不会动它");
            flags.append(flag);
          }
          top.append(
            el("div", "lgb-head-spacer"),
            flags,
            el("span", "meta", rec.tag_count ? `${rec.tag_count} 个标签` : "")
          );

          const area = document.createElement("textarea");
          area.spellcheck = false;
          area.rows = 3;
          setPh(area, "（没有识别到内容，可以手动填）");
          const text = rev.texts.has(rec.path) ? rev.texts.get(rec.path) : rec.text || "";
          area.value = text;
          rev.texts.set(rec.path, text);
          // 内容多时把文本框撑开，省得每条都要在小框里滚动
          const autoGrow = () => {
            area.style.height = "auto";
            area.style.height = `${Math.min(200, Math.max(48, area.scrollHeight + 2))}px`;
          };
          area.addEventListener("input", () => {
            rev.texts.set(rec.path, area.value);
            autoGrow();
          });
          row.__autoGrow = autoGrow;

          const copyBtn = el("button", "lgb-link", "复制");
          setTitle(copyBtn, "复制这一条");
          copyBtn.addEventListener("click", () => {
            const text = area.value.trim();
            if (text) copyText(text, "已复制 {name}", { name: rec.name || shortName(rec.path) });
          });
          top.insertBefore(copyBtn, flags);

          main.append(top, area);
          if (rec.error) main.append(el("div", "warn", rec.error));
          row.append(thumbWrap, main);
          if (rec.error) row.classList.add("err");
          return row;
        }

        function appendRows(records) {
          if (!records.length) return;
          emptyEl.style.display = "none";
          records.forEach((rec) => {
            if (!rev.texts.has(rec.path)) rev.texts.set(rec.path, rec.text || "");
            // 占位卡已经在了，直接填内容，别再加一张
            const existing = [...list.querySelectorAll(".lgb-rev-item")].find(
              (nodeEl) => nodeEl.dataset.path === rec.path
            );
            if (existing) {
              const area = existing.querySelector("textarea");
              if (area) {
                area.value = rec.text || "";
                existing.__autoGrow?.();
              }
              const meta = existing.querySelector(".meta");
              if (meta && rec.tag_count) setTpl(meta, "{n} 个标签", { n: rec.tag_count });
              existing.classList.toggle("err", !!rec.error);
              return;
            }
            const rowEl = makeRow(rec);
            list.append(rowEl);
            rowEl.__autoGrow?.();
          });
          list.scrollTop = list.scrollHeight;
        }

        function paintEmpty() {
          if (targets.length) {
            emptyEl.style.display = "none";
            return;
          }
          emptyEl.style.display = "";
          setTpl(emptyEl, "还没有选中图片 —— 回图库点几张，再回到这里");
        }

        function paintState() {
          const running = revRunning();
          const percent = rev.total ? Math.min(100, Math.round((rev.done / rev.total) * 100)) : 0;
          progFill.style.width = `${percent}%`;
          btnStart.disabled = running || !(rev.info?.models || []).length;
          setTpl(btnStart, running ? "反推中…" : rev.results.length ? "重新反推" : "开始反推");
          btnStop.style.display = running ? "" : "none";
          btnWrite.disabled = running || !rev.results.length;
          writeSel.disabled = running;
          if (running) {
            revStatus.classList.remove("err");
            revStatus.textContent = `${rev.done} / ${rev.total}${rev.current ? ` · ${rev.current}` : ""}`;
          }
          paintEmpty();
        }

        /* -------- 轮询 -------- */
        async function poll() {
          if (!rev.job) return;
          rev.timer = null;
          try {
            const data = await apiJson(
              `/local_gallery/caption/status?job=${encodeURIComponent(rev.job)}&since=${rev.since}`
            );
            rev.since = typeof data.next === "number" ? data.next : rev.since;
            if (Array.isArray(data.results) && data.results.length) {
              rev.results.push(...data.results);
              if (rev.ui) appendRows(data.results);
            }
            const job = data.job || {};
            rev.state = job.state || "error";
            rev.total = job.total || rev.total;
            rev.done = typeof job.done === "number" ? job.done : rev.done;
            rev.current = job.current || "";
            rev.elapsed = job.elapsed || 0;
            rev.error = job.error || "";
            paintState();
            if (revRunning()) {
              rev.timer = setTimeout(poll, 420);
              return;
            }
            if (rev.state === "error") {
              revStatus.classList.add("err");
              setTpl(revStatus, "反推失败：{err}", { err: rev.error || t("未知错误") });
            } else if (rev.state === "cancelled") {
              setTpl(revStatus, "已停止 · 完成 {n} 张", { n: rev.done });
            } else {
              setTpl(revStatus, "完成 {n} 张 · 用时 {s}s", { n: rev.done, s: rev.elapsed });
            }
            rev.statusText = revStatus.textContent;
            if (activeTab !== "reverse") {
              setStatus("图片反推完成 {n} 张", { vars: { n: rev.done } });
            }
            paintState();
          } catch (err) {
            rev.state = "error";
            rev.error = String(err.message || err);
            if (rev.ui) {
              revStatus.classList.add("err");
              setTpl(revStatus, "读取进度失败：{err}", { err: rev.error });
              paintState();
            }
          }
        }

        /* -------- 动作 -------- */
        btnStart.addEventListener("click", async () => {
          const paths = [...state.selected.keys()];
          if (!paths.length) {
            revStatus.classList.add("err");
            setTpl(revStatus, "请先在图库里选图");
            return;
          }
          const options = readOptions();
          if (options.mode !== "tags" && !rev.info?.tipo?.available) {
            options.mode = "tags";
            modeSel.value = "tags";
          }
          rev.results = [];
          rev.texts.clear();
          rev.since = 0;
          rev.error = "";
          rev.statusText = "";
          list.querySelectorAll(".lgb-rev-item").forEach((row) => row.remove());
          btnStart.disabled = true;
          revStatus.classList.remove("err");
          setTpl(revStatus, "正在启动…");
          if (rev.timer) {
            clearTimeout(rev.timer);
            rev.timer = null;
          }
          rev.state = "running";
          rev.done = 0;
          rev.total = paths.length;
          rev.current = "";
          setTpl(hint, "{n} 张 · {mode} · 写到同名 .txt", {
            n: paths.length,
            mode: t(modeSel.value === "tags" ? "WD14 标签" : "TIPO 扩写"),
          });
          paintState();
          try {
            const data = await apiJson("/local_gallery/caption/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths, options }),
            });
            rev.job = data.job;
            rev.total = data.total || paths.length;
            rev.state = "running";
            paintState();
            poll();
          } catch (err) {
            rev.state = "error";
            revStatus.classList.add("err");
            setTpl(revStatus, "启动失败：{err}", { err: err.message || err });
            paintState();
          }
        });

        btnStop.addEventListener("click", async () => {
          if (!rev.job) return;
          btnStop.disabled = true;
          try {
            await apiJson("/local_gallery/caption/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ job: rev.job }),
            });
            setTpl(revStatus, "正在停止…");
          } catch (err) {
            setTpl(revStatus, "停止失败：{err}", { err: err.message || err });
          }
          btnStop.disabled = false;
        });

        btnCopyAll.addEventListener("click", () => {
          const texts = [...list.querySelectorAll("textarea")]
            .map((area) => area.value.trim())
            .filter(Boolean);
          if (!texts.length) {
            setTpl(msg, "没有可复制的内容");
            msg.classList.add("warn");
            return;
          }
          copyText(texts.join("\n\n"), "已复制 {n} 条反推结果", { n: texts.length });
        });

        btnWrite.addEventListener("click", async () => {
          const rows = [...list.querySelectorAll(".lgb-rev-item")];
          const items = rows
            .map((row) => ({
              path: row.dataset.path,
              text: (row.querySelector("textarea")?.value || "").trim(),
            }))
            .filter((it) => it.text);
          if (!items.length) {
            setTpl(msg, "还没有内容可写入");
            msg.classList.add("warn");
            return;
          }
          const mode = writeSel.value;
          btnWrite.disabled = true;
          setTpl(btnWrite, "写入中…");
          msg.classList.remove("warn");
          msg.textContent = "";
          try {
            const data = await apiJson("/local_gallery/caption/write", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ items, mode, ext: ".txt" }),
            });
            const written = data.written || [];
            const skipped = data.skipped || [];
            const failed = data.failed || [];

            // 让网格上的 TXT 角标马上变绿，不用重新扫描
            written.forEach((entry) => {
              const item = state.items.find((it) => it.path === entry.path);
              if (item) {
                item.has_prompt = true;
                item.has_prompt_file = true;
              }
              state.promptCache.delete(entry.path);
              const dom = [...grid.querySelectorAll(".lgb-item")].find(
                (nodeEl) => nodeEl.dataset.path === entry.path
              );
              const badge = dom?.querySelector(".lgb-txt");
              if (badge) {
                badge.textContent = "TXT";
                badge.classList.remove("off");
                setTitle(badge, "有同名提示词文件");
              }
              const rowEl = [...list.querySelectorAll(".lgb-rev-item")].find(
                (nodeEl) => nodeEl.dataset.path === entry.path
              );
              const flagBox = rowEl?.querySelector(".flags");
              if (flagBox && !flagBox.querySelector(".flag")) {
                const flag = el("span", "flag", "已有 txt");
                setTitle(flag, "这张图已经有同名提示词文件，写入方式选「跳过」就不会动它");
                flagBox.append(flag);
              }
            });
            updateTabCounts();

            const summary =
              t("写入 {n} 个 .txt", { n: written.length }) +
              (skipped.length ? t(" · 跳过 {n} 个已有", { n: skipped.length }) : "") +
              (failed.length ? t(" · 失败 {n}", { n: failed.length }) : "");
            setLabel(msg, summary);
            msg.classList.toggle("warn", failed.length > 0);
            if (failed.length) msg.title = failed.map((f) => `${f.path}: ${f.error}`).join("\n");
            setStatus(summary, { error: failed.length > 0, hint: msg.title });
            if (activeTab === "prompts") renderPrompts({ reset: true });
          } catch (err) {
            setTpl(msg, "写入失败：{err}", { err: err.message || err });
            msg.classList.add("warn");
          } finally {
            btnWrite.disabled = false;
            setTpl(btnWrite, writeSel.value === "overwrite" ? "覆盖写入 .txt" : "写入 .txt");
          }
        });

        modeSel.addEventListener("change", syncTipoState);
        writeSel.addEventListener("change", () => {
          rev.settings.writeMode = writeSel.value;
          saveRevSettings();
          setTpl(btnWrite, writeSel.value === "overwrite" ? "覆盖写入 .txt" : "写入 .txt");
        });

        /* -------- 初始化 -------- */
        setTpl(btnWrite, writeSel.value === "overwrite" ? "覆盖写入 .txt" : "写入 .txt");
        thrInput.value = String(rev.settings.threshold);
        charInput.value = String(rev.settings.character);
        // 先把选中的图都列出来：有结果的填上，没跑过的留空待反推
        targets.forEach((path) => {
          const rec = rev.results.find((item) => item.path === path) || placeholderFor(path);
          const rowEl = makeRow(rec);
          list.append(rowEl);
          rowEl.__autoGrow?.();
        });
        paintState();
        if (revRunning()) setTpl(revStatus, "接着上次的进度…");
        else if (rev.statusText) revStatus.textContent = rev.statusText;

        try {
          if (!rev.info) rev.info = await apiJson("/local_gallery/caption/info");
          fillModels();
          if (!(rev.info.models || []).length) {
            setTpl(hint, "没有可用的打标模型：需要 ComfyUI-WD14-Tagger 的 models 目录里有 .onnx + .csv");
            revStatus.classList.add("err");
            setTpl(revStatus, "反推不可用");
          } else if (!rev.info.tipo?.available) {
            setTpl(revStatus, "TIPO 不可用，只能用 WD14 标签");
          }
        } catch (err) {
          setTpl(hint, "读取反推配置失败：{err}", { err: err.message || err });
        }
        paintState();
        if (rev.job && revRunning()) poll();
      }

      /* ---------------- 历史文件夹 ---------------- */
      const RECENT_KEY = "localGalleryBrowser.recent";

      // 条数走 config.json 的 recent_limit（设置面板可改）
      function recentLimit() {
        const value = Number(cfg.recent_limit);
        return Number.isFinite(value) && value >= 3 ? Math.min(50, Math.round(value)) : 12;
      }

      function loadRecent() {
        try {
          const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
          return Array.isArray(raw) ? raw.filter((v) => typeof v === "string" && v.trim()) : [];
        } catch (err) {
          return [];
        }
      }

      function pushRecent(path) {
        const value = String(path || "").trim();
        if (!value) return loadRecent();
        const list = [
          value,
          ...loadRecent().filter((v) => v.toLowerCase() !== value.toLowerCase()),
        ].slice(0, recentLimit());
        try {
          localStorage.setItem(RECENT_KEY, JSON.stringify(list));
        } catch (err) {
          /* 忽略 */
        }
        return list;
      }

      function openRecent() {
        const overlay = mkOverlay();
        const box = el("div", "lgb-confirm");
        const list = loadRecent();

        const body = el("div", "body");
        const wrapBtns = el("div", "lgb-recent");
        if (!list.length) {
          setTpl(body, "还没有历史记录。在「设置」里浏览过文件夹之后就会出现在这里。");
        } else {
          setTpl(body, "点一个文件夹就加入路径列表并扫描：");
          list.forEach((path) => {
            const btn = el("button", "lgb-btn", path);
            btn.title = path;
            btn.addEventListener("click", () => {
              overlay.remove();
              addPaths([path]);
            });
            wrapBtns.append(btn);
          });
        }

        const foot = el("div", "foot");
        const btnClear = el("button", "lgb-btn", "清空历史");
        const btnClose = el("button", "lgb-btn primary", "关闭");
        btnClear.style.display = list.length ? "" : "none";
        btnClear.addEventListener("click", () => {
          try {
            localStorage.removeItem(RECENT_KEY);
          } catch (err) {
            /* 忽略 */
          }
          overlay.remove();
          setStatus("历史记录已清空");
        });
        btnClose.addEventListener("click", () => overlay.remove());
        foot.append(btnClear, btnClose);

        box.append(el("h3", "", "最近浏览的文件夹"), body, wrapBtns, foot);
        overlay.append(box);
        document.body.appendChild(overlay);
        const closeRecent = () => overlay.remove();
        const offRecent = closeOnOutside(overlay, box, closeRecent);
        overlay.addEventListener("click", (evt) => {
          if (evt.target === overlay) {
            offRecent();
            closeRecent();
          }
        });
      }

      /* ---------------- 选文件夹（只选目录，给导出目标用） ---------------- */
      function pickFolder(initial, onPick) {
        const overlay = mkOverlay();
        const box = el("div", "lgb-confirm lgb-pick");

        const headEl = el("div", "lgb-set-head");
        const btnClose = el("button", "lgb-btn sm warn", "关闭");
        setTitle(btnClose, "关闭（Esc / 点外面也行）");
        btnClose.addEventListener("click", () => overlay.remove());
        headEl.append(el("h3", "", "选择文件夹"), el("div", "lgb-head-spacer"), btnClose);

        const pathInput = document.createElement("input");
        pathInput.type = "text";
        pathInput.className = "lgb-set-input";
        setPh(pathInput, "直接填路径，回车跳转");
        pathInput.value = initial || "";

        const btnUp = el("button", "lgb-btn ic");
        btnUp.append(icon("up", 13));
        setTitle(btnUp, "上一级");
        const btnGo = el("button", "lgb-btn", "转到");
        const row = el("div", "lgb-set-row");
        row.append(btnUp, pathInput, btnGo);

        const list = el("div", "lgb-pick-list");
        const msg = el("span", "lgb-set-msg", "");

        let current = "";
        let parent = null;

        function paintDirs(dirs, drives) {
          list.replaceChildren();
          const entries = [];
          (drives || []).forEach((d) => entries.push({ label: d, path: d }));
          (dirs || []).forEach((d) => entries.push({ label: d.name, path: d.path }));
          if (!entries.length) {
            list.append(el("div", "lgb-pick-empty", "这个目录下没有子文件夹"));
            return;
          }
          entries.forEach((entry) => {
            const btn = el("button", "lgb-pick-item");
            btn.append(icon("folder", 13), document.createTextNode(entry.label));
            btn.title = entry.path;
            btn.addEventListener("click", () => load(entry.path));
            list.append(btn);
          });
        }

        async function load(path) {
          setTpl(msg, "读取中…");
          msg.classList.remove("err");
          try {
            const data = await apiJson(
              `/local_gallery/browse?path=${encodeURIComponent(path || "")}`
            );
            if (!data.ok) {
              msg.textContent = data.error || "读取失败";
              msg.classList.add("err");
              return;
            }
            current = data.path || "";
            parent = data.parent;
            pathInput.value = current;
            btnUp.disabled = !current;
            paintDirs(current ? data.dirs : [], current ? [] : data.drives);
            msg.textContent = current ? "" : "选一个盘符开始";
          } catch (err) {
            setTpl(msg, "读取失败：{err}", { err: err.message || err });
            msg.classList.add("err");
          }
        }

        btnUp.addEventListener("click", () => load(parent || ""));
        btnGo.addEventListener("click", () => load(pathInput.value.trim()));
        pathInput.addEventListener("keydown", (evt) => {
          if (evt.key === "Enter") {
            evt.preventDefault();
            load(pathInput.value.trim());
          }
        });

        const foot = el("div", "lgb-set-row");
        const btnOk = el("button", "lgb-btn primary", "选这个文件夹");
        btnOk.addEventListener("click", () => {
          const chosen = (current || pathInput.value).trim();
          if (!chosen) {
            setTpl(msg, "先进入一个文件夹");
            msg.classList.add("err");
            return;
          }
          overlay.remove();
          onPick?.(chosen);
        });
        foot.append(btnOk, msg);

        box.append(headEl, row, list, foot);
        overlay.append(box);
        document.body.appendChild(overlay);
        const closePick = () => overlay.remove();
        const offOutside = closeOnOutside(overlay, box, closePick);
        overlay.addEventListener("click", (evt) => {
          if (evt.target === overlay) {
            offOutside();
            closePick();
          }
        });
        load(initial || "");
      }

      /* ---------------- 设置面板 ---------------- */
      function openSettings() {
        const overlay = mkOverlay();
        const box = el("div", "lgb-confirm lgb-settings");

        const headEl = el("div", "lgb-set-head");
        const btnClose = el("button", "lgb-btn sm warn", "关闭");
        setTitle(btnClose, "关闭设置（Esc / 点外面也行）");
        headEl.append(el("h3", "", "设置"), el("div", "lgb-head-spacer"), btnClose);

        const body = el("div", "lgb-set-body");

        function rowWith(...children) {
          const row = el("div", "lgb-set-row");
          row.append(...children);
          return row;
        }

        /* —— 外观：界面语言 / 明暗主题 / 附加说明 —— */
        const secTheme = el("section", "lgb-set-sec");

        /* 界面语言：中文 / English，切了立刻生效并记在浏览器里 */
        const rowLang = el("div", "lgb-set-row");
        rowLang.append(el("span", "lb", "界面语言"));
        const segLang = el("div", "lgb-seg");
        const langBtns = new Map();
        [
          ["zh", "中文"],
          ["en", "English"],
        ].forEach(([key, label]) => {
          const btn = el("button", "lgb-seg-btn", label);
          btn.dataset.key = key;
          btn.addEventListener("click", () => {
            lang = key === "en" ? "en" : "zh";
            applyLang();
            setStatus(t("语言已切换：{name}", { name: lang === "en" ? "English" : "中文" }));
          });
          langBtns.set(key, btn);
          segLang.append(btn);
        });
        langSegSync = () => langBtns.forEach((node, k) => node.classList.toggle("on", k === lang));
        langSegSync();
        rowLang.append(segLang);

        const rowTheme = el("div", "lgb-set-row");
        rowTheme.append(el("span", "lb", "主题"));
        const seg = el("div", "lgb-seg");
        const THEME_OPTIONS = [
          ["auto", "跟随 ComfyUI", "auto"],
          ["light", "浅色", "sun"],
          ["dark", "深色", "moon"],
        ];
        const themeBtns = new Map();
        THEME_OPTIONS.forEach(([key, label, ico]) => {
          const btn = el("button", "lgb-seg-btn");
          btn.append(icon(ico, 13), tspan(label));
          btn.dataset.key = key;
          btn.addEventListener("click", () => {
            setThemePref(key);
            themeBtns.forEach((node, k) => node.classList.toggle("on", k === key));
          });
          themeBtns.set(key, btn);
          seg.append(btn);
        });
        themeBtns.forEach((node, k) => node.classList.toggle("on", k === themePref));
        rowTheme.append(seg);

        /* 附加说明：关掉后把各项下方的解释文字全部收起来，只留控件 */
        const chkHints = mkCheck("显示附加说明", showHints);
        setTitle(chkHints.label, "关掉后隐藏设置和转换页里每项下面的解释文字，界面更紧凑");
        chkHints.input.addEventListener("change", () => {
          showHints = chkHints.input.checked;
          applyHints(true);
          setStatus(showHints ? "已显示各项说明" : "已隐藏各项说明");
        });
        const rowHints = el("div", "lgb-set-row");
        rowHints.append(el("span", "lb", "文字说明"), chkHints.label);

        secTheme.append(
          el("div", "ttl", "外观"),
          rowLang,
          rowTheme,
          rowHints,
          el("p", "desc", "「跟随 ComfyUI」会随 ComfyUI 的深浅色自动切换；另外两个是强制。")
        );

        /* —— 收藏：导出到指定文件夹 —— */
        const secFav = el("section", "lgb-set-sec");
        const favInput = document.createElement("input");
        favInput.type = "text";
        favInput.className = "lgb-set-input";
        setPh(favInput, "例如 D:\\AI\\exports\\favorites");
        favInput.value = uiSettings.favorites_export_dir || "";
        const btnPickFav = el("button", "lgb-btn");
        btnPickFav.append(icon("folder", 13), tspan("选择"));
        setTitle(btnPickFav, "选择导出目标文件夹");
        btnPickFav.addEventListener("click", () => {
          pickFolder(favInput.value, (chosen) => {
            favInput.value = chosen;
            saveFavDir();
          });
        });
        const favRow = el("div", "lgb-set-row");
        favRow.append(el("span", "lb", "目标文件夹"), favInput, btnPickFav);

        /* 导出范围：全部 / 未分类 / 某个收藏夹 */
        const SCOPE_KEY = "localGalleryBrowser.exportScope";
        let exportScope = "all";
        try {
          const saved = localStorage.getItem(SCOPE_KEY);
          if (saved) exportScope = saved;
        } catch (err) {
          /* 忽略 */
        }
        const favScopeSel = document.createElement("select");
        favScopeSel.className = "lgb-set-input";
        setTitle(favScopeSel, "导出哪些收藏：全部 / 未分类 / 某一个收藏夹");

        function scopeCount(scope) {
          if (scope === "all") return state.favorites?.size || 0;
          if (scope === "none") return state.favUnclassified || 0;
          const hit = (state.folders || []).find((f) => f.id === scope);
          return hit ? hit.count || 0 : 0;
        }

        function paintScopeOptions() {
          const total = state.favorites?.size || 0;
          const opts = [
            ["all", t("全部收藏（{n} 张）", { n: total })],
            ["none", t("未分类（{n} 张）", { n: state.favUnclassified || 0 })],
            ...(state.folders || []).map((f) => [f.id, t("{name}（{n} 张）", { name: f.name, n: f.count || 0 })]),
          ];
          // 选的夹被删了就回到「全部」
          if (!opts.some(([key]) => key === exportScope)) exportScope = "all";
          favScopeSel.replaceChildren(
            ...opts.map(([key, label]) => {
              const opt = document.createElement("option");
              opt.value = key;
              opt.textContent = label;
              if (key === exportScope) opt.selected = true;
              return opt;
            })
          );
        }
        paintScopeOptions();

        const favScopeRow = el("div", "lgb-set-row");
        favScopeRow.append(el("span", "lb", "导出范围"), favScopeSel);

        const btnExportFav = el("button", "lgb-btn primary");
        const favCount = state.favorites?.size || 0;
        btnExportFav.append(icon("save", 13), elTpl("span", "", "导出收藏 ({n})", { n: favCount }));
        btnExportFav.disabled = !favCount || !favInput.value.trim();
        setTitle(
          btnExportFav,
          !favCount
            ? "还没有收藏的图片"
            : !favInput.value.trim()
              ? "先设置目标文件夹"
              : "把收藏的图片和同名提示词复制过去"
        );

        function syncExportBtn() {
          const n = scopeCount(exportScope);
          const label = btnExportFav.querySelector("span[data-i18n-tpl]");
          setTpl(label || btnExportFav, "导出收藏 ({n})", { n });
          btnExportFav.disabled = !n || !favInput.value.trim();
          setTitle(
            btnExportFav,
            !n
              ? "这个范围里没有图片"
              : !favInput.value.trim()
                ? "先设置目标文件夹"
                : "把这一范围里的收藏图片和同名提示词复制过去"
          );
        }
        syncExportBtn();

        favScopeSel.addEventListener("change", () => {
          exportScope = favScopeSel.value;
          try {
            localStorage.setItem(SCOPE_KEY, exportScope);
          } catch (err) {
            /* 忽略 */
          }
          syncExportBtn();
        });
        const favMsg = el("span", "lgb-set-msg", "");

        function saveFavDir() {
          const value = favInput.value.trim();
          uiSettings.favorites_export_dir = value;
          btnExportFav.disabled = !(state.favorites?.size || 0) || !value;
          apiJson("/local_gallery/ui/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ favorites_export_dir: value }),
          }).catch(() => {
            setTpl(favMsg, "目录已填，但保存失败（重启后可能丢失）");
            favMsg.classList.add("err");
          });
        }

        favInput.addEventListener("change", saveFavDir);
        favInput.addEventListener("blur", saveFavDir);

        btnExportFav.addEventListener("click", async () => {
          const dest = favInput.value.trim();
          if (!dest) {
            setTpl(favMsg, "先设置目标文件夹");
            favMsg.classList.add("err");
            return;
          }
          btnExportFav.disabled = true;
          favMsg.classList.remove("err");
          setTpl(favMsg, "导出中…");
          try {
            const data = await apiJson("/local_gallery/favorites/export", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ dest, overwrite: false, folder: exportScope }),
            });
            const copied = (data.copied || []).length;
            const skipped = (data.skipped || []).length;
            const failed = (data.failed || []).length;
            setLabel(
              favMsg,
              t("已复制 {n} 张", { n: copied }) +
                (skipped ? t(" · 跳过 {n}", { n: skipped }) : "") +
                (failed ? t(" · 失败 {n}", { n: failed }) : "")
            );
            favMsg.classList.toggle("err", failed > 0);
            setStatus("收藏已导出到 {dest}", { vars: { dest: data.dest || dest } });
          } catch (err) {
            setTpl(favMsg, "导出失败：{err}", { err: err.message || err });
            favMsg.classList.add("err");
          } finally {
            btnExportFav.disabled = !(state.favorites?.size || 0) || !favInput.value.trim();
          }
        });

        secFav.append(
          el("div", "ttl", "收藏"),
          favRow,
          favScopeRow,
          el(
            "p",
            "desc",
            "把收藏的图片和同名提示词「复制」到这个文件夹，原文件不动；同名文件默认跳过，不覆盖。导出范围可以只选某一个收藏夹。"
          ),
          rowWith(btnExportFav, favMsg)
        );

        /* —— 运行参数：对应节点目录的 config.json —— */
        const secCfg = el("section", "lgb-set-sec");
        const cfgInputs = {};

        function numRow(label, key, low, high, unit) {
          const input = document.createElement("input");
          input.type = "number";
          input.className = "lgb-set-input num";
          input.min = String(low);
          input.max = String(high);
          input.step = "1";
          input.value = String(cfg[key] ?? CONFIG_DEFAULTS[key]);
          input.title = `${low} ~ ${high}`;
          cfgInputs[key] = input;
          const row = el("div", "lgb-set-row");
          row.append(el("span", "lb wide", label), input, el("span", "unit", unit || ""));
          return row;
        }

        const trashInput = document.createElement("input");
        trashInput.type = "text";
        trashInput.className = "lgb-set-input";
        setPh(trashInput, "留空 = 节点目录下的 .trash");
        trashInput.value = cfg.trash_dir || "";
        const btnPickTrash = el("button", "lgb-btn sm");
        btnPickTrash.append(icon("folder", 12), tspan("选择"));
        setTitle(btnPickTrash, "选择回收站目录");
        btnPickTrash.addEventListener("click", () => {
          pickFolder(trashInput.value, (chosen) => {
            trashInput.value = chosen;
          });
        });
        const trashRow = el("div", "lgb-set-row");
        trashRow.append(el("span", "lb wide", "回收站目录"), trashInput, btnPickTrash);

        const trashHint = el("p", "desc", "删除的图片和提示词都进这里，不是永久删除。");
        // 实际生效的路径单独一行：关掉「附加说明」时这行仍然留着（它是数据，不是解释）
        const trashPath = el("p", "lgb-pathhint", "");

        const chkAllow = mkCheck("允许删除（移到回收站）", cfg.allow_delete !== false);

        const chkAuto = mkCheck("启用", !!cfg.auto_select_when_empty.enabled);
        const autoLimit = document.createElement("input");
        autoLimit.type = "number";
        autoLimit.className = "lgb-set-input num";
        autoLimit.min = "1";
        autoLimit.max = "64";
        autoLimit.step = "1";
        autoLimit.value = String(cfg.auto_select_when_empty.limit || 4);
        autoLimit.title = "1 ~ 64";
        const chkAutoSub = mkCheck("含子目录", !!cfg.auto_select_when_empty.recursive);
        const autoRow = el("div", "lgb-set-row");
        autoRow.append(
          el("span", "lb wide", "空选兜底"),
          chkAuto.label,
          autoLimit,
          el("span", "unit", "张"),
          chkAutoSub.label
        );

        secCfg.append(
          el("div", "ttl", "运行参数（写进 config.json）"),
          numRow("缩略图尺寸", "thumb_size", 96, 640, "px"),
          numRow("缩略图质量", "thumb_quality", 40, 95, ""),
          numRow("扫描上限", "max_scan_files", 100, 500000, "张"),
          numRow("单图最大边", "max_image_side", 512, 65536, "px"),
          numRow("最近浏览", "recent_limit", 3, 50, "条"),
          trashRow,
          trashHint,
          trashPath,
          rowWith(chkAllow.label),
          autoRow,
          el(
            "p",
            "desc",
            "缩略图尺寸 = 网格缩略图的长边像素（越大越清晰，磁盘缓存也越大）；质量 40–95，数值越高质量越好、体积越大。扫描上限 = 一次最多读多少个文件，超出会截断；单图最大边 = 超过这个尺寸的图在节点执行时跳过（省显存），不影响预览。"
          )
        );

        /* —— 高级：目录白名单 —— */
        const secAdv = el("section", "lgb-set-sec");
        const rootsInput = document.createElement("textarea");
        rootsInput.className = "lgb-set-input";
        rootsInput.rows = 3;
        rootsInput.spellcheck = false;
        setPh(rootsInput, "每行一个绝对路径，留空 = 允许本机任意路径");
        rootsInput.value = (cfg.allowed_roots || []).join("\n");
        const rootsRow = el("div", "lgb-set-row");
        rootsRow.append(el("span", "lb wide", "允许访问的根目录"), rootsInput);
        secAdv.append(
          el("div", "ttl", "高级"),
          rootsRow,
          el(
            "p",
            "desc",
            "留空 = 不限制。填了以后，浏览 / 扫描 / 删除只认这些目录（含子目录）里的文件；填错会导致路径全部失效，所以保存前请确认目录真实存在。"
          )
        );

        const cfgMsg = el("span", "lgb-set-msg", "");
        const btnSaveCfg = el("button", "lgb-btn primary", "保存运行参数");
        const btnResetCfg = el("button", "lgb-btn sm", "恢复默认值");

        function cfgFromForm() {
          return {
            thumb_size: cfgInputs.thumb_size.value,
            thumb_quality: cfgInputs.thumb_quality.value,
            max_scan_files: cfgInputs.max_scan_files.value,
            max_image_side: cfgInputs.max_image_side.value,
            recent_limit: cfgInputs.recent_limit.value,
            trash_dir: trashInput.value.trim(),
            allow_delete: chkAllow.input.checked,
            allowed_roots: rootsInput.value,
            auto_select_when_empty: {
              enabled: chkAuto.input.checked,
              limit: autoLimit.value,
              recursive: chkAutoSub.input.checked,
            },
          };
        }

        // 回填表单：默认用当前已保存的 cfg，也可以传一份临时值（恢复默认值用，不动 cfg）
        function fillCfgForm(source = cfg) {
          Object.keys(cfgInputs).forEach((key) => {
            cfgInputs[key].value = String(source[key] ?? CONFIG_DEFAULTS[key]);
          });
          const auto = source.auto_select_when_empty || CONFIG_DEFAULTS.auto_select_when_empty;
          trashInput.value = source.trash_dir || "";
          chkAllow.input.checked = source.allow_delete !== false;
          chkAuto.input.checked = !!auto.enabled;
          autoLimit.value = String(auto.limit || 4);
          chkAutoSub.input.checked = !!auto.recursive;
          rootsInput.value = (source.allowed_roots || []).join("\n");
          // 存模板 + 变量，切语言时 applyLangNodes 会按新语言重拼
          const eff = cfg.trash_dir_effective || "—";
          trashPath.dataset.i18nStatus = "当前生效：{path}";
          trashPath.dataset.i18nStatusVars = JSON.stringify({ path: eff });
          setTpl(trashPath, "当前生效：{path}", { path: eff });
          setTitleT(trashPath, "当前生效：{path}", { path: eff });
        }

        btnResetCfg.addEventListener("click", () => {
          // 只把表单填成默认值，保存前 cfg 保持原样（避免"恢复默认值但没保存"就改了运行状态）
          const defaults = JSON.parse(JSON.stringify(CONFIG_DEFAULTS));
          fillCfgForm(defaults);
          cfgMsg.classList.remove("err");
          setTpl(cfgMsg, "已填回默认值，记得点「保存运行参数」");
        });

        btnSaveCfg.addEventListener("click", async () => {
          btnSaveCfg.disabled = true;
          btnResetCfg.disabled = true;
          cfgMsg.classList.remove("err");
          setTpl(cfgMsg, "保存中…");
          const beforeThumb = thumbSize();
          try {
            const data = await saveConfig(cfgFromForm());
            const remote = data?.config || {};
            const auto = remote.auto_select_when_empty || {};
            Object.assign(cfg, remote);
            cfg.auto_select_when_empty = {
              enabled: !!auto.enabled,
              limit: Number(auto.limit) || 4,
              recursive: !!auto.recursive,
            };
            cfg.allowed_roots = Array.isArray(remote.allowed_roots) ? remote.allowed_roots : [];
            fillCfgForm();
            // 缩略图边长变了就直接按新尺寸重排一次（缓存 key 带 size，会自动重新生成）
            if (thumbSize() !== beforeThumb) {
              state.rendered = 0;
              renderGrid();
            }
            setTpl(cfgMsg, "已写入 config.json");
            setStatus("运行参数已保存");
          } catch (err) {
            setTpl(cfgMsg, "保存失败：{err}", { err: err.message || err });
            cfgMsg.classList.add("err");
          } finally {
            btnSaveCfg.disabled = false;
            btnResetCfg.disabled = false;
          }
        });

        const cfgFoot = rowWith(btnSaveCfg, btnResetCfg, cfgMsg);

        // 建好就按当前配置填一遍表单（否则「当前生效：」那行是空的）
        fillCfgForm();

        /* —— 浏览本机路径：原来路径栏那个「浏览」按钮搬到这里 —— */
        const secBrowse = el("section", "lgb-set-sec");
        const btnPickDir = el("button", "lgb-btn primary");
        btnPickDir.append(icon("folder", 13), tspan("选择文件夹…"));
        setTitle(btnPickDir, "弹 Windows 自带的文件夹选择框（按住 Ctrl 可多选），选完加入路径列表");
        btnPickDir.addEventListener("click", () => {
          // 先收起设置，免得两层窗口叠着挡住系统选择框
          window.removeEventListener("keydown", onKey);
          closeSettings();
          pickFolderNative(btnPickDir);
        });
        const btnOpenBrowser = el("button", "lgb-btn");
        btnOpenBrowser.append(icon("expand", 13), tspan("面板内浏览"));
        setTitle(btnOpenBrowser, "下钻目录、加单张图片、管理已加入的路径");
        btnOpenBrowser.addEventListener("click", () => {
          window.removeEventListener("keydown", onKey);
          closeSettings();
          openBrowser(getPaths()[0] || "");
        });
        /* 扫描范围：原来在筛选行的两个复选框 */
        const chkRecursive = mkCheck("含子目录", recursiveChk.input.checked);
        setTitle(chkRecursive.label, "连路径下的子文件夹一起扫描");
        chkRecursive.input.addEventListener("change", () => {
          recursiveChk.input.checked = chkRecursive.input.checked;
          refresh();
        });
        const chkOnlyPrompt = mkCheck("仅有提示词", onlyPromptChk.input.checked);
        setTitle(chkOnlyPrompt.label, "只列出有同名 .txt 提示词的图片");
        chkOnlyPrompt.input.addEventListener("change", () => {
          onlyPromptChk.input.checked = chkOnlyPrompt.input.checked;
          refresh();
        });

        secBrowse.append(
          el("div", "ttl", "浏览本机路径"),
          rowWith(el("span", "lb", "选择文件夹"), btnPickDir),
          rowWith(el("span", "lb", "面板内浏览"), btnOpenBrowser),
          rowWith(el("span", "lb", "扫描"), chkRecursive.label, chkOnlyPrompt.label),
          el(
            "p",
            "desc",
            "「选择文件夹」弹 Windows 自带的选择框（可多选），选完直接加进路径列表；「面板内浏览」可以看某个目录里的图片、只加单张、管理已加入的路径。「含子目录」连子文件夹一起扫，「仅有提示词」只列有同名 .txt 的图。"
          )
        );

        body.append(secBrowse, secTheme, secFav, secCfg, secAdv, cfgFoot);
        box.append(headEl, body);
        overlay.append(box);
        document.body.appendChild(overlay);

        /* 关闭方式：右上角「关闭」按钮，或者按 Esc。点空白处不关，
           免得调参数的时候手一滑点到面板外面就没了。 */
        const closeSettings = () => overlay.remove();
        const onKey = (evt) => {
          if (evt.key !== "Escape") return;
          evt.preventDefault();
          closeSettings();
        };
        window.addEventListener("keydown", onKey);
        btnClose.addEventListener("click", () => {
          window.removeEventListener("keydown", onKey);
          closeSettings();
        });
      }

      /* ---------------- 转换 / 压缩（独立页面） ----------------
         编码与压缩参数沿用 ComfyUI-ImageToolkit-CN 的保存节点：
         质量模式 / 按体积二分查找最高画质 / 必要时降分辨率。 */
      const CONV_KEY = "localGalleryBrowser.convert";
      const CONV_DEFAULTS = {
        format: "WEBP",
        mode: "按质量",
        quality: 85,
        target_kb: 300,
        allow_shrink: true,
        scale: "不缩放",
        long_side: 1024,
        percent: 100,
        align: "不对齐",
        output: "同目录 · 新文件",
        out_dir: "",
        with_prompt: true,
      };
      const CONV_FORMATS = ["保持原格式", "JPG", "WEBP", "PNG", "BMP", "TIFF", "GIF"];

      function loadConvSettings() {
        try {
          const raw = JSON.parse(localStorage.getItem(CONV_KEY) || "{}");
          const merged = { ...CONV_DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
          if (!CONV_FORMATS.includes(merged.format)) merged.format = CONV_DEFAULTS.format;
          return merged;
        } catch (err) {
          return { ...CONV_DEFAULTS };
        }
      }

      function saveConvSettings(opts) {
        try {
          localStorage.setItem(CONV_KEY, JSON.stringify(opts));
        } catch (err) {
          /* 忽略 */
        }
      }

      function humanBytes(num) {
        const n = Number(num) || 0;
        if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
        if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${n} B`;
      }

      const conv = {
        built: false,
        scope: "all", // selected | all
        job: null,
        since: 0,
        timer: null,
        failed: [],
        ui: null,
      };

      function convCounts() {
        return { selected: state.selected.size, all: visibleItems().length };
      }

      // 选中数 / 列表数变了，页面上的按钮和提示跟着变
      function syncConvertPage() {
        const ui = conv.ui;
        if (!ui) return;
        const { selected, all } = convCounts();
        if (conv.scope === "selected" && !selected) conv.scope = all ? "all" : "selected";
        setTpl(ui.btnSelected, "选中的 {n} 张", { n: selected });
        setTpl(ui.btnAll, "当前列表 {n} 张", { n: all });
        ui.btnSelected.disabled = !selected;
        ui.btnAll.disabled = !all;
        ui.scopeSeg.paint(conv.scope);
        setTpl(
          ui.hint,
          all
            ? "当前列表 {all} 张 · 已选 {sel} 张 · 原图默认保留"
            : "当前列表没有图片 —— 先在图库加一个文件夹",
          { all, sel: selected }
        );
        ui.start.disabled = !!conv.job || !(conv.scope === "selected" ? selected : all);
      }

      function ensureConvertPage() {
        if (!conv.built) mountConvertPage();
        syncConvertPage();
      }

      function mountConvertPage() {
        if (conv.built) return;
        conv.built = true;
        pageConvert.replaceChildren();

        const opt = loadConvSettings();
        const box = el("div", "lgb-conv-page lgb-settings");

        /* —— 头部 —— */
        const headEl = el("div", "lgb-conv-head");
        const hintEl = el("div", "hint", "");
        const startBtn = el("button", "lgb-btn primary", "开始转换");
        headEl.append(el("h3", "", "转换 / 压缩"), hintEl, startBtn);

        const body = el("div", "lgb-set-body");
        function rowWith(...children) {
          const row = el("div", "lgb-set-row");
          row.append(...children);
          return row;
        }
        function segGroup(choices, value, onPick) {
          const wrap = el("div", "lgb-seg");
          const btns = new Map();
          choices.forEach(([key, label]) => {
            const btn = el("button", "lgb-seg-btn", label);
            btn.dataset.key = key;
            btn.addEventListener("click", () => {
              if (btn.disabled) return;
              onPick(key);
            });
            btns.set(key, btn);
            wrap.append(btn);
          });
          const paint = (current) => btns.forEach((b, k) => b.classList.toggle("on", k === current));
          paint(value);
          return { wrap, btns, paint };
        }

        /* —— 范围 —— */
        const scopeSeg = segGroup(
          [
            ["selected", "选中的 0 张"],
            ["all", "当前列表 0 张"],
          ],
          conv.scope,
          (key) => {
            conv.scope = key;
            syncConvertPage();
          }
        );
        const secScope = el("section", "lgb-set-sec");
        secScope.append(el("div", "ttl", "范围"), rowWith(el("span", "lb wide", "处理"), scopeSeg.wrap));

        /* —— 格式 —— */
        const fmtSel = document.createElement("select");
        CONV_FORMATS.forEach((name) => fmtSel.append(mkOption(name, name)));
        fmtSel.value = opt.format;
        const secFormat = el("section", "lgb-set-sec");
        secFormat.append(
          el("div", "ttl", "格式"),
          rowWith(el("span", "lb wide", "目标格式"), fmtSel),
          el(
            "p",
            "desc",
            "保持原格式 = 只压缩不动格式；其它格式互转。JPG/BMP 会去掉透明通道并垫白底，GIF 会转 256 色。"
          )
        );

        /* —— 压缩 —— */
        const modeSeg = segGroup(
          [
            ["按质量", "按质量"],
            ["按体积", "按体积"],
          ],
          opt.mode,
          (key) => {
            opt.mode = key;
            modeSeg.paint(key);
            applyMode();
          }
        );

        const qualityInput = document.createElement("input");
        qualityInput.type = "range";
        qualityInput.className = "lgb-slider";
        qualityInput.min = "1";
        qualityInput.max = "100";
        qualityInput.step = "1";
        qualityInput.value = String(opt.quality);
        const qualityVal = el("span", "unit", String(opt.quality));
        qualityInput.addEventListener("input", () => {
          qualityVal.textContent = qualityInput.value;
        });
        const qualityRow = el("div", "lgb-set-row");
        qualityRow.append(el("span", "lb wide", "质量"), qualityInput, qualityVal);

        const sizeInput = document.createElement("input");
        sizeInput.type = "number";
        sizeInput.className = "lgb-set-input num";
        sizeInput.min = "1";
        sizeInput.max = "20480";
        sizeInput.step = "10";
        sizeInput.value = String(opt.target_kb);
        const shrinkChk = mkCheck("压不进去时允许降分辨率", opt.allow_shrink !== false);
        const sizeRow = el("div", "lgb-set-row");
        sizeRow.append(el("span", "lb wide", "目标体积"), sizeInput, el("span", "unit", "KB"));

        const secComp = el("section", "lgb-set-sec");
        secComp.append(
          el("div", "ttl", "压缩"),
          rowWith(el("span", "lb wide", "方式"), modeSeg.wrap),
          qualityRow,
          sizeRow,
          rowWith(shrinkChk.label),
          el(
            "p",
            "desc",
            "按质量：滑块直接决定画质（JPG/WEBP 生效，PNG 换算成压缩级别）。按体积：自动二分查找能塞进目标体积的最高画质。"
          )
        );

        // 按质量 / 按体积 只显示对应的那几行
        function applyMode() {
          const isSize = modeSeg.btns.get("按体积").classList.contains("on");
          qualityRow.style.display = isSize ? "none" : "";
          sizeRow.style.display = isSize ? "" : "none";
          shrinkChk.label.style.display = isSize ? "" : "none";
        }

        /* —— 缩放 —— */
        const scaleSel = document.createElement("select");
        ["不缩放", "按长边", "按百分比"].forEach((name) => scaleSel.append(mkOption(name, name)));
        scaleSel.value = opt.scale;
        const scaleNum = document.createElement("input");
        scaleNum.type = "number";
        scaleNum.className = "lgb-set-input num";
        scaleNum.min = "1";
        scaleNum.max = "32768";
        scaleNum.value = String(opt.scale === "按百分比" ? opt.percent : opt.long_side);
        const scaleUnit = el("span", "unit", opt.scale === "按百分比" ? "%" : "px");
        const scaleNumRow = el("div", "lgb-set-row");
        scaleNumRow.append(el("span", "lb wide", "数值"), scaleNum, scaleUnit);

        const alignSel = document.createElement("select");
        ["不对齐", "2", "8", "16", "32", "64"].forEach((name) => {
          alignSel.append(
            name === "不对齐"
              ? mkOption(name, "不对齐")
              : mkOption(name, "{n} 的倍数", { n: name })
          );
        });
        alignSel.value = opt.align;

        function applyScale() {
          const mode = scaleSel.value;
          scaleNumRow.style.display = mode === "不缩放" ? "none" : "";
          scaleUnit.textContent = mode === "按百分比" ? "%" : "px";
          scaleNum.min = mode === "按百分比" ? "1" : "16";
          scaleNum.max = mode === "按百分比" ? "400" : "32768";
          scaleNum.value = String(mode === "按百分比" ? opt.percent || 100 : opt.long_side || 1024);
        }
        scaleSel.addEventListener("change", applyScale);

        const secScale = el("section", "lgb-set-sec");
        secScale.append(
          el("div", "ttl", "缩放"),
          rowWith(el("span", "lb wide", "方式"), scaleSel),
          scaleNumRow,
          rowWith(el("span", "lb wide", "尺寸对齐"), alignSel),
          el("p", "desc", "尺寸对齐会把宽高向下取整到指定倍数（训练集常用 8/16/32），不对齐则保持原比例。")
        );

        /* —— 输出 —— */
        const outSeg = segGroup(
          [
            ["同目录 · 新文件", "同目录 · 新文件"],
            ["指定文件夹", "指定文件夹"],
            ["覆盖原文件", "覆盖原文件"],
          ],
          opt.output,
          (key) => {
            opt.output = key;
            outSeg.paint(key);
            applyOutput();
          }
        );

        const dirInput = document.createElement("input");
        dirInput.type = "text";
        dirInput.className = "lgb-set-input";
        setPh(dirInput, "例如 D:\\AI\\output\\compressed");
        dirInput.value = opt.out_dir || "";
        const btnPickDir = el("button", "lgb-btn sm");
        btnPickDir.append(icon("folder", 12), tspan("选择"));
        btnPickDir.addEventListener("click", () => {
          pickFolder(dirInput.value, (chosen) => {
            dirInput.value = chosen;
          });
        });
        const dirRow = el("div", "lgb-set-row");
        dirRow.append(el("span", "lb wide", "输出到"), dirInput, btnPickDir);

        const promptChk = mkCheck("连同名提示词一起复制", opt.with_prompt !== false);
        const warnLine = el("p", "desc warnline", "");
        const addPathBtn = el("button", "lgb-btn sm", "把输出文件夹加入路径");
        addPathBtn.style.display = "none";
        addPathBtn.addEventListener("click", () => {
          const dir = dirInput.value.trim();
          if (!dir) return;
          addPaths([dir]);
          setStatus("已加入输出目录：{dir}", { vars: { dir } });
          addPathBtn.style.display = "none";
        });

        const secOut = el("section", "lgb-set-sec");
        secOut.append(
          el("div", "ttl", "输出"),
          rowWith(el("span", "lb wide", "位置"), outSeg.wrap),
          dirRow,
          rowWith(promptChk.label),
          warnLine,
          el(
            "p",
            "desc",
            "同目录新文件：换格式用新扩展名，同格式压缩加 _c 后缀，原图保留。覆盖原文件 = 原地重写（格式变了会删掉旧文件），不可恢复。"
          )
        );

        function applyOutput() {
          const current = opt.output;
          dirRow.style.display = current === "指定文件夹" ? "" : "none";
          promptChk.label.style.display = current === "覆盖原文件" ? "none" : "";
          if (current === "覆盖原文件") {
            const risky = fmtSel.value !== "保持原格式";
            setTpl(
              warnLine,
              risky
                ? "覆盖原文件 + 换格式：旧文件会被删掉、换成新扩展名，回收站里找不回来。"
                : "覆盖原文件会直接改写原图（不可撤销），建议先用「同目录 · 新文件」试一批。"
            );
            warnLine.classList.add("warn");
          } else {
            warnLine.textContent = "";
            warnLine.classList.remove("warn");
          }
        }
        fmtSel.addEventListener("change", applyOutput);

        body.append(secScope, secFormat, secComp, secScale, secOut);

        /* 参数区滚轮：有溢出就自己滚，并且别让事件继续冒泡到画布
           （否则滚轮滚到面板上会把 ComfyUI 画布放大缩小）。 */
        body.addEventListener(
          "wheel",
          (evt) => {
            if (Math.abs(evt.deltaY) < 1) return;
            const max = body.scrollHeight - body.clientHeight;
            if (max <= 0) return; // 没有溢出就让给页面（这里没有父级滚动）
            evt.preventDefault();
            evt.stopPropagation();
            body.scrollTop = Math.max(0, Math.min(max, body.scrollTop + evt.deltaY));
          },
          { passive: false }
        );

        /* —— 进度（固定在页面底部） —— */
        const secRun = el("section", "lgb-set-sec lgb-conv-run");
        secRun.style.display = "none";
        const bar = el("div", "lgb-conv-bar");
        const barFill = el("i");
        bar.append(barFill);
        const countEl = el("span", "lgb-count", "");
        const nowEl = el("div", "lgb-conv-now", "");
        const msgEl = el("p", "desc lgb-conv-msg", "");
        const cancelBtn = el("button", "lgb-btn sm", "取消任务");
        cancelBtn.addEventListener("click", async () => {
          if (!conv.job) return;
          try {
            await apiJson("/local_gallery/convert/cancel", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ job: conv.job }),
            });
            setTpl(msgEl, "已请求取消，正在收尾…");
          } catch (err) {
            setTpl(msgEl, "取消失败：{err}", { err: err.message || err });
          }
        });
        secRun.append(
          el("div", "ttl", "进度"),
          bar,
          rowWith(countEl, el("div", "lgb-head-spacer"), cancelBtn, addPathBtn),
          nowEl,
          msgEl
        );
        cancelBtn.style.display = "none";

        box.append(headEl, body, secRun);
        pageConvert.append(box);

        conv.ui = {
          hint: hintEl,
          start: startBtn,
          scopeSeg,
          btnSelected: scopeSeg.btns.get("selected"),
          btnAll: scopeSeg.btns.get("all"),
          run: secRun,
          bar: barFill,
          count: countEl,
          now: nowEl,
          msg: msgEl,
          cancel: cancelBtn,
        };

        applyScale();
        applyOutput();
        applyMode();

        /* —— 任务 —— */
        function currentOptions() {
          const scaleMode = scaleSel.value;
          return {
            format: fmtSel.value,
            mode: modeSeg.btns.get("按质量").classList.contains("on") ? "按质量" : "按体积",
            quality: Number(qualityInput.value) || 85,
            target_kb: Number(sizeInput.value) || 300,
            allow_shrink: shrinkChk.input.checked,
            scale: scaleMode,
            long_side: scaleMode === "按长边" ? Number(scaleNum.value) || 1024 : 1024,
            percent: scaleMode === "按百分比" ? Number(scaleNum.value) || 100 : 100,
            align: alignSel.value,
            output: opt.output,
            out_dir: dirInput.value.trim(),
            with_prompt: promptChk.input.checked,
          };
        }

        function collectPaths() {
          return conv.scope === "selected" ? [...state.selected.keys()] : visibleItems().map((it) => it.path);
        }

        function setRunning(on) {
          startBtn.disabled = on;
          setLabel(startBtn, on ? t("转换中…") : t("开始转换"));
          cancelBtn.style.display = on ? "" : "none";
        }

        function updateProgress(st) {
          const total = st.total || 1;
          const pct = Math.min(100, Math.round(((st.done || 0) / total) * 100));
          barFill.style.width = `${pct}%`;
          setLabel(countEl, `${st.done || 0} / ${st.total}${st.failed ? ` · ${t("失败 {n}", { n: st.failed })}` : ""}`);
          if (st.current) setTpl(nowEl, "正在处理：{name}", { name: st.current });
        }

        async function poll() {
          if (!conv.job) return;
          try {
            const st = await apiJson(
              `/local_gallery/convert/status?job=${encodeURIComponent(conv.job)}&since=${conv.since}`
            );
            conv.since = st.next || conv.since;
            (st.results || []).forEach((r) => {
              if (!r.ok && r.error && conv.failed.length < 4) {
                conv.failed.push(`${r.name}：${r.error}`);
              }
            });
            updateProgress(st);
            if (st.state === "running") {
              conv.timer = setTimeout(poll, 400);
              return;
            }
            finish(st);
          } catch (err) {
            setTpl(msgEl, "读取进度失败：{err}", { err: err.message || err });
            msgEl.classList.add("warn");
            conv.job = null;
            setRunning(false);
            syncConvertPage();
          }
        }

        function finish(st) {
          conv.job = null;
          clearTimeout(conv.timer);
          conv.timer = null;
          setRunning(false);

          const okCount = (st.done || 0) - (st.failed || 0);
          const before = st.bytes_before || 0;
          const after = st.bytes_after || 0;
          const delta = before > 0 ? Math.round((1 - after / before) * 100) : 0;
          const parts = [
            st.state === "cancelled" ? t("已取消") : t("完成"),
            t("成功 {ok} 张", { ok: okCount }),
          ];
          if (st.failed) parts.push(t("失败 {n} 张", { n: st.failed }));
          if (before && after) {
            parts.push(`${humanBytes(before)} → ${humanBytes(after)}`);
            parts.push(delta >= 0 ? t("省 {pct}%", { pct: delta }) : t("大了 {pct}%", { pct: -delta }));
          }
          if (st.elapsed) parts.push(t("耗时 {sec}s", { sec: st.elapsed.toFixed(1) }));
          msgEl.textContent = parts.join(" · ");
          msgEl.classList.toggle("warn", !!st.failed);
          if (conv.failed.length) {
            msgEl.textContent += `\n${t("失败原因：{list}", { list: conv.failed.join("; ") })}`;
          }

          if (st.options?.output === "指定文件夹" && st.options?.out_dir) {
            addPathBtn.style.display = "";
            nowEl.textContent = t("输出到：{dir}", { dir: st.options.out_dir });
          } else {
            nowEl.textContent = t("输出位置：{where}", {
              where: t(st.options?.output || "同目录 · 新文件"),
            });
          }
          setStatus(
            st.failed ? "转换完成：成功 {ok} 张，失败 {f} 张" : "转换完成：成功 {ok} 张",
            { vars: { ok: okCount, f: st.failed || 0 } }
          );
          syncConvertPage();
          refresh(); // 新文件可能落在当前扫描的目录里
        }

        startBtn.addEventListener("click", async () => {
          if (conv.job) return;
          const paths = collectPaths();
          const options = currentOptions();
          if (!paths.length) {
            setStatus("没有可处理的图片", { error: true });
            return;
          }
          if (options.output === "指定文件夹" && !options.out_dir) {
            setStatus("先选一个输出文件夹", { error: true });
            return;
          }
          saveConvSettings(options);
          secRun.style.display = "";
          msgEl.textContent = "";
          msgEl.classList.remove("warn");
          conv.failed = [];
          conv.since = 0;
          barFill.style.width = "0%";
          countEl.textContent = `0 / ${paths.length}`;
          setTpl(nowEl, "正在启动…");
          setRunning(true);
          syncConvertPage();
          setStatus("正在转换 {n} 张…", { vars: { n: paths.length } });
          try {
            const data = await apiJson("/local_gallery/convert/start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths, options }),
            });
            conv.job = data.job;
            if (data.blocked) setTpl(msgEl, "{n} 张被 allowed_roots 拦下", { n: data.blocked });
            poll();
          } catch (err) {
            setRunning(false);
            setTpl(msgEl, "启动失败：{err}", { err: err.message || err });
            msgEl.classList.add("warn");
            syncConvertPage();
          }
        });
      }

      /* ---------------- 搜索（名称 / 提示词 / 全部） ---------------- */
      const SEARCH_MODES = [
        { key: "name", label: "名称", hint: "按文件名 / 路径过滤", placeholder: "按文件名过滤，空格分隔多个关键词" },
        { key: "prompt", label: "提示词", hint: "按提示词内容搜索", placeholder: "搜提示词内容，全部包含才命中" },
        { key: "both", label: "全部", hint: "名称或提示词命中", placeholder: "名称或提示词，命中任意一个即可" },
      ];

      const SEARCH_MODE_KEY = "localGalleryBrowser.searchMode";

      function applySearchMode(key, { persist = true } = {}) {
        const mode = SEARCH_MODES.find((m) => m.key === key) || SEARCH_MODES[0];
        state.searchMode = mode.key;
        setTpl(searchModeBtn, mode.label);
        setTitle(searchModeBtn, `${mode.hint} —— 点一下切换`);
        setPh(searchInput, mode.placeholder);
        searchModeBtn.classList.toggle("primary", mode.key !== "name");
        if (persist) {
          try {
            localStorage.setItem(SEARCH_MODE_KEY, mode.key);
          } catch (err) {
            /* 忽略 */
          }
        }
      }

      /* ---------------- 排序（默认 / 文件名 / 修改时间，各带正反） ---------------- */
      const SORT_MODES = [
        { key: "default", label: "默认", hint: "扫描顺序（目录里的原始顺序）" },
        { key: "name-asc", label: "名称 ↑", hint: "文件名从小到大（数字按数值比，2 在 10 前面）" },
        { key: "name-desc", label: "名称 ↓", hint: "文件名从大到小" },
        { key: "time-desc", label: "时间 ↓", hint: "按修改时间，从新到旧" },
        { key: "time-asc", label: "时间 ↑", hint: "按修改时间，从旧到新" },
      ];

      // 浮层两栏用的选项
      const SORT_FIELDS = [
        { key: "name", label: "名称", hint: "按文件名排序" },
        { key: "time", label: "时间", hint: "按文件修改时间排序" },
        { key: "default", label: "扫描顺序", hint: "回到扫描时的原始顺序" },
      ];
      const SORT_DIRS = [
        { key: "asc", label: "顺序", hint: "从小到大 / 从旧到新" },
        { key: "desc", label: "倒序", hint: "从大到小 / 从新到旧" },
      ];

      const SORT_KEY = "localGalleryBrowser.sort";
      const GROUP_KEY = "localGalleryBrowser.timeGroup";
      const VIEW_KEY = "localGalleryBrowser.view";

      // 文件名比较：带数字的按数值比，避免 0010 排在 0002 前面
      function compareByName(a, b) {
        const byName = String(a.name || "").localeCompare(String(b.name || ""), undefined, {
          numeric: true,
          sensitivity: "base",
        });
        return byName || String(a.path || "").localeCompare(String(b.path || ""));
      }

      function sortItemsInPlace() {
        const list = state.items;
        if (!list.length) return;
        const mode = state.sortMode;
        if (mode === "name-asc") list.sort(compareByName);
        else if (mode === "name-desc") list.sort((a, b) => compareByName(b, a));
        else if (mode === "time-desc") {
          list.sort((a, b) => (Number(b.mtime) || 0) - (Number(a.mtime) || 0) || compareByName(a, b));
        } else if (mode === "time-asc") {
          list.sort((a, b) => (Number(a.mtime) || 0) - (Number(b.mtime) || 0) || compareByName(a, b));
        } else {
          // 默认：回到扫描时记下的原顺序
          list.sort((a, b) => (a.__ord || 0) - (b.__ord || 0));
        }
      }

      function applySortMode(key, { persist = true, rerender = true } = {}) {
        const mode = SORT_MODES.find((m) => m.key === key) || SORT_MODES[0];
        state.sortMode = mode.key;
        setTpl(sortLabel, mode.label);
        setTitle(sortModeBtn, mode.hint);
        sortModeBtn.classList.toggle("primary", mode.key !== "default");
        if (persist) {
          try {
            localStorage.setItem(SORT_KEY, mode.key);
          } catch (err) {
            /* 忽略 */
          }
        }
        if (!rerender) return;
        sortItemsInPlace();
        // 排序变了，选中徽标、提示词页、反推页都得按新顺序重画
        state.rendered = 0;
        renderGrid();
        updateTabCounts();
        if (activeTab === "prompts") {
          if (promptMode === "orphans") renderOrphans({ reset: true });
          else renderPrompts({ reset: true });
        }
      }

      // 排序浮层：一栏选依据（名称 / 时间 / 扫描顺序），一栏选方向（顺序 / 倒序）
      let sortMenuEl = null;
      let sortMenuOff = null;

      function closeSortMenu() {
        if (sortMenuOff) {
          sortMenuOff();
          sortMenuOff = null;
        }
        if (sortMenuEl) {
          sortMenuEl.remove();
          sortMenuEl = null;
        }
        sortModeBtn.classList.remove("open");
      }

      function currentSortField() {
        if (state.sortMode === "default") return "default";
        return state.sortMode.startsWith("time") ? "time" : "name";
      }

      function currentSortDir() {
        return state.sortMode.endsWith("desc") ? "desc" : "asc";
      }

      function openSortMenu() {
        if (sortMenuEl) {
          closeSortMenu();
          return;
        }
        const panel = el("div", "lgb-sortmenu");
        panel.dataset.theme = wrap.dataset.theme || "dark";
        const field = currentSortField();
        const dir = currentSortDir();
        const noDir = field === "default";

        function choose(fieldKey, dirKey) {
          const nextField = fieldKey || currentSortField();
          const nextDir = dirKey || currentSortDir();
          const next = nextField === "default" ? "default" : `${nextField}-${nextDir}`;
          closeSortMenu();
          applySortMode(next);
        }

        const colA = el("div", "lgb-sortcol");
        colA.append(el("div", "cap", "排序依据"));
        SORT_FIELDS.forEach((f) => {
          const btn = el("button", "opt");
          btn.append(tspan(f.label));
          if (field === f.key) {
            btn.classList.add("on");
            btn.append(el("span", "tick", "✓"));
          }
          setTitle(btn, f.hint);
          btn.addEventListener("click", () => choose(f.key, null));
          colA.append(btn);
        });

        const colB = el("div", "lgb-sortcol");
        colB.append(el("div", "cap", "方向"));
        SORT_DIRS.forEach((d) => {
          const btn = el("button", "opt");
          btn.append(tspan(d.label));
          if (!noDir && dir === d.key) {
            btn.classList.add("on");
            btn.append(el("span", "tick", "✓"));
          }
          if (noDir) btn.disabled = true; // 扫描顺序没有正反
          setTitle(btn, d.hint);
          btn.addEventListener("click", () => choose(null, d.key));
          colB.append(btn);
        });

        panel.append(colA, el("div", "lgb-sortsplit"), colB);
        document.body.appendChild(panel);

        // 贴在按钮下方；右边放不下就右对齐
        const rect = sortModeBtn.getBoundingClientRect();
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8));
        panel.style.left = `${left}px`;
        panel.style.top = `${rect.bottom + 6}px`;
        sortModeBtn.classList.add("open");

        const onDown = (evt) => {
          if (panel.contains(evt.target) || sortModeBtn.contains(evt.target)) return;
          closeSortMenu();
        };
        const onKey = (evt) => {
          if (evt.key === "Escape") closeSortMenu();
        };
        document.addEventListener("pointerdown", onDown, true);
        window.addEventListener("keydown", onKey);
        sortMenuOff = () => {
          document.removeEventListener("pointerdown", onDown, true);
          window.removeEventListener("keydown", onKey);
        };
        sortMenuEl = panel;
      }

      /* ---------------- 缩略图右键菜单 ----------------
         菜单项跟底栏按钮一一对应：复制提示词 / 加入收藏夹 / 反推 / 转换 */
      let ctxMenuEl = null;
      let ctxMenuOff = null;

      function closeCtxMenu() {
        if (ctxMenuOff) {
          ctxMenuOff();
          ctxMenuOff = null;
        }
        if (ctxMenuEl) {
          ctxMenuEl.remove();
          ctxMenuEl = null;
        }
      }

      function openImageMenu(item, evt) {
        closeCtxMenu();
        hideTip();
        closeSortMenu();
        if (!item) return;

        // 右键落在没选中的图上：先只选它（跟资源管理器一致）；
        // 已经在选中的范围里，就对整个选择生效，和底栏按钮一致
        if (!state.selected.has(item.path)) {
          state.selected.clear();
          state.selected.set(item.path, 0);
          state.lastClicked = -1;
          commitSelection();
          paintSelection();
        }
        const paths = [...state.selected.keys()];
        const single = paths.length === 1;
        const target = single ? state.items.find((i) => i.path === paths[0]) || item : null;

        const panel = el("div", "lgb-sortmenu lgb-ctxmenu");
        panel.dataset.theme = wrap.dataset.theme || "dark";
        const col = el("div", "lgb-sortcol");

        // 头一行说明这次操作作用在谁身上
        const head = el("div", "cap");
        if (single) {
          head.textContent = item.name;
          setTitle(head, item.path);
        } else {
          setTpl(head, "已选 {n}", { n: paths.length });
        }
        col.append(head);

        const addItem = (label, hint, handler, { iconName = "", disabled = false } = {}) => {
          const btn = el("button", "opt");
          if (iconName) btn.append(icon(iconName, 13));
          btn.append(tspan(label));
          setTitle(btn, hint);
          if (disabled) {
            btn.disabled = true;
          } else {
            btn.addEventListener("click", () => {
              closeCtxMenu();
              Promise.resolve(handler()).catch((err) => {
                setStatus(String(err && err.message ? err.message : err), { error: true });
              });
            });
          }
          col.append(btn);
          return btn;
        };

        const noPrompt = !!target && !target.has_prompt;
        addItem(
          "复制提示词",
          noPrompt ? "这张没有同名提示词" : single ? "复制这张的提示词" : "复制提示词",
          () => (single ? copyItemPrompt(item) : copySelectedPrompts()),
          { iconName: "copy", disabled: single && noPrompt }
        );
        addItem("加入收藏夹", "把选中的图片放进收藏夹（可以顺手新建一个）", () =>
          openFolderPicker(paths), { iconName: "star" });
        addItem("反推", "跳到反推页：对选中的图跑 WD14 / TIPO", () =>
          switchTab("reverse"), { iconName: "text" });
        addItem("转换", "跳到转换压缩页：批量转格式 / 压体积 / 缩放", () =>
          switchTab("convert"), { iconName: "convert" });

        panel.append(col);
        document.body.appendChild(panel);

        // 贴在鼠标位置；贴边时往回收，别跑到窗口外
        const pad = 8;
        const rect = panel.getBoundingClientRect();
        let left = evt.clientX;
        let top = evt.clientY;
        if (left + rect.width + pad > window.innerWidth) left = window.innerWidth - rect.width - pad;
        if (top + rect.height + pad > window.innerHeight) top = evt.clientY - rect.height;
        panel.style.left = `${Math.max(pad, left)}px`;
        panel.style.top = `${Math.max(pad, top)}px`;

        const onDown = (e) => {
          if (panel.contains(e.target)) return;
          closeCtxMenu();
        };
        const onKey = (e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            closeCtxMenu();
          }
        };
        document.addEventListener("pointerdown", onDown, true);
        window.addEventListener("keydown", onKey, true);
        window.addEventListener("resize", closeCtxMenu);
        gridScroll.addEventListener("scroll", closeCtxMenu, { passive: true });
        listBox.addEventListener("scroll", closeCtxMenu, { passive: true });
        ctxMenuOff = () => {
          document.removeEventListener("pointerdown", onDown, true);
          window.removeEventListener("keydown", onKey, true);
          window.removeEventListener("resize", closeCtxMenu);
          gridScroll.removeEventListener("scroll", closeCtxMenu);
          listBox.removeEventListener("scroll", closeCtxMenu);
        };
        ctxMenuEl = panel;
      }

      function refreshViews() {
        renderGrid();
        updateTabCounts();
        if (activeTab === "prompts") renderPrompts({ reset: true });
      }

      async function runSearch() {
        const keywords = state.filter.trim().split(/\s+/).filter(Boolean);
        const needPrompt = state.searchMode !== "name" && keywords.length > 0;

        if (!needPrompt) {
          state.promptHits = null;
          refreshViews();
          if (!keywords.length) {
            setStatus(
              state.items.length
                ? "已读到 {n} 张图，悬停看提示词{o}"
                : "这些路径下没有图片",
              {
                error: !state.items.length,
                vars: {
                  n: state.items.length,
                  o: state.orphanPrompts
                    ? t(" · {n} 个提示词匹配不到图片", { n: state.orphanPrompts })
                    : "",
                },
              }
            );
          } else {
            setStatus("筛出 {a} / {b} 张", {
          vars: { a: visibleItems().length, b: state.items.length },
        });
          }
          return;
        }
        if (!state.items.length) {
          state.promptHits = null;
          refreshViews();
          return;
        }

        const seq = ++state.searchSeq;
        setStatus("正在搜提示词…（{n} 张）", { vars: { n: state.items.length } });
        try {
          const data = await apiJson("/local_gallery/search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              files: state.items.map((it) => it.path),
              q: keywords,
            }),
          });
          if (seq !== state.searchSeq) return;
          state.promptHits = new Set(data.hits || []);
          refreshViews();
          setStatus("提示词命中 {a} / {b} 张（有提示词 {c} 张）", {
            vars: { a: state.promptHits.size, b: data.scanned, c: data.with_prompt },
          });
        } catch (err) {
          if (seq !== state.searchSeq) return;
          state.promptHits = null;
          refreshViews();
          setStatus("提示词搜索失败：{err}", { error: true, vars: { err: err.message || err } });
        }
      }

      /* ---------------- 收藏 ---------------- */
      function paintFav(dom, on) {
        if (!dom) return;
        dom.classList.toggle("on", !!on);
        setTitle(dom, on ? "取消收藏" : "收藏这张");
        // 收藏状态在封面右下角常驻一个小星，便于一眼扫出
        const item = dom.closest?.(".lgb-item");
        if (item) item.classList.toggle("is-fav", !!on);
      }

      async function loadFavorites({ refreshView = false } = {}) {
        try {
          const data = await apiJson("/local_gallery/favorites");
          state.favorites = new Map((data.items || []).map((it) => [it.path, it]));
        } catch (err) {
          setStatus("读取收藏失败：{err}", { error: true, vars: { err: err.message || err } });
          return;
        }
        // 收藏夹分类（数量 + 列表）跟收藏一起刷新
        try {
          const folders = await apiJson("/local_gallery/favorites/folders");
          if (Array.isArray(folders.folders)) state.folders = folders.folders;
          if (Number.isFinite(Number(folders.unclassified))) {
            state.favUnclassified = Number(folders.unclassified);
          }
          if (state.favFolder !== "all" && state.favFolder !== "none") {
            const alive = state.folders.some((f) => f.id === state.favFolder);
            if (!alive) state.favFolder = "all";
          }
        } catch (err) {
          /* 收藏夹读失败不影响收藏本身 */
        }
        updateTabCounts();
        renderChips();
        // 已渲染的缩略图同步星标状态
        grid.querySelectorAll(".lgb-item").forEach((dom) => {
          paintFav(dom.querySelector(".lgb-fav"), state.favorites.has(dom.dataset.path));
        });
        if (refreshView && state.source === "favorites") {
          refresh({ overridePaths: favoritePathsForView() });
        }
      }

      // 单张收藏：未收藏 → 先弹「收藏到哪个收藏夹」；已收藏 → 直接取消
      function favoriteOne(item, dom, { onDone } = {}) {
        if (!item?.path) return;
        if (state.favorites.has(item.path)) {
          toggleFavorite(item, dom).then(() => onDone?.());
          return;
        }
        openFolderPicker([item.path], {
          title: "收藏到哪个收藏夹？",
          hintTpl: "把「{name}」收藏起来，顺便选个分类；不选就是未分类。",
          hintVars: { name: shortName(item.path) },
          allowUnfiled: true,
          onUnfiled: () => {
            if (dom) dom.textContent = "★";
            toggleFavorite(item, dom).then(() => onDone?.());
          },
          afterAssign: () => onDone?.(),
        });
      }

      async function toggleFavorite(item, dom) {
        if (!item?.path) return;
        const wasFav = state.favorites.has(item.path);
        const favMeta = wasFav ? state.favorites.get(item.path) : null;
        const prompt = state.promptCache.get(item.path)?.prompt || "";

        // 先乐观更新，失败再回滚
        if (wasFav) state.favorites.delete(item.path);
        else state.favorites.set(item.path, { path: item.path, added: Date.now() / 1000 });
        paintFav(dom, !wasFav);
        updateTabCounts();

        try {
          const payload = {
            paths: [item.path],
            action: wasFav ? "remove" : "add",
          };
          if (prompt && !wasFav) payload.prompts = { [item.path]: prompt };
          const data = await apiJson("/local_gallery/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          state.favorites = new Map((data.items || []).map((it) => [it.path, it]));
          if (wasFav) {
            pushFavUndo([{ path: item.path, folders: (favMeta?.folders || []).slice() }]);
          } else {
            pushFavoriteUndo([{ path: item.path, wasFav: false }]);
          }
          setStatus(wasFav ? t("已取消收藏：{name}", { name: item.name }) : t("已收藏：{name}", { name: item.name }));
        } catch (err) {
          if (wasFav) state.favorites.set(item.path, { path: item.path });
          else state.favorites.delete(item.path);
          paintFav(dom, wasFav);
          setStatus("收藏失败：{err}", { error: true, vars: { err: err.message || err } });
        }

        updateTabCounts();
        if (state.source === "favorites") {
          if (wasFav) {
            // 在收藏页取消 → 直接从当前列表移除，不用整页重扫
            state.items = state.items.filter((it) => it.path !== item.path);
            state.selected.delete(item.path);
            renumberSelection();
            commitSelection();
            state.rendered = 0;
            renderGrid();
            renderChips();
            if (activeTab === "prompts") renderPrompts({ reset: true });
          }
        }
      }

      // 批量取消收藏（收藏页的「取消收藏」按钮）
      async function unfavoritePaths(paths) {
        const list = [...new Set((paths || []).filter(Boolean))];
        if (!list.length) return;
        // 先记下它们原本在哪些收藏夹，撤销时要还原
        const before = list.map((p) => ({
          path: p,
          folders: (state.favorites.get(p)?.folders || []).slice(),
        }));
        try {
          const data = await apiJson("/local_gallery/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths: list, action: "remove" }),
          });
          // 收藏 + 收藏夹数量一次同步（response 里带 items）
          applyFolderState(data);
          pushFavUndo(before);
          reloadFolders();
          const gone = new Set(data.removed || list);
          list.forEach((path) => {
            state.selected.delete(path);
            state.promptCache.delete(path);
          });
          renumberSelection();
          commitSelection();
          updateTabCounts();
          if (state.source === "favorites") {
            // 在收藏页：直接从当前列表摘掉，不用整页重扫
            state.items = state.items.filter((it) => !gone.has(it.path));
            state.rendered = 0;
            renderGrid();
          }
          grid.querySelectorAll(".lgb-item").forEach((dom) => {
            paintFav(dom.querySelector(".lgb-fav"), state.favorites.has(dom.dataset.path));
          });
          setStatus("已取消收藏 {n} 张", { vars: { n: list.length } });
        } catch (err) {
          setStatus("取消收藏失败：{err}", { error: true, vars: { err: err.message || err } });
        }
      }

      /* ---------------- 收藏夹（分类） ---------------- */
      // 通用文本输入弹窗：收藏夹命名用
      function openTextPrompt({ title, placeholder = "", value = "", okText = "确定", onOk }) {
        const overlay = mkOverlay();
        const box = el("div", "lgb-confirm");
        const body = el("div", "body");
        const input = document.createElement("input");
        input.className = "lgb-input";
        input.value = value;
        setPh(input, placeholder);
        body.append(input);
        const foot = el("div", "foot");
        const btnCancel = el("button", "lgb-btn", "取消");
        const btnOk = el("button", "lgb-btn primary");
        setTpl(btnOk, okText);
        foot.append(btnCancel, btnOk);
        box.append(elTpl("h3", "", title), body, foot);
        overlay.append(box);
        document.body.appendChild(overlay);
        input.focus();
        input.select();

        const close = () => {
          overlay.remove();
          window.removeEventListener("keydown", onKey);
        };
        function submit() {
          const text = input.value.trim();
          if (!text) {
            input.focus();
            return;
          }
          close();
          onOk?.(text);
        }
        function onKey(evt) {
          if (evt.key === "Escape") close();
          else if (evt.key === "Enter") {
            evt.preventDefault();
            submit();
          }
        }
        window.addEventListener("keydown", onKey);
        btnCancel.addEventListener("click", close);
        btnOk.addEventListener("click", submit);
        overlay.addEventListener("click", (evt) => {
          if (evt.target === overlay) close();
        });
      }

      function applyFolderState(data) {
        if (Array.isArray(data?.folders)) state.folders = data.folders;
        if (Number.isFinite(Number(data?.unclassified))) {
          state.favUnclassified = Number(data.unclassified);
        }
        if (Array.isArray(data?.items)) {
          state.favorites = new Map(data.items.map((it) => [it.path, it]));
        }
        updateTabCounts();
        renderChips();
      }

      async function reloadFolders() {
        try {
          const data = await apiJson("/local_gallery/favorites/folders");
          applyFolderState(data);
        } catch (err) {
          setStatus("读取收藏夹失败：{err}", { error: true, vars: { err: err.message || err } });
        }
      }

      function createFolderFlow({ onCreated } = {}) {
        openTextPrompt({
          title: "新建收藏夹",
          placeholder: "收藏夹名字，例如：风景 / 精选 / 待修",
          okText: "新建",
          onOk: async (name) => {
            try {
              const data = await apiJson("/local_gallery/favorites/folders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
              });
              applyFolderState(data);
              setStatus("已新建收藏夹：{name}", { vars: { name } });
              onCreated?.(data.folder);
            } catch (err) {
              setStatus("新建收藏夹失败：{err}", { error: true, vars: { err: err.message || err } });
            }
          },
        });
      }

      function confirmDeleteFolder(folderId, name) {
        openConfirm({
          title: "删除收藏夹「{name}」？",
          titleVars: { name },
          body: t("只删除这个分类，里面的图片仍然留在收藏里（不会取消收藏）。"),
          okText: "删除收藏夹",
          onOk: async () => {
            const data = await apiJson("/local_gallery/favorites/folders/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: folderId }),
            });
            if (state.favFolder === folderId) state.favFolder = "all";
            applyFolderState(data);
            setStatus("已删除收藏夹：{name}", { vars: { name } });
            if (state.source === "favorites") {
              refresh({ overridePaths: favoritePathsForView() });
            }
          },
        });
      }

      // 把选中的图片放进收藏夹：列出现有收藏夹 + 就地新建
      function openFolderPicker(paths, opts = {}) {
        const list = [...new Set((paths || []).filter(Boolean))];
        if (!list.length) {
          setStatus("先选中图片再放进收藏夹", { error: true });
          return;
        }
        const overlay = mkOverlay();
        const box = el("div", "lgb-confirm lgb-folderpicker");
        const body = el("div", "body");
        const hint = setTpl(
          el("div", "hint"),
          opts.hintTpl || "把选中的 {n} 张图片放进哪个收藏夹？（没收藏的会自动收藏）",
          opts.hintTpl ? opts.hintVars || {} : { n: list.length }
        );
        const rows = el("div", "lgb-folderlist");
        const foot = el("div", "foot");
        const btnNew = el("button", "lgb-btn");
        btnNew.append(tspan("＋ 新建收藏夹"));
        const btnCancel = el("button", "lgb-btn", "取消");
        foot.append(btnNew, el("div", "lgb-head-spacer"), btnCancel);
        box.append(el("h3", "", opts.title || "加入收藏夹"), hint, rows, foot);
        overlay.append(box);
        document.body.appendChild(overlay);

        const close = () => {
          overlay.remove();
          window.removeEventListener("keydown", onKey);
        };
        function onKey(evt) {
          if (evt.key === "Escape") close();
        }
        window.addEventListener("keydown", onKey);
        btnCancel.addEventListener("click", close);
        overlay.addEventListener("click", (evt) => {
          if (evt.target === overlay) close();
        });

        async function assignTo(folder) {
          // 记下加之前的状态：原本没收藏的，撤销=取消收藏；原本收藏过的，撤销=移出这个夹
          const before = list.map((p) => ({
            path: p,
            wasFav: state.favorites.has(p),
            folderId: folder.id,
          }));
          try {
            const data = await apiJson("/local_gallery/favorites/folders/assign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paths: list, folder_id: folder.id, action: "add" }),
            });
            applyFolderState(data);
            pushFavoriteUndo(before);
            close();
            if (list.length === 1) {
              setStatus("已收藏到「{name}」", { vars: { name: folder.name } });
            } else {
              setStatus("已把 {n} 张放进「{name}」", {
                vars: { n: data.changed?.length || list.length, name: folder.name },
              });
            }
            opts.afterAssign?.(folder);
            // 收藏页：星标和当前列表都要跟着变
            grid.querySelectorAll(".lgb-item").forEach((dom) => {
              paintFav(dom.querySelector(".lgb-fav"), state.favorites.has(dom.dataset.path));
            });
            if (state.source === "favorites") {
              refresh({ overridePaths: favoritePathsForView() });
            }
          } catch (err) {
            setStatus("放入收藏夹失败：{err}", { error: true, vars: { err: err.message || err } });
          }
        }

        function paintRows() {
          rows.replaceChildren();
          if (opts.allowUnfiled) {
            const row = el("button", "lgb-folderrow lgb-unfiled");
            row.append(el("span", "nm", opts.unfiledLabel || "不分类，直接收藏"));
            row.addEventListener("click", () => {
              close();
              opts.onUnfiled?.();
            });
            rows.append(row);
          }
          if (!state.folders.length) {
            rows.append(el("div", "lgb-empty", "还没有收藏夹，点下面「＋ 新建收藏夹」建一个"));
            return;
          }
          state.folders.forEach((folder) => {
            const row = el("button", "lgb-folderrow");
            row.append(el("span", "nm", folder.name), el("span", "n", `${folder.count || 0} 张`));
            row.addEventListener("click", () => assignTo(folder));
            rows.append(row);
          });
        }

        btnNew.addEventListener("click", () => {
          createFolderFlow({
            onCreated: (folder) => {
              paintRows();
              if (folder) assignTo(folder);
            },
          });
        });

        paintRows();
      }

      /* ---------------- 网格 ---------------- */
      const COL_GAP = 8;
      const GRID_PAD = 6;

      /* 在容器里铺 N 列瀑布流（时间分组的每组也用它） */
      function makeColumns(container, itemCount = 0, colCount = 0) {
        const gap = COL_GAP;
        const want = colCount > 0 ? colCount : cols;
        // 图片比目标列数还少时，按图片数分列，避免切出一堆空列把图挤小
        const useCols = Math.max(1, itemCount > 0 ? Math.min(want, itemCount) : want);
        const usable = Math.max(160, (gridScroll.clientWidth || 600) - GRID_PAD * 2);
        const colW = Math.max(40, (usable - gap * (useCols - 1)) / useCols);
        container.classList.toggle("compact", colW < 96);
        const columns = [];
        for (let i = 0; i < useCols; i += 1) {
          const col = el("div", "lgb-col");
          container.append(col);
          columns.push({ el: col, width: colW, height: 0 });
        }
        return columns;
      }

      function resetColumns(itemCount = 0) {
        grid.replaceChildren();
        grid.classList.remove("timeline");
        state.columns = makeColumns(grid, itemCount);
      }

      /* ---------------- 列表模式（一行一张） ---------------- */
      function splitTags(text) {
        return String(text || "")
          .split(/[,\n，、]/)
          .map((t) => t.trim())
          .filter(Boolean);
      }

      // 列表一屏几十行，提示词别一次轰几十个请求，限流 4 个并发
      const rowPromptJobs = { running: 0, queue: [] };
      function queueRowPrompt(item, fill) {
        rowPromptJobs.queue.push({ item, fill });
        drainRowPrompts();
      }
      function drainRowPrompts() {
        while (rowPromptJobs.running < 4 && rowPromptJobs.queue.length) {
          const job = rowPromptJobs.queue.shift();
          rowPromptJobs.running += 1;
          ensurePrompt(job.item)
            .then((entry) => job.fill(entry))
            .catch(() => {})
            .finally(() => {
              rowPromptJobs.running -= 1;
              drainRowPrompts();
            });
        }
      }

      function buildRow(item, index) {
        const row = el("div", "lgb-lrow");
        row.dataset.path = item.path;

        const pic = el("div", "pic");
        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.src = buildUrl("/local_gallery/thumb", { path: item.path, size: 128 });
        img.addEventListener("error", () => {
          img.style.visibility = "hidden";
          row.classList.add("broken");
        });
        pic.append(img);

        const mid = el("div", "mid");
        const nm = el("div", "nm");
        nm.append(
          el("span", "t", item.stem || item.name),
          el("span", "ext", item.ext ? `.${item.ext}` : "")
        );
        const metaBits = [];
        if (item.width && item.height) metaBits.push(`${item.width}×${item.height}`);
        if (item.size) metaBits.push(fmtSize(item.size));
        const tags = el("div", "tags");
        mid.append(nm, el("div", "meta", metaBits.join(" · ")), tags);

        const no = el("div", "no", String(index + 1));

        const acts = el("div", "acts");
        const copy = el("div", `lgb-copy${item.has_prompt ? "" : " off"}`);
        copy.append(icon("copy", 12));
        setTitle(copy, item.has_prompt ? "复制这张的提示词" : "这张没有同名提示词");
        const favOn = state.favorites.has(item.path);
        const fav = el("div", `lgb-fav${favOn ? " on" : ""}`, favOn ? "★" : "☆");
        setTitle(fav, favOn ? "取消收藏" : "收藏这张");
        const zoom = el("div", "lgb-zoom");
        zoom.append(icon("expand", 12));
        setTitle(zoom, "大图预览");
        const del = el("div", "lgb-del");
        del.append(icon("trash", 12));
        setTitle(del, "删除（移到回收站）");
        acts.append(copy, fav, zoom, del);

        row.classList.toggle("is-fav", favOn);
        row.append(pic, mid, no, acts);
        wireItemActions(item, { copy, fav, zoom, del });

        row.addEventListener("click", (evt) => {
          if (
            zoom.contains?.(evt.target) ||
            del.contains?.(evt.target) ||
            fav.contains?.(evt.target) ||
            copy.contains?.(evt.target)
          ) {
            return;
          }
          toggleSelect(item.path, index, {
            range: evt.shiftKey,
            exclusive: evt.ctrlKey || evt.metaKey,
          });
          ensurePrompt(item).then(() => commitSelection());
        });

        row.addEventListener("contextmenu", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          openImageMenu(item, evt);
        });

        // 提示词按逗号切成 chips（读到了再填，读不到就留一行「没有提示词」）
        queueRowPrompt(item, (entry) => {
          if (!row.isConnected) return;
          const list = splitTags(entry && entry.prompt);
          if (!list.length) {
            if (!item.has_prompt) tags.append(el("span", "tag more", "没有提示词"));
            return;
          }
          const cap = 14;
          list.slice(0, cap).forEach((tag) => tags.append(el("span", "tag", tag)));
          if (list.length > cap) tags.append(el("span", "tag more", `+${list.length - cap}`));
        });

        return row;
      }

      function renderList(items, reset) {
        if (reset) {
          listBox.replaceChildren();
          state.rendered = 0;
        }
        const slice = items.slice(state.rendered, state.rendered + PAGE_SIZE);
        slice.forEach((item, k) => {
          listBox.append(buildRow(item, state.rendered + k));
        });
        state.rendered += slice.length;
        paintSelection();
        fillViewport();
      }

      function setViewMode(mode, { persist = true, rerender = true } = {}) {
        state.view = mode === "list" ? "list" : "grid";
        const isList = state.view === "list";
        grid.style.display = isList ? "none" : "";
        listBox.style.display = isList ? "" : "none";
        syncViewSwitch();
        if (persist) {
          try {
            localStorage.setItem(VIEW_KEY, state.view);
          } catch (err) {
            /* 忽略 */
          }
        }
        if (!rerender) return;
        state.rendered = 0;
        state.tl = null;
        gridScroll.scrollTop = 0;
        renderGrid();
      }

      /* ---------------- 按天分组（时间线） ---------------- */
      function dayKeyOf(ts) {
        const n = Number(ts) || 0;
        if (!n) return "";
        const d = new Date(n * 1000);
        if (Number.isNaN(d.getTime())) return "";
        const p = (v) => String(v).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      }

      /* 今天 / 昨天 / 前天 / 11 月 10 日 / 2025 年 12 月 30 日（英文界面走 ISO 短格式） */
      function dayLabelOf(key) {
        if (!key) return "未知时间";
        const [y, m, d] = key.split("-").map(Number);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const diff = Math.round((today - new Date(y, m - 1, d)) / 86400000);
        if (diff === 0) return "今天";
        if (diff === 1) return "昨天";
        if (diff === 2) return "前天";
        if (lang === "en") {
          const p = (v) => String(v).padStart(2, "0");
          return y === now.getFullYear() ? `${p(m)}-${p(d)}` : `${y}-${p(m)}-${p(d)}`;
        }
        return y === now.getFullYear() ? `${m} 月 ${d} 日` : `${y} 年 ${m} 月 ${d} 日`;
      }

      /* 把当前列表按天切堆：组按日期新→旧（选「时间 ↑」时反过来），未知时间垫底 */
      function buildDayGroups(items) {
        const map = new Map();
        items.forEach((item, index) => {
          const key = dayKeyOf(item.mtime);
          let bucket = map.get(key);
          if (!bucket) {
            bucket = { key, label: dayLabelOf(key), entries: [] };
            map.set(key, bucket);
          }
          bucket.entries.push({ item, index });
        });
        const list = [...map.values()];
        const asc = state.sortMode === "time-asc";
        list.sort((a, b) => {
          if (!a.key) return 1;
          if (!b.key) return -1;
          return asc ? a.key.localeCompare(b.key) : b.key.localeCompare(a.key);
        });
        return list;
      }

      function shortestOf(columns) {
        let target = columns[0];
        for (const col of columns) {
          if (col.height < target.height) target = col;
        }
        return target;
      }

      function createDayBlock(group, colCount, mode = "grid") {
        const box = el("div", "lgb-tgroup");
        box.dataset.day = group.key || "unknown";
        const head = el("button", "lgb-tgroup-head");
        head.type = "button";
        head.append(
          el("span", "arw", "▾"),
          el("span", "t", group.label),
          elTpl("span", "n", "{n} 张", { n: group.entries.length }),
          el("span", "grow")
        );
        setTitle(head, group.key ? "点一下折叠 / 展开这一天" : "这些图读不到修改时间");
        if (state.collapsedDays.has(group.key)) box.classList.add("collapsed");
        head.addEventListener("click", () => {
          const collapsed = !box.classList.contains("collapsed");
          box.classList.toggle("collapsed", collapsed);
          if (collapsed) state.collapsedDays.add(group.key);
          else state.collapsedDays.delete(group.key);
        });
        // 网格：body 也带 lgb-grid 类（compact 那套样式才生效）；列表：body 直接是一个行列表
        const body =
          mode === "list"
            ? el("div", "lgb-list lgb-tgroup-rows")
            : el("div", "lgb-grid lgb-tgroup-grid");
        box.append(head, body);
        return {
          el: box,
          head,
          body,
          columns: mode === "list" ? null : makeColumns(body, 0, colCount),
        };
      }

      /* 时间线渲染：逐组、逐批，滚到哪画到哪；折叠只改 CSS，不丢已画好的图 */
      function renderTimeline(items, reset, { mode = "grid" } = {}) {
        const container = mode === "list" ? listBox : grid;
        const stamp = `${items.length}|${mode}`;
        if (reset || !state.tl || state.tl.stamp !== stamp) {
          state.tl = {
            list: buildDayGroups(items),
            blocks: new Map(),
            gi: 0,
            offset: 0,
            total: items.length,
            stamp,
            mode,
          };
          // 各组统一列数：跨组列宽才对得上；同时不超过最大组的张数，免得空列太多
          const maxPerDay = state.tl.list.reduce((m, g) => Math.max(m, g.entries.length), 0);
          state.tl.colCount = Math.max(1, Math.min(cols, maxPerDay || cols));
          grid.replaceChildren();
          listBox.replaceChildren();
          state.columns = [];
          state.rendered = 0;
        }
        if (mode === "grid") grid.classList.add("timeline");
        const tl = state.tl;
        let budget = PAGE_SIZE;
        while (budget > 0 && tl.gi < tl.list.length) {
          const group = tl.list[tl.gi];
          let block = tl.blocks.get(group.key);
          if (!block) {
            block = createDayBlock(group, tl.colCount, mode);
            tl.blocks.set(group.key, block);
            container.append(block.el);
          }
          const take = Math.min(budget, group.entries.length - tl.offset);
          for (let k = 0; k < take; k += 1) {
            const { item, index } = group.entries[tl.offset + k];
            if (mode === "list") {
              block.body.append(buildRow(item, index));
              continue;
            }
            const col = shortestOf(block.columns);
            col.el.append(buildItem(item, index));
            const ratio = item.width && item.height ? item.height / item.width : 1;
            col.height += col.width * ratio + COL_GAP;
          }
          tl.offset += take;
          budget -= take;
          state.rendered += take;
          if (tl.offset >= group.entries.length) {
            tl.gi += 1;
            tl.offset = 0;
          }
        }
      }

      function applyTimeGroup(on, { persist = true, rerender = true } = {}) {
        state.timeGroup = !!on;
        btnGroup.classList.toggle("primary", state.timeGroup);
        setTitle(
          btnGroup,
          state.timeGroup
            ? "已按修改时间分组：点组标题可折叠，再点这里关掉分组"
            : "按文件修改时间分组：一天一坨，点组标题可折叠"
        );
        if (persist) {
          try {
            localStorage.setItem(GROUP_KEY, state.timeGroup ? "1" : "0");
          } catch (err) {
            /* 忽略 */
          }
        }
        if (!rerender) return;
        state.rendered = 0;
        state.tl = null;
        gridScroll.scrollTop = 0;
        renderGrid();
      }

      function shortestColumn() {
        let target = state.columns[0];
        for (const col of state.columns) {
          if (col.height < target.height) target = col;
        }
        return target;
      }

      /* 复制 / 收藏 / 预览 / 删除：网格卡片和列表行共用一套绑定 */
      function wireItemActions(item, { copy, fav, zoom, del }) {
        del.addEventListener("click", (evt) => {
          evt.stopPropagation();
          hideTip();
          deletePaths([item.path]);
        });

        fav.addEventListener("click", (evt) => {
          evt.stopPropagation();
          hideTip();
          // 收藏时要先问放进哪个收藏夹；取消收藏直接生效
          favoriteOne(item, fav);
        });

        copy.addEventListener("click", async (evt) => {
          evt.stopPropagation();
          hideTip();
          await copyItemPrompt(item);
        });

        zoom.addEventListener("click", (evt) => {
          evt.stopPropagation();
          hideTip();
          openViewer(item);
        });
      }

      function buildItem(item, index) {
        const dom = el("div", "lgb-item");
        dom.dataset.path = item.path;
        // 用真实分辨率占位：图片没加载完也不会跳版
        dom.style.aspectRatio =
          item.width && item.height ? `${item.width} / ${item.height}` : "1 / 1";

        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.src = buildUrl("/local_gallery/thumb", { path: item.path, size: thumbSize() });
        img.addEventListener("error", () => {
          img.style.visibility = "hidden";
          dom.classList.add("broken");
        });

        const badge = el("div", "lgb-order");
        const txt = el("div", `lgb-txt${item.has_prompt ? "" : " off"}`, item.has_prompt ? "TXT" : "—");
        setTitle(txt, item.has_prompt ? "有同名提示词文件" : "没有同名提示词文件");
        const zoom = el("div", "lgb-zoom");
        zoom.append(icon("expand", 12));
        setTitle(zoom, "大图预览");
        const del = el("div", "lgb-del");
        del.append(icon("trash", 12));
        setTitle(del, "删除（移到回收站）");
        const favOn = state.favorites.has(item.path);
        const fav = el("div", `lgb-fav${favOn ? " on" : ""}`, favOn ? "★" : "☆");
        setTitle(fav, favOn ? "取消收藏" : "收藏这张");

        // 复制这张的提示词：没有同名 .txt 时按钮变淡，点了给出原因
        const copy = el("div", `lgb-copy${item.has_prompt ? "" : " off"}`);
        copy.append(icon("copy", 12));
        setTitle(copy, item.has_prompt ? "复制这张的提示词" : "这张没有同名提示词");

        // 悬浮操作组：复制 / 收藏 / 预览 / 删除
        const acts = el("div", "lgb-acts");
        acts.append(copy, fav, zoom, del);

        // 文件信息：文件名常驻，尺寸/体积在悬停时补一行
        const cap = el("div", "lgb-cap");
        cap.append(el("div", "lgb-name", item.name));
        if (item.width && item.height) {
          cap.append(
            el(
              "div",
              "lgb-meta",
              `${item.width}×${item.height}${item.size ? ` · ${fmtSize(item.size)}` : ""}`
            )
          );
        }

        dom.classList.toggle("is-fav", favOn);
        dom.append(img, badge, txt, acts, cap);

        wireItemActions(item, { copy, fav, zoom, del });

        dom.addEventListener("click", (evt) => {
          // 图标用内联 svg，命中判断要连子节点一起算
          if (
            zoom.contains?.(evt.target) ||
            del.contains?.(evt.target) ||
            fav.contains?.(evt.target) ||
            copy.contains?.(evt.target)
          ) {
            return;
          }
          toggleSelect(item.path, index, {
            range: evt.shiftKey,
            exclusive: evt.ctrlKey || evt.metaKey,
          });
          // 顺手把提示词读进缓存，保证写进 selection_data 的副本也是最新的
          ensurePrompt(item).then(() => commitSelection());
        });
        dom.addEventListener("contextmenu", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          openImageMenu(item, evt);
        });
        bindHover(dom, item);
        return dom;
      }

      function renderGrid({ reset = true } = {}) {
        const items = visibleItems();
        // 只有图库页的渲染结果才是提示词页的依据
        if (state.source === "paths") state.galleryVisible = items;

        if (state.items.length) {
          setTpl(countLabel, "{a} / {b} 张{done}", {
            a: items.length,
            b: state.items.length,
            done: state.busy ? ` · ${t("读取中")}` : "",
          });
        } else {
          if (state.busy) setTpl(countLabel, "读取中…");
          else countLabel.textContent = "—";
        }

        if (!items.length) {
          const empty = el("div", "lgb-empty", state.busy
            ? "正在扫描路径…"
            : getPaths().length
              ? "这些路径下没有图片。到「设置 → 浏览本机路径」勾上「含子目录」，或换一个路径。"
              : "还没有图片 —— 打开「设置 → 浏览本机路径」加一个文件夹。");
          grid.classList.remove("timeline");
          grid.replaceChildren();
          listBox.replaceChildren();
          (state.view === "list" ? listBox : grid).append(empty);
          state.columns = [];
          state.tl = null;
          paintSelection();
          return;
        }

        // 列表模式：一行一张；开了时间分组就按天分块装行
        if (state.view === "list") {
          if (state.timeGroup && activeTab === "gallery") {
            renderTimeline(items, reset, { mode: "list" });
            paintSelection();
            fillViewport();
            return;
          }
          renderList(items, reset);
          return;
        }

        // 图库页开了「时间分组」：自己管列，不能走 resetColumns
        // （那套会在 reset=false 时把已经画好的组清空，只剩后面几组）
        if (state.timeGroup && activeTab === "gallery") {
          renderTimeline(items, reset);
          paintSelection();
          fillViewport();
          return;
        }

        if (reset) {
          resetColumns(items.length);
          state.rendered = 0;
        } else if (!state.columns.length) {
          resetColumns(items.length);
          state.rendered = 0;
        }

        const slice = items.slice(state.rendered, state.rendered + PAGE_SIZE);
        slice.forEach((item, offset) => {
          const index = state.rendered + offset;
          const column = shortestColumn();
          const dom = buildItem(item, index);
          column.el.append(dom);
          const ratio = item.width && item.height ? item.height / item.width : 1;
          column.height += column.width * ratio + COL_GAP;
        });
        state.rendered += slice.length;

        paintSelection();
        fillViewport();
      }

      // 内容没撑满可视区就继续追加（首次打开 / 换列数后）
      let filling = false;
      function fillViewport() {
        if (filling || state.busy) return;
        if (gridScroll.clientHeight < 40) return; // 节点还没完成布局，等下次
        const items = visibleItems();
        if (state.rendered >= items.length) return;
        if (gridScroll.scrollHeight - gridScroll.clientHeight > 60) return;
        filling = true;
        requestAnimationFrame(() => {
          filling = false;
          if (state.rendered >= visibleItems().length) return;
          renderGrid({ reset: false });
        });
      }

      // 滚到底部附近自动加载下一页
      function maybeLoadMore() {
        if (state.busy) return;
        const items = visibleItems();
        if (state.rendered >= items.length) return;
        const remain = gridScroll.scrollHeight - gridScroll.scrollTop - gridScroll.clientHeight;
        if (remain < 500) renderGrid({ reset: false });
      }

      /* ---------------- 扫描 ---------------- */
      async function refresh({ silent = false, overridePaths = null } = {}) {
        const fromFavorites = Array.isArray(overridePaths);
        const paths = fromFavorites ? overridePaths.filter(Boolean) : getPaths();
        state.source = fromFavorites ? "favorites" : "paths";
        state.invalid = [];
        // 路径变了（换了目录 / 重新扫描）就把不在这些目录下的提示词选中项清掉
        if (!fromFavorites) prunePromptSelection();
        if (!paths.length) {
          state.items = [];
          state.orphanPrompts = 0;
          state.orphanSamples = [];
          state.orphanItems = [];
          state.orphanCount = 0;
          state.orphanLoaded = false;
          state.busy = false;
          renderChips();
          renderGrid();
          updateTabCounts();
          if (activeTab === "prompts" && promptMode === "orphans") renderOrphans({ reset: true });
          setStatus(
            fromFavorites
              ? state.favorites.size
                ? "这个收藏夹里还没有图片"
                : "还没有收藏 —— 在图库里点缩略图左上角的 ☆ 收藏"
              : "还没有图片 —— 打开「设置 → 浏览本机路径」加一个文件夹"
          );
          hideTip();
          return;
        }

        const seq = ++state.seq;
        state.busy = true;
        if (!silent) setTpl(countLabel, "读取中…");
        setStatus("正在扫描 {n} 个路径…", { vars: { n: paths.length } });

        // 走 POST：收藏多的时候（几百张）路径拼进 URL 会被服务端 431/400 顶回来
        const body = {
          path: paths.join("\n"),
          recursive: recursiveChk.input.checked ? 1 : 0,
          only_with_prompt: onlyPromptChk.input.checked ? 1 : 0,
        };

        let items = [];
        let invalid = [];
        let errorText = "";
        let truncated = false;
        let orphan = 0;
        let orphanSamples = [];
        try {
          const data = await apiJson("/local_gallery/list", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          items = Array.isArray(data.items) ? data.items : [];
          invalid = Array.isArray(data.invalid) ? data.invalid : [];
          truncated = !!data.truncated;
          orphan = Number(data.orphan_prompts) || 0;
          orphanSamples = Array.isArray(data.orphan_samples) ? data.orphan_samples : [];
          if (!data.ok && data.error) errorText = data.error;
        } catch (err) {
          errorText = t("扫描失败：{err}", { err: err.message || err });
        }

        if (seq !== state.seq) return;

        state.items = items;
        // 记下扫描顺序（排序切回「默认」时用），再按当前排序规则排一遍
        items.forEach((it, i) => {
          it.__ord = i;
        });
        sortItemsInPlace();
        state.invalid = invalid;
        // 孤儿提示词属于「图库」：收藏页的扫描结果不能覆盖它，
        // 否则在收藏页切到提示词页时「无匹配提示词」会变成 0
        if (!fromFavorites) {
          state.orphanPrompts = orphan;
          state.orphanSamples = orphanSamples;
          // 路径/筛选变了，孤儿列表要重新拉
          state.orphanLoaded = false;
        }
        state.busy = false;
        state.promptCache.clear();
        renderChips();
        renderGrid();
        // 图库页刷新后，提示词页（固定跟图库）要跟着重绘；收藏页的刷新不用动它
        if (activeTab === "prompts" && !fromFavorites) {
          if (promptMode === "orphans") loadOrphans({ force: true });
          else renderPrompts({ reset: true });
        }

        const notes = [];
        if (errorText) notes.push(errorText);
        if (truncated) notes.push(t("图片数量超过扫描上限，已截断"));
        if (invalid.length) notes.push(t("{n} 个路径读取失败（红色标签）", { n: invalid.length }));

        if (notes.length) {
          setStatus(notes.join(" · "), { error: true });
        } else if (items.length) {
          // 孤儿数量直接进模板，切语言时整句一起翻（别提前拼成字符串）

          const resumed = state.restoredFromStore ? t("已接上上次的路径") + " · " : "";
          state.restoredFromStore = false;
          // 收藏页的 paths 就是收藏条目本身，报「188 个路径」没意义
          const multi = !fromFavorites && paths.length > 1 ? t("{n} 个路径 · ", { n: paths.length }) : "";
          const statusTpl =
            orphan > 0
              ? "{resumed}{multi}已读到 {n} 张图，悬停看提示词 · {o} 个提示词匹配不到图片"
              : "{resumed}{multi}已读到 {n} 张图，悬停看提示词";
          setStatus(statusTpl, {
            vars: { resumed, multi, n: items.length, o: orphan },
            hint:
              orphan > 0
                ? `${t("这些提示词文件同目录下没有同名图片：")}\n${orphanSamples.join("\n")}`
                : "",
          });
        } else {
          setStatus("这些路径下没有图片", { error: true });
        }
        updateTabCounts();
      }

      /* ---------------- 系统文件夹选择框 ---------------- */
      // Windows 自带的选择框（服务端弹），选完直接把目录加进路径列表
      // 选择框是服务端弹的，Show() 会一直挂到用户选完 —— 这期间按钮还允许点，
      // 只是提示「框已经开了」，免得用户以为没反应（以前是直接 return，点几次都没动静）
      let picking = false;

      async function pickFolderNative(trigger) {
        if (picking) {
          setStatus("选择框已经打开了，请到弹出的窗口里选文件夹（按住 Ctrl 可多选）");
          return;
        }
        picking = true;
        // 不 disable：按钮一禁用，用户再点就毫无反应
        if (trigger) trigger.classList.add("busy");
        setStatus("正在打开系统文件夹选择框…");
        // 框弹出后要等用户操作，这里补一句提示，不然一直卡在「正在打开…」
        const hintTimer = setTimeout(() => {
          if (picking) setStatus("选择框已弹出，请在窗口里选文件夹（按住 Ctrl 可多选）");
        }, 1500);
        // 服务端那边 dialog.Show() 最长会挂 5 分钟；这里 3 分钟就放手，避免按钮一直「禁用」
        const ctrl = typeof AbortController === "function" ? new AbortController() : null;
        const guard = ctrl ? setTimeout(() => ctrl.abort(), 180000) : null;
        try {
          const data = await apiJson("/local_gallery/pick_folder", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initial: getPaths()[0] || "" }),
            signal: ctrl ? ctrl.signal : undefined,
          });
          const picked = Array.isArray(data.paths) ? data.paths.filter(Boolean) : [];
          if (!picked.length) {
            setStatus("没有选择文件夹");
            return;
          }
          // 先加路径再自己刷一次，最后再写状态（refresh 会覆盖状态行）
          setPaths([...getPaths(), ...picked], { refreshNow: false });
          await refresh();
          setStatus("已加入 {n} 个文件夹", { vars: { n: picked.length } });
        } catch (err) {
          const aborted = err && (err.name === "AbortError" || /abort/i.test(String(err.message || "")));
          if (aborted) {
            setStatus("等了 3 分钟没结果：选择框可能被其它窗口挡住了，点任务栏找一下，或再点一次「浏览」", {
              error: true,
            });
          } else {
            setStatus("系统选择框打不开（{err}）：到「设置 → 浏览本机路径」再试一次，或用那里的面板内浏览", {
              error: true,
              vars: { err: err.message || err },
            });
          }
        } finally {
          clearTimeout(guard);
          clearTimeout(hintTimer);
          picking = false;
          if (trigger) trigger.classList.remove("busy");
        }
      }

      /* ---------------- 内置文件浏览器 ---------------- */
      function openBrowser(startPath) {
        let currentPath = startPath || getPaths()[0] || "";
        const picked = new Set();

        const overlay = mkOverlay();
        const box = el("div", "lgb-br");

        const head = el("div", "lgb-br-head");
        head.append(el("div", "title", "浏览本机路径"), el("div", "hint", "多选图片加入，或把整个文件夹加进来"));
        const btnClose = el("button", "lgb-btn warn", "关闭");
        setTitle(btnClose, "关闭（Esc / 点外面也行）");
        head.append(btnClose);
        // 让 hint 撑满
        head.children[1].style.flex = "1 1 auto";

        const pathRow = el("div", "lgb-br-row");
        const pathLabel = el("div", "lgb-br-path");
        const pathValue = el("span", "val", "");
        pathLabel.append(el("span", "cap", "当前："), pathValue);
        const btnUseDir = el("button", "lgb-btn primary", "＋ 加入此文件夹");
        pathRow.append(pathLabel, btnUseDir);

        // 已加入的路径列表（原来在主面板，挪到这里，能看全路径）
        const savedRow = el("div", "lgb-br-saved");
        const recentRow = el("div", "lgb-recent");
        recentRow.style.display = "none";
        const msg = el("div", "lgb-br-msg", "");
        msg.style.display = "none";

        const body = el("div", "lgb-br-body");
        const fileCol = el("div", "lgb-br-col");
        const fileTitle = el("h4", "", "图片");
        const fileList = el("div", "lgb-br-list");
        const fileGrid = el("div", "lgb-filegrid");
        fileList.append(fileGrid);
        fileCol.append(fileTitle, fileList);
        body.append(fileCol);

        const foot = el("div", "lgb-br-foot");
        const brCount = el("span", "lgb-count", "已选 0 张");
        const footSpacer = document.createElement("div");
        footSpacer.style.flex = "1 1 auto";
        const btnAddPicked = el("button", "lgb-btn primary", "添加选中图片");
        const btnReset = el("button", "lgb-btn", "取消选择");
        foot.append(brCount, footSpacer, btnReset, btnAddPicked);

        box.append(head, pathRow, savedRow, recentRow, msg, body, foot);
        overlay.append(box);
        document.body.appendChild(overlay);
        renderPathChips(savedRow, { onChange: () => setMsg("路径列表已更新") });

        function setMsg(text, vars = null) {
          if (text) setLabel(msg, t(text, vars));
          else msg.textContent = "";
          msg.style.display = text ? "block" : "none";
        }
        function updateCount() {
          setTpl(brCount, "已选 {n} 张", { n: picked.size });
        }
        function renderRecentRow() {
          const list = loadRecent().filter(
            (p) => p.toLowerCase() !== String(currentPath || "").toLowerCase()
          );
          recentRow.replaceChildren();
          if (!list.length) {
            recentRow.style.display = "none";
            return;
          }
          recentRow.style.display = "flex";
          recentRow.append(el("span", "lgb-count", "最近："));
          list.slice(0, 6).forEach((path) => {
            const label = shortName(path) || path;
            const btn = el("button", "lgb-btn", label);
            btn.title = path;
            btn.addEventListener("click", () => load(path));
            recentRow.append(btn);
          });
        }
        /* 关闭方式：右上角「关闭」按钮，或者按 Esc。点空白处不关，
           免得选路径的时候手一滑点到面板外面就没了。 */
        const close = () => overlay.remove();
        const onKey = (evt) => {
          if (evt.key !== "Escape") return;
          evt.preventDefault();
          close();
        };
        window.addEventListener("keydown", onKey);
        btnClose.addEventListener("click", () => {
          window.removeEventListener("keydown", onKey);
          close();
        });

        async function load(path) {
          setMsg("");
          fileGrid.replaceChildren(el("div", "lgb-empty", "读取中…"));
          try {
            const data = await apiJson(`/local_gallery/browse?path=${encodeURIComponent(path || "")}`);
            if (!data.ok) {
              setMsg(data.error || "读取失败");
              fileGrid.replaceChildren(el("div", "lgb-empty", data.error || "读取失败"));
              return;
            }
            currentPath = data.path || "";
            if (currentPath) pushRecent(currentPath);
            renderRecentRow();
            // 当前路径只做展示（要换目录用「浏览」的系统选择框，或点下面的「最近」）
            setLabel(pathValue, currentPath || "还没选目录");
            pathValue.title = currentPath || "";
            fileGrid.replaceChildren();

            const images = data.images || [];
            setTpl(fileTitle, "图片（{n}）", { n: data.image_total || 0 });
            if (!images.length) fileGrid.append(el("div", "lgb-empty", "这个文件夹里没有图片"));
            images.forEach((file) => {
              const dom = el("div", "lgb-fileitem");
              dom.dataset.path = file.path;
              dom.title = `${file.name}\n${fmtSize(file.size)}`;
              const img = document.createElement("img");
              img.loading = "lazy";
              img.src = buildUrl("/local_gallery/thumb", { path: file.path, size: 128 });
              const tick = el("div", "tick", "");
              const nm = el("div", "nm", file.name);
              dom.append(img, tick, nm);
              if (picked.has(file.path)) {
                dom.classList.add("on");
                tick.textContent = "✓";
              }
              dom.addEventListener("click", () => {
                if (picked.has(file.path)) {
                  picked.delete(file.path);
                  dom.classList.remove("on");
                  tick.textContent = "";
                } else {
                  picked.add(file.path);
                  dom.classList.add("on");
                  tick.textContent = "✓";
                }
                updateCount();
              });
              fileGrid.append(dom);
            });
            if (data.truncated) {
              setMsg("文件过多，只显示了一部分（用「加入此文件夹」整目录添加更合适）");
            }
          } catch (err) {
            setMsg(`读取失败：${err.message || err}`);
            fileGrid.replaceChildren(el("div", "lgb-empty", String(err.message || err)));
          }
        }

        btnClose.addEventListener("click", close);
        btnUseDir.addEventListener("click", () => {
          if (!currentPath) {
            setMsg("先用「浏览」的系统选择框选一个文件夹");
            return;
          }
          const before = getPaths().length;
          addPaths([currentPath]);
          const added = getPaths().length > before;
          // 路径列表就在这页，加完刷新一下，不用关窗
          renderPathChips(savedRow, { onChange: () => setMsg("路径列表已更新") });
          setMsg(added ? "已加入：{path}" : "这个文件夹已经在列表里了", { path: currentPath });
        });
        btnAddPicked.addEventListener("click", () => {
          if (!picked.size) {
            setMsg("先点选右侧的图片");
            return;
          }
          addPaths([...picked]);
          renderPathChips(savedRow, { onChange: () => setMsg("路径列表已更新") });
          setMsg("已加入 {n} 张图片", { n: picked.size });
        });
        btnReset.addEventListener("click", () => {
          picked.clear();
          fileGrid.querySelectorAll(".lgb-fileitem").forEach((dom) => {
            dom.classList.remove("on");
            const tick = dom.querySelector(".tick");
            if (tick) tick.textContent = "";
          });
          updateCount();
        });

        load(currentPath);
      }
      /* ---------------- 事件 ---------------- */
      btnSettings.addEventListener("click", () => openSettings());

      /* Ctrl/⌘ + Z：撤销最近一次「移到回收站」。
         只把焦点在面板里（或鼠标悬在面板上）时拦下来，别抢 ComfyUI 画布自己的撤销 */
      document.addEventListener(
        "keydown",
        (evt) => {
          if (!(evt.ctrlKey || evt.metaKey) || evt.shiftKey || evt.altKey) return;
          if (String(evt.key).toLowerCase() !== "z") return;
          const el = evt.target;
          if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
            return; // 输入框里交给浏览器自己的撤销
          }
          if (!wrap.contains(el) && !wrap.matches(":hover")) return;
          if (!undoStack.length) return;
          evt.preventDefault();
          evt.stopPropagation();
          undoLast();
        },
        true
      );
      btnTrash.addEventListener("click", () => openTrash());
      btnDelSel.addEventListener("click", () => {
        // 提示词页选的是提示词，这里就只删提示词文件，别顺手把图片带走
        if (activeTab === "prompts") {
          const picked = [...state.promptSel.keys()];
          if (picked.length) deletePrompts(picked);
          return;
        }
        if (!state.selected.size) return;
        openDeleteMenu();
      });
      btnFavFolder.addEventListener("click", () => {
        if (!state.selected.size) return;
        openFolderPicker([...state.selected.keys()]);
      });
      btnUnfav.addEventListener("click", () => {
        if (!state.selected.size) return;
        unfavoritePaths([...state.selected.keys()]);
      });

      btnJumpReverse.addEventListener("click", () => switchTab("reverse"));
      btnJumpConvert.addEventListener("click", () => switchTab("convert"));
      tabGallery.addEventListener("click", () => switchTab("gallery"));
      tabFavorites.addEventListener("click", () => switchTab("favorites"));
      tabReverse.addEventListener("click", () => switchTab("reverse"));
      tabConvert.addEventListener("click", () => switchTab("convert"));
      tabPrompts.addEventListener("click", () => switchTab("prompts"));
      // 提示词页内的两档切换
      subPrompts.addEventListener("click", () => setPromptMode("prompts"));
      subOrphans.addEventListener("click", () => setPromptMode("orphans"));
      searchModeBtn.addEventListener("click", () => {
        const idx = SEARCH_MODES.findIndex((m) => m.key === state.searchMode);
        applySearchMode(SEARCH_MODES[(idx + 1) % SEARCH_MODES.length].key);
        runSearch();
      });
      sortModeBtn.addEventListener("click", () => openSortMenu());
      btnPromptCopyAll.addEventListener("click", async () => {
        const all = promptItems();
        if (!all.length) {
          setStatus("当前没有可复制的提示词", { error: true });
          return;
        }
        btnPromptCopyAll.disabled = true;
        setTpl(btnPromptCopyAll, "读取中…");
        try {
          const lines = [];
          for (const item of all) {
            const entry = await ensurePrompt(item);
            lines.push(entry?.prompt || "");
          }
          await copyText(lines.join("\n\n"), "已复制 {n} 条提示词", { n: lines.length });
        } finally {
          btnPromptCopyAll.disabled = false;
          setTpl(btnPromptCopyAll, "复制全部");
        }
      });
      promptScroll.addEventListener(
        "scroll",
        () => {
          const remain = promptScroll.scrollHeight - promptScroll.scrollTop - promptScroll.clientHeight;
          if (remain < 400) {
            const all = promptItems();
            if (promptRendered < all.length) renderPrompts({ reset: false });
          }
        },
        { passive: true }
      );
      btnReload.addEventListener("click", () => {
        if (state.source === "favorites") loadFavorites({ refreshView: true });
        else refresh();
      });
      recursiveChk.input.addEventListener("change", () => refresh());
      onlyPromptChk.input.addEventListener("change", () => refresh());

      let searchTimer = null;
      searchInput.addEventListener("input", () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.filter = searchInput.value;
          runSearch();
        }, 220);
      });

      btnAll.addEventListener("click", () => {
        if (onPromptsTab()) {
          state.promptSel.clear();
          activePromptList().forEach((item, index) => state.promptSel.set(item.path, index));
          commitSelection();
          paintSelection();
          return;
        }
        // 全选必然是「多张」：单选模式下先切回多选，别让按钮点了没反应
        const wasSingle = state.pickMode === "single";
        if (wasSingle) setPickMode("multi");
        state.selected.clear();
        visibleItems().forEach((item, index) => state.selected.set(item.path, index));
        commitSelection();
        paintSelection();
        if (wasSingle) setStatus("已切到多选并全选");
      });
      btnNone.addEventListener("click", () => {
        if (onPromptsTab()) {
          state.promptSel.clear();
          state.promptLast = -1;
          commitSelection();
          paintSelection();
          setStatus("已清空提示词的选择");
          return;
        }
        state.selected.clear();
        state.lastClicked = -1;
        commitSelection();
        paintSelection();
        setStatus("已清空选择");
      });
      btnCopy.addEventListener("click", () => copySelectedPrompts());

      /* ---------------- 初始化 ---------------- */
      applyCols(cols, { persist: false });
      try {
        const savedMode = localStorage.getItem(SEARCH_MODE_KEY);
        if (SEARCH_MODES.some((m) => m.key === savedMode)) state.searchMode = savedMode;
      } catch (err) {
        /* 忽略 */
      }
      applySearchMode(state.searchMode, { persist: false });
      try {
        const savedSort = localStorage.getItem(SORT_KEY);
        if (SORT_MODES.some((m) => m.key === savedSort)) state.sortMode = savedSort;
        if (localStorage.getItem(GROUP_KEY) === "1") state.timeGroup = true;
        if (localStorage.getItem(VIEW_KEY) === "list") state.view = "list";
      } catch (err) {
        /* 忽略 */
      }
      applySortMode(state.sortMode, { persist: false, rerender: false });
      // 视图偏好也在建面板时就套上（不重绘，等首次 refresh）
      setViewMode(state.view, { persist: false, rerender: false });
      updateTabCounts();
      applyHints();
      loadFavorites();
      loadUiSettings();
      loadConfig();
      sizeInput.addEventListener("input", () => applyCols(sizeInput.value));
      sizeInput.addEventListener("change", () => {
        // 松手一定重排一次：防抖计时器可能刚好被这次 change 清掉
        applyCols(sizeInput.value, { immediate: true });
      });
      renderChips();
      restoreSelection();
      if (restoreSavedPaths()) state.restoredFromStore = true;
      if (getPaths().length) {
        setTimeout(() => refresh({ silent: true }), 150);
      } else {
        renderGrid();
        setStatus("打开「设置 → 浏览本机路径」加一个文件夹开始");
        // 浏览器里没有记录（换浏览器 / 不同源）时，再向后端要一次
        if (shouldAskServer()) setTimeout(() => restorePathsFromServer(), 120);
      }

      // 挂在实例上（不是 prototype），避免每个节点都往原型上叠一层包装
      const onConfigure = node.onConfigure;
      node.onConfigure = function (info) {
        onConfigure?.apply(this, arguments);
        setTimeout(() => {
          // 工作流里的 folder_path 为空时（没保存过 / 旧工作流）也接上上次的路径
          if (restoreSavedPaths()) state.restoredFromStore = true;
          renderChips();
          restoreSelection();
          if (getPaths().length) refresh({ silent: true });
          else if (shouldAskServer()) restorePathsFromServer();
        }, 60);
      };

      const onRemoved = node.onRemoved;
      node.onRemoved = function () {
        hideTip();
        try {
          themeObserver?.disconnect();
        } catch (err) {
          /* 忽略 */
        }
        themeObserver = null;
        themeAppliers.delete(applyTheme);
        if (themeTimer) {
          clearTimeout(themeTimer);
          themeTimer = null;
        }
        try {
          tip.remove();
        } catch (err) {
          /* 忽略 */
        }
        onRemoved?.apply(this, arguments);
      };

      node.lgbRefresh = () => refresh();
    };
  },
});
