# 题型目录：Agent 写 JSON 前必读

这份目录与 `task-layouts.json` 一一对应。每一行的 `questionType | interactionVariant | layoutVariant` 是 **固定三元组**；只能从表中选择，不能拼出新组合。`task-layouts.json` 给出该三元组可填写字段的完整结构形状，`community-garden.json` 和 `listening-welcome.json` 是可直接校验、打包的完整示例。

## 先选对呈现形式

| 三元组 | 题面信号 | 学员看到的效果 | `content` 必填主结构 |
| --- | --- | --- | --- |
| `true_false_not_given | single_choice | statement_list` | 事实判断 | 每句一个 TRUE/FALSE/NOT GIVEN 单选 | `options`, `items` |
| `yes_no_not_given | single_choice | statement_list` | 作者/说话人观点判断 | 每句一个 YES/NO/NOT GIVEN 单选 | `items`，可在 item 内提供选项 |
| `multiple_choice | single_choice | option_list` | Choose A/B/C/D | 每题一组单选按钮 | `items[].options` |
| `multiple_choice | choice_set | option_list` | Choose TWO/THREE | 一题共享选项、多答题位置 | `stem`, `options`, `rules.maxSelections` |
| `note_completion | text_entry | notes` | 笔记、提纲 | 分层笔记内的输入框 | `sections`, `targets` |
| `summary_completion | text_entry | prose` | 文章摘要填空 | 连续段落中的输入框 | `sections` 或 `items`, `targets` |
| `sentence_completion | text_entry | sentence_list` | 句子填空 | 每句一个或多个输入框 | `items`, `targets` |
| `short_answer | text_entry | short_question_list` | 简答 | 问题列表及输入框 | `items`, `targets` |
| `table_completion | text_entry | table` | 表格填空 | 原结构表格，空单元格可输入 | `table`, `items`, `targets` |
| `flowchart_completion | text_entry | flow_chart` | 流程图填空 | 连线节点和输入框 | `flowChart`, `items`, `targets` |
| `diagram_labelling | text_entry | diagram` | 地图/器械标注 | PNG 图上的标注输入框 | `diagram`, `items`, `targets`, 顶层 `assets` |
| `summary_completion | option_mapping | prose` | 词库选词填摘要 | 摘要空格与共享选项 | `options`, `items`, `targets`, `mapping` |
| `matching_headings | option_mapping | passage_attached_targets` | 给段落配标题 | 段落旁的标题选择目标 | `options`, `targets`（每个 target 关联 `blockId`） |
| `matching_information | option_mapping | matching_grid` | 哪段含某信息 | 陈述与来源匹配网格 | `options`, `items`, `targets`, `mapping` |
| `matching_features | option_mapping | matching_grid` | 人物/特征匹配 | 陈述与人物或物件匹配网格 | `options`, `items`, `targets`, `mapping` |
| `classification | option_mapping | matching_grid` | 分类 | 陈述与类别匹配网格 | `options`, `items`, `targets`, `mapping` |
| `matching_sentence_endings | option_mapping | sentence_ending_gaps` | 句首配句尾 | 句首与选项句尾匹配 | `options`, `items`, `targets`, `mapping` |

## 每个 task 都要接上四条数据链

以一个文本填空为例，不能只写题干。必须同时写：

1. `task.responseSlotIds: ["r1"]`，并在 `content.inlines` 放入 `{ "type": "response", "responseSlotId": "r1" }`；
2. 顶层 `responseSlots` 中的 `r1`，其 `taskId` 必须等于当前 task，且具有对应 `fieldId` 与 `targetId`；
3. 顶层 `scoreSlots` 中的 `s1`，关联 `r1` 并填写可接受答案；
4. 顶层 `reviewEntries` 中的 `s1`，提供给学员看的正确答案与解释。

选项题也同样需要 response、score、review 三层；其 `accepted.value` 写 `optionId`，例如 `"apple"`，不能写屏幕显示的 `A`。

## 交付前的可执行顺序

1. 读取 `/api/v1/capabilities` 和这份目录，选择三元组。
2. 下载最相近完整示例：`/api/v1/examples`；阅读从 `community-garden` 开始，听力从 `listening-welcome` 开始。
3. 用 `/api/v1/task-layouts` 中对应三元组补齐 `task`、`responseSlot`、`scoreSlot` 字段形状。
4. 用 `POST /api/v1/validate` 校验；任何 422 均按返回字段路径修正。
5. 用 `POST /api/v1/build` 得到 HTML；在浏览器中检查题号、输入框、选项、播放控件（听力）、提交后分数和解析。

## 生成后的页面契约

- 阅读：左侧文章、右侧题目；提交后展示分数、正确答案、文字解析、可选证据高亮及译文。
- 听力：顶部音频播放器，右侧题目；如作者提供 `transcript`，左侧显示逐字稿，否则显示听题提示；提交后的评分和解析规则与阅读一致。
- 单文件 HTML 将答案嵌入其中，适合练习和复盘，不适合需要保密答案的正式考试。
