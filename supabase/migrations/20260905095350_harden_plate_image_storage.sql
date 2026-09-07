-- Plate evidence must already be re-encoded by FoodLens before it reaches the
-- private bucket. MIME restrictions are defense in depth; the authenticated AI
-- route additionally parses the WebP container, dimensions and metadata chunks.
update storage.buckets
set
  public = false,
  file_size_limit = 4000000,
  allowed_mime_types = array['image/webp']::text[]
where id = 'plate-images';

drop policy if exists plate_images_read on storage.objects;
create policy plate_images_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'plate-images'
    and private.is_school_member(
      ((storage.foldername(name))[1])::uuid,
      array['teacher', 'admin']
    )
  );
