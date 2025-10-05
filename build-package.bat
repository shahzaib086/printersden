@echo off
echo Building SADA Bridge with bundled Acrobat.exe...
echo.

echo Cleaning previous build...
if exist dist rmdir /s /q dist

echo.
echo Building Windows package...
npm run build-win

echo.
echo Build completed! Check the 'dist' folder for the installer.
echo The Acrobat.exe file will be included in the package.
pause
