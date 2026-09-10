# 自有题目格式与引擎接口

默认首页现在是自有题目导入入口。原题库仅用于参考与回归检查，运行 `npm run build:legacy` 可生成 `legacy.html`；它不是引擎构建或运行的依赖。

## 使用路径

1. 下载首页的题目模板，或复制 `examples/community-garden.json`。
2. 按下述格式填写自己的文章、题目、答案与解析。
3. 在首页选择“导入题目 JSON”。错误会显示字段路径，失败不会覆盖当前已导入的题目。
4. 点击“开始 / 继续练习”，作答后交卷进入解析。
5. “导出离线练习包”生成仅包含当前题目的 HTML；“导出题目 JSON”保存可继续编辑的原始题目。

目前入口接受结构化 JSON，不自动识别 PDF、Word 或图片。以后接上传接口、OCR 或 AI 题目转换时，让转换结果满足此格式即可。
每份练习包含 1–3 篇文章、1–200 个答题位置，短篇练习不受原包每篇 13/14 题限制。
当前界面保存最近导入的一份练习，不是多用户云端题库管理系统。

## 顶层结构

```json
{
  "schemaVersion": "reading-set.v1",
  "title": "My reading practice",
  "parts": [],
  "responseSlots": [],
  "scoreSlots": [],
  "reviewEntries": [],
  "translations": {},
  "assets": [],
  "timerPolicy": { "enabled": false, "durationSeconds": 0, "expiryAction": "continue" }
}
```

这段是字段索引，不是可直接导入的空练习。完整可运行示例见 `examples/community-garden.json`：全部内容为新编的社区花园短文，含判断题、单选题和句子填空，共 5 题。

| 字段 | 含义 |
| --- | --- |
| `parts` | 文章及其题型任务，每项包括 `partId`、`instruction`、`passage`、`tasks` |
| `part.passage` | `passageId`、`title`、`blocks`；每个段落有 `blockId`、`type: "paragraph"`、`text`，可有 `label: "A"` |
| `part.tasks` | 各题型的内容和交互规则，见下表 |
| `responseSlots` | 每一个可作答位置：`responseSlotId`、`taskId`、`responseKind`（`text` 或 `option`）；填空通常还需 `fieldId`、`targetId` |
| `scoreSlots` | 每个得分点：`scoreSlotId`、`taskId`、`responseSlotIds`、`marks`、`evaluation`、`accepted` |
| `reviewEntries` | 每个得分点一条解析：`scoreSlotId`、`answerDisplay`、`explanation`，可选 `evidence`、`questionTranslation`、`distractors` |
| `translations` | 可选。`passageId → { title: "标题译文", blockId: "段落译文" }`，提交后显示 |
| `assets` | 图示题的 PNG 图片；字段见图示说明 |
| `timerPolicy` | 可选，默认不限时。开启时为 60–10800 秒；`continue` 到时提醒继续，`submit` 到时自动提交 |

ID 在同一份练习中唯一，通过 ID 关联数据，不靠标题或题号匹配。导入器按文章、题型、`responseSlotIds` 的顺序生成连续题号。
题目文字中不要手工依赖旧的题号；填空位置使用 `inlines` 中的 ID。

## 17 种题型组合

每个任务必须提供 `taskId`、以下三个题型字段、`instructions`（字符串数组）、`responseSlotIds` 和 `content`。
`rules` 决定选项是否复用、最多选择几项和字数说明；不得只在题干里写规则而漏掉结构化配置。

| questionType | interactionVariant | layoutVariant | content 的主要结构 |
| --- | --- | --- | --- |
| true_false_not_given | single_choice | statement_list | options、items |
| yes_no_not_given | single_choice | statement_list | items（选项可以放在 items 内） |
| multiple_choice | single_choice | option_list | items，每题各自的 options |
| multiple_choice | choice_set | option_list | stem、options；rules.maxSelections |
| note_completion | text_entry | notes | sections → items → inlines、targets |
| summary_completion | text_entry | prose | sections → items → inlines、targets |
| sentence_completion | text_entry | sentence_list | items → inlines、targets |
| short_answer | text_entry | short_question_list | items、targets |
| table_completion | text_entry | table | table、items、targets |
| flowchart_completion | text_entry | flow_chart | flowChart、items、targets |
| diagram_labelling | text_entry | diagram | diagram、items、targets，顶层 assets |
| summary_completion | option_mapping | prose | options、items、targets、mapping |
| matching_headings | option_mapping | passage_attached_targets | options、targets，target.blockId 绑定文章段落 |
| matching_information | option_mapping | matching_grid | options、items、targets、mapping |
| matching_features | option_mapping | matching_grid | options、items、targets、mapping |
| classification | option_mapping | matching_grid | options、items、targets、mapping |
| matching_sentence_endings | option_mapping | sentence_ending_gaps | options、items、targets、mapping |

`docs/task-layouts.json` 提供每种题型的 task、responseSlot 和 scoreSlot 字段形状。它是结构参考，里面的 `"string"`、`"number"` 是类型占位，不是可直接导入的数据。
复杂表格、流程图、图示题必须保留对应布局结构，不能把整张图表塞进 `text` 冒充可交互题目。
现阶段结构校验会检查主要关联和必需布局字段；不能代替教师对题目内容与复杂布局的审核。

## 选项、填空、评分

选项形如 `{"optionId":"apple","text":"An apple tree"}`。作答和判分使用 `optionId`，答案解析用 `answerDisplay` 展示可读文字。
题目 item 形如 `{"itemId":"q1","text":"Question text","responseSlotIds":["r1"]}`。

填空不能只写下划线，需明确插入位置：

```json
[
  { "type": "text", "text": "Volunteers meet every " },
  { "type": "response", "responseSlotId": "r4" },
  { "type": "text", "text": "." }
]
```

把它放进 item 的 `inlines`。item、responseSlot 和 content.targets 通过 `responseSlotId`、`fieldId`、`targetId` 关联，示例中有完整写法。

| evaluation | accepted 与行为 |
| --- | --- |
| exact-option | `[{"kind":"option-id","value":"apple"}]`，用于单选或选项匹配 |
| normalized-text | `[{"kind":"text","value":"Saturday"}]`，允许多个答案变体；默认不区分大小写、去除首尾空白 |
| unordered-membership | 多选的每个得分点使用一个正确选项；同一任务可有多个得分点共享多个作答位置，顺序不影响得分 |
| atomic-unordered-text-set | 一组文本必须全部匹配才得该组分数；accepted 的 `setMemberId` 区分组内答案，组内允许变体 |

`normalization` 可配置大小写、空白、连字符和撇号规则。`wordLimit` 主要用于提示；引擎以 accepted 和 normalization 判分，不会替教师自动判断答案是否符合所有语言规则。

## 解析、译文与定位

```json
{
  "scoreSlotId": "s4",
  "answerDisplay": "Saturday",
  "explanation": "原文明确说明志愿者每周六见面。",
  "evidence": [{ "blockId": "garden.a", "quote": "Volunteers meet every Saturday." }]
}
```

`evidence.quote` 必须是段落原文中连续、完全一致的片段。引文重复出现时要加 `startOffset`，按 JavaScript UTF-16 字符偏移计算。
只提供 blockId 可保留段落关联，不提供证据也可以显示答案和文字解析。系统不会猜测或编造证据。

译文使用明确的文章和段落 ID，不再依赖原包月度翻译清单、固定摘要或 170 篇旁路数据。
自有译文当前按整段联动；将长段落拆成多个 blocks 可获得更细的联动。原包参考模式仍保留原来的句子对齐数据。

## 图示图片

每个 asset 包括 `assetId`、`mediaType: "image/png"`、`encoding: "base64"`、`data`（不含 data URL 前缀）、`width`、`height`、`alt`。
`diagram.assetId` 指向图片，callouts、anchors 和 targets 描述输入框与图上坐标关系，坐标采用 0–1 的归一化范围。
不依赖网络图片，保证导出的单文件可离线运行。

## 嵌入自己的系统

构建后可独立使用 `dist/reading-engine.js` 和 `dist/reading-runtime.html`。前者提供 `ReadingContent.compile()` 与 `ReadingContent.render()`；后者是待填入题目的 HTML 模板。

```html
<script src="reading-engine.js"></script>
<iframe id="reading" title="阅读练习"></iframe>
<script>
  async function openReading(questionJson) {
    const response = await fetch('reading-runtime.html');
    if (!response.ok) throw new Error('Runtime template unavailable');
    const template = await response.text();
    const packageData = ReadingContent.compile(questionJson);
    document.getElementById('reading').srcdoc = ReadingContent.render(packageData, template);
  }
</script>
```

编译器不修改输入，自动生成内容摘要和包 ID。相同题目恢复同一份浏览器作答记录；修改文章、答案或解析会使用新 ID，避免旧答案串入新题目。
导入的源题目保存在 IndexedDB；答案与复盘由原运行时保存在浏览器本地。这里没有账号、服务端存储或成绩上传接口。
离线包内包含答案，适用于练习；不能作为需要保密答案的正式考试系统。
