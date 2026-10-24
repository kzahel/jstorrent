#!/usr/bin/env bash
set -euo pipefail

# GitHub's Azure mirror can stall individual package downloads for minutes.
# Keep Ubuntu's signed package indexes and use its official HTTPS archive.
for source_file in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/apt-mirrors.txt; do
  if [[ -f "$source_file" ]]; then
    sudo sed -i -E 's@https?://azure\.archive\.ubuntu\.com/ubuntu@https://archive.ubuntu.com/ubuntu@g' "$source_file"
  fi
done

printf '%s\n' \
  'Acquire::Retries "2";' \
  'Acquire::http::Timeout "30";' \
  'Acquire::https::Timeout "30";' \
  | sudo tee /etc/apt/apt.conf.d/99-jstorrent-downloads > /dev/null
