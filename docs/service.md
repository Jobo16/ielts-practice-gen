# 后台与服务运行

需要 Python 3.10+ 和 Node.js 18+，无第三方 Python/npm 包依赖。

```sh
npm run dev
```

后台：`http://127.0.0.1:4173/admin`。载入示例、导入或粘贴 JSON，校验、预览、保存、下载 HTML。左侧可搜索并打开已有版本。修改保存产生新版本；归档可通过重新提交原 JSON 恢复。后台编辑区是临时草稿，离开前请保存或下载 JSON。

数据默认存在 `.local/service/reading.sqlite3`（已排除 Git），可通过 READING_DATA_DIR 或 `--data-dir` 改路径。后台保存源 JSON 和当时生成的 HTML 快照；重启不会丢失。以后引擎升级，同一版本仍保留既有 HTML，避免下载内容静默变化。

独立浏览器导入工具仍在 `/`，其题目存储与服务端题库互相独立；HTML 包内的作答记录属于浏览器本地存储。没有学员账号和云端成绩同步。

## Agent 使用

见 [Agent 接入指南](agent-guide.md)。CLI 的 guide 命令可一次下载字段说明、17 种题型结构参考和完整示例。服务只处理转换后的 JSON。

普通 API 密钥允许 validate/build；管理员密钥另外允许题库保存、列表、下载、归档。build 不把调用者题目加入公共或管理员题库。后台密钥仅保留在页面内存，刷新后重新输入。

## 已部署实例

公网入口：https://ieltsbuddy-reading-gen.jobo.asia；后台追加 `/admin`。
服务器：`ssh server-renovation`，服务名 `reading-gen`，监听 `127.0.0.1:14173`，公网由现有 Caddy 代理，自动管理 HTTPS 证书。

- 源码仓库：`/opt/git/ieltsbuddy-reading-gen.git`（服务器上的私有 bare 仓库）；本地 Git remote 名为 deploy。
- 生产检出：`/opt/apps/ieltsbuddy-reading-gen/repo`，分支 main。
- 配置：`/opt/stacks/ieltsbuddy-reading-gen/service.env`，root 可读，含两个独立密钥。
- 数据：`/opt/stacks/ieltsbuddy-reading-gen/data/reading.sqlite3`，由 reading-gen 用户持有。
- 本地密钥副本：`.local/production.env`，权限 0600，不进 Git；后台登录使用其中 READING_ADMIN_TOKEN。

发布只推送已提交源码，再由服务器快进拉取、构建和启动。GitHub 源码镜像为 https://github.com/Jobo16/ielts-reading-gen（本地 origin）；deploy 仍指向服务器私有 bare 仓库。GitHub 自动检查不会自动部署生产服务。

```sh
git push deploy main
ssh server-renovation 'cd /opt/apps/ieltsbuddy-reading-gen/repo && test -z "$(git status --porcelain)" && git pull --ff-only origin main && ./deploy/install.sh'
# 仅站点配置变更时执行（先校验再重载，保留其他站点）：
ssh server-renovation 'cd /opt/apps/ieltsbuddy-reading-gen/repo && sudo python3 deploy/publish-site.py'
```

对公网调用 CLI：

```sh
set -a
. .local/production.env
set +a
python3 scripts/reading_cli.py build examples/community-garden.json -o practice.html
```

## 新实例部署基线

1. 在服务器准备项目和 Node/Python，以专用普通用户运行。
2. 生成两个不同的随机密钥（如各 32 随机字节的十六进制字符串），通过进程环境设置 READING_API_TOKEN、READING_ADMIN_TOKEN；不能只配置一个。不要提交密钥。
3. 将 READING_DATA_DIR 设置为持久目录，启动 `python3 scripts/serve.py --host 127.0.0.1 --port 4173`，用进程管理器负责重启。
4. 域名 DNS 指向服务器，配置 Caddy 的 READING_DOMAIN 和 deploy/Caddyfile，由 Caddy 代理本地服务并管理 HTTPS。网络只开放反向代理入口；即使服务绑定本地回环，被代理到公网之前也必须配置两个密钥。
5. 检查未认证的题库请求被拒绝、API 密钥不能访问管理接口，并验证 CLI 返回的 HTML。

服务目前是单实例、共享管理员题库，适合轻量使用；没有用户注册、租户隔离或计费。最多同时 4 个编译任务，JSON 16 MiB，编译限时 20 秒。Python HTTP 服务应放在反向代理后；客户端上传超时/速率限制可由部署环境设置。

备份 SQLite 时使用 SQLite backup API/工具，不能只复制正在写入的主文件而漏掉 WAL。升级前保留数据库备份，打包器的源码版本也应留存以便复现。
