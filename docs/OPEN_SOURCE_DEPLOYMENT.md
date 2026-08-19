# 开源部署指南

这份指南用于把公开源码部署到你自己的 Cloudflare 账户。不要使用维护者的线上地址、数据库或 token。

## 1. 前置条件

- Node.js 22+
- Corepack 与 pnpm 10.15.1
- Cloudflare 账户
- Wrangler 已登录
- ChatGPT 中可添加自定义 MCP App 的环境

## 2. 安装与验证

```bash
git clone https://github.com/66mingtian/jiyu-reading-nest.git
cd jiyu-reading-nest
corepack pnpm@10.15.1 install
corepack pnpm@10.15.1 test
corepack pnpm@10.15.1 typecheck
corepack pnpm@10.15.1 build
```

不要在测试失败时继续部署。

## 3. 创建 Cloudflare 资源

```bash
corepack pnpm@10.15.1 --filter @ss/server exec wrangler login
corepack pnpm@10.15.1 --filter @ss/server exec wrangler d1 create jiyu-reading-nest-db
corepack pnpm@10.15.1 --filter @ss/server exec wrangler r2 bucket create jiyu-reading-nest-sources
```

把 D1 命令返回的 database ID 写入 `server/wrangler.jsonc`，替换：

```text
REPLACE_WITH_YOUR_D1_DATABASE_ID
```

如果修改了数据库名或 bucket 名，也同步修改 Wrangler 配置。

## 4. 设置私密路径

生成随机值：

```bash
openssl rand -hex 32
```

将它保存为 Worker secret：

```bash
corepack pnpm@10.15.1 --filter @ss/server exec wrangler secret put MCP_PATH_TOKEN
```

不要把值写进 `.env.example`、`wrangler.jsonc`、Git commit、issue 或截图。

## 5. 应用迁移

```bash
corepack pnpm@10.15.1 --filter @ss/server exec wrangler d1 migrations apply jiyu-reading-nest-db --remote
```

当前 migration 会建立 `app_state` 表。真实数据由 Repository 以结构化 JSON 管理。

## 6. 部署

```bash
corepack pnpm@10.15.1 deploy:cloudflare
```

部署后先检查：

```bash
curl https://<your-worker>.<your-subdomain>.workers.dev/health
```

应看到 `ok: true` 和当前应用版本。

## 7. 构造自己的 MCP 地址

通用入口：

```text
https://<your-worker>.<your-subdomain>.workers.dev/mcp/<your-token>
```

原生客户端兼容入口：

```text
https://<your-worker>.<your-subdomain>.workers.dev/mcp/<your-token>/ios-v4
```

`ios-v2`、`ios-v3` 仅为已有连接保留兼容，不建议新部署使用。

## 8. 协议验收

在连接 ChatGPT 前依次验证：

1. `initialize` 返回成功。
2. `tools/list` 包含 `open_reading_nest`。
3. 该工具 descriptor 指向当前版本化 `ui://` resource。
4. `tools/call` 返回书架摘要与组件私有数据。
5. `resources/read` 返回 `text/html;profile=mcp-app`。
6. 连续检查几次，版本和资源身份保持一致。

仓库中的 `server/scripts/remote-smoke/cloud-source-smoke.mjs` 使用临时原创文本进行远端检查。运行它时只通过本机环境变量提供凭证。

## 9. 真实设备验收

每个宿主独立测试：

| 宿主 | 打开组件 | 多书书架 | 打开详情 | 翻页保存 | 共读想法 |
| --- | --- | --- | --- | --- | --- |
| ChatGPT Web | | | | | |
| iPhone ChatGPT | | | | | |
| iPad ChatGPT | | | | | |

灰色块表示宿主没有完成组件挂载。此时先检查工具 descriptor、resource URI 和 `resources/read`，不要先修改 D1/R2 数据。

## 10. 更新与回退

更新前记录当前 commit、tag、应用版本和 UI resource 版本。保留旧资源 URI 别名。只有在协议检查和所承诺的真实设备都通过后，才把新版本标为稳定。

不要使用破坏性回退命令处理含数据的工作区。创建单独分支或工作副本，从稳定 tag 构建候选。

## 11. 上线前安全清单

- R2 bucket 为 private。
- Git 中没有 `.env`、`.dev.vars`、D1/R2 导出或 Wrangler state。
- `MCP_PATH_TOKEN` 只存在于 Cloudflare secret。
- Workers invocation logs 与 automatic traces 均保持关闭，避免在遥测中保存带 token 的 URL。
- 示例文本为原创或公共领域。
- 没有把真实书名、正文、批注、聊天或阅读记录放入测试和文档。
- 明白随机路径不是多用户认证，不把此部署作为公共共享服务。
