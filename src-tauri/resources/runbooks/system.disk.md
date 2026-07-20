---
title: 磁盘空间排查
category: 系统
seed_key: system.disk
---

# 磁盘空间排查

## 问题
服务器磁盘占用过高，需要快速定位空间消耗。

## 命令

### 1. 查看分区使用率
```bash
df -h
```

### 2. 查看 inode 使用
```bash
df -ih
```

### 3. 统计根目录各目录大小
```bash
du -sh /* 2>/dev/null | sort -h
```

### 4. 查找大于 500M 的文件
```bash
find / -type f -size +500M 2>/dev/null | head -n 50
```
