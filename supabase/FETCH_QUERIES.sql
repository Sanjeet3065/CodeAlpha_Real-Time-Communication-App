-- ================================================================
-- CONNECTLY - DATA FETCH QUERIES
-- Inhe Supabase Dashboard > SQL Editor mein run karo
-- Ya apne code mein use karo testing ke liye
-- ================================================================

-- ============================================================
-- 1. PROFILES - Sabhi users ki profile dekhna
-- ============================================================

-- Saare profiles fetch karo
SELECT * FROM profiles ORDER BY created_at DESC;

-- Ek specific user ki profile (apna user_id daalo)
SELECT * FROM profiles WHERE email = 'your@email.com';

-- Profile count
SELECT COUNT(*) AS total_users FROM profiles;

-- ============================================================
-- 2. MEETINGS - Saari meetings fetch karna
-- ============================================================

-- Saari active meetings (host info ke saath)
SELECT 
  m.*,
  p.full_name AS host_name,
  p.email AS host_email,
  p.avatar_url AS host_avatar
FROM meetings m
JOIN profiles p ON p.id = m.host_id
ORDER BY m.created_at DESC;

-- Sirf active meetings
SELECT * FROM meetings WHERE status = 'active' ORDER BY started_at DESC;

-- Sirf ended meetings
SELECT * FROM meetings WHERE status = 'ended' ORDER BY ended_at DESC;

-- Scheduled meetings
SELECT * FROM meetings WHERE status = 'scheduled' ORDER BY started_at ASC;

-- Meeting code se meeting dhundhna
SELECT * FROM meetings WHERE code = 'ABCD-EFGH-IJKL';

-- Meeting ka full detail (host + participants count)
SELECT 
  m.*,
  p.full_name AS host_name,
  COUNT(mp.id) AS participant_count
FROM meetings m
LEFT JOIN profiles p ON p.id = m.host_id
LEFT JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.status = 'admitted'
GROUP BY m.id, p.full_name
ORDER BY m.created_at DESC;

-- ============================================================
-- 3. MEETING PARTICIPANTS - Kaun kaun meeting mein hai
-- ============================================================

-- Ek meeting ke saare participants (profiles ke saath)
SELECT 
  mp.*,
  p.full_name,
  p.email,
  p.avatar_url
FROM meeting_participants mp
JOIN profiles p ON p.id = mp.user_id
WHERE mp.meeting_id = 'PASTE-MEETING-UUID-HERE'
  AND mp.status != 'left'
ORDER BY mp.joined_at ASC;

-- Waiting room mein kaun hai
SELECT 
  mp.*,
  p.full_name,
  p.email
FROM meeting_participants mp
JOIN profiles p ON p.id = mp.user_id
WHERE mp.status = 'waiting'
ORDER BY mp.joined_at ASC;

-- Ek user ki saari meetings
SELECT 
  mp.role,
  mp.status,
  mp.joined_at,
  m.code,
  m.title,
  m.status AS meeting_status
FROM meeting_participants mp
JOIN meetings m ON m.id = mp.meeting_id
WHERE mp.user_id = 'PASTE-USER-UUID-HERE'
ORDER BY mp.joined_at DESC;

-- ============================================================
-- 4. MESSAGES - Chat messages fetch karna
-- ============================================================

-- Ek meeting ke saare messages (sender info ke saath)
SELECT 
  msg.*,
  p.full_name AS sender_name,
  p.avatar_url AS sender_avatar
FROM messages msg
JOIN profiles p ON p.id = msg.sender_id
WHERE msg.meeting_id = 'PASTE-MEETING-UUID-HERE'
ORDER BY msg.created_at ASC;

-- Last 50 messages of a meeting
SELECT 
  msg.*,
  p.full_name AS sender_name
FROM messages msg
JOIN profiles p ON p.id = msg.sender_id
WHERE msg.meeting_id = 'PASTE-MEETING-UUID-HERE'
ORDER BY msg.created_at DESC
LIMIT 50;

-- Total messages per meeting
SELECT 
  meeting_id,
  COUNT(*) AS message_count
FROM messages
GROUP BY meeting_id
ORDER BY message_count DESC;

-- ============================================================
-- 5. SHARED FILES - Meeting mein share ki gayi files
-- ============================================================

-- Ek meeting ki saari files
SELECT 
  sf.*,
  p.full_name AS uploader_name
FROM shared_files sf
JOIN profiles p ON p.id = sf.uploader_id
WHERE sf.meeting_id = 'PASTE-MEETING-UUID-HERE'
ORDER BY sf.created_at DESC;

-- File size format ke saath
SELECT 
  filename,
  ROUND(file_size / 1024.0 / 1024.0, 2) AS size_mb,
  mime_type,
  created_at
FROM shared_files
ORDER BY created_at DESC;

-- ============================================================
-- 6. WHITEBOARDS - Whiteboard data fetch karna
-- ============================================================

-- Ek meeting ka whiteboard
SELECT * FROM whiteboards 
WHERE meeting_id = 'PASTE-MEETING-UUID-HERE';

-- Saare whiteboards with their meeting title
SELECT 
  wb.*,
  m.title AS meeting_title,
  m.code AS meeting_code
FROM whiteboards wb
JOIN meetings m ON m.id = wb.meeting_id
ORDER BY wb.updated_at DESC;

-- ============================================================
-- 7. NOTIFICATIONS - User notifications fetch karna
-- ============================================================

-- Ek user ki saari notifications
SELECT * FROM notifications 
WHERE user_id = 'PASTE-USER-UUID-HERE'
ORDER BY created_at DESC;

-- Sirf unread notifications
SELECT * FROM notifications 
WHERE user_id = 'PASTE-USER-UUID-HERE'
  AND read = false
ORDER BY created_at DESC;

-- Unread count per user
SELECT 
  user_id,
  COUNT(*) AS unread_count
FROM notifications
WHERE read = false
GROUP BY user_id;

-- Saari notifications (debugging ke liye)
SELECT 
  n.*,
  p.full_name AS user_name,
  p.email
FROM notifications n
JOIN profiles p ON p.id = n.user_id
ORDER BY n.created_at DESC
LIMIT 50;

-- ============================================================
-- 8. CONTACTS - User contacts / friends list
-- ============================================================

-- Ek user ke saare accepted contacts
SELECT 
  c.*,
  requester.full_name AS requester_name,
  requester.email AS requester_email,
  addressee.full_name AS addressee_name,
  addressee.email AS addressee_email
FROM contacts c
JOIN profiles requester ON requester.id = c.requester_id
JOIN profiles addressee ON addressee.id = c.addressee_id
WHERE (c.requester_id = 'PASTE-USER-UUID-HERE' OR c.addressee_id = 'PASTE-USER-UUID-HERE')
  AND c.status = 'accepted'
ORDER BY c.created_at DESC;

-- Pending contact requests received by a user
SELECT 
  c.*,
  p.full_name AS requester_name,
  p.email AS requester_email,
  p.avatar_url
FROM contacts c
JOIN profiles p ON p.id = c.requester_id
WHERE c.addressee_id = 'PASTE-USER-UUID-HERE'
  AND c.status = 'pending'
ORDER BY c.created_at DESC;

-- ============================================================
-- 9. SCHEDULED MEETINGS - Future meetings
-- ============================================================

-- Saare upcoming scheduled meetings
SELECT 
  sm.*,
  p.full_name AS host_name,
  m.code AS meeting_code
FROM scheduled_meetings sm
JOIN profiles p ON p.id = sm.host_id
LEFT JOIN meetings m ON m.id = sm.meeting_id
WHERE sm.scheduled_for > NOW()
ORDER BY sm.scheduled_for ASC;

-- Past scheduled meetings
SELECT 
  sm.*,
  p.full_name AS host_name
FROM scheduled_meetings sm
JOIN profiles p ON p.id = sm.host_id
WHERE sm.scheduled_for < NOW()
ORDER BY sm.scheduled_for DESC;

-- ============================================================
-- 10. ANALYTICS / STATS QUERIES
-- ============================================================

-- App ka overall summary
SELECT 
  (SELECT COUNT(*) FROM profiles) AS total_users,
  (SELECT COUNT(*) FROM meetings) AS total_meetings,
  (SELECT COUNT(*) FROM meetings WHERE status = 'active') AS active_meetings,
  (SELECT COUNT(*) FROM meetings WHERE status = 'ended') AS ended_meetings,
  (SELECT COUNT(*) FROM messages) AS total_messages,
  (SELECT COUNT(*) FROM shared_files) AS total_files,
  (SELECT COUNT(*) FROM notifications WHERE read = false) AS unread_notifications;

-- Most active meetings (by message count)
SELECT 
  m.code,
  m.title,
  m.status,
  COUNT(msg.id) AS message_count
FROM meetings m
LEFT JOIN messages msg ON msg.meeting_id = m.id
GROUP BY m.id, m.code, m.title, m.status
ORDER BY message_count DESC
LIMIT 10;

-- Recently active users
SELECT 
  p.full_name,
  p.email,
  MAX(mp.joined_at) AS last_meeting_join
FROM profiles p
JOIN meeting_participants mp ON mp.user_id = p.id
GROUP BY p.id, p.full_name, p.email
ORDER BY last_meeting_join DESC
LIMIT 20;

-- ============================================================
-- 11. STORAGE - Files bucket check
-- ============================================================

-- Check meeting-files bucket exists
SELECT * FROM storage.buckets WHERE id = 'meeting-files';

-- All files in storage
SELECT 
  name,
  bucket_id,
  ROUND(metadata->>'size'::text::numeric / 1024, 2) AS size_kb,
  created_at
FROM storage.objects
WHERE bucket_id = 'meeting-files'
ORDER BY created_at DESC;

-- ============================================================
-- 12. AUTH - Users check (admin only)
-- ============================================================

-- Supabase ke registered users (auth.users - sirf service_role se)
SELECT 
  id,
  email,
  created_at,
  last_sign_in_at,
  raw_user_meta_data
FROM auth.users
ORDER BY created_at DESC;

-- Profile trigger ne kaam kiya ya nahi check karo
-- (auth.users mein hai lekin profiles mein nahi)
SELECT u.email, u.id
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE p.id IS NULL;

-- ================================================================
-- USEFUL DEBUGGING QUERIES
-- ================================================================

-- Table sizes check karo
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC;

-- RLS policies list
SELECT 
  tablename,
  policyname,
  cmd,
  qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Check realtime publication tables
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';
