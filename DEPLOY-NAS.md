# 飞牛 NAS（fnOS）+ EdgeOne Pages 图形化部署教程

> 目标：网站（前端 + CDN）继续跑在 **EdgeOne Pages**，图片本体存放到**飞牛 NAS**。
> 后台上传的图片直接写进飞牛的共享文件夹，**即时生效，无需重新构建**。
>
> 全程使用**飞牛图形界面**操作 Docker，不需要敲命令行（只有生成密钥一步可选命令行）。
> 适用：飞牛 NAS（fnOS），已装好官方「Docker」应用。

---

## 目录

- [0. 整体架构（先看懂）](#0-整体架构先看懂)
- [1. 准备工作清单](#1-准备工作清单)
- [2. 生成两个密钥](#2-生成两个密钥)
- [3. 飞牛上准备文件夹](#3-飞牛上准备文件夹)
- [4. 图形化部署图片服务（核心）](#4-图形化部署图片服务核心)
- [5. 域名与 HTTPS 配置](#5-域名与-https-配置)
- [6. 验证 NAS 服务](#6-验证-nas-服务)
- [7. 迁移旧图片](#7-迁移旧图片)
- [8. 配置 EdgeOne Pages 并部署](#8-配置-edgeone-pages-并部署)
- [9. 验证整站](#9-验证整站)
- [10. 两种图片访问模式怎么选](#10-两种图片访问模式怎么选)
- [11. 常见问题排查](#11-常见问题排查)
- [12. 日常运维](#12-日常运维)
- [附录 A：环境变量速查表](#附录-a环境变量速查表)
- [附录 B：飞牛反代 / HTTPS 设置说明](#附录-b飞牛反代--https-设置说明)

---

## 0. 整体架构（先看懂）

```text
访客浏览器
   │  打开网站 /gallery、请求 /api/random
   ▼
EdgeOne Pages（本站，全球 CDN）
   │  服务端带密钥调用 NAS 拉「图片清单」
   ▼
飞牛 NAS 上的 Docker 图片服务（本仓库 nas-service/）
   │  读取共享文件夹，返回尺寸/横竖屏分类
   ▼
飞牛共享文件夹（真正存图片的地方）

图片本体访问：
   浏览器 ──直连──> https://pic.example.com/images/xxx.jpg   （模式 A，推荐）
   或
   浏览器 ─>/api/images?name=xxx─> EdgeOne ─> 飞牛 NAS       （模式 B，同源代理）
```

**要点：**

1. EdgeOne 边缘函数**没有持久文件系统**，不能挂载 SMB/NFS，所以图片必须放飞牛，由飞牛上的 Docker 服务对外提供。
2. 管理接口（清单/上传/删除）有 `NAS_API_TOKEN` 鉴权，通过 EdgeOne 服务端中转，**密钥不会下发到浏览器**。
3. 新增/删除图片后清单有 **约 60 秒缓存**，稍等即刷新，**不用重新构建站点**。
4. 不配置 NAS 环境变量时，项目自动回退到原来的本地模式，不会白屏。

---

## 1. 准备工作清单

- [ ] 飞牛 NAS，已安装官方「**Docker**」应用（应用中心搜索 Docker 安装）
- [ ] 飞牛有一个**公网可访问的 HTTPS 域名**（DDNS + 端口转发 + 证书，或飞牛内置远程访问 / 内网穿透 / Cloudflare Tunnel）
  - 例：`https://pic.example.com` 指向你的飞牛
- [ ] 一个 EdgeOne Pages 项目（本站），从 GitHub 自动部署
- [ ] 一个用来生成随机密钥的工具（在线随机数生成、或 SSH 里 `openssl rand -hex 24`）

> **网络要求**：EdgeOne 云端函数必须能访问到 NAS 的 API 地址。
> 所以 NAS 服务要么公网可达，要么通过公网反代暴露。纯内网 NAS 需要内网穿透。

---

## 2. 生成两个密钥

### 2.1 NAS API 密钥（`NAS_API_TOKEN`）

在任意终端执行（Windows 可用最新版 Windows Terminal 的 openssl，或用在线随机字符串生成器，长度 32 位以上，含小写字母和数字）：

```bash
openssl rand -hex 24
```

记下输出，例如 `a1b2c3d4...`（下文记作 `<NAS_TOKEN>`）。**两端必须逐字符一致**。

### 2.2 管理后台密码（`ADMIN_PASSWORD`）

再生成一个作为 `/admin` 登录密码（可与上面不同），记作 `<ADMIN_PWD>`。

> 图形化用户：直接用飞牛「控制面板 → 账户」里的密码管理器，或任意在线强密码生成器生成即可。

---

## 3. 飞牛上准备文件夹

用飞牛的**文件管理器**（图形界面）操作：

1. 打开飞牛桌面 → **文件管理**
2. 进入你想存放图片的共享文件夹位置，例如 `docker` 目录下
3. 新建文件夹，命名为 `eop-images`（专门存图片）
4. 记下它的**真实路径**，后面要用

不同版本/硬盘布局的真实路径可能不同，常见形如：

- `/vol1/1000/docker/eop-images`
- `/vol1/1000/共享文件夹/docker/eop-images`
- `/vol2/1000/docker/eop-images`

> 💡 **如何拿到真实路径**：在文件管理器里右键该文件夹 → **属性 / 详情**，一般会显示完整路径；或在 Docker 项目挂载目录时，用可视化选择器选中该文件夹，飞牛会自动填入路径（最稳妥，推荐用这种方式，见第 4 步）。

### 3.1 上传项目文件到飞牛

把本仓库的 `nas-service/` 整个文件夹上传到飞牛，比如放到 `/vol1/1000/docker/eop-nas/`：

- 文件管理器里进入 `docker` 目录 → 点「上传」→ 选中本地 `nas-service` 文件夹

上传后该目录应包含：

```text
eop-nas/
├── Dockerfile
├── docker-compose.feiniu.yml   ← 图形化部署用这个
├── docker-compose.yml
├── .env.example
├── package.json
└── server.js
```

---

## 4. 图形化部署图片服务（核心）

> 飞牛不同版本菜单名可能是「**Docker → 项目**」或「**容器 → Compose**」，逻辑一致：用 `docker-compose.feiniu.yml` 创建项目即可。

### 4.1 新建项目

1. 打开飞牛桌面 → **Docker** 应用
2. 左侧点 **项目**（或「Compose」）→ 点 **新建项目 / 添加**
3. 按向导填写：

| 向导项 | 填写内容 |
|--------|----------|
| 项目名称 | `eop-nas-images`（随意，便于识别） |
| 项目路径 / 工作目录 | 选第 3.1 步上传的 `eop-nas` 文件夹 |
| Compose 文件 | 选 `docker-compose.feiniu.yml` |

> 如果向导要求「上传 docker-compose.yml」，直接把 `docker-compose.feiniu.yml` 上传/选择即可。

> ✅ **重要：新的部署方式不再需要「构建」**
> 之前版本需要在项目里构建镜像，容易遇到两个报错：
> - `open Dockerfile: no such file or directory`（项目路径选错 / Dockerfile 没传全）
> - `registry-1.docker.io` 超时 + 卡在 Pulling（Docker Hub 国内直连慢）
>
> 现在的 `docker-compose.feiniu.yml` 改成：**直接拉取一个现成的 `node:20-alpine` 镜像，把 `server.js` 挂进去运行**。
> 不需要 Dockerfile、不需要 npm install，`server.js` 也已改成零第三方依赖版本。
> 这样就不存在「找不到 Dockerfile」的问题了。

### 4.2 修改 Compose 里的 3 个「请修改」值

在飞牛的 Compose 编辑界面（图形化文本编辑器）里，打开 `docker-compose.feiniu.yml`，找到并修改：

```yaml
environment:
  # ① 改成第 2.1 步生成的 <NAS_TOKEN>
  - NAS_API_TOKEN=请修改-随机密钥

  # ② 改成你的图片公网 HTTPS 域名（不带结尾斜杠）
  - PUBLIC_BASE_URL=https://pic.example.com

volumes:
  # ③ 下面这行保持默认：把同目录的 server.js 挂进容器（不要删）
  - ./server.js:/app/server.js:ro

  # ④ 冒号左边改成第 3 步记下的真实图片文件夹路径
  - /vol1/1000/docker/eop-images:/data/images
```

- **① `NAS_API_TOKEN`**：填 `<NAS_TOKEN>`，例如 `a1b2c3d4...`
- **② `PUBLIC_BASE_URL`**：填 `https://pic.example.com`（你的实际域名）
- **③ `./server.js:/app/server.js:ro`**：**保持默认，不要删**——这是把脚本挂进容器的关键
- **④ 挂载路径**：
  - 强烈建议用飞牛的**文件夹选择器**点选 `eop-images` 文件夹，让它自动填路径（最不容易错）
  - 若手动填，冒号**左边**是飞牛真实路径，`右边` 固定写 `/data/images` **不要动**

> ⚠️ 其他内容（`PORT=3000`、`DATA_DIR=/data/images`）保持默认，不要改。

> 🔥 **关于端口被占用（3000 端口已占用）**：
> 端口映射写的是 `3100:3000`（**左边 = 飞牛端口，右边 = 容器内端口**），默认已避开常被占用的 3000。
> - **右边 `3000` 和 `PORT=3000` 是容器内部端口，绝对不要改**。
> - 如果连 `3100` 也被占用，只需改**左边**的数字，例如 `"3200:3000"`。
> - **重要**：改了左边数字后，第 5 步反代的「目标端口」也要同步改成这个数字（比如反代目标 `127.0.0.1:3200`）。

### 4.3 启动（先解决镜像拉取超时）

1. 点 **确定 / 部署 / 启动**
2. 飞牛会拉取 `node:20-alpine` 镜像并以项目方式启动容器（状态变「运行中」即成功）

> 🔥 **如果卡在 `Pulling` / 报 `registry-1.docker.io` 超时**：这是 Docker Hub 国内直连超时，按下面任一方法解决：
>
> **方法 A（推荐）：配置国内镜像加速器**
> 飞牛桌面 → **设置 / Docker 设置 → 镜像加速 / Registry Mirrors**，填入国内可用加速器地址后保存，重启 Docker 服务再部署。
> （加速器地址会变化，选一个当前可用的，例如各大云厂商提供的 Docker 镜像加速服务。）
>
> **方法 B：先在飞牛里手动拉取镜像**
> Docker → **镜像 → 拉取 / 下载**，搜索并拉取 `node:20-alpine`（飞牛会走自己的加速通道），
> 拉好后再启动项目，就不会再超时。
>
> **方法 C：换成已拉取到的镜像**
> 若飞牛里已有其他 Node 镜像（如 `node:20`、`node:22-alpine`），把 compose 里的
> `image: node:20-alpine` 改成那个镜像名即可。
>
> > 本项目**不需要构建**，所以绝不会再出现 `open Dockerfile: no such file or directory`；
> > 若你之前的项目报这个错，删掉旧项目，用新的 `docker-compose.feiniu.yml` 重新建一个即可。

### 4.4 检查容器日志

在项目详情 → **日志 / 容器日志**，看到下面这行就说明服务正常：

```text
✅ NAS image service listening on :3000
   data dir: /data/images
   public base url: https://pic.example.com
   auth: enabled
```

> 如果 `auth: disabled`，说明 `NAS_API_TOKEN` 没生效（检查是否填在了 compose 的 `environment` 里）。

---

## 5. 域名与 HTTPS 配置

服务的 `/images/*` 需要浏览器能直接访问，且必须是 HTTPS。

### 5.1 用飞牛自带的反向代理（推荐）

飞牛通常提供「**设置 → 域名绑定 / 反向代理**」或「**控制面板 → 网络 → 反向代理**」功能（不同版本位置略有差异）：

1. 打开 飞牛 **设置 / 控制面板 → 反向代理**（或「域名管理」）
2. 新增规则：
   - 来源协议：`HTTPS`，域名填 `pic.example.com`，端口 `443`
   - 目标协议：`HTTP`，地址 `127.0.0.1`，端口 `3100`（即 compose 里映射的左边端口；若你改成了 3200 就填 3200）
3. 为该域名申请/绑定 SSL 证书（飞牛通常支持 Let's Encrypt 自动申请，或用你已有证书）

### 5.2 没有图形化反代入口时

可用飞牛应用中心安装 **Nginx Proxy Manager** 或 **Cloudflare Tunnel** 容器，用它们的图形界面配置（教程见附录 B）。

### 5.3 证书要求

必须用**有效 HTTPS 证书**（Let's Encrypt / 腾讯云 / Cloudflare 均可）。原因：

- 网站是 HTTPS，图片若走 HTTP 会被浏览器拦截为混合内容
- `/api/random` 的 302 跳转目标也必须是 HTTPS

---

## 6. 验证 NAS 服务

在浏览器（或任意电脑的终端）访问：

```text
https://pic.example.com/health
```

期望看到：

```json
{"ok":true,"dataDir":"/data/images","baseUrl":"https://pic.example.com"}
```

> 检查清单需带 token，在终端执行：
> ```bash
> curl -H "X-Api-Token: <NAS_TOKEN>" https://pic.example.com/manifest
> ```
> 目录为空时返回 `{"pc":[],"mobile":[]}`，正常。

---

## 7. 迁移旧图片

把原项目 `public/images/` 里的图片（不含 `.thumbnails/` 子目录）复制到飞牛的 `eop-images` 文件夹：

- 最简单：在飞牛文件管理器的 `eop-images` 文件夹里点「**上传**」，选中本地图片批量上传
- 或用 SCP（命令行备选）：

```bash
scp public/images/* user@飞牛IP:/vol1/1000/docker/eop-images/
```

**分类逻辑自动完成**：宽 > 高 → `pc`（横屏），否则 → `mobile`（竖屏）。文件名无所谓。

上传后约 30 秒内清单自动更新。

---

## 8. 配置 EdgeOne Pages 并部署

### 8.1 在 EdgeOne 控制台添加环境变量

进入 EdgeOne Pages 项目 → **设置 → 环境变量（Environment Variables）**，添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `ADMIN_PASSWORD` | `<ADMIN_PWD>` | 后台登录密码 |
| `NAS_API_URL` | `https://pic.example.com` | NAS 服务 API 地址，EdgeOne 需能访问 |
| `NAS_API_TOKEN` | `<NAS_TOKEN>` | 必须与飞牛 compose 里填的完全一致 |
| `NEXT_PUBLIC_IMAGE_BASE_URL` | `https://pic.example.com` | 图片公网域名；留空则走同源代理 |

> **两种填法**：
> - **模式 A（推荐，直连）**：上面 4 个都按表填，图片由浏览器直连飞牛域名，不耗 EdgeOne 函数流量。
> - **模式 B（同源代理，隐藏 NAS 地址）**：`NEXT_PUBLIC_IMAGE_BASE_URL` **留空**，图片走本站 `/api/images?name=xxx` 由 EdgeOne 从飞牛拉取转发。

### 8.2 本地预览（可选）

```bash
cp .env.example .env.local   # 填入同样的值
npm install
npm run dev
```

访问 `http://localhost:3000/api/random` 测试。

### 8.3 部署

推送到 GitHub，EdgeOne 自动构建部署。构建配置保持：

- 框架预设：`Next.js`
- 构建命令：`npm run build`
- 输出目录：`.next`

> `generate-images-metadata.js` 仍会扫描本地 `public/images/`，只作兜底，不影响 NAS 模式。

---

## 9. 验证整站

```bash
# ① 随机 API（应 302 到飞牛图片域名）
curl -I https://你的站点/api/random
# 期望 Location: https://pic.example.com/images/xxx.jpg

# ② JSON 模式
curl https://你的站点/api/random?redirect=false
# 期望 {"url":"https://pic.example.com/images/xxx.jpg",...}

# ③ 图库：浏览器打开 /gallery 能看到图片

# ④ 后台：打开 /admin → 登录 → 上传一张 → 飞牛 eop-images 文件夹立即出现文件 → 刷新图库可见
```

**上传闭环**：后台上传 → 飞牛文件夹出现新文件 → `/manifest` 含该图 → 图库可见。

---

## 10. 两种图片访问模式怎么选

| 对比 | 模式 A：直连飞牛域名 | 模式 B：同源代理 `/api/images` |
|------|---------------------|-------------------------------|
| 配置 | `NEXT_PUBLIC_IMAGE_BASE_URL` 填域名 | 该变量留空 |
| 图片 URL | `https://pic.example.com/images/xxx` | `https://你的站点/api/images?name=xxx` |
| EdgeOne 流量 | 几乎不消耗 | 每张图经边缘函数，消耗流量 |
| 隐藏 NAS 地址 | 否 | 是 |
| 缓存 | 飞牛 + 浏览器长缓存 | EdgeOne CDN 长缓存 |
| 适合 | 有稳定公网域名、想省 CDN 流量 | 想隐藏 NAS、或域名不稳定 |

> 随时切换：改一个环境变量重新部署即可，图片不用动。

---

## 11. 常见问题排查

### Q1：后台上传报「服务器未配置 NAS_API_URL」
EdgeOne 环境变量没加或拼错。确认后重新部署。

### Q2：清单为空 / 上传成功但图库看不到
- 等 60 秒缓存刷新
- 终端 `curl -H "X-Api-Token: <token>" https://pic.example.com/manifest` 看飞牛端是否已有该图
- 检查飞牛 `eop-images` 文件夹权限：确保容器有读写权限（图形界面里检查文件夹共享权限）

### Q3：图片加载失败 / 混合内容被拦截
图片域名必须是有效 HTTPS。

### Q4：容器起不来 / 日志报 `NAS_API_TOKEN is required`
说明 compose 里 `NAS_API_TOKEN=请修改-随机密钥` 没改，或没填在 `environment` 里。回第 4.2 步检查。

### Q4-1：`failed to read dockerfile: open Dockerfile: no such file or directory`
旧版用「构建镜像」方式时，项目路径选错或 Dockerfile 没传全导致。**新版已彻底去掉构建步骤**——请删除旧项目，用新的 `docker-compose.feiniu.yml` 重新建项目（它直接拉 `node:20-alpine` 并挂载 `server.js`，不需要 Dockerfile）。若必须用构建方式，确认项目路径选的是包含 `Dockerfile` 的 `eop-nas` 文件夹。

### Q4-2：卡在 `Pulling` / `net/http: request canceled ... Client.Timeout exceeded`（registry-1.docker.io 超时）
Docker Hub 国内直连超时。按第 4.3 步的方法处理：配置镜像加速器（推荐），或在飞牛 Docker 里先手动拉取 `node:20-alpine`，或换成飞牛里已有的 Node 镜像。

### Q5：EdgeOne 连不上飞牛
- 终端 `curl https://pic.example.com/health` 确认公网可达
- 飞牛路由器端口转发 / 防火墙放行 443
- 若飞牛只有内网 IP，需内网穿透

### Q6：token 两边不一样？
飞牛 compose 里的 `NAS_API_TOKEN` ＝ EdgeOne 的 `NAS_API_TOKEN`，**必须逐字符相同**。

### Q7：删除后图片还能访问？
浏览器/CDN 有 1 年 immutable 缓存。文件名唯一，删除后一般无人再访问旧链接；彻底清理需到 EdgeOne 控制台刷新 URL。

### Q8：想换回 GitHub 存储？
留空/删除 `NAS_API_URL` 等变量重新部署，项目自动回退到本地 `images-metadata.json` 模式（或用 git 历史恢复旧版 `/api/github`）。

### Q9：3000 端口已被占用 / 容器起不来提示端口冲突？
compose 里已经用 `3100:3000` 避开了 3000。
- **左边是飞牛端口**：被占用就改左边，如 `3200:3000`
- **右边是容器端口**：固定 3000，配合 `PORT=3000`，不要改
- 改了左边后，**反代目标端口同步改**（见第 5 步），例如填 `127.0.0.1:3200`
- 改完在项目里点「重新部署 / 重启」生效

---

## 12. 日常运维（飞牛图形界面）

- **查看状态**：Docker → 项目 → `eop-nas-images` → 状态「运行中」
- **看日志**：项目详情 → 日志
- **重启**：项目详情 → 重启
- **更新服务**（改了 `server.js`）：重新上传文件后，项目 → 重新构建 / 重新部署
- **备份图片**：直接备份飞牛上的 `eop-images` 文件夹即可（飞牛支持快照/备份任务）

**安全建议：**
- `NAS_API_TOKEN` 用 24 字节以上随机值，不要和后台密码相同
- 反代层可加 IP 白名单，只允许 EdgeOne 出口 IP 访问管理接口（可选）
- 定期备份图片文件夹

---

## 附录 A：环境变量速查表

### 飞牛 Compose（`docker-compose.feiniu.yml`）

| 变量 | 示例 | 必填 | 说明 |
|------|------|------|------|
| `NAS_API_TOKEN` | `a1b2...` | ✅ | 与 EdgeOne 端一致 |
| `PUBLIC_BASE_URL` | `https://pic.example.com` | 否 | 图片公网域名 |
| `PORT` | `3000` | 否 | 容器内部端口，固定不要改 |
| 端口映射 | `3100:3000` | 是 | 左边飞牛端口(占用就改)，右边固定 3000 |
| 挂载路径(左) | `/vol1/1000/docker/eop-images` | ✅ | 飞牛真实图片文件夹 |

### EdgeOne（控制台环境变量）

| 变量 | 示例 | 必填 | 说明 |
|------|------|------|------|
| `NAS_API_URL` | `https://pic.example.com` | ✅ | NAS API 地址 |
| `NAS_API_TOKEN` | `a1b2...` | ✅ | 与飞牛端一致 |
| `NEXT_PUBLIC_IMAGE_BASE_URL` | `https://pic.example.com` | 否 | 留空走同源代理 |
| `ADMIN_PASSWORD` | 自定义 | 否 | 默认 admin123，线上必改 |

---

## 附录 B：飞牛反代 / HTTPS 设置说明

### B.1 飞牛内置反代（若有）

设置 → 反向代理 / 域名管理 → 新增：

- 来源：`HTTPS` `pic.example.com:443`
- 目标：`HTTP` `127.0.0.1:3100`（与 compose 左边端口一致）
- 绑定有效 SSL 证书

### B.2 Nginx Proxy Manager（飞牛应用中心安装）

图形化操作：

1. 飞牛应用中心安装 **Nginx Proxy Manager**
2. 打开其 Web 界面（默认 81 端口）→ **Proxy Hosts → Add**
3. Details 标签：
   - Domain Names：`pic.example.com`
   - Scheme：`http`，Forward Hostname/IP：`127.0.0.1`，Forward Port：`3100`（与 compose 左边端口一致）
4. SSL 标签：申请 Let's Encrypt 证书，开启 Force SSL
5. 保存后即可用 `https://pic.example.com` 访问

### B.3 Cloudflare Tunnel（无公网 IP 时）

1. 飞牛 Docker 里以图形化方式运行 `cloudflared` 容器
2. 在 Cloudflare Zero Trust 面板配置 Tunnel，Ingress：
   - `pic.example.com` → `http://127.0.0.1:3100`（与 compose 左边端口一致）
3. EdgeOne 的 `NAS_API_URL` / `NEXT_PUBLIC_IMAGE_BASE_URL` 都填 `https://pic.example.com`

---

> 飞牛不同版本菜单名称可能略有差异（如「Docker → 项目」或「容器 → Compose」）。
> 核心只需要记住：**用 `docker-compose.feiniu.yml` 建项目，改里面 3 个「请修改」的值**，其余按向导默认即可。
> 若某步骤界面找不到，把飞牛版本和对应界面截图描述出来，我帮你对应调整。
