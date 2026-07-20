---
title: 网络连接排查
category: 网络
seed_key: network.basic
---

# 网络连接排查

## 问题
服务端口不通、连接数异常时的基础排查。

## 命令

### 1. 监听端口
```bash
ss -lntp
```

### 2. 已建立连接
```bash
ss -antp | head -n 50
```

### 3. 本机 IP
```bash
ip a
```

### 4. 路由表
```bash
ip route
```
