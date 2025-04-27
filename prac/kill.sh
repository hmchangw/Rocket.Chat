#!/bin/bash

if [ -z "$1" ]; then
  echo "Usage: $0 <port>"
  exit 1
fi

PORT=$1

PID=$(lsof -t -i:$PORT)

if [ -n "$PID" ]; then
  kill -9 $PID
  echo "Killed process $PID using port $PORT."
fi
