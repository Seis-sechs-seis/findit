-- Manual seed for sample items
-- Run this after db/sql/supabase-schema.sql in Supabase SQL Editor.

insert into public.items
  (id, title, description, category, location, date, type, status, "contactName", "contactEmail", "createdAt")
values
  (
    'a1b2c3d4-0001-4000-8000-000000000001',
    'Black Leather Wallet',
    'Hi po, naiwan ko yung black leather wallet ko around cafeteria 2nd floor after lunch. May student ID at konting cash inside, tapos may initials na ''JB'' sa harap.',
    'Bags & Wallets',
    'Main Cafeteria, 2nd Floor',
    '2026-03-10',
    'lost',
    'active',
    'John Balbuena',
    'john.b@my.cspc.edu.ph',
    '2026-03-10T08:30:00.000Z'
  ),
  (
    'a1b2c3d4-0002-4000-8000-000000000002',
    'Blue Hydroflask Water Bottle',
    'Saw this blue Hydroflask sa bench near library entrance around 10am. May stickers pa, looks like someone forgot it after class.',
    'Other',
    'University Library Entrance',
    '2026-03-11',
    'found',
    'active',
    'Vince Bazar',
    'vince.b@my.cspc.edu.ph',
    '2026-03-11T10:15:00.000Z'
  ),
  (
    'a1b2c3d4-0003-4000-8000-000000000003',
    'Silver MacBook Charger',
    'This is to report a found item: one silver Apple MacBook charger (USB-C, 67W), recovered in IT Building Room 301 after the afternoon session.',
    'Electronics',
    'IT Building, Room 301',
    '2026-03-12',
    'found',
    'active',
    'Christian Obrero',
    'christian.o@my.cspc.edu.ph',
    '2026-03-12T14:45:00.000Z'
  ),
  (
    'a1b2c3d4-0004-4000-8000-000000000004',
    'Set of Honda Car Keys',
    'Help huhu, nawala yung Honda car keys ko sa Parking Lot B. Naka-Honda keychain siya and may maliit na flashlight na nakasabit.',
    'Keys',
    'Parking Lot B',
    '2026-03-13',
    'lost',
    'active',
    'Lee Ivan Sahurda',
    'lee.s@my.cspc.edu.ph',
    '2026-03-13T07:20:00.000Z'
  ),
  (
    'a1b2c3d4-0005-4000-8000-000000000005',
    'Red Notebook with Notes',
    'Good day. I found a red spiral notebook with handwritten Computer Science notes in Lecture Hall A. Walang name sa cover, but mukhang important yung laman.',
    'Books & Stationery',
    'Science Building, Lecture Hall A',
    '2026-03-14',
    'found',
    'claimed',
    'John Paul Caigas',
    'jp.c@my.cspc.edu.ph',
    '2026-03-14T16:00:00.000Z'
  )
on conflict (id) do nothing;
