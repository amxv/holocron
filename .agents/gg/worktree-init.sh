#!/usr/bin/env bash
set -euo pipefail

mise exec node@24.21.0 -- npm run ci:all
