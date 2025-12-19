-- Database Backup from Development Environment
-- Generated: 2025-12-19

-- spin_logs data
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, ip_hash, prize_value) VALUES
(49, '2025-12-19 02:35:13.761978', 'degenerate181', 0, 1, 'LOSE', '[BONUS] No prize', '3b906728fbcad4b981f0fa8120255dbcfc248e9c3b33421eda814437c094f7a2', 0);

-- admin_sessions data
INSERT INTO admin_sessions (id, session_token, created_at, expires_at) VALUES
(2, '152a79daf8eae46d3acc5091a6c19b9a853d36f3150fb0a8e9004f804cf5ee29', '2025-12-19 15:48:35.817761', '2025-12-20 15:48:34.897'),
(3, 'b1566f0284bbb7f8834b36592bba907fd06f14257e090e9665cfcc6ab0df3972', '2025-12-19 17:46:21.423199', '2025-12-20 17:46:21.422'),
(4, '36b723ce46ab73e7543982209c57669a88c405d2d8933f446c1fa388b2429a10', '2025-12-19 18:16:18.979983', '2025-12-20 18:16:18.941');

-- user_state data
INSERT INTO user_state (id, stake_id, last_bonus_spin_at, created_at, updated_at) VALUES
(1, 'degenerate181', '2025-12-19 02:35:13.753', '2025-12-19 02:35:13.735342', '2025-12-19 02:35:13.753');

-- Note: The following tables are empty:
-- demo_users, guaranteed_wins, user_spin_balances, user_wallets, 
-- wallet_transactions, withdrawal_requests, export_logs, 
-- feature_toggles, payouts, rate_limit_logs, user_flags
