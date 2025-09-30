@echo off
echo Testing the built Printer Bridge application...
echo.

REM Start the built application
echo Starting Printer Bridge from dist folder...
start "" "dist\win-unpacked\Printer Bridge.exe"

REM Wait a moment for the app to start
timeout /t 5 /nobreak > NUL

REM Test the WebSocket connection
echo Testing WebSocket connection...
node test-client.js

echo.
echo Test complete!
pause
