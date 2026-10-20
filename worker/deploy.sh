#!/usr/bin/env bash
# 一体化部署：一个 Cloudflare Worker 同时提供网页和 AI 接口。
# 模型 Key 只写入 Cloudflare Secret，不进仓库、不进网页。
# 用法：cd worker && ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

command -v npx >/dev/null 2>&1 || { echo "错误：需要已安装 Node.js（npx）。"; exit 1; }
[ -f wrangler.toml ] || cp wrangler.toml.example wrangler.toml

echo "==> 检查 Cloudflare 登录（未登录会打开浏览器授权）"
npx wrangler whoami >/dev/null 2>&1 || npx wrangler login

printf '==> 输入 DeepSeek API Key（sk-...，输入不回显）: '
read -rs KEY
echo
if [ -z "$KEY" ]; then echo "未输入 Key，已退出。"; exit 1; fi

if command -v openssl >/dev/null 2>&1; then
  CODE="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)"
else
  CODE=""; for i in $(seq 1 24); do CODE+="$((RANDOM % 10))"; done
fi
[ -n "$CODE" ] || { echo "错误：无法生成访问码。"; exit 1; }

echo "==> 写入 Secret 并部署（首次运行会下载 wrangler，可能需要几分钟）"
printf '%s' "$KEY" | npx wrangler secret put OPENAI_API_KEY
printf '%s' "$CODE" | npx wrangler secret put SITE_ACCESS_CODE
npx wrangler deploy

cat <<EOF

==> 部署完成！
    网页地址：见上方 workers.dev 链接（每次部署都会打印）
    打开网页后，在「AI API 设置」中填入访问码（网关地址留空）：
        $CODE
    访问码只保存在页面内存，刷新后需重填；它不是模型 Key，泄露后可随时
    重新运行本脚本或执行 npx wrangler secret put SITE_ACCESS_CODE 更换。
EOF
