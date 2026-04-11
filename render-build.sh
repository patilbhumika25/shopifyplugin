#!/usr/bin/env bash
# exit on error
set -o errexit

echo "--- Installing Root Dependencies ---"
npm install --include=dev

echo "--- Generating Prisma Client ---"
npx prisma generate

echo "--- Installing Frontend Dependencies ---"
cd frontend
npm install --include=dev

echo "--- Building Frontend ---"
npm run build

echo "--- Build Finished ---"
