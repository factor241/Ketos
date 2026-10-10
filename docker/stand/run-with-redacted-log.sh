#!/bin/sh
# Run one command with stdout and stderr appended to a log file after its relay
# token is replaced. Usage: run-with-redacted-log.sh <log-file> <command> [args...]
#
# Syncthing logs its relay listener URLs, including `token=<value>` (the
# stand's shared relay credential), to stdout. The command writes into a named
# pipe, and a `sed` reader started first rewrites each line into the log file.
# The script ends with `exec`, so the command keeps the script's process ID and
# the caller can signal and wait on it as before. The reader ends when the
# command closes the pipe. An existing log is truncated, which also drops a
# token written by an earlier start.
#
# Fail-closed: only the reader writes the log, so no unredacted output can
# reach it. If the reader dies while the command runs, the command's next
# write fails with SIGPIPE and the command ends; the log keeps what was
# redacted so far, and the caller must restart the command.
set -eu

if [ "$#" -lt 2 ]; then
  echo "usage: run-with-redacted-log.sh <log-file> <command> [args...]" >&2
  exit 2
fi
log=$1
shift
if ! command -v "$1" >/dev/null 2>&1; then
  echo "run-with-redacted-log.sh: $1: command not found" >&2
  exit 127
fi

# Fail before the command starts when the log cannot be written.
: >"$log"

dir=$(mktemp -d "${TMPDIR:-/tmp}/redacted-log.XXXXXX")
fifo=$dir/pipe
mkfifo "$fifo"

(
  # Opening the pipe returns once the command has opened its end; the name is
  # not needed after that. C locale: the filter works on bytes, so a byte
  # sequence that is invalid in UTF-8 cannot end the match early. `-u` flushes
  # every line instead of every 4 KiB block.
  LC_ALL=C
  export LC_ALL
  exec <"$fifo"
  rm -rf "$dir"
  exec sed -u -E 's/(token=)[^&[:space:]"]*/\1REDACTED/g' >>"$log"
) &

exec "$@" >"$fifo" 2>&1
