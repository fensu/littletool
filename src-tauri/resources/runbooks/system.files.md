---
title: 文件与目录查看
category: 系统
seed_key: system.files
---

# 文件与目录查看

## 问题
日常查看目录内容、权限与隐藏文件。

## 命令

### 1. 当前目录详情
```bash
ls -lah
```

### 2. 递归列出（注意目录很大时慎用）
```bash
ls -lahR
```

### 3. 按时间排序最近修改
```bash
ls -lht | head -n 30
```

### 4. 查看文件类型
```bash
file *
```
