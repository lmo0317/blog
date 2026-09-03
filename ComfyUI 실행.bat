@echo off
chcp 65001 > nul
echo ===================================================
echo [이웃메이트] ComfyUI 로컬 초고속 이미지 엔진을 실행합니다.
echo 포트: 8188 (RTX 5080 최적화)
echo ===================================================
cd /d "D:\work\ai\comfyui"
call run_comfyui.bat
