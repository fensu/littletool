---
title: 内存与负载查看
category: 系统
seed_key: system.memory
---

# 内存与负载查看

## 问题
机器变慢、OOM 或负载高，先看内存和 CPU 概况。

## 命令

### 1. 内存概况
```bash
free -h
```

### 2. 实时进程（可按 q 退出）
```bash
top
```

### 3. 负载与运行时间
```bash
uptime
```

### 4. 内存占用 TOP 进程
```bash
ps aux --sort=-%mem | head -n 20
```
