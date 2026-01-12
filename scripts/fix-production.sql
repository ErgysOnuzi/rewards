ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
UPDATE users SET profile_image_url = 'https://ui-avatars.com/api/?name=' || username || '&background=10b981&color=fff&size=128' WHERE profile_image_url IS NULL;
