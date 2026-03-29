#!/bin/bash
# 飞书 App 集成测试一键运行脚本
# 自动启动 Mock Hub Server 和 App，运行集成测试后清理进程

set -e

# 项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# 端口配置
MOCK_PORT=9801
APP_PORT=8081

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 清理函数 - 确保进程被正确关闭
cleanup() {
  echo -e "${YELLOW}[清理] 关闭后台进程...${NC}"
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  if [ -n "$APP_PID" ]; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  echo -e "${GREEN}[清理] 完成${NC}"
}

# 注册退出钩子
trap cleanup EXIT

# 等待服务就绪
wait_for_service() {
  local url="$1"
  local name="$2"
  local max_retries=30
  local retry=0

  echo -e "${YELLOW}[等待] ${name} 启动中...${NC}"
  while [ $retry -lt $max_retries ]; do
    if curl -sf "$url" > /dev/null 2>&1; then
      echo -e "${GREEN}[就绪] ${name} 已启动${NC}"
      return 0
    fi
    retry=$((retry + 1))
    sleep 1
  done

  echo -e "${RED}[超时] ${name} 启动超时${NC}"
  return 1
}

cd "$PROJECT_DIR"

# 1. 启动 Mock Hub Server
echo -e "${YELLOW}[启动] Mock Hub Server (端口 ${MOCK_PORT})...${NC}"
go run github.com/openilink/openilink-hub/cmd/appmock@latest \
  --listen ":${MOCK_PORT}" \
  --webhook-url "http://localhost:${APP_PORT}/hub/webhook" \
  --app-token mock_app_token \
  --app-slug test-app &
MOCK_PID=$!

# 等待 Mock Server 就绪
wait_for_service "http://localhost:${MOCK_PORT}/mock/messages" "Mock Hub Server"

# 2. 启动飞书 App
echo -e "${YELLOW}[启动] 飞书 App (端口 ${APP_PORT})...${NC}"
HUB_URL="http://localhost:${MOCK_PORT}" \
BASE_URL="http://localhost:${APP_PORT}" \
LARK_APP_ID=mock_lark_id \
LARK_APP_SECRET=mock_lark_secret \
LARK_CHAT_ID=mock_chat_id \
PORT="${APP_PORT}" \
DB_PATH=":memory:" \
npx tsx src/index.ts &
APP_PID=$!

# 等待 App 就绪
wait_for_service "http://localhost:${APP_PORT}/health" "飞书 App"

# 3. 运行集成测试（临时移除 describe.skip）
echo -e "${YELLOW}[测试] 运行集成测试...${NC}"
npx vitest run tests/integration/ --reporter=verbose
TEST_EXIT=$?

# 输出测试结果
if [ $TEST_EXIT -eq 0 ]; then
  echo -e "${GREEN}[完成] 集成测试全部通过${NC}"
else
  echo -e "${RED}[失败] 集成测试存在失败用例${NC}"
fi

exit $TEST_EXIT
