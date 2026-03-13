@echo off
REM post-commit hook for weknora sync
REM 自动同步修改的文档到 weknora 知识库
REM
REM 使用方法: 将此文件复制到 .git/hooks/post-commit
REM Windows: copy scripts\post-commit.bat .git\hooks\post-commit

cd /d "%~dp0\.."
node scripts/weknora-sync.js

exit /b 0
