-- Fix production database schema
-- Run this in the Production SQL runner to sync with current code

-- Drop old referral columns that were removed from the schema
ALTER TABLE users DROP COLUMN IF EXISTS profile_image_url;
ALTER TABLE users DROP COLUMN IF EXISTS referral_code;
ALTER TABLE users DROP COLUMN IF EXISTS referred_by;

-- Verify the fix worked
SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position;
