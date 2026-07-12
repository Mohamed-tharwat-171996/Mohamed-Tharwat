#!/bin/bash

# This script deletes the old Firestore database (ai-studio-dailyinventoryau-00951ae3-ee45-4ad1-ad2a-6733dde9830e)
# completely with all its data from the Google Cloud / Firebase project.

echo "Deleting Firestore database: ai-studio-dailyinventoryau-00951ae3-ee45-4ad1-ad2a-6733dde9830e..."

npx firebase firestore:databases:delete ai-studio-dailyinventoryau-00951ae3-ee45-4ad1-ad2a-6733dde9830e \
  --project spartan-position-m5xj8 \
  --force

echo "Deletion command completed."
