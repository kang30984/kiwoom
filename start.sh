#!/usr/bin/env bash
# 시세 터미널 실행 (macOS / Linux)
# 터미널에서:  bash start.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 가 필요합니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  exit 1
fi

echo "Node $(node -v)"

if [ ! -f server/.env ]; then
  cp .env.example server/.env
  echo "server/.env 를 만들었습니다. 처음이라 데모 모드(가짜 시세)로 시작합니다."
fi

if [ ! -d server/node_modules ]; then
  echo "서버 패키지를 설치합니다…"
  (cd server && npm install)
fi

if [ ! -d web/node_modules ]; then
  echo "웹 패키지를 설치합니다…"
  (cd web && npm install)
fi

# 백엔드를 먼저 띄우고, 종료 시 함께 정리합니다.
(cd server && npm start) &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# 백엔드가 응답할 때까지 대기 (최대 20초)
for _ in $(seq 1 40); do
  if curl -sf http://localhost:4000/api/health >/dev/null 2>&1; then break; fi
  sleep 0.5
done

echo ""
echo "브라우저를 엽니다 → http://localhost:5173"
echo "종료하려면 이 터미널에서 Ctrl+C 를 누르세요."
echo ""

cd web && npm run dev
