/*
# Add storage policies for meeting-files bucket

1. Security
- Allow authenticated users to upload files
- Allow public read access for file downloads (files are shared in meetings)
- Allow uploaders to delete their own files
*/

CREATE POLICY "Allow authenticated uploads to meeting-files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'meeting-files');

CREATE POLICY "Allow public read of meeting-files"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'meeting-files');

CREATE POLICY "Allow authenticated delete of meeting-files"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'meeting-files');
