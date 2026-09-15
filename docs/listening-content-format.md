# 自有听力题目格式

听力入口接受 `listening-set.v1`，并导出一份包含播放器、题目、答案和解析的单文件 HTML。它使用与阅读相同的 `parts`、`tasks`、`responseSlots`、`scoreSlots` 和 `reviewEntries` 结构及 17 种题型组合；字段详情请见 `content-format.md`。

```json
{
  "schemaVersion": "listening-set.v1",
  "title": "My listening practice",
  "audio": {
    "mediaType": "audio/mpeg",
    "encoding": "base64",
    "filename": "part-1.mp3",
    "data": "BASE64_AUDIO_WITHOUT_DATA_URL_PREFIX"
  },
  "parts": []
}
```

- `audio.mediaType` 支持 `audio/mpeg`、`audio/mp4`、`audio/wav`、`audio/ogg`、`audio/webm`。
- `audio.encoding` 必须为 `base64`，`data` 不带 `data:` 前缀；解码后上限 64 MiB。
- 每份练习有 1–4 个 Part。每个 Part 可有可选的 `transcript`：`{ "title": "…", "blocks": [{ "blockId": "…", "text": "…" }] }`。不提供逐字稿时，练习页只显示听题说明。
- 题型、答案、填空、解析和图示资源全部沿用阅读格式。听力不会从音频自动识别文本、答案、题型或证据。

可复制 `examples/listening-welcome.json` 开始。示例包含无声 WAV，仅用于验证格式；发布时请替换为你拥有使用权的音频与题目。
