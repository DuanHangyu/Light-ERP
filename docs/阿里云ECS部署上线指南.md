# 阿里云 ECS 部署上线指南

适用项目：轻量级定制生产流转 ERP  
服务器环境：Alibaba Cloud Linux 3.2104 LTS 64 位  
当前服务器公网 IP：`8.136.219.184`  
推荐部署方式：Node.js 22 + PM2 + Nginx 反向代理  
演示访问方式：`http://8.136.219.184/`

## 1. 当前服务器是否够用

从截图看，当前 ECS 配置如下：

| 项目 | 当前值 | 判断 |
| --- | --- | --- |
| 地域 | 华东 1（杭州） | 可以 |
| CPU | 4 vCPU | 足够演示和小团队试点 |
| 内存 | 8 GiB | 足够 |
| 系统盘 | 50 GiB | 可以演示，正式使用建议单独挂数据盘 |
| 公网带宽 | 50 Mbps 峰值 | 足够客户远程查看演示 |
| 操作系统 | Alibaba Cloud Linux 3.2104 LTS 64 位 | 可以部署 Node.js 应用 |

结论：该服务器可以直接用于客户在线演示。正式上线时建议增加独立数据盘，把 `ERP_DATA_DIR` 指向数据盘路径。

## 2. 阿里云控制台需要先做的事

### 2.1 重置或确认服务器登录密码

如果你不知道服务器 root 密码：

1. 进入 ECS 实例详情。
2. 点击“重置密码”。
3. 重启实例让密码生效。
4. 使用阿里云“远程连接”或本机 SSH 登录。

### 2.2 安全组开放端口

在 ECS 控制台进入：

`网络与安全组 -> 安全组 -> 入方向规则`

建议开放：

| 端口 | 协议 | 授权对象 | 用途 |
| --- | --- | --- | --- |
| 22 | TCP | 你的办公 IP，临时也可 `0.0.0.0/0` | SSH 登录 |
| 80 | TCP | `0.0.0.0/0` | 客户浏览器访问 |
| 443 | TCP | `0.0.0.0/0` | 后续配置 HTTPS |
| 3010 | TCP | 你的办公 IP 或临时 `0.0.0.0/0` | 可选，直接访问 Next.js 服务 |

推荐客户访问走 `80` 端口，不直接暴露 `3010`。

## 3. 服务器初始化

登录服务器：

```bash
ssh root@8.136.219.184
```

安装基础工具：

```bash
sudo dnf update -y
sudo dnf install -y git nginx tar gzip curl
```

安装 Node.js 22：

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
node -v
npm -v
```

安装 PM2：

```bash
sudo npm install -g pm2
pm2 -v
```

创建应用目录和数据目录：

```bash
sudo mkdir -p /opt/atc-erp
sudo mkdir -p /data/atc-erp
sudo chown -R root:root /opt/atc-erp /data/atc-erp
```

说明：

- `/opt/atc-erp`：应用代码目录。
- `/data/atc-erp`：数据库、附件、导出文件、备份文件目录。
- 正式客户部署时，建议 `/data/atc-erp` 放到独立数据盘。

## 4. 在本地生成发布包

在本机项目目录执行：

```bash
cd /Users/duanhangyu/Documents/Codex/2026-04-28/prd-1-erp-2-rbac-bom
./scripts/deploy/create-release.sh
```

脚本会自动执行：

- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run build`
- 打包生成 `releases/atc-erp-release-时间戳.tar.gz`

生成后会在终端输出压缩包路径。

## 5. 上传发布包到服务器

假设生成的包为：

```bash
releases/atc-erp-release-20260514-120000.tar.gz
```

上传：

```bash
scp releases/atc-erp-release-20260514-120000.tar.gz root@8.136.219.184:/tmp/
```

如果你使用阿里云网页远程连接，也可以通过控制台文件上传，但 SSH + SCP 最方便。

## 6. 在服务器解压和安装依赖

登录服务器：

```bash
ssh root@8.136.219.184
```

解压：

```bash
sudo rm -rf /opt/atc-erp/*
sudo tar -xzf /tmp/atc-erp-release-20260514-120000.tar.gz -C /opt/atc-erp
cd /opt/atc-erp
```

复制生产环境变量：

```bash
cp .env.production.example .env.production
```

确认 `.env.production` 内容：

```bash
cat .env.production
```

应该类似：

```bash
NODE_ENV=production
PORT=3010
ERP_DATA_DIR=/data/atc-erp
ERP_SEED_MODE=demo
```

安装生产依赖：

```bash
npm ci --omit=dev
```

说明：

- 当前给客户看演示，`ERP_SEED_MODE=demo` 是合适的，会有演示数据。
- 正式上线导入客户真实数据时，再切换到生产数据策略。

## 7. 使用 PM2 启动项目

在服务器 `/opt/atc-erp` 执行：

```bash
ERP_APP_DIR=/opt/atc-erp ERP_DATA_DIR=/data/atc-erp PORT=3010 ERP_SEED_MODE=demo pm2 start ecosystem.config.cjs
pm2 save
pm2 list
```

设置开机自启：

```bash
pm2 startup systemd
```

执行命令输出里提示的那一行 `sudo env PATH=... pm2 startup ...`。

然后再次保存：

```bash
pm2 save
```

本机服务器内测试：

```bash
curl -I http://127.0.0.1:3010
```

如果返回 `HTTP/1.1 200 OK` 或 `307` 等响应，说明 Next.js 服务已启动。

## 8. 配置 Nginx 让客户用 80 端口访问

创建 Nginx 配置：

```bash
sudo tee /etc/nginx/conf.d/atc-erp.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name _;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass $http_upgrade;
    }
}
EOF
```

检查并启动 Nginx：

```bash
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
```

如果系统防火墙开启，可以执行：

```bash
sudo firewall-cmd --permanent --add-service=http || true
sudo firewall-cmd --reload || true
```

浏览器访问：

```text
http://8.136.219.184/
```

如果你临时开放了 3010，也可以访问：

```text
http://8.136.219.184:3010/
```

## 9. 常用运维命令

查看应用状态：

```bash
pm2 list
```

查看日志：

```bash
pm2 logs atc-erp
```

重启应用：

```bash
pm2 restart atc-erp
```

停止应用：

```bash
pm2 stop atc-erp
```

查看 Nginx 状态：

```bash
sudo systemctl status nginx
```

查看数据目录：

```bash
ls -lah /data/atc-erp
```

## 10. 更新版本流程

以后每次本地开发完，需要重新上线：

本地：

```bash
./scripts/deploy/create-release.sh
scp releases/新的发布包.tar.gz root@8.136.219.184:/tmp/
```

服务器：

```bash
cd /opt/atc-erp
pm2 stop atc-erp
sudo rm -rf /opt/atc-erp/*
sudo tar -xzf /tmp/新的发布包.tar.gz -C /opt/atc-erp
cd /opt/atc-erp
cp .env.production.example .env.production
npm ci --omit=dev
ERP_APP_DIR=/opt/atc-erp ERP_DATA_DIR=/data/atc-erp PORT=3010 ERP_SEED_MODE=demo pm2 start ecosystem.config.cjs
pm2 save
sudo systemctl reload nginx
```

注意：

- 不要删除 `/data/atc-erp`。
- `/data/atc-erp` 是数据库和附件目录。
- 更新代码只替换 `/opt/atc-erp`。

## 11. 客户演示前检查清单

上线后请检查：

- 浏览器能打开 `http://8.136.219.184/`。
- 登录页面正常。
- 经营总览能打开。
- 采购仓储、销售订单、生产执行、质检收率、财务台账、报表中心能切换。
- 附件上传不报错。
- 报表下载不报错。
- PM2 状态为 `online`。
- Nginx 状态为 `active`。

## 12. 正式上线前建议

当前给客户演示可以直接使用公网 IP。

正式项目建议：

1. 绑定正式域名。
2. 配置 HTTPS 证书。
3. 使用独立数据盘。
4. 设置每天自动备份。
5. 设置只允许公司 IP 或 VPN 访问。
6. 演示数据和正式数据分离。
7. 设置管理员初始账号和密码修改流程。

## 13. 你现在最快的上线路径

如果只是今天给客户看：

1. 安全组开放 `80` 和 `22`。
2. 服务器安装 Node.js、PM2、Nginx。
3. 本地运行 `./scripts/deploy/create-release.sh`。
4. `scp` 上传发布包。
5. 服务器解压到 `/opt/atc-erp`。
6. `npm ci --omit=dev`。
7. `pm2 start ecosystem.config.cjs`。
8. 配置 Nginx。
9. 发给客户：

```text
http://8.136.219.184/
```
