-- LukeRewards Database Backup
-- Created: 2026-01-20T19:30:39.434Z
-- Type: Scheduled

SET search_path TO public;

-- Table users: 2 rows
DELETE FROM users;
INSERT INTO users (id, email, created_at, updated_at, stake_username, stake_platform, verification_status, verified_at, security_disclaimer_accepted, username, password_hash, deleted_at) VALUES ('10b12106-930c-4e46-a6bd-462b770f6676', '23dbc2c37877057fc80f10a87ddee901:3ea93bd28a114e859d72dbd5ca0080f6:f9d5b6a062353fce5d034aa5ed727b6abde1c45fbc46', '2026-01-07T19:07:48.998Z', '2026-01-07T19:07:48.998Z', 'lukegraves69', 'com', 'verified', NULL, FALSE, 'lukegraves69', '$2b$12$ZcGfT1ciMpxay6aUGrDt4O1Tdo8MDw5Q8XPQjM3hWa3xthmz6RXga', NULL);
INSERT INTO users (id, email, created_at, updated_at, stake_username, stake_platform, verification_status, verified_at, security_disclaimer_accepted, username, password_hash, deleted_at) VALUES ('c56d8367-0bf4-458e-86a5-1a183e46d7e5', '42c0861b8e64673fdb7f8baf923023f0:9ace2d0cec6e8f7077dbe956a29a95cb:4a55b2917924df1da27a2e708376ce9cdbfd04fa0d3d', '2026-01-12T15:31:28.582Z', '2026-01-17T04:27:37.438Z', 'ergysonuzi', 'us', 'verified', NULL, FALSE, 'ergysonuzi', '$2b$12$.oO2cccn5axA6dtARGdqbOooVrWOLybOY.eZf5IlZYJPr.3NHNUb2', NULL);

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
INSERT INTO admin_sessions (id, session_token, created_at, expires_at, last_activity_at) VALUES (22, 'c64ea3c871ea24dae2a95ca8bbe93098f77a11150b4881c51a90399f83324f9d', '2026-01-17T04:25:04.835Z', '2026-01-18T04:25:04.786Z', '2026-01-17T04:26:40.340Z');

-- Table admin_credentials: 1 rows
DELETE FROM admin_credentials;
INSERT INTO admin_credentials (id, username_encrypted, password_hash, created_at, updated_at) VALUES (1, '4f24f49e23341a6e883264bbc1b28f55:28d76c9cea6dccfbf1715e6dce7c4561:9e08cbc791b252b39752ef', '$2b$12$d2YYigS310YKN35yoOxql.gyqZ40bw.HnUxCMx0wr5Q8lk23EyGdq', '2026-01-09T18:49:39.438Z', '2026-01-09T18:49:39.438Z');

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
-- Table admin_activity_logs: 7 rows
DELETE FROM admin_activity_logs;
INSERT INTO admin_activity_logs (id, action, target_type, target_id, details, ip_hash, created_at) VALUES (1, 'login', 'session', NULL, '{"method":"password"}', '2fe8fefddeb391dd', '2026-01-09T18:49:39.590Z');
INSERT INTO admin_activity_logs (id, action, target_type, target_id, details, ip_hash, created_at) VALUES (2, 'logout', 'session', NULL, NULL, '2fe8fefddeb391dd', '2026-01-09T18:59:20.719Z');
INSERT INTO admin_activity_logs (id, action, target_type, target_id, details, ip_hash, created_at) VALUES (3, 'login', 'session', NULL, '{"method":"password"}', '2fe8fefddeb391dd', '2026-01-09T18:59:27.688Z');
INSERT INTO admin_activity_logs (id, action, target_type, target_id, details, ip_hash, created_at) VALUES (4, 'login', 'session', NULL, '{"method":"password"}', '2fe8fefddeb391dd', '2026-01-10T21:09:31.447Z');
INSERT INTO admin_activity_logs (id, action, target_type, target_id, details, ip_hash, created_at) VALUES (5, 'login', 'session', NULL, '{"method":"password"}', '37e25aceb0f1a8ae', '2026-01-16T20:20:35.374Z');
INSERT INTO admin_activity_logs (id, action, target_type, target_id, details, ip_hash, created_at) VALUES (6, 'login', 'session', NULL, '{"method":"password"}', '1837f48e9b8250ec', '2026-01-17T03:14:24.751Z');
INSERT INTO admin_activity_logs (id, action, target_type, target_id, details, ip_hash, created_at) VALUES (7, 'login', 'session', NULL, '{"method":"password"}', '1837f48e9b8250ec', '2026-01-17T04:25:04.919Z');

-- Table backup_logs: 67 rows
DELETE FROM backup_logs;
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (148, 'backup_2026-01-19T19-44-49.sql', 24195, 'success', NULL, '2026-01-19T19:44:50.839Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (83, 'backup_2026-01-12T19-52-29.sql', 25799, 'success', NULL, '2026-01-12T19:52:31.143Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (84, 'backup_2026-01-14T15-19-05.sql', 25984, 'success', NULL, '2026-01-14T15:19:06.992Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (85, 'backup_2026-01-14T19-29-38.sql', 26169, 'success', NULL, '2026-01-14T19:29:39.754Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (86, 'backup_2026-01-14T19-55-24.sql', 26354, 'success', NULL, '2026-01-14T19:55:25.453Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (87, 'backup_2026-01-14T20-38-05.sql', 26539, 'success', NULL, '2026-01-14T20:38:07.252Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (88, 'backup_2026-01-16T15-27-31.sql', 26724, 'success', NULL, '2026-01-16T15:27:32.918Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (89, 'backup_2026-01-16T15-29-21.sql', 26909, 'success', NULL, '2026-01-16T15:29:22.998Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (90, 'backup_2026-01-16T15-30-41.sql', 27094, 'success', NULL, '2026-01-16T15:30:42.314Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (91, 'backup_2026-01-16T19-58-42.sql', 27279, 'success', NULL, '2026-01-16T19:58:43.838Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (92, 'backup_2026-01-16T20-04-27.sql', 24334, 'success', NULL, '2026-01-16T20:04:28.677Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (93, 'backup_2026-01-16T20-06-23.sql', 24519, 'success', NULL, '2026-01-16T20:06:24.144Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (94, 'backup_2026-01-16T20-11-55.sql', 24704, 'success', NULL, '2026-01-16T20:11:56.209Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (95, 'backup_2026-01-16T20-13-09.sql', 24889, 'success', NULL, '2026-01-16T20:13:10.657Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (96, 'backup_2026-01-16T20-17-05.sql', 25074, 'success', NULL, '2026-01-16T20:17:07.028Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (97, 'backup_2026-01-16T20-18-14.sql', 25259, 'success', NULL, '2026-01-16T20:18:16.032Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (98, 'backup_2026-01-16T20-19-53.sql', 25444, 'success', NULL, '2026-01-16T20:19:54.781Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (99, 'backup_2026-01-16T22-49-52.sql', 25839, 'success', NULL, '2026-01-16T22:49:53.492Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (100, 'backup_2026-01-16T23-11-40.sql', 25469, 'success', NULL, '2026-01-16T23:11:41.376Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (101, 'backup_2026-01-16T23-13-15.sql', 25655, 'success', NULL, '2026-01-16T23:13:16.429Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (102, 'backup_2026-01-16T23-15-28.sql', 25841, 'success', NULL, '2026-01-16T23:15:29.295Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (103, 'backup_2026-01-16T23-17-38.sql', 26027, 'success', NULL, '2026-01-16T23:17:39.211Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (104, 'backup_2026-01-16T23-19-10.sql', 26213, 'success', NULL, '2026-01-16T23:19:11.874Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (105, 'backup_2026-01-17T03-09-50.sql', 26399, 'success', NULL, '2026-01-17T03:09:51.952Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (106, 'backup_2026-01-17T03-15-34.sql', 26795, 'success', NULL, '2026-01-17T03:15:35.344Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (107, 'backup_2026-01-17T03-17-50.sql', 26981, 'success', NULL, '2026-01-17T03:17:51.509Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (108, 'backup_2026-01-17T03-19-49.sql', 27167, 'success', NULL, '2026-01-17T03:19:50.847Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (109, 'backup_2026-01-17T03-38-56.sql', 27448, 'success', NULL, '2026-01-17T03:38:57.641Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (110, 'backup_2026-01-17T03-42-02.sql', 27634, 'success', NULL, '2026-01-17T03:42:03.383Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (111, 'backup_2026-01-17T03-43-10.sql', 27833, 'success', NULL, '2026-01-17T03:43:11.784Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (112, 'backup_2026-01-17T03-49-16.sql', 28019, 'success', NULL, '2026-01-17T03:49:18.109Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (113, 'backup_2026-01-17T03-52-49.sql', 28205, 'success', NULL, '2026-01-17T03:52:50.098Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (114, 'backup_2026-01-17T03-56-10.sql', 28391, 'success', NULL, '2026-01-17T03:56:11.692Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (115, 'backup_2026-01-17T04-00-14.sql', 28577, 'success', NULL, '2026-01-17T04:00:15.466Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (116, 'backup_2026-01-17T04-10-40.sql', 28763, 'success', NULL, '2026-01-17T04:10:42.019Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (117, 'backup_2026-01-17T04-13-16.sql', 28949, 'success', NULL, '2026-01-17T04:13:16.949Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (118, 'backup_2026-01-17T04-15-06.sql', 29135, 'success', NULL, '2026-01-17T04:15:06.993Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (119, 'backup_2026-01-17T04-16-11.sql', 29321, 'success', NULL, '2026-01-17T04:16:13.028Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (120, 'backup_2026-01-17T04-19-53.sql', 29507, 'success', NULL, '2026-01-17T04:19:54.496Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (121, 'backup_2026-01-17T04-22-19.sql', 29694, 'success', NULL, '2026-01-17T04:22:20.842Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (122, 'backup_2026-01-17T04-24-02.sql', 29880, 'success', NULL, '2026-01-17T04:24:04.064Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (123, 'backup_2026-01-17T04-25-31.sql', 30276, 'success', NULL, '2026-01-17T04:25:32.051Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (124, 'backup_2026-01-17T04-30-11.sql', 30462, 'success', NULL, '2026-01-17T04:30:12.211Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (125, 'backup_2026-01-17T04-32-53.sql', 30648, 'success', NULL, '2026-01-17T04:32:55.208Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (126, 'backup_2026-01-17T04-36-02.sql', 30834, 'success', NULL, '2026-01-17T04:36:03.344Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (127, 'backup_2026-01-17T04-37-36.sql', 31020, 'success', NULL, '2026-01-17T04:37:37.453Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (128, 'backup_2026-01-17T04-41-05.sql', 31206, 'success', NULL, '2026-01-17T04:41:06.205Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (129, 'backup_2026-01-17T04-44-05.sql', 31392, 'success', NULL, '2026-01-17T04:44:06.236Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (130, 'backup_2026-01-17T05-09-17.sql', 31578, 'success', NULL, '2026-01-17T05:09:18.487Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (131, 'backup_2026-01-17T05-10-32.sql', 31764, 'success', NULL, '2026-01-17T05:10:34.269Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (132, 'backup_2026-01-17T05-12-17.sql', 31950, 'success', NULL, '2026-01-17T05:12:18.644Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (133, 'backup_2026-01-17T13-10-06.sql', 32136, 'success', NULL, '2026-01-17T13:10:07.344Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (134, 'backup_2026-01-17T13-12-16.sql', 32322, 'success', NULL, '2026-01-17T13:12:17.730Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (135, 'backup_2026-01-17T13-25-39.sql', 32508, 'success', NULL, '2026-01-17T13:25:40.094Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (136, 'backup_2026-01-17T15-57-22.sql', 32694, 'success', NULL, '2026-01-17T15:57:24.048Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (137, 'backup_2026-01-17T15-58-47.sql', 31955, 'success', NULL, '2026-01-17T15:58:48.109Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (138, 'backup_2026-01-17T16-00-15.sql', 32141, 'success', NULL, '2026-01-17T16:00:16.547Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (139, 'backup_2026-01-17T19-56-06.sql', 32327, 'success', NULL, '2026-01-17T19:56:07.626Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (140, 'backup_2026-01-17T19-57-27.sql', 31403, 'success', NULL, '2026-01-17T19:57:28.335Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (141, 'backup_2026-01-17T20-23-22.sql', 31589, 'success', NULL, '2026-01-17T20:23:23.368Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (142, 'backup_2026-01-19T14-38-46.sql', 31775, 'success', NULL, '2026-01-19T14:38:47.481Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (143, 'backup_2026-01-19T14-39-53.sql', 26780, 'success', NULL, '2026-01-19T14:39:54.792Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (144, 'backup_2026-01-19T14-41-12.sql', 26966, 'success', NULL, '2026-01-19T14:41:13.922Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (145, 'backup_2026-01-19T14-42-22.sql', 27152, 'success', NULL, '2026-01-19T14:42:23.853Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (146, 'backup_2026-01-19T15-19-28.sql', 27338, 'success', NULL, '2026-01-19T15:19:29.689Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (147, 'backup_2026-01-19T18-59-03.sql', 27524, 'success', NULL, '2026-01-19T18:59:04.847Z');
INSERT INTO backup_logs (id, filename, size_bytes, status, error_message, created_at) VALUES (149, 'backup_2026-01-19T19-46-13.sql', 23641, 'success', NULL, '2026-01-19T19:46:14.297Z');

