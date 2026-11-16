<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="EdgeOne Random Picture — 基于 EdgeOne Pages 的随机图片 API 分发系统，智能识别设备类型，精准推送适配图片">
</p>

<p align="center">
  <a href="https://picture.tianhw.top/"><strong>🔗 在线演示</strong></a> ·
  <a href="https://picture.tianhw.top/api/random">随机一张</a> ·
  <a href="https://picture.tianhw.top/gallery">图库预览</a>
</p>

---

## 它是什么

一个部署在 EdgeOne Pages 上的**随机图片 API 服务**。放入图片，获得一个 URL——每次请求返回一张随机图片，自动适配访问者设备。

```bash
# 在浏览器、Markdown、或任何需要随机图片的地方直接使用
https://picture.tianhw.top/api/random
```

## 工作原理

```text
请求 /api/random
    │
    ├─ ?type=pc      → 随机横屏图片 → 302 重定向
    ├─ ?type=mobile  → 随机竖屏图片 → 302 重定向
    └─ 无参数        → User-Agent 识别设备 → 自动匹配
```

- **横屏图片**（宽 > 高）自动归类为 PC 端素材
- **竖屏图片**（高 ≥ 宽）自动归类为移动端素材
- 图片元数据在构建时生成，运行时无文件系统开销

## 特性

| 能力 | 说明 |
|------|------|
| 智能分发 | 基于 User-Agent 自动识别设备，推送适配尺寸的图片 |
| 全球加速 | EdgeOne 边缘节点分发，静态资源一年强缓存 |
| 沉浸式图库 | 瀑布流布局 + Lightbox 预览 + GSAP 动画 |
| 零配置 | 图片放入目录即可，自动扫描、分类、生成缩略图 |
| JSON 模式 | `?redirect=false` 返回结构化 JSON，方便程序调用 |

## 快速开始

### 1. 放入图片

将图片放入 `public/images/` 目录：

- 支持 `.jpg` `.png` `.gif` `.webp` `.bmp` `.tiff`
- 支持子目录分类，系统递归扫描
- 无需重命名，自动按比例分类

### 2. 本地运行

```bash
pnpm install
pnpm dev
```

访问 `http://localhost:3000` 查看首页，`/gallery` 查看图库，`/api/random` 测试 API。

### 3. 部署到 EdgeOne Pages

[![使用 EdgeOne Pages 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https://github.com/H2O-ME/EdgeOne-Random-Picture)

| 配置项 | 值 |
|--------|------|
| 框架预设 | `Next.js` |
| 构建命令 | `npm run build` |
| 输出目录 | `.next` |

## API 参考

| 端点 | 说明 | 响应 |
|------|------|------|
| `GET /api/random` | 随机图片（自动识别设备） | `302` 重定向到图片 |
| `GET /api/random?type=pc` | 随机横屏图片 | `302` 重定向 |
| `GET /api/random?type=mobile` | 随机竖屏图片 | `302` 重定向 |
| `GET /api/random?redirect=false` | JSON 格式返回 | `{"url","width","height","size"}` |
| `GET /gallery` | 图库页面 | HTML |

**JSON 响应示例：**

```json
{
  "url": "/images/621.webp",
  "width": 1536,
  "height": 864,
  "size": "259.64 KB"
}
```

## 把图片存储改为自己的 NAS

站点仍然部署在 EdgeOne Pages（前端 + 全球 CDN），图片本体存放在你的 NAS。
在 NAS 上用 Docker 运行本仓库自带的轻量图片服务，EdgeOne 通过服务端接口读写它。

### 架构

```text
浏览器 ──访问──> EdgeOne Pages (本站)
                    │ 服务端读取清单 / 代理管理操作
                    ▼
              NAS Docker 服务  ──静态图片──> 公网 HTTPS 域名 /images/xxx
                    │
                    ▼
              NAS 共享目录（真实图片文件）
```

- 上传/删除：后台 → `/api/github` → NAS 服务（管理密码与 NAS 密钥都在服务端校验，不暴露给浏览器）
- 图片访问：优先直连 `NEXT_PUBLIC_IMAGE_BASE_URL`；未配置则走 `/api/images` 同源代理
- 新增图片**立即生效**，不再需要重新构建，清单有 60 秒缓存

### 1. 在 NAS 上启动图片服务

> 服务为零第三方依赖（图片尺寸用纯 JS 解析），无需 npm install / 构建 / Dockerfile。
> 完整图形化教程（含飞牛 NAS）见 [DEPLOY-NAS.md](DEPLOY-NAS.md)。

命令行方式：

```bash
cd nas-service
cp .env.example .env      # 修改 NAS_API_TOKEN / PUBLIC_BASE_URL / IMAGE_DIR
mkdir -p /volume1/docker/eop-images
docker compose up -d      # 直接拉取 node:20-alpine 并挂载 server.js，无需 --build
```

用反代把映射端口（默认 `3100`）暴露为公网 HTTPS，例如 `https://pic.example.com`。
`/images/*` 供浏览器直接访问，`/manifest` 等管理接口由 EdgeOne 服务端带密钥调用。
Docker Hub 拉取超时时，配置国内镜像加速器或先手动拉取 `node:20-alpine`（详见 DEPLOY-NAS.md 第 4.3 步）。

### 2. 配置 EdgeOne Pages 环境变量

在 EdgeOne Pages 控制台添加（含义见仓库根目录 `.env.example`）：

| 变量 | 示例 | 说明 |
|------|------|------|
| `NAS_API_URL` | `https://pic-api.example.com` | NAS 服务 API 地址，EdgeOne 需能访问 |
| `NAS_API_TOKEN` | 与 NAS 端一致 | 服务端调用密钥 |
| `NEXT_PUBLIC_IMAGE_BASE_URL` | `https://pic.example.com` | 图片公网域名，留空走 `/api/images` 代理 |
| `ADMIN_PASSWORD` | 自定义 | 管理后台密码 |

### 3. 使用

重新部署后打开 `/admin` 上传图片即可，文件直接写入 NAS 共享目录。
随机 API `/api/random`、图库 `/gallery` 会自动从 NAS 读取最新清单。

> 提示：迁移完成后，原 `public/images` 里的旧图片需要手动复制到 NAS 的挂载目录。
> 如果暂时不配置 NAS 环境变量，项目会自动回退到原来的本地 `images-metadata.json` 模式。

## 技术栈

- **框架**：Next.js 16 (App Router, Turbopack)
- **样式**：Tailwind CSS 4
- **动画**：GSAP + @gsap/react
- **图片处理**：sharp（缩略图）+ image-size（元数据）
- **部署**：EdgeOne Pages

## 许可证

[MIT](LICENSE) © THW
