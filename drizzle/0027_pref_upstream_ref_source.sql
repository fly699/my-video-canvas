-- Add the "prefer upstream AI temporary public URL" reference-source switch.
-- Off by default; when on, a downstream node's auto-filled referenceImageUrl is
-- switched to the upstream provider's temporary public URL (imageUrlSource) when
-- that URL probes alive, so providers can fetch it even if MinIO isn't public.
ALTER TABLE `storageSettings`
  ADD COLUMN `preferUpstreamRefSource` BOOLEAN NOT NULL DEFAULT false;
