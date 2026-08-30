@echo off
chcp 65001 > nul
title 이웃메이트 Pro - 네이버 블로그 자동화
cd /d "%~dp0"

echo ====================================================
echo  [이웃메이트 Pro] 윈도우 데스크탑 프로그램을 실행합니다...
echo ====================================================

taskkill /F /IM electron.exe >nul 2>&1

npx electron .

