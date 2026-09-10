# PASSAGE by ZYZ · 本地重建版

从 `PASSAGE-by-ZYZ-IELTS-Reading-2026-09-06-r1.html` 分发包恢复的可编辑工程。
保留原界面、170 篇文章、2,263 个答题位置，以及练习、组卷、模考、复盘和本地记录逻辑。

这是恢复后的源码组织，不是作者原始工程。没有恢复原始构建系统、Git 历史或签名私钥。
本工程构建的是明确标记的**未签名本地重建版**，不宣称通过原作者的发布认证。

## 本地运行

需要 Python 3.10+；运行检查另需 Node.js 18+。无需安装 npm 依赖。

```sh
npm run dev
```

打开 <http://127.0.0.1:4173>。该命令先构建，再提供仅本机可访问的预览服务。
修改源码后运行 `npm run build`，刷新页面即可；当前没有自动热更新。

不用 npm 也可以：

```sh
python3 scripts/serve.py --port 4173
```

## 构建与检查

```sh
npm run build
npm run check
```

- `dist/index.html`：约 26.8 MB 的单文件离线应用，可直接用桌面浏览器打开。
- `dist/build.json`：构建文件的 SHA-256 和来源摘要；这是校验清单，不是数字签名。
- `npm run check`：检查构建可重复性、17 个脚本的语法、170 篇整篇组卷、478 个题型组卷、空答评分和解析关联、40 题组合与运行时插槽。

`dist/` 是生成目录，不提交 Git。更改其中文件会在下次构建时被覆盖。

## 源码导航

| 位置 | 内容 |
| --- | --- |
| `src/app/index.html` | 首页、练习、模考、记录和弹窗结构 |
| `src/app/styles/` | 外层应用样式，按原包顺序保留 |
| `src/app/app.js` | 应用状态、筛选、练习启动、模考、复盘和记录交互 |
| `src/app/composer.js` | 组卷、题型选择、题号映射和练习包生成 |
| `src/app/record-store.js` | IndexedDB、本地存储、备份和恢复 |
| `src/runtime/index.html` | iframe 中的答题页模板 |
| `src/runtime/controller.js` | 答题、计时、提交和复盘控制 |
| `src/runtime/question-*.js` | 题型注册与题目数据适配 |
| `src/runtime/answer-grading.js` | 答案归一化和评分 |
| `src/runtime/homework-report.js` | 成绩报告、分数换算和分篇用时 |
| `src/runtime/attempt-ledger.js` | 作答次数与提交记录账本 |
| `src/runtime/bilingual-link.js` | 原文与译文句子联动 |
| `data/library/` | 文章、题目、答案、中文解析和元数据 |
| `data/manifest/` | 月度题库清单 |
| `data/translations/` | 全文翻译及其来源绑定 |
| `data/controller/` | 证据位置辅助数据 |
| `data/bilingual-link/` | 双语句子对应关系 |
| `data/app/` | 原包内嵌的旧记录复盘数据 |
| `reference/` | 原包校验信息、外层签名逻辑与启动门禁存档，不参与构建 |
| `scripts/` | 提取、构建、本地预览和验证工具 |

大段 JSON 已从 JavaScript 中拆出。HTML 的 `<!-- @include ... -->` 和 JavaScript 的
`__ZYZ_JSON__(...)` / `__ZYZ_HTML_STRING__(...)` 由构建器展开，不是浏览器运行时 API。
答题模板中唯一的 `__IELTS_PACKAGE_JSON__` 则留给组卷模块在启动练习时填充。
字体等已有内联资源仍保留在样式中，因此输出没有外部静态资源依赖。

## 数据与原版关系

原包没有改动。来源文件摘要记录在 `reference/recovery.json`，原包副本保存在本机 `original/`，不提交 Git。
代码中的历史版本标识、存储键、数据完整性规则和原有署名均保留；这里只调整独立启动入口并添加重建版标记。
原始外层签名校验代码保存在 `reference/`，不作为重建版的信任凭证。

练习记录保存在当前浏览器、当前来源下。HTTP 预览与直接打开文件的记录不自动共享；可通过“立即完整备份”与“选择备份文件”迁移。
重建版之间的备份迁移已经抽样验证。原版已有记录的迁移尚未验收，请先保留原版备份。
原包中的第三方许可注释与产品署名保留；本仓库不另行给原代码和题库授予开源许可。

## 重新提取

初次提取已完成。需要验证提取过程时，请使用另一个空目录，以免覆盖已修改的源码：

```sh
python3 scripts/recover.py /path/to/original.html --output /tmp/zyz-recovery
```

提取器会拒绝覆盖已有 `src/`、`data/` 或 `reference/` 的目录。
当前提取器针对给定的 2026-09-06-r1 分发包结构编写。

本次验证范围及未覆盖项见 `docs/verification.md`。
