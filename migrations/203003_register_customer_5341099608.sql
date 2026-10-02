INSERT INTO bot_customers (user_id, username, first_name, status)
VALUES (5341099608, 'lilNyxia', '', 'active')
ON CONFLICT (user_id) DO UPDATE SET
  username = EXCLUDED.username,
  status = 'active',
  last_active_at = NOW();
