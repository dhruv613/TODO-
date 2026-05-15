@echo off
cd /d "%~dp0"
echo Starting Tobo List...
echo Open your browser at http://localhost:8000
.venv\Scripts\uvicorn.exe main:app --reload --host 0.0.0.0 --port 8000
