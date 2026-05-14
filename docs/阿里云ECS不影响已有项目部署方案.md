# 阿里云 ECS 不影响已有项目部署方案

适用场景：同一台阿里云 ECS 已经运行其他项目，现在需要临时上线 ERP 给客户演示。  
核心原则：不覆盖现有项目、不占用现有端口、不修改已有 Nginx 配置、不停止已有 PM2/系统服务。

## 1. 推荐部署方式

为了不影响服务器上正在运行的小项目，本 ERP 演示建议采用“独立端口直连”方式：

```text
http://8.136.219.184:3010/
```

如果 `3010` 已被占用，就改用：

```text
http://8.136.219.184:3011/
```

这种方式暂时不配置 Nginx，不动 `80` 和 `443` 端口，因此对现有网站影响最小。

## 2. 部署隔离策略

| 项目 | 现有项目 | ERP 项目 |
| --- | --- | --- |
| 应用目录 | 不动 | `/opt/atc-erp` |
| 数据目录 | 不动 | `/data/atc-erp` |
| 运行端口 | 不动 | `3010` 或 `3011` |
| PM2 应用名 | 不动 | `atc-erp` |
| Nginx 配置 | 不动 | 先不配置 |
| 安全组 | 保留原规则 | 只新增 ERP 演示端口 |

## 3. 上线前必须先检查

登录服务器：

```bash
ssh root@8.136.219.184
```

查看当前正在监听的端口：

```bash
ss -lntp
```

重点看这些端口有没有被占用：

```bash
ss -lntp | grep -E ':80|:443|:3000|:3001|:3010|:3011'
```

查看 PM2 是否已有项目：

```bash
pm2 list || true
```

查看 Nginx 当前配置文件：

```bash
ls -lah /etc/nginx/conf.d || true
sudo nginx -T | sed -n '1,220p'
```

注意：这一步只查看，不修改。

## 4. 选择不冲突端口

如果 `3010` 没有被占用，用 `3010`：

```bash
export ERP_PORT=3010
```

如果 `3010` 已经被占用，用 `3011`：

```bash
export ERP_PORT=3011
```

确认端口空闲：

```bash
ss -lntp | grep ":$ERP_PORT" || echo "端口 $ERP_PORT 可用"
```

## 5. 阿里云安全组只新增 ERP 演示端口

在阿里云控制台安全组入方向新增：

| 端口 | 协议 | 授权对象 | 用途 |
| --- | --- | --- | --- |
| 3010 或 3011 | TCP | 你的办公 IP，客户演示临时可 `0.0.0.0/0` | ERP 演示访问 |

不要改动现有 `80`、`443`、已有项目端口规则。

## 6. 创建独立目录

```bash
sudo mkdir -p /opt/atc-erp
sudo mkdir -p /data/atc-erp
```

不要使用现有项目目录，例如：

```bash
# 不要这样做
rm -rf /www/wwwroot/*
rm -rf /opt/*
rm -rf /home/*
```

## 7. 上传并解压 ERP 发布包

本地生成发布包：

```bash
cd /Users/duanhangyu/Documents/Codex/2026-04-28/prd-1-erp-2-rbac-bom
./scripts/deploy/create-release.sh
```

上传：

```bash
scp releases/atc-erp-release-*.tar.gz root@8.136.219.184:/tmp/
```

服务器解压：

```bash
sudo rm -rf /opt/atc-erp/*
sudo tar -xzf /tmp/atc-erp-release-*.tar.gz -C /opt/atc-erp
cd /opt/atc-erp
```

这里删除的只有 `/opt/atc-erp/*`，不会影响现有项目。

## 8. 安装依赖并构建

如果服务器没有 Node.js，先安装：

```bash
curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
sudo dnf install -y nodejs
sudo npm install -g pm2
```

进入 ERP 目录：

```bash
cd /opt/atc-erp
npm ci --omit=dev
```

如果发布包中已经包含 `.next` 构建产物，可以直接启动；如果需要服务器重新构建：

```bash
npm run build
```

## 9. 用独立 PM2 应用启动

假设使用 `3010`：

```bash
ERP_APP_DIR=/opt/atc-erp \
ERP_DATA_DIR=/data/atc-erp \
PORT=3010 \
ERP_SEED_MODE=demo \
pm2 start ecosystem.config.cjs --only atc-erp
```

如果使用 `3011`：

```bash
ERP_APP_DIR=/opt/atc-erp \
ERP_DATA_DIR=/data/atc-erp \
PORT=3011 \
ERP_SEED_MODE=demo \
pm2 start ecosystem.config.cjs --only atc-erp
```

保存 PM2 状态：

```bash
pm2 save
```

检查：

```bash
pm2 list
pm2 logs atc-erp --lines 80
```

## 10. 验证不影响旧项目

确认 ERP 端口：

```bash
curl -I http://127.0.0.1:$ERP_PORT
```

确认原项目仍在：

```bash
curl -I http://127.0.0.1:80 || true
curl -I http://127.0.0.1:443 || true
pm2 list
```

浏览器访问：

```text
http://8.136.219.184:3010/
```

或：

```text
http://8.136.219.184:3011/
```

## 11. 如果以后要绑定域名

如果已有项目正在使用 `80/443`，不要直接把 Nginx 默认站点改成 ERP。

正确做法是使用独立子域名，例如：

```text
erp-demo.yourdomain.com
```

然后新增一个独立 Nginx 配置：

```nginx
server {
    listen 80;
    server_name erp-demo.yourdomain.com;

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
```

新增配置后：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

不要修改已有项目的 server block。

## 12. 回滚方式

如果 ERP 演示不需要了：

```bash
pm2 stop atc-erp
pm2 delete atc-erp
pm2 save
```

可选删除 ERP 代码：

```bash
sudo rm -rf /opt/atc-erp
```

如果要保留演示数据，不要删除：

```bash
/data/atc-erp
```

如果确认数据也不要了：

```bash
sudo rm -rf /data/atc-erp
```

## 13. 当前建议

因为服务器上已经有小项目在跑，本次客户演示建议：

1. 不配置 Nginx。
2. 不占用 80/443。
3. ERP 直接跑在 `3010` 或 `3011`。
4. 阿里云安全组临时开放该端口。
5. 客户演示结束后，如不需要公网访问，可关闭安全组端口。

这样最稳，不会影响已有项目。
