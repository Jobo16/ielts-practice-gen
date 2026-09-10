# 全题库导入与部署验收

测试日期：2026-09-10。目标：验证原生题目数据经过 reading-set.v1 JSON 导入后，保持题目与评分，并验证公网生成的 HTML 与本地构建一致。

## 验收结果

- 170/170 篇公网 validate/build 成功，2263 个作答位置；每份返回 HTML 的字节和 SHA-256 与本地构建完全相同。
- 170/170 篇浏览器 main DOM 一致；17/17 种题型的代表题组截图逐像素一致。
- 478 组题目结构、2651 组评分输入比对通过，浏览器 0 错误、0 警告。
- 服务器与本地的接口测试通过；API 密钥不能访问管理题库，未认证请求被拒绝，公网 CLI guide/build 通过。
- 测试没有将原题库保存到公网题库列表。证书由 Caddy/Let's Encrypt 签发并自动续期。

## 基准与边界

原始 34 MB 分发包包含整个题库、目录、旁路译文、签名相关信息和原入口。新服务每次打包一份练习，包 ID、题号范围与入口发生变化。因此没有把“单份新 HTML 与整个原始分发文件逐字节相同”作为通过条件，也不作此宣称。

实际比较：

1. 170 篇原生 source 数据与导入后 candidate/answerKey：正文段落、题型结构、选项、填空位置、图片和答案保持一致，题号和题组标题按独立练习重新编号。
2. 2651 组空答案、错误答案和 accepted 答案输入，分别通过原数据与导入数据评分，对比完整评分结果。
3. 每篇各生成一份原生数据基准 HTML 和 JSON 编译 HTML，使用同一个运行时模板、相同编号，比较浏览器中整个 main DOM。此项验证编译对题目页面的影响，不等同于原包全部旁路功能对比。
4. 17 种题型各选一组，比较题组截图的 PNG 字节；基准与导入结果一致。
5. 全部 JSON 通过公网 validate/build，逐份比较返回 HTML 字节及 SHA-256 与本地对应 HTML。测试调用不保存到服务器题库。

运行：

```sh
npm run check
node scripts/check-bank-roundtrip.cjs
# 加载 .local/production.env 后：
python3 scripts/check-remote.py
# 浏览器比较，另一个终端先提供本地测试文件：
python3 -m http.server 4175 --bind 127.0.0.1 --directory artifacts/bank-roundtrip
# 再启动独立浏览器会话并运行：
~/.codex/skills/playwright/scripts/playwright_cli.sh -s=reading-bank open http://127.0.0.1:4175/001.html
python3 scripts/check-bank-browser.py
```

本地完整结果在 `artifacts/bank-roundtrip/`：report.json（数据/评分及引文差异）、browser-report.json（170 篇 DOM）、visual-report.json（17 题型截图）、remote-report.json（公网文件摘要）。截图在 output/playwright/。这些题库测试产物不会作为公网静态文件提供。

## 原始材料差异

165 篇可直接按严格引文规范导入。以下 5 篇共 38 处引文并非唯一精确原文片段：

| passageId | 引文数 |
| --- | ---: |
| passage.mercator-the-map-maker | 14 |
| passage.origin-and-development-of-applause | 13 |
| passage.socotra-island | 6 |
| passage.graffiti | 4 |
| passage.b011.new-018.the-significant-role-of-mother-tongue-in-education | 1 |

测试转换保留原始 quote、解析和段落引用，显式增加 `anchor: false`，只关闭这些引文的精确文字高亮；没有猜测匹配位置。导入器默认仍拒绝不精确引文。此差异已记录，并不意味着旧包的所有定位与句子级双语联动得到逐项复原。

当前普通自有译文按段落联动；原包的句子级旁路对齐不属于上述页面、评分与文件字节一致性结论。
