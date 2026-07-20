---
title: Docker 清理与日志
category: Docker
seed_key: docker.cleanup
---

# Docker 清理与日志

## 问题
Docker 占磁盘、容器异常退出时的清理与日志查看。

## 命令

### 1. 磁盘占用概况
```bash
docker system df
```

### 2. 清理无用数据（谨慎）
```bash
docker system prune -af
```

### 3. 查看最近容器日志（替换 CONTAINER）
```bash
docker logs --tail 200 CONTAINER
```

### 4. 查看容器详情（替换 CONTAINER）
```bash
docker inspect CONTAINER
```
