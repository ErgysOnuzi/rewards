INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code, status, created_at)
SELECT 
  (SELECT id FROM users WHERE LOWER(username) = 'ergysonuzi'),
  u.id,
  'ergysonuzi',
  'pending',
  NOW()
FROM users u 
LEFT JOIN referrals r ON u.id = r.referred_user_id 
WHERE r.id IS NULL AND LOWER(u.username) != 'ergysonuzi';
