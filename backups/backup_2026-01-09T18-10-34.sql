-- LukeRewards Database Backup
-- Created: 2026-01-09T18:10:34.677Z
-- Type: Scheduled

SET search_path TO public;

-- Table users: 1 rows
DELETE FROM users;
INSERT INTO users (id, email, first_name, last_name, profile_image_url, created_at, updated_at, stake_username, stake_platform, verification_status, verified_at, security_disclaimer_accepted, username, password_hash, deleted_at) VALUES ('10b12106-930c-4e46-a6bd-462b770f6676', '23dbc2c37877057fc80f10a87ddee901:3ea93bd28a114e859d72dbd5ca0080f6:f9d5b6a062353fce5d034aa5ed727b6abde1c45fbc46', NULL, NULL, NULL, '2026-01-07T19:07:48.998Z', '2026-01-07T19:07:48.998Z', 'lukegraves69', 'com', 'verified', NULL, FALSE, 'lukegraves69', '$2b$12$ZcGfT1ciMpxay6aUGrDt4O1Tdo8MDw5Q8XPQjM3hWa3xthmz6RXga', NULL);

-- Table verification_requests: 0 rows
-- Table spin_logs: 18 rows
DELETE FROM spin_logs;
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (115, '2026-01-02T10:27:20.781Z', 'nielieboyluke', 1332.21, 1, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (116, '2026-01-02T19:20:51.916Z', 'jakobie07', 32041.28, 1, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (117, '2026-01-03T11:58:55.743Z', 'nielieboyluke', 1741.98, 2, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (118, '2026-01-03T23:11:13.729Z', 'whydoyou123s', 20303.09, 1, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (119, '2026-01-04T04:21:03.719Z', 'jakobie07', 33351.24, 2, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (120, '2026-01-04T04:21:52.843Z', 'bopero69', 414.44, 1, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (121, '2026-01-04T13:45:09.051Z', 'nielieboyluke', 1742.98, 3, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (122, '2026-01-04T21:54:55.659Z', 'boperowins', 474.55, 1, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (123, '2026-01-05T12:43:47.602Z', 'lowkeyhigh9', 10231.35, 1, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (124, '2026-01-05T12:44:37.875Z', 'degenreseen', 3294.83, 1, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (125, '2026-01-05T12:51:42.938Z', 'bopero69', 414.44, 2, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (126, '2026-01-05T15:10:44.860Z', 'whydoyou123s', 20224.24, 2, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (127, '2026-01-05T15:10:52.830Z', 'whydoyou123s', 20224.24, 1, 'LOSE', '$0', 0, 'grey', FALSE, 'b1b1cd9cefd8370c31561f00a0daaa07919c87d9f42544e081705eb7d749fa57');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (128, '2026-01-05T15:10:58.823Z', 'whydoyou123s', 20224.24, 2, 'LOSE', '$0', 0, 'grey', FALSE, 'b1b1cd9cefd8370c31561f00a0daaa07919c87d9f42544e081705eb7d749fa57');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (129, '2026-01-05T23:43:03.788Z', 'nielieboyluke', 1742.98, 4, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (130, '2026-01-06T02:48:36.389Z', 'jakobie07', 33483.1, 3, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (131, '2026-01-06T02:49:18.058Z', 'boperowins', 474.55, 2, 'LOSE', '[BONUS] $0', 0, 'grey', TRUE, '6e18196cb6d2b39961dcc1a0afbd114049157662c662c4e5a6789b55703ffbf3');
INSERT INTO spin_logs (id, timestamp, stake_id, wagered_amount, spin_number, result, prize_label, prize_value, prize_color, is_bonus, ip_hash) VALUES (132, '2026-01-07T23:08:49.869Z', 'lukegraves69', 5000, 1, 'LOSE', '$0', 0, 'grey', FALSE, '4dd57ff20480342874da37a4b0a6b44b9044835040734cc40832fe5a804dee9a');

-- Table user_wallets: 0 rows
-- Table user_spin_balances: 0 rows
-- Table withdrawal_requests: 0 rows
-- Table wallet_transactions: 0 rows
-- Table user_flags: 0 rows
-- Table admin_sessions: 1 rows
DELETE FROM admin_sessions;
INSERT INTO admin_sessions (id, session_token, created_at, expires_at, last_activity_at) VALUES (16, '744d6fdb9af5b9f6a382e7eaef67cca9ad177290e4a7e8378c21c66c46b7d3c3', '2026-01-08T03:19:43.712Z', '2026-01-09T03:19:43.665Z', '2026-01-08T03:28:43.331Z');

-- Table admin_credentials: 0 rows
-- Table export_logs: 0 rows
-- Table feature_toggles: 0 rows
-- Table payouts: 0 rows
-- Table rate_limit_logs: 0 rows
-- Table user_state: 7 rows
DELETE FROM user_state;
INSERT INTO user_state (id, stake_id, last_bonus_spin_at, created_at, updated_at) VALUES (24, 'lowkeyhigh9', '2026-01-05T12:43:47.521Z', '2026-01-05T12:43:47.462Z', '2026-01-05T12:43:47.521Z');
INSERT INTO user_state (id, stake_id, last_bonus_spin_at, created_at, updated_at) VALUES (25, 'degenreseen', '2026-01-05T12:44:37.795Z', '2026-01-05T12:44:37.750Z', '2026-01-05T12:44:37.795Z');
INSERT INTO user_state (id, stake_id, last_bonus_spin_at, created_at, updated_at) VALUES (22, 'bopero69', '2026-01-05T12:51:42.856Z', '2026-01-04T04:21:52.708Z', '2026-01-05T12:51:42.856Z');
INSERT INTO user_state (id, stake_id, last_bonus_spin_at, created_at, updated_at) VALUES (21, 'whydoyou123s', '2026-01-05T15:10:44.774Z', '2026-01-03T23:11:13.594Z', '2026-01-05T15:10:44.774Z');
INSERT INTO user_state (id, stake_id, last_bonus_spin_at, created_at, updated_at) VALUES (19, 'nielieboyluke', '2026-01-05T23:43:03.704Z', '2026-01-02T10:27:20.627Z', '2026-01-05T23:43:03.704Z');
INSERT INTO user_state (id, stake_id, last_bonus_spin_at, created_at, updated_at) VALUES (20, 'jakobie07', '2026-01-06T02:48:36.307Z', '2026-01-02T19:20:51.775Z', '2026-01-06T02:48:36.307Z');
INSERT INTO user_state (id, stake_id, last_bonus_spin_at, created_at, updated_at) VALUES (23, 'boperowins', '2026-01-06T02:49:17.979Z', '2026-01-04T21:54:55.524Z', '2026-01-06T02:49:17.979Z');

-- Table wager_overrides: 1 rows
DELETE FROM wager_overrides;
INSERT INTO wager_overrides (id, stake_id, lifetime_wagered, year_to_date_wagered, note, created_at, updated_at) VALUES (1, 'lukegraves69', 5000, 10000, 'Admin updated wager data', '2026-01-07T19:34:51.137Z', '2026-01-07T23:08:25.948Z');

-- Table guaranteed_wins: 0 rows
-- Table demo_users: 0 rows
-- Table admin_activity_logs: 0 rows
-- Table backup_logs: 2 rows
DELETE FROM backup_logs;
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (1, 'backup_2026-01-09T18-04-36.sql', 9044, 'success', NULL, '2026-01-09T18:04:38.025Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (2, 'backup_2026-01-09T18-06-37.sql', 9253, 'success', NULL, '2026-01-09T18:06:38.474Z');

