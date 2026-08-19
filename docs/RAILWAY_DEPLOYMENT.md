# Railway 部署指南（手机优先）

这条路线把阅读状态和正文都保存在 Railway 的私有持久卷中。它适合单用户私人部署，不需要 Cloudflare 账户或 Cloudflare OAuth。

## 1. 从 GitHub 创建服务

1. 登录 [Railway](https://railway.com/)，选择 **New Project**。
2. 选择 **Deploy from GitHub repo**，授权 Railway 访问自己的 `jiyu-reading-nest` 仓库。
3. 选中仓库并创建服务。

仓库根目录的 `railway.json` 已配置构建命令、启动命令和 `/health` 健康检查。第一次部署可能因尚未配置持久卷和 token 而显示失败，这是预期的安全保护。

## 2. 挂载私有持久卷

1. 打开刚创建的服务。
2. 进入 **Settings → Volumes → Add Volume**。
3. Mount Path 填 `/data`，然后保存。

Railway 会自动提供 `RAILWAY_VOLUME_MOUNT_PATH`，不需要手动填写。应用会在卷内保存：

```text
/data/sessions.json       阅读状态、批注、书签和记录
/data/source-objects/     导入的正文与 manifest
```

不要运行多个副本。Railway 持久卷只能挂到一个服务副本，这正适合当前的单用户设计。

## 3. 设置私密入口 token

先用密码管理器生成并保存一个至少 32 字节、只含字母和数字的随机值；推荐 64 位十六进制字符串，并确保没有 `/`。

在服务的 **Variables → New Variable** 中添加：

```text
MCP_PATH_TOKEN=<你保存好的随机值>
```

不要把 token 发到聊天、issue、commit、部署日志或截图中。Railway variable 会在服务运行时作为密钥读取，不会写进仓库。

## 4. 生成公网域名并重新部署

1. 进入 **Settings → Networking → Generate Domain**。
2. 回到 Deployments，选择最新部署并点 **Redeploy**；如果 Railway 已因配置变化自动重新部署，就等待它完成。
3. 部署变为 Active 后，打开：

```text
https://<你的域名>/health
```

应看到 `ok: true` 和当前版本。如果仍为 503，先确认持久卷已挂到同一个服务，且 `MCP_PATH_TOKEN` 非空。

## 5. 构造 MCP 地址

通用入口：

```text
https://<你的域名>/mcp/<你的-token>
```

ChatGPT iPhone/iPad 兼容入口：

```text
https://<你的域名>/mcp/<你的-token>/ios-v4
```

实际地址等同于密码，不要发给任何人。需要在 ChatGPT 中创建自定义 App 时，建议先在 ChatGPT Web 完成一次连接；连接成功后再在 iPhone 上打开同一个 App 验收。

## 6. 验收数据持久化

1. 导入一段自有或公共领域测试文本。
2. 翻页、写一条想法并创建书签。
3. 在 Railway 中 Redeploy 服务。
4. 回到阅读器，确认书架、进度、想法和正文仍能恢复。

只有这一步通过，才导入真实书籍。

## 7. 备份与限制

- Railway Volume 是私有持久存储，但服务更新时会有短暂重启。
- 当前部署保持一个副本；多副本会导致 MCP session 和文件写入不一致。
- 定期使用 Railway 的 Volume backup 功能备份数据。
- 删除 Volume 会删除书架数据和正文；执行前先备份。
- 如果日志出现卷权限错误，可按 Railway 官方说明在 Variables 中添加 `RAILWAY_RUN_UID=0` 后重部署。

Railway 官方参考：[部署 Express](https://docs.railway.com/guides/express)、[使用 Volumes](https://docs.railway.com/volumes)、[公网域名](https://docs.railway.com/networking/public-networking)。
