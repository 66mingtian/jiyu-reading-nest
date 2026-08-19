# 开源部署指南

这份指南用于把公开源码部署到你自己的 Cloudflare 账户。不要使用维护者的线上地址、数据库或 token。

## 1. 推荐方式：GitHub Actions（手机可完成）

- Cloudflare 账户
- 自己有管理权限的 GitHub 仓库
- ChatGPT 中可添加自定义 MCP App 的环境

### 1.1 创建 Cloudflare API token

在 Cloudflare Dashboard 的 **My Profile → API Tokens → Create Token → Create Custom Token** 中创建仅限当前账户的 token。至少授予这些权限：

- Account / Workers Scripts / Edit
- Account / D1 / Edit
- Account / Workers R2 Storage / Edit
- User / User Details / Read
- User / Memberships / Read

Account Resources 只选择准备部署到的账户。不要使用 Global API Key。Cloudflare 的 [API token 指南](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) 和 [GitHub Actions 指南](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) 有对应说明。

同时在 Cloudflare Dashboard 任一域名的 Overview 页或 Workers & Pages 页面复制 **Account ID**。

### 1.2 保存三个 GitHub Actions secrets

在 GitHub 仓库打开 **Settings → Secrets and variables → Actions → New repository secret**，逐一添加：

| 名称 | 值 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 上一步复制的 Account ID |
| `CLOUDFLARE_API_TOKEN` | 上一步创建的 API token |
| `MCP_PATH_TOKEN` | 自己生成并保存好的 64 位随机十六进制字符串 |

`MCP_PATH_TOKEN` 是阅读入口的私密路径。先把它保存到密码管理器，再粘贴到 GitHub；GitHub 保存后不会再次显示它。不要把这三个值发送到聊天、issue、commit、截图或工作流输入框。

电脑可用 `openssl rand -hex 32` 生成 `MCP_PATH_TOKEN`。仅使用手机时，可用密码管理器生成至少 32 字节、只含字母和数字的随机值，并确保其中没有 `/`。

### 1.3 运行部署

打开仓库的 **Actions → Deploy to Cloudflare → Run workflow → Run workflow**。

工作流会依次：

1. 安装依赖并运行测试、类型检查和生产构建。
2. 自动创建或复用 `jiyu-reading-nest-db` D1 数据库。
3. 自动创建或复用 `jiyu-reading-nest-sources` 私有 R2 bucket。
4. 把 `MCP_PATH_TOKEN` 作为 Worker secret 上传并部署。
5. 应用 D1 migrations 并检查 `/health`。

部署成功后，打开该次运行的 **Summary**，复制 Worker 地址。没有显示地址时，在 Cloudflare **Workers & Pages → jiyu-reading-nest** 中复制 `workers.dev` 地址。

## 2. 命令行方式（备选）

命令行方式要求：Node.js 22+、Corepack、pnpm 10.15.1，以及可运行 Wrangler 的电脑。

### 2.1 安装与验证

```bash
git clone https://github.com/66mingtian/jiyu-reading-nest.git
cd jiyu-reading-nest
corepack pnpm@10.15.1 install
corepack pnpm@10.15.1 test
corepack pnpm@10.15.1 typecheck
corepack pnpm@10.15.1 build
```

不要在测试失败时继续部署。

### 2.2 登录并设置私密路径

```bash
corepack pnpm@10.15.1 --filter @ss/server exec wrangler login
```

生成随机值：

```bash
openssl rand -hex 32
```

将它保存为 Worker secret：

```bash
corepack pnpm@10.15.1 --filter @ss/server exec wrangler secret put MCP_PATH_TOKEN
```

不要把值写进 `.env.example`、`wrangler.jsonc`、Git commit、issue、聊天或截图。

### 2.3 部署并应用迁移

```bash
corepack pnpm@10.15.1 deploy:cloudflare
corepack pnpm@10.15.1 --filter @ss/server exec wrangler d1 migrations apply jiyu-reading-nest-db --remote
```

首次部署时，Wrangler 会按 `server/wrangler.jsonc` 中的名称自动创建缺少的 D1 数据库与 R2 bucket。R2 默认保持 private。

当前 migration 会建立 `app_state` 表。真实数据由 Repository 以结构化 JSON 管理。

部署后先检查：

```bash
curl https://<your-worker>.<your-subdomain>.workers.dev/health
```

应看到 `ok: true` 和当前应用版本。

## 3. 构造自己的 MCP 地址

通用入口：

```text
https://<your-worker>.<your-subdomain>.workers.dev/mcp/<your-token>
```

原生客户端兼容入口：

```text
https://<your-worker>.<your-subdomain>.workers.dev/mcp/<your-token>/ios-v4
```

`ios-v2`、`ios-v3` 仅为已有连接保留兼容，不建议新部署使用。

## 4. 协议验收

在连接 ChatGPT 前依次验证：

1. `initialize` 返回成功。
2. `tools/list` 包含 `open_reading_nest`。
3. 该工具 descriptor 指向当前版本化 `ui://` resource。
4. `tools/call` 返回书架摘要与组件私有数据。
5. `resources/read` 返回 `text/html;profile=mcp-app`。
6. 连续检查几次，版本和资源身份保持一致。

仓库中的 `server/scripts/remote-smoke/cloud-source-smoke.mjs` 使用临时原创文本进行远端检查。运行它时只通过本机环境变量提供凭证。

## 5. 真实设备验收

每个宿主独立测试：

| 宿主 | 打开组件 | 多书书架 | 打开详情 | 翻页保存 | 共读想法 |
| --- | --- | --- | --- | --- | --- |
| ChatGPT Web | | | | | |
| iPhone ChatGPT | | | | | |
| iPad ChatGPT | | | | | |

灰色块表示宿主没有完成组件挂载。此时先检查工具 descriptor、resource URI 和 `resources/read`，不要先修改 D1/R2 数据。

## 6. 更新与回退

更新前记录当前 commit、tag、应用版本和 UI resource 版本。保留旧资源 URI 别名。只有在协议检查和所承诺的真实设备都通过后，才把新版本标为稳定。

不要使用破坏性回退命令处理含数据的工作区。创建单独分支或工作副本，从稳定 tag 构建候选。

## 7. 上线前安全清单

- R2 bucket 为 private。
- Git 中没有 `.env`、`.dev.vars`、D1/R2 导出或 Wrangler state。
- 使用工作流时，`MCP_PATH_TOKEN` 只存在于受保护的 GitHub Actions secret 与 Cloudflare Worker secret；使用命令行时只存在于本机密码管理器与 Cloudflare Worker secret。
- Workers invocation logs 与 automatic traces 均保持关闭，避免在遥测中保存带 token 的 URL。
- 示例文本为原创或公共领域。
- 没有把真实书名、正文、批注、聊天或阅读记录放入测试和文档。
- 明白随机路径不是多用户认证，不把此部署作为公共共享服务。
