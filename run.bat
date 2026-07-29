@echo off
chcp 65001 > nul
title 곰신로그 개발 서버 실행기

echo =========================================
echo  곰신로그 (GomsinLog) 개발 서버를 시작합니다.
echo =========================================
echo.

cd /d "%~dp0"

:: 3초 후 기본 브라우저로 localhost:5173 자동 접속
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5173"

:: Vite 개발 서버 실행
call npm run dev

pause