#!/usr/bin/env bash
# Regression test: template-sync must never overwrite itself at runtime.

set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

pass() {
  echo -e "  ${GREEN}PASS${NC}: $1"
  TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
  echo -e "  ${RED}FAIL${NC}: $1"
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

REPO_DIR="$WORK_DIR/repo"
mkdir -p "$REPO_DIR/scripts/lib"
cp scripts/template-sync.sh "$REPO_DIR/scripts/template-sync.sh"
cp scripts/lib/overrides.sh "$REPO_DIR/scripts/lib/overrides.sh"
chmod +x "$REPO_DIR/scripts/template-sync.sh"

cat > "$REPO_DIR/.agile-flow-version" <<'JSON'
{
  "version": "0.1.0",
  "syncDirectories": [
    "./scripts"
  ]
}
JSON

: > "$REPO_DIR/.agile-flow-overrides"

mkdir -p "$WORK_DIR/upstream/vibeacademy-agile-flow-release/scripts/lib"
cp scripts/template-sync.sh "$WORK_DIR/upstream/vibeacademy-agile-flow-release/scripts/template-sync.sh"
cp scripts/lib/overrides.sh "$WORK_DIR/upstream/vibeacademy-agile-flow-release/scripts/lib/overrides.sh"
echo "# upstream mutation" >> "$WORK_DIR/upstream/vibeacademy-agile-flow-release/scripts/template-sync.sh"

tar -czf "$WORK_DIR/upstream.tar.gz" -C "$WORK_DIR/upstream" vibeacademy-agile-flow-release

mkdir -p "$WORK_DIR/bin"
cat > "$WORK_DIR/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"/releases/latest"* ]]; then
  printf '{"tag_name":"v1.0.0","html_url":"https://example.invalid/release","tarball_url":"https://example.invalid/upstream.tar.gz"}'
  exit 0
fi
if [[ "$*" == *"upstream.tar.gz"* ]]; then
  out=''
  while [ "$#" -gt 0 ]; do
    if [ "$1" = "-o" ]; then
      out="$2"
      shift 2
      continue
    fi
    shift
  done
  cp "$TEST_UPSTREAM_TARBALL" "$out"
  exit 0
fi
exit 1
SH
chmod +x "$WORK_DIR/bin/curl"

pushd "$REPO_DIR" >/dev/null
git init >/dev/null
git add .
git commit -m "init" >/dev/null
git init --bare "$WORK_DIR/origin.git" >/dev/null
git remote add origin "$WORK_DIR/origin.git"
git push -u origin HEAD >/dev/null

SCRIPT_BEFORE_SUM=$(sha256sum scripts/template-sync.sh | awk '{print $1}')

if TEST_UPSTREAM_TARBALL="$WORK_DIR/upstream.tar.gz" PATH="$WORK_DIR/bin:$PATH" bash scripts/template-sync.sh > "$WORK_DIR/run.log" 2>&1; then
  SCRIPT_AFTER_SUM=$(sha256sum scripts/template-sync.sh | awk '{print $1}')
  if [ "$SCRIPT_BEFORE_SUM" = "$SCRIPT_AFTER_SUM" ]; then
    pass "runtime-protected template-sync.sh is not overwritten"
  else
    fail "template-sync.sh changed despite runtime protection"
  fi

  if grep -q "SKIP (runtime-protected): scripts/template-sync.sh" "$WORK_DIR/run.log"; then
    pass "runtime-protected skip is reported"
  else
    fail "expected runtime-protected skip log entry"
  fi
else
  cat "$WORK_DIR/run.log"
  fail "template-sync.sh execution failed"
fi

popd >/dev/null

echo "Results: ${TESTS_PASSED} passed, ${TESTS_FAILED} failed"
if [ "$TESTS_FAILED" -gt 0 ]; then
  exit 1
fi
