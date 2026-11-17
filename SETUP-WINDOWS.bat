@echo off
setlocal
cd /d "%~dp0"
if not exist .env (
    if not exist .env.example (echo .env.example is missing. & goto :error)
    copy .env.example .env >nul || goto :error
    node -e "const fs=require('node:fs');const p='.env';let e=fs.readFileSync(p,'utf8');e=e.replace(/^JWT_SECRET=.*$/m,'JWT_SECRET='+require('node:crypto').randomBytes(48).toString('hex'));fs.writeFileSync(p,e)"
    if errorlevel 1 (echo Could not generate JWT_SECRET. & goto :error)
)
echo [1/6] Checking required tools...
where node >nul 2>nul || (echo Node.js 20+ is required. Install it from https://nodejs.org/ & goto :error)
where npm >nul 2>nul || (echo npm is required. & goto :error)
where docker >nul 2>nul || (echo Docker Desktop is required. Install and start it, then retry. & goto :error)
echo [2/6] Installing npm dependencies...
call npm install || goto :error
echo [3/6] Starting PostgreSQL and Redis with Docker Compose...
docker compose up -d || goto :error
echo [4/6] Generating Prisma client...
call npm run db:generate || goto :error
echo [5/6] Applying database migrations...
call npm run db:migrate -- --name init || goto :error
echo [6/6] Creating demo workspace...
call npm run db:seed || goto :error
echo.
echo Setup complete. Run START-COLLABSPACE.bat to launch the app.
pause
exit /b 0
:error
echo Setup failed. Read the error above and follow README.md troubleshooting.
pause
exit /b 1
