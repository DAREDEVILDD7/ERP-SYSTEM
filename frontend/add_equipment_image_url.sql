-- Step 1: Add image_url column to equipment_types
ALTER TABLE equipment_types ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Step 2: Make Supabase Storage bucket public
-- Run this to create the bucket as public (or go to Storage UI and toggle "Public bucket" ON)
INSERT INTO storage.buckets (id, name, public)
VALUES ('equipment-images', 'equipment-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Step 3: Allow anyone to read from the equipment-images bucket
CREATE POLICY IF NOT EXISTS "Public read equipment images"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'equipment-images');

-- Step 4: Allow authenticated users to upload images
CREATE POLICY IF NOT EXISTS "Authenticated users can upload equipment images"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'equipment-images');

-- Step 5: Allow authenticated users to update/delete images
CREATE POLICY IF NOT EXISTS "Authenticated users can update equipment images"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'equipment-images');
