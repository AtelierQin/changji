# 长技 · 凡人天梯

> 凡人的天赋，真实的天梯。把游戏里那棵看得见的树，种进真实的人生。

一棵真实生活的技能树 — 二十项技能、五级进阶、五大领域、可见的成长与可追的来路。

**版本**: 1.0.0  
**许可证**: CC BY-NC 4.0（见 [LICENSE](./LICENSE)）  
**入口**: [`real-life-skill-tree.html`](./real-life-skill-tree.html) — 单文件应用，零依赖

---

## 一句话使用

打开 HTML，勾今天的五个小修，看自己的树长。

## 它是什么

一个完全跑在浏览器里的单页应用 — 不需要后端，不需要账号，不需要网络（Google Fonts 是可选的，断网也能用）。你的所有数据都存在浏览器本地的 `localStorage`，不会离开你的设备。

## 怎么用

### 第一次打开

打开 `real-life-skill-tree.html`（双击或拖入浏览器）。看到的"1,240 XP / 解锁 12/20 / 登顶 3 / 连修 23 天"是**示例状态**，不是你的真实数据。

### 把它变成你自己的

打开浏览器开发者工具（F12），在 Console 输入：

```js
CJ.reset()
```

然后刷新。这会清空示例状态，从零开始。

### 记录每天的修习

- **点 SVG 节点** — 选中技能，看详解、记录一次修习（+XP）、重置。
- **勾今日五个小修** — 顶部 "今日修习" 区域。每勾一个，对应技能加经验，可能触发升阶。
- **看长程进度** — 角色面板实时反映总 XP、解锁数、登顶数、连修天数。

### 备份与迁移

```js
// 导出当前所有数据为 JSON（控制台会打印）
CJ.export()

// 从 JSON 字符串恢复（黏贴控制台执行）
CJ.import('{"schema":"changji-state","version":1,...}')
```

或者用页面底部的"导出 / 导入"按钮。

## 数据存储

所有进度存在浏览器 `localStorage` 的 `changji-state` 键下。Schema 带版本号，未来结构变更不会污染你的老数据。

**清浏览器数据 = 进度丢失** — 重要节点请导出备份。

## 隐私

- 无后端、无第三方分析、无 cookie、无网络请求（除 Google Fonts）。
- Google Fonts 会在你的 IP 发到 Google CDN 加载字体；如需彻底离线，把 `<link>` 那一行删掉，浏览器会自动 fallback 到 system-ui。

## 项目结构

```
Qin-OS/
├── real-life-skill-tree.html   # 唯一应用入口
├── README.md                   # 本文件
├── LICENSE                     # CC BY-NC 4.0
├── CHANGELOG.md                # 版本历史
├── REFERENCES.md               # 方法论引用出处
├── REFLECTION.md               # 7 日反思模板
└── .claude/                    # 开发辅助配置
```

## 设计

设计 token 锁定于 **Atelier Qin**：黑白极简、衬线主导、monospace 用于元数据。颜色变量在文件 `:root`，不要硬编码色值。

## 浏览器要求

需要支持：
- CSS `color-mix()`（Chrome 111+, Firefox 113+, Safari 16.2+）
- CSS `backdrop-filter`（主流浏览器均支持）
- ES2017+（无 transpilation）

旧浏览器会丢失半透明背景，不影响核心功能。

## 无障碍

- 全键盘可达：Tab 进入节点 → Enter / Space 选中
- 尊重 `prefers-reduced-motion` — 减少动画
- 焦点环可见（WCAG 2.4.7）
- 屏幕阅读器：节点带 `aria-label`

## 不做的事

- **不做账号系统** — 单设备单浏览器。导出导入就是迁移手段。
- **不做云同步** — 你的数据你做主。
- **不做社交 / 排行榜** — 这棵树只关于你。
- **不做商业变现** — CC BY-NC 4.0 禁止商用。

## 反馈与贡献

仓库 Issues 区欢迎功能建议与 bug 报告。方法论层面的质疑尤其欢迎 — 这是这套工具的地基。

引用研究请见 [REFERENCES.md](./REFERENCES.md)。

## 致谢

- Dreyfus, Lally, Ericsson, Salomon & Perkins, Flavell — 这棵树的学术根基
- Noto Serif SC — 中文衬线字体
- 所有花 30 天把一件事从「未启」带到「初觉」的人

— 长技 · Atelier Qin · 2025
