# IELTS Reading · 自有题目引擎

复用 PASSAGE by ZYZ 的阅读题型渲染、判分和复盘规则，让自己的题目也能变成可交互、可离线分发的阅读练习。

**导入题目 JSON → 校验 → 作答 → 判分与解析 → 导出自己的离线练习包。**

默认入口不加载原题库，也不依赖原包月度目录或签名。原来的 170 篇题仅保留作参考与回归样本。

## 启动

需要 Python 3.10+ 和 Node.js 18+。没有 npm 依赖需要安装。

```sh
npm run dev
```

打开 <http://127.0.0.1:4173>，导入自己的 JSON，或先点击“试用示例题目”。
示例是新编的社区花园短文，包含 5 道题和中文解析，不使用原题库文章。
后台入口为 http://127.0.0.1:4173/admin，可管理题目、校验、预览并下载 HTML。

修改源码后运行 `npm run build`，刷新页面；没有自动热更新。
不用 npm 也可运行 `python3 scripts/serve.py --port 4173`。

## 题目怎么准备

复制 `examples/community-garden.json` 修改，然后在首页导入。浏览器会指出缺失字段或关联错误。
支持原引擎的 17 种阅读题型组合，包含选项、填空、匹配、表格、流程图与图示。

- [题目格式与嵌入接口](docs/content-format.md)：字段、题型、答案、解析、译文、图片和计时规则。
- [各题型字段形状](docs/task-layouts.json)：17 种题型的结构参考，不是可直接导入的模板。
- [可直接运行的示例](examples/community-garden.json)：判断题、单选题、句子填空。

当前接受结构化 JSON。PDF、Word、图片由外部 Agent 先转换；本服务提供题库保存和打包接口，不包含 OCR、学员账号或成绩上传。
导入界面保存最近的一份练习（1–3 篇、1–200 个答题位置），可导出 JSON 备份后再导入其他题目。

## 构建产物

```sh
npm run build
npm run check
```

| 产物 | 用途 |
| --- | --- |
| `dist/admin.html` | 服务端题库管理界面，需由 Python 服务运行 |
| `dist/index.html` | 约 0.9 MB 的自有题目导入工具，内嵌引擎与自编示例 |
| `dist/reading-engine.js` | 可嵌入其他页面的编译与渲染 API |
| `dist/reading-runtime.html` | 供 API 使用的答题模板，含一个题目插入点 |
| `dist/legacy.html` | 可选参考应用，运行 `npm run build:legacy` 生成 |
| `dist/build.json` | 默认入口的构建摘要，不是签名 |

首页“导出离线练习包”会生成只含当前题目的单文件 HTML。
默认构建也不读取原题库；只有 `build:legacy` 和原包回归检查需要 `data/`。
`dist/` 是生成目录，不提交 Git，也不要直接修改。

## 源码导航

| 位置 | 作用 |
| --- | --- |
| `src/engine/content.js` | 自有题目校验、包编译、译文与证据生成、HTML 注入 |
| `src/engine/app.js` / `store.js` | 导入、预览、导出与 IndexedDB 保存 |
| `src/engine/index.html` / `style.css` | 自有题目入口 |
| `src/runtime/` | 复用的原生 JavaScript 答题、评分、复盘与交互模块 |
| `src/app/` | 原包参考应用；composer 的题型清单与摘要工具亦供新引擎复用 |
| `data/` | 原题库及辅助数据，只进入参考应用和回归测试 |
| `examples/` | 我们自己的题目 |
| `scripts/` | 构建、预览、检查与原包提取 |
| `reference/` / `original/` | 来源摘要和原包校验逻辑；original 副本不提交 Git |

## 验证与边界

`npm run check` 覆盖原有组卷回归、自编题的正确/错误评分、非法输入、内容变更后的记录隔离、嵌入脚本转义、17 种题型结构兼容、独立构建不包含原题库。
浏览器验证记录见 [自有题目验收](docs/engine-verification.md)。
题目和答案保存在当前浏览器。不同浏览器、HTTP 地址与 file:// 文件之间不自动同步。
译文可随题目提供，当前自有译文按整段联动；证据必须由题目作者提供，不自动推断。
这个工程保留原代码署名和第三方许可注释，不另行给原代码和题库授予开源许可。
原作者源码历史、构建系统与签名私钥未恢复；原始解包记录见 [重建说明](docs/reconstruction.md)。

## 后台与 Agent CLI

- [Agent 接入规范](docs/agent-guide.md)：原始材料处理流程、题型识别特征、字段关联、接口调用。
- [后台与部署说明](docs/service.md)：持久存储、两种密钥、域名上线准备。
- [OpenAPI](docs/openapi.json)：HTTP 接口定义，嵌套题目字段以格式文档和运行时校验为准。

```sh
python3 scripts/reading_cli.py guide --output-dir reading-guide
python3 scripts/reading_cli.py validate examples/community-garden.json
python3 scripts/reading_cli.py build examples/community-garden.json -o practice.html
python3 scripts/reading_cli.py upload examples/community-garden.json
```

CLI 默认连接本地 4173；远程设置 READING_SERVER、READING_API_TOKEN。upload 使用独立 READING_ADMIN_TOKEN。普通 build 不保存题库记录，返回可离线打开的 HTML。域名和证书尚未部署。
