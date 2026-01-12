-- Assign existing users without referrers to ergysonuzi
INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code, status, created_at)
SELECT 
  (SELECT id FROM users WHERE LOWER(username) = 'ergysonuzi') as referrer_user_id,
  u.id as referred_user_id,
  'ergysonuzi' as referral_code,
  'pending' as status,
  NOW() as created_at
FROM users u 
LEFT JOIN referrals r ON u.id = r.referred_user_id 
WHERE r.id IS NULL AND LOWER(u.username) != 'ergysonuzi';
