@echo off
echo.
echo  iMove Partner Portal
echo  ====================
echo.

:: Check if node_modules exist
if not exist "node_modules" (
    echo  Installing dependencies (first time setup)...
    call npm run install:all
    echo.
)

echo  Starting the app...
echo  Frontend: http://localhost:5173
echo  Backend:  http://localhost:3001
echo.

call npm run dev
