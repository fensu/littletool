---
title: Docker 基础查看
category: Docker
seed_key: docker.basic
---

# Docker 基础查看

## 问题
查看容器、镜像、资源占用的常用命令。

## 命令

### 1. 运行中的容器
```bash
docker ps
```

### 2. 全部容器
```bash
docker ps -a
```

### 3. 镜像列表
```bash
docker images
```

### 4. 容器资源占用
```bash
docker stats --no-stream
```
