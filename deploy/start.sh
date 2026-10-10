#!/bin/sh
# Container entry point. Runs as root only long enough to prepare the data volume
# (a fresh platform volume is empty and root-owned), then runs the server as "node".
set -e
cd /app
mkdir -p data/figma data/out
# The Figma library read from the Carbon kit ships with the image; a newer image refreshes it.
if [ deploy/seed/library.json -nt data/out/library.json ]; then cp deploy/seed/library.json data/out/library.json; fi
chown -R node:node data
exec setpriv --reuid=node --regid=node --init-groups node web/src/server.ts
