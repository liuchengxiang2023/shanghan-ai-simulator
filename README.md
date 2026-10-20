# 伤寒论·外感辨证学习模拟器（GitHub Pages + AI 兜底）

本项目依据用户提供的四张“感冒治症简易图表”及文字整理，用于**古籍辨证流程学习**，不用于真实诊断或处方。

## 主要功能

- 原图规则优先：规则明确时不调用模型。
- 规则无法匹配或存在冲突时，通过模型网关获取最多三项**古籍学习候选**。
- 还原原作者的“月经期优先小柴胡汤”分支（仅供原文对照；**不代表临床正确性**）。
- 还原原文“儿童减半”作为数学演算显示（**不是可服用剂量**）。
- 古籍按 **1 两 = 3 克**进行练习演算；枚、升等未能直接换算的单位保留原文。
- 遇到危险信号时停止自动方剂匹配。
- 支持一体化部署：一个 Cloudflare Worker 同时提供网页与 AI 接口（`worker/deploy.sh` 一键部署）。

## 1. 先将网页上传 GitHub

1. 在 GitHub 创建一个空仓库，例如 `shanghan-ai-simulator`。（你也可以将 `index.html` 放到已有仓库的根目录；上传前先确认不会覆盖已有网站。）
2. 将本文件夹根目录的 `index.html`、`README.md` 上传到仓库的 `main` 分支根目录；`worker/` 仅为后台部署素材，放在仓库里不会作为后台执行。
3. GitHub 仓库 -> `Settings` -> `Pages` -> `Build and deployment` -> `Deploy from a branch` -> `main` / `(root)` -> `Save`。
4. 等待发布完成，打开 `https://<你的GitHub用户名>.github.io/<仓库名>/`。

注意：**GitHub Pages 本身不能安全存储 AI API Key。** 页面上传后，离线规则即可用。AI 兜底按第 2 节部署：方式 A 一体化部署时 GitHub Pages 可有可无（Worker 自己就是完整网页）；方式 B 才需要它。

## 2. 部署 AI 网关

模型 Key（DeepSeek 的 `sk-...`）始终只保存在 Cloudflare Secret 里：不进仓库、不进网页、不进前端代码。两种方式任选其一。

### 方式 A · 一体化部署（推荐：网页 + AI 封装在同一个 Worker 里）

```bash
cd worker
./deploy.sh
```

脚本会：检查/引导 Cloudflare 登录 → 让你粘贴 DeepSeek API Key → 自动生成随机访问码 → 两者都写入 Secret → 部署。

- 部署完成后，输出里打印的 `https://<worker-name>.<subdomain>.workers.dev` 地址**本身就是完整网页**：Worker 把仓库根目录的 `index.html` 打包进去直接返回，同源调用 `/api`，无需 CORS、无需 `ALLOWED_ORIGIN`，也不依赖 GitHub Pages。
- 打开该地址，展开“AI API 设置”：**网关地址留空**，填入脚本显示的访问码，点击“连接 / 测试接口”。
- 手动等价命令（不想用脚本时）：

```bash
cd worker
cp wrangler.toml.example wrangler.toml
npx wrangler login
printf '%s' 'sk-你的DeepSeekKey' | npx wrangler secret put OPENAI_API_KEY
printf '%s' '自定的长随机访问码' | npx wrangler secret put SITE_ACCESS_CODE
npx wrangler deploy
```

### 方式 B · GitHub Pages 网页 + 独立 API Worker

沿用第 1 节的 GitHub Pages 网页，再部署一个只做接口的 Worker：

1. 登录 Cloudflare，在本地仓库 `worker/` 目录用 Wrangler 部署（`npx wrangler deploy`；在线编辑器粘贴的方式不再适用，因为 worker.js 以模块方式引入了 index.html）。
2. 在该 Worker 的 **Settings -> Variables and Secrets** 中添加：

| 变量 | 类型 | 示例 / 说明 |
|---|---|---|
| `OPENAI_API_KEY` | **Secret** | 模型提供商 Key（本项目默认 DeepSeek：`sk-...`，从 platform.deepseek.com 获取），不要复制到 GitHub |
| `SITE_ACCESS_CODE` | **Secret** | 自己设定的长随机访问码（建议 >= 20 个字符）；**不同于模型 Key** |
| `ALLOWED_ORIGIN` | Variable | **方式 B 必填**：`https://liuchengxiang2023.github.io`（网页真实来源，无路径、无末尾 `/`；一体化部署不设此项） |
| `OPENAI_MODEL` | Variable | `deepseek-chat`（DeepSeek 的通用对话模型；`deepseek-reasoner` 不支持 JSON mode） |
| `OPENAI_BASE_URL` | Variable | `https://api.deepseek.com/v1`（OpenAI 兼容地址；也可换回 `https://api.openai.com/v1` 等） |
| `OPENAI_JSON_MODE` | Variable（可选） | `true`（DeepSeek `deepseek-chat` 与 OpenAI 均支持 JSON mode） |

如果设置的是自定义域名，`ALLOWED_ORIGIN` 需要改为网页真实来源（协议 + 域名 + 端口，不包括页面路径）。

3. 记下生成的 HTTPS 网关地址，如 `https://<worker-name>.<subdomain>.workers.dev`。
4. 打开 GitHub Pages 网页，展开“AI API 设置”，填写网关地址与 `SITE_ACCESS_CODE`，点击 **连接 / 测试接口**。
5. 出现“AI 已连接”后，选择一个**图表规则无法匹配或存在冲突**的教学情景，自动触发 AI 兜底。

两种方式都不需要在网页源代码中写入真正的模型 API Key。方式 A 网关地址留空（同源自动识别）；方式 B 网页只在浏览器本地保存网关 URL。访问码都只保留在页面内存里，刷新后需重新输入。

## 3. 常见问题

- **上传后 AI 不能用**：GitHub Pages 只是静态网页，AI 需要 Worker 网关。最省事是方式 A 一体化部署（`cd worker && ./deploy.sh`）；先看网页顶部的接口状态提示。
- **一体化部署后网页在哪**：`npx wrangler deploy` 输出的 workers.dev 链接就是网页本身，不需要再开 GitHub Pages。
- **浏览器显示 CORS 失败**：检查 `ALLOWED_ORIGIN` 是否与 GitHub Pages 的实际域名完全一致（不包括路径）。Worker 的允许来源限制只约束浏览器，不能代替访问码认证。
- **401 访问码不正确**：网页填写的是 `SITE_ACCESS_CODE`，不是模型提供商的 API Key。
- **模型返回 HTTP 401/404/429**：检查 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL` 和额度（DeepSeek 余额可在 platform.deepseek.com 查看）。
- **规则确定却没有调用 AI**：这是预期功能，只有无匹配或歧义才触发。
- **本地网页不联网**：不配置网关时，规则引擎仍然可离线运行。

## 4. 安全与费用

- **不要**把模型 API Key、网站访问码放到 `index.html`、JS 文件、GitHub 提交记录、`wrangler.toml` 或 Issue 中。
- 即使服务端使用访问码，也可能被知道访问码的人调用而产生费用。只与可信使用者分享访问码，建议使用 Cloudflare Access 或其他身份验证和限流措施。
- 开发、展示时不要输入可识别真实患者的个人资料。触发 AI 时所选症状与备注会被发送到你配置的服务端和模型提供商。
- 此项目提供的是历史文献学习对照，不是经过临床验证的诊疗算法；尤其不能据此给儿童配药，或自行服用麻黄、细辛、附子等药物。

## 文件说明

- `index.html`：全部网页逻辑和交互功能，GitHub Pages 可直接发布。
- `worker/worker.js`：Cloudflare Worker 的 API 网关，保管模型 Key、执行访问控制和调用模型。
- `worker/deploy.sh`：一体化部署脚本（引导 Cloudflare 登录、写入两个 Secret、部署，末尾打印访问码）。
- `worker/test-worker.mjs`：本地端到端测试脚本（不部署 Cloudflare 也能跑）：`OPENAI_API_KEY=sk-... SITE_ACCESS_CODE=任意测试码 node worker/test-worker.mjs`，会真实调用一次模型。
- `worker/wrangler.toml.example`：可选 Wrangler 配置参考，不含密钥。
- `.gitignore`：防止将本地密钥和日志意外提交到仓库。

**备注**：本版本已通过静态语法检查、模拟模型响应测试，并使用真实 DeepSeek API Key 完成 Worker 端到端测试（`worker/test-worker.mjs`，12 项全部通过）与 Wrangler 打包验证（dry-run，index.html 成功打入 Worker）。部署到你自己的 Cloudflare 账号只需 `cd worker && ./deploy.sh`。
