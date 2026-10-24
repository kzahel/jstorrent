#!/bin/sh
exec node "$(dirname "$0")/release-extension.mjs" "$@"
