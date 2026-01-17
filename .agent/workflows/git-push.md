---
description: git提交
---

1. 每次提交前更新 `README.md` 文件内容。
2. 不要在一条命令中使用 `&&` 连接多个 git 命令。必须分步执行 `git status`, `git add`, `git commit`, `git push`。
3. 首先执行 `git status` 检查当前状态。如果是首次执行可以忽略。
4. 执行 `git add .`。
   - 如果遇到 "invalid path" 或类似错误（如 Windows 系统下的 `nul` 文件），必须先删除这些非法文件，然后再重试 `git add .`。
5. 执行 `git commit -m "[简要描述更改内容的提交信息]"`。
6. 执行 `git push`。