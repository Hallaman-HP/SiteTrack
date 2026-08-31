-- SiteTrack: replace literal 'null'/'NULL'/'undefined' strings with SQL NULL
-- across every nullable text column touched by the Supabase import.
-- Idempotent. Run AFTER reviewing count_nulls.sql output.
--
-- Wrapped in a transaction so it's all-or-nothing.

START TRANSACTION;

UPDATE users
   SET first_name  = NULLIF(NULLIF(NULLIF(first_name,  'null'), 'NULL'), 'undefined'),
       last_name   = NULLIF(NULLIF(NULLIF(last_name,   'null'), 'NULL'), 'undefined'),
       display_name= NULLIF(NULLIF(NULLIF(display_name,'null'), 'NULL'), 'undefined'),
       avatar_path = NULLIF(NULLIF(NULLIF(avatar_path, 'null'), 'NULL'), 'undefined')
 WHERE first_name  IN ('null','NULL','undefined')
    OR last_name   IN ('null','NULL','undefined')
    OR display_name IN ('null','NULL','undefined')
    OR avatar_path IN ('null','NULL','undefined');

UPDATE sessions
   SET ip         = NULLIF(NULLIF(NULLIF(ip,         'null'), 'NULL'), 'undefined'),
       user_agent = NULLIF(NULLIF(NULLIF(user_agent, 'null'), 'NULL'), 'undefined')
 WHERE ip IN ('null','NULL','undefined') OR user_agent IN ('null','NULL','undefined');

UPDATE trusted_devices
   SET user_agent = NULLIF(NULLIF(NULLIF(user_agent, 'null'), 'NULL'), 'undefined')
 WHERE user_agent IN ('null','NULL','undefined');

UPDATE sites
   SET address     = NULLIF(NULLIF(NULLIF(address,     'null'), 'NULL'), 'undefined'),
       client_name = NULLIF(NULLIF(NULLIF(client_name, 'null'), 'NULL'), 'undefined'),
       job_number  = NULLIF(NULLIF(NULLIF(job_number,  'null'), 'NULL'), 'undefined')
 WHERE address IN ('null','NULL','undefined')
    OR client_name IN ('null','NULL','undefined')
    OR job_number IN ('null','NULL','undefined');

UPDATE rooms
   SET room_name = NULLIF(NULLIF(NULLIF(room_name, 'null'), 'NULL'), 'undefined'),
       floor     = NULLIF(NULLIF(NULLIF(floor,     'null'), 'NULL'), 'undefined')
 WHERE room_name IN ('null','NULL','undefined')
    OR floor IN ('null','NULL','undefined');

UPDATE assets
   SET serial_number        = NULLIF(NULLIF(NULLIF(serial_number,        'null'), 'NULL'), 'undefined'),
       item_type            = NULLIF(NULLIF(NULLIF(item_type,            'null'), 'NULL'), 'undefined'),
       brand                = NULLIF(NULLIF(NULLIF(brand,                'null'), 'NULL'), 'undefined'),
       model                = NULLIF(NULLIF(NULLIF(model,                'null'), 'NULL'), 'undefined'),
       mac_address          = NULLIF(NULLIF(NULLIF(mac_address,          'null'), 'NULL'), 'undefined'),
       ip_address           = NULLIF(NULLIF(NULLIF(ip_address,           'null'), 'NULL'), 'undefined'),
       switch_port          = NULLIF(NULLIF(NULLIF(switch_port,          'null'), 'NULL'), 'undefined'),
       network_patch_number = NULLIF(NULLIF(NULLIF(network_patch_number, 'null'), 'NULL'), 'undefined'),
       location_in_room     = NULLIF(NULLIF(NULLIF(location_in_room,     'null'), 'NULL'), 'undefined'),
       patching_details     = NULLIF(NULLIF(NULLIF(patching_details,     'null'), 'NULL'), 'undefined'),
       notes                = NULLIF(NULLIF(NULLIF(notes,                'null'), 'NULL'), 'undefined'),
       archived_reason      = NULLIF(NULLIF(NULLIF(archived_reason,      'null'), 'NULL'), 'undefined')
 WHERE serial_number IN ('null','NULL','undefined')
    OR item_type IN ('null','NULL','undefined')
    OR brand IN ('null','NULL','undefined')
    OR model IN ('null','NULL','undefined')
    OR mac_address IN ('null','NULL','undefined')
    OR ip_address IN ('null','NULL','undefined')
    OR switch_port IN ('null','NULL','undefined')
    OR network_patch_number IN ('null','NULL','undefined')
    OR location_in_room IN ('null','NULL','undefined')
    OR patching_details IN ('null','NULL','undefined')
    OR notes IN ('null','NULL','undefined')
    OR archived_reason IN ('null','NULL','undefined');

UPDATE asset_photos
   SET caption = NULLIF(NULLIF(NULLIF(caption, 'null'), 'NULL'), 'undefined')
 WHERE caption IN ('null','NULL','undefined');

UPDATE asset_logs
   SET previous_location = NULLIF(NULLIF(NULLIF(previous_location, 'null'), 'NULL'), 'undefined'),
       new_location      = NULLIF(NULLIF(NULLIF(new_location,      'null'), 'NULL'), 'undefined'),
       notes             = NULLIF(NULLIF(NULLIF(notes,             'null'), 'NULL'), 'undefined'),
       user_name         = NULLIF(NULLIF(NULLIF(user_name,         'null'), 'NULL'), 'undefined')
 WHERE previous_location IN ('null','NULL','undefined')
    OR new_location IN ('null','NULL','undefined')
    OR notes IN ('null','NULL','undefined')
    OR user_name IN ('null','NULL','undefined');

COMMIT;
